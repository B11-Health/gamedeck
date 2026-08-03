'use strict';

const HARD_CAPS = Object.freeze({ maxPayloadBytes: 8192, maxEventsPerMessage: 64, maxEventsPerSecond: 240, maxQueueDepth: 32, watchdogMs: 500, maxButtons: 64 });
const ALLOWED_KEYS = Object.freeze({ snapshot: ['type','sequence','buttons'], delta: ['type','sequence','pressed','released'], release_all: ['type','sequence'] });
const fail = (reasonCode, extra = {}) => Object.freeze({ ok: false, reasonCode, ...extra });
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const isSequence = value => Number.isSafeInteger(value) && value >= 1;
const isButton = value => typeof value === 'string' && value.length > 0 && value.length <= 64 && !value.includes('\0');

function validateLimits(input = {}) {
  const limits = { ...HARD_CAPS, ...input };
  for (const [key, cap] of Object.entries(HARD_CAPS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > cap) throw new RangeError(`${key} exceeds security cap`);
  }
  return Object.freeze(limits);
}

function serializedSize(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return null; }
}

function exactKeys(message, allowed) {
  const keys = Object.keys(message).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
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
  let requireSnapshot = true;
  let highestReceived = 0;
  let highestProcessed = 0;
  let lastTimeMs = null;
  let lastActivityMs = null;
  let rateWindowStartMs = null;
  let rateEvents = 0;
  let authoritativeButtons = new Set();
  let projectedButtons = new Set();
  let queue = [];

  function checkTime(nowMs) {
    if (!isTime(nowMs) || (lastTimeMs !== null && nowMs < lastTimeMs)) return false;
    lastTimeMs = nowMs;
    return true;
  }

  function releaseAndResync(reasonCode) {
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    queue = [];
    requireSnapshot = true;
    return fail(reasonCode, { releaseAll: true, resyncRequired: true, highestProcessedAck: highestProcessed });
  }

  function connect({ nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    connected = true;
    requireSnapshot = true;
    queue = [];
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    highestReceived = 0;
    highestProcessed = 0;
    lastActivityMs = nowMs;
    rateWindowStartMs = nowMs;
    rateEvents = 0;
    return Object.freeze({ ok: true, resyncRequired: true, releaseAll: true });
  }

  function disconnect({ nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    connected = false;
    requireSnapshot = true;
    queue = [];
    authoritativeButtons = new Set();
    projectedButtons = new Set();
    lastActivityMs = null;
    rateWindowStartMs = null;
    rateEvents = 0;
    return Object.freeze({ ok: true, releaseAll: true });
  }

  function validateMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return fail('invalid_message');
    const size = serializedSize(message);
    if (size === null) return fail('unserializable_payload');
    if (size > limits.maxPayloadBytes) return fail('payload_too_large');
    if (!Object.hasOwn(ALLOWED_KEYS, message.type) || !exactKeys(message, ALLOWED_KEYS[message.type])) return fail('invalid_message_keys');
    if (!isSequence(message.sequence)) return fail('invalid_sequence');
    if (message.type === 'snapshot') {
      const buttons = validateButtons(message.buttons, limits);
      if (!buttons) return fail('invalid_buttons');
      return { ok: true, eventCount: buttons.size, projected: buttons };
    }
    if (message.type === 'delta') {
      const pressed = validateButtons(message.pressed, limits);
      const released = validateButtons(message.released, limits);
      if (!pressed || !released || pressed.size + released.size > limits.maxEventsPerMessage) return fail('invalid_events');
      for (const button of pressed) if (released.has(button)) return fail('conflicting_delta');
      const projected = new Set(projectedButtons);
      for (const button of pressed) projected.add(button);
      for (const button of released) projected.delete(button);
      return { ok: true, eventCount: pressed.size + released.size, projected };
    }
    return { ok: true, eventCount: 1, projected: new Set() };
  }

  function enqueue(message, { nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    if (!connected) return fail('not_connected', { releaseAll: true, resyncRequired: true });
    const validation = validateMessage(message);
    if (!validation.ok) return validation;
    if (message.sequence <= highestReceived) return fail('sequence_replay', { highestProcessedAck: highestProcessed });
    if (message.sequence !== highestReceived + 1) return releaseAndResync('sequence_gap');
    if (requireSnapshot && message.type !== 'snapshot') return releaseAndResync('snapshot_required');

    if (rateWindowStartMs === null || nowMs - rateWindowStartMs >= 1000) {
      rateWindowStartMs = nowMs;
      rateEvents = 0;
    }
    if (rateEvents + validation.eventCount > limits.maxEventsPerSecond) return releaseAndResync('rate_limited');
    rateEvents += validation.eventCount;
    highestReceived = message.sequence;
    projectedButtons = new Set(validation.projected);
    lastActivityMs = nowMs;
    if (message.type === 'snapshot') requireSnapshot = false;

    if (queue.length >= limits.maxQueueDepth) {
      queue = [Object.freeze({ type: 'snapshot', sequence: message.sequence, buttons: Object.freeze([...projectedButtons].sort()) })];
      return Object.freeze({ ok: true, compacted: true, queueDepth: 1, highestProcessedAck: highestProcessed });
    }
    queue.push(Object.freeze({ ...message, ...(message.buttons && { buttons: Object.freeze([...message.buttons]) }), ...(message.pressed && { pressed: Object.freeze([...message.pressed]) }), ...(message.released && { released: Object.freeze([...message.released]) }) }));
    return Object.freeze({ ok: true, compacted: false, queueDepth: queue.length, highestProcessedAck: highestProcessed });
  }

  function processNext({ nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    if (!connected) return fail('not_connected', { releaseAll: true, resyncRequired: true });
    const message = queue.shift();
    if (!message) return Object.freeze({ ok: true, empty: true, highestProcessedAck: highestProcessed, buttons: Object.freeze([...authoritativeButtons].sort()) });
    if (message.type === 'snapshot') authoritativeButtons = new Set(message.buttons);
    else if (message.type === 'delta') {
      for (const button of message.pressed) authoritativeButtons.add(button);
      for (const button of message.released) authoritativeButtons.delete(button);
    } else authoritativeButtons = new Set();
    highestProcessed = message.sequence;
    lastActivityMs = nowMs;
    return Object.freeze({ ok: true, empty: false, highestProcessedAck: highestProcessed, buttons: Object.freeze([...authoritativeButtons].sort()), type: message.type });
  }

  function watchdog({ nowMs } = {}) {
    if (!checkTime(nowMs)) return fail('invalid_time');
    if (!connected || lastActivityMs === null) return Object.freeze({ ok: true, triggered: false });
    if (nowMs - lastActivityMs < limits.watchdogMs) return Object.freeze({ ok: true, triggered: false });
    authoritativeButtons = new Set(); projectedButtons = new Set(); queue = []; requireSnapshot = true; lastActivityMs = nowMs;
    return Object.freeze({ ok: true, triggered: true, releaseAll: true, resyncRequired: true, highestProcessedAck: highestProcessed });
  }

  function status() {
    return Object.freeze({ connected, resyncRequired: requireSnapshot, highestReceived, highestProcessedAck: highestProcessed, queueDepth: queue.length, buttons: Object.freeze([...authoritativeButtons].sort()), projectedButtons: Object.freeze([...projectedButtons].sort()) });
  }
  return Object.freeze({ connect, disconnect, enqueue, processNext, watchdog, status });
}

module.exports = { HARD_CAPS, createInputProtocol, validateLimits };
