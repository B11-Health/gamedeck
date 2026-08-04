#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  createLedger,
  issue,
  accept,
  start,
  complete,
  handoff,
  uncertain,
  quarantine,
  recover,
  validateLedger,
  watch,
  summarize,
  formatWatch,
  loadLedger,
  saveLedger
} from './cadops-core.mjs';

const DEFAULT_LEDGER = 'ops/cadops/ledger.json';
const REPEATABLE = new Set(['artifact', 'check']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'json' || key === 'close-chain') {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    index += 1;
    if (REPEATABLE.has(key)) {
      flags[key] ||= [];
      flags[key].push(value);
    } else {
      if (flags[key] !== undefined) throw new Error(`duplicate flag: --${key}`);
      flags[key] = value;
    }
  }
  return { command, flags };
}

function required(flags, key) {
  const value = flags[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${key} is required`);
  return value.trim();
}

function dateFlag(flags) {
  return flags.at ? new Date(flags.at) : new Date();
}

function ledgerPath(flags) {
  return path.resolve(flags.ledger || DEFAULT_LEDGER);
}

function load(flags) {
  return loadLedger(ledgerPath(flags));
}

function persist(flags, operation) {
  const { ledger, result } = operation(load(flags));
  saveLedger(ledgerPath(flags), ledger);
  print(flags, result);
}

function print(flags, value) {
  if (flags.json || typeof value !== 'string') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

function usage() {
  return `GameDeck CADOps

Commands:
  init [--project GameDeck] [--ledger path]
  issue --lane E|T|M|W --objective text --assignee id --authorized-by id
  accept --ticket id --actor id
  start --ticket id --actor id --launch-evidence text
  complete --ticket id --actor id --outcome pass|fail|blocked|infrastructure-problem|application-problem
           --summary text --software-version ref [--artifact path] [--check text] [--close-chain]
  handoff --ticket id --lane E|T|M|W --objective text --assignee id --authorized-by id
  uncertain --ticket id --actor id --reason text
  quarantine --ticket id --actor id --reason text
  recover --ticket id --operator id --authorized-by id [--objective text]
  validate
  watch
  status
  show [--ticket id]

Common flags: --ledger path --at ISO --json`;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    console.log(usage());
    return;
  }

  if (command === 'init') {
    const file = ledgerPath(flags);
    if (fs.existsSync(file)) throw new Error(`ledger already exists: ${file}`);
    const ledger = createLedger(flags.project || 'GameDeck', dateFlag(flags));
    saveLedger(file, ledger);
    print(flags, summarize(ledger));
    return;
  }

  if (command === 'issue') {
    persist(flags, (ledger) => issue(ledger, {
      lane: required(flags, 'lane'),
      objective: required(flags, 'objective'),
      assignee: required(flags, 'assignee'),
      authorizedBy: required(flags, 'authorized-by'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'accept') {
    persist(flags, (ledger) => accept(ledger, {
      ticketId: required(flags, 'ticket'),
      actor: required(flags, 'actor'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'start') {
    persist(flags, (ledger) => start(ledger, {
      ticketId: required(flags, 'ticket'),
      actor: required(flags, 'actor'),
      launchEvidence: required(flags, 'launch-evidence'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'complete') {
    persist(flags, (ledger) => complete(ledger, {
      ticketId: required(flags, 'ticket'),
      actor: required(flags, 'actor'),
      outcome: required(flags, 'outcome'),
      summary: required(flags, 'summary'),
      softwareVersion: required(flags, 'software-version'),
      artifactPaths: flags.artifact || [],
      checks: flags.check || [],
      root: path.resolve(flags.root || process.cwd()),
      closeChain: Boolean(flags['close-chain']),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'handoff') {
    persist(flags, (ledger) => handoff(ledger, {
      ticketId: required(flags, 'ticket'),
      lane: required(flags, 'lane'),
      objective: required(flags, 'objective'),
      assignee: required(flags, 'assignee'),
      authorizedBy: required(flags, 'authorized-by'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'uncertain') {
    persist(flags, (ledger) => uncertain(ledger, {
      ticketId: required(flags, 'ticket'),
      actor: required(flags, 'actor'),
      reason: required(flags, 'reason'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'quarantine') {
    persist(flags, (ledger) => quarantine(ledger, {
      ticketId: required(flags, 'ticket'),
      actor: required(flags, 'actor'),
      reason: required(flags, 'reason'),
      at: dateFlag(flags)
    }));
    return;
  }

  if (command === 'recover') {
    persist(flags, (ledger) => recover(ledger, {
      ticketId: required(flags, 'ticket'),
      operator: required(flags, 'operator'),
      authorizedBy: required(flags, 'authorized-by'),
      objective: flags.objective,
      at: dateFlag(flags)
    }));
    return;
  }

  const ledger = load(flags);
  if (command === 'validate') {
    const errors = validateLedger(ledger);
    print(flags, { valid: errors.length === 0, errors, summary: errors.length ? null : summarize(ledger) });
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (command === 'watch') {
    const report = watch(ledger, dateFlag(flags));
    print(flags, flags.json ? report : formatWatch(report));
    if (report.risks.some((risk) => risk.severity === 'critical')) process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    const open = ledger.tickets
      .filter((ticket) => ['prepared', 'accepted', 'active', 'uncertain', 'quarantined'].includes(ticket.status))
      .map(({ id, lane, role, status, assignee, objective, predecessorTicketId, recoveryForTicketId }) => ({
        id, lane, role, status, assignee, objective, predecessorTicketId, recoveryForTicketId
      }));
    print(flags, { ...summarize(ledger), open });
    return;
  }

  if (command === 'show') {
    if (flags.ticket) {
      const found = ledger.tickets.find((ticket) => ticket.id === flags.ticket);
      if (!found) throw new Error(`unknown ticket: ${flags.ticket}`);
      print(flags, found);
    } else {
      print(flags, ledger);
    }
    return;
  }

  throw new Error(`unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`CADOps failed: ${error.message}`);
  process.exitCode = 1;
});
