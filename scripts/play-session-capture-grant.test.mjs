import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CAPTURE_HARD_CAPS,
  createCaptureGrantLedger
} = require('../play-session-capture-grant.js');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const sender = {};
const frame = {};
const source = {};
const grantId = value => `GGGGGGGGGGGGGGGGGGGGGG${value}`;
const receiptId = value => `RRRRRRRRRRRRRRRRRRRRRR${value}`;
const authorityId = value => `AAAAAAAAAAAAAAAAAAAAAA${value}`;

function createHarness(options = {}) {
  let grantCounter = 0;
  let receiptCounter = 0;
  let authorityCounter = 0;
  const authorityRecords = new Map();
  const verifySourceAuthority = options.verifySourceAuthority || (request => {
    const expected = authorityRecords.get(request.authorityEvidenceId);
    return Boolean(expected) &&
      request.sessionId === expected.sessionId &&
      request.sessionEpoch === expected.sessionEpoch &&
      request.sender === expected.sender &&
      request.frame === expected.frame &&
      request.source === expected.source &&
      request.sourceId === expected.sourceId &&
      request.sourceKind === expected.sourceKind &&
      request.media.video === true && request.media.audio === false;
  });
  const ledger = createCaptureGrantLedger({
    createGrantId: options.createGrantId || (() => grantId(++grantCounter)),
    createSourceReceiptId: options.createSourceReceiptId || (() => receiptId(++receiptCounter)),
    verifySourceAuthority,
    limits: options.limits
  });
  function authorize(claims, explicitId) {
    const id = explicitId || authorityId(++authorityCounter);
    authorityRecords.set(id, {
      sourceKind: 'window',
      ...claims
    });
    return id;
  }
  return { ledger, authorize };
}

function begin(ledger, sessionId = 's', atMs = 0, sessionSender = sender, sessionFrame = frame) {
  return ledger.beginSession({
    sessionId,
    sender: sessionSender,
    frame: sessionFrame,
    atMs
  });
}

function registerAction(ledger, sessionId, sessionEpoch, marker, atMs, actionSender = sender, actionFrame = frame) {
  return ledger.recordUserAction({
    sessionId,
    sessionEpoch,
    sender: actionSender,
    frame: actionFrame,
    marker,
    atMs
  });
}

function registerSource(harness, sessionId, sessionEpoch, atMs, overrides = {}) {
  const input = {
    sessionId,
    sessionEpoch,
    sender,
    frame,
    source,
    sourceId: 'window:1:0',
    media: { video: true, audio: false },
    atMs,
    ...overrides.input
  };
  const claims = {
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    sender: input.sender,
    frame: input.frame,
    source: input.source,
    sourceId: input.sourceId,
    ...overrides.authorityClaims
  };
  const evidence = overrides.authorityEvidenceId || harness.authorize(claims);
  input.authorityEvidenceId = evidence;
  return harness.ledger.registerTrustedSource(input);
}

function issueInput(sessionId, sessionEpoch, marker, sourceReceiptId, nowMs, ttlMs = 5000) {
  return {
    sessionId,
    sessionEpoch,
    sender,
    frame,
    sourceReceiptId,
    userActionMarker: marker,
    nowMs,
    ttlMs
  };
}

function consumeInput(sessionId, sessionEpoch, marker, sourceReceiptId, id, nowMs) {
  return {
    grantId: id,
    sessionId,
    sessionEpoch,
    sender,
    frame,
    sourceReceiptId,
    userActionMarker: marker,
    nowMs
  };
}

test('unregistered and caller-forged action timestamps fail', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const registered = registerSource(harness, 's', session.sessionEpoch, 1);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'caller-forged', registered.sourceReceiptId, 2)
  ).reasonCode, 'unregistered_user_action');
  assert.equal(harness.ledger.issueGrant({
    ...issueInput('s', session.sessionEpoch, 'caller-forged', registered.sourceReceiptId, 3),
    userAction: { marker: 'caller-forged', atMs: 0 }
  }).reasonCode, 'untrusted_user_action_timestamp');
});

test('trusted action registration is scope bound and single use', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const registered = registerSource(harness, 's', session.sessionEpoch, 1);
  assert.equal(registerAction(
    harness.ledger, 's', session.sessionEpoch, 'a', 2, {}
  ).reasonCode, 'session_scope_mismatch');
  assert.equal(registerAction(harness.ledger, 's', session.sessionEpoch, 'a', 3).ok, true);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'a', registered.sourceReceiptId, 4)
  ).ok, true);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'a', registered.sourceReceiptId, 5)
  ).reasonCode, 'source_receipt_reused');
});

test('grant IDs remain one-shot and replacement bound', () => {
  const ids = [grantId('old'), grantId('new')];
  const harness = createHarness({ createGrantId: () => ids.shift() });
  const session = begin(harness.ledger);
  const firstSource = registerSource(harness, 's', session.sessionEpoch, 1);
  registerAction(harness.ledger, 's', session.sessionEpoch, 'a', 2);
  const first = harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'a', firstSource.sourceReceiptId, 3)
  );
  const secondSource = registerSource(harness, 's', session.sessionEpoch, 4, {
    input: { source: {}, sourceId: 'window:2:0' }
  });
  assert.equal(secondSource.ok, true, secondSource.reasonCode);
  registerAction(harness.ledger, 's', session.sessionEpoch, 'b', 5);
  const second = harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'b', secondSource.sourceReceiptId, 6)
  );
  assert.equal(second.ok, true, second.reasonCode);
  assert.equal(harness.ledger.consumeGrant(
    consumeInput('s', session.sessionEpoch, 'a', firstSource.sourceReceiptId, first.grantId, 7)
  ).reasonCode, 'grant_mismatch');
});

test('all capture hard caps reject overrides', () => {
  for (const [key, value] of Object.entries(CAPTURE_HARD_CAPS)) {
    assert.throws(() => createHarness({ limits: { [key]: value + 1 } }), /security cap/);
  }
});

test('action and grant capacities fail closed and reset per session', () => {
  let counter = 0;
  const harness = createHarness({
    createGrantId: () => grantId(++counter),
    limits: { maxGrantIds: 1, maxActionsPerSession: 2 }
  });
  let session = begin(harness.ledger, 's1', 0);
  const firstSource = registerSource(harness, 's1', session.sessionEpoch, 1);
  registerAction(harness.ledger, 's1', session.sessionEpoch, 'a', 2);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s1', session.sessionEpoch, 'a', firstSource.sourceReceiptId, 3)
  ).ok, true);
  const secondSource = registerSource(harness, 's1', session.sessionEpoch, 4, {
    input: { source: {}, sourceId: 'window:2:0' }
  });
  registerAction(harness.ledger, 's1', session.sessionEpoch, 'b', 5);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s1', session.sessionEpoch, 'b', secondSource.sourceReceiptId, 6)
  ).reasonCode, 'grant_id_capacity_exhausted');
  assert.equal(registerAction(
    harness.ledger, 's1', session.sessionEpoch, 'c', 7
  ).reasonCode, 'action_capacity_exhausted');
  const oldEpoch = session.sessionEpoch;
  session = begin(harness.ledger, 's2', 8);
  assert.equal(harness.ledger.publicStatus({ nowMs: 8 }).retention.grantIdsUsed, 0);
  const nextSource = registerSource(harness, 's2', session.sessionEpoch, 9);
  registerAction(harness.ledger, 's2', session.sessionEpoch, 'd', 10);
  const next = harness.ledger.issueGrant(
    issueInput('s2', session.sessionEpoch, 'd', nextSource.sourceReceiptId, 11)
  );
  assert.equal(next.ok, true);
  assert.equal(harness.ledger.consumeGrant(
    consumeInput('s1', oldEpoch, 'a', firstSource.sourceReceiptId, grantId(1), 12)
  ).reasonCode, 'grant_mismatch');
});

test('primitive screen-disguised audio and fallback source attempts reject without poisoning time', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const forged = harness.authorize({
    sessionId: 's',
    sessionEpoch: session.sessionEpoch,
    sender,
    frame,
    source: {},
    sourceId: 'screen:0:0'
  });
  assert.equal(harness.ledger.registerTrustedSource({
    sessionId: 's', sessionEpoch: session.sessionEpoch, sender, frame,
    source: {}, sourceId: 'screen:0:0', authorityEvidenceId: forged,
    media: { video: true, audio: false }, atMs: 100
  }).reasonCode, 'invalid_window_source');
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 1, {
    input: { source: 'window:1:0' }
  }).reasonCode, 'invalid_source_handle');
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 2, {
    input: { media: { video: true, audio: true } }
  }).reasonCode, 'invalid_media_scope');
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 3, {
    input: { allowScreenFallback: true }
  }).reasonCode, 'screen_fallback_forbidden');
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 4).ok, true);
  const retention = harness.ledger.publicStatus({ nowMs: 4 }).retention;
  assert.equal(retention.sourceReceiptsRegistered, 1);
  assert.equal(retention.sourceAuthoritiesUsed, 1);
});

test('authority evidence binds exact session epoch frame source and source ID', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const evidence = harness.authorize({
    sessionId: 's',
    sessionEpoch: session.sessionEpoch,
    sender,
    frame,
    source,
    sourceId: 'window:1:0'
  });
  const base = {
    sessionId: 's', sessionEpoch: session.sessionEpoch, sender, frame,
    source, sourceId: 'window:1:0', authorityEvidenceId: evidence,
    media: { video: true, audio: false }
  };
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, frame: {}, atMs: 100
  }).reasonCode, 'session_scope_mismatch');
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, source: {}, atMs: 101
  }).reasonCode, 'source_authority_rejected');
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, sourceId: 'window:2:0', atMs: 102
  }).reasonCode, 'source_authority_rejected');
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, sessionEpoch: session.sessionEpoch + 1, atMs: 103
  }).reasonCode, 'session_scope_mismatch');
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, sessionId: 'other', atMs: 104
  }).reasonCode, 'session_scope_mismatch');
  assert.equal(harness.ledger.registerTrustedSource({
    ...base, atMs: 1
  }).ok, true);
});

test('source receipt substitution across session epoch and frame rejects without consumption', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const registered = registerSource(harness, 's', session.sessionEpoch, 1);
  registerAction(harness.ledger, 's', session.sessionEpoch, 'a', 2);
  const base = issueInput('s', session.sessionEpoch, 'a', registered.sourceReceiptId, 3);
  assert.equal(harness.ledger.issueGrant({ ...base, sessionId: 'other' }).reasonCode,
    'session_scope_mismatch');
  assert.equal(harness.ledger.issueGrant({ ...base, sessionEpoch: session.sessionEpoch + 1 }).reasonCode,
    'session_scope_mismatch');
  assert.equal(harness.ledger.issueGrant({ ...base, frame: {} }).reasonCode,
    'session_scope_mismatch');
  assert.equal(harness.ledger.issueGrant(base).ok, true);
});

test('source authority and receipt replay are rejected without consuming pending action', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const evidence = harness.authorize({
    sessionId: 's', sessionEpoch: session.sessionEpoch, sender, frame,
    source, sourceId: 'window:1:0'
  });
  const first = registerSource(harness, 's', session.sessionEpoch, 1, {
    authorityEvidenceId: evidence
  });
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 100, {
    authorityEvidenceId: evidence
  }).reasonCode, 'source_authority_reused');
  registerAction(harness.ledger, 's', session.sessionEpoch, 'a', 2);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'a', first.sourceReceiptId, 3)
  ).ok, true);
  registerAction(harness.ledger, 's', session.sessionEpoch, 'b', 4);
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'b', first.sourceReceiptId, 100)
  ).reasonCode, 'source_receipt_reused');
  const second = registerSource(harness, 's', session.sessionEpoch, 5, {
    input: { source: {}, sourceId: 'window:2:0' }
  });
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'b', second.sourceReceiptId, 6)
  ).ok, true);
});

test('caller-labeled source fields and unregistered receipt reject', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  registerAction(harness.ledger, 's', session.sessionEpoch, 'a', 1);
  assert.equal(harness.ledger.issueGrant({
    ...issueInput('s', session.sessionEpoch, 'a', receiptId('fake'), 2),
    source: {}, sourceId: 'window:1:0', sourceType: 'window',
    media: { video: true, audio: false }
  }).reasonCode, 'untrusted_source_claim');
  assert.equal(harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'a', receiptId('fake'), 3)
  ).reasonCode, 'unregistered_source');
});

test('source authority and receipt retention are bounded', () => {
  const harness = createHarness({
    limits: { maxSourceReceiptsPerSession: 1, maxSourceAuthoritiesPerSession: 1 }
  });
  const session = begin(harness.ledger);
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 1).ok, true);
  assert.equal(registerSource(harness, 's', session.sessionEpoch, 2, {
    input: { source: {}, sourceId: 'window:2:0' }
  }).reasonCode, 'source_authority_capacity_exhausted');
  const retention = harness.ledger.publicStatus({ nowMs: 2 }).retention;
  assert.equal(retention.sourceReceiptsRegistered, 1);
  assert.equal(retention.sourceAuthoritiesUsed, 1);
});

test('consume requires exact receipt and redacted status excludes all source evidence', () => {
  const harness = createHarness();
  const session = begin(harness.ledger);
  const registered = registerSource(harness, 's', session.sessionEpoch, 1, {
    input: { sourceId: 'window:secret:0' },
    authorityClaims: { sourceId: 'window:secret:0' }
  });
  registerAction(harness.ledger, 's', session.sessionEpoch, 'secret-action', 2);
  const issued = harness.ledger.issueGrant(
    issueInput('s', session.sessionEpoch, 'secret-action', registered.sourceReceiptId, 3)
  );
  assert.equal(harness.ledger.consumeGrant({
    ...consumeInput('s', session.sessionEpoch, 'secret-action', registered.sourceReceiptId, issued.grantId, 4),
    source: {}
  }).reasonCode, 'untrusted_source_claim');
  assert.equal(harness.ledger.consumeGrant(
    consumeInput('s', session.sessionEpoch, 'secret-action', receiptId('wrong'), issued.grantId, 5)
  ).reasonCode, 'source_scope_mismatch');
  assert.equal(harness.ledger.consumeGrant(
    consumeInput('s', session.sessionEpoch, 'secret-action', registered.sourceReceiptId, issued.grantId, 6)
  ).ok, true);
  const text = JSON.stringify(harness.ledger.publicStatus({ nowMs: 6 }));
  for (const secret of [
    'secret-action', 'window:secret:0', issued.grantId,
    registered.sourceReceiptId, 'sessionEpoch'
  ]) {
    assert.equal(text.includes(secret), false);
  }
});

console.log(`play-session-capture-grant: ${passed} tests passed`);
