import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCaptureGrantLedger, MAX_GRANT_TTL_MS } = require('../play-session-capture-grant.js');
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };
const sender = {}, frame = {}, source = {};
const base = { sessionId: 's1', sender, frame, source, sourceId: 'window:1:0', sourceType: 'window', media: { video: true, audio: false }, userAction: { marker: 'click-1', atMs: 1000 }, nowMs: 1000, ttlMs: 5000 };

test('requires injected opaque grant IDs', () => {
  assert.throws(() => createCaptureGrantLedger(), /createGrantId/);
  const ids = ['g-opaque-1'];
  const ledger = createCaptureGrantLedger({ createGrantId: () => ids.shift() });
  ledger.beginSession({ sessionId: 's1', sender, frame, atMs: 999 });
  assert.equal(ledger.issueGrant(base).grantId, 'g-opaque-1');
});

test('rejects invalid and duplicate generated IDs', () => {
  const invalid = createCaptureGrantLedger({ createGrantId: () => '' });
  invalid.beginSession({ sessionId: 's1', sender, frame, atMs: 1 });
  assert.equal(invalid.issueGrant({ ...base, nowMs: 2, userAction: { marker: 'a', atMs: 2 } }).reasonCode, 'invalid_or_duplicate_grant_id');
  const duplicate = createCaptureGrantLedger({ createGrantId: () => 'same' });
  duplicate.beginSession({ sessionId: 's1', sender, frame, atMs: 1 });
  assert.equal(duplicate.issueGrant({ ...base, nowMs: 2, userAction: { marker: 'a', atMs: 2 } }).ok, true);
  assert.equal(duplicate.issueGrant({ ...base, nowMs: 3, userAction: { marker: 'b', atMs: 3 } }).reasonCode, 'invalid_or_duplicate_grant_id');
});

test('one-shot consume blocks replay and wrong IDs', () => {
  const ledger = createCaptureGrantLedger({ createGrantId: () => 'g1' });
  ledger.beginSession({ sessionId: 's1', sender, frame, atMs: 1 });
  ledger.issueGrant(base);
  const consume = { ...base, grantId: 'g1', userActionMarker: 'click-1' };
  delete consume.userAction; delete consume.ttlMs;
  assert.equal(ledger.consumeGrant(consume).ok, true);
  assert.equal(ledger.consumeGrant(consume).reasonCode, 'grant_consumed');
  assert.equal(ledger.consumeGrant({ ...consume, grantId: 'wrong' }).reasonCode, 'grant_mismatch');
});

test('old ID cannot consume replacement and marker reuse is blocked', () => {
  const ids = ['old', 'new'];
  const ledger = createCaptureGrantLedger({ createGrantId: () => ids.shift() });
  ledger.beginSession({ sessionId: 's1', sender, frame, atMs: 1 });
  ledger.issueGrant(base);
  assert.equal(ledger.issueGrant({ ...base, nowMs: 1001 }).reasonCode, 'user_action_reused');
  const second = ledger.issueGrant({ ...base, nowMs: 1002, userAction: { marker: 'click-2', atMs: 1002 } });
  assert.equal(second.grantId, 'new');
  const consume = { ...base, grantId: 'old', userActionMarker: 'click-1', nowMs: 1003 };
  delete consume.userAction; delete consume.ttlMs;
  assert.equal(ledger.consumeGrant(consume).reasonCode, 'grant_mismatch');
});

test('scope mismatch expiry revocation and no screen fallback', () => {
  const ledger = createCaptureGrantLedger({ createGrantId: () => 'g1' });
  ledger.beginSession({ sessionId: 's1', sender, frame, atMs: 1 });
  assert.equal(ledger.issueGrant({ ...base, sourceType: 'screen' }).reasonCode, 'invalid_window_source');
  assert.equal(ledger.issueGrant({ ...base, allowScreenFallback: true }).reasonCode, 'screen_fallback_forbidden');
  assert.equal(ledger.issueGrant({ ...base, ttlMs: MAX_GRANT_TTL_MS + 1 }).reasonCode, 'invalid_expiry');
  ledger.issueGrant(base);
  const consume = { ...base, grantId: 'g1', userActionMarker: 'click-1', nowMs: 6000 };
  delete consume.userAction; delete consume.ttlMs;
  assert.equal(ledger.consumeGrant(consume).reasonCode, 'grant_expired');
});

test('public status is redacted', () => {
  const ledger = createCaptureGrantLedger({ createGrantId: () => 'secret-grant' });
  ledger.beginSession({ sessionId: 'secret-session', sender, frame, atMs: 1 });
  ledger.issueGrant(base);
  const serialized = JSON.stringify(ledger.publicStatus({ nowMs: 1000 }));
  for (const secret of ['secret-grant', 'secret-session', 'window:1:0', 'click-1']) assert.equal(serialized.includes(secret), false);
});
console.log(`play-session-capture-grant: ${passed} tests passed`);
