import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  conversationIdentity,
  listChatTargets,
  HttpCdpBrowser,
  handoffTabs,
  auditTabHygiene,
  cleanTabHygiene,
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
  const receipt = await handoffTabs(browser, { predecessorTargetId: 'old', successorTargetId: 'next' });
  assert.equal(receipt.status, 'already-closed');
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - already closed predecessor is idempotent');

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
  const report = await auditTabHygiene(browser);
  assert.equal(report.health, 'attention');
  assert.deepEqual(report.counts, { open: 5, protected: 1, busy: 2, unknown: 1, stale: 1 });
  assert.equal(report.tabs.find((tab) => tab.targetId === 'watch').classification, 'protected');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'draft').classification, 'busy');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'stream').classification, 'busy');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'unknown').classification, 'unknown');
  assert.equal(report.tabs.find((tab) => tab.targetId === 'idle').classification, 'stale');
}
console.log('ok - hygiene audit protects Room Watch, drafts, generating work, and uncertain probes');

{
  const browser = new FakeBrowser([
    chat('watch', 'watch-conversation', { title: 'GameDeck Room Watch' }),
    chat('draft', 'draft-conversation'),
    chat('stream', 'stream-conversation'),
    chat('idle', 'idle-conversation')
  ], {
    activity: {
      draft: { draft: 'unsent handoff' },
      stream: { generating: true }
    }
  });
  const receipt = await cleanTabHygiene(browser);
  assert.equal(receipt.status, 'clean');
  assert.deepEqual(receipt.closed.map((item) => item.targetId), ['idle']);
  assert.equal(browser.targets.some((target) => target.id === 'idle'), false);
  assert.equal(browser.targets.some((target) => target.id === 'watch'), true);
  assert.equal(browser.targets.some((target) => target.id === 'draft'), true);
  assert.equal(browser.targets.some((target) => target.id === 'stream'), true);
  assert.equal(browser.calls.filter((call) => call === 'close:idle').length, 1);
}
console.log('ok - hygiene cleanup closes only idle unprotected tabs');

{
  const browser = new FakeBrowser([chat('idle', 'idle-conversation')]);
  const receipt = await cleanTabHygiene(browser, { dryRun: true });
  assert.equal(receipt.status, 'planned');
  assert.equal(browser.targets.some((target) => target.id === 'idle'), true);
  assert.equal(browser.calls.some((call) => call.startsWith('close:')), false);
}
console.log('ok - hygiene cleanup dry run has no browser side effects');

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

console.log('chatchain tab lifecycle: 19 scenarios passed');
