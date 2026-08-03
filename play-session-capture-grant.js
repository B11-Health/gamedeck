'use strict';

const MAX_GRANT_TTL_MS = 5000;
const MAX_USER_ACTION_AGE_MS = 1000;
const CAPTURE_HARD_CAPS = Object.freeze({
  maxGrantIds: 128,
  maxActionsPerSession: 64
});
const VIDEO_ONLY_MEDIA_SCOPE = Object.freeze({ video: true, audio: false });
const EXPLICIT_REVOCATION_REASONS = Object.freeze([
  'capture_failed',
  'feature_disabled',
  'security_policy',
  'session_ended',
  'user_cancelled'
]);

const isTimestamp = value => Number.isSafeInteger(value) && value >= 0;
const isToken = (value, max = 256) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
const isOpaqueId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);
const fail = reasonCode => Object.freeze({ ok: false, reasonCode });

function validateLimits(input = {}) {
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(CAPTURE_HARD_CAPS, key)) throw new RangeError(`unknown capture limit: ${key}`);
  }
  const limits = { ...CAPTURE_HARD_CAPS, ...input };
  for (const [key, cap] of Object.entries(CAPTURE_HARD_CAPS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > cap) {
      throw new RangeError(`${key} exceeds security cap`);
    }
  }
  return Object.freeze(limits);
}

function isExactVideoOnlyScope(media) {
  if (!media || typeof media !== 'object' || Array.isArray(media)) return false;
  const keys = Object.keys(media).sort();
  return keys.length === 2 && keys[0] === 'audio' && keys[1] === 'video' &&
    media.video === true && media.audio === false;
}

function createCaptureGrantLedger({ createGrantId, limits: limitOverrides } = {}) {
  if (typeof createGrantId !== 'function') throw new TypeError('createGrantId must be injected');
  const limits = validateLimits(limitOverrides);
  const state = {
    session: null,
    nextSessionEpoch: 1,
    grant: null,
    lastRevocationReason: null,
    generation: 0,
    lastTimeMs: null,
    usedGrantIds: new Set(),
    actions: new Map()
  };

  function checkTime(atMs) {
    if (!isTimestamp(atMs) || (state.lastTimeMs !== null && atMs < state.lastTimeMs)) return false;
    state.lastTimeMs = atMs;
    return true;
  }

  function callerMatches({ sessionId, sessionEpoch, sender, frame }) {
    return Boolean(state.session) &&
      sessionId === state.session.sessionId &&
      sessionEpoch === state.session.sessionEpoch &&
      sender === state.session.sender &&
      frame === state.session.frame;
  }

  function revokeActive(reasonCode, atMs) {
    if (state.grant?.state !== 'active') return false;
    state.grant.state = reasonCode === 'consumed' ? 'consumed' :
      reasonCode === 'expired' ? 'expired' : 'revoked';
    state.grant.revocationReason = reasonCode;
    state.grant.revokedAtMs = atMs;
    state.lastRevocationReason = reasonCode;
    return true;
  }

  function expire(nowMs) {
    if (state.grant?.state === 'active' && nowMs >= state.grant.expiresAtMs) {
      revokeActive('expired', nowMs);
    }
  }

  function clearSessionState() {
    state.actions.clear();
    state.usedGrantIds.clear();
  }

  function beginSession({ sessionId, sender, frame, atMs } = {}) {
    if (!checkTime(atMs)) return fail('invalid_time');
    if (!isToken(sessionId)) return fail('invalid_session_id');
    if (sender == null || frame == null) return fail('invalid_caller_scope');

    if (state.session && sessionId === state.session.sessionId &&
        sender === state.session.sender && frame === state.session.frame) {
      return Object.freeze({
        ok: true,
        idempotent: true,
        sessionEpoch: state.session.sessionEpoch,
        replacedReason: null
      });
    }

    let replacedReason = null;
    if (state.session) {
      revokeActive('session_replaced', atMs);
      clearSessionState();
      replacedReason = 'session_replaced';
    }
    state.session = {
      sessionId,
      sessionEpoch: state.nextSessionEpoch,
      sender,
      frame
    };
    state.nextSessionEpoch += 1;
    clearSessionState();
    return Object.freeze({
      ok: true,
      idempotent: false,
      sessionEpoch: state.session.sessionEpoch,
      replacedReason
    });
  }

  function recordUserAction({ sessionId, sessionEpoch, sender, frame, marker, atMs } = {}) {
    if (!checkTime(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!isToken(marker)) return fail('invalid_user_action');
    if (state.actions.has(marker)) return fail('user_action_reused');
    if (state.actions.size >= limits.maxActionsPerSession) return fail('action_capacity_exhausted');
    state.actions.set(marker, { atMs, used: false });
    return Object.freeze({ ok: true, registeredAtMs: atMs });
  }

  function issueGrant(input = {}) {
    const {
      sessionId, sessionEpoch, sender, frame, source, sourceId, sourceType,
      media, userActionMarker, nowMs, ttlMs
    } = input;

    if (!checkTime(nowMs)) return fail('invalid_time');
    expire(nowMs);
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (source == null || !isToken(sourceId) || sourceType !== 'window') {
      return fail('invalid_window_source');
    }
    if ('fallbackSourceId' in input || input.allowScreenFallback === true || input.screenFallback === true) {
      return fail('screen_fallback_forbidden');
    }
    if (!isExactVideoOnlyScope(media)) return fail('invalid_media_scope');
    if ('userAction' in input) return fail('untrusted_user_action_timestamp');
    if (!isToken(userActionMarker)) return fail('invalid_user_action');
    const action = state.actions.get(userActionMarker);
    if (!action) return fail('unregistered_user_action');
    if (action.used) return fail('user_action_reused');
    const actionAgeMs = nowMs - action.atMs;
    if (actionAgeMs < 0 || actionAgeMs > MAX_USER_ACTION_AGE_MS) return fail('stale_user_action');
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_GRANT_TTL_MS) {
      return fail('invalid_expiry');
    }
    if (state.usedGrantIds.size >= limits.maxGrantIds) return fail('grant_id_capacity_exhausted');

    let grantId;
    try {
      grantId = createGrantId();
    } catch {
      return fail('grant_id_generation_failed');
    }
    if (!isOpaqueId(grantId) || state.usedGrantIds.has(grantId)) {
      return fail('invalid_or_duplicate_grant_id');
    }

    let replacedReason = null;
    if (state.grant?.state === 'active') {
      revokeActive('grant_replaced', nowMs);
      replacedReason = 'grant_replaced';
    }

    state.generation += 1;
    state.usedGrantIds.add(grantId);
    action.used = true;
    state.grant = {
      grantId,
      state: 'active',
      generation: state.generation,
      sessionId,
      sessionEpoch,
      sender,
      frame,
      source,
      sourceId,
      sourceType,
      userActionMarker,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      revocationReason: null,
      revokedAtMs: null
    };

    return Object.freeze({
      ok: true,
      grantId,
      generation: state.generation,
      expiresAtMs: state.grant.expiresAtMs,
      replacedReason
    });
  }

  function consumeGrant(input = {}) {
    const {
      grantId, sessionId, sessionEpoch, sender, frame, source, sourceId, sourceType,
      media, userActionMarker, nowMs
    } = input;

    if (!checkTime(nowMs)) return fail('invalid_time');
    expire(nowMs);
    if (!state.grant) return fail('no_grant');
    if (!isToken(grantId) || grantId !== state.grant.grantId) return fail('grant_mismatch');
    if (state.grant.state === 'consumed') return fail('grant_consumed');
    if (state.grant.state === 'expired') return fail('grant_expired');
    if (state.grant.state !== 'active') return fail('grant_revoked');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (sessionEpoch !== state.grant.sessionEpoch) return fail('session_scope_mismatch');
    if (source !== state.grant.source || sourceId !== state.grant.sourceId ||
        sourceType !== state.grant.sourceType) return fail('source_scope_mismatch');
    if (!isExactVideoOnlyScope(media)) return fail('media_scope_mismatch');
    if (userActionMarker !== state.grant.userActionMarker) return fail('user_action_mismatch');

    const grant = Object.freeze({
      grantId: state.grant.grantId,
      generation: state.grant.generation,
      sessionId: state.grant.sessionId,
      sourceId: state.grant.sourceId,
      sourceType: state.grant.sourceType,
      media: VIDEO_ONLY_MEDIA_SCOPE,
      issuedAtMs: state.grant.issuedAtMs,
      expiresAtMs: state.grant.expiresAtMs
    });
    revokeActive('consumed', nowMs);
    return Object.freeze({ ok: true, grant });
  }

  function revokeGrant({ sessionId, sessionEpoch, sender, frame, reasonCode, atMs } = {}) {
    if (!checkTime(atMs)) return fail('invalid_time');
    expire(atMs);
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    if (state.grant?.state !== 'active') {
      return Object.freeze({
        ok: true,
        idempotent: true,
        reasonCode: state.grant?.revocationReason || null
      });
    }
    revokeActive(reasonCode, atMs);
    return Object.freeze({ ok: true, idempotent: false, reasonCode });
  }

  function endSession({ sessionId, sessionEpoch, sender, frame, reasonCode = 'session_ended', atMs } = {}) {
    if (!checkTime(atMs)) return fail('invalid_time');
    expire(atMs);
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    revokeActive(reasonCode, atMs);
    state.session = null;
    clearSessionState();
    return Object.freeze({ ok: true, reasonCode });
  }

  function publicStatus({ nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    expire(nowMs);
    const active = state.grant?.state === 'active';
    return Object.freeze({
      version: 1,
      activeSession: Boolean(state.session),
      grantState: state.grant?.state || 'none',
      generation: state.grant?.generation || 0,
      sourceType: active ? 'window' : null,
      media: active ? VIDEO_ONLY_MEDIA_SCOPE : null,
      hasRecentUserAction: active,
      issuedAtMs: state.grant?.issuedAtMs ?? null,
      expiresAtMs: state.grant?.expiresAtMs ?? null,
      lastRevocationReason: state.lastRevocationReason,
      retention: Object.freeze({
        grantIdsUsed: state.usedGrantIds.size,
        maxGrantIds: limits.maxGrantIds,
        actionsRegistered: state.actions.size,
        maxActionsPerSession: limits.maxActionsPerSession
      })
    });
  }

  return Object.freeze({
    beginSession,
    recordUserAction,
    issueGrant,
    consumeGrant,
    revokeGrant,
    endSession,
    publicStatus
  });
}

module.exports = {
  CAPTURE_HARD_CAPS,
  EXPLICIT_REVOCATION_REASONS,
  MAX_GRANT_TTL_MS,
  MAX_USER_ACTION_AGE_MS,
  VIDEO_ONLY_MEDIA_SCOPE,
  createCaptureGrantLedger,
  isExactVideoOnlyScope,
  validateLimits,
  isOpaqueId
};
