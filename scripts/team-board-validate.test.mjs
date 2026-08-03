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
  assert(errors.some((error) => error.includes(fragment)), `expected error containing "${fragment}", received: ${errors.join(" | ")}`);
};

assert.deepEqual(validateBoard(original), [], 'canonical board must validate');

{
  const board = clone();
  board.lanes[1].id = board.lanes[0].id;
  expectError(board, 'duplicate lane id');
}

{
  const board = clone();
  board.lanes[1].status = 'active';
  board.lanes[1].scope.files = ['package.json'];
  expectError(board, 'ownership collision');
}

{
  const board = clone();
  board.lanes[0].reviewerRole = '';
  expectError(board, 'reviewerRole is required');
}

{
  const board = clone();
  board.lanes[2].dependencies.push('missing-lane');
  expectError(board, 'depends on unknown lane');
}

{
  const board = clone();
  board.lanes[2].nextAction = 'See https://chatgpt.com/c/private-room';
  expectError(board, 'private ChatGPT room URLs are forbidden');
}

{
  const board = clone();
  board.lanes[1].status = 'review';
  board.lanes[1].scope = { files: [], surfaces: [], artifacts: [] };
  expectError(board, 'owns no files, surfaces, or artifacts');
}

console.log('team-board validator: 7 tests passed');
