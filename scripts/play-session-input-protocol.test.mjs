import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createInputProtocol,
  HARD_CAPS
} = require('../play-session-input-protocol.js');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const cid = value => `BBBBBBBBBBBBBBBBBBBBBB${value}`;
const snapshot = (connectionId, sequence, buttons = []) => ({
  type: 'snapshot',
  connectionId,
  sequence,
  buttons
});
const delta = (connectionId, sequence, pressed = [], released = []) => ({
  type: 'delta',
  connectionId,
  sequence,
  pressed,
  released
});

test('connect requires injected opaque connection ID', () => {
  const protocol = createInputProtocol();
  assert.equal(protocol.connect({ nowMs: 0 }).reasonCode, 'invalid_connection_id');
  assert.equal(protocol.connect({ nowMs: 1, connectionId: 'weak' }).reasonCode, 'invalid_connection_id');
  assert.equal(protocol.connect({ nowMs: 2, connectionId: cid(1) }).ok, true);
});

test('stale sequence one packet after reconnect fails safe', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(1) });
  protocol.enqueue(snapshot(cid(1), 1, ['A']), { nowMs: 1 });
  protocol.processNext({ nowMs: 2 });
  protocol.disconnect({ nowMs: 3 });
  protocol.connect({ nowMs: 4, connectionId: cid(2) });
  const result = protocol.enqueue(snapshot(cid(1), 1, ['A']), { nowMs: 5 });
  assert.equal(result.reasonCode, 'connection_mismatch');
  assert.equal(result.releaseAll, true);
  assert.equal(result.resyncRequired, true);
});

test('connection IDs cannot be reused', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(1) });
  protocol.disconnect({ nowMs: 1 });
  assert.equal(
    protocol.connect({ nowMs: 2, connectionId: cid(1) }).reasonCode,
    'connection_id_reused'
  );
});

test('unsafe button identifiers are rejected', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  for (const button of [' \n', 'A B', '', 'x'.repeat(33)]) {
    assert.equal(
      protocol.enqueue(snapshot(cid(3), 1, [button]), { nowMs: 1 }).reasonCode,
      'invalid_buttons'
    );
  }
});

test('safe button identifiers are accepted', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  assert.equal(
    protocol.enqueue(snapshot(cid(3), 1, ['A', 'DPAD_UP', 'L2:+']), { nowMs: 1 }).ok,
    true
  );
});

test('processing stall watchdog uses oldest queued work despite continued traffic', () => {
  const protocol = createInputProtocol({
    limits: { maxEventsPerSecond: 240, maxQueueDepth: 32 }
  });
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  protocol.enqueue(snapshot(cid(3), 1, []), { nowMs: 1 });
  protocol.processNext({ nowMs: 2 });
  for (let sequence = 2; sequence <= 6; sequence += 1) {
    protocol.enqueue(delta(cid(3), sequence, [`B${sequence}`], []), {
      nowMs: sequence * 100 - 100
    });
  }
  const result = protocol.watchdog({ nowMs: 600 });
  assert.equal(result.triggered, true);
  assert.equal(result.reasonCode, 'processing_stalled');
  assert.equal(result.releaseAll, true);
});

test('newly queued input after idle does not immediately look stalled', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(30) });
  protocol.enqueue(snapshot(cid(30), 1, []), { nowMs: 1 });
  protocol.processNext({ nowMs: 2 });
  assert.equal(protocol.watchdog({ nowMs: 1000 }).triggered, false);
  protocol.enqueue(delta(cid(30), 2, ['A'], []), { nowMs: 1001 });
  assert.equal(protocol.status().oldestQueuedAtMs, 1001);
  assert.equal(protocol.watchdog({ nowMs: 1002 }).triggered, false);
  assert.equal(protocol.watchdog({ nowMs: 1501 }).reasonCode, 'processing_stalled');
});

test('input silence watchdog releases held buttons', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  protocol.enqueue(snapshot(cid(3), 1, ['A']), { nowMs: 1 });
  protocol.processNext({ nowMs: 2 });
  assert.equal(protocol.watchdog({ nowMs: 500 }).triggered, false);
  assert.equal(protocol.watchdog({ nowMs: 501 }).triggered, true);
});

test('overflow preserves projected releases and sequence continuity', () => {
  const protocol = createInputProtocol({ limits: { maxQueueDepth: 2 } });
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  protocol.enqueue(snapshot(cid(3), 1, []), { nowMs: 1 });
  protocol.enqueue(delta(cid(3), 2, ['A'], []), { nowMs: 2 });
  const result = protocol.enqueue(delta(cid(3), 3, [], ['A']), { nowMs: 3 });
  assert.equal(result.compacted, true);
  const output = protocol.processNext({ nowMs: 4 });
  assert.equal(output.highestProcessedAck, 3);
  assert.deepEqual(output.buttons, []);
});

test('projected button cap rejects delta accumulation before sequence advancement', () => {
  const protocol = createInputProtocol({ limits: { maxButtons: 2 } });
  protocol.connect({ nowMs: 0, connectionId: cid(40) });
  protocol.enqueue(snapshot(cid(40), 1, ['A']), { nowMs: 1 });
  protocol.enqueue(delta(cid(40), 2, ['B'], []), { nowMs: 2 });
  const before = protocol.status();
  const result = protocol.enqueue(delta(cid(40), 3, ['C'], []), { nowMs: 3 });
  assert.equal(result.reasonCode, 'button_state_capacity_exceeded');
  assert.equal(result.releaseAll, true);
  assert.equal(result.resyncRequired, true);
  const after = protocol.status();
  assert.equal(before.highestReceived, 2);
  assert.equal(after.highestReceived, 2);
  assert.equal(after.highestProcessedAck, 0);
  assert.equal(after.queueDepth, 0);
  assert.deepEqual(after.projectedButtons, []);
});

test('queue overflow compaction cannot exceed projected button cap', () => {
  const protocol = createInputProtocol({
    limits: { maxButtons: 2, maxQueueDepth: 1 }
  });
  protocol.connect({ nowMs: 0, connectionId: cid(41) });
  protocol.enqueue(snapshot(cid(41), 1, ['A']), { nowMs: 1 });
  const compacted = protocol.enqueue(delta(cid(41), 2, ['B'], []), { nowMs: 2 });
  assert.equal(compacted.compacted, true);
  assert.deepEqual(protocol.status().projectedButtons, ['A', 'B']);
  const rejected = protocol.enqueue(delta(cid(41), 3, ['C'], []), { nowMs: 3 });
  assert.equal(rejected.reasonCode, 'button_state_capacity_exceeded');
  assert.equal(protocol.status().highestReceived, 2);
});

test('rate limiting returns release all and resync', () => {
  const protocol = createInputProtocol({ limits: { maxEventsPerSecond: 1 } });
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  protocol.enqueue(snapshot(cid(3), 1, ['A']), { nowMs: 1 });
  const result = protocol.enqueue(delta(cid(3), 2, ['B'], []), { nowMs: 2 });
  assert.equal(result.reasonCode, 'rate_limited');
  assert.equal(result.releaseAll, true);
  assert.equal(result.resyncRequired, true);
});

test('strict keys and unserializable payloads reject safely', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 0, connectionId: cid(3) });
  assert.equal(protocol.enqueue({
    ...snapshot(cid(3), 1, []),
    extra: true
  }, { nowMs: 1 }).reasonCode, 'invalid_message_keys');
  const circular = snapshot(cid(3), 1, []);
  circular.self = circular;
  assert.equal(protocol.enqueue(circular, { nowMs: 2 }).reasonCode, 'unserializable_payload');
  assert.equal(protocol.enqueue({
    ...snapshot(cid(3), 1, []),
    extra: 1n
  }, { nowMs: 3 }).reasonCode, 'unserializable_payload');
});

test('security caps cannot be raised', () => {
  for (const [key, value] of Object.entries(HARD_CAPS)) {
    assert.throws(() => createInputProtocol({
      limits: { [key]: value + 1 }
    }), /security cap/);
  }
});

test('time rollback and sequence replay fail', () => {
  const protocol = createInputProtocol();
  protocol.connect({ nowMs: 5, connectionId: cid(3) });
  assert.equal(
    protocol.enqueue(snapshot(cid(3), 1, []), { nowMs: 4 }).reasonCode,
    'invalid_time'
  );
  assert.equal(protocol.enqueue(snapshot(cid(3), 1, []), { nowMs: 6 }).ok, true);
  assert.equal(
    protocol.enqueue(snapshot(cid(3), 1, []), { nowMs: 7 }).reasonCode,
    'sequence_replay'
  );
});

test('connection epoch capacity is bounded after disconnect and stale epoch still fails', () => {
  const protocol = createInputProtocol({ limits: { maxConnections: 1 } });
  protocol.connect({ nowMs: 0, connectionId: cid(10) });
  protocol.disconnect({ nowMs: 1 });
  const result = protocol.connect({ nowMs: 2, connectionId: cid(11) });
  assert.equal(result.reasonCode, 'connection_capacity_exhausted');
  assert.equal(result.releaseAll, true);
  const stale = protocol.enqueue(snapshot(cid(10), 1, ['A']), { nowMs: 3 });
  assert.equal(stale.reasonCode, 'not_connected');
  assert.equal(stale.releaseAll, true);
});

test('maxConnections one rejects a direct second connect without exceeding retention', () => {
  const protocol = createInputProtocol({ limits: { maxConnections: 1 } });
  assert.equal(protocol.connect({ nowMs: 0, connectionId: cid(50) }).ok, true);
  const rejected = protocol.connect({ nowMs: 1, connectionId: cid(51) });
  assert.equal(rejected.reasonCode, 'connection_capacity_exhausted');
  assert.equal(rejected.releaseAll, true);
  assert.equal(protocol.status().retainedConnectionCount, 1);
  assert.equal(protocol.enqueue(snapshot(cid(50), 1, []), { nowMs: 2 }).ok, true);
});

test('same-timestamp messages do not reset the rate window', () => {
  const protocol = createInputProtocol({ limits: { maxEventsPerSecond: 1 } });
  protocol.connect({ nowMs: 0, connectionId: cid(60) });
  assert.equal(protocol.enqueue(snapshot(cid(60), 1, []), { nowMs: 0 }).ok, true);
  const result = protocol.enqueue(snapshot(cid(60), 2, []), { nowMs: 0 });
  assert.equal(result.reasonCode, 'rate_limited');
  assert.equal(result.releaseAll, true);
});

test('empty deltas reject and empty snapshots consume rate budget', () => {
  const protocol = createInputProtocol({ limits: { maxEventsPerSecond: 2 } });
  protocol.connect({ nowMs: 0, connectionId: cid(20) });
  assert.equal(
    protocol.enqueue(delta(cid(20), 1, [], []), { nowMs: 1 }).reasonCode,
    'invalid_events'
  );
  assert.equal(protocol.enqueue(snapshot(cid(20), 1, []), { nowMs: 2 }).ok, true);
  assert.equal(protocol.enqueue(snapshot(cid(20), 2, []), { nowMs: 3 }).ok, true);
  const result = protocol.enqueue(snapshot(cid(20), 3, []), { nowMs: 4 });
  assert.equal(result.reasonCode, 'rate_limited');
  assert.equal(result.releaseAll, true);
});

console.log(`play-session-input-protocol: ${passed} tests passed`);
