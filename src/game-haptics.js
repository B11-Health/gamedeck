(function attachGameDeckHaptics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameDeckHaptics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function gameDeckHapticsFactory() {
  'use strict';

  const FALLBACK_SYSTEMS = new Set([
    'arcade', 'mame', 'atari2600', 'nes', 'fds', 'snes', 'satellaview', 'sufami',
    'gb', 'gba', 'nds', 'genesis', 'sega32x', 'mastersystem', 'gamegear', 'segacd',
    'pce', 'psp', 'openbor'
  ]);
  const NATIVE_RUMBLE_SYSTEMS = new Set([
    'n64', 'saturn', 'dreamcast', 'ps1', 'ps2', 'gamecube', 'wii', 'wiiu'
  ]);
  const HAPTIC_PREFERENCES = new Set(['auto', 'enhance', 'off']);

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function normalizePreference(value) {
    const preference = String(value || '').trim().toLowerCase();
    return HAPTIC_PREFERENCES.has(preference) ? preference : 'auto';
  }

  function hapticPolicyForSystem(systemId, preference = 'auto') {
    const selected = normalizePreference(preference);
    if (selected === 'off') return 'off';
    if (selected === 'enhance') return 'adaptive';
    const id = String(systemId || '').trim().toLowerCase();
    if (FALLBACK_SYSTEMS.has(id)) return 'adaptive';
    if (NATIVE_RUMBLE_SYSTEMS.has(id)) return 'native';
    return 'off';
  }

  function connectedPads(getGamepads) {
    try {
      return [...(getGamepads?.() || [])].filter(Boolean);
    } catch {
      return [];
    }
  }

  function actuatorForPad(pad) {
    if (pad?.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
      return { type: 'dual-rumble', actuator: pad.vibrationActuator };
    }
    const pulse = [...(pad?.hapticActuators || [])].find(item => typeof item?.pulse === 'function');
    return pulse ? { type: 'pulse', actuator: pulse } : null;
  }

  function findHapticPad(getGamepads) {
    for (const pad of connectedPads(getGamepads)) {
      const actuator = actuatorForPad(pad);
      if (actuator) return { pad, ...actuator };
    }
    return null;
  }

  async function pulsePad(target, effect = {}) {
    if (!target?.actuator) return false;
    const duration = Math.max(20, Math.min(1200, Math.round(Number(effect.duration) || 80)));
    const strongMagnitude = clamp(effect.strongMagnitude, 0, 0.55);
    const weakMagnitude = clamp(effect.weakMagnitude, 0, 0.7);
    try {
      if (target.type === 'dual-rumble') {
        const result = await target.actuator.playEffect('dual-rumble', {
          duration,
          startDelay: Math.max(0, Math.round(Number(effect.startDelay) || 0)),
          strongMagnitude,
          weakMagnitude
        });
        return result !== 'preempted';
      }
      return Boolean(await target.actuator.pulse(Math.max(strongMagnitude, weakMagnitude), duration));
    } catch {
      return false;
    }
  }

  async function stopPad(target) {
    if (!target?.actuator) return false;
    try {
      if (typeof target.actuator.reset === 'function') {
        await target.actuator.reset();
        return true;
      }
      if (target.type === 'dual-rumble') {
        await target.actuator.playEffect('dual-rumble', { duration: 20, startDelay: 0, strongMagnitude: 0, weakMagnitude: 0 });
        return true;
      }
      await target.actuator.pulse(0, 20);
      return true;
    } catch {
      return false;
    }
  }

  function averageBand(data, start, end) {
    const upper = Math.min(data.length, Math.max(start + 1, end));
    let total = 0;
    let count = 0;
    for (let index = Math.max(0, start); index < upper; index += 1) {
      total += Number(data[index] || 0) / 255;
      count += 1;
    }
    return count ? total / count : 0;
  }

  function initialAnalysisState() {
    return { low: 0, mid: 0, broad: 0, noiseFloor: 0.045, lastPulseAt: -Infinity, gateOpen: true, score: 0 };
  }

  function analyzeFrequencyData(data, previous = initialAnalysisState(), now = 0) {
    const length = Math.max(1, data?.length || 0);
    const lowEnd = Math.max(4, Math.round(length * 0.075));
    const midEnd = Math.max(lowEnd + 2, Math.round(length * 0.24));
    const broadEnd = Math.max(midEnd + 2, Math.round(length * 0.55));
    const low = averageBand(data, 1, lowEnd);
    const mid = averageBand(data, lowEnd, midEnd);
    const broad = averageBand(data, 1, broadEnd);
    const lowRise = Math.max(0, low - Number(previous.low || 0));
    const midRise = Math.max(0, mid - Number(previous.mid || 0));
    const broadRise = Math.max(0, broad - Number(previous.broad || 0));
    const transient = lowRise + (midRise * 0.42) + (broadRise * 0.18);
    const floorTarget = Math.min(0.24, broad);
    const floorRate = floorTarget < Number(previous.noiseFloor || 0.045) ? 0.055 : 0.008;
    const noiseFloor = Number(previous.noiseFloor || 0.045) + ((floorTarget - Number(previous.noiseFloor || 0.045)) * floorRate);
    const bassAboveFloor = Math.max(0, low - Math.max(0.055, noiseFloor * 1.28));
    const score = bassAboveFloor * 1.55 + transient * 1.9 + Math.max(0, broad - 0.52) * 0.18;
    const previousPulseAt = Number.isFinite(Number(previous.lastPulseAt)) ? Number(previous.lastPulseAt) : -Infinity;
    const cooldownReady = Number(now) - previousPulseAt >= 240;
    const released = transient < 0.014 && score < 0.06;
    const gateOpen = previous.gateOpen !== false || released;
    const impact = gateOpen && (
      transient >= 0.042
      || (low >= 0.72 && transient >= 0.018)
      || (broadRise >= 0.055 && low >= 0.36)
    );
    const intensity = clamp(score * 0.72, 0, 0.34);
    const effect = cooldownReady && impact && intensity >= 0.08 ? {
      duration: Math.round(52 + intensity * 130),
      strongMagnitude: clamp(intensity * 0.4, 0.02, 0.14),
      weakMagnitude: clamp(intensity, 0.05, 0.34)
    } : null;
    return {
      state: {
        low,
        mid,
        broad,
        noiseFloor,
        lastPulseAt: effect ? Number(now) : previousPulseAt,
        gateOpen: effect ? false : gateOpen,
        score
      },
      effect,
      level: clamp(intensity / 0.34)
    };
  }

  function createController(options = {}) {
    const getGamepads = options.getGamepads || (() => []);
    const AudioContextCtor = options.AudioContext || null;
    const setIntervalFn = options.setInterval || setInterval;
    const clearIntervalFn = options.clearInterval || clearInterval;
    const setTimeoutFn = options.setTimeout || setTimeout;
    const clearTimeoutFn = options.clearTimeout || clearTimeout;
    const now = options.now || (() => Date.now());
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    let preference = normalizePreference(options.preference ?? (options.enabled === false ? 'off' : 'auto'));
    let enabled = preference !== 'off';
    let loadingTimer = null;
    let loadingExhaleTimer = null;
    let analysisTimer = null;
    let audioContext = null;
    let sourceNode = null;
    let analyser = null;
    let frequencyData = null;
    let analysisState = initialAnalysisState();
    let mode = 'idle';
    let policy = 'off';
    let padName = '';
    let pulses = 0;
    let level = 0;

    function status() {
      return { enabled, preference, mode, policy, padName, pulses, level };
    }

    function publish(nextMode = mode) {
      mode = nextMode;
      onStatus(status());
    }

    function target() {
      const found = findHapticPad(getGamepads);
      padName = String(found?.pad?.id || '');
      return found;
    }

    async function issue(effect) {
      if (!enabled) return false;
      const found = target();
      if (!found) {
        publish('unsupported');
        return false;
      }
      const ok = await pulsePad(found, effect);
      if (ok) pulses += 1;
      onStatus(status());
      return ok;
    }

    function clearLoadingTimers() {
      if (loadingTimer) clearIntervalFn(loadingTimer);
      if (loadingExhaleTimer) clearTimeoutFn(loadingExhaleTimer);
      loadingTimer = null;
      loadingExhaleTimer = null;
    }

    function stopAnalysis() {
      if (analysisTimer) clearIntervalFn(analysisTimer);
      analysisTimer = null;
      try { sourceNode?.disconnect?.(); } catch {}
      try { analyser?.disconnect?.(); } catch {}
      sourceNode = null;
      analyser = null;
      frequencyData = null;
      analysisState = initialAnalysisState();
      level = 0;
      if (audioContext) audioContext.close?.().catch?.(() => {});
      audioContext = null;
    }

    function stopAll(nextMode = 'idle') {
      clearLoadingTimers();
      stopAnalysis();
      void stopPad(findHapticPad(getGamepads));
      publish(nextMode);
    }

    function loadingBreath() {
      if (!enabled) return;
      publish('loading');
      issue({ duration: 360, strongMagnitude: 0.025, weakMagnitude: 0.14 });
      if (loadingExhaleTimer) clearTimeoutFn(loadingExhaleTimer);
      loadingExhaleTimer = setTimeoutFn(() => issue({ duration: 220, strongMagnitude: 0.012, weakMagnitude: 0.075 }), 520);
    }

    function startLoading() {
      stopAnalysis();
      policy = 'off';
      pulses = 0;
      level = 0;
      clearLoadingTimers();
      if (!enabled) return publish('off');
      loadingBreath();
      loadingTimer = setIntervalFn(loadingBreath, 1750);
    }

    function startReactive(stream, systemId, requestedPreference = preference) {
      clearLoadingTimers();
      stopAnalysis();
      preference = normalizePreference(requestedPreference);
      enabled = preference !== 'off';
      policy = hapticPolicyForSystem(systemId, preference);
      if (!enabled) return publish('off');
      if (policy === 'native') return publish('native');
      if (policy !== 'adaptive') return publish('off');
      const found = target();
      if (!found) return publish('unsupported');
      const audioTracks = stream?.getAudioTracks?.() || [];
      if (!audioTracks.length || !AudioContextCtor) return publish('no-audio');
      try {
        audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
        const audioStream = typeof MediaStream === 'function' ? new MediaStream(audioTracks) : stream;
        sourceNode = audioContext.createMediaStreamSource(audioStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        analyser.minDecibels = -82;
        analyser.maxDecibels = -12;
        sourceNode.connect(analyser);
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        audioContext.resume?.().catch?.(() => {});
        publish('adaptive');
        analysisTimer = setIntervalFn(() => {
          if (!enabled || !analyser || !frequencyData) return;
          analyser.getByteFrequencyData(frequencyData);
          const analyzed = analyzeFrequencyData(frequencyData, analysisState, now());
          analysisState = analyzed.state;
          level = analyzed.level;
          if (analyzed.effect) issue(analyzed.effect);
          else onStatus(status());
        }, 86);
      } catch {
        stopAnalysis();
        publish('no-audio');
      }
    }

    function setPreference(value) {
      preference = normalizePreference(value);
      enabled = preference !== 'off';
      if (!enabled) stopAll('off');
      else publish('idle');
      return status();
    }

    function setEnabled(value) {
      return setPreference(value ? 'auto' : 'off');
    }

    return { getStatus: status, setEnabled, setPreference, startLoading, startReactive, stopAll, pulse: issue };
  }

  return {
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
  };
});
