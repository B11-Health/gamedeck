'use strict';

const HARD_CAPS = Object.freeze({
  maxPayloadBytes: 8192,
  maxEventsPerMessage: 64,
  maxEventsPerSecond: 240,
  maxQueueDepth: 32,
  watchdogMs: 500,
  maxButtons: 64,
  maxConnections: 64
});
const BUTTON_PATTERN = /^[A-Z0-9_:+.-]{1,32}$/;
const ALLOWED_KEYS = Object.freeze({
  snapshot: ['type', 'connectionId', 'sequence', 'buttons'],
  delta: ['type', 'connectionId', 'sequence', 'pressed', 'released'],
  release_all: ['type', 'connectionId', 'sequence']
});
const fail = (reasonCode, extra = {}) => Object.freeze({ ok: false, reasonCode, ...extra });
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const isSequence = value => Number.isSafeInteger(value) && value >= 1;
const isConnectionId = value =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);
const isButton = value => typeof value === 'string' && BUTTON_PATTERN.test(value);

function validateLimits(input = {}) {
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(HARD_CAPS, key)) throw new RangeError(`unknown security limit: ${key}`);
  }
  const limits = { ...HARD_CAPS, ...input };
  for (const [key, cap] of Object.entries(HARD_CAPS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > cap) {
      throw new RangeError(`${key} exceeds security cap`);
    }
  }
  return Object.freeze(limits);
}

function serializedSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function exactKeys(message, allowed) {
  const expected = [...allowed].sort();
  const keys = Object.keys(message).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function validateButtons(values, limits) {
  if (!Array.isArray(values) || values.length > limits.maxButtons) return null;
  const set = new Set();
  for (const value of values) {
    if (!isButton(value) || set.has(value)) return null;
    set.add(value);
  }
  return set;
}

function createInputProtocol(options = {}) {
  const limits = validateLimits(options.limits);
  let connected = false;
  let connectionId = null;
  const retiredConnectionIds = new Set();
  let requireSnapshot = true;
  let highestReceived = 0;
  let highestProcessed = 0;
  let lastTimeMs = null;
  let lastReceivedAtMs = null;
  let lastProcessedAtMs = null;
  let oldestQueuedAtMs = null;
  let rateWindowStartMs = null;
  let rateEvents = 0;
  let authoritativeButtons = new Set();
  let projectedButtons = new Set();
  let queue = [];

  function validTime(nowMs) {
    return isTime(nowMs) && (lastTimeMs === null || nowMs >= lastTimeMs);
  }

  function commitTime(nowMs) {
    lastTimeMs = nowMs;
  }

  function releaseAndResync(reasonCode) {
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    queue = [];
    oldestQueuedAtMs = null;
    requireSnapshot = true;
    return fail(reasonCode, {
      releaseAll: true,
      resyncRequired: true,
      highestProcessedAck: highestProcessed
    });
  }

  function connect({ nowMs, connectionId: nextConnectionId } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    if (!isConnectionId(nextConnectionId)) return fail('invalid_connection_id');
    if (nextConnectionId === connectionId || retiredConnectionIds.has(nextConnectionId)) {
      return fail('connection_id_reused');
    }
    const retainedCount = retiredConnectionIds.size + (connectionId ? 1 : 0);
    if (retainedCount + 1 > limits.maxConnections) {
      commitTime(nowMs);
      return releaseAndResync('connection_capacity_exhausted');
    }
    if (connectionId) retiredConnectionIds.add(connectionId);
    connectionId = nextConnectionId;
    connected = true;
    requireSnapshot = true;
    queue = [];
    oldestQueuedAtMs = null;
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    highestReceived = 0;
    highestProcessed = 0;
    lastReceivedAtMs = nowMs;
    lastProcessedAtMs = nowMs;
    rateWindowStartMs = nowMs;
    rateEvents = 0;
    commitTime(nowMs);
    return Object.freeze({
      ok: true,
      connectionId,
      resyncRequired: true,
      releaseAll: true
    });
  }

  function disconnect({ nowMs } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    if (connectionId) retiredConnectionIds.add(connectionId);
    connected = false;
    connectionId = null;
    requireSnapshot = true;
    queue = [];
    oldestQueuedAtMs = null;
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    lastReceivedAtMs = null;
    lastProcessedAtMs = null;
    rateWindowStartMs = null;
    rateEvents = 0;
    commitTime(nowMs);
    return Object.freeze({ ok: true, releaseAll: true });
  }

  function validateMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return fail('invalid_message');
    }
    const size = serializedSize(message);
    if (size === null) return fail('unserializable_payload');
    if (size > limits.maxPayloadBytes) return fail('payload_too_large');
    if (!Object.hasOwn(ALLOWED_KEYS, message.type) ||
        !exactKeys(message, ALLOWED_KEYS[message.type])) {
      return fail('invalid_message_keys');
    }
    if (!isConnectionId(message.connectionId)) return fail('invalid_connection_id');
    if (!isSequence(message.sequence)) return fail('invalid_sequence');

    if (message.type === 'snapshot') {
      const buttons = validateButtons(message.buttons, limits);
      if (!buttons) return fail('invalid_buttons');
      return Object.freeze({
        ok: true,
        eventCount: Math.max(1, buttons.size),
        projected: buttons
      });
    }

    if (message.type === 'delta') {
      const pressed = validateButtons(message.pressed, limits);
      const released = validateButtons(message.released, limits);
      const eventCount = (pressed?.size || 0) + (released?.size || 0);
      if (!pressed || !released || eventCount === 0 ||
          eventCount > limits.maxEventsPerMessage) {
        return fail('invalid_events');
      }
      for (const button of pressed) {
        if (released.has(button)) return fail('conflicting_delta');
      }
      const projected = new Set(projectedButtons);
      for (const button of pressed) projected.add(button);
      for (const button of released) projected.delete(button);
      return Object.freeze({
        ok: true,
        eventCount: Math.max(1, eventCount),
        projected
      });
    }

    return Object.freeze({
      ok: true,
      eventCount: 1,
      projected: new Set()
    });
  }

  function enqueue(message, { nowMs } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    if (!connected) {
      return fail('not_connected', { releaseAll: true, resyncRequired: true });
    }
    const validation = validateMessage(message);
    if (!validation.ok) return validation;
    if (message.connectionId !== connectionId) {
      commitTime(nowMs);
      return releaseAndResync('connection_mismatch');
    }
    if (message.sequence <= highestReceived) {
      return fail('sequence_replay', { highestProcessedAck: highestProcessed });
    }
    if (message.sequence !== highestReceived + 1) {
      commitTime(nowMs);
      return releaseAndResync('sequence_gap');
    }
    if (requireSnapshot && message.type !== 'snapshot') {
      commitTime(nowMs);
      return releaseAndResync('snapshot_required');
    }
    if (validation.projected.size > limits.maxButtons) {
      commitTime(nowMs);
      return releaseAndResync('button_state_capacity_exceeded');
    }

    const windowReset = rateWindowStartMs === null ||
      nowMs - rateWindowStartMs >= 1000;
    const nextRateWindowStart = windowReset ? nowMs : rateWindowStartMs;
    const currentRateEvents = windowReset ? 0 : rateEvents;
    const nextRateEvents = currentRateEvents + validation.eventCount;
    if (nextRateEvents > limits.maxEventsPerSecond) {
      commitTime(nowMs);
      return releaseAndResync('rate_limited');
    }

    const queueWasEmpty = queue.length === 0;
    const internalMessage = Object.freeze({
      ...message,
      ...(message.buttons && { buttons: Object.freeze([...message.buttons]) }),
      ...(message.pressed && { pressed: Object.freeze([...message.pressed]) }),
      ...(message.released && { released: Object.freeze([...message.released]) }),
      queuedAtMs: nowMs
    });

    rateWindowStartMs = nextRateWindowStart;
    rateEvents = nextRateEvents;
    highestReceived = message.sequence;
    projectedButtons = new Set(validation.projected);
    lastReceivedAtMs = nowMs;
    if (message.type === 'snapshot') requireSnapshot = false;

    if (queue.length >= limits.maxQueueDepth) {
      const retainedQueuedAtMs = oldestQueuedAtMs ?? nowMs;
      queue = [Object.freeze({
        type: 'snapshot',
        connectionId,
        sequence: message.sequence,
        buttons: Object.freeze([...projectedButtons].sort()),
        queuedAtMs: retainedQueuedAtMs
      })];
      oldestQueuedAtMs = retainedQueuedAtMs;
      commitTime(nowMs);
      return Object.freeze({
        ok: true,
        compacted: true,
        queueDepth: 1,
        highestProcessedAck: highestProcessed
      });
    }

    queue.push(internalMessage);
    if (queueWasEmpty) oldestQueuedAtMs = nowMs;
    commitTime(nowMs);
    return Object.freeze({
      ok: true,
      compacted: false,
      queueDepth: queue.length,
      highestProcessedAck: highestProcessed
    });
  }

  function processNext({ nowMs } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    if (!connected) {
      return fail('not_connected', { releaseAll: true, resyncRequired: true });
    }
    const message = queue.shift();
    if (!message) {
      commitTime(nowMs);
      return Object.freeze({
        ok: true,
        empty: true,
        highestProcessedAck: highestProcessed,
        buttons: Object.freeze([...authoritativeButtons].sort())
      });
    }
    if (message.type === 'snapshot') {
      authoritativeButtons = new Set(message.buttons);
    } else if (message.type === 'delta') {
      for (const button of message.pressed) authoritativeButtons.add(button);
      for (const button of message.released) authoritativeButtons.delete(button);
    } else {
      authoritativeButtons = new Set();
    }
    highestProcessed = message.sequence;
    lastProcessedAtMs = nowMs;
    oldestQueuedAtMs = queue.length ? queue[0].queuedAtMs : null;
    commitTime(nowMs);
    return Object.freeze({
      ok: true,
      empty: false,
      highestProcessedAck: highestProcessed,
      buttons: Object.freeze([...authoritativeButtons].sort()),
      type: message.type
    });
  }

  function watchdog({ nowMs } = {}) {
    if (!validTime(nowMs)) return fail('invalid_time');
    if (!connected) {
      commitTime(nowMs);
      return Object.freeze({ ok: true, triggered: false });
    }
    const processingStalled = queue.length > 0 && oldestQueuedAtMs !== null &&
      nowMs - oldestQueuedAtMs >= limits.watchdogMs;
    const inputSilent = queue.length === 0 && authoritativeButtons.size > 0 &&
      lastReceivedAtMs !== null && nowMs - lastReceivedAtMs >= limits.watchdogMs;
    if (!processingStalled && !inputSilent) {
      commitTime(nowMs);
      return Object.freeze({ ok: true, triggered: false });
    }
    const reasonCode = processingStalled ? 'processing_stalled' : 'input_watchdog';
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    queue = [];
    oldestQueuedAtMs = null;
    requireSnapshot = true;
    lastProcessedAtMs = nowMs;
    lastReceivedAtMs = nowMs;
    commitTime(nowMs);
    return Object.freeze({
      ok: true,
      triggered: true,
      reasonCode,
      releaseAll: true,
      resyncRequired: true,
      highestProcessedAck: highestProcessed
    });
  }

  function status() {
    return Object.freeze({
      connected,
      resyncRequired: requireSnapshot,
      highestReceived,
      highestProcessedAck: highestProcessed,
      queueDepth: queue.length,
      buttons: Object.freeze([...authoritativeButtons].sort()),
      projectedButtons: Object.freeze([...projectedButtons].sort()),
      lastReceivedAtMs,
      lastProcessedAtMs,
      oldestQueuedAtMs,
      retainedConnectionCount: retiredConnectionIds.size + (connectionId ? 1 : 0),
      maxConnections: limits.maxConnections
    });
  }

  return Object.freeze({
    connect,
    disconnect,
    enqueue,
    processNext,
    watchdog,
    status
  });
}

module.exports = {
  BUTTON_PATTERN,
  HARD_CAPS,
  createInputProtocol,
  validateLimits
};
