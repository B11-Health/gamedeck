import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  createStopPolicy,
  validateContainment,
  validateManagedLaunch
} = require('../play-session-process-policy.js');
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };
const strong = prefix => `${prefix}_${'a'.repeat(24)}`;
const digest = character => character.repeat(64);
const pc = (raw, canonical, root, pathKind = 'file') => ({
  candidatePath: raw,
  canonicalCandidatePath: canonical,
  canonicalRootPath: root,
  canonicalizationComplete: true,
  canonicalizedFromRaw: true,
  canonicalizationEvidenceId: strong('canon'),
  reparseOrSymlink: false,
  pathKind
});

function launchInput(platform = 'win32') {
  const win = platform === 'win32';
  const root = win ? 'C:\\GameDeck\\runtime' : '/opt/gamedeck/runtime';
  const homeRoot = win ? 'C:\\GameDeck\\state' : '/var/lib/gamedeck';
  const home = win ? `${homeRoot}\\home` : `${homeRoot}/home`;
  const separator = win ? '\\' : '/';
  const executable = `${root}${separator}retroarch${win ? '.exe' : ''}`;
  const core = `${root}${separator}cores${separator}snes.dll`;
  const config = `${root}${separator}config${separator}retroarch.cfg`;
  const content = `${root}${separator}content${separator}game.sfc`;
  const receipt = {
    installId: strong('install'),
    receiptId: strong('receipt'),
    executableDigest: digest('a'),
    coreDigest: digest('b'),
    configDigest: digest('c'),
    contentDigest: digest('d')
  };
  return {
    platform,
    executable: pc(executable, executable, root),
    core: pc(core, core, root),
    config: pc(config, config, root),
    content: pc(content, content, root),
    environmentHome: pc(home, home, homeRoot, 'directory'),
    environmentPath: pc(root, root, root, 'directory'),
    expectedExecutablePath: executable,
    expectedCorePath: core,
    expectedConfigPath: config,
    expectedContentPath: content,
    receipt,
    expectedReceipt: { ...receipt },
    launch: {
      fullscreen: false,
      args: ['--config', config, '-L', core, content],
      cwd: root,
      environment: { HOME: home, LANG: 'C', LC_ALL: 'C', PATH: root }
    }
  };
}

const id = { managedProcessId: 7, managedTreeReceipt: 'tree', observedTreeReceipt: 'tree' };

test('relative POSIX paths are rejected', () => {
  assert.equal(validateContainment({ platform: 'linux', ...pc('managed/core.so', 'managed/core.so', 'managed') }).reasonCode, 'absolute_path_required');
});

test('raw to canonical trusted binding is required', () => {
  const contract = { platform: 'linux', ...pc('/raw/core.so', '/managed/core.so', '/managed') };
  contract.canonicalizedFromRaw = false;
  assert.equal(validateContainment(contract).reasonCode, 'canonical_binding_required');
  contract.canonicalizedFromRaw = true;
  contract.canonicalizationEvidenceId = 'weak';
  assert.equal(validateContainment(contract).reasonCode, 'canonical_binding_required');
});

test('platform case sensitivity remains explicit', () => {
  assert.equal(validateContainment({ platform: 'win32', ...pc('C:\\ROOT\\A', 'c:\\root\\a', 'C:\\ROOT') }).ok, true);
  assert.equal(validateContainment({ platform: 'linux', ...pc('/Root/a', '/Root/a', '/root') }).reasonCode, 'path_outside_managed_root');
});

test('Windows managed cwd HOME and PATH succeed', () => {
  const result = validateManagedLaunch(launchInput('win32'));
  assert.equal(result.ok, true);
  assert.equal(result.spawnOptions.cwd, 'C:\\GameDeck\\runtime');
  assert.deepEqual(result.spawnOptions.env, {
    HOME: 'C:\\GameDeck\\state\\home',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: 'C:\\GameDeck\\runtime'
  });
  assert.equal(Object.isFrozen(result.spawnOptions), true);
  assert.equal(Object.isFrozen(result.spawnOptions.env), true);
});

test('POSIX managed cwd HOME and PATH succeed', () => {
  const result = validateManagedLaunch(launchInput('linux'));
  assert.equal(result.ok, true);
  assert.equal(result.spawnOptions.cwd, '/opt/gamedeck/runtime');
  assert.deepEqual(result.spawnOptions.env, {
    HOME: '/var/lib/gamedeck/home',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/opt/gamedeck/runtime'
  });
});

test('exact Evil cwd PATH and relative HOME probe is rejected', () => {
  const input = launchInput('win32');
  input.environmentHome = pc('relative-home', 'relative-home', 'relative-root', 'directory');
  input.environmentPath = pc('C:\\Evil', 'C:\\Evil', 'C:\\Evil', 'directory');
  input.launch.cwd = 'C:\\Evil';
  input.launch.environment = {
    HOME: 'relative-home',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: 'C:\\Evil'
  };
  assert.equal(validateManagedLaunch(input).reasonCode, 'environment_home_policy_mismatch');
});

test('absolute unmanaged Evil cwd and PATH are rejected', () => {
  const input = launchInput('win32');
  input.environmentPath = pc('C:\\Evil', 'C:\\Evil', 'C:\\Evil', 'directory');
  input.launch.cwd = 'C:\\Evil';
  input.launch.environment.PATH = 'C:\\Evil';
  assert.equal(validateManagedLaunch(input).reasonCode, 'environment_path_policy_mismatch');
});

test('one-character receipt identities and digests are rejected', () => {
  const input = launchInput();
  input.receipt = {
    installId: 'i',
    receiptId: 'r',
    executableDigest: 'e',
    coreDigest: 'c',
    configDigest: 'g',
    contentDigest: 'r'
  };
  input.expectedReceipt = { ...input.receipt };
  assert.equal(validateManagedLaunch(input).reasonCode, 'invalid_receipt_identity');
});

test('receipt identity mismatch rejects valid strong values', () => {
  const input = launchInput();
  input.receipt.coreDigest = digest('e');
  assert.equal(validateManagedLaunch(input).reasonCode, 'receipt_identity_mismatch');
});

test('arbitrary environment and fullscreen reject', () => {
  const environment = launchInput();
  environment.launch.environment.SECRET = 'x';
  assert.equal(validateManagedLaunch(environment).reasonCode, 'environment_policy_mismatch');
  const fullscreen = launchInput();
  fullscreen.launch.fullscreen = true;
  assert.equal(validateManagedLaunch(fullscreen).reasonCode, 'fullscreen_forbidden');
});

test('arbitrary managed executable rejects', () => {
  const input = launchInput();
  input.executable.canonicalCandidatePath = 'C:\\GameDeck\\runtime\\other.exe';
  assert.equal(validateManagedLaunch(input).reasonCode, 'unexpected_executable_path');
});

test('early verification is rejected without trapping escalation', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  assert.equal(policy.transition({ type: 'request_graceful', atMs: 100, deadlineMs: 200, ...id }).phase, 'graceful_requested');
  assert.equal(policy.transition({ type: 'begin_verification', atMs: 110, ...id }).reasonCode, 'illegal_stop_transition');
  assert.equal(policy.transition({ type: 'request_escalation', atMs: 200, deadlineMs: 300, ...id }).phase, 'escalated_requested');
});

test('time rollback after graceful request rejects', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  policy.transition({ type: 'request_graceful', atMs: 100, deadlineMs: 200, ...id });
  assert.equal(policy.transition({ type: 'observe_exit', atMs: 50, ...id }).reasonCode, 'invalid_time');
});

test('graceful to escalate to exit to verify succeeds', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  assert.equal(policy.transition({ type: 'request_graceful', atMs: 100, deadlineMs: 200, ...id }).phase, 'graceful_requested');
  assert.equal(policy.transition({ type: 'request_escalation', atMs: 200, deadlineMs: 300, ...id }).phase, 'escalated_requested');
  assert.equal(policy.transition({ type: 'observe_exit', atMs: 250, ...id }).phase, 'exited');
  assert.equal(policy.transition({ type: 'begin_verification', atMs: 251, ...id }).phase, 'verifying');
  assert.equal(policy.transition({ type: 'verify_complete', atMs: 252, rootAlive: false, descendantsAlive: 0, handlesOpen: 0, ...id }).phase, 'stopped');
});

test('escalation timeout fails closed', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  policy.transition({ type: 'request_graceful', atMs: 1, deadlineMs: 2, ...id });
  policy.transition({ type: 'request_escalation', atMs: 2, deadlineMs: 3, ...id });
  assert.equal(policy.transition({ type: 'escalation_timeout', atMs: 3, ...id }).phase, 'failed');
});

test('rejected stop actions leave status byte-for-byte unchanged', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  const before = JSON.stringify(policy.status());
  assert.equal(policy.transition({ type: 'request_graceful', atMs: 100, deadlineMs: 50000, ...id }).reasonCode, 'invalid_deadline');
  assert.equal(JSON.stringify(policy.status()), before);
});

test('deadline caps and exit reasons are sanitized', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree', maxGraceMs: 10, maxEscalationMs: 10 });
  assert.equal(policy.transition({ type: 'request_graceful', atMs: 0, deadlineMs: 11, ...id }).reasonCode, 'invalid_deadline');
  assert.equal(policy.transition({ type: 'observe_exit', atMs: 1, reasonCode: 'bad path C:\\secret', ...id }).reasonCode, 'process_exited');
});

console.log(`play-session-process-policy: ${passed} tests passed`);
