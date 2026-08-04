import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPulse, formatPulse } from './orchestrator-pulse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'ops', 'team-board.json'), 'utf8'));
const clone = () => structuredClone(original);
const priorityRank = new Map([['P0', 0], ['P1', 1], ['P2', 2]]);
const compareItems = (a, b) => (priorityRank.get(a.priority) ?? 99) - (priorityRank.get(b.priority) ?? 99) || a.id.localeCompare(b.id);

{
  const pulse = buildPulse(original, new Date('2026-08-03T18:11:00.000Z'));
  assert.equal(pulse.valid, true);
  const expectedFocus = original.workItems
    .filter((item) => item.priority === 'P0' && ['active', 'review'].includes(item.status))
    .sort(compareItems)
    .map((item) => item.id);
  const expectedReady = original.workItems
    .filter((item) => item.status === 'ready' && item.dependencies.every((dependency) => original.workItems.find((candidate) => candidate.id === dependency)?.status === 'complete'))
    .sort(compareItems)
    .map((item) => item.id);
  assert.deepEqual(pulse.focus.map((item) => item.id), expectedFocus);
  assert.deepEqual(pulse.ready.map((item) => item.id), expectedReady);
  assert.equal(pulse.criticalRisks.length, 0);
}

{
  const pulse = buildPulse(original, new Date('2026-08-05T18:11:00.000Z'));
  assert.equal(pulse.stale.some((item) => item.id === 'OPS-001'), false);
  assert(pulse.stale.some((item) => item.id === 'PLAY-001'));
  assert(pulse.criticalRisks.some((risk) => risk.id === 'PLAY-001'));
}

{
  const board = clone();
  board.workItems.find((item) => item.id === 'PLAY-001').status = 'complete';
  const pulse = buildPulse(board, new Date('2026-08-03T18:11:00.000Z'));
  assert(pulse.newlyUnblocked.some((item) => item.id === 'PLAY-002'));
  assert(pulse.newlyUnblocked.some((item) => item.id === 'SEC-001'));
  assert(pulse.newlyUnblocked.some((item) => item.id === 'COMPAT-001'));
}

{
  const board = clone();
  const item = board.workItems.find((entry) => entry.id === 'PLAY-002');
  item.status = 'blocked';
  item.blocker = 'Contract approval missing';
  item.unblockOwner = 'security-privacy';
  item.lastEvidenceAt = '2026-08-03T14:00:00-04:00';
  const pulse = buildPulse(board, new Date('2026-08-03T18:11:00.000Z'));
  assert(pulse.criticalRisks.some((risk) => risk.id === 'PLAY-002' && risk.type === 'blocked-p0'));
}

{
  const pulse = buildPulse(original, new Date('2026-08-03T18:11:00.000Z'));
  const text = formatPulse(pulse);
  assert.match(text, /GAMEDECK ORCHESTRATOR PULSE/);
  assert.match(text, /PLAY-001 (active|review)/);
  assert.doesNotMatch(text, /OPS-001 (active|review)/);
  for (const item of pulse.ready) assert.match(text, new RegExp(item.id));
  assert.doesNotMatch(text, /ANALYTICS-001/);
  assert.match(text, /Critical risks \(0\)/);
}

console.log('orchestrator pulse: 5 scenarios passed');
