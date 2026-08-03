'use strict';

const crypto = require('crypto');

const VERSION = 1;
const MAX_CAPABILITY_FILE_LENGTH = 4096;
const PUBLIC_STATUS_FIELDS = Object.freeze([
  'version',
  'active',
  'phase',
  'sessionId',
  'title',
  'systemId',
  'classification',
  'startedAt',
  'updatedAt',
  'endedAt',
  'endReason',
  'error'
]);
const CAPABILITY_FAILURE_COPY = Object.freeze({
  untrusted_caller: Object.freeze({
    playerMessage: 'Play Session compatibility is unavailable from this page.',
    recommendedAction: 'Return to the main GameDeck window and try again.'
  }),
  invalid_file_argument: Object.freeze({
    playerMessage: 'GameDeck could not check Play Session compatibility for that selection.',
    recommendedAction: 'Select a game from the GameDeck library and try again.'
  }),
  capability_resolution_failed: Object.freeze({
    playerMessage: 'GameDeck could not determine Play Session compatibility for this game.',
    recommendedAction: 'Use the existing Play action or check system setup, then try again.'
  })
});
const CLASSIFICATIONS = Object.freeze([
  'embedded_verified',
  'embedded_experimental',
  'integrated_external',
  'external_only',
  'blocked'
]);

const PHASE_TRANSITIONS = Object.freeze({
  idle: Object.freeze(['resolving']),
  resolving: Object.freeze(['preparing', 'external_launching', 'failed', 'stopping']),
  preparing: Object.freeze(['spawning', 'failed', 'stopping']),
  spawning: Object.freeze(['discovering', 'failed', 'stopping']),
  discovering: Object.freeze(['awaiting_source', 'capture_armed', 'failed', 'stopping']),
  awaiting_source: Object.freeze(['capture_armed', 'external_playing', 'failed', 'stopping']),
  capture_armed: Object.freeze(['playing', 'failed', 'stopping']),
  playing: Object.freeze(['failed', 'stopping']),
  external_launching: Object.freeze(['external_playing', 'failed', 'stopping']),
  external_playing: Object.freeze(['failed', 'stopping']),
  failed: Object.freeze(['stopping', 'ended']),
  stopping: Object.freeze(['ended']),
  ended: Object.freeze(['idle'])
});

const SENSITIVE_KEYS = new Set([
  'args',
  'basePort',
  'captureSourceId',
  'child',
  'configFile',
  'contentFile',
  'corePath',
  'env',
  'environment',
  'executable',
  'file',
  'filePath',
  'internal',
  'logFile',
  'pid',
  'process',
  'sessionToken',
  'sourceId',
  'token'
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function redactString(value) {
  return String(value)
    .replace(/[A-Za-z]:[\\/](?:[^\\/\r\n]+[\\/])*[^\\/\r\n]*/g, '[redacted path]')
    .replace(/(^|[\s("'`])\/(?:Users|home|var|tmp|opt|usr|Applications|Library)(?:\/[^\s)"'`]*)?/g, '$1[redacted path]');
}

function publicRedact(value, key = '') {
  if (SENSITIVE_KEYS.has(key)) return undefined;
  if (value === null || key === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => publicRedact(item))
      .filter(item => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const redacted = publicRedact(childValue, childKey);
    if (redacted !== undefined) output[childKey] = redacted;
  }
  return output;
}

function capabilityFallback(reasonCode, playerMessage, recommendedAction, mode = 'external') {
  return { mode, reasonCode, playerMessage, recommendedAction };
}

function buildCapabilityFailure(reasonCode = 'capability_resolution_failed') {
  const safeReasonCode = Object.prototype.hasOwnProperty.call(CAPABILITY_FAILURE_COPY, reasonCode)
    ? reasonCode
    : 'capability_resolution_failed';
  const copy = CAPABILITY_FAILURE_COPY[safeReasonCode];
  return {
    version: VERSION,
    classification: 'blocked',
    availability: 'blocked',
    eligible: false,
    fallback: capabilityFallback(
      safeReasonCode,
      copy.playerMessage,
      copy.recommendedAction,
      'blocked'
    )
  };
}

function buildStatusFailure(reasonCode = 'untrusted_caller') {
  return {
    ok: false,
    blocked: true,
    reasonCode: reasonCode === 'untrusted_caller' ? reasonCode : 'untrusted_caller',
    playerMessage: 'Play Session status is unavailable from this page.'
  };
}

function validateCapabilityFileArgument(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CAPABILITY_FILE_LENGTH || value.includes('\0')) {
    return { ok: false, reasonCode: 'invalid_file_argument' };
  }
  return { ok: true, file: value };
}

function isTrustedMainFrameCaller(event, window) {
  try {
    if (!event || !window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false;
    const contents = window.webContents;
    if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return false;
    return event.sender === contents && event.senderFrame === contents.mainFrame;
  } catch {
    return false;
  }
}

function resolveCapabilitiesSafely(manager, file) {
  try {
    return manager.capabilities(file);
  } catch {
    return buildCapabilityFailure('capability_resolution_failed');
  }
}

function blockedCapability(base, reasonCode, playerMessage, recommendedAction) {
  return {
    ...base,
    classification: 'blocked',
    availability: 'blocked',
    eligible: false,
    presentation: { embedded: false, fullscreen: false, popOut: false },
    media: { windowVideo: false, systemAudio: false, sourceAutoDiscovery: false },
    input: {
      owner: 'none',
      digitalP1: false,
      duplicateInputPrevented: false,
      backgroundRelay: false
    },
    fallback: capabilityFallback(reasonCode, playerMessage, recommendedAction, 'blocked')
  };
}

function buildCapabilityResult(input = {}) {
  const platform = String(input.platform || process.platform || 'unknown');
  const wayland = Boolean(input.wayland);
  const engineKind = String(input.engine?.kind || 'unknown');
  const engineManaged = Boolean(input.engine?.managed);
  const engineAvailable = input.engine?.available !== false;
  const coreAvailable = input.engine?.coreAvailable !== false;
  const configAvailable = input.engine?.configAvailable !== false;
  const firmwareReady = input.dependencies?.firmwareReady !== false;
  const dependenciesReady = input.dependencies?.ready !== false;
  const certification = input.certification === 'verified' ? 'verified' : 'experimental';
  const phase1Enabled = Boolean(input.implementation?.phase1Enabled);

  const base = {
    version: VERSION,
    system: {
      id: String(input.system?.id || 'unknown').slice(0, 64),
      name: String(input.system?.name || 'Unknown system').slice(0, 120)
    },
    engine: {
      kind: engineKind,
      label: String(input.engine?.label || 'Unavailable engine').slice(0, 120),
      managed: engineManaged
    },
    environment: {
      platform,
      wayland
    },
    implementation: {
      phase: phase1Enabled ? 'phase1_preview' : 'phase0a',
      availableNow: phase1Enabled,
      behaviorChanged: phase1Enabled
    },
    lifecycle: {
      processOwned: phase1Enabled,
      cleanStop: phase1Enabled,
      restoreLibraryFocus: phase1Enabled
    }
  };

  if (!engineAvailable) {
    return publicRedact(blockedCapability(
      base,
      'engine_unavailable',
      'A compatible game engine is not installed.',
      'Finish engine setup, then check Play Session compatibility again.'
    ));
  }

  if (engineKind === 'libretro' && !coreAvailable) {
    return publicRedact(blockedCapability(
      base,
      'core_unavailable',
      'The required libretro core is not installed.',
      'Finish managed runtime setup, then check compatibility again.'
    ));
  }

  if (engineKind === 'libretro' && engineManaged && !configAvailable) {
    return publicRedact(blockedCapability(
      base,
      'managed_config_unavailable',
      'The managed RetroArch configuration is incomplete.',
      'Repair or reinstall the managed runtime before embedded play.'
    ));
  }

  if (!firmwareReady) {
    return publicRedact(blockedCapability(
      base,
      'firmware_required',
      'Required system firmware is not ready.',
      'Complete firmware setup before starting this game.'
    ));
  }

  if (!dependenciesReady) {
    return publicRedact(blockedCapability(
      base,
      'dependencies_required',
      'Required game dependencies are not ready.',
      'Finish dependency setup before starting this game.'
    ));
  }

  if (wayland) {
    return publicRedact({
      ...base,
      classification: 'external_only',
      availability: 'external_only',
      eligible: false,
      presentation: { embedded: false, fullscreen: false, popOut: false },
      media: { windowVideo: false, systemAudio: false, sourceAutoDiscovery: false },
      input: {
        owner: 'engine',
        digitalP1: false,
        duplicateInputPrevented: false,
        backgroundRelay: false
      },
      fallback: capabilityFallback(
        'wayland_phase1_external',
        'Phase 1 embedded play is not enabled on Wayland because reliable automatic window discovery is unavailable.',
        'Use the existing external launch path on this desktop session.'
      )
    });
  }

  if (engineKind === 'libretro' && engineManaged) {
    const classification = certification === 'verified' ? 'embedded_verified' : 'embedded_experimental';
    return publicRedact({
      ...base,
      classification,
      availability: phase1Enabled ? 'embedded_available' : 'phase1_candidate',
      eligible: true,
      presentation: { embedded: true, fullscreen: true, popOut: false },
      media: {
        windowVideo: true,
        systemAudio: platform === 'win32',
        sourceAutoDiscovery: true
      },
      input: {
        owner: phase1Enabled ? 'gamedeck' : 'gamedeck_planned',
        digitalP1: true,
        duplicateInputPrevented: phase1Enabled,
        backgroundRelay: phase1Enabled
      },
      fallback: phase1Enabled
        ? capabilityFallback(
          'embedded_capture_fallback',
          'GameDeck will play this managed libretro game inside the app. If exact window capture is unavailable, you can choose the game window or continue externally.',
          'Use the Play Session window chooser or the external fallback.'
        )
        : capabilityFallback(
          'phase0a_external_default',
          'This managed libretro game is eligible for the Phase 1 embedded prototype. Phase 0A keeps current Play behavior external.',
          'Continue using external play until the embedded runtime receives Phase 1 approval.'
        )
    });
  }

  if (engineKind === 'libretro') {
    return publicRedact({
      ...base,
      classification: 'integrated_external',
      availability: 'external',
      eligible: false,
      presentation: { embedded: false, fullscreen: false, popOut: false },
      media: { windowVideo: false, systemAudio: false, sourceAutoDiscovery: false },
      input: {
        owner: 'engine',
        digitalP1: false,
        duplicateInputPrevented: false,
        backgroundRelay: false
      },
      fallback: capabilityFallback(
        'unmanaged_retroarch',
        'This game uses a user-managed RetroArch installation, so GameDeck will launch it externally.',
        'Use the managed GameDeck runtime for future embedded-play eligibility.'
      )
    });
  }

  if (engineKind === 'mame' || engineKind === 'standalone') {
    return publicRedact({
      ...base,
      classification: 'integrated_external',
      availability: 'external',
      eligible: false,
      presentation: { embedded: false, fullscreen: false, popOut: false },
      media: { windowVideo: false, systemAudio: false, sourceAutoDiscovery: false },
      input: {
        owner: 'engine',
        digitalP1: false,
        duplicateInputPrevented: false,
        backgroundRelay: false
      },
      fallback: capabilityFallback(
        engineKind === 'mame' ? 'standalone_mame' : 'standalone_engine',
        'This standalone engine remains an external session in Phase 1.',
        'Launch externally and use the emulator window for play.'
      )
    });
  }

  return publicRedact({
    ...base,
    classification: 'external_only',
    availability: 'external_only',
    eligible: false,
    presentation: { embedded: false, fullscreen: false, popOut: false },
    media: { windowVideo: false, systemAudio: false, sourceAutoDiscovery: false },
    input: {
      owner: 'engine',
      digitalP1: false,
      duplicateInputPrevented: false,
      backgroundRelay: false
    },
    fallback: capabilityFallback(
      'unsupported_engine',
      'This engine is not supported by the managed Play Session prototype.',
      'Use the existing external launch path.'
    )
  });
}

function sourceType(source = {}) {
  const explicit = String(source.type || '').toLowerCase();
  if (explicit === 'window' || explicit === 'screen') return explicit;
  return String(source.id || '').startsWith('screen:') ? 'screen' : 'window';
}

function sourceIdsFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return new Set();
  return new Set(snapshot.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return String(item.id || '');
    return '';
  }).filter(Boolean));
}

function previousPollSourceIds(context = {}) {
  if (Array.isArray(context.previousSourceIds)) return sourceIdsFromSnapshot(context.previousSourceIds);
  return sourceIdsFromSnapshot(context.previousSources);
}

function normalizeSourceCandidate(source = {}, context = {}) {
  const id = String(source.id || '').slice(0, 512);
  const name = String(source.name || '').trim().slice(0, 200);
  const type = sourceType(source);
  const normalizedName = normalizeText(name);
  const beforeSourceIds = sourceIdsFromSnapshot(context.beforeSourceIds);
  const previousSourceIds = previousPollSourceIds(context);
  const gameDeckSourceId = String(context.gameDeckSourceId || '');
  const titleTerms = [
    context.gameTitle,
    context.shortName,
    ...(Array.isArray(context.titleTerms) ? context.titleTerms : [])
  ].map(normalizeText).filter(term => term.length >= 3);
  const engineTerm = normalizeText(context.engineLabel || 'retroarch');
  const isGameDeck = Boolean(
    source.ownedByGameDeck
    || (gameDeckSourceId && id === gameDeckSourceId)
    || normalizedName === 'gamedeck'
  );
  const excluded = !id || type !== 'window' || isGameDeck;
  const isNew = Boolean(id && !beforeSourceIds.has(id));
  const stable = Boolean(id && previousSourceIds.has(id));
  const titleMatch = Boolean(normalizedName && titleTerms.some(term => normalizedName.includes(term)));
  const engineMatch = Boolean(
    normalizedName
    && ((engineTerm && normalizedName.includes(engineTerm)) || normalizedName.includes('retroarch'))
  );

  let score = 0;
  const reasons = [];
  if (isNew) {
    score += 100;
    reasons.push('new_window');
  }
  if (titleMatch) {
    score += 60;
    reasons.push('title_match');
  }
  if (engineMatch) {
    score += 40;
    reasons.push('engine_match');
  }
  if (stable) {
    score += 20;
    reasons.push('stable');
  }
  if (excluded) {
    score -= 1000;
    reasons.push(isGameDeck ? 'gamedeck_owned' : type !== 'window' ? 'not_window' : 'invalid_source');
  }

  return {
    id,
    name,
    type,
    normalizedName,
    isNew,
    stable,
    titleMatch,
    engineMatch,
    excluded,
    score,
    reasons
  };
}

function rankSourceCandidates(sources = [], context = {}) {
  const normalized = (Array.isArray(sources) ? sources : [])
    .map(source => normalizeSourceCandidate(source, context));
  const candidates = normalized
    .filter(candidate => !candidate.excluded)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const newCandidates = candidates.filter(candidate => candidate.isNew);
  const stableNewCandidates = newCandidates.filter(candidate => candidate.stable);
  let automaticSourceId = '';
  let reason = 'ambiguous';

  if (newCandidates.length === 1 && stableNewCandidates.length === 1) {
    automaticSourceId = stableNewCandidates[0].id;
    reason = 'single_new_window';
  } else if (stableNewCandidates.length) {
    const rankedNewCandidates = [...newCandidates]
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const top = rankedNewCandidates[0];
    const runnerUp = rankedNewCandidates[1];
    const gap = runnerUp ? top.score - runnerUp.score : top.score;
    if (top.stable && top.score >= 120 && gap >= 40) {
      automaticSourceId = top.id;
      reason = 'clear_score_lead';
    }
  }

  return {
    candidates,
    excluded: normalized.filter(candidate => candidate.excluded),
    automaticSourceId,
    ambiguous: !automaticSourceId,
    reason
  };
}

function validPhase(phase) {
  return Object.prototype.hasOwnProperty.call(PHASE_TRANSITIONS, phase);
}

function canTransition(from, to) {
  return validPhase(from) && PHASE_TRANSITIONS[from].includes(to);
}

function createSessionId() {
  return `play-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function publicStatusNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function buildPublicStatus(state = {}) {
  const status = {
    version: VERSION,
    active: Boolean(state.active),
    phase: validPhase(state.phase) ? state.phase : 'idle',
    sessionId: redactString(String(state.sessionId || '').slice(0, 160)),
    title: redactString(String(state.title || '').slice(0, 160)),
    systemId: redactString(String(state.systemId || '').slice(0, 64)),
    classification: CLASSIFICATIONS.includes(state.classification) ? state.classification : '',
    startedAt: publicStatusNumber(state.startedAt),
    updatedAt: publicStatusNumber(state.updatedAt),
    endedAt: publicStatusNumber(state.endedAt),
    endReason: redactString(String(state.endReason || '').slice(0, 160)),
    error: redactString(String(state.error || '').slice(0, 400))
  };
  return Object.fromEntries(PUBLIC_STATUS_FIELDS.map(field => [field, status[field]]));
}

function initialState(now) {
  return {
    version: VERSION,
    active: false,
    phase: 'idle',
    sessionId: '',
    title: '',
    systemId: '',
    classification: '',
    startedAt: 0,
    updatedAt: now,
    endedAt: 0,
    endReason: '',
    error: ''
  };
}

class PlaySessionManager {
  constructor(options = {}) {
    const hasCapabilityResolver = typeof options.resolveCapabilityInput === 'function';
    this.integration = Object.freeze({ capabilityResolver: hasCapabilityResolver });
    this.adapters = Object.freeze({
      now: typeof options.now === 'function' ? options.now : Date.now,
      createSessionId: typeof options.createSessionId === 'function' ? options.createSessionId : createSessionId,
      resolveCapabilityInput: typeof options.resolveCapabilityInput === 'function'
        ? options.resolveCapabilityInput
        : () => {
            throw new Error('Play Session capability resolution is unavailable.');
          },
      listCaptureSources: typeof options.listCaptureSources === 'function' ? options.listCaptureSources : null,
      spawnProcess: typeof options.spawnProcess === 'function' ? options.spawnProcess : null,
      terminateProcess: typeof options.terminateProcess === 'function' ? options.terminateProcess : null,
      setFullscreen: typeof options.setFullscreen === 'function' ? options.setFullscreen : null,
      emitUpdate: typeof options.emitUpdate === 'function' ? options.emitUpdate : null
    });
    this.state = initialState(this.adapters.now());
  }

  integrationPoints() {
    return {
      capabilityResolver: this.integration.capabilityResolver,
      sourceDiscovery: Boolean(this.adapters.listCaptureSources),
      processSpawn: Boolean(this.adapters.spawnProcess),
      processTermination: Boolean(this.adapters.terminateProcess),
      fullscreen: Boolean(this.adapters.setFullscreen),
      updates: Boolean(this.adapters.emitUpdate)
    };
  }

  capabilities(file) {
    return buildCapabilityResult(this.adapters.resolveCapabilityInput(file));
  }

  status() {
    return buildPublicStatus(this.state);
  }

  start(seed = {}) {
    if (this.state.phase !== 'idle') {
      return { ok: false, error: 'session_active', status: this.status() };
    }
    const now = this.adapters.now();
    const sessionId = String(seed.sessionId || this.adapters.createSessionId()).slice(0, 160);
    if (!sessionId) return { ok: false, error: 'invalid_session_id', status: this.status() };

    this.state = {
      ...initialState(now),
      active: true,
      phase: 'resolving',
      sessionId,
      title: String(seed.title || '').slice(0, 160),
      systemId: String(seed.systemId || '').slice(0, 64),
      classification: String(seed.classification || '').slice(0, 64),
      startedAt: now,
      updatedAt: now,
      internal: seed.internal || undefined,
      executable: seed.executable || undefined,
      corePath: seed.corePath || undefined,
      contentFile: seed.contentFile || undefined
    };
    return { ok: true, sessionId, status: this.status() };
  }

  transition(sessionId, nextPhase, patch = {}) {
    if (!this.state.sessionId || String(sessionId || '') !== this.state.sessionId) {
      return { ok: false, error: 'stale_session', status: this.status() };
    }
    if (!validPhase(nextPhase)) {
      return { ok: false, error: 'invalid_phase', status: this.status() };
    }
    if (!canTransition(this.state.phase, nextPhase)) {
      return {
        ok: false,
        error: 'illegal_transition',
        from: this.state.phase,
        to: nextPhase,
        status: this.status()
      };
    }

    const now = this.adapters.now();
    const next = {
      ...this.state,
      ...patch,
      phase: nextPhase,
      active: !['idle', 'ended', 'failed'].includes(nextPhase),
      updatedAt: now
    };
    if (nextPhase === 'failed') next.error = String(patch.error || patch.message || 'Play Session failed.').slice(0, 400);
    if (nextPhase === 'ended') {
      next.endedAt = now;
      next.endReason = String(patch.endReason || next.endReason || 'ended').slice(0, 160);
    }
    if (nextPhase === 'idle') this.state = initialState(now);
    else this.state = next;

    this.adapters.emitUpdate?.(this.status());
    return { ok: true, status: this.status() };
  }

  stop(sessionId, reason = 'requested') {
    if (this.state.phase === 'idle') {
      return { ok: true, idempotent: true, status: this.status() };
    }
    if (!this.state.sessionId || String(sessionId || '') !== this.state.sessionId) {
      return { ok: false, error: 'stale_session', status: this.status() };
    }
    if (this.state.phase === 'ended') {
      return { ok: true, idempotent: true, status: this.status() };
    }

    if (this.state.phase !== 'stopping') {
      const stopping = this.transition(sessionId, 'stopping', { endReason: String(reason || 'requested').slice(0, 160) });
      if (!stopping.ok) return stopping;
    }
    const ended = this.transition(sessionId, 'ended', { endReason: String(reason || 'requested').slice(0, 160) });
    return { ...ended, idempotent: false };
  }
}

function createPlaySessionManager(options = {}) {
  return new PlaySessionManager(options);
}

module.exports = {
  CLASSIFICATIONS,
  PHASE_TRANSITIONS,
  PlaySessionManager,
  buildCapabilityFailure,
  buildCapabilityResult,
  buildPublicStatus,
  buildStatusFailure,
  canTransition,
  createPlaySessionManager,
  isTrustedMainFrameCaller,
  normalizeSourceCandidate,
  normalizeText,
  publicRedact,
  rankSourceCandidates,
  resolveCapabilitiesSafely,
  validateCapabilityFileArgument
};
