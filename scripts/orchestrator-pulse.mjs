import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBoard } from './team-board-validate.mjs';

const PRIORITY_RANK = new Map([['P0', 0], ['P1', 1], ['P2', 2]]);

function compareItems(a, b) {
  return (PRIORITY_RANK.get(a.priority) ?? 99) - (PRIORITY_RANK.get(b.priority) ?? 99) || a.id.localeCompare(b.id);
}

function hoursSince(value, now) {
  return (now.getTime() - new Date(value).getTime()) / 3_600_000;
}

export function buildPulse(board, now = new Date()) {
  const validationErrors = validateBoard(board);
  if (validationErrors.length) return { valid: false, validationErrors };

  const byId = new Map(board.workItems.map((item) => [item.id, item]));
  const focus = board.workItems.filter((item) => ['active', 'review', 'blocked'].includes(item.status)).sort(compareItems);
  const ready = board.workItems.filter((item) => item.status === 'ready').sort(compareItems);
  const newlyUnblocked = board.workItems.filter((item) => item.status === 'planned' && item.dependencies.every((id) => byId.get(id)?.status === 'complete')).sort(compareItems);
  const stale = board.workItems.filter((item) => ['active', 'review', 'blocked'].includes(item.status)).filter((item) => {
    const threshold = board.operatingPolicy.staleAfterHours[item.status];
    return hoursSince(item.lastEvidenceAt, now) > threshold;
  }).map((item) => ({
    id: item.id,
    status: item.status,
    ownerLane: item.ownerLane,
    hoursWithoutEvidence: Math.floor(hoursSince(item.lastEvidenceAt, now)),
    thresholdHours: board.operatingPolicy.staleAfterHours[item.status]
  })).sort((a, b) => b.hoursWithoutEvidence - a.hoursWithoutEvidence);

  const ownerLoad = {};
  const reviewLoad = {};
  for (const item of board.workItems) {
    if (item.status === 'active') ownerLoad[item.ownerLane] = (ownerLoad[item.ownerLane] || 0) + 1;
    if (item.status === 'review') reviewLoad[item.reviewerLane] = (reviewLoad[item.reviewerLane] || 0) + 1;
  }

  const criticalRisks = [
    ...board.workItems.filter((item) => item.priority === 'P0' && item.status === 'blocked').map((item) => ({ type: 'blocked-p0', id: item.id, detail: item.blocker })),
    ...stale.filter((item) => byId.get(item.id)?.priority === 'P0').map((item) => ({ type: 'stale-p0', id: item.id, detail: `${item.hoursWithoutEvidence}h without evidence` }))
  ];

  return {
    valid: true,
    generatedAt: now.toISOString(),
    northStar: board.northStar,
    focus,
    ready,
    newlyUnblocked,
    stale,
    criticalRisks,
    ownerLoad,
    reviewLoad
  };
}

export function formatPulse(pulse) {
  if (!pulse.valid) return ['ORCHESTRATOR PULSE INVALID', ...pulse.validationErrors.map((error) => `- ${error}`)].join('\n');
  const lines = [
    'GAMEDECK ORCHESTRATOR PULSE',
    `Generated: ${pulse.generatedAt}`,
    `North star: ${pulse.northStar}`,
    '',
    `Focus (${pulse.focus.length})`
  ];
  if (!pulse.focus.length) lines.push('- none');
  for (const item of pulse.focus) lines.push(`- [${item.priority}] ${item.id} ${item.status}: ${item.title} -> ${item.nextAction}`);
  lines.push('', `Executable now (${pulse.ready.length})`);
  if (!pulse.ready.length) lines.push('- none');
  for (const item of pulse.ready) lines.push(`- [${item.priority}] ${item.id}: ${item.title} (${item.ownerLane})`);
  lines.push('', `Promote from planned (${pulse.newlyUnblocked.length})`);
  if (!pulse.newlyUnblocked.length) lines.push('- none');
  for (const item of pulse.newlyUnblocked) lines.push(`- [${item.priority}] ${item.id}: ${item.title}`);
  lines.push('', `Stale (${pulse.stale.length})`);
  if (!pulse.stale.length) lines.push('- none');
  for (const item of pulse.stale) lines.push(`- ${item.id}: ${item.hoursWithoutEvidence}h without evidence (limit ${item.thresholdHours}h)`);
  lines.push('', `Critical risks (${pulse.criticalRisks.length})`);
  if (!pulse.criticalRisks.length) lines.push('- none');
  for (const risk of pulse.criticalRisks) lines.push(`- ${risk.id}: ${risk.detail}`);
  return lines.join('\n');
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const boardPath = path.resolve(here, '..', 'ops', 'team-board.json');
  let board;
  try {
    board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  } catch (error) {
    console.error(`Team board could not be read: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const pulse = buildPulse(board);
  if (process.argv.includes('--json')) console.log(JSON.stringify(pulse, null, 2));
  else console.log(formatPulse(pulse));
  if (!pulse.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
