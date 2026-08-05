import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  buildWindowsPresentationScript,
  buildWindowsCloseScript,
  handoffHostWindowForNativeGame,
  normalizePresentationMode,
  parsePresentationResult,
  presentNativeGameWindow,
  requestNativeGameWindowClose
} = require('../native-window-presenter.js');
assert.equal(normalizePresentationMode('native-fullscreen'), 'native-fullscreen');
assert.equal(normalizePresentationMode('borderless-fullscreen'), 'borderless-fullscreen');
assert.equal(normalizePresentationMode('centered'), 'centered');
assert.equal(normalizePresentationMode('unknown'), 'centered');
assert.throws(() => buildWindowsPresentationScript({ pid: 0 }), /positive integer/);
const fullscreenScript = buildWindowsPresentationScript({ pid: 4242, mode: 'borderless-fullscreen', timeoutMs: 9000 });
assert.match(fullscreenScript, /\$pidValue = 4242/);
assert.match(fullscreenScript, /borderless-fullscreen/);
assert.match(fullscreenScript, /MonitorFromWindow/);
assert.match(fullscreenScript, /GetMonitorInfo/);
assert.match(fullscreenScript, /SetWindowLongPtr/);
assert.match(fullscreenScript, /SetWindowPos/);
assert.match(fullscreenScript, /SetForegroundWindow/);
assert.match(fullscreenScript, /GetForegroundWindow/);
assert.match(fullscreenScript, /AttachThreadInput/);
assert.match(fullscreenScript, /BringWindowToTop/);
assert.match(fullscreenScript, /SetFocus/);
assert.match(fullscreenScript, /\[IntPtr\]\(-1\)/);
assert.match(fullscreenScript, /\[IntPtr\]\(-2\)/);
assert.match(fullscreenScript, /centered-fallback/);
const nativeScript = buildWindowsPresentationScript({ pid: 88, mode: 'native-fullscreen' });
assert.match(nativeScript, /\$modeValue = 'native-fullscreen'/);
assert.match(nativeScript, /\$status = 'native-fullscreen'/);
assert.match(nativeScript, /monitorLeft/);
assert.match(nativeScript, /monitorRight/);
assert.match(nativeScript, /centered-fallback/);
assert.match(nativeScript, /\$attempt -lt 90/);
const centeredScript = buildWindowsPresentationScript({ pid: 77, mode: 'centered' });
assert.match(centeredScript, /\$modeValue = 'centered'/);
assert.doesNotMatch(centeredScript, /\$modeValue = 'unknown'/);
assert.deepEqual(
  parsePresentationResult('noise\n{"ok":true,"status":"borderless-fullscreen","width":1920,"height":1080}\n'),
  { ok: true, status: 'borderless-fullscreen', width: 1920, height: 1080 }
);
assert.equal(parsePresentationResult('', 'empty').status, 'no-result');
assert.equal(parsePresentationResult('not json').status, 'invalid-result');
assert.throws(() => buildWindowsCloseScript({ pid: 0 }), /positive integer/);
const closeScript = buildWindowsCloseScript({ pid: 4242, timeoutMs: 1900 });
assert.match(closeScript, /\$pidValue = 4242/);
assert.match(closeScript, /PostMessage/);
assert.match(closeScript, /0x0010/);
assert.match(closeScript, /RequestClose/);
assert.match(closeScript, /AddMilliseconds\(1900\)/);
assert.match(closeScript, /exited = \$false/);
let unsupportedSpawned = false;
const unsupported = await presentNativeGameWindow({
  pid: 9,
  platform: 'linux',
  spawnImpl: () => { unsupportedSpawned = true; }
});
assert.equal(unsupported.status, 'unsupported-platform');
assert.equal(unsupportedSpawned, false);
const calls = [];
const spawnImpl = (executable, args, options) => {
  calls.push({ executable, args, options });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from('{"ok":true,"status":"borderless-fullscreen","width":1536,"height":960}\n'));
    child.emit('close', 0);
  });
  return child;
};
const result = await presentNativeGameWindow({ pid: 1234, platform: 'win32', spawnImpl });
assert.equal(result.ok, true);
assert.equal(result.status, 'borderless-fullscreen');
assert.equal(calls.length, 1);
assert.equal(calls[0].executable, 'powershell.exe');
assert(calls[0].args.includes('-NoProfile'));
assert(calls[0].args.includes('-NonInteractive'));
assert(calls[0].args.at(-1).includes('$pidValue = 1234'));
assert.equal(calls[0].options.windowsHide, true);

let closeUnsupportedSpawned = false;
const closeUnsupported = await requestNativeGameWindowClose({ pid: 99, platform: 'linux', spawnImpl: () => { closeUnsupportedSpawned = true; } });
assert.equal(closeUnsupported.status, 'unsupported-platform');
assert.equal(closeUnsupported.exited, false);
assert.equal(closeUnsupportedSpawned, false);
const closeCalls = [];
const closeSpawn = (executable, args, options) => {
  closeCalls.push({ executable, args, options });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from('{"ok":true,"status":"closed","pid":1234,"posted":1,"exited":true}\n'));
    child.emit('close', 0);
  });
  return child;
};
const closeResult = await requestNativeGameWindowClose({ pid: 1234, platform: 'win32', timeoutMs: 1500, spawnImpl: closeSpawn });
assert.equal(closeResult.ok, true);
assert.equal(closeResult.status, 'closed');
assert.equal(closeResult.exited, true);
assert.equal(closeCalls.length, 1);
assert.equal(closeCalls[0].executable, 'powershell.exe');
assert(closeCalls[0].args.at(-1).includes('$pidValue = 1234'));
assert(closeCalls[0].args.at(-1).includes('AddMilliseconds(1500)'));

{
  const events = [];
  const child = new EventEmitter();
  const hostWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMaximized: () => true,
    isMinimized: () => true,
    blur: () => events.push('blur'),
    minimize: () => events.push('minimize'),
    restore: () => events.push('restore'),
    maximize: () => events.push('maximize'),
    show: () => events.push('show'),
    focus: () => events.push('focus')
  };
  const handoff = handoffHostWindowForNativeGame({ hostWindow, child });
  assert.equal(handoff.minimized, true);
  assert.deepEqual(events, ['blur', 'minimize']);
  child.emit('exit', 0);
  assert.deepEqual(events, ['blur', 'minimize', 'restore', 'maximize', 'show', 'focus']);
  assert.equal(handoff.restore(), false);
}

{
  const child = new EventEmitter();
  let minimized = false;
  const hiddenHost = {
    isDestroyed: () => false,
    isVisible: () => false,
    minimize: () => { minimized = true; }
  };
  const handoff = handoffHostWindowForNativeGame({ hostWindow: hiddenHost, child });
  assert.equal(handoff.minimized, false);
  assert.equal(minimized, false);
  assert.equal(handoff.restore(), false);
}
console.log('native window presenter: 56 scenarios passed');
