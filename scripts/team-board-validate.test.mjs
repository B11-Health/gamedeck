import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBoard } from './team-board-validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'ops', 'team-board.json'), 'utf8'));
const clone = () => structuredClone(original);
const expectError = (board, fragment) => {
  const errors = validateBoard(board);
  assert(errors.some((error) => error.includes(fragment)), `expected error containing "${fragment}", received: ${errors.join(' | ')}`);
};

assert.deepEqual(validateBoard(original), [], 'canonical board must validate');

{
  const board = clone();
  board.version = 1;
  expectError(board, 'version must equal 3');
}

{
  const board = clone();
  board.lanes[1].id = board.lanes[0].id;
  expectError(board, 'duplicate lane id');
}

{
  const board = clone();
  board.workItems[1].id = board.workItems[0].id;
  expectError(board, 'duplicate work item id');
}

{
  const board = clone();
  board.workItems[0].reviewerLane = board.workItems[0].ownerLane;
  expectError(board, 'ownerLane and reviewerLane must be different');
}

{
  const board = clone();
  board.workItems[1].scope.files = ['package.json'];
  board.workItems[1].scope.artifacts = [];
  board.workItems[0].scope.files.push('package.json');
  expectError(board, 'ownership collision');
}

{
  const board = clone();
  board.workItems[2].dependencies.push('missing-item');
  expectError(board, 'depends on unknown work item');
}

{
  const board = clone();
  board.workItems[2].dependencies = ['SEC-001'];
  board.workItems[3].dependencies = ['PLAY-002'];
  expectError(board, 'dependency cycle');
}

{
  const board = clone();
  board.workItems[2].nextAction = 'See https://chatgpt.com/c/private-room';
  expectError(board, 'private ChatGPT room URLs are forbidden');
}

{
  const board = clone();
  board.workItems[0].scope = { files: [], surfaces: [], artifacts: [] };
  expectError(board, 'owns no files, surfaces, or artifacts');
}

{
  const board = clone();
  board.workItems[2].status = 'ready';
  expectError(board, 'is ready but dependencies are incomplete');
}

{
  const board = clone();
  board.workItems[2].status = 'blocked';
  board.workItems[2].lastEvidenceAt = '2026-08-03T14:00:00-04:00';
  board.workItems[2].blocker = '';
  board.workItems[2].unblockOwner = '';
  expectError(board, 'blocker is required while blocked');
  expectError(board, 'unblockOwner is required while blocked');
}

{
  const board = clone();
  board.workItems[1].exactEvidence = [];
  expectError(board, 'exactEvidence must be non-empty');
}

{
  const board = clone();
  const second = structuredClone(board.workItems[8]);
  second.id = 'ANALYTICS-002';
  second.title = 'Second active analytics item';
  second.status = 'active';
  second.scope.artifacts = ['second analytics artifact'];
  second.startedAt = '2026-08-03T14:00:00-04:00';
  second.lastEvidenceAt = '2026-08-03T14:00:00-04:00';
  board.workItems[8].status = 'active';
  board.workItems[8].startedAt = '2026-08-03T14:00:00-04:00';
  board.workItems[8].lastEvidenceAt = '2026-08-03T14:00:00-04:00';
  board.workItems.push(second);
  expectError(board, 'owner WIP limit exceeded for analytics');
}

{
  const board = clone();
  board.operatingPolicy.staleAfterHours.review = 0;
  expectError(board, 'staleAfterHours.review must be a positive number');
}

{
  const board = clone();
  delete board.communicationReceiptSchema;
  delete board.operatingPolicy.crossLaneReceiptsRequired;
  expectError(board, 'communicationReceiptSchema must be an object');
  expectError(board, 'operatingPolicy.crossLaneReceiptsRequired must equal true');
}

{
  const board = clone();
  board.communicationReceiptSchema.requiredFields = [];
  expectError(board, 'communicationReceiptSchema.requiredFields must be non-empty');
  expectError(board, 'communicationReceiptSchema.requiredFields must include fromLane');
}

{
  const board = clone();
  board.communicationReceiptSchema.allowedEvents = [];
  expectError(board, 'communicationReceiptSchema.allowedEvents must be non-empty');
}

{
  const board = clone();
  board.programQueues = board.programQueues.filter((queue) => !['growth-community', 'monetization', 'analytics', 'partnerships'].includes(queue.lane));
  expectError(board, 'programQueues must contain exactly one queue for lane growth-community');
  expectError(board, 'programQueues must contain exactly one queue for lane monetization');
  expectError(board, 'programQueues must contain exactly one queue for lane analytics');
  expectError(board, 'programQueues must contain exactly one queue for lane partnerships');
}

{
  const board = clone();
  board.currentGitTruth.verifiedAt = '2020-01-01T00:00:00Z';
  board.currentGitTruth.originMain = 'not-a-commit';
  board.currentGitTruth.runtimeContract.artifactEvidence[0].canonicalLocation = '';
  board.currentGitTruth.runtimeContract.artifactEvidence[0].byteLength = -1;
  board.currentGitTruth.runtimeContract.artifactEvidence[0].sha256 = 'bad';
  board.currentGitTruth.runtimeContract.artifactEvidence[0].foundationCommit = 'bad';
  board.currentGitTruth.runtimeContract.artifactEvidence[0].baseCommit = 'bad';
  board.currentGitTruth.runtimeContract.artifactEvidence[0].reviewerLinkage = [];
  board.currentGitTruth.worktreeEvidence = null;
  expectError(board, 'currentGitTruth.verifiedAt must be within 24 hours');
  expectError(board, 'currentGitTruth.originMain must be a 40-hex commit');
  expectError(board, 'canonicalLocation is required');
  expectError(board, 'byteLength must be a non-negative integer');
  expectError(board, 'sha256 must be 64 hex characters');
  expectError(board, 'foundationCommit must be a 40-hex commit');
  expectError(board, 'baseCommit must be a 40-hex commit');
  expectError(board, 'reviewerLinkage must be a non-empty array');
  expectError(board, 'currentGitTruth.worktreeEvidence must be an object');
}

for (const value of [false, null]) {
  const board = clone();
  board.operatingPolicy.completedTaskMustCreateOrUnblockNext = value;
  expectError(board, 'operatingPolicy.completedTaskMustCreateOrUnblockNext must equal true');
}

{
  const board = clone();
  delete board.operatingPolicy.completedTaskMustCreateOrUnblockNext;
  expectError(board, 'operatingPolicy.completedTaskMustCreateOrUnblockNext must equal true');
}

for (const value of [false, null]) {
  const board = clone();
  board.operatingPolicy.artifactIntegrityGateRequired = value;
  expectError(board, 'operatingPolicy.artifactIntegrityGateRequired must equal true');
}

{
  const board = clone();
  delete board.operatingPolicy.artifactIntegrityGateRequired;
  expectError(board, 'operatingPolicy.artifactIntegrityGateRequired must equal true');
}

for (const value of ['', '   ', null]) {
  const board = clone();
  board.operatingPolicy.artifactIntegrityPolicy = value;
  expectError(board, 'operatingPolicy.artifactIntegrityPolicy must be non-empty');
}

for (const value of ['', '   ', null]) {
  const board = clone();
  board.operatingPolicy.completionContinuityPolicy = value;
  expectError(board, 'operatingPolicy.completionContinuityPolicy must be non-empty');
}

console.log('team-board validator: 30 scenarios passed');
