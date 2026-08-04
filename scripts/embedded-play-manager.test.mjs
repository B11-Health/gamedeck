import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEmbeddedPlayManager } = require('../embedded-play-manager.js');
const { rankSourceCandidates } = require('../play-session-manager.js');

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  return child;
}

{
  let poll = 0;
  let readinessChecks = 0;
  let child;
  const windowModes = [];
  const updates = [];
  const sourceSnapshots = [
    [{ id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true }],
    [
      { id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true },
      { id: 'window:openbor', name: 'OpenBOR', type: 'window' }
    ],
    [
      { id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true },
      { id: 'window:openbor', name: 'OpenBOR', type: 'window' }
    ]
  ];
  const manager = createEmbeddedPlayManager({
    listSources: async () => sourceSnapshots[Math.min(poll++, sourceSnapshots.length - 1)],
    rankSources: rankSourceCandidates,
    spawnProcess: () => (child = fakeChild()),
    terminateProcess: value => value?.emit('exit', 0, null),
    checkReadiness: async () => ({ ready: ++readinessChecks >= 2 }),
    windowController: {
      prepare: mode => windowModes.push('prepare:' + mode),
      setMode: mode => windowModes.push(mode),
      restore: () => windowModes.push('restore')
    },
    onUpdate: status => updates.push(status),
    wait: async () => {},
    sourcePollMs: 1,
    sourceTimeoutMs: 1000
  });

  const started = await manager.start({
    executable: 'OpenBOR.exe',
    args: ['game.pak'],
    title: 'Golden Axe Legend',
    shortName: 'Golden_Axe_Legend',
    systemId: 'openbor',
    classification: 'embedded_verified',
    engineLabel: 'OpenBOR',
    sourceTerms: ['OpenBOR'],
    readiness: { logFile: 'OpenBorLog.txt', requiredText: 'Game Selected', timeoutMs: 1000, pollMs: 1 }
  }, { mode: 'docked' });
  assert.equal(started.ok, true);
  assert.equal(readinessChecks, 2);
  assert.equal(started.status.phase, 'capture_armed');
  assert.equal(started.status.mode, 'docked');
  assert.equal(started.status.captureReady, true);
  assert.deepEqual(manager.captureSource(started.status.sessionId), { sourceId: 'window:openbor', audio: false });

  const playing = manager.captureStarted(started.status.sessionId);
  assert.equal(playing.ok, true);
  assert.equal(playing.status.phase, 'playing');

  const fullscreen = await manager.setMode(started.status.sessionId, 'fullscreen');
  assert.equal(fullscreen.status.mode, 'fullscreen');
  assert.equal(fullscreen.status.phase, 'playing');

  const popout = await manager.setMode(started.status.sessionId, 'popout');
  assert.equal(popout.status.mode, 'popout');
  assert.equal(popout.status.phase, 'external_playing');
  assert.equal(popout.status.captureReady, false);

  const returned = await manager.setMode(started.status.sessionId, 'docked');
  assert.equal(returned.status.mode, 'docked');
  assert.equal(returned.status.phase, 'capture_armed');
  assert.equal(returned.status.captureReady, true);
  manager.captureStarted(started.status.sessionId);

  const stopped = await manager.stop(started.status.sessionId, 'test_complete');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status.phase, 'ended');
  assert.equal(stopped.status.endReason, 'test_complete');
  assert.ok(windowModes.includes('fullscreen'));
  assert.ok(windowModes.includes('popout'));
  assert.ok(windowModes.filter(value => value === 'restore').length >= 1);
  assert.ok(updates.some(update => update.phase === 'playing'));
}

{
  let poll = 0;
  const updates = [];
  const modes = [];
  const snapshots = [
    [{ id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true }],
    [
      { id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true },
      { id: 'window:openbor', name: 'Golden_Axe_Legend', type: 'window' }
    ],
    [
      { id: 'window:gamedeck', name: 'GameDeck', type: 'window', ownedByGameDeck: true },
      { id: 'window:openbor', name: 'Golden_Axe_Legend', type: 'window' }
    ]
  ];
  const child = fakeChild(4343);
  const manager = createEmbeddedPlayManager({
    listSources: async () => snapshots[Math.min(poll++, snapshots.length - 1)],
    rankSources: rankSourceCandidates,
    spawnProcess: () => child,
    terminateProcess: value => value?.emit('exit', 0, null),
    windowController: {
      prepare: mode => modes.push('prepare:' + mode),
      setMode: mode => modes.push(mode),
      restore: () => modes.push('restore')
    },
    onUpdate: status => updates.push(status),
    wait: async () => {},
    sourcePollMs: 1,
    sourceTimeoutMs: 1000
  });
  const result = await manager.start({
    executable: 'OpenBOR.exe',
    args: [],
    title: 'Golden Axe Legend',
    shortName: 'Golden_Axe_Legend',
    systemId: 'openbor',
    engineLabel: 'OpenBOR',
    sourceTerms: ['Golden_Axe_Legend'],
    sourceTimeoutMs: 45000
  }, { mode: 'popout' });
  assert.equal(result.ok, true);
  assert.equal(result.status.phase, 'external_playing');
  assert.equal(result.status.mode, 'popout');
  assert.equal(result.status.captureReady, false);
  assert.equal(updates.some(update => update.phase === 'capture_armed'), false);
  assert.ok(modes.includes('popout'));
  await manager.stop(result.status.sessionId, 'test_complete');
}

{
  const manager = createEmbeddedPlayManager({
    listSources: async () => [],
    rankSources: rankSourceCandidates,
    spawnProcess: () => fakeChild(),
    terminateProcess: () => {},
    wait: async () => {},
    sourcePollMs: 1,
    sourceTimeoutMs: 1
  });
  const result = await manager.start({ executable: 'engine', args: [], title: 'No Window', sourceTerms: ['engine'] });
  assert.equal(result.ok, false);
  assert.match(result.error, /identify the game window/i);
  assert.equal(result.status.phase, 'failed');
}

console.log('embedded-play-manager: lifecycle tests passed');
