import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  FALLBACK_SYSTEMS,
  NATIVE_RUMBLE_SYSTEMS,
  HAPTIC_PREFERENCES,
  actuatorForPad,
  analyzeFrequencyData,
  createController,
  findHapticPad,
  hapticPolicyForSystem,
  initialAnalysisState,
  normalizePreference,
  pulsePad,
  stopPad
} = require('../src/game-haptics.js');

assert.equal(hapticPolicyForSystem('arcade'), 'adaptive');
assert.equal(hapticPolicyForSystem('openbor'), 'adaptive');
assert.equal(hapticPolicyForSystem('nes'), 'adaptive');
assert.equal(hapticPolicyForSystem('n64'), 'native');
assert.equal(hapticPolicyForSystem('ps2'), 'native');
assert.equal(hapticPolicyForSystem('dreamcast', 'enhance'), 'adaptive');
assert.equal(hapticPolicyForSystem('unknown', 'enhance'), 'adaptive');
assert.equal(hapticPolicyForSystem('arcade', 'off'), 'off');
assert.equal(hapticPolicyForSystem('unknown'), 'off');
assert.equal(normalizePreference('ENHANCE'), 'enhance');
assert.equal(normalizePreference('invalid'), 'auto');
assert.ok(HAPTIC_PREFERENCES.has('off'));
assert.ok(FALLBACK_SYSTEMS.has('gamegear'));
assert.ok(NATIVE_RUMBLE_SYSTEMS.has('dreamcast'));

const effects = [];
const dualPad = {
  id: 'Xbox Wireless Controller',
  vibrationActuator: {
    async playEffect(type, effect) {
      effects.push({ type, effect });
      return 'complete';
    }
  }
};
assert.equal(actuatorForPad(dualPad).type, 'dual-rumble');
assert.equal(findHapticPad(() => [null, dualPad]).pad.id, dualPad.id);
assert.equal(await pulsePad(actuatorForPad(dualPad), { duration: 2000, strongMagnitude: 2, weakMagnitude: 2 }), true);
assert.equal(effects[0].type, 'dual-rumble');
assert.equal(effects[0].effect.duration, 1200);
assert.equal(effects[0].effect.strongMagnitude, 0.55);
assert.equal(effects[0].effect.weakMagnitude, 0.7);

let pulseCall = null;
const pulsePadOnly = { hapticActuators: [{ async pulse(value, duration) { pulseCall = { value, duration }; return true; } }] };
assert.equal(actuatorForPad(pulsePadOnly).type, 'pulse');
assert.equal(await pulsePad(actuatorForPad(pulsePadOnly), { duration: 80, weakMagnitude: 0.3 }), true);
assert.deepEqual(pulseCall, { value: 0.3, duration: 80 });

let resetCalls = 0;
const resetTarget = { type: 'dual-rumble', actuator: { async reset() { resetCalls += 1; } } };
assert.equal(await stopPad(resetTarget), true);
assert.equal(resetCalls, 1);

const quiet = new Uint8Array(128).fill(5);
const quietAnalysis = analyzeFrequencyData(quiet, initialAnalysisState(), 1000);
assert.equal(quietAnalysis.effect, null);
assert.ok(quietAnalysis.level < 0.14);
assert.equal(quietAnalysis.state.initialized, true);

const bassHit = new Uint8Array(128).fill(15);
for (let index = 1; index < 12; index += 1) bassHit[index] = 220;
const bassAnalysis = analyzeFrequencyData(bassHit, quietAnalysis.state, 1200);
assert.equal(bassAnalysis.effect?.kind, 'bass');
assert.ok(bassAnalysis.effect.strongMagnitude > bassAnalysis.effect.weakMagnitude);
assert.ok(bassAnalysis.effect.strongMagnitude <= 0.32);
assert.ok(bassAnalysis.effect.weakMagnitude <= 0.24);
const bassCooldown = analyzeFrequencyData(bassHit, bassAnalysis.state, 1260);
assert.equal(bassCooldown.effect, null, 'Bass cooldown must prevent chatter.');
const rumbleTexture = analyzeFrequencyData(bassHit, bassCooldown.state, 2500);
assert.equal(rumbleTexture.effect?.kind, 'rumble');
assert.ok(rumbleTexture.effect.strongMagnitude <= 0.19);
assert.ok(rumbleTexture.effect.weakMagnitude <= 0.1);

const shotFrame = new Uint8Array(128).fill(12);
for (let index = 10; index < 32; index += 1) shotFrame[index] = 210;
for (let index = 32; index < 70; index += 1) shotFrame[index] = 110;
const shotAnalysis = analyzeFrequencyData(shotFrame, quietAnalysis.state, 1400);
assert.equal(shotAnalysis.effect?.kind, 'shot');
assert.ok(shotAnalysis.effect.weakMagnitude > shotAnalysis.effect.strongMagnitude);
assert.ok(shotAnalysis.effect.duration < 100);
assert.ok(shotAnalysis.effect.weakMagnitude <= 0.42);

const explosionFrame = new Uint8Array(128).fill(80);
for (let index = 1; index < 12; index += 1) explosionFrame[index] = 220;
for (let index = 12; index < 40; index += 1) explosionFrame[index] = 180;
const explosionAnalysis = analyzeFrequencyData(explosionFrame, quietAnalysis.state, 1600);
assert.equal(explosionAnalysis.effect?.kind, 'explosion');
assert.ok(explosionAnalysis.effect.duration >= 105);
assert.ok(explosionAnalysis.effect.strongMagnitude <= 0.44);
assert.ok(explosionAnalysis.effect.weakMagnitude <= 0.5);

const released = analyzeFrequencyData(quiet, explosionAnalysis.state, 2050);
assert.equal(released.effect, null);
const secondShot = analyzeFrequencyData(shotFrame, released.state, 2300);
assert.equal(secondShot.effect?.kind, 'shot', 'A later shot peak must create a fresh short pulse.');

const intervals = [];
const timeouts = [];
const statusEvents = [];
const loadingEffects = [];
const controllerPad = {
  id: 'Xbox Controller',
  vibrationActuator: {
    async playEffect(type, effect) {
      loadingEffects.push({ type, effect });
      return 'complete';
    }
  }
};
const loadingController = createController({
  getGamepads: () => [controllerPad],
  setInterval(fn, ms) { intervals.push({ fn, ms, cleared: false }); return intervals.length; },
  clearInterval(id) { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
  setTimeout(fn, ms) { timeouts.push({ fn, ms, cleared: false }); return timeouts.length; },
  clearTimeout(id) { if (timeouts[id - 1]) timeouts[id - 1].cleared = true; },
  onStatus(status) { statusEvents.push(status); }
});
loadingController.startLoading();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(loadingController.getStatus().mode, 'loading');
assert.equal(intervals[0].ms, 1750);
assert.equal(timeouts[0].ms, 520);
assert.equal(loadingEffects.length, 1);
assert.ok(loadingEffects[0].effect.weakMagnitude <= 0.22);
assert.ok(loadingEffects[0].effect.strongMagnitude >= 0.06);
assert.ok(loadingEffects[0].effect.strongMagnitude >= 0.06);
await timeouts[0].fn();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(loadingEffects.length, 2);
assert.ok(loadingEffects[1].effect.weakMagnitude < loadingEffects[0].effect.weakMagnitude);
loadingController.stopAll();
assert.equal(loadingController.getStatus().mode, 'idle');
assert.equal(intervals[0].cleared, true);

let frequencyFrame = bassHit;
class FakeAnalyser {
  constructor() {
    this.frequencyBinCount = 128;
  }
  connect() {}
  disconnect() {}
  getByteFrequencyData(target) { target.set(frequencyFrame); }
}
class FakeAudioContext {
  constructor() { this.analyser = new FakeAnalyser(); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() { return this.analyser; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
const reactiveIntervals = [];
const reactiveEffects = [];
let clock = 5000;
const reactiveController = createController({
  getGamepads: () => [{
    id: 'Test Pad',
    vibrationActuator: {
      async playEffect(type, effect) { reactiveEffects.push({ type, effect }); return 'complete'; }
    }
  }],
  AudioContext: FakeAudioContext,
  now: () => clock,
  setInterval(fn, ms) { reactiveIntervals.push({ fn, ms }); return reactiveIntervals.length; },
  clearInterval() {},
  setTimeout,
  clearTimeout
});
const audioStream = { getAudioTracks: () => [{ readyState: 'live' }] };
reactiveController.startReactive(audioStream, 'arcade');
assert.equal(reactiveController.getStatus().mode, 'adaptive');
assert.equal(reactiveController.getStatus().audioAttached, true);
assert.equal(reactiveController.getStatus().analysisTicks, 0);
assert.equal(reactiveIntervals[0].ms, 86);
frequencyFrame = quiet;
reactiveIntervals[0].fn();
clock += 150;
frequencyFrame = bassHit;
reactiveIntervals[0].fn();
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(reactiveEffects.length >= 1, 'Adaptive analysis must drive a rumble effect after a transient.');
assert.ok(reactiveController.getStatus().level > 0);
assert.ok(reactiveController.getStatus().analysisTicks >= 2);
assert.equal(reactiveController.getStatus().lastEffectAt, clock);
reactiveController.stopAll();

const nativeController = createController({ getGamepads: () => [controllerPad], AudioContext: FakeAudioContext });
nativeController.startReactive(audioStream, 'dreamcast');
assert.equal(nativeController.getStatus().mode, 'native');

const noAudioController = createController({ getGamepads: () => [controllerPad], AudioContext: FakeAudioContext });
noAudioController.startReactive({ getAudioTracks: () => [] }, 'arcade');
assert.equal(noAudioController.getStatus().mode, 'no-audio');

const disabledController = createController({ getGamepads: () => [controllerPad], enabled: false });
disabledController.startLoading();
assert.equal(disabledController.getStatus().mode, 'off');
disabledController.setEnabled(true);
assert.equal(disabledController.getStatus().enabled, true);
assert.equal(disabledController.getStatus().preference, 'auto');
disabledController.setPreference('enhance');
assert.equal(disabledController.getStatus().preference, 'enhance');
assert.equal(disabledController.getStatus().enabled, true);
disabledController.setPreference('off');
assert.equal(disabledController.getStatus().mode, 'off');

console.log('GameDeck adaptive haptics: 75 scenarios passed');
