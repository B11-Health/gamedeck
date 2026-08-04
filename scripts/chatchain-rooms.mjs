#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadLedger } from './cadops-core.mjs';
import {
  createRoomRegistry,
  loadRoomRegistry,
  saveRoomRegistry,
  validateRoomRegistry,
  bindRoom,
  verifyRoom,
  summarizeRoomRegistry,
  buildRoomPolicy
} from './chatchain-room-registry.mjs';

const DEFAULT_LEDGER = 'ops/cadops/ledger.json';
const DEFAULT_REGISTRY = '.cadops-private/chatchains/rooms.json';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['json', 'control', 'protected'].includes(key)) {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    if (flags[key] !== undefined) throw new Error(`duplicate flag: --${key}`);
    flags[key] = value;
    index += 1;
  }
  return { command, flags };
}

function required(flags, key) {
  const value = flags[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${key} is required`);
  return value.trim();
}

const at = (flags) => flags.at ? new Date(flags.at) : new Date();
const ledgerPath = (flags) => path.resolve(flags.ledger || DEFAULT_LEDGER);
const registryPath = (flags) => path.resolve(flags.rooms || DEFAULT_REGISTRY);
const print = (flags, value) => console.log(flags.json || typeof value !== 'string' ? JSON.stringify(value, null, 2) : value);

function loadBoth(flags) {
  const ledger = loadLedger(ledgerPath(flags));
  const registry = loadRoomRegistry(registryPath(flags));
  return { ledger, registry };
}

function usage() {
  return `GameDeck ChatChain room registry

Commands:
  init [--project GameDeck]
  bind --ticket E-0001 --url https://chatgpt.com/c/... --actor id [--title text] [--protected]
  bind --control --url https://chatgpt.com/c/... --actor id [--title "GameDeck Room Watch"]
  verify --ticket E-0001 --actor id
  validate
  status
  show [--ticket E-0001]

Common flags: --ledger path --rooms path --at ISO --json`;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || ['help', '--help'].includes(command)) {
    console.log(usage());
    return;
  }
  const file = registryPath(flags);
  if (command === 'init') {
    if (fs.existsSync(file)) throw new Error(`room registry already exists: ${file}`);
    const ledger = loadLedger(ledgerPath(flags));
    const registry = createRoomRegistry(flags.project || ledger.project || 'GameDeck', at(flags));
    saveRoomRegistry(file, registry, ledger);
    print(flags, summarizeRoomRegistry(registry, ledger));
    return;
  }
  const { ledger, registry } = loadBoth(flags);
  if (command === 'bind') {
    const operation = bindRoom(registry, ledger, {
      ticketId: flags.control ? null : required(flags, 'ticket'),
      url: required(flags, 'url'),
      title: flags.title || (flags.control ? 'GameDeck Room Watch' : ''),
      actor: required(flags, 'actor'),
      kind: flags.control ? 'control' : 'custody',
      protectedRoom: Boolean(flags.protected || flags.control),
      at: at(flags)
    });
    saveRoomRegistry(file, operation.registry, ledger);
    print(flags, operation.result);
    return;
  }
  if (command === 'verify') {
    const operation = verifyRoom(registry, ledger, { ticketId: required(flags, 'ticket') }, {
      actor: required(flags, 'actor'),
      at: at(flags)
    });
    saveRoomRegistry(file, operation.registry, ledger);
    print(flags, operation.result);
    return;
  }
  if (command === 'validate') {
    const errors = validateRoomRegistry(registry, ledger);
    print(flags, { valid: errors.length === 0, errors, summary: errors.length ? null : summarizeRoomRegistry(registry, ledger) });
    if (errors.length) process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    const policy = buildRoomPolicy(registry, ledger);
    const rooms = [...policy.values()].map(({ room, eligibility }) => ({
      id: room.id,
      kind: room.kind,
      ticketId: room.ticketId,
      lane: room.lane,
      role: room.role,
      title: room.title,
      state: room.state,
      protected: room.protected,
      verifiedAt: room.verifiedAt,
      disposition: eligibility.disposition,
      reason: eligibility.reason,
      successorTicketId: eligibility.successorTicketId || null
    }));
    print(flags, { ...summarizeRoomRegistry(registry, ledger), rooms });
    return;
  }
  if (command === 'show') {
    const room = flags.ticket
      ? registry.rooms.find((candidate) => candidate.ticketId === flags.ticket)
      : null;
    if (flags.ticket && !room) throw new Error(`room not found for ticket ${flags.ticket}`);
    print(flags, room || registry);
    return;
  }
  throw new Error(`unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`ChatChain rooms failed: ${error.message}`);
  process.exitCode = 1;
});
