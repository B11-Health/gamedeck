import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLedger, issue, accept, start, complete, handoff } from './cadops-core.mjs';
import {
  createRoomRegistry,
  validateRoomRegistry,
  bindRoom,
  verifyRoom,
  roomEligibility,
  buildRoomPolicy,
  markRoomClosed,
  markRoomUncertain,
  saveRoomRegistry,
  loadRoomRegistry
} from './chatchain-room-registry.mjs';

const at = (minute) => new Date(`2026-08-04T03:${String(minute).padStart(2, '0')}:00.000Z`);
const url = (name) => `https://chatgpt.com/c/${name}`;

let ledger = createLedger('GameDeck', at(0));
ledger = issue(ledger, { lane: 'E', objective: 'Build feature', assignee: 'builder', authorizedBy: 'orchestrator', at: at(1) }).ledger;
ledger = accept(ledger, { ticketId: 'E-0001', actor: 'builder', at: at(2) }).ledger;
ledger = start(ledger, { ticketId: 'E-0001', actor: 'builder', launchEvidence: 'visible builder room', at: at(3) }).ledger;
let registry = createRoomRegistry('GameDeck', at(0));
registry = bindRoom(registry, ledger, { ticketId: 'E-0001', url: url('builder-room'), actor: 'orchestrator', at: at(3) }).registry;
registry = verifyRoom(registry, ledger, { ticketId: 'E-0001' }, { actor: 'orchestrator', at: at(4) }).registry;
assert.deepEqual(validateRoomRegistry(registry, ledger), []);
assert.equal(roomEligibility(registry.rooms[0], ledger, registry).reason, 'ticket-active');
console.log('ok - active custody room is protected even when browser-idle');

assert.throws(() => bindRoom(registry, ledger, { ticketId: 'E-0001', url: url('duplicate-ticket'), actor: 'orchestrator' }), /already has a room/);
assert.throws(() => bindRoom(registry, ledger, { ticketId: null, kind: 'control', url: url('builder-room'), actor: 'orchestrator' }), /already bound/);
console.log('ok - one room per ticket and one ticket per conversation');

registry = bindRoom(registry, ledger, { kind: 'control', url: url('room-watch'), title: 'GameDeck Room Watch', actor: 'orchestrator', at: at(5) }).registry;
assert.equal(roomEligibility(registry.rooms.find((room) => room.kind === 'control'), ledger, registry).reason, 'room-protected');
console.log('ok - control room is permanently protected');

ledger = complete(ledger, {
  ticketId: 'E-0001', actor: 'builder', outcome: 'pass', summary: 'Built feature', softwareVersion: 'builder-v1', at: at(6)
}).ledger;
assert.equal(roomEligibility(registry.rooms[0], ledger, registry).reason, 'custody-not-passed');
console.log('ok - completed room stays protected until custody passes');

ledger = handoff(ledger, {
  ticketId: 'E-0001', lane: 'T', objective: 'Test feature', assignee: 'tester', authorizedBy: 'orchestrator', at: at(7)
}).ledger;
registry = bindRoom(registry, ledger, { ticketId: 'T-0001', url: url('tester-room'), actor: 'orchestrator', at: at(8) }).registry;
registry = verifyRoom(registry, ledger, { ticketId: 'T-0001' }, { actor: 'orchestrator', at: at(9) }).registry;
assert.equal(roomEligibility(registry.rooms[0], ledger, registry).reason, 'successor-ticket-prepared');
console.log('ok - verified successor room does not close predecessor before acceptance');

ledger = accept(ledger, { ticketId: 'T-0001', actor: 'tester', at: at(10) }).ledger;
const eligible = roomEligibility(registry.rooms[0], ledger, registry);
assert.equal(eligible.disposition, 'eligible');
assert.equal(eligible.successorTicketId, 'T-0001');
assert.equal(buildRoomPolicy(registry, ledger).get('builder-room').eligibility.disposition, 'eligible');
console.log('ok - predecessor becomes eligible only after verified successor accepts custody');

{
  const successorUncertain = markRoomUncertain(registry, ledger, { ticketId: 'T-0001' }, {
    actor: 'watcher', reason: 'successor room connection became uncertain', targetId: 'target-next', at: at(10)
  }).registry;
  const revoked = roomEligibility(successorUncertain.rooms.find((room) => room.ticketId === 'E-0001'), ledger, successorUncertain);
  assert.equal(revoked.disposition, 'unknown');
  assert.equal(revoked.reason, 'successor-room-uncertain');
}
console.log('ok - successor uncertainty revokes predecessor close eligibility');

const closed = markRoomClosed(registry, ledger, { ticketId: 'E-0001' }, {
  actor: 'browser-watcher', targetId: 'target-old', reason: 'successor-custody-visible', successorTicketId: 'T-0001', at: at(11)
});
registry = closed.registry;
assert.equal(closed.result.state, 'closed');
assert.match(closed.result.closeReceipt.hash, /^[a-f0-9]{64}$/);
assert.deepEqual(validateRoomRegistry(registry, ledger), []);
console.log('ok - verified closure creates a hash-bound room receipt');

const tampered = structuredClone(registry);
tampered.rooms.find((room) => room.ticketId === 'E-0001').closeReceipt.targetId = 'rewritten-target';
assert(validateRoomRegistry(tampered, ledger).some((error) => error.includes('valid close receipt')));
console.log('ok - room close receipt tampering is detected');

let uncertainLedger = createLedger('GameDeck', at(0));
uncertainLedger = issue(uncertainLedger, { lane: 'E', objective: 'Uncertain work', assignee: 'builder', authorizedBy: 'orchestrator', at: at(1) }).ledger;
let uncertainRegistry = createRoomRegistry('GameDeck', at(0));
uncertainRegistry = bindRoom(uncertainRegistry, uncertainLedger, { ticketId: 'E-0001', url: url('uncertain-room'), actor: 'orchestrator', at: at(2) }).registry;
uncertainRegistry = markRoomUncertain(uncertainRegistry, uncertainLedger, { ticketId: 'E-0001' }, {
  actor: 'watcher', reason: 'close dispatch result unknown', targetId: 'uncertain-target', at: at(3)
}).registry;
assert.equal(roomEligibility(uncertainRegistry.rooms[0], uncertainLedger, uncertainRegistry).disposition, 'unknown');
assert.throws(() => markRoomUncertain(uncertainRegistry, uncertainLedger, { ticketId: 'E-0001' }, { actor: 'watcher', reason: 'replay' }), /cannot become uncertain/);
console.log('ok - uncertain room closure is non-replayable');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-room-registry-'));
const file = path.join(folder, 'rooms.json');
saveRoomRegistry(file, registry, ledger);
assert.deepEqual(loadRoomRegistry(file), registry);
assert.equal(fs.readdirSync(folder).some((name) => name.endsWith('.tmp')), false);
console.log('ok - room registry saves atomically');

console.log('chatchain room registry: 11 scenarios passed');
