import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PHASE_TRANSITIONS,
  buildCapabilityFailure,
  buildCapabilityResult,
  buildStatusFailure,
  canTransition,
  createPlaySessionManager,
  isTrustedMainFrameCaller,
  publicRedact,
  rankSourceCandidates,
  resolveCapabilitiesSafely,
  validateCapabilityFileArgument
} = require('../play-session-manager.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const managed = {
  system: { id: 'snes', name: 'Super Nintendo' },
  engine: {
    kind: 'libretro',
    label: 'RetroArch · Super Nintendo',
    managed: true,
    available: true,
    coreAvailable: true,
    configAvailable: true
  },
  dependencies: { firmwareReady: true, ready: true },
  platform: 'win32',
  certification: 'verified'
};

test('all declared legal transitions are accepted', () => {
  for (const [from, targets] of Object.entries(PHASE_TRANSITIONS)) {
    for (const to of targets) assert.equal(canTransition(from, to), true, `${from} -> ${to}`);
  }
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransition('idle', 'playing'), false);
  assert.equal(canTransition('playing', 'resolving'), false);
  assert.equal(canTransition('ended', 'playing'), false);
  assert.equal(canTransition('unknown', 'idle'), false);
});

test('managed RetroArch is available for verified embedded play', () => {
  const result = buildCapabilityResult(managed);
  assert.equal(result.classification, 'embedded_verified');
  assert.equal(result.eligible, true);
  assert.equal(result.engine.managed, true);
  assert.equal(result.media.systemAudio, false);
  assert.equal(result.media.nativeEngineAudio, true);
  assert.equal(result.implementation.availableNow, true);
  assert.equal(result.presentation.popOut, true);
  assert.equal(result.lifecycle.processOwned, true);
});

test('managed OpenBOR is available for embedded play', () => {
  const result = buildCapabilityResult({
    ...managed,
    system: { id: 'openbor', name: 'OpenBOR' },
    engine: { kind: 'openbor', label: 'OpenBOR', managed: true, available: true },
    certification: 'verified'
  });
  assert.equal(result.classification, 'embedded_verified');
  assert.equal(result.eligible, true);
  assert.deepEqual(result.presentation, { embedded: true, fullscreen: true, popOut: true });
  assert.equal(result.fallback.mode, 'popout');
});

test('managed uncertified RetroArch is experimental', () => {
  const result = buildCapabilityResult({ ...managed, certification: 'experimental' });
  assert.equal(result.classification, 'embedded_experimental');
  assert.equal(result.eligible, true);
});

test('user RetroArch remains integrated external', () => {
  const result = buildCapabilityResult({
    ...managed,
    engine: { ...managed.engine, managed: false }
  });
  assert.equal(result.classification, 'integrated_external');
  assert.equal(result.eligible, false);
  assert.equal(result.fallback.reasonCode, 'unmanaged_retroarch');
});

test('capture-eligible standalone engines use the same GameDeck player contract', () => {
  for (const kind of ['mame', 'standalone']) {
    const result = buildCapabilityResult({
      ...managed,
      engine: { kind, label: kind === 'mame' ? 'MAME standalone' : 'Standalone emulator', managed: false, captureEligible: true, available: true }
    });
    assert.equal(result.classification, 'embedded_verified');
    assert.equal(result.eligible, true);
    assert.equal(result.presentation.embedded, true);
    assert.equal(result.media.systemAudio, false);
    assert.equal(result.media.nativeEngineAudio, true);
  }
});

test('unmanaged engines without capture eligibility remain external', () => {
  for (const kind of ['mame', 'standalone']) {
    const result = buildCapabilityResult({
      ...managed,
      engine: { kind, label: 'External engine', managed: false, captureEligible: false, available: true }
    });
    assert.equal(result.classification, 'integrated_external');
    assert.equal(result.eligible, false);
  }
});

test('missing engine, core, firmware, and dependencies are blocked truthfully', () => {
  assert.equal(buildCapabilityResult({ ...managed, engine: { ...managed.engine, available: false } }).fallback.reasonCode, 'engine_unavailable');
  assert.equal(buildCapabilityResult({ ...managed, engine: { ...managed.engine, coreAvailable: false } }).fallback.reasonCode, 'core_unavailable');
  assert.equal(buildCapabilityResult({ ...managed, dependencies: { firmwareReady: false, ready: true } }).fallback.reasonCode, 'firmware_required');
  assert.equal(buildCapabilityResult({ ...managed, dependencies: { firmwareReady: true, ready: false } }).fallback.reasonCode, 'dependencies_required');
});

test('Wayland is a Phase-1 external fallback', () => {
  const result = buildCapabilityResult({ ...managed, platform: 'linux', wayland: true });
  assert.equal(result.classification, 'external_only');
  assert.equal(result.fallback.reasonCode, 'wayland_phase1_external');
  assert.equal(result.eligible, false);
});

test('manager accepts legal transitions and rejects stale or illegal operations', () => {
  let now = 100;
  const manager = createPlaySessionManager({
    now: () => ++now,
    createSessionId: () => 'session-1',
    resolveCapabilityInput: () => managed
  });
  const started = manager.start({ title: 'Game', systemId: 'snes', executable: 'C:\\secret\\retroarch.exe' });
  assert.equal(started.ok, true);
  assert.equal(started.status.phase, 'resolving');
  assert.equal('executable' in started.status, false);
  assert.equal(manager.transition('wrong-session', 'preparing').error, 'stale_session');
  assert.equal(manager.transition('session-1', 'playing').error, 'illegal_transition');
  assert.equal(manager.transition('session-1', 'preparing').ok, true);
});

test('stop is idempotent and stale session IDs cannot stop an active session', () => {
  const manager = createPlaySessionManager({
    now: (() => { let value = 200; return () => ++value; })(),
    createSessionId: () => 'session-2',
    resolveCapabilityInput: () => managed
  });
  manager.start({ title: 'Game' });
  assert.equal(manager.stop('old-session').error, 'stale_session');
  const stopped = manager.stop('session-2', 'test');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status.phase, 'ended');
  const second = manager.stop('session-2', 'again');
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
});

test('caller-provided stable marker alone remains ambiguous', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Game', type: 'window', stable: true }
  ], {
    beforeSourceIds: [],
    gameTitle: 'Game',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, false);
  assert.equal(ranked.automaticSourceId, '');
  assert.equal(ranked.ambiguous, true);
});

test('legacy stableSourceIds marker is ignored', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Game', type: 'window' }
  ], {
    beforeSourceIds: [],
    stableSourceIds: ['window:2:0'],
    gameTitle: 'Game',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, false);
  assert.equal(ranked.automaticSourceId, '');
});

test('source present in current and previous poll but absent pre-launch is selectable', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:1:0', name: 'GameDeck', type: 'window' },
    { id: 'window:2:0', name: 'RetroArch - Chrono Trigger', type: 'window' }
  ], {
    beforeSourceIds: ['window:1:0'],
    previousSourceIds: ['window:1:0', 'window:2:0'],
    gameDeckSourceId: 'window:1:0',
    gameTitle: 'Chrono Trigger',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, true);
  assert.equal(ranked.candidates[0].isNew, true);
  assert.equal(ranked.automaticSourceId, 'window:2:0');
  assert.equal(ranked.ambiguous, false);
  assert.equal(ranked.excluded.some(item => item.id === 'window:1:0'), true);
});

test('previous discovery snapshot objects prove two-poll stability', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Game', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSources: [{ id: 'window:2:0', name: 'RetroArch starting', type: 'window' }],
    gameTitle: 'Game',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, true);
  assert.equal(ranked.automaticSourceId, 'window:2:0');
});

test('ambiguous stable candidates require manual selection', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch', type: 'window' },
    { id: 'window:3:0', name: 'RetroArch', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSourceIds: ['window:2:0', 'window:3:0'],
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.automaticSourceId, '');
  assert.equal(ranked.ambiguous, true);
});

test('screen sources are excluded from automatic discovery', () => {
  const ranked = rankSourceCandidates([
    { id: 'screen:0:0', name: 'Entire Screen', type: 'screen' }
  ], { previousSourceIds: ['screen:0:0'] });
  assert.equal(ranked.candidates.length, 0);
  assert.equal(ranked.excluded[0].reasons.includes('not_window'), true);
});

test('unstable clear score leader remains ambiguous without previous-poll presence', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Chrono Trigger', type: 'window', stable: true },
    { id: 'window:3:0', name: 'Other Window', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSourceIds: ['window:3:0'],
    gameTitle: 'Chrono Trigger',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].id, 'window:2:0');
  assert.equal(ranked.candidates[0].stable, false);
  assert.equal(ranked.automaticSourceId, '');
});

test('stable clear score leader requires current and previous-poll presence', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Chrono Trigger', type: 'window' },
    { id: 'window:3:0', name: 'Other Window', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSourceIds: ['window:2:0', 'window:3:0'],
    gameTitle: 'Chrono Trigger',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, true);
  assert.equal(ranked.automaticSourceId, 'window:2:0');
});

test('source present before launch is not selectable even when stable', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Game', type: 'window' }
  ], {
    beforeSourceIds: ['window:2:0'],
    previousSourceIds: ['window:2:0'],
    gameTitle: 'Game',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, true);
  assert.equal(ranked.candidates[0].isNew, false);
  assert.equal(ranked.automaticSourceId, '');
});

test('disappeared previous-poll source cannot auto-select', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:3:0', name: 'Other Window', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSourceIds: ['window:2:0'],
    gameTitle: 'Chrono Trigger',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates.some(item => item.id === 'window:2:0'), false);
  assert.equal(ranked.automaticSourceId, '');
});

test('one-poll source cannot auto-select', () => {
  const ranked = rankSourceCandidates([
    { id: 'window:2:0', name: 'RetroArch - Game', type: 'window' }
  ], {
    beforeSourceIds: [],
    previousSourceIds: [],
    gameTitle: 'Game',
    engineLabel: 'RetroArch'
  });
  assert.equal(ranked.candidates[0].stable, false);
  assert.equal(ranked.automaticSourceId, '');
});

test('nested public messages redact Unix and Windows absolute paths', () => {
  const value = publicRedact({
    status: {
      message: 'Linux /home/alice/roms/game.sfc macOS /Users/alice/Games/game.sfc Windows C:\\Users\\alice\\Games\\game.sfc',
      nested: { message: 'Library at /Users/bob/Library/Application Support/GameDeck and temp /home/bob/tmp/file.log' }
    }
  });
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('/home/'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('C:\\Users'), false);
  assert.match(serialized, /\[redacted path\]/);
});



test('status uses an explicit allowlisted scalar DTO', () => {
  const manager = createPlaySessionManager({
    now: () => 500,
    createSessionId: () => 'safe-session',
    resolveCapabilityInput: () => managed
  });
  manager.start({
    title: 'Game',
    systemId: 'snes',
    classification: 'embedded_experimental',
    internal: { token: 'secret' },
    executable: 'C:\\Users\\alice\\retroarch.exe',
    corePath: '/home/alice/cores/core.dll',
    contentFile: '/Users/alice/Games/game.sfc'
  });
  manager.state.sourceId = 'window:99:0';
  manager.state.pid = 9999;
  manager.state.process = { secret: true };
  manager.state.token = 'top-secret';
  manager.state.extra = 'must-not-appear';
  const status = manager.status();
  assert.deepEqual(Object.keys(status), [
    'version', 'active', 'phase', 'sessionId', 'title', 'systemId',
    'classification', 'startedAt', 'updatedAt', 'endedAt', 'endReason', 'error'
  ]);
  const serialized = JSON.stringify(status);
  for (const forbidden of ['executable', 'corePath', 'contentFile', 'sourceId', 'pid', 'process', 'token', 'internal', 'extra', 'retroarch.exe', '/home/', '/Users/']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('trusted main-frame caller requires exact sender and main frame', () => {
  const mainFrame = {};
  const contents = { mainFrame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.equal(isTrustedMainFrameCaller({ sender: contents, senderFrame: mainFrame }, window), true);
  assert.equal(isTrustedMainFrameCaller({ sender: {}, senderFrame: mainFrame }, window), false);
  assert.equal(isTrustedMainFrameCaller({ sender: contents, senderFrame: {} }, window), false);
  assert.equal(isTrustedMainFrameCaller(null, window), false);
  assert.equal(isTrustedMainFrameCaller({ sender: contents, senderFrame: mainFrame }, { ...window, isDestroyed: () => true }), false);
});

test('capability argument validation rejects non-string oversized empty and NUL payloads', () => {
  for (const value of [null, {}, [], 42, '', 'x'.repeat(4097), 'bad\0path']) {
    assert.deepEqual(validateCapabilityFileArgument(value), { ok: false, reasonCode: 'invalid_file_argument' });
  }
  assert.deepEqual(validateCapabilityFileArgument('C:\\Games\\game.sfc'), { ok: true, file: 'C:\\Games\\game.sfc' });
});

test('safe capability failure never exposes thrown paths or implementation details', () => {
  const manager = createPlaySessionManager({
    resolveCapabilityInput: () => {
      throw new Error('Failed C:\\Users\\alice\\game.sfc and /home/alice/game.sfc');
    }
  });
  const result = resolveCapabilitiesSafely(manager, 'game');
  assert.deepEqual(result, buildCapabilityFailure('capability_resolution_failed'));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('C:\\Users'), false);
  assert.equal(serialized.includes('/home/'), false);
  assert.equal(serialized.includes('Failed'), false);
  assert.equal(result.fallback.reasonCode, 'capability_resolution_failed');
});

test('fixed untrusted caller failures are path-free and stable', () => {
  const capability = buildCapabilityFailure('untrusted_caller');
  const status = buildStatusFailure('untrusted_caller');
  assert.equal(capability.fallback.reasonCode, 'untrusted_caller');
  assert.deepEqual(status, {
    ok: false,
    blocked: true,
    reasonCode: 'untrusted_caller',
    playerMessage: 'Play Session status is unavailable from this page.'
  });
});

test('read-only capability and status calls do not invoke future side-effect adapters', () => {
  const calls = { source: 0, spawn: 0, terminate: 0, fullscreen: 0, update: 0 };
  const manager = createPlaySessionManager({
    resolveCapabilityInput: () => managed,
    listCaptureSources: () => { calls.source += 1; },
    spawnProcess: () => { calls.spawn += 1; },
    terminateProcess: () => { calls.terminate += 1; },
    setFullscreen: () => { calls.fullscreen += 1; },
    emitUpdate: () => { calls.update += 1; }
  });
  const capability = manager.capabilities('game');
  const status = manager.status();
  assert.equal(capability.classification, 'embedded_verified');
  assert.equal(status.phase, 'idle');
  assert.deepEqual(calls, { source: 0, spawn: 0, terminate: 0, fullscreen: 0, update: 0 });
});

console.log(`play-session-manager: ${passed} tests passed`);
