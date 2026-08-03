import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_STATUSES = new Set(['planned','ready','active','blocked','review','approved','complete','paused']);
const OWNERSHIP_STATUSES = new Set(['active','review']);
const SCOPE_KINDS = ['files','surfaces','artifacts'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function findPrivateRoomReferences(value, at = 'board', found = []) {
  if (typeof value === 'string' && /https:\/\/chatgpt\.com\/c\//i.test(value)) found.push(at);
  if (Array.isArray(value)) value.forEach((item, index) => findPrivateRoomReferences(item, `${at}[${index}]`, found));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) findPrivateRoomReferences(item, `${at}.${key}`, found);
  }
  return found;
}

export function validateBoard(board) {
  const errors = [];
  if (!board || typeof board !== 'object' || Array.isArray(board)) return ['board must be a JSON object'];
  if (board.version !== 1) errors.push('version must equal 1');
  if (!isNonEmptyString(board.northStar) || board.northStar.trim().length < 40) errors.push('northStar must be a concrete sentence of at least 40 characters');
  if (!isNonEmptyString(board.updatedAt) || Number.isNaN(Date.parse(board.updatedAt))) errors.push('updatedAt must be a valid ISO date');
  if (!Array.isArray(board.lanes) || board.lanes.length === 0) errors.push('lanes must be a non-empty array');

  const privateRefs = findPrivateRoomReferences(board);
  if (privateRefs.length) errors.push(`private ChatGPT room URLs are forbidden in the public board: ${privateRefs.join(", ")}`);

  const lanes = Array.isArray(board.lanes) ? board.lanes : [];
  const ids = new Set();
  for (const [index, lane] of lanes.entries()) {
    const prefix = `lanes[${index}]`;
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(lane.id)) errors.push(`${prefix}.id is required`);
    else if (ids.has(lane.id)) errors.push(`duplicate lane id: ${lane.id}`);
    else ids.add(lane.id);
    if (!isNonEmptyString(lane.name)) errors.push(`${prefix}.name is required`);
    if (!isNonEmptyString(lane.mission)) errors.push(`${prefix}.mission is required`);
    if (!ALLOWED_STATUSES.has(lane.status)) errors.push(`${prefix}.status is invalid: ${lane.status}`);
    if (!isNonEmptyString(lane.ownerRole)) errors.push(`${prefix}.ownerRole is required`);
    if (!isNonEmptyString(lane.reviewerRole)) errors.push(`${prefix}.reviewerRole is required`);
    if (!Array.isArray(lane.dependencies)) errors.push(`${prefix}.dependencies must be an array`);
    if (!lane.scope || typeof lane.scope !== 'object' || Array.isArray(lane.scope)) errors.push(`${prefix}.scope must be an object`);
    for (const kind of SCOPE_KINDS) {
      const values = lane.scope?.[kind];
      if (!Array.isArray(values)) errors.push(`${prefix}.scope.${kind} must be an array`);
      else {
        const normalized = values.map((value) => typeof value === 'string' ? value.trim() : value);
        if (normalized.some((value) => !isNonEmptyString(value))) errors.push(`${prefix}.scope.${kind} contains an empty or non-string value`);
        if (new Set(normalized.map((value) => String(value).toLowerCase())).size !== normalized.length) errors.push(`${prefix}.scope.${kind} contains duplicates`);
      }
    }
    if (!Array.isArray(lane.evidenceRequired) || lane.evidenceRequired.length === 0) errors.push(`${prefix}.evidenceRequired must be non-empty`);
    if (!isNonEmptyString(lane.nextAction)) errors.push(`${prefix}.nextAction is required`);
    if (OWNERSHIP_STATUSES.has(lane.status)) {
      const scopeCount = SCOPE_KINDS.reduce((sum, kind) => sum + (Array.isArray(lane.scope?.[kind]) ? lane.scope[kind].length : 0), 0);
      if (scopeCount === 0) errors.push(`${prefix} is ${lane.status} but owns no files, surfaces, or artifacts`);
    }
  }

  for (const lane of lanes) {
    if (!lane || !Array.isArray(lane.dependencies)) continue;
    for (const dependency of lane.dependencies) {
      if (!ids.has(dependency)) errors.push(`lane ${lane.id} depends on unknown lane ${dependency}`);
      if (dependency === lane.id) errors.push(`lane ${lane.id} cannot depend on itself`);
    }
  }

  const ownership = new Map();
  for (const lane of lanes.filter((item) => OWNERSHIP_STATUSES.has(item?.status))) {
    for (const kind of SCOPE_KINDS) {
      for (const value of lane.scope?.[kind] || []) {
        const key = `${kind}:${value.trim().toLowerCase()}`;
        const prior = ownership.get(key);
        if (prior && prior !== lane.id) errors.push(`ownership collision for ${kind} "${value}": ${prior} and ${lane.id}`);
        else ownership.set(key, lane.id);
      }
    }
  }

  return errors;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultPath = path.resolve(here, '..', 'ops', 'team-board.json');
  const filePath = path.resolve(process.argv[2] || defaultPath);
  let board;
  try {
    board = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Team board could not be read: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = validateBoard(board);
  if (errors.length) {
    console.error('Team board validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const counts = board.lanes.reduce((result, lane) => {
    result[lane.status] = (result[lane.status] || 0) + 1;
    return result;
  }, {});
  console.log('Team board valid: ' + board.lanes.length + ' lanes; ' + Object.entries(counts).map(([status, count]) => status + '=' + count).join(', '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
