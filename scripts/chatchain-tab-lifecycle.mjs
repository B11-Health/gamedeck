import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger } from './cadops-core.mjs';
import {
  loadRoomRegistry,
  saveRoomRegistry,
  buildRoomPolicy,
  roomEligibility,
  markRoomClosed,
  markRoomUncertain
} from './chatchain-room-registry.mjs';

const CHAT_HOST = 'chatgpt.com';
const CHAT_PATH = /^\/c\/([A-Za-z0-9-]+)(?:[/?#]|$)/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function conversationIdentity(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== CHAT_HOST) return null;
    return url.pathname.match(CHAT_PATH)?.[1] || null;
  } catch {
    return null;
  }
}

export function targetIdentity(target) {
  return String(target?.id || target?.targetId || '').trim();
}

export function listChatTargets(targets) {
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => target?.type === 'page')
    .map((target) => ({
      targetId: targetIdentity(target),
      conversationId: conversationIdentity(target.url),
      url: String(target.url || ''),
      title: String(target.title || '')
    }))
    .filter((target) => target.targetId && target.conversationId);
}

function required(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(name + ' is required');
  return result;
}

function targetSpec(options, prefix) {
  return {
    targetId: options[prefix + 'TargetId'] ? String(options[prefix + 'TargetId']) : '',
    url: options[prefix + 'Url'] ? String(options[prefix + 'Url']) : ''
  };
}

export function resolveChatTarget(targets, spec, label, { allowMissing = false } = {}) {
  const pages = (Array.isArray(targets) ? targets : []).filter((target) => target?.type === 'page');
  let matches = [];
  if (spec.targetId) {
    matches = pages.filter((target) => targetIdentity(target) === spec.targetId);
  } else if (spec.url) {
    const conversationId = conversationIdentity(spec.url);
    if (!conversationId) throw new Error(label + ' URL is not a ChatGPT conversation URL');
    matches = pages.filter((target) => conversationIdentity(target.url) === conversationId);
  } else {
    throw new Error(label + ' target ID or URL is required');
  }
  if (!matches.length) {
    if (allowMissing) return null;
    throw new Error(label + ' chat target was not found');
  }
  if (matches.length !== 1) throw new Error(label + ' chat target is ambiguous');
  const target = matches[0];
  const id = targetIdentity(target);
  const conversationId = conversationIdentity(target.url);
  if (!id || !conversationId) throw new Error(label + ' target is not an open ChatGPT conversation');
  if (spec.url) {
    const expectedConversationId = conversationIdentity(spec.url);
    if (!expectedConversationId) throw new Error(label + ' URL is not a ChatGPT conversation URL');
    if (expectedConversationId !== conversationId) throw new Error(label + ' target ID and URL identify different conversations');
  }
  return { id, conversationId, url: String(target.url), title: String(target.title || ''), raw: target };
}

function assertDistinct(predecessor, successor) {
  if (predecessor.id === successor.id) throw new Error('predecessor and successor target IDs must differ');
  if (predecessor.conversationId === successor.conversationId) throw new Error('predecessor and successor conversations must differ');
}

export class HttpCdpBrowser {
  constructor(endpoint, { fetchImpl = globalThis.fetch, requestTimeoutMs = 3000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    this.endpoint = new URL(required(endpoint, 'CDP endpoint'));
    if (!['http:', 'https:'].includes(this.endpoint.protocol)) throw new Error('CDP endpoint must use HTTP or HTTPS');
    const host = this.endpoint.hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('CDP endpoint must be loopback-only');
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async request(route, { method = 'GET' } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(new URL(route, this.endpoint), { method, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error('CDP ' + method + ' ' + route + ' failed with HTTP ' + response.status);
      if (!text) return null;
      try { return JSON.parse(text); } catch { return text; }
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('CDP request timed out: ' + route);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  listTargets() { return this.request('/json/list'); }
  activateTarget(targetId) { return this.request('/json/activate/' + encodeURIComponent(required(targetId, 'targetId'))); }
  closeTarget(targetId) { return this.request('/json/close/' + encodeURIComponent(required(targetId, 'targetId'))); }

  async evaluateTarget(target, expression) {
    const websocketUrl = required(target?.webSocketDebuggerUrl, 'target websocket debugger URL');
    const socket = new WebSocket(websocketUrl);
    const requestId = 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('CDP target probe timed out')), this.requestTimeoutMs);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          id: requestId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        }));
      }, { once: true });
      socket.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.id !== requestId) return;
        if (message.error) return finish(reject, new Error(message.error.message || 'CDP target probe failed'));
        if (message.result?.exceptionDetails) return finish(reject, new Error('CDP target probe raised an exception'));
        finish(resolve, message.result?.result?.value);
      });
      socket.addEventListener('error', () => finish(reject, new Error('CDP target websocket failed')), { once: true });
    });
  }

  async probeTargetReady(target) {
    const value = await this.evaluateTarget(target, `(() => {
      const readyState = document.readyState === 'complete' || document.readyState === 'interactive';
      const main = Boolean(document.querySelector('main'));
      const login = Boolean(document.querySelector('input[type=\"password\"], form[action*=\"login\"]'));
      return { ready: readyState && main && !login };
    })()`);
    return { ready: Boolean(value?.ready) };
  }

  async probeTargetActivity(target) {
    const value = await this.evaluateTarget(target, `(() => {
      const editor = document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
      const draft = editor ? ('value' in editor ? editor.value : editor.innerText || editor.textContent || '') : '';
      const generating = Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"]'));
      return { draft: String(draft || '').trim(), generating };
    })()`);
    return {
      draft: String(value?.draft || '').trim(),
      generating: Boolean(value?.generating)
    };
  }
}

async function waitForSuccessor(browser, expected, {
  timeoutMs = 5000,
  pollIntervalMs = 120,
  stablePolls = 2
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const targets = await browser.listTargets();
      const current = resolveChatTarget(targets, { targetId: expected.id }, 'successor');
      if (current.conversationId !== expected.conversationId || current.url !== expected.url) {
        throw new Error('successor target changed identity while opening');
      }
      const readiness = typeof browser.probeTargetReady === 'function'
        ? await browser.probeTargetReady(current.raw)
        : true;
      if (readiness === true || readiness?.ready === true) consecutive += 1;
      else consecutive = 0;
      if (consecutive >= stablePolls) return current;
    } catch (error) {
      consecutive = 0;
      lastError = error;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error('successor chat was not stably open before timeout' + (lastError ? ': ' + lastError.message : ''));
}

async function verifyAfterClose(browser, predecessor, successor, {
  timeoutMs = 3000,
  pollIntervalMs = 120
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  while (Date.now() <= deadline) {
    lastTargets = await browser.listTargets();
    const oldTarget = lastTargets.find((target) => targetIdentity(target) === predecessor.id);
    const nextTarget = resolveChatTarget(lastTargets, { targetId: successor.id }, 'successor', { allowMissing: true });
    if (!oldTarget && nextTarget && nextTarget.conversationId === successor.conversationId) {
      return { targets: lastTargets, successor: nextTarget };
    }
    await sleep(pollIntervalMs);
  }
  const oldStillOpen = lastTargets.some((target) => targetIdentity(target) === predecessor.id);
  throw Object.assign(new Error(oldStillOpen
    ? 'predecessor close could not be verified'
    : 'predecessor closed but successor continuity could not be verified'), {
    code: oldStillOpen ? 'CLOSE_UNVERIFIED' : 'POST_CLOSE_SUCCESSOR_UNCERTAIN',
    predecessorClosed: oldStillOpen ? null : true
  });
}

export async function handoffTabs(browser, options = {}) {
  if (!browser || typeof browser.listTargets !== 'function' || typeof browser.activateTarget !== 'function' || typeof browser.closeTarget !== 'function') {
    throw new Error('browser adapter must implement listTargets, activateTarget, and closeTarget');
  }
  const predecessorSpec = targetSpec(options, 'predecessor');
  const successorSpec = targetSpec(options, 'successor');
  const beforeTargets = await browser.listTargets();
  const successor = resolveChatTarget(beforeTargets, successorSpec, 'successor');
  const predecessor = resolveChatTarget(beforeTargets, predecessorSpec, 'predecessor', { allowMissing: true });
  const generatedAt = new Date().toISOString();

  if (!predecessor) {
    const absentPredecessor = {
      targetId: predecessorSpec.targetId || null,
      conversationId: conversationIdentity(predecessorSpec.url),
      url: predecessorSpec.url || null
    };
    if (options.dryRun) {
      return {
        schemaVersion: 1,
        generatedAt,
        status: 'planned',
        predecessorClosed: true,
        successorVerified: false,
        predecessor: absentPredecessor,
        successor: { targetId: successor.id, conversationId: successor.conversationId, url: successor.url },
        sideEffects: []
      };
    }
    await browser.activateTarget(successor.id);
    const verifiedSuccessor = await waitForSuccessor(browser, successor, options);
    return {
      schemaVersion: 1,
      generatedAt,
      status: 'already-closed',
      predecessorClosed: true,
      successorVerified: true,
      predecessor: absentPredecessor,
      successor: { targetId: successor.id, conversationId: successor.conversationId, url: successor.url },
      verifiedSuccessorUrl: verifiedSuccessor.url,
      sideEffects: ['successor-activated']
    };
  }
  assertDistinct(predecessor, successor);
  const protectedIds = new Set((options.protectedTargetIds || []).map(String));
  if (protectedIds.has(predecessor.id)) throw new Error('predecessor target is protected and will not be closed');

  const baseReceipt = {
    schemaVersion: 1,
    generatedAt,
    predecessor: { targetId: predecessor.id, conversationId: predecessor.conversationId, url: predecessor.url },
    successor: { targetId: successor.id, conversationId: successor.conversationId, url: successor.url }
  };

  if (options.dryRun) {
    return { ...baseReceipt, status: 'planned', predecessorClosed: false, successorVerified: false, sideEffects: [] };
  }

  await browser.activateTarget(successor.id);
  const verifiedSuccessor = await waitForSuccessor(browser, successor, options);

  const preCloseTargets = await browser.listTargets();
  const predecessorNow = resolveChatTarget(preCloseTargets, { targetId: predecessor.id }, 'predecessor', { allowMissing: true });
  const successorNow = resolveChatTarget(preCloseTargets, { targetId: successor.id }, 'successor');
  if (!predecessorNow) {
    return {
      ...baseReceipt,
      status: 'already-closed',
      predecessorClosed: true,
      successorVerified: true,
      verifiedSuccessorUrl: verifiedSuccessor.url,
      sideEffects: ['successor-activated']
    };
  }
  if (predecessorNow.conversationId !== predecessor.conversationId || predecessorNow.url !== predecessor.url) {
    throw new Error('predecessor target changed identity before close');
  }
  if (successorNow.conversationId !== successor.conversationId || successorNow.url !== successor.url) {
    throw new Error('successor target changed identity before close');
  }

  try {
    await browser.closeTarget(predecessor.id);
  } catch (error) {
    return {
      ...baseReceipt,
      status: 'uncertain',
      predecessorClosed: null,
      successorVerified: true,
      requiresRecovery: true,
      error: error.message,
      sideEffects: ['successor-activated', 'predecessor-close-requested']
    };
  }

  try {
    const after = await verifyAfterClose(browser, predecessor, successor, options);
    return {
      ...baseReceipt,
      status: 'closed',
      predecessorClosed: true,
      successorVerified: true,
      remainingChatTabs: listChatTargets(after.targets),
      sideEffects: ['successor-activated', 'predecessor-closed']
    };
  } catch (error) {
    return {
      ...baseReceipt,
      status: 'uncertain',
      predecessorClosed: error.predecessorClosed ?? null,
      successorVerified: true,
      requiresRecovery: true,
      error: error.message,
      errorCode: error.code || 'POST_CLOSE_UNCERTAIN',
      sideEffects: ['successor-activated', 'predecessor-close-requested']
    };
  }
}

function defaultProtectedTitle(title) {
  return /\broom watch\b/i.test(String(title || ''));
}

function duplicateConversationIds(chats) {
  const counts = new Map();
  for (const chat of chats) counts.set(chat.conversationId, (counts.get(chat.conversationId) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([conversationId]) => conversationId));
}

function policyClassification(policyItem) {
  if (!policyItem) return { classification: 'unmanaged', reason: 'room-not-registered' };
  const eligibility = policyItem.eligibility || {};
  if (eligibility.disposition === 'keep') return { classification: 'protected', reason: eligibility.reason || 'custody-protected' };
  if (eligibility.disposition === 'eligible') return { classification: 'eligible', reason: eligibility.reason || 'custody-advanced' };
  if (eligibility.disposition === 'closed') return { classification: 'unknown', reason: 'registered-room-closed-but-target-open' };
  return { classification: 'unknown', reason: eligibility.reason || 'room-policy-unknown' };
}

export async function auditTabHygiene(browser, options = {}) {
  if (!browser || typeof browser.listTargets !== 'function' || typeof browser.probeTargetActivity !== 'function') {
    throw new Error('browser adapter must implement listTargets and probeTargetActivity');
  }
  const rawTargets = await browser.listTargets();
  const chats = listChatTargets(rawTargets);
  const duplicates = duplicateConversationIds(chats);
  const rawById = new Map(rawTargets.map((target) => [targetIdentity(target), target]));
  const protectedTargetIds = new Set((options.protectedTargetIds || []).map(String));
  const protectedConversationIds = new Set((options.protectedUrls || []).map(conversationIdentity).filter(Boolean));
  const roomPolicy = options.roomPolicy instanceof Map ? options.roomPolicy : new Map();
  const tabs = [];

  for (const chat of chats) {
    const reasons = [];
    if (protectedTargetIds.has(chat.targetId)) reasons.push('protected-target');
    if (protectedConversationIds.has(chat.conversationId)) reasons.push('protected-conversation');
    if (options.protectRoomWatch !== false && defaultProtectedTitle(chat.title)) reasons.push('room-watch');
    let classification;
    let custodyReason = null;
    const policyItem = roomPolicy.get(chat.conversationId);
    if (reasons.length) {
      classification = 'protected';
    } else if (duplicates.has(chat.conversationId)) {
      classification = 'unknown';
      custodyReason = 'duplicate-conversation-targets';
    } else {
      const policy = policyClassification(policyItem);
      classification = policy.classification;
      custodyReason = policy.reason;
    }

    let activity = null;
    let probeError = null;
    try {
      activity = await browser.probeTargetActivity(rawById.get(chat.targetId));
    } catch (error) {
      probeError = error.message;
    }
    const hasDraft = Boolean(String(activity?.draft || '').trim());
    const generating = Boolean(activity?.generating);
    if (classification !== 'protected' && (hasDraft || generating)) classification = 'busy';
    if (classification !== 'protected' && probeError) classification = 'unknown';
    if (custodyReason) reasons.push(custodyReason);
    tabs.push({
      ...chat,
      classification,
      reasons,
      roomId: policyItem?.room?.id || null,
      ticketId: policyItem?.room?.ticketId || null,
      hasDraft,
      generating,
      probeError
    });
  }

  const counts = {
    open: tabs.length,
    protected: tabs.filter((tab) => tab.classification === 'protected').length,
    busy: tabs.filter((tab) => tab.classification === 'busy').length,
    unknown: tabs.filter((tab) => tab.classification === 'unknown').length,
    unmanaged: tabs.filter((tab) => tab.classification === 'unmanaged').length,
    eligible: tabs.filter((tab) => tab.classification === 'eligible').length
  };
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    health: counts.eligible || counts.unknown || counts.unmanaged ? 'attention' : 'healthy',
    counts,
    tabs
  };
}

export async function cleanTabHygiene(browser, options = {}) {
  if (!browser || typeof browser.closeTarget !== 'function') throw new Error('browser adapter must implement closeTarget');
  const initialPolicy = typeof options.refreshRoomPolicy === 'function'
    ? await options.refreshRoomPolicy()
    : options.roomPolicy;
  const before = await auditTabHygiene(browser, { ...options, roomPolicy: initialPolicy });
  if (options.dryRun) {
    return { schemaVersion: 2, generatedAt: new Date().toISOString(), status: 'planned', before, closed: [], skipped: [], uncertain: [] };
  }

  const closed = [];
  const skipped = [];
  const uncertain = [];
  const maxClose = Number.isFinite(Number(options.maxClose)) ? Math.max(0, Number(options.maxClose)) : 1;
  for (const tab of before.tabs.filter((item) => item.classification === 'eligible').slice(0, maxClose)) {
    const currentPolicy = typeof options.refreshRoomPolicy === 'function'
      ? await options.refreshRoomPolicy()
      : initialPolicy;
    const policyItem = currentPolicy instanceof Map ? currentPolicy.get(tab.conversationId) : null;
    if (policyClassification(policyItem).classification !== 'eligible') {
      skipped.push({ targetId: tab.targetId, conversationId: tab.conversationId, reason: 'custody-changed' });
      continue;
    }
    const currentTargets = await browser.listTargets();
    const current = currentTargets.find((target) => targetIdentity(target) === tab.targetId);
    if (!current) {
      skipped.push({ targetId: tab.targetId, conversationId: tab.conversationId, reason: 'already-closed' });
      continue;
    }
    if (conversationIdentity(current.url) !== tab.conversationId) {
      skipped.push({ targetId: tab.targetId, conversationId: tab.conversationId, reason: 'target-identity-changed' });
      continue;
    }
    try {
      const activity = await browser.probeTargetActivity(current);
      if (String(activity?.draft || '').trim() || activity?.generating) {
        skipped.push({ targetId: tab.targetId, conversationId: tab.conversationId, reason: 'became-busy' });
        continue;
      }
    } catch (error) {
      skipped.push({ targetId: tab.targetId, conversationId: tab.conversationId, reason: 'probe-uncertain', error: error.message });
      continue;
    }
    try {
      await browser.closeTarget(tab.targetId);
    } catch (error) {
      const finding = { targetId: tab.targetId, conversationId: tab.conversationId, reason: 'close-request-uncertain', error: error.message };
      uncertain.push(finding);
      if (typeof options.onUncertain === 'function') {
        try { await options.onUncertain(tab, finding); } catch (error) { finding.registryUpdateError = error.message; }
      }
      continue;
    }
    const remaining = await browser.listTargets();
    if (remaining.some((target) => targetIdentity(target) === tab.targetId)) {
      const finding = { targetId: tab.targetId, conversationId: tab.conversationId, reason: 'close-unverified' };
      uncertain.push(finding);
      if (typeof options.onUncertain === 'function') {
        try { await options.onUncertain(tab, finding); } catch (error) { finding.registryUpdateError = error.message; }
      }
    } else {
      const finding = { targetId: tab.targetId, conversationId: tab.conversationId, roomId: tab.roomId, ticketId: tab.ticketId };
      closed.push(finding);
      if (typeof options.onClosed === 'function') {
        try { await options.onClosed(tab, finding); } catch (error) {
          finding.registryUpdateError = error.message;
          uncertain.push({ ...finding, reason: 'registry-close-update-failed', error: error.message });
        }
      }
    }
  }
  const finalPolicy = typeof options.refreshRoomPolicy === 'function'
    ? await options.refreshRoomPolicy()
    : initialPolicy;
  const after = await auditTabHygiene(browser, { ...options, roomPolicy: finalPolicy });
  const status = uncertain.length
    ? 'uncertain'
    : after.counts.eligible
      ? 'partial'
      : after.counts.unknown || after.counts.unmanaged
        ? 'attention'
        : 'clean';
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), status, before, after, closed, skipped, uncertain };
}

export function formatTabHygiene(report) {
  const lines = [
    'GAMEDECK CADOPS BROWSER HYGIENE',
    `Generated: ${report.generatedAt}`,
    `Health: ${report.health.toUpperCase()}`,
    `Open: ${report.counts.open} | Protected: ${report.counts.protected} | Busy: ${report.counts.busy} | Eligible: ${report.counts.eligible} | Unmanaged: ${report.counts.unmanaged} | Unknown: ${report.counts.unknown}`
  ];
  for (const tab of report.tabs.filter((item) => ['eligible', 'unmanaged', 'unknown'].includes(item.classification))) {
    lines.push(`- ${tab.classification.toUpperCase()} ${tab.targetId} ${tab.ticketId || '-'} ${tab.title || '(untitled chat)'}`);
  }
  if (!report.counts.eligible && !report.counts.unmanaged && !report.counts.unknown) lines.push('- no browser hygiene findings');
  return lines.join('\n');
}

export function writeReceipt(file, receipt) {
  const absolute = path.resolve(required(file, 'receipt path'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temp = absolute + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, absolute);
  return absolute;
}

const DEFAULT_LEDGER = 'ops/cadops/ledger.json';
const DEFAULT_ROOMS = '.cadops-private/chatchains/rooms.json';
const DEFAULT_RECEIPT_DIR = '.cadops-private/chatchains/receipts';
const DEFAULT_LOCK = '.cadops-private/chatchains/browser.lock';

function privatePath(value, fallback) {
  return path.resolve(value || fallback);
}

export async function withFileLock(file, operation) {
  const absolute = path.resolve(required(file, 'lock file'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + '\n');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('another ChatChain browser operation holds the lock');
    throw error;
  }
  try {
    return await operation();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(absolute); } catch {}
  }
}

function receiptFile(directory, prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(path.resolve(directory), `${prefix}-${stamp}-${process.pid}.json`);
}

function loadCustodyPolicy(ledgerFile, roomsFile) {
  const ledger = loadLedger(ledgerFile);
  const registry = loadRoomRegistry(roomsFile);
  return { ledger, registry, policy: buildRoomPolicy(registry, ledger) };
}

function roomForTicket(registry, ticketId) {
  const matches = registry.rooms.filter((room) => room.ticketId === ticketId);
  if (matches.length !== 1) throw new Error(matches.length ? `ticket ${ticketId} has ambiguous rooms` : `ticket ${ticketId} has no bound room`);
  return matches[0];
}

export function assertCustodyHandoff(ledger, registry, predecessorTicketId, successorTicketId) {
  const predecessor = ledger.tickets.find((ticket) => ticket.id === predecessorTicketId);
  const successor = ledger.tickets.find((ticket) => ticket.id === successorTicketId);
  if (!predecessor || !successor) throw new Error('predecessor and successor tickets must exist');
  if (predecessor.status !== 'completed') throw new Error('predecessor ticket must be completed');
  if (predecessor.successorTicketId !== successor.id || successor.predecessorTicketId !== predecessor.id) {
    throw new Error('tickets are not an exact CADOps custody handoff');
  }
  if (!['accepted', 'active', 'completed'].includes(successor.status)) throw new Error('successor ticket has not accepted custody');
  const predecessorRoom = roomForTicket(registry, predecessor.id);
  const successorRoom = roomForTicket(registry, successor.id);
  const eligibility = roomEligibility(predecessorRoom, ledger, registry);
  if (eligibility.disposition !== 'eligible') throw new Error(`predecessor room is not close-eligible: ${eligibility.reason}`);
  if (successorRoom.state !== 'open') throw new Error('successor room is not open');
  if (!successorRoom.verifiedAt) throw new Error('successor room is not verified');
  if (predecessorRoom.conversationId === successorRoom.conversationId) throw new Error('predecessor and successor rooms must differ');
  return { predecessor, successor, predecessorRoom, successorRoom };
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { result._.push(token); continue; }
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (['json', 'dryRun', 'apply'].includes(key)) result[key] = true;
    else if (['protectedTarget', 'protectedUrl'].includes(key)) {
      const field = key === 'protectedTarget' ? 'protectedTargetIds' : 'protectedUrls';
      result[field] ||= [];
      result[field].push(required(argv[++i], token));
    } else result[key] = required(argv[++i], token);
  }
  return result;
}

function help() {
  return [
    'GameDeck ChatChain tab lifecycle',
    '',
    'Commands:',
    '  status --cdp http://127.0.0.1:9222',
    '  audit --cdp URL [--ledger FILE] [--rooms FILE] [--json]',
    '  clean --cdp URL --apply [--ledger FILE] [--rooms FILE] [--max-close 1]',
    '  handoff --cdp URL --predecessor-ticket E-0001 --successor-ticket T-0001',
    '',
    'Room bindings are private by default under .cadops-private/chatchains/.',
    'Only ledger-proven close-eligible rooms can be closed automatically.',
    'Unmanaged, active, review, draft, generating, duplicate, and uncertain rooms stay open.'
  ].join('\n');
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (command === 'help' || args.help) { console.log(help()); return; }
  const endpoint = args.cdp || process.env.CHATCHAIN_CDP_URL;
  const browser = new HttpCdpBrowser(endpoint);
  const ledgerFile = privatePath(args.ledger, DEFAULT_LEDGER);
  const roomsFile = privatePath(args.rooms, DEFAULT_ROOMS);
  const receiptDirectory = privatePath(args.receiptDir, DEFAULT_RECEIPT_DIR);
  const lockFile = privatePath(args.lock, DEFAULT_LOCK);
  const actor = args.actor || 'cadops-browser-operator';

  if (command === 'status') {
    const targets = listChatTargets(await browser.listTargets()).map((target) => ({
      targetId: target.targetId,
      conversationId: target.conversationId,
      title: target.title
    }));
    console.log(args.json ? JSON.stringify(targets, null, 2) : targets.map((target) => `${target.targetId} ${target.conversationId} ${target.title}`).join('\n'));
    return;
  }

  if (command === 'audit' || command === 'clean') {
    const loaded = loadCustodyPolicy(ledgerFile, roomsFile);
    const baseOptions = {
      protectedTargetIds: args.protectedTargetIds,
      protectedUrls: args.protectedUrls,
      maxClose: args.maxClose ? Number(args.maxClose) : undefined,
      roomPolicy: loaded.policy
    };
    if (command === 'audit') {
      const report = await auditTabHygiene(browser, baseOptions);
      console.log(args.json ? JSON.stringify(report, null, 2) : formatTabHygiene(report));
      if (report.health !== 'healthy') process.exitCode = 2;
      return;
    }

    const receipt = await withFileLock(lockFile, async () => cleanTabHygiene(browser, {
      ...baseOptions,
      dryRun: !args.apply,
      refreshRoomPolicy: async () => loadCustodyPolicy(ledgerFile, roomsFile).policy,
      onClosed: async (tab, finding) => {
        const current = loadCustodyPolicy(ledgerFile, roomsFile);
        const operation = markRoomClosed(current.registry, current.ledger, { conversationId: tab.conversationId }, {
          actor,
          targetId: finding.targetId,
          reason: 'browser-close-verified'
        });
        saveRoomRegistry(roomsFile, operation.registry, current.ledger);
      },
      onUncertain: async (tab, finding) => {
        const current = loadCustodyPolicy(ledgerFile, roomsFile);
        const operation = markRoomUncertain(current.registry, current.ledger, { conversationId: tab.conversationId }, {
          actor,
          targetId: finding.targetId,
          reason: finding.reason
        });
        saveRoomRegistry(roomsFile, operation.registry, current.ledger);
      }
    }));
    const outputFile = args.receipt || receiptFile(receiptDirectory, 'browser-clean');
    writeReceipt(outputFile, receipt);
    console.log(args.json ? JSON.stringify({ receiptFile: outputFile, ...receipt }, null, 2) : [
      'CADOps browser cleanup: ' + receipt.status,
      'Closed: ' + receipt.closed.length,
      'Skipped: ' + receipt.skipped.length,
      'Uncertain: ' + receipt.uncertain.length,
      'Receipt: ' + outputFile,
      receipt.after ? `Remaining eligible: ${receipt.after.counts.eligible}` : `Planned closures: ${receipt.before.counts.eligible}`
    ].join('\n'));
    if (!['clean', 'planned'].includes(receipt.status)) process.exitCode = 2;
    return;
  }

  if (command !== 'handoff') throw new Error('unknown command: ' + command);
  const predecessorTicketId = required(args.predecessorTicket, 'predecessor ticket');
  const successorTicketId = required(args.successorTicket, 'successor ticket');
  const receipt = await withFileLock(lockFile, async () => {
    const current = loadCustodyPolicy(ledgerFile, roomsFile);
    const custody = assertCustodyHandoff(current.ledger, current.registry, predecessorTicketId, successorTicketId);
    const result = await handoffTabs(browser, {
      predecessorTargetId: args.predecessorTarget,
      predecessorUrl: args.predecessorUrl || custody.predecessorRoom.url,
      successorTargetId: args.successorTarget,
      successorUrl: args.successorUrl || custody.successorRoom.url,
      protectedTargetIds: args.protectedTargetIds,
      timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
      pollIntervalMs: args.pollIntervalMs ? Number(args.pollIntervalMs) : undefined,
      stablePolls: args.stablePolls ? Number(args.stablePolls) : undefined,
      dryRun: Boolean(args.dryRun)
    });
    if (!args.dryRun && result.predecessorClosed === true) {
      const latest = loadCustodyPolicy(ledgerFile, roomsFile);
      const observedAbsent = result.status === 'already-closed';
      const operation = markRoomClosed(latest.registry, latest.ledger, { ticketId: predecessorTicketId }, {
        actor,
        targetId: result.predecessor?.targetId || `absent:${custody.predecessorRoom.conversationId}`,
        reason: observedAbsent ? 'predecessor-already-absent' : 'successor-custody-visible',
        successorTicketId
      });
      saveRoomRegistry(roomsFile, operation.registry, latest.ledger);
    } else if (!args.dryRun && result.status === 'uncertain') {
      const latest = loadCustodyPolicy(ledgerFile, roomsFile);
      const operation = markRoomUncertain(latest.registry, latest.ledger, { ticketId: predecessorTicketId }, {
        actor,
        targetId: result.predecessor?.targetId || null,
        reason: result.errorCode || 'handoff-close-uncertain'
      });
      saveRoomRegistry(roomsFile, operation.registry, latest.ledger);
    }
    return result;
  });
  const outputFile = args.receipt || receiptFile(receiptDirectory, 'tab-handoff');
  writeReceipt(outputFile, receipt);
  console.log(args.json ? JSON.stringify({ receiptFile: outputFile, ...receipt }, null, 2) : [
    'ChatChain tab handoff: ' + receipt.status,
    'Successor ticket: ' + successorTicketId,
    'Predecessor closed: ' + String(receipt.predecessorClosed),
    'Receipt: ' + outputFile,
    receipt.requiresRecovery ? 'Recovery required: yes' : 'Recovery required: no'
  ].join('\n'));
  if (receipt.status === 'uncertain') process.exitCode = 2;
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direct) runCli().catch((error) => {
  console.error('ChatChain tab lifecycle failed: ' + error.message);
  process.exitCode = 1;
});
