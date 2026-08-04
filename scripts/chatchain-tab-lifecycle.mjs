import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    return {
      schemaVersion: 1,
      generatedAt,
      status: 'already-closed',
      predecessorClosed: true,
      successorVerified: true,
      successor: { targetId: successor.id, conversationId: successor.conversationId, url: successor.url },
      sideEffects: []
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

export function writeReceipt(file, receipt) {
  const absolute = path.resolve(required(file, 'receipt path'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temp = absolute + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, absolute);
  return absolute;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { result._.push(token); continue; }
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (['json', 'dryRun'].includes(key)) result[key] = true;
    else if (key === 'protectedTarget') {
      result.protectedTargetIds ||= [];
      result.protectedTargetIds.push(required(argv[++i], token));
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
    '  handoff --cdp URL --predecessor-target ID --successor-target ID [--receipt FILE]',
    '  handoff --cdp URL --predecessor-url CHAT_URL --successor-url CHAT_URL [--dry-run]',
    '',
    'The predecessor closes only after the successor conversation is activated and stably verified.',
    'On uncertainty, the predecessor remains open or the result is reported as recovery-required.'
  ].join('\n');
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (command === 'help' || args.help) { console.log(help()); return; }
  const endpoint = args.cdp || process.env.CHATCHAIN_CDP_URL;
  const browser = new HttpCdpBrowser(endpoint);
  if (command === 'status') {
    const targets = listChatTargets(await browser.listTargets());
    console.log(args.json ? JSON.stringify(targets, null, 2) : targets.map((t) => t.targetId + ' ' + t.url).join('\n'));
    return;
  }
  if (command !== 'handoff') throw new Error('unknown command: ' + command);
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: args.predecessorTarget,
    predecessorUrl: args.predecessorUrl,
    successorTargetId: args.successorTarget,
    successorUrl: args.successorUrl,
    protectedTargetIds: args.protectedTargetIds,
    timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
    pollIntervalMs: args.pollIntervalMs ? Number(args.pollIntervalMs) : undefined,
    stablePolls: args.stablePolls ? Number(args.stablePolls) : undefined,
    dryRun: Boolean(args.dryRun)
  });
  if (args.receipt) writeReceipt(args.receipt, receipt);
  console.log(args.json ? JSON.stringify(receipt, null, 2) : [
    'ChatChain tab handoff: ' + receipt.status,
    'Successor: ' + receipt.successor.url,
    'Predecessor closed: ' + String(receipt.predecessorClosed),
    receipt.requiresRecovery ? 'Recovery required: yes' : 'Recovery required: no'
  ].join('\n'));
  if (receipt.status === 'uncertain') process.exitCode = 2;
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direct) runCli().catch((error) => {
  console.error('ChatChain tab lifecycle failed: ' + error.message);
  process.exitCode = 1;
});
