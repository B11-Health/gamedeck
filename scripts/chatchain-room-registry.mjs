import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CHAT_HOST = 'chatgpt.com';
const CHAT_PATH = /^\/c\/([A-Za-z0-9-]+)(?:[/?#]|$)/;
const ROOM_ID = /^ROOM-\d{4}$/;
const ROOM_STATES = new Set(['open', 'closed', 'uncertain']);
const TICKET_OPEN = new Set(['prepared', 'accepted', 'active', 'uncertain', 'quarantined']);
const TICKET_SUCCESSOR_READY = new Set(['accepted', 'active', 'completed']);

const clone = (value) => structuredClone(value);
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
export const hashObject = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const required = (value, name) => {
  if (!nonEmpty(String(value || ''))) throw new Error(name + ' is required');
  return String(value).trim();
};
const iso = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp');
  return date.toISOString();
};

export function conversationIdentity(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== CHAT_HOST) return null;
    return url.pathname.match(CHAT_PATH)?.[1] || null;
  } catch {
    return null;
  }
}

function canonicalChatUrl(value) {
  const conversationId = conversationIdentity(value);
  if (!conversationId) throw new Error('room URL must be a ChatGPT conversation URL');
  return `https://${CHAT_HOST}/c/${conversationId}`;
}

function addEvent(registry, type, actor, payload = {}, roomId = null, at = new Date()) {
  registry.counters.event += 1;
  const event = {
    eventId: `ROOM-EVT-${String(registry.counters.event).padStart(6, '0')}`,
    type: required(type, 'event type'),
    roomId,
    actor: required(actor, 'event actor'),
    at: iso(at),
    previousHash: registry.events.at(-1)?.hash || null,
    payload: clone(payload)
  };
  event.hash = hashObject(event);
  registry.events.push(event);
  registry.updatedAt = event.at;
}

export function createRoomRegistry(project = 'GameDeck', at = new Date()) {
  const timestamp = iso(at);
  const registry = {
    schemaVersion: 1,
    project: required(project, 'project'),
    createdAt: timestamp,
    updatedAt: timestamp,
    counters: { room: 0, event: 0 },
    rooms: [],
    events: []
  };
  addEvent(registry, 'registry.initialized', 'chatchain-system', { project: registry.project }, null, at);
  return registry;
}

function ticketMap(ledger) {
  return new Map((ledger?.tickets || []).map((ticket) => [ticket.id, ticket]));
}

function receiptValid(receipt) {
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.hash || '')) return false;
  const { hash, ...body } = receipt;
  return hashObject(body) === hash;
}

export function validateRoomRegistry(registry, ledger = null) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return ['room registry must be an object'];
  if (registry.schemaVersion !== 1) errors.push('room registry schemaVersion must equal 1');
  if (!nonEmpty(registry.project)) errors.push('room registry project is required');
  if (!registry.counters || !Array.isArray(registry.rooms) || !Array.isArray(registry.events)) {
    return [...errors, 'room registry counters, rooms, and events are required'];
  }
  const tickets = ticketMap(ledger);
  const roomIds = new Set();
  const conversations = new Set();
  const custodyTickets = new Set();
  for (const [index, room] of registry.rooms.entries()) {
    const prefix = `rooms[${index}]`;
    if (!ROOM_ID.test(room.id || '') || roomIds.has(room.id)) errors.push(`${prefix}.id invalid or duplicate`);
    roomIds.add(room.id);
    if (!['custody', 'control'].includes(room.kind)) errors.push(`${prefix}.kind invalid`);
    if (!ROOM_STATES.has(room.state)) errors.push(`${prefix}.state invalid`);
    if (!nonEmpty(room.conversationId) || conversations.has(room.conversationId)) errors.push(`${prefix}.conversationId missing or duplicate`);
    conversations.add(room.conversationId);
    if (conversationIdentity(room.url) !== room.conversationId) errors.push(`${prefix}.url identity mismatch`);
    if (!nonEmpty(room.boundBy) || !room.boundAt) errors.push(`${prefix} binding evidence missing`);
    if (room.kind === 'control') {
      if (room.ticketId !== null) errors.push(`${prefix} control room must not have a ticket`);
      if (!room.protected) errors.push(`${prefix} control room must be protected`);
    } else {
      if (!nonEmpty(room.ticketId) || custodyTickets.has(room.ticketId)) errors.push(`${prefix}.ticketId missing or duplicate`);
      custodyTickets.add(room.ticketId);
      if (ledger) {
        const ticket = tickets.get(room.ticketId);
        if (!ticket) errors.push(`${prefix}.ticketId not found in ledger`);
        else if (room.lane !== ticket.lane || room.role !== ticket.role) errors.push(`${prefix}.lane/role does not match ticket`);
      }
    }
    if (room.state === 'closed' && !receiptValid(room.closeReceipt)) errors.push(`${prefix} closed without a valid close receipt`);
    if (room.state !== 'closed' && room.closeReceipt) errors.push(`${prefix} premature close receipt`);
    if (room.state === 'uncertain' && !room.uncertainty) errors.push(`${prefix} uncertain without evidence`);
    if (room.state !== 'uncertain' && room.uncertainty) errors.push(`${prefix} premature uncertainty evidence`);
  }
  let previousHash = null;
  const eventIds = new Set();
  for (const [index, event] of registry.events.entries()) {
    if (!nonEmpty(event.eventId) || eventIds.has(event.eventId)) errors.push(`events[${index}].eventId invalid`);
    eventIds.add(event.eventId);
    if (event.previousHash !== previousHash) errors.push(`events[${index}] chain broken`);
    const { hash, ...body } = event;
    if (!/^[a-f0-9]{64}$/.test(hash || '') || hashObject(body) !== hash) errors.push(`events[${index}] hash invalid`);
    previousHash = hash;
  }
  if (registry.counters.event !== registry.events.length) errors.push('room event counter mismatch');
  if (registry.counters.room !== registry.rooms.length) errors.push('room counter mismatch');
  return errors;
}

function mutate(registry, ledger, operation) {
  const before = validateRoomRegistry(registry, ledger);
  if (before.length) throw new Error('invalid room registry: ' + before.join(' | '));
  const next = clone(registry);
  const result = operation(next);
  const after = validateRoomRegistry(next, ledger);
  if (after.length) throw new Error('invalid room registry after operation: ' + after.join(' | '));
  return { registry: next, result };
}

function findRoom(registry, { roomId, ticketId, conversationId } = {}) {
  const matches = registry.rooms.filter((room) =>
    (roomId && room.id === roomId) ||
    (ticketId && room.ticketId === ticketId) ||
    (conversationId && room.conversationId === conversationId));
  if (matches.length !== 1) throw new Error(matches.length ? 'room selector is ambiguous' : 'room was not found');
  return matches[0];
}

export function bindRoom(registry, ledger, {
  ticketId = null,
  url,
  title = '',
  actor,
  kind = ticketId ? 'custody' : 'control',
  protectedRoom = kind === 'control',
  at = new Date()
}) {
  return mutate(registry, ledger, (next) => {
    const conversationId = conversationIdentity(url);
    if (!conversationId) throw new Error('room URL must be a ChatGPT conversation URL');
    if (next.rooms.some((room) => room.conversationId === conversationId)) throw new Error('conversation is already bound');
    let lane = null;
    let role = null;
    if (kind === 'custody') {
      const ticket = ticketMap(ledger).get(required(ticketId, 'ticketId'));
      if (!ticket) throw new Error('ticket was not found in ledger');
      if (!TICKET_OPEN.has(ticket.status)) throw new Error(`ticket ${ticket.id} cannot bind a room from ${ticket.status}`);
      if (next.rooms.some((room) => room.ticketId === ticket.id)) throw new Error('ticket already has a room');
      lane = ticket.lane;
      role = ticket.role;
    } else if (kind !== 'control') {
      throw new Error('invalid room kind');
    }
    next.counters.room += 1;
    const room = {
      id: `ROOM-${String(next.counters.room).padStart(4, '0')}`,
      kind,
      ticketId: kind === 'custody' ? ticketId : null,
      lane,
      role,
      conversationId,
      url: canonicalChatUrl(url),
      title: String(title || '').trim(),
      protected: Boolean(protectedRoom),
      state: 'open',
      boundAt: iso(at),
      boundBy: required(actor, 'actor'),
      verifiedAt: null,
      verifiedBy: null,
      closedAt: null,
      closeReceipt: null,
      uncertainty: null
    };
    next.rooms.push(room);
    addEvent(next, 'room.bound', actor, {
      kind: room.kind,
      ticketId: room.ticketId,
      conversationId: room.conversationId,
      protected: room.protected
    }, room.id, at);
    return room;
  });
}

export function verifyRoom(registry, ledger, selector, { actor, at = new Date() }) {
  return mutate(registry, ledger, (next) => {
    const room = findRoom(next, selector);
    if (room.state !== 'open') throw new Error(`room ${room.id} cannot be verified from ${room.state}`);
    room.verifiedAt = iso(at);
    room.verifiedBy = required(actor, 'actor');
    addEvent(next, 'room.verified', actor, { ticketId: room.ticketId, conversationId: room.conversationId }, room.id, at);
    return room;
  });
}

export function roomEligibility(room, ledger, registry) {
  if (!room) return { disposition: 'unmanaged', reason: 'room-not-registered' };
  if (room.state === 'closed') return { disposition: 'closed', reason: 'room-already-closed' };
  if (room.state === 'uncertain') return { disposition: 'unknown', reason: 'room-close-uncertain' };
  if (room.protected || room.kind === 'control') return { disposition: 'keep', reason: 'room-protected' };
  const ticket = ticketMap(ledger).get(room.ticketId);
  if (!ticket) return { disposition: 'unknown', reason: 'ticket-missing' };
  if (TICKET_OPEN.has(ticket.status)) return { disposition: 'keep', reason: `ticket-${ticket.status}` };
  if (ticket.status !== 'completed' || !ticket.receipt) return { disposition: 'unknown', reason: 'ticket-state-invalid' };
  if (ticket.receipt.chainDisposition === 'closed') {
    return { disposition: 'eligible', reason: 'watcher-closed-chain', ticketId: ticket.id };
  }
  if (!ticket.successorTicketId) return { disposition: 'keep', reason: 'custody-not-passed' };
  const successorTicket = ticketMap(ledger).get(ticket.successorTicketId);
  if (!successorTicket) return { disposition: 'unknown', reason: 'successor-ticket-missing' };
  const successorRoom = registry.rooms.find((candidate) => candidate.ticketId === successorTicket.id);
  if (!successorRoom) return { disposition: 'keep', reason: 'successor-room-not-bound', successorTicketId: successorTicket.id };
  if (successorRoom.state === 'uncertain') return { disposition: 'unknown', reason: 'successor-room-uncertain', successorTicketId: successorTicket.id };
  if (!['open', 'closed'].includes(successorRoom.state)) return { disposition: 'unknown', reason: 'successor-room-state-invalid', successorTicketId: successorTicket.id };
  if (!successorRoom.verifiedAt) return { disposition: 'keep', reason: 'successor-room-not-verified', successorTicketId: successorTicket.id };
  if (!TICKET_SUCCESSOR_READY.has(successorTicket.status)) {
    return { disposition: 'keep', reason: `successor-ticket-${successorTicket.status}`, successorTicketId: successorTicket.id };
  }
  return {
    disposition: 'eligible',
    reason: 'successor-custody-visible',
    ticketId: ticket.id,
    successorTicketId: successorTicket.id,
    successorConversationId: successorRoom.conversationId
  };
}

export function buildRoomPolicy(registry, ledger) {
  const errors = validateRoomRegistry(registry, ledger);
  if (errors.length) throw new Error('invalid room registry: ' + errors.join(' | '));
  return new Map(registry.rooms.map((room) => [room.conversationId, {
    room,
    eligibility: roomEligibility(room, ledger, registry)
  }]));
}

export function markRoomClosed(registry, ledger, selector, {
  actor,
  targetId,
  reason,
  successorTicketId = null,
  at = new Date()
}) {
  return mutate(registry, ledger, (next) => {
    const room = findRoom(next, selector);
    const eligibility = roomEligibility(room, ledger, next);
    if (eligibility.disposition !== 'eligible') throw new Error(`room ${room.id} is not close-eligible: ${eligibility.reason}`);
    const receipt = {
      roomId: room.id,
      ticketId: room.ticketId,
      conversationId: room.conversationId,
      targetId: required(targetId, 'targetId'),
      reason: required(reason || eligibility.reason, 'reason'),
      successorTicketId: successorTicketId || eligibility.successorTicketId || null,
      closedAt: iso(at),
      closedBy: required(actor, 'actor')
    };
    receipt.hash = hashObject(receipt);
    room.state = 'closed';
    room.closedAt = receipt.closedAt;
    room.closeReceipt = receipt;
    addEvent(next, 'room.closed', actor, {
      ticketId: room.ticketId,
      targetId: receipt.targetId,
      closeReceiptHash: receipt.hash,
      successorTicketId: receipt.successorTicketId
    }, room.id, at);
    return room;
  });
}

export function markRoomUncertain(registry, ledger, selector, { actor, reason, targetId = null, at = new Date() }) {
  return mutate(registry, ledger, (next) => {
    const room = findRoom(next, selector);
    if (room.state !== 'open') throw new Error(`room ${room.id} cannot become uncertain from ${room.state}`);
    room.state = 'uncertain';
    room.uncertainty = {
      markedAt: iso(at),
      markedBy: required(actor, 'actor'),
      reason: required(reason, 'reason'),
      targetId: targetId ? String(targetId) : null
    };
    addEvent(next, 'room.uncertain', actor, room.uncertainty, room.id, at);
    return room;
  });
}

export function summarizeRoomRegistry(registry, ledger = null) {
  const errors = validateRoomRegistry(registry, ledger);
  if (errors.length) throw new Error(errors.join(' | '));
  const byState = {};
  const byKind = {};
  for (const room of registry.rooms) {
    byState[room.state] = (byState[room.state] || 0) + 1;
    byKind[room.kind] = (byKind[room.kind] || 0) + 1;
  }
  return {
    project: registry.project,
    schemaVersion: registry.schemaVersion,
    updatedAt: registry.updatedAt,
    lastEventHash: registry.events.at(-1)?.hash || null,
    roomCount: registry.rooms.length,
    byState,
    byKind
  };
}

export function loadRoomRegistry(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveRoomRegistry(file, registry, ledger = null) {
  const errors = validateRoomRegistry(registry, ledger);
  if (errors.length) throw new Error(errors.join(' | '));
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, absolute);
}
