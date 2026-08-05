import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ROLES = Object.freeze({ E: 'builder', T: 'tester', M: 'supervisor', W: 'watcher' });
export const STATUSES = Object.freeze(['prepared','accepted','active','completed','uncertain','quarantined']);
export const OUTCOMES = Object.freeze(['pass','fail','blocked','infrastructure-problem','application-problem']);
const ID = /^[ETMW]-\d{4}$/;
const RECOVERY_ID = /^[ETMW]-\d{4}-RECOVERY-[A-Z0-9-]+-\d{4}$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const iso = (v = new Date()) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('invalid timestamp');
  return d.toISOString();
};
const clone = (v) => structuredClone(v);
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
export const hashObject = (v) => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const required = (v, name) => {
  if (!nonEmpty(v)) throw new Error(`${name} is required`);
  return v.trim();
};
const lane = (v) => {
  if (!Object.hasOwn(ROLES, v)) throw new Error(`invalid lane: ${v}`);
  return v;
};
const ticket = (l, id) => {
  const t = l.tickets.find((x) => x.id === id);
  if (!t) throw new Error(`unknown ticket: ${id}`);
  return t;
};
const actor = (t, v) => {
  v = required(v, 'actor');
  if (t.assignee !== v) throw new Error(`${t.id} belongs to ${t.assignee}, not ${v}`);
  return v;
};
const receiptBody = ({ hash, ...body }) => body;
export const verifyReceipt = (r) => Boolean(r && /^[a-f0-9]{64}$/.test(r.hash || '') && hashObject(receiptBody(r)) === r.hash);

function addEvent(l, type, by, payload = {}, ticketId = null, at = new Date()) {
  l.counters.event += 1;
  const e = {
    eventId: `EVT-${String(l.counters.event).padStart(6, '0')}`,
    type: required(type, 'event type'),
    ticketId,
    actor: required(by, 'event actor'),
    at: iso(at),
    previousHash: l.events.at(-1)?.hash || null,
    payload: clone(payload)
  };
  e.hash = hashObject(e);
  l.events.push(e);
  l.updatedAt = e.at;
}
function record(id, ln, objective, assignee, authorizedBy, at, extra = {}) {
  return {
    id, lane: ln, role: ROLES[ln], objective: required(objective, 'objective'),
    assignee: required(assignee, 'assignee'), authorizedBy: required(authorizedBy, 'authorizedBy'),
    status: 'prepared', chainId: extra.chainId || id,
    predecessorTicketId: extra.predecessorTicketId || null,
    predecessorReceiptHash: extra.predecessorReceiptHash || null,
    successorTicketId: null, recoveryForTicketId: extra.recoveryForTicketId || null,
    recoveryTicketId: null, createdAt: iso(at), acceptedAt: null, startedAt: null,
    completedAt: null, launchEvidence: null, receipt: null, uncertainty: null, quarantine: null
  };
}
function mutate(l, fn) {
  const before = validateLedger(l);
  if (before.length) throw new Error(`invalid ledger: ${before.join(' | ')}`);
  const n = clone(l), result = fn(n), after = validateLedger(n);
  if (after.length) throw new Error(`invalid ledger after operation: ${after.join(' | ')}`);
  return { ledger: n, result };
}

export function createLedger(project = 'GameDeck', at = new Date()) {
  const t = iso(at);
  const l = {
    schemaVersion: 1, project: required(project, 'project'), createdAt: t, updatedAt: t,
    policy: {
      nonReplay: true, visibleLaunchRequired: true, oldestFirst: true, maxOpenPerLane: 1,
      launchGraceHours: 1, staleHours: { prepared: 24, accepted: 2, active: 8 },
      roles: clone(ROLES), allowedSuccessors: { E: ['T'], T: ['M'], M: ['W'], W: ['E','T','M','W'] }
    },
    counters: { E: 0, T: 0, M: 0, W: 0, recovery: 0, event: 0 },
    tickets: [], events: []
  };
  addEvent(l, 'ledger.initialized', 'cadops-system', { project: l.project, schemaVersion: 1 }, null, at);
  return l;
}
export function issue(l, { lane: ln, objective, assignee, authorizedBy, at = new Date() }) {
  return mutate(l, (n) => {
    lane(ln); n.counters[ln] += 1;
    const id = `${ln}-${String(n.counters[ln]).padStart(4, '0')}`;
    const t = record(id, ln, objective, assignee, authorizedBy, at);
    n.tickets.push(t);
    addEvent(n, 'ticket.issued', authorizedBy, { lane: ln, role: t.role, assignee: t.assignee, objective: t.objective }, id, at);
    return t;
  });
}
export function accept(l, { ticketId, actor: by, at = new Date() }) {
  return mutate(l, (n) => {
    const t = ticket(n, ticketId); by = actor(t, by);
    if (t.status !== 'prepared') throw new Error(`${ticketId} cannot be accepted from ${t.status}`);
    t.status = 'accepted'; t.acceptedAt = iso(at);
    addEvent(n, 'ticket.accepted', by, { role: t.role }, ticketId, at);
    return t;
  });
}
export function start(l, { ticketId, actor: by, launchEvidence, at = new Date() }) {
  return mutate(l, (n) => {
    const t = ticket(n, ticketId); by = actor(t, by);
    if (['active','completed','uncertain','quarantined'].includes(t.status)) throw new Error(`${ticketId} is replay-protected in ${t.status}`);
    if (t.status !== 'accepted') throw new Error(`${ticketId} must be accepted first`);
    t.status = 'active'; t.startedAt = iso(at); t.launchEvidence = required(launchEvidence, 'launchEvidence');
    addEvent(n, 'ticket.started', by, { launchEvidence: t.launchEvidence }, ticketId, at);
    return t;
  });
}
function runGit(base, args, binary = false) {
  try {
    return execFileSync('git', ['-C', base, ...args], {
      encoding: binary ? null : 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr || error?.message || error);
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}
function gitContext(root, softwareVersion) {
  const base = path.resolve(root);
  const requested = required(softwareVersion, 'softwareVersion');
  const commit = String(runGit(base, ['rev-parse', '--verify', `${requested}^{commit}`])).trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('softwareVersion did not resolve to an exact Git commit');
  const objectFormat = String(runGit(base, ['rev-parse', '--show-object-format'])).trim().toLowerCase();
  return { base, commit, objectFormat };
}
function artifact(file, context) {
  const absolute = path.resolve(context.base, file), rel = path.relative(context.base, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('artifact must be inside repository root');
  const repoPath = rel.split(path.sep).join('/');
  const objectId = String(runGit(context.base, ['rev-parse', '--verify', `${context.commit}:${repoPath}`])).trim().toLowerCase();
  const objectType = String(runGit(context.base, ['cat-file', '-t', objectId])).trim();
  if (objectType !== 'blob') throw new Error(`artifact is not a Git blob: ${file}`);
  const content = runGit(context.base, ['cat-file', 'blob', objectId], true);
  return {
    path: repoPath,
    source: 'git-blob',
    commit: context.commit,
    objectFormat: context.objectFormat,
    objectId,
    bytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}
export function complete(l, {
  ticketId, actor: by, outcome, summary, softwareVersion, artifactPaths = [], checks = [],
  root = process.cwd(), closeChain = false, at = new Date()
}) {
  return mutate(l, (n) => {
    const t = ticket(n, ticketId); by = actor(t, by);
    if (t.status !== 'active') throw new Error(`${ticketId} must be active`);
    if (!OUTCOMES.includes(outcome)) throw new Error(`invalid outcome: ${outcome}`);
    if (closeChain && t.lane !== 'W') throw new Error('only Watcher may close a chain');
    const version = required(softwareVersion, 'softwareVersion');
    const context = artifactPaths.length ? gitContext(root, version) : null;
    const r = {
      ticketId, lane: t.lane, role: t.role, actor: by, objective: t.objective, outcome,
      summary: required(summary, 'summary'), softwareVersion: context?.commit || version,
      predecessorTicketId: t.predecessorTicketId, predecessorReceiptHash: t.predecessorReceiptHash,
      launchEvidence: t.launchEvidence, startedAt: t.startedAt, completedAt: iso(at),
      artifacts: artifactPaths.map((p) => artifact(p, context)), checks: checks.map((c) => required(c, 'check')),
      nextAuthorizedLanes: closeChain ? [] : clone(n.policy.allowedSuccessors[t.lane]),
      chainDisposition: closeChain ? 'closed' : 'handoff-required'
    };
    r.hash = hashObject(r); t.status = 'completed'; t.completedAt = r.completedAt; t.receipt = r;
    addEvent(n, 'ticket.completed', by, { outcome, receiptHash: r.hash, softwareVersion: r.softwareVersion }, ticketId, at);
    return t;
  });
}
export function handoff(l, { ticketId, lane: ln, objective, assignee, authorizedBy, at = new Date() }) {
  return mutate(l, (n) => {
    const p = ticket(n, ticketId); lane(ln);
    if (p.status !== 'completed' || !verifyReceipt(p.receipt)) throw new Error(`${ticketId} lacks a valid receipt`);
    if (p.receipt.chainDisposition === 'closed') throw new Error(`${ticketId} closed its chain`);
    if (p.successorTicketId) throw new Error(`${ticketId} already handed off to ${p.successorTicketId}`);
    if (!n.policy.allowedSuccessors[p.lane].includes(ln)) throw new Error(`${p.lane} may not hand off to ${ln}`);
    n.counters[ln] += 1;
    const id = `${ln}-${String(n.counters[ln]).padStart(4, '0')}`;
    const s = record(id, ln, objective, assignee, authorizedBy, at, {
      chainId: p.chainId, predecessorTicketId: p.id, predecessorReceiptHash: p.receipt.hash
    });
    p.successorTicketId = id; n.tickets.push(s);
    addEvent(n, 'custody.handed-off', authorizedBy,
      { successorTicketId: id, successorLane: ln, predecessorReceiptHash: p.receipt.hash, assignee: s.assignee }, p.id, at);
    return s;
  });
}
export function uncertain(l, { ticketId, actor: by, reason, at = new Date() }) {
  return mutate(l, (n) => {
    const t = ticket(n, ticketId);
    if (!['prepared','accepted','active'].includes(t.status)) throw new Error(`${ticketId} cannot become uncertain from ${t.status}`);
    t.uncertainty = { priorStatus: t.status, reason: required(reason, 'reason'), markedBy: required(by, 'actor'), at: iso(at) };
    t.status = 'uncertain'; addEvent(n, 'ticket.uncertain', by, t.uncertainty, ticketId, at); return t;
  });
}
export function quarantine(l, { ticketId, actor: by, reason, at = new Date() }) {
  return mutate(l, (n) => {
    const t = ticket(n, ticketId);
    if (t.status !== 'uncertain') throw new Error(`${ticketId} must be uncertain first`);
    t.status = 'quarantined'; t.quarantine = { reason: required(reason, 'reason'), quarantinedBy: required(by, 'actor'), at: iso(at) };
    addEvent(n, 'ticket.quarantined', by, t.quarantine, ticketId, at); return t;
  });
}
export function recover(l, { ticketId, operator, authorizedBy, objective, at = new Date() }) {
  return mutate(l, (n) => {
    const o = ticket(n, ticketId);
    if (!['uncertain','quarantined'].includes(o.status)) throw new Error(`${ticketId} is not recoverable`);
    if (o.recoveryTicketId) throw new Error(`${ticketId} already has recovery ${o.recoveryTicketId}`);
    n.counters.recovery += 1;
    const slug = required(operator, 'operator').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'OPERATOR';
    const id = `${o.id}-RECOVERY-${slug}-${String(n.counters.recovery).padStart(4, '0')}`;
    const r = record(id, o.lane, objective || `Recover ${o.id}: ${o.objective}`, operator, authorizedBy, at,
      { chainId: o.chainId, recoveryForTicketId: o.id });
    o.recoveryTicketId = id; n.tickets.push(r);
    addEvent(n, 'recovery.issued', authorizedBy, { originalTicketId: o.id, originalStatus: o.status, operator: r.assignee }, id, at);
    return r;
  });
}

export function validateLedger(l) {
  const e = [];
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['ledger must be an object'];
  if (l.schemaVersion !== 1) e.push('schemaVersion must equal 1');
  if (!nonEmpty(l.project)) e.push('project is required');
  if (!Array.isArray(l.tickets) || !Array.isArray(l.events)) return [...e, 'tickets and events must be arrays'];
  if (!l.policy || !l.counters) return [...e, 'policy and counters are required'];
  const ids = new Set(), map = new Map(), open = new Map();
  for (const [i, t] of l.tickets.entries()) {
    const p = `tickets[${i}]`;
    if (!nonEmpty(t.id) || ids.has(t.id)) e.push(`${p}.id missing or duplicate`);
    else { ids.add(t.id); map.set(t.id, t); }
    if (!(t.recoveryForTicketId ? RECOVERY_ID : ID).test(t.id || '')) e.push(`${p}.id invalid`);
    if (!Object.hasOwn(ROLES, t.lane) || t.role !== ROLES[t.lane]) e.push(`${p}.lane/role invalid`);
    if (!STATUSES.includes(t.status)) e.push(`${p}.status invalid`);
    if (!nonEmpty(t.objective) || !nonEmpty(t.assignee) || !nonEmpty(t.authorizedBy)) e.push(`${p} identity fields missing`);
    if (['accepted','active'].includes(t.status)) open.set(t.lane, (open.get(t.lane) || 0) + 1);
    if (t.status === 'active' && (!t.startedAt || !nonEmpty(t.launchEvidence))) e.push(`${p} active without launch evidence`);
    if (t.status === 'completed' && !verifyReceipt(t.receipt)) e.push(`${p} invalid receipt`);
    if (t.status !== 'completed' && t.receipt) e.push(`${p} premature receipt`);
    if (t.status === 'uncertain' && !t.uncertainty) e.push(`${p} missing uncertainty record`);
    if (t.status === 'quarantined' && (!t.uncertainty || !t.quarantine)) e.push(`${p} missing quarantine evidence`);
  }
  for (const [ln, count] of open) if (count > l.policy.maxOpenPerLane) e.push(`lane ${ln} exceeds WIP limit`);
  for (const t of l.tickets) {
    if (t.predecessorTicketId) {
      const p = map.get(t.predecessorTicketId);
      if (!p || p.successorTicketId !== t.id || !verifyReceipt(p.receipt) || t.predecessorReceiptHash !== p.receipt.hash ||
          t.chainId !== p.chainId || !l.policy.allowedSuccessors[p.lane].includes(t.lane)) e.push(`${t.id} custody backlink invalid`);
    }
    if (t.successorTicketId && map.get(t.successorTicketId)?.predecessorTicketId !== t.id) e.push(`${t.id} successor backlink invalid`);
    if (t.recoveryForTicketId && map.get(t.recoveryForTicketId)?.recoveryTicketId !== t.id) e.push(`${t.id} recovery backlink invalid`);
    if (t.recoveryTicketId && map.get(t.recoveryTicketId)?.recoveryForTicketId !== t.id) e.push(`${t.id} original recovery backlink invalid`);
  }
  let prev = null;
  const eventIds = new Set(), starts = new Map(), completes = new Map(), handoffs = new Map();
  for (const [i, event] of l.events.entries()) {
    if (!nonEmpty(event.eventId) || eventIds.has(event.eventId)) e.push(`events[${i}].eventId invalid`);
    eventIds.add(event.eventId);
    if (event.previousHash !== prev) e.push(`events[${i}] chain broken`);
    const { hash, ...body } = event;
    if (!/^[a-f0-9]{64}$/.test(hash || '') || hashObject(body) !== hash) e.push(`events[${i}] hash invalid`);
    prev = hash;
    const target = event.type === 'ticket.started' ? starts : event.type === 'ticket.completed' ? completes :
      event.type === 'custody.handed-off' ? handoffs : null;
    if (target) target.set(event.ticketId, (target.get(event.ticketId) || 0) + 1);
  }
  if (l.counters.event !== l.events.length) e.push('event counter mismatch');
  for (const [name, m] of [['started',starts],['completed',completes],['handed off',handoffs]])
    for (const [id, count] of m) if (count > 1) e.push(`${id} ${name} more than once`);
  return e;
}
const hours = (a, b) => (new Date(b) - new Date(a)) / 3600000;
export function watch(l, now = new Date()) {
  const generatedAt = iso(now), integrityErrors = validateLedger(l), risks = [];
  if (integrityErrors.length) {
    for (const message of integrityErrors) risks.push({ severity: 'critical', code: 'LEDGER_INTEGRITY', ticketId: null, message,
      recoveryAction: 'Quarantine this ledger and restore the last verified event hash.' });
    return { generatedAt, healthy: false, integrityErrors, risks };
  }
  for (const t of l.tickets) {
    const limit = l.policy.staleHours[t.status], since = t.startedAt || t.acceptedAt || t.createdAt;
    if (limit && hours(since, generatedAt) > limit) risks.push({ severity: t.status === 'active' ? 'critical' : 'warning',
      code: 'STALE_CUSTODY', ticketId: t.id, message: `${t.id} exceeded ${limit} hours in ${t.status}.`,
      recoveryAction: 'Verify execution; quarantine uncertainty and issue a distinct recovery identity.' });
    if (['uncertain','quarantined'].includes(t.status) && !t.recoveryTicketId) risks.push({ severity: 'critical',
      code: 'RECOVERY_REQUIRED', ticketId: t.id, message: `${t.id} lacks a recovery identity.`,
      recoveryAction: 'Issue recovery; never replay the original identity.' });
    if (t.status === 'completed' && t.receipt.chainDisposition !== 'closed' && !t.successorTicketId) risks.push({ severity: 'warning',
      code: 'CUSTODY_NOT_PASSED', ticketId: t.id, message: `${t.id} completed without a successor.`,
      recoveryAction: 'Create exactly one authorized successor from its receipt.' });
    if (t.successorTicketId) {
      const s = ticket(l, t.successorTicketId);
      if (s.status === 'prepared' && hours(s.createdAt, generatedAt) > l.policy.launchGraceHours) risks.push({ severity: 'warning',
        code: 'SUCCESSOR_NOT_VISIBLE', ticketId: s.id, message: `${s.id} is prepared but not visibly accepted.`,
        recoveryAction: 'Confirm delivery; do not resend the predecessor.' });
    }
  }
  if (l.policy.oldestFirst) for (const ln of Object.keys(ROLES)) {
    const q = l.tickets.filter((t) => t.lane === ln && ['prepared','accepted','active'].includes(t.status))
      .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    const a = q.find((t) => t.status === 'active');
    if (a && q[0] && a.id !== q[0].id) risks.push({ severity: 'critical', code: 'OLDEST_FIRST_VIOLATION',
      ticketId: a.id, message: `${a.id} bypassed older ${q[0].id}.`,
      recoveryAction: 'Stop new work and resolve the oldest valid custody first.' });
  }
  return { generatedAt, healthy: !risks.some((r) => r.severity === 'critical'), integrityErrors, risks };
}
export const summarize = (l) => {
  const errors = validateLedger(l); if (errors.length) throw new Error(errors.join(' | '));
  const byStatus = {}, byLane = {};
  for (const t of l.tickets) { byStatus[t.status] = (byStatus[t.status] || 0) + 1; byLane[t.lane] = (byLane[t.lane] || 0) + 1; }
  return { project: l.project, schemaVersion: l.schemaVersion, updatedAt: l.updatedAt,
    lastEventHash: l.events.at(-1)?.hash || null, ticketCount: l.tickets.length, byStatus, byLane };
};
export const formatWatch = (r) => [
  'GAMEDECK CADOPS WATCHER', `Generated: ${r.generatedAt}`, `Health: ${r.healthy ? 'HEALTHY' : 'ATTENTION REQUIRED'}`,
  `Risks: ${r.risks.length}`, ...(r.risks.length ? r.risks.flatMap((x) => [
    `- [${x.severity.toUpperCase()}] ${x.code}${x.ticketId ? ` ${x.ticketId}` : ''}: ${x.message}`,
    `  Recovery: ${x.recoveryAction}`]) : ['- none'])
].join('\n');
export const loadLedger = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export function saveLedger(file, l) {
  const errors = validateLedger(l); if (errors.length) throw new Error(errors.join(' | '));
  const abs = path.resolve(file); fs.mkdirSync(path.dirname(abs), { recursive: true });
  const temp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(l, null, 2)}\n`, { flag: 'wx' }); fs.renameSync(temp, abs);
}
