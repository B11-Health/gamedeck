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

const impact = new Uint8Array(128).fill(15);
for (let index = 1; index < 12; index += 1) impact[index] = 220;
const impactAnalysis = analyzeFrequencyData(impact, quietAnalysis.state, 1200);
assert.ok(impactAnalysis.effect, 'A strong low-frequency transient must produce a haptic effect.');
assert.ok(impactAnalysis.effect.weakMagnitude > impactAnalysis.effect.strongMagnitude);
assert.ok(impactAnalysis.effect.weakMagnitude <= 0.34);
assert.ok(impactAnalysis.effect.strongMagnitude <= 0.14);
const cooled = analyzeFrequencyData(impact, impactAnalysis.state, 1240);
assert.equal(cooled.effect, null, 'Cooldown must prevent vibration chatter.');
const sustained = analyzeFrequencyData(impact, impactAnalysis.state, 1450);
assert.equal(sustained.effect, null, 'Sustained bass without a fresh transient must not become continuous buzzing.');
assert.equal(sustained.state.gateOpen, false);
const released = analyzeFrequencyData(quiet, sustained.state, 1750);
assert.equal(released.effect, null);
assert.equal(released.state.gateOpen, true, 'A quiet interval must re-arm the impact gate.');
const secondImpact = analyzeFrequencyData(impact, released.state, 2050);
assert.ok(secondImpact.effect, 'A fresh onset after release must produce another effect.');

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
assert.ok(loadingEffects[0].effect.weakMagnitude <= 0.14);
await timeouts[0].fn();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(loadingEffects.length, 2);
assert.ok(loadingEffects[1].effect.weakMagnitude < loadingEffects[0].effect.weakMagnitude);
loadingController.stopAll();
assert.equal(loadingController.getStatus().mode, 'idle');
assert.equal(intervals[0].cleared, true);

let frequencyFrame = impact;
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
assert.equal(reactiveIntervals[0].ms, 86);
frequencyFrame = quiet;
reactiveIntervals[0].fn();
clock += 150;
frequencyFrame = impact;
reactiveIntervals[0].fn();
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(reactiveEffects.length >= 1, 'Adaptive analysis must drive a rumble effect after a transient.');
assert.ok(reactiveController.getStatus().level > 0);
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

console.log('GameDeck adaptive haptics: 57 scenarios passed');
