import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_STATUSES = new Set(['planned', 'ready', 'active', 'blocked', 'review', 'approved', 'complete', 'paused']);
const ALLOWED_PRIORITIES = new Set(['P0', 'P1', 'P2']);
const OWNERSHIP_STATUSES = new Set(['active', 'review']);
const EVIDENCE_STATUSES = new Set(['review', 'approved', 'complete']);
const SCOPE_KINDS = ['files', 'surfaces', 'artifacts'];
const REQUIRED_RECEIPT_FIELDS = ['fromLane', 'toLane', 'workItem', 'event', 'immutableTarget', 'messageOrArtifact', 'sentAt', 'acknowledgedAt', 'executionEvidence', 'nextBoundedAction'];
const RECEIPT_EVENTS = new Set(['dispatch', 'acceptance', 'evidence', 'blocker', 'rejection', 'correction', 'approval', 'integration', 'completion', 'stale-recovery']);
const REQUIRED_PROGRAM_QUEUE_LANES = ['growth-community', 'monetization', 'analytics', 'partnerships'];
const REVIEW_LINK_STATUSES = new Set(['pending', 'in-review', 'approved', 'rejected', 'hold']);
const HEX40 = /^[0-9a-f]{40}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
const GIT_TRUTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const GIT_TRUTH_MAX_FUTURE_MS = 5 * 60 * 1000;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateFreshTimestamp(value, reference, at, errors) {
  if (!isIsoDate(value)) {
    errors.push(`${at} must be a valid ISO date`);
    return;
  }
  if (!isIsoDate(reference)) return;
  const delta = Date.parse(reference) - Date.parse(value);
  if (delta > GIT_TRUTH_MAX_AGE_MS || delta < -GIT_TRUTH_MAX_FUTURE_MS) errors.push(`${at} must be within 24 hours before and 5 minutes after updatedAt`);
}

function isHexCommit(value) {
  return isNonEmptyString(value) && HEX40.test(value);
}

function isSha256(value) {
  return isNonEmptyString(value) && HEX64.test(value);
}

function findPrivateRoomReferences(value, at = 'board', found = []) {
  if (typeof value === 'string' && /https:\/\/chatgpt\.com\/c\//i.test(value)) found.push(at);
  if (Array.isArray(value)) value.forEach((item, index) => findPrivateRoomReferences(item, `${at}[${index}]`, found));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) findPrivateRoomReferences(item, `${at}.${key}`, found);
  }
  return found;
}

function validateStringArray(value, at, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${at} must be an array`);
    return [];
  }
  const normalized = value.map((item) => typeof item === 'string' ? item.trim() : item);
  if (nonEmpty && normalized.length === 0) errors.push(`${at} must be non-empty`);
  if (normalized.some((item) => !isNonEmptyString(item))) errors.push(`${at} contains an empty or non-string value`);
  if (new Set(normalized.map((item) => String(item).toLowerCase())).size !== normalized.length) errors.push(`${at} contains duplicates`);
  return normalized;
}

function scopeCount(scope) {
  return SCOPE_KINDS.reduce((sum, kind) => sum + (Array.isArray(scope?.[kind]) ? scope[kind].length : 0), 0);
}

function validateScope(scope, at, errors) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    errors.push(`${at} must be an object`);
    return;
  }
  for (const kind of SCOPE_KINDS) validateStringArray(scope[kind], `${at}.${kind}`, errors);
}

function validateCommunicationControls(board, policy, errors) {
  if (policy?.crossLaneReceiptsRequired !== true) errors.push('operatingPolicy.crossLaneReceiptsRequired must equal true');
  const schema = board.communicationReceiptSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push('communicationReceiptSchema must be an object');
    return;
  }
  const fields = validateStringArray(schema.requiredFields, 'communicationReceiptSchema.requiredFields', errors, { nonEmpty: true });
  for (const field of REQUIRED_RECEIPT_FIELDS) {
    if (!fields.includes(field)) errors.push(`communicationReceiptSchema.requiredFields must include ${field}`);
  }
  const events = validateStringArray(schema.allowedEvents, 'communicationReceiptSchema.allowedEvents', errors, { nonEmpty: true });
  for (const event of events) {
    if (isNonEmptyString(event) && !RECEIPT_EVENTS.has(event)) errors.push(`communicationReceiptSchema.allowedEvents contains unsupported event ${event}`);
  }
}

function validateProgramQueues(board, errors) {
  const queues = board.programQueues;
  if (!Array.isArray(queues)) {
    errors.push('programQueues must be an array');
    return;
  }
  const ids = new Set();
  const lanes = new Map();
  for (const [index, queue] of queues.entries()) {
    const prefix = `programQueues[${index}]`;
    if (!queue || typeof queue !== 'object' || Array.isArray(queue)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(queue.id)) errors.push(`${prefix}.id is required`);
    else if (ids.has(queue.id)) errors.push(`duplicate program queue id: ${queue.id}`);
    else ids.add(queue.id);
    if (!REQUIRED_PROGRAM_QUEUE_LANES.includes(queue.lane)) errors.push(`${prefix}.lane is invalid: ${queue.lane}`);
    else lanes.set(queue.lane, (lanes.get(queue.lane) || 0) + 1);
    if (!ALLOWED_STATUSES.has(queue.status)) errors.push(`${prefix}.status is invalid: ${queue.status}`);
    if (!isNonEmptyString(queue.entryRule)) errors.push(`${prefix}.entryRule is required`);
    if (!isNonEmptyString(queue.nextBoundedTask)) errors.push(`${prefix}.nextBoundedTask is required`);
  }
  for (const lane of REQUIRED_PROGRAM_QUEUE_LANES) {
    if ((lanes.get(lane) || 0) !== 1) errors.push(`programQueues must contain exactly one queue for lane ${lane}`);
  }
}

function validateCurrentGitTruth(board, errors) {
  const reviewerRefs = [];
  const truth = board.currentGitTruth;
  if (!truth || typeof truth !== 'object' || Array.isArray(truth)) {
    errors.push('currentGitTruth must be an object');
    return reviewerRefs;
  }
  validateFreshTimestamp(truth.verifiedAt, board.updatedAt, 'currentGitTruth.verifiedAt', errors);
  if (!isHexCommit(truth.originMain)) errors.push('currentGitTruth.originMain must be a 40-hex commit');

  const runtime = truth.runtimeContract;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    errors.push('currentGitTruth.runtimeContract must be an object');
  } else if (isNonEmptyString(runtime.currentVerifiedVersion) || isNonEmptyString(runtime.status)) {
    const artifacts = runtime.artifactEvidence;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      errors.push('currentGitTruth.runtimeContract.artifactEvidence must be a non-empty array when a runtime contract is claimed');
    } else {
      const identities = new Set();
      const locations = new Set();
      for (const [index, artifact] of artifacts.entries()) {
        const prefix = `currentGitTruth.runtimeContract.artifactEvidence[${index}]`;
        if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
          errors.push(`${prefix} must be an object`);
          continue;
        }
        if (!isNonEmptyString(artifact.identity)) errors.push(`${prefix}.identity is required`);
        else if (identities.has(artifact.identity)) errors.push(`${prefix}.identity must be unique`);
        else identities.add(artifact.identity);
        if (!isNonEmptyString(artifact.canonicalLocation)) errors.push(`${prefix}.canonicalLocation is required`);
        else if (locations.has(artifact.canonicalLocation)) errors.push(`${prefix}.canonicalLocation must be unique`);
        else locations.add(artifact.canonicalLocation);
        if (!Number.isInteger(artifact.byteLength) || artifact.byteLength < 0) errors.push(`${prefix}.byteLength must be a non-negative integer`);
        if (!isSha256(artifact.sha256)) errors.push(`${prefix}.sha256 must be 64 hex characters`);
        if (!isHexCommit(artifact.foundationCommit)) errors.push(`${prefix}.foundationCommit must be a 40-hex commit`);
        if (!isHexCommit(artifact.baseCommit)) errors.push(`${prefix}.baseCommit must be a 40-hex commit`);
        if (!Array.isArray(artifact.reviewerLinkage) || artifact.reviewerLinkage.length === 0) {
          errors.push(`${prefix}.reviewerLinkage must be a non-empty array`);
        } else {
          const reviewerLanes = new Set();
          for (const [linkIndex, link] of artifact.reviewerLinkage.entries()) {
            const linkPrefix = `${prefix}.reviewerLinkage[${linkIndex}]`;
            if (!link || typeof link !== 'object' || Array.isArray(link)) {
              errors.push(`${linkPrefix} must be an object`);
              continue;
            }
            if (!isNonEmptyString(link.reviewerLane)) errors.push(`${linkPrefix}.reviewerLane is required`);
            else if (reviewerLanes.has(link.reviewerLane)) errors.push(`${linkPrefix}.reviewerLane must be unique within artifact linkage`);
            else { reviewerLanes.add(link.reviewerLane); reviewerRefs.push({ at: `${linkPrefix}.reviewerLane`, lane: link.reviewerLane }); }
            if (!REVIEW_LINK_STATUSES.has(link.reviewStatus)) errors.push(`${linkPrefix}.reviewStatus is invalid: ${link.reviewStatus}`);
            if (!isSha256(link.artifactSha256)) errors.push(`${linkPrefix}.artifactSha256 must be 64 hex characters`);
            else if (isSha256(artifact.sha256) && link.artifactSha256.toLowerCase() !== artifact.sha256.toLowerCase()) errors.push(`${linkPrefix}.artifactSha256 must match the linked artifact sha256`);
          }
        }
      }
    }
  }

  const worktree = truth.worktreeEvidence;
  if (!worktree || typeof worktree !== 'object' || Array.isArray(worktree)) {
    errors.push('currentGitTruth.worktreeEvidence must be an object');
  } else {
    if (!isNonEmptyString(worktree.branch)) errors.push('currentGitTruth.worktreeEvidence.branch is required');
    if (!isHexCommit(worktree.head)) errors.push('currentGitTruth.worktreeEvidence.head must be a 40-hex commit');
    if (!isHexCommit(worktree.base)) errors.push('currentGitTruth.worktreeEvidence.base must be a 40-hex commit');
    else if (isHexCommit(truth.originMain) && worktree.base.toLowerCase() !== truth.originMain.toLowerCase()) errors.push('currentGitTruth.worktreeEvidence.base must equal currentGitTruth.originMain');
    if (typeof worktree.clean !== 'boolean') errors.push('currentGitTruth.worktreeEvidence.clean must be a boolean');
    validateFreshTimestamp(worktree.verifiedAt, board.updatedAt, 'currentGitTruth.worktreeEvidence.verifiedAt', errors);
  }
  return reviewerRefs;
}

function findDependencyCycle(itemsById) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    for (const dependency of itemsById.get(id)?.dependencies || []) {
      if (!itemsById.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of itemsById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export function validateBoard(board) {
  const errors = [];
  if (!board || typeof board !== 'object' || Array.isArray(board)) return ['board must be a JSON object'];
  if (board.version !== 3) errors.push('version must equal 3');
  if (!isNonEmptyString(board.northStar) || board.northStar.trim().length < 40) errors.push('northStar must be a concrete sentence of at least 40 characters');
  if (!isIsoDate(board.updatedAt)) errors.push('updatedAt must be a valid ISO date');
  if (!Array.isArray(board.lanes) || board.lanes.length === 0) errors.push('lanes must be a non-empty array');
  if (!Array.isArray(board.workItems) || board.workItems.length === 0) errors.push('workItems must be a non-empty array');

  const privateRefs = findPrivateRoomReferences(board);
  if (privateRefs.length) errors.push(`private ChatGPT room URLs are forbidden in the public board: ${privateRefs.join(', ')}`);

  const policy = board.operatingPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) errors.push('operatingPolicy must be an object');
  const ownerWipLimit = Number(policy?.wipLimitPerLane);
  const reviewWipLimit = Number(policy?.reviewWipLimitPerLane);
  if (!Number.isInteger(ownerWipLimit) || ownerWipLimit < 1) errors.push('operatingPolicy.wipLimitPerLane must be a positive integer');
  if (!Number.isInteger(reviewWipLimit) || reviewWipLimit < 1) errors.push('operatingPolicy.reviewWipLimitPerLane must be a positive integer');
  for (const status of ['active', 'review', 'blocked']) {
    const hours = Number(policy?.staleAfterHours?.[status]);
    if (!Number.isFinite(hours) || hours <= 0) errors.push(`operatingPolicy.staleAfterHours.${status} must be a positive number`);
  }
  validateCommunicationControls(board, policy, errors);
  validateProgramQueues(board, errors);
  if (policy?.artifactIntegrityGateRequired !== true) errors.push('operatingPolicy.artifactIntegrityGateRequired must equal true');
  if (policy?.completedTaskMustCreateOrUnblockNext !== true) errors.push('operatingPolicy.completedTaskMustCreateOrUnblockNext must equal true');
  if (!isNonEmptyString(policy?.artifactIntegrityPolicy)) errors.push('operatingPolicy.artifactIntegrityPolicy must be non-empty');
  if (!isNonEmptyString(policy?.completionContinuityPolicy)) errors.push('operatingPolicy.completionContinuityPolicy must be non-empty');
  const gitTruthReviewerRefs = validateCurrentGitTruth(board, errors);

  const lanes = Array.isArray(board.lanes) ? board.lanes : [];
  const laneIds = new Set();
  for (const [index, lane] of lanes.entries()) {
    const prefix = `lanes[${index}]`;
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(lane.id)) errors.push(`${prefix}.id is required`);
    else if (laneIds.has(lane.id)) errors.push(`duplicate lane id: ${lane.id}`);
    else laneIds.add(lane.id);
    if (!isNonEmptyString(lane.name)) errors.push(`${prefix}.name is required`);
    if (!isNonEmptyString(lane.mission)) errors.push(`${prefix}.mission is required`);
    if (!ALLOWED_STATUSES.has(lane.status)) errors.push(`${prefix}.status is invalid: ${lane.status}`);
    if (!isNonEmptyString(lane.ownerRole)) errors.push(`${prefix}.ownerRole is required`);
    if (!isNonEmptyString(lane.reviewerRole)) errors.push(`${prefix}.reviewerRole is required`);
    validateStringArray(lane.capabilities, `${prefix}.capabilities`, errors, { nonEmpty: true });
    validateScope(lane.scope, `${prefix}.scope`, errors);
    validateStringArray(lane.evidenceRequired, `${prefix}.evidenceRequired`, errors, { nonEmpty: true });
    if (!isNonEmptyString(lane.nextAction)) errors.push(`${prefix}.nextAction is required`);
  }
  for (const ref of gitTruthReviewerRefs) {
    if (!laneIds.has(ref.lane)) errors.push(`${ref.at} is unknown: ${ref.lane}`);
  }

  const workItems = Array.isArray(board.workItems) ? board.workItems : [];
  const itemsById = new Map();
  for (const [index, item] of workItems.entries()) {
    const prefix = `workItems[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(item.id)) errors.push(`${prefix}.id is required`);
    else if (itemsById.has(item.id)) errors.push(`duplicate work item id: ${item.id}`);
    else itemsById.set(item.id, item);
    if (!isNonEmptyString(item.title)) errors.push(`${prefix}.title is required`);
    if (!ALLOWED_PRIORITIES.has(item.priority)) errors.push(`${prefix}.priority is invalid: ${item.priority}`);
    if (!ALLOWED_STATUSES.has(item.status)) errors.push(`${prefix}.status is invalid: ${item.status}`);
    if (!laneIds.has(item.ownerLane)) errors.push(`${prefix}.ownerLane is unknown: ${item.ownerLane}`);
    if (!laneIds.has(item.reviewerLane)) errors.push(`${prefix}.reviewerLane is unknown: ${item.reviewerLane}`);
    if (item.ownerLane === item.reviewerLane) errors.push(`${prefix} ownerLane and reviewerLane must be different`);
    const approvals = validateStringArray(item.approvalLanes, `${prefix}.approvalLanes`, errors);
    for (const approval of approvals) {
      if (!laneIds.has(approval)) errors.push(`${prefix}.approvalLanes contains unknown lane ${approval}`);
      if (approval === item.ownerLane) errors.push(`${prefix}.approvalLanes cannot include ownerLane ${approval}`);
    }
    validateStringArray(item.dependencies, `${prefix}.dependencies`, errors);
    if (!isNonEmptyString(item.objective)) errors.push(`${prefix}.objective is required`);
    validateStringArray(item.nonGoals, `${prefix}.nonGoals`, errors, { nonEmpty: true });
    validateScope(item.scope, `${prefix}.scope`, errors);
    validateStringArray(item.evidenceRequired, `${prefix}.evidenceRequired`, errors, { nonEmpty: true });
    validateStringArray(item.exitCriteria, `${prefix}.exitCriteria`, errors, { nonEmpty: true });
    if (!isNonEmptyString(item.nextAction)) errors.push(`${prefix}.nextAction is required`);
    if (!isNonEmptyString(item.rollbackPoint)) errors.push(`${prefix}.rollbackPoint is required`);

    if (OWNERSHIP_STATUSES.has(item.status) && scopeCount(item.scope) === 0) errors.push(`${prefix} is ${item.status} but owns no files, surfaces, or artifacts`);
    if (['active', 'review'].includes(item.status)) {
      if (!isIsoDate(item.startedAt)) errors.push(`${prefix}.startedAt must be a valid ISO date while ${item.status}`);
      if (!isIsoDate(item.lastEvidenceAt)) errors.push(`${prefix}.lastEvidenceAt must be a valid ISO date while ${item.status}`);
    }
    if (item.status === 'blocked') {
      if (!isNonEmptyString(item.blocker)) errors.push(`${prefix}.blocker is required while blocked`);
      if (!isNonEmptyString(item.unblockOwner)) errors.push(`${prefix}.unblockOwner is required while blocked`);
      if (!isIsoDate(item.lastEvidenceAt)) errors.push(`${prefix}.lastEvidenceAt must be a valid ISO date while blocked`);
    }
    if (EVIDENCE_STATUSES.has(item.status)) validateStringArray(item.exactEvidence, `${prefix}.exactEvidence`, errors, { nonEmpty: true });
  }

  for (const item of workItems) {
    if (!item || !Array.isArray(item.dependencies)) continue;
    for (const dependency of item.dependencies) {
      if (!itemsById.has(dependency)) errors.push(`work item ${item.id} depends on unknown work item ${dependency}`);
      if (dependency === item.id) errors.push(`work item ${item.id} cannot depend on itself`);
    }
    if (item.status === 'ready') {
      const incomplete = item.dependencies.filter((dependency) => itemsById.get(dependency)?.status !== 'complete');
      if (incomplete.length) errors.push(`work item ${item.id} is ready but dependencies are incomplete: ${incomplete.join(', ')}`);
    }
  }

  const cycle = findDependencyCycle(itemsById);
  if (cycle) errors.push(`work item dependency cycle: ${cycle.join(' -> ')}`);

  const ownership = new Map();
  for (const item of workItems.filter((entry) => OWNERSHIP_STATUSES.has(entry?.status))) {
    for (const kind of SCOPE_KINDS) {
      for (const value of item.scope?.[kind] || []) {
        const key = `${kind}:${value.trim().toLowerCase()}`;
        const prior = ownership.get(key);
        if (prior && prior !== item.id) errors.push(`ownership collision for ${kind} "${value}": ${prior} and ${item.id}`);
        else ownership.set(key, item.id);
      }
    }
  }

  const activeByOwner = new Map();
  const reviewByReviewer = new Map();
  for (const item of workItems) {
    if (item?.status === 'active') activeByOwner.set(item.ownerLane, (activeByOwner.get(item.ownerLane) || 0) + 1);
    if (item?.status === 'review') reviewByReviewer.set(item.reviewerLane, (reviewByReviewer.get(item.reviewerLane) || 0) + 1);
  }
  if (Number.isInteger(ownerWipLimit)) {
    for (const [lane, count] of activeByOwner) if (count > ownerWipLimit) errors.push(`owner WIP limit exceeded for ${lane}: ${count} > ${ownerWipLimit}`);
  }
  if (Number.isInteger(reviewWipLimit)) {
    for (const [lane, count] of reviewByReviewer) if (count > reviewWipLimit) errors.push(`review WIP limit exceeded for ${lane}: ${count} > ${reviewWipLimit}`);
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
  const laneCounts = board.lanes.reduce((result, lane) => {
    result[lane.status] = (result[lane.status] || 0) + 1;
    return result;
  }, {});
  const itemCounts = board.workItems.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  console.log(`Team board valid: ${board.lanes.length} lanes (${Object.entries(laneCounts).map(([status, count]) => `${status}=${count}`).join(', ')}); ${board.workItems.length} work items (${Object.entries(itemCounts).map(([status, count]) => `${status}=${count}`).join(', ')})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
