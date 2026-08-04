import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLedger, issue, accept, start, complete, handoff } from './cadops-core.mjs';
import { createRoomRegistry, bindRoom, verifyRoom } from './chatchain-room-registry.mjs';
import {
  conversationIdentity,
  listChatTargets,
  HttpCdpBrowser,
  handoffTabs,
  auditTabHygiene,
  cleanTabHygiene,
  assertCustodyHandoff,
  withFileLock,
  writeReceipt
} from './chatchain-tab-lifecycle.mjs';

const chat = (id, conversation, extra = {}) => ({
  id,
  type: 'page',
  title: conversation,
  url: 'https://chatgpt.com/c/' + conversation,
  ...extra
});
const clone = (value) => structuredClone(value);

class FakeBrowser {
  constructor(targets, options = {}) {
    this.targets = clone(targets);
    this.options = options;
    this.calls = [];
  }
  async listTargets() {
    this.calls.push('list');
    return clone(this.targets);
  }
  async probeTargetReady(target) {
    this.calls.push('probe:' + target.id);
    return this.options.ready !== false;
  }
  async probeTargetActivity(target) {
    this.calls.push('activity:' + target.id);
    if (this.options.activityErrors?.[target.id]) throw new Error(this.options.activityErrors[target.id]);
    const value = this.options.activity?.[target.id] || {};
    return { draft: value.draft || '', generating: Boolean(value.generating) };
  }
  async activateTarget(id) {
    this.calls.push('activate:' + id);
    if (this.options.disappearSuccessorOnActivate) this.targets = this.targets.filter((target) => target.id !== id);
    if (this.options.mutatePredecessorOnActivate) {
      const old = this.targets.find((target) => target.id === this.options.mutatePredecessorOnActivate);
      if (old) old.url = 'https://chatgpt.com/c/reused-target-conversation';
    }
  }
  async closeTarget(id) {
    this.calls.push('close:' + id);
    if (this.options.closeError) throw new Error(this.options.closeError);
    if (!this.options.closeNoop) this.targets = this.targets.filter((target) => target.id !== id);
    if (this.options.disappearSuccessorAfterClose) {
      this.targets = this.targets.filter((target) => target.id !== this.options.disappearSuccessorAfterClose);
    }
  }
}

assert.equal(conversationIdentity('https://chatgpt.com/c/6a700994-f9e4-83ea-af33-173671c3a8ac'), '6a700994-f9e4-83ea-af33-173671c3a8ac');
assert.equal(conversationIdentity('https://chatgpt.com/'), null);
assert.equal(conversationIdentity('http://chatgpt.com/c/not-secure'), null);
assert.equal(conversationIdentity('https://example.com/c/wrong-host'), null);
console.log('ok - conversation identity is strict');

assert.throws(() => new HttpCdpBrowser('https://example.com:9222'), /loopback-only/);
console.log('ok - CDP endpoint is restricted to loopback');

assert.deepEqual(listChatTargets([
  chat('old', 'old-conversation'),
  { id: 'settings', type: 'page', url: 'https://chatgpt.com/settings', title: 'Settings' },
  { id: 'worker', type: 'service_worker', url: 'https://chatgpt.com/sw.js' }
]), [{ targetId: 'old', conversationId: 'old-conversation', url: 'https://chatgpt.com/c/old-conversation', title: 'old-conversation' }]);
console.log('ok - only conversation pages are listed');

{
  const browser = new FakeBrowser([
    chat('old', 'old-conversation'),
    chat('next', 'next-conversation'),
    chat('other', 'other-conversation')
  ]);
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 2, pollIntervalMs: 1, timeoutMs: 50
  });
  assert.equal(receipt.status, 'closed');
  assert.equal(receipt.predecessorClosed, true);
  assert.equal(browser.targets.some((target) => target.id === 'old'), false);
  assert.equal(browser.targets.some((target) => target.id === 'next'), true);
  assert.equal(browser.targets.some((target) => target.id === 'other'), true);
  assert.equal(browser.calls.filter((call) => call === 'close:old').length, 1);
  assert(browser.calls.indexOf('activate:next') < browser.calls.indexOf('close:old'));
}
console.log('ok - successor is verified before exactly one predecessor closes');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), { id: 'next', type: 'page', url: 'https://chatgpt.com/' }]);
  await assert.rejects(() => handoffTabs(browser, { predecessorTargetId: 'old', successorTargetId: 'next' }), /not an open ChatGPT conversation/);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - non-conversation successor cannot close predecessor');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')]);
  await assert.rejects(() => handoffTabs(browser, {
    predecessorTargetId: 'old',
    predecessorUrl: 'https://chatgpt.com/c/different-conversation',
    successorTargetId: 'next',
    successorUrl: 'https://chatgpt.com/c/next-conversation'
  }), /identify different conversations/);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - target ID and URL must identify the same conversation');

{
  let ledger = createLedger('GameDeck', new Date('2026-08-04T04:00:00.000Z'));
  ledger = issue(ledger, { lane: 'E', objective: 'Protected build', assignee: 'builder', authorizedBy: 'orchestrator' }).ledger;
  ledger = accept(ledger, { ticketId: 'E-0001', actor: 'builder' }).ledger;
  ledger = start(ledger, { ticketId: 'E-0001', actor: 'builder', launchEvidence: 'visible builder room' }).ledger;
  let registry = createRoomRegistry('GameDeck');
  registry = bindRoom(registry, ledger, {
    ticketId: 'E-0001', url: 'https://chatgpt.com/c/protected-builder-room', actor: 'orchestrator', protectedRoom: true
  }).registry;
  registry = verifyRoom(registry, ledger, { ticketId: 'E-0001' }, { actor: 'orchestrator' }).registry;
  ledger = complete(ledger, { ticketId: 'E-0001', actor: 'builder', outcome: 'pass', summary: 'done', softwareVersion: 'v1' }).ledger;
  ledger = handoff(ledger, { ticketId: 'E-0001', lane: 'T', objective: 'test', assignee: 'tester', authorizedBy: 'orchestrator' }).ledger;
  registry = bindRoom(registry, ledger, { ticketId: 'T-0001', url: 'https://chatgpt.com/c/tester-room', actor: 'orchestrator' }).registry;
  registry = verifyRoom(registry, ledger, { ticketId: 'T-0001' }, { actor: 'orchestrator' }).registry;
  ledger = accept(ledger, { ticketId: 'T-0001', actor: 'tester' }).ledger;
  assert.throws(() => assertCustodyHandoff(ledger, registry, 'E-0001', 'T-0001'), /not close-eligible: room-protected/);
}
console.log('ok - protected room policy fails before browser mutation');

{
  const browser = new FakeBrowser([chat('old', 'same-conversation'), chat('next', 'same-conversation')]);
  await assert.rejects(() => handoffTabs(browser, { predecessorTargetId: 'old', successorTargetId: 'next' }), /conversations must differ/);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - duplicate conversation identity is rejected');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], { ready: false });
  await assert.rejects(() => handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 8
  }), /not stably open/);
  assert.equal(browser.calls.some((call) => call === 'close:old'), false);
}
console.log('ok - unready successor leaves predecessor open');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')]);
  await assert.rejects(() => handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', protectedTargetIds: ['old']
  }), /protected/);
  assert.equal(browser.calls.some((call) => call === 'close:old'), false);
}
console.log('ok - protected predecessor is never closed');

{
  const browser = new FakeBrowser([chat('next', 'next-conversation')]);
  const receipt = await handoffTabs(browser, {
    predecessorUrl: 'https://chatgpt.com/c/old-conversation',
    successorTargetId: 'next',
    stablePolls: 1,
    pollIntervalMs: 1,
    timeoutMs: 20
  });
  assert.equal(receipt.status, 'already-closed');
  assert.equal(receipt.successorVerified, true);
  assert.equal(receipt.predecessor.conversationId, 'old-conversation');
  assert(browser.calls.includes('activate:next'));
  assert(browser.calls.includes('probe:next'));
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - already closed predecessor still requires verified successor readiness');

{
  const browser = new FakeBrowser([chat('next', 'next-conversation')], { ready: false });
  await assert.rejects(() => handoffTabs(browser, {
    predecessorUrl: 'https://chatgpt.com/c/old-conversation',
    successorTargetId: 'next',
    stablePolls: 1,
    pollIntervalMs: 1,
    timeoutMs: 8
  }), /not stably open/);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - absent predecessor cannot bypass unready successor checks');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], {
    disappearSuccessorOnActivate: true
  });
  await assert.rejects(() => handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 8
  }), /not stably open/);
  assert.equal(browser.targets.some((target) => target.id === 'old'), true);
}
console.log('ok - disappearing successor leaves predecessor open');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], {
    mutatePredecessorOnActivate: 'old'
  });
  await assert.rejects(() => handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 20
  }), /changed identity/);
  assert.equal(browser.calls.some((call) => call === 'close:old'), false);
}
console.log('ok - predecessor target reuse is detected before close');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], {
    closeError: 'connection ended after dispatch'
  });
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 20
  });
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.predecessorClosed, null);
  assert.equal(receipt.requiresRecovery, true);
  assert.equal(browser.calls.filter((call) => call === 'close:old').length, 1);
}
console.log('ok - uncertain close is not replayed');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], { closeNoop: true });
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 8
  });
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.errorCode, 'CLOSE_UNVERIFIED');
  assert.equal(browser.calls.filter((call) => call === 'close:old').length, 1);
}
console.log('ok - unverified closure requires recovery');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')], {
    disappearSuccessorAfterClose: 'next'
  });
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', stablePolls: 1, pollIntervalMs: 1, timeoutMs: 8
  });
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.predecessorClosed, true);
  assert.equal(receipt.errorCode, 'POST_CLOSE_SUCCESSOR_UNCERTAIN');
}
console.log('ok - post-close successor loss is reported honestly');

{
  const browser = new FakeBrowser([chat('old', 'old-conversation'), chat('next', 'next-conversation')]);
  const receipt = await handoffTabs(browser, {
    predecessorTargetId: 'old', successorTargetId: 'next', dryRun: true
  });
  assert.equal(receipt.status, 'planned');
  assert.deepEqual(browser.calls, ['list']);
}
console.log('ok - dry run has no browser side effects');

{
  const browser = new FakeBrowser([
    chat('watch', 'watch-conversation', { title: 'GameDeck Room Watch' }),
    chat('draft', 'draft-conversation'),
    chat('stream', 'stream-conversation'),
    chat('idle', 'idle-conversation'),
    chat('unknown', 'unknown-conversation')
  ], {
    activity: {
      draft: { draft: 'unsent handoff' },
      stream: { generating: true }
    },
    activityErrors: { unknown: 'target probe unavailable' }
  });
  const report = await auditTabHygiene(browser, { roomPolicy: new Map() });
  assert.equal(report.health, 'attention');
  assert.deepEqual(report.counts, { open: 5, protected: 1, busy: 2, unknown: 1, unmanaged: 1, eligible: 0 });
  assert.equal(report.tabs.find((tab) => tab.targetId === 'watch').classification, 'protected');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'draft').classification, 'busy');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'stream').classification, 'busy');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'unknown').classification, 'unknown');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'idle').classification, 'unmanaged');
}
console.log('ok - hygiene audit protects Room Watch, drafts, generating work, and unmanaged rooms');

{
  const policy = new Map([
    ['active-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'keep', reason: 'ticket-active' } }],
    ['eligible-conversation', { room: { id: 'ROOM-0002', ticketId: 'E-0002' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }]
  ]);
  const browser = new FakeBrowser([
    chat('active', 'active-conversation'),
    chat('eligible', 'eligible-conversation')
  ]);
  const receipt = await cleanTabHygiene(browser, { roomPolicy: policy });
  assert.equal(receipt.status, 'clean');
  assert.deepEqual(receipt.closed.map((item) => item.targetId), ['eligible']);
  assert.equal(browser.targets.some((target) => target.id === 'active'), true);
  assert.equal(browser.targets.some((target) => target.id === 'eligible'), false);
  assert.equal(browser.calls.filter((call) => call === 'close:eligible').length, 1);
  assert.equal(browser.calls.filter((call) => call === 'close:active').length, 0);
}
console.log('ok - cleanup closes only ledger-eligible rooms and preserves idle active custody');

{
  const policy = new Map([
    ['first-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }],
    ['second-conversation', { room: { id: 'ROOM-0002', ticketId: 'E-0002' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }]
  ]);
  const browser = new FakeBrowser([chat('first', 'first-conversation'), chat('second', 'second-conversation')]);
  const receipt = await cleanTabHygiene(browser, { roomPolicy: policy });
  assert.equal(receipt.status, 'partial');
  assert.equal(receipt.closed.length, 1);
  assert.equal(browser.calls.filter((call) => call.startsWith('close:')).length, 1);
}
console.log('ok - cleanup closes at most one room by default');

{
  const eligible = new Map([
    ['changing-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }]
  ]);
  const protectedPolicy = new Map([
    ['changing-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'keep', reason: 'ticket-active' } }]
  ]);
  let refreshes = 0;
  const browser = new FakeBrowser([chat('changing', 'changing-conversation')]);
  const receipt = await cleanTabHygiene(browser, {
    roomPolicy: eligible,
    refreshRoomPolicy: async () => (++refreshes === 1 ? eligible : protectedPolicy)
  });
  assert.equal(receipt.closed.length, 0);
  assert.equal(receipt.skipped[0].reason, 'custody-changed');
  assert.equal(browser.calls.some((call) => call === 'close:changing'), false);
}
console.log('ok - cleanup rechecks custody immediately before close');

{
  const policy = new Map([
    ['duplicate-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }]
  ]);
  const browser = new FakeBrowser([chat('one', 'duplicate-conversation'), chat('two', 'duplicate-conversation')]);
  const report = await auditTabHygiene(browser, { roomPolicy: policy });
  assert.equal(report.counts.unknown, 2);
  const receipt = await cleanTabHygiene(browser, { roomPolicy: policy });
  assert.equal(receipt.closed.length, 0);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - duplicate conversation targets are never auto-closed');

{
  const browser = new FakeBrowser([chat('idle', 'idle-conversation')]);
  const receipt = await cleanTabHygiene(browser, { roomPolicy: new Map(), dryRun: true });
  assert.equal(receipt.status, 'planned');
  assert.equal(browser.targets.some((target) => target.id === 'idle'), true);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - hygiene cleanup dry run has no browser side effects');

{
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-chatchain-lock-'));
  const lock = path.join(folder, 'browser.lock');
  let nestedRejected = false;
  await withFileLock(lock, async () => {
    await assert.rejects(() => withFileLock(lock, async () => {}), /holds the lock/);
    nestedRejected = true;
  });
  assert.equal(nestedRejected, true);
  assert.equal(fs.existsSync(lock), false);
}
console.log('ok - browser mutation lock rejects concurrent cleanup');

{
  const policy = new Map([
    ['eligible-conversation', { room: { id: 'ROOM-0001', ticketId: 'E-0001' }, eligibility: { disposition: 'eligible', reason: 'successor-custody-visible' } }]
  ]);
  const browser = new FakeBrowser([chat('eligible', 'eligible-conversation')]);
  const receipt = await cleanTabHygiene(browser, {
    roomPolicy: policy,
    onClosed: async () => { throw new Error('registry disk unavailable'); }
  });
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.closed[0].registryUpdateError, 'registry disk unavailable');
  assert.equal(receipt.uncertain[0].reason, 'registry-close-update-failed');
  assert.equal(browser.targets.length, 0);
}
console.log('ok - verified browser closure survives registry update failure with recovery evidence');

{
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-chatchain-'));
  const file = path.join(folder, 'receipt.json');
  const receipt = { schemaVersion: 1, status: 'closed', predecessorClosed: true };
  assert.equal(writeReceipt(file, receipt), path.resolve(file));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), receipt);
  assert.equal(fs.readdirSync(folder).some((name) => name.endsWith('.tmp')), false);
}
console.log('ok - receipt writes atomically');

{
  let targets = [chat('old', 'old-conversation'), chat('next', 'next-conversation')];
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/list') return response.end(JSON.stringify(targets));
    if (request.url === '/json/activate/next') return response.end(JSON.stringify({ activated: true }));
    if (request.url === '/json/close/old') {
      targets = targets.filter((target) => target.id !== 'old');
      return response.end(JSON.stringify({ closed: true }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'missing' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const browser = new HttpCdpBrowser('http://127.0.0.1:' + address.port);
    browser.probeTargetReady = async () => ({ ready: true });
    const receipt = await handoffTabs(browser, {
      predecessorUrl: 'https://chatgpt.com/c/old-conversation',
      successorUrl: 'https://chatgpt.com/c/next-conversation',
      stablePolls: 1,
      pollIntervalMs: 1,
      timeoutMs: 50
    });
    assert.equal(receipt.status, 'closed');
    assert(requests.includes('/json/activate/next'));
    assert(requests.includes('/json/close/old'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
console.log('ok - HTTP CDP adapter performs verified handoff');

console.log('chatchain tab lifecycle: 28 scenarios passed');
