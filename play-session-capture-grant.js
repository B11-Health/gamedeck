'use strict';

const MAX_GRANT_TTL_MS = 5000;
const MAX_USER_ACTION_AGE_MS = 1000;
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

function isExactVideoOnlyScope(media) {
  if (!media || typeof media !== 'object' || Array.isArray(media)) return false;
  const keys = Object.keys(media).sort();
  return keys.length === 2 && keys[0] === 'audio' && keys[1] === 'video' &&
    media.video === true && media.audio === false;
}

const fail = reasonCode => Object.freeze({ ok: false, reasonCode });

function createCaptureGrantLedger({ createGrantId } = {}) {
  if (typeof createGrantId !== 'function') throw new TypeError('createGrantId must be injected');
  const state = {
    session: null,
    grant: null,
    lastRevocationReason: null,
    generation: 0,
    usedGrantIds: new Set(),
    usedActionMarkers: new Set()
  };

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

  function callerMatches({ sessionId, sender, frame }) {
    return Boolean(state.session) &&
      sessionId === state.session.sessionId &&
      sender === state.session.sender &&
      frame === state.session.frame;
  }

  function beginSession({ sessionId, sender, frame, atMs } = {}) {
    if (!isTimestamp(atMs)) return fail('invalid_time');
    if (!isToken(sessionId)) return fail('invalid_session_id');
    if (sender == null || frame == null) return fail('invalid_caller_scope');

    const identical = callerMatches({ sessionId, sender, frame });
    if (identical) return Object.freeze({ ok: true, idempotent: true, replacedReason: null });

    let replacedReason = null;
    if (state.session) {
      revokeActive('session_replaced', atMs);
      replacedReason = 'session_replaced';
    }
    state.session = { sessionId, sender, frame };
    state.usedActionMarkers.clear();
    return Object.freeze({ ok: true, idempotent: false, replacedReason });
  }

  function issueGrant(input = {}) {
    const {
      sessionId, sender, frame, source, sourceId, sourceType,
      media, userAction, nowMs, ttlMs
    } = input;

    if (!isTimestamp(nowMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sender, frame })) return fail('session_scope_mismatch');
    if (source == null || !isToken(sourceId) || sourceType !== 'window') {
      return fail('invalid_window_source');
    }
    if ('fallbackSourceId' in input || input.allowScreenFallback === true || input.screenFallback === true) {
      return fail('screen_fallback_forbidden');
    }
    if (!isExactVideoOnlyScope(media)) return fail('invalid_media_scope');
    if (!userAction || !isToken(userAction.marker) || !isTimestamp(userAction.atMs)) {
      return fail('invalid_user_action');
    }
    const age = nowMs - userAction.atMs;
    if (age < 0 || age > MAX_USER_ACTION_AGE_MS) return fail('stale_user_action');
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_GRANT_TTL_MS) {
      return fail('invalid_expiry');
    }
    if (state.usedActionMarkers.has(userAction.marker)) return fail('user_action_reused');
    let grantId;
    try { grantId = createGrantId(); } catch { return fail('grant_id_generation_failed'); }
    if (!isToken(grantId) || state.usedGrantIds.has(grantId)) return fail('invalid_or_duplicate_grant_id');

    expire(nowMs);
    let replacedReason = null;
    if (state.grant?.state === 'active') {
      revokeActive('grant_replaced', nowMs);
      replacedReason = 'grant_replaced';
    }

    state.generation += 1;
    state.usedGrantIds.add(grantId);
    state.usedActionMarkers.add(userAction.marker);
    state.grant = {
      grantId,
      state: 'active',
      generation: state.generation,
      sessionId,
      sender,
      frame,
      source,
      sourceId,
      sourceType,
      userActionMarker: userAction.marker,
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
      grantId, sessionId, sender, frame, source, sourceId, sourceType,
      media, userActionMarker, nowMs
    } = input;

    if (!isTimestamp(nowMs)) return fail('invalid_time');
    expire(nowMs);
    if (!state.grant) return fail('no_grant');
    if (!isToken(grantId) || grantId !== state.grant.grantId) return fail('grant_mismatch');
    if (state.grant.state === 'consumed') return fail('grant_consumed');
    if (state.grant.state === 'expired') return fail('grant_expired');
    if (state.grant.state !== 'active') return fail('grant_revoked');
    if (!callerMatches({ sessionId, sender, frame })) return fail('session_scope_mismatch');
    if (sender !== state.grant.sender) return fail('sender_mismatch');
    if (frame !== state.grant.frame) return fail('frame_mismatch');
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

  function revokeGrant({ sessionId, sender, frame, reasonCode, atMs } = {}) {
    if (!isTimestamp(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    expire(atMs);
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

  function endSession({ sessionId, sender, frame, reasonCode = 'session_ended', atMs } = {}) {
    if (!isTimestamp(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    expire(atMs);
    revokeActive(reasonCode, atMs);
    state.session = null;
    state.usedActionMarkers.clear();
    return Object.freeze({ ok: true, reasonCode });
  }

  function publicStatus({ nowMs } = {}) {
    if (!isTimestamp(nowMs)) return fail('invalid_time');
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
      lastRevocationReason: state.lastRevocationReason
    });
  }

  return Object.freeze({
    beginSession,
    issueGrant,
    consumeGrant,
    revokeGrant,
    endSession,
    publicStatus
  });
}

module.exports = {
  EXPLICIT_REVOCATION_REASONS,
  MAX_GRANT_TTL_MS,
  MAX_USER_ACTION_AGE_MS,
  VIDEO_ONLY_MEDIA_SCOPE,
  createCaptureGrantLedger,
  isExactVideoOnlyScope
};
