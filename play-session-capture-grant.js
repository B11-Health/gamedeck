'use strict';

const MAX_GRANT_TTL_MS = 5000;
const MAX_USER_ACTION_AGE_MS = 1000;
const CAPTURE_HARD_CAPS = Object.freeze({
  maxGrantIds: 128,
  maxActionsPerSession: 64,
  maxSourceReceiptsPerSession: 64,
  maxSourceAuthoritiesPerSession: 64
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
const isOpaqueId = value =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);
const isHandle = value => (typeof value === 'object' && value !== null) || typeof value === 'function';
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

function createCaptureGrantLedger({
  createGrantId,
  createSourceReceiptId,
  verifySourceAuthority,
  limits: limitOverrides
} = {}) {
  if (typeof createGrantId !== 'function') throw new TypeError('createGrantId must be injected');
  if (typeof createSourceReceiptId !== 'function') {
    throw new TypeError('createSourceReceiptId must be injected');
  }
  if (typeof verifySourceAuthority !== 'function') {
    throw new TypeError('verifySourceAuthority must be injected');
  }

  const limits = validateLimits(limitOverrides);
  const state = {
    session: null,
    nextSessionEpoch: 1,
    grant: null,
    lastRevocationReason: null,
    generation: 0,
    lastTimeMs: null,
    usedGrantIds: new Set(),
    actions: new Map(),
    sourceReceipts: new Map(),
    usedSourceAuthorityIds: new Set()
  };

  function validTime(atMs) {
    return isTimestamp(atMs) && (state.lastTimeMs === null || atMs >= state.lastTimeMs);
  }

  function commitTime(atMs) {
    state.lastTimeMs = atMs;
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
      return true;
    }
    return false;
  }

  function clearSessionState() {
    state.actions.clear();
    state.usedGrantIds.clear();
    state.sourceReceipts.clear();
    state.usedSourceAuthorityIds.clear();
  }

  function generateOpaqueId(generator, failureCode) {
    let value;
    try {
      value = generator();
    } catch {
      return fail(failureCode);
    }
    if (!isOpaqueId(value)) return fail(failureCode);
    return Object.freeze({ ok: true, value });
  }

  function beginSession({ sessionId, sender, frame, atMs } = {}) {
    if (!validTime(atMs)) return fail('invalid_time');
    if (!isToken(sessionId)) return fail('invalid_session_id');
    if (sender == null || frame == null) return fail('invalid_caller_scope');

    if (state.session && sessionId === state.session.sessionId &&
        sender === state.session.sender && frame === state.session.frame) {
      commitTime(atMs);
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
    commitTime(atMs);
    return Object.freeze({
      ok: true,
      idempotent: false,
      sessionEpoch: state.session.sessionEpoch,
      replacedReason
    });
  }

  function recordUserAction({ sessionId, sessionEpoch, sender, frame, marker, atMs } = {}) {
    if (!validTime(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!isToken(marker)) return fail('invalid_user_action');
    if (state.actions.has(marker)) return fail('user_action_reused');
    if (state.actions.size >= limits.maxActionsPerSession) return fail('action_capacity_exhausted');
    state.actions.set(marker, { atMs, used: false });
    commitTime(atMs);
    return Object.freeze({ ok: true, registeredAtMs: atMs });
  }

  function registerTrustedSource(input = {}) {
    const {
      sessionId,
      sessionEpoch,
      sender,
      frame,
      source,
      sourceId,
      authorityEvidenceId,
      media,
      atMs
    } = input;

    if (!validTime(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!isHandle(source)) return fail('invalid_source_handle');
    if (!isToken(sourceId) || !sourceId.startsWith('window:')) return fail('invalid_window_source');
    if ('sourceKind' in input || 'sourceType' in input) return fail('untrusted_source_claim');
    if ('fallbackSourceId' in input || input.allowScreenFallback === true ||
        input.screenFallback === true) {
      return fail('screen_fallback_forbidden');
    }
    if (!isExactVideoOnlyScope(media)) return fail('invalid_media_scope');
    if (!isOpaqueId(authorityEvidenceId)) return fail('invalid_source_authority');
    if (state.usedSourceAuthorityIds.has(authorityEvidenceId)) {
      return fail('source_authority_reused');
    }
    if (state.usedSourceAuthorityIds.size >= limits.maxSourceAuthoritiesPerSession) {
      return fail('source_authority_capacity_exhausted');
    }
    if (state.sourceReceipts.size >= limits.maxSourceReceiptsPerSession) {
      return fail('source_receipt_capacity_exhausted');
    }

    const authorityRequest = Object.freeze({
      sessionId,
      sessionEpoch,
      sender,
      frame,
      source,
      sourceId,
      sourceKind: 'window',
      media: VIDEO_ONLY_MEDIA_SCOPE,
      authorityEvidenceId
    });
    let verified = false;
    try {
      verified = verifySourceAuthority(authorityRequest) === true;
    } catch {
      verified = false;
    }
    if (!verified) return fail('source_authority_rejected');

    const generated = generateOpaqueId(
      createSourceReceiptId,
      'invalid_or_duplicate_source_receipt'
    );
    if (!generated.ok || state.sourceReceipts.has(generated.value)) {
      return fail('invalid_or_duplicate_source_receipt');
    }

    state.usedSourceAuthorityIds.add(authorityEvidenceId);
    state.sourceReceipts.set(generated.value, {
      sessionId,
      sessionEpoch,
      sender,
      frame,
      source,
      sourceId,
      sourceKind: 'window',
      media: VIDEO_ONLY_MEDIA_SCOPE,
      authorityEvidenceId,
      registeredAtMs: atMs,
      used: false
    });
    commitTime(atMs);
    return Object.freeze({ ok: true, sourceReceiptId: generated.value });
  }

  function issueGrant(input = {}) {
    const {
      sessionId,
      sessionEpoch,
      sender,
      frame,
      sourceReceiptId,
      userActionMarker,
      nowMs,
      ttlMs
    } = input;

    if (!validTime(nowMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (['source', 'sourceId', 'sourceType', 'sourceKind', 'media'].some(key => key in input)) {
      return fail('untrusted_source_claim');
    }
    if ('fallbackSourceId' in input || input.allowScreenFallback === true ||
        input.screenFallback === true) {
      return fail('screen_fallback_forbidden');
    }
    if (!isOpaqueId(sourceReceiptId)) return fail('invalid_source_receipt');
    const sourceRecord = state.sourceReceipts.get(sourceReceiptId);
    if (!sourceRecord) return fail('unregistered_source');
    if (sourceRecord.used) return fail('source_receipt_reused');
    if (sourceRecord.sessionId !== sessionId || sourceRecord.sessionEpoch !== sessionEpoch ||
        sourceRecord.sender !== sender || sourceRecord.frame !== frame) {
      return fail('source_scope_mismatch');
    }
    if (sourceRecord.sourceKind !== 'window' || !isExactVideoOnlyScope(sourceRecord.media)) {
      return fail('source_scope_mismatch');
    }
    if ('userAction' in input) return fail('untrusted_user_action_timestamp');
    if (!isToken(userActionMarker)) return fail('invalid_user_action');
    const action = state.actions.get(userActionMarker);
    if (!action) return fail('unregistered_user_action');
    if (action.used) return fail('user_action_reused');
    const actionAgeMs = nowMs - action.atMs;
    if (actionAgeMs < 0 || actionAgeMs > MAX_USER_ACTION_AGE_MS) {
      return fail('stale_user_action');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_GRANT_TTL_MS) {
      return fail('invalid_expiry');
    }
    if (state.usedGrantIds.size >= limits.maxGrantIds) {
      return fail('grant_id_capacity_exhausted');
    }

    const generated = generateOpaqueId(createGrantId, 'invalid_or_duplicate_grant_id');
    if (!generated.ok || state.usedGrantIds.has(generated.value)) {
      return fail('invalid_or_duplicate_grant_id');
    }

    expire(nowMs);
    let replacedReason = null;
    if (state.grant?.state === 'active') {
      revokeActive('grant_replaced', nowMs);
      replacedReason = 'grant_replaced';
    }

    state.generation += 1;
    state.usedGrantIds.add(generated.value);
    action.used = true;
    sourceRecord.used = true;
    state.grant = {
      grantId: generated.value,
      state: 'active',
      generation: state.generation,
      sessionId,
      sessionEpoch,
      sender,
      frame,
      sourceReceiptId,
      source: sourceRecord.source,
      sourceId: sourceRecord.sourceId,
      sourceKind: sourceRecord.sourceKind,
      media: sourceRecord.media,
      userActionMarker,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      revocationReason: null,
      revokedAtMs: null
    };
    commitTime(nowMs);

    return Object.freeze({
      ok: true,
      grantId: state.grant.grantId,
      generation: state.generation,
      expiresAtMs: state.grant.expiresAtMs,
      replacedReason
    });
  }

  function consumeGrant(input = {}) {
    const {
      grantId,
      sessionId,
      sessionEpoch,
      sender,
      frame,
      sourceReceiptId,
      userActionMarker,
      nowMs
    } = input;

    if (!validTime(nowMs)) return fail('invalid_time');
    if (!state.grant) return fail('no_grant');
    if (!isOpaqueId(grantId) || grantId !== state.grant.grantId) return fail('grant_mismatch');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (['source', 'sourceId', 'sourceType', 'sourceKind', 'media'].some(key => key in input)) {
      return fail('untrusted_source_claim');
    }
    if (sourceReceiptId !== state.grant.sourceReceiptId) return fail('source_scope_mismatch');
    if (userActionMarker !== state.grant.userActionMarker) return fail('user_action_mismatch');

    if (state.grant.state === 'consumed') return fail('grant_consumed');
    if (state.grant.state === 'expired') return fail('grant_expired');
    if (state.grant.state !== 'active') return fail('grant_revoked');
    if (nowMs >= state.grant.expiresAtMs) {
      revokeActive('expired', nowMs);
      commitTime(nowMs);
      return fail('grant_expired');
    }

    const sourceRecord = state.sourceReceipts.get(sourceReceiptId);
    if (!sourceRecord || sourceRecord.source !== state.grant.source ||
        sourceRecord.sourceId !== state.grant.sourceId ||
        sourceRecord.sourceKind !== 'window' || !isExactVideoOnlyScope(sourceRecord.media)) {
      return fail('source_scope_mismatch');
    }

    const grant = Object.freeze({
      grantId: state.grant.grantId,
      generation: state.grant.generation,
      sessionId: state.grant.sessionId,
      sourceReceiptId: state.grant.sourceReceiptId,
      source: state.grant.source,
      sourceId: state.grant.sourceId,
      sourceType: 'window',
      media: VIDEO_ONLY_MEDIA_SCOPE,
      issuedAtMs: state.grant.issuedAtMs,
      expiresAtMs: state.grant.expiresAtMs
    });
    revokeActive('consumed', nowMs);
    commitTime(nowMs);
    return Object.freeze({ ok: true, grant });
  }

  function revokeGrant({ sessionId, sessionEpoch, sender, frame, reasonCode, atMs } = {}) {
    if (!validTime(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    expire(atMs);
    if (state.grant?.state !== 'active') {
      commitTime(atMs);
      return Object.freeze({
        ok: true,
        idempotent: true,
        reasonCode: state.grant?.revocationReason || null
      });
    }
    revokeActive(reasonCode, atMs);
    commitTime(atMs);
    return Object.freeze({ ok: true, idempotent: false, reasonCode });
  }

  function endSession({
    sessionId,
    sessionEpoch,
    sender,
    frame,
    reasonCode = 'session_ended',
    atMs
  } = {}) {
    if (!validTime(atMs)) return fail('invalid_time');
    if (!callerMatches({ sessionId, sessionEpoch, sender, frame })) return fail('session_scope_mismatch');
    if (!EXPLICIT_REVOCATION_REASONS.includes(reasonCode)) return fail('invalid_revocation_reason');
    expire(atMs);
    revokeActive(reasonCode, atMs);
    state.session = null;
    clearSessionState();
    commitTime(atMs);
    return Object.freeze({ ok: true, reasonCode });
  }

  function publicStatus({ nowMs } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    expire(nowMs);
    commitTime(nowMs);
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
        maxActionsPerSession: limits.maxActionsPerSession,
        sourceReceiptsRegistered: state.sourceReceipts.size,
        maxSourceReceiptsPerSession: limits.maxSourceReceiptsPerSession,
        sourceAuthoritiesUsed: state.usedSourceAuthorityIds.size,
        maxSourceAuthoritiesPerSession: limits.maxSourceAuthoritiesPerSession
      })
    });
  }

  return Object.freeze({
    beginSession,
    recordUserAction,
    registerTrustedSource,
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
  isOpaqueId,
  validateLimits
};
