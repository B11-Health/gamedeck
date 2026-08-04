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
    return { initialized: false, low: 0, mid: 0, broad: 0, noiseFloor: 0.045, lastPulseAt: -Infinity, gateOpen: true, score: 0, lastKind: '' };
  }

  function analyzeFrequencyData(data, previous = initialAnalysisState(), now = 0) {
    const length = Math.max(1, data?.length || 0);
    const lowEnd = Math.max(4, Math.round(length * 0.075));
    const midEnd = Math.max(lowEnd + 2, Math.round(length * 0.24));
    const broadEnd = Math.max(midEnd + 2, Math.round(length * 0.55));
    const low = averageBand(data, 1, lowEnd);
    const mid = averageBand(data, lowEnd, midEnd);
    const broad = averageBand(data, 1, broadEnd);
    const previousLow = Number(previous.low || 0);
    const previousMid = Number(previous.mid || 0);
    const previousBroad = Number(previous.broad || 0);
    const initialized = previous.initialized !== false;
    const lowRise = initialized ? Math.max(0, low - previousLow) : 0;
    const midRise = initialized ? Math.max(0, mid - previousMid) : 0;
    const broadRise = initialized ? Math.max(0, broad - previousBroad) : 0;
    const spectralFlux = lowRise * 1.45 + midRise * 1.05 + broadRise * 0.55;
    const floorTarget = Math.min(0.26, broad);
    const floorRate = floorTarget < Number(previous.noiseFloor || 0.045) ? 0.065 : 0.009;
    const noiseFloor = Number(previous.noiseFloor || 0.045) + ((floorTarget - Number(previous.noiseFloor || 0.045)) * floorRate);
    const bassAboveFloor = Math.max(0, low - Math.max(0.06, noiseFloor * 1.26));
    const score = bassAboveFloor * 1.35 + spectralFlux * 1.75;
    const previousPulseAt = Number.isFinite(Number(previous.lastPulseAt)) ? Number(previous.lastPulseAt) : -Infinity;
    const sincePulse = Number(now) - previousPulseAt;
    const lowDominance = low / Math.max(0.045, mid);
    const explosivePeak = lowRise >= 0.038
      && broadRise >= 0.036
      && midRise >= 0.026
      && mid >= 0.24
      && broad >= 0.31
      && low >= Math.max(0.22, noiseFloor * 1.32);
    const bassPunch = lowRise >= 0.036
      && low >= Math.max(0.31, noiseFloor * 1.52)
      && lowDominance >= 1.55;
    const shotCrack = midRise >= 0.038
      && broadRise >= 0.022
      && midRise >= lowRise * 0.68
      && mid >= 0.22
      && broad >= Math.max(0.19, noiseFloor * 1.24);
    const rumbleTexture = sincePulse >= 1200
      && low >= Math.max(0.31, noiseFloor * 1.55)
      && lowDominance >= 1.72
      && spectralFlux < 0.04;
    let effect = null;
    if (sincePulse >= 260 && explosivePeak) {
      const strength = clamp((lowRise + broadRise) * 2.4 + bassAboveFloor * 0.65, 0.12, 0.52);
      effect = {
        kind: 'explosion',
        duration: Math.round(100 + strength * 165),
        strongMagnitude: clamp(strength * 0.78, 0.16, 0.44),
        weakMagnitude: clamp(strength * 0.9, 0.18, 0.5)
      };
    } else if (sincePulse >= 400 && bassPunch) {
      const strength = clamp(lowRise * 3.4 + bassAboveFloor * 0.5, 0.1, 0.42);
      effect = {
        kind: 'bass',
        duration: Math.round(68 + strength * 120),
        strongMagnitude: clamp(strength * 0.72, 0.12, 0.32),
        weakMagnitude: clamp(strength * 0.56, 0.09, 0.24)
      };
    } else if (sincePulse >= 140 && shotCrack) {
      const strength = clamp(midRise * 3.2 + broadRise * 1.7, 0.09, 0.46);
      effect = {
        kind: 'shot',
        duration: Math.round(42 + strength * 95),
        strongMagnitude: clamp(strength * 0.24, 0.025, 0.1),
        weakMagnitude: clamp(strength * 0.88, 0.12, 0.42)
      };
    } else if (rumbleTexture) {
      const strength = clamp((low - Math.max(0.2, noiseFloor)) * 0.55, 0.08, 0.24);
      effect = {
        kind: 'rumble',
        duration: Math.round(130 + strength * 210),
        strongMagnitude: clamp(strength * 0.82, 0.07, 0.19),
        weakMagnitude: clamp(strength * 0.42, 0.035, 0.1)
      };
    }
    const level = clamp(Math.max(score * 0.72, effect ? Math.max(effect.strongMagnitude, effect.weakMagnitude) : 0), 0, 0.52);
    return {
      state: {
        initialized: true,
        low,
        mid,
        broad,
        noiseFloor,
        lastPulseAt: effect ? Number(now) : previousPulseAt,
        gateOpen: true,
        score,
        lastKind: effect?.kind || String(previous.lastKind || '')
      },
      effect,
      level: clamp(level / 0.52)
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
    let audioAttached = false;
    let analysisTicks = 0;
    let lastEffectAt = 0;
    let lastKind = '';
    let effectCounts = { shot: 0, bass: 0, explosion: 0, rumble: 0 };

    function status() {
      return { enabled, preference, mode, policy, padName, pulses, level, audioAttached, analysisTicks, lastEffectAt, lastKind, effectCounts: { ...effectCounts }, audioContextState: String(audioContext?.state || '') };
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
      if (ok) {
        pulses += 1;
        const kind = String(effect?.kind || '');
        if (kind && Object.prototype.hasOwnProperty.call(effectCounts, kind)) {
          lastKind = kind;
          effectCounts[kind] += 1;
        }
      }
      onStatus(status());
      return ok;
    }

    function clearLoadingTimers() {
      if (loadingTimer) clearIntervalFn(loadingTimer);
      if (loadingExhaleTimer) clearTimeoutFn(loadingExhaleTimer);
      loadingTimer = null;
      loadingExhaleTimer = null;
    }

    function primeAudio() {
      if (!enabled || !AudioContextCtor) return false;
      try {
        if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
        audioContext.resume?.().catch?.(() => {});
        return true;
      } catch {
        return false;
      }
    }

    function stopAnalysis(closeContext = true) {
      if (analysisTimer) clearIntervalFn(analysisTimer);
      analysisTimer = null;
      try { sourceNode?.disconnect?.(); } catch {}
      try { analyser?.disconnect?.(); } catch {}
      sourceNode = null;
      analyser = null;
      frequencyData = null;
      analysisState = initialAnalysisState();
      level = 0;
      audioAttached = false;
      analysisTicks = 0;
      lastEffectAt = 0;
      lastKind = '';
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
      issue({ duration: 380, strongMagnitude: 0.07, weakMagnitude: 0.22 });
      if (loadingExhaleTimer) clearTimeoutFn(loadingExhaleTimer);
      loadingExhaleTimer = setTimeoutFn(() => issue({ duration: 240, strongMagnitude: 0.035, weakMagnitude: 0.12 }), 520);
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
        analyser.smoothingTimeConstant = 0.46;
        analyser.minDecibels = -82;
        analyser.maxDecibels = -12;
        sourceNode.connect(analyser);
        audioAttached = true;
        analysisTicks = 0;
        lastEffectAt = 0;
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        audioContext.resume?.().catch?.(() => {});
        publish('adaptive');
        analysisTimer = setIntervalFn(() => {
          if (!enabled || !analyser || !frequencyData) return;
          analyser.getByteFrequencyData(frequencyData);
          analysisTicks += 1;
          const tickAt = now();
          const analyzed = analyzeFrequencyData(frequencyData, analysisState, tickAt);
          analysisState = analyzed.state;
          level = analyzed.level;
          if (analyzed.effect) {
            lastEffectAt = tickAt;
            issue(analyzed.effect);
          }
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

    return { getStatus: status, setEnabled, setPreference, primeAudio, startLoading, startReactive, stopAll, pulse: issue };
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
