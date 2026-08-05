import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  verifyReceipt,
  watch,
  saveLedger,
  loadLedger
} from './cadops-core.mjs';

const at = (hour) => new Date(`2026-08-03T${String(hour).padStart(2, '0')}:00:00.000Z`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-cadops-'));
fs.writeFileSync(path.join(tmp, 'artifact.txt'), 'exact GameDeck artifact\n');
const git = (...args) => execFileSync('git', args, {
  cwd: tmp,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
}).trim();
git('init', '-q');
git('config', 'user.name', 'GameDeck CADOps Test');
git('config', 'user.email', 'cadops-test@example.invalid');
git('add', 'artifact.txt');
git('commit', '-qm', 'fixture');
const fixtureCommit = git('rev-parse', 'HEAD');
const fixtureObjectId = git('rev-parse', `${fixtureCommit}:artifact.txt`);
const fixtureObjectFormat = git('rev-parse', '--show-object-format');

let ledger = createLedger('GameDeck', at(1));
assert.deepEqual(validateLedger(ledger), [], 'new ledger must validate');

let operation = issue(ledger, {
  lane: 'E',
  objective: 'Implement bounded feature',
  assignee: 'builder-1',
  authorizedBy: 'orchestrator',
  at: at(2)
});
ledger = operation.ledger;
assert.equal(operation.result.id, 'E-0001');
assert.equal(operation.result.role, 'builder');

ledger = accept(ledger, { ticketId: 'E-0001', actor: 'builder-1', at: at(3) }).ledger;
ledger = start(ledger, {
  ticketId: 'E-0001',
  actor: 'builder-1',
  launchEvidence: 'Authenticated Shell execution visible in assigned worktree',
  at: at(4)
}).ledger;
ledger = complete(ledger, {
  ticketId: 'E-0001',
  actor: 'builder-1',
  outcome: 'pass',
  summary: 'Implemented the bounded feature.',
  softwareVersion: fixtureCommit,
  artifactPaths: ['artifact.txt'],
  checks: ['unit tests passed'],
  root: tmp,
  at: at(5)
}).ledger;

const builder = ledger.tickets.find((ticket) => ticket.id === 'E-0001');
assert.equal(verifyReceipt(builder.receipt), true);
const canonicalArtifact = builder.receipt.artifacts[0];
assert.equal(canonicalArtifact.source, 'git-blob');
assert.equal(canonicalArtifact.commit, fixtureCommit);
assert.equal(canonicalArtifact.objectFormat, fixtureObjectFormat);
assert.equal(canonicalArtifact.objectId, fixtureObjectId);
assert.equal(canonicalArtifact.bytes, Buffer.byteLength('exact GameDeck artifact\n'));
assert.equal(
  canonicalArtifact.sha256,
  crypto.createHash('sha256').update('exact GameDeck artifact\n').digest('hex')
);

fs.writeFileSync(path.join(tmp, 'artifact.txt'), 'exact GameDeck artifact\r\n');
let portability = createLedger('GameDeck portability', at(1));
portability = issue(portability, {
  lane: 'E', objective: 'Verify canonical Git artifact hashing', assignee: 'portable-builder',
  authorizedBy: 'orchestrator', at: at(2)
}).ledger;
portability = accept(portability, { ticketId: 'E-0001', actor: 'portable-builder', at: at(3) }).ledger;
portability = start(portability, {
  ticketId: 'E-0001', actor: 'portable-builder', launchEvidence: 'worktree line endings changed', at: at(4)
}).ledger;
portability = complete(portability, {
  ticketId: 'E-0001', actor: 'portable-builder', outcome: 'pass', summary: 'Canonical blob remained stable.',
  softwareVersion: fixtureCommit, artifactPaths: ['artifact.txt'], checks: ['cross-worktree hash stable'], root: tmp, at: at(5)
}).ledger;
assert.deepEqual(portability.tickets[0].receipt.artifacts[0], canonicalArtifact);
assert.throws(
  () => start(ledger, { ticketId: 'E-0001', actor: 'builder-1', launchEvidence: 'retry', at: at(6) }),
  /replay-protected/
);
assert.throws(
  () => handoff(ledger, {
    ticketId: 'E-0001',
    lane: 'M',
    objective: 'Skip testing',
    assignee: 'supervisor-1',
    authorizedBy: 'orchestrator',
    at: at(6)
  }),
  /may not hand off/
);

operation = handoff(ledger, {
  ticketId: 'E-0001',
  lane: 'T',
  objective: 'Black-box test exact builder artifact',
  assignee: 'tester-1',
  authorizedBy: 'orchestrator',
  at: at(6)
});
ledger = operation.ledger;
assert.equal(operation.result.id, 'T-0001');
assert.equal(operation.result.predecessorReceiptHash, builder.receipt.hash);
assert.throws(
  () => handoff(ledger, {
    ticketId: 'E-0001',
    lane: 'T',
    objective: 'Duplicate handoff',
    assignee: 'tester-2',
    authorizedBy: 'orchestrator',
    at: at(7)
  }),
  /already handed off/
);

ledger = accept(ledger, { ticketId: 'T-0001', actor: 'tester-1', at: at(7) }).ledger;
ledger = start(ledger, {
  ticketId: 'T-0001',
  actor: 'tester-1',
  launchEvidence: 'Independent black-box session visibly active',
  at: at(8)
}).ledger;
ledger = complete(ledger, {
  ticketId: 'T-0001',
  actor: 'tester-1',
  outcome: 'pass',
  summary: 'Verified expected behavior without modifying implementation.',
  softwareVersion: fixtureCommit,
  checks: ['black-box behavior passed', 'receipt version matched'],
  root: tmp,
  at: at(9)
}).ledger;
assert.deepEqual(validateLedger(ledger), []);

const tamperedReceipt = structuredClone(ledger);
tamperedReceipt.tickets.find((ticket) => ticket.id === 'T-0001').receipt.summary = 'rewritten history';
assert(validateLedger(tamperedReceipt).some((error) => error.includes('invalid receipt')));

const tamperedEvent = structuredClone(ledger);
tamperedEvent.events[1].payload.objective = 'rewritten event';
assert(validateLedger(tamperedEvent).some((error) => error.includes('hash invalid')));

operation = issue(ledger, {
  lane: 'E',
  objective: 'Potentially uncertain side effect',
  assignee: 'builder-2',
  authorizedBy: 'orchestrator',
  at: at(10)
});
ledger = operation.ledger;
ledger = uncertain(ledger, {
  ticketId: operation.result.id,
  actor: 'watcher-1',
  reason: 'Connection ended after dispatch; execution cannot be disproven.',
  at: at(11)
}).ledger;
let report = watch(ledger, at(12));
assert(report.risks.some((risk) => risk.code === 'RECOVERY_REQUIRED'));
ledger = quarantine(ledger, {
  ticketId: 'E-0002',
  actor: 'watcher-1',
  reason: 'Original identity cannot be safely replayed.',
  at: at(12)
}).ledger;
operation = recover(ledger, {
  ticketId: 'E-0002',
  operator: 'recovery-operator',
  authorizedBy: 'watcher-1',
  at: at(13)
});
ledger = operation.ledger;
assert.equal(operation.result.id, 'E-0002-RECOVERY-RECOVERY-OPERATOR-0001');
assert.equal(ledger.tickets.find((ticket) => ticket.id === 'E-0002').status, 'quarantined');
assert.throws(
  () => recover(ledger, {
    ticketId: 'E-0002',
    operator: 'another-operator',
    authorizedBy: 'watcher-1',
    at: at(14)
  }),
  /already has recovery/
);
assert.throws(
  () => start(ledger, {
    ticketId: 'E-0002',
    actor: 'builder-2',
    launchEvidence: 'unsafe replay',
    at: at(14)
  }),
  /replay-protected/
);

const oldestFirst = createLedger('GameDeck', at(1));
let old = issue(oldestFirst, {
  lane: 'W',
  objective: 'Old watcher work',
  assignee: 'watcher-old',
  authorizedBy: 'orchestrator',
  at: at(2)
}).ledger;
old = issue(old, {
  lane: 'W',
  objective: 'New watcher work',
  assignee: 'watcher-new',
  authorizedBy: 'orchestrator',
  at: at(3)
}).ledger;
old = accept(old, { ticketId: 'W-0002', actor: 'watcher-new', at: at(4) }).ledger;
old = start(old, {
  ticketId: 'W-0002',
  actor: 'watcher-new',
  launchEvidence: 'visible newer launch',
  at: at(5)
}).ledger;
report = watch(old, at(6));
assert(report.risks.some((risk) => risk.code === 'OLDEST_FIRST_VIOLATION'));

const saved = path.join(tmp, 'ledger.json');
saveLedger(saved, ledger);
assert.deepEqual(loadLedger(saved), ledger);
assert.deepEqual(validateLedger(loadLedger(saved)), []);

console.log('cadops: 19 scenarios passed');
