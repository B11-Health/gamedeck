import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PROCESS_HARD_CAPS,
  createManagedProcessPolicy,
  createStopPolicy,
  validateContainment,
  validateManagedLaunch
} = require('../play-session-process-policy.js');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const evidenceId = value => `EEEEEEEEEEEEEEEEEEEEEE${value}`;
const opaqueId = value => `IIIIIIIIIIIIIIIIIIIIII${value}`;
const digest = character => character.repeat(64);

function contract(raw, canonical, root, kind, id) {
  return {
    candidatePath: raw,
    canonicalCandidatePath: canonical,
    canonicalRootPath: root,
    canonicalizationComplete: true,
    canonicalizedFromRaw: true,
    canonicalizationEvidenceId: id,
    reparseOrSymlink: false,
    pathKind: kind
  };
}

function evidenceRecord(platform, value) {
  return {
    platform,
    candidatePath: value.candidatePath,
    canonicalCandidatePath: value.canonicalCandidatePath,
    canonicalRootPath: value.canonicalRootPath,
    pathKind: value.pathKind,
    reparseOrSymlink: value.reparseOrSymlink,
    canonicalizationEvidenceId: value.canonicalizationEvidenceId
  };
}

function createAuthority(records, limits, trusted = {}) {
  const map = new Map(records.map(record => [record.canonicalizationEvidenceId, record]));
  const policy = createManagedProcessPolicy({
    limits,
    expectedLaunchIdentity: trusted.expectedLaunchIdentity || null,
    expectedReceipt: trusted.expectedReceipt || null,
    verifyCanonicalEvidence(actual) {
      const expected = map.get(actual.canonicalizationEvidenceId);
      return Boolean(expected) && Object.keys(expected).every(key => actual[key] === expected[key]);
    }
  });
  return { map, policy };
}

function launchFixture(platform = 'win32', policyLimits) {
  const windows = platform === 'win32';
  const root = windows ? 'C:\\GameDeck\\runtime' : '/opt/gamedeck/runtime';
  const home = windows ? 'C:\\GameDeck\\home' : '/opt/gamedeck/home';
  const separator = windows ? '\\' : '/';
  const executablePath = `${root}${separator}retroarch${windows ? '.exe' : ''}`;
  const corePath = `${root}${separator}cores${separator}snes${windows ? '.dll' : '.so'}`;
  const configPath = `${root}${separator}config${separator}retroarch.cfg`;
  const contentPath = `${root}${separator}content${separator}game.sfc`;
  const values = {
    executable: contract(executablePath, executablePath, root, 'file', evidenceId('exe')),
    core: contract(corePath, corePath, root, 'file', evidenceId('core')),
    config: contract(configPath, configPath, root, 'file', evidenceId('config')),
    content: contract(contentPath, contentPath, root, 'file', evidenceId('content')),
    environmentHome: contract(home, home, home, 'directory', evidenceId('home')),
    environmentPath: contract(root, root, root, 'directory', evidenceId('path'))
  };
  const expectedLaunchIdentity = {
    platform,
    executablePath,
    corePath,
    configPath,
    contentPath
  };
  const expectedReceipt = {
    installId: opaqueId('install'),
    receiptId: opaqueId('receipt'),
    executableDigest: digest('a'),
    coreDigest: digest('b'),
    configDigest: digest('c'),
    contentDigest: digest('d')
  };
  const input = {
    platform,
    ...values,
    receipt: {
      installId: opaqueId('install'),
      receiptId: opaqueId('receipt'),
      executableDigest: digest('a'),
      coreDigest: digest('b'),
      configDigest: digest('c'),
      contentDigest: digest('d')
    },
    launch: {
      fullscreen: false,
      args: ['--config', configPath, '-L', corePath, contentPath],
      cwd: root,
      environment: {
        HOME: home,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: root
      }
    }
  };
  const records = Object.values(values).map(value => evidenceRecord(platform, value));
  const authority = createAuthority(records, policyLimits, {
    expectedLaunchIdentity,
    expectedReceipt
  });
  return {
    input,
    records,
    expectedLaunchIdentity,
    expectedReceipt,
    ...authority
  };
}

const treeIdentity = {
  managedProcessId: 7,
  managedTreeReceipt: 'tree',
  observedTreeReceipt: 'tree'
};

test('canonical authority is required for direct containment and launch validation', () => {
  const fixture = launchFixture();
  assert.equal(validateContainment({
    platform: 'win32',
    ...fixture.input.executable
  }).reasonCode, 'canonical_authority_required');
  assert.equal(validateManagedLaunch(fixture.input).reasonCode, 'canonical_authority_required');
});

test('relative POSIX and unresolved dot traversal canonical paths reject', () => {
  const relative = contract('managed/core.so', 'managed/core.so', 'managed', 'file', evidenceId('relative'));
  const relativePolicy = createAuthority([
    evidenceRecord('linux', relative)
  ]).policy;
  assert.equal(validateContainment({ platform: 'linux', ...relative }, relativePolicy).reasonCode,
    'canonical_path_required');

  const traversal = contract(
    'C:\\GameDeck\\runtime\\..\\Evil\\x.exe',
    'C:\\GameDeck\\runtime\\..\\Evil\\x.exe',
    'C:\\GameDeck\\runtime',
    'file',
    evidenceId('traversal')
  );
  const traversalPolicy = createAuthority([
    evidenceRecord('win32', traversal)
  ]).policy;
  assert.equal(validateContainment({ platform: 'win32', ...traversal }, traversalPolicy).reasonCode,
    'canonical_path_required');
});

test('raw to canonical substitution and arbitrary evidence reject', () => {
  const valid = contract(
    'C:\\GameDeck\\runtime\\retroarch.exe',
    'C:\\GameDeck\\runtime\\retroarch.exe',
    'C:\\GameDeck\\runtime',
    'file',
    evidenceId('binding')
  );
  const policy = createAuthority([evidenceRecord('win32', valid)]).policy;
  const substituted = {
    ...valid,
    candidatePath: 'C:\\Evil\\retroarch.exe'
  };
  assert.equal(validateContainment({ platform: 'win32', ...substituted }, policy).reasonCode,
    'canonical_evidence_rejected');
});

test('canonical evidence replay rejects and cannot authorize another pair', () => {
  const first = contract(
    'C:\\GameDeck\\runtime\\a.exe',
    'C:\\GameDeck\\runtime\\a.exe',
    'C:\\GameDeck\\runtime',
    'file',
    evidenceId('replay')
  );
  const policy = createAuthority([evidenceRecord('win32', first)]).policy;
  assert.equal(validateContainment({ platform: 'win32', ...first }, policy).ok, true);
  assert.equal(validateContainment({
    platform: 'win32',
    ...first,
    candidatePath: 'C:\\GameDeck\\runtime\\b.exe',
    canonicalCandidatePath: 'C:\\GameDeck\\runtime\\b.exe'
  }, policy).reasonCode, 'canonical_evidence_reused');
});

test('platform case sensitivity remains explicit', () => {
  const windowsValue = contract(
    'C:\\ROOT\\A.exe',
    'c:\\root\\a.exe',
    'C:\\ROOT',
    'file',
    evidenceId('windows-case')
  );
  const windowsPolicy = createAuthority([
    evidenceRecord('win32', windowsValue)
  ]).policy;
  assert.equal(validateContainment({ platform: 'win32', ...windowsValue }, windowsPolicy).ok, true);

  const posixValue = contract(
    '/Root/a',
    '/Root/a',
    '/root',
    'file',
    evidenceId('posix-case')
  );
  const posixPolicy = createAuthority([
    evidenceRecord('linux', posixValue)
  ]).policy;
  assert.equal(validateContainment({ platform: 'linux', ...posixValue }, posixPolicy).reasonCode,
    'path_outside_managed_root');
});

test('Windows managed cwd HOME PATH and strict receipt succeed', () => {
  const fixture = launchFixture('win32');
  const result = validateManagedLaunch(fixture.input, fixture.policy);
  assert.equal(result.ok, true);
  assert.deepEqual(result.spawnOptions, {
    shell: false,
    detached: false,
    windowsHide: true,
    unref: false,
    cwd: 'C:\\GameDeck\\runtime',
    env: {
      HOME: 'C:\\GameDeck\\home',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: 'C:\\GameDeck\\runtime'
    }
  });
});

test('POSIX managed cwd HOME and PATH succeed', () => {
  const fixture = launchFixture('linux');
  const result = validateManagedLaunch(fixture.input, fixture.policy);
  assert.equal(result.ok, true);
  assert.equal(result.spawnOptions.cwd, '/opt/gamedeck/runtime');
  assert.equal(result.spawnOptions.env.HOME, '/opt/gamedeck/home');
  assert.equal(result.spawnOptions.env.PATH, '/opt/gamedeck/runtime');
});

test('request-authored expected paths and receipt cannot authorize attacker identity', () => {
  const fixture = launchFixture();
  fixture.input.expectedExecutablePath = fixture.input.executable.canonicalCandidatePath;
  fixture.input.expectedCorePath = fixture.input.core.canonicalCandidatePath;
  fixture.input.expectedConfigPath = fixture.input.config.canonicalCandidatePath;
  fixture.input.expectedContentPath = fixture.input.content.canonicalCandidatePath;
  fixture.input.expectedReceipt = { ...fixture.input.receipt };
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).reasonCode,
    'untrusted_expected_identity');
  assert.equal(fixture.policy.status().canonicalEvidenceUsed, 0);
});

test('policy-owned expected identity rejects canonical managed substitutions', () => {
  const fixture = launchFixture();
  const attackerPath = 'C:\\GameDeck\\runtime\\attacker.exe';
  const attackerContract = contract(
    attackerPath,
    attackerPath,
    'C:\\GameDeck\\runtime',
    'file',
    evidenceId('attacker-executable')
  );
  fixture.map.set(attackerContract.canonicalizationEvidenceId,
    evidenceRecord('win32', attackerContract));
  fixture.input.executable = attackerContract;
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).reasonCode,
    'unexpected_executable_path');
  assert.equal(fixture.policy.status().canonicalEvidenceUsed, 0);
});

test('exact Evil cwd PATH relative HOME and one-character digest probe rejects', () => {
  const fixture = launchFixture();
  fixture.input.launch.cwd = 'C:\\Evil';
  fixture.input.launch.environment = {
    HOME: 'relative-home',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: 'C:\\Evil'
  };
  fixture.input.environmentHome = {
    ...fixture.input.environmentHome,
    candidatePath: 'relative-home',
    canonicalCandidatePath: 'relative-home',
    canonicalRootPath: 'relative-home'
  };
  fixture.input.environmentPath = {
    ...fixture.input.environmentPath,
    candidatePath: 'C:\\Evil',
    canonicalCandidatePath: 'C:\\Evil',
    canonicalRootPath: 'C:\\Evil'
  };
  fixture.input.receipt.executableDigest = 'e';
  fixture.input.receipt.coreDigest = 'c';
  fixture.input.receipt.configDigest = 'g';
  fixture.input.receipt.contentDigest = 'r';
  assert.notEqual(validateManagedLaunch(fixture.input, fixture.policy).ok, true);
});

test('absolute unmanaged Evil cwd PATH and arbitrary environment reject', () => {
  const fixture = launchFixture();
  fixture.input.launch.cwd = 'C:\\Evil';
  fixture.input.launch.environment.PATH = 'C:\\Evil';
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).reasonCode,
    'cwd_policy_mismatch');

  const extra = launchFixture();
  extra.input.launch.environment.SECRET = 'x';
  assert.equal(validateManagedLaunch(extra.input, extra.policy).reasonCode,
    'environment_policy_mismatch');
});

test('one-character receipt values and valid strong mismatch reject', () => {
  const weak = launchFixture();
  weak.input.receipt.installId = 'i';
  weak.input.receipt.receiptId = 'r';
  weak.input.receipt.executableDigest = 'e';
  assert.equal(validateManagedLaunch(weak.input, weak.policy).reasonCode,
    'invalid_receipt_identity');

  const mismatch = launchFixture();
  mismatch.input.receipt.coreDigest = digest('f');
  assert.equal(validateManagedLaunch(mismatch.input, mismatch.policy).reasonCode,
    'receipt_identity_mismatch');
});

test('failed launch does not consume canonical evidence', () => {
  const fixture = launchFixture();
  fixture.input.receipt.executableDigest = 'bad';
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).reasonCode,
    'invalid_receipt_identity');
  assert.equal(fixture.policy.status().canonicalEvidenceUsed, 0);
  fixture.input.receipt.executableDigest = digest('a');
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).ok, true);
  assert.equal(fixture.policy.status().canonicalEvidenceUsed, 6);
});

test('canonical evidence retention and every process hard cap are bounded', () => {
  for (const [key, value] of Object.entries(PROCESS_HARD_CAPS)) {
    assert.throws(() => createManagedProcessPolicy({
      verifyCanonicalEvidence: () => true,
      limits: { [key]: value + 1 }
    }), /security cap/);
  }
  const fixture = launchFixture('win32', { maxCanonicalEvidence: 5 });
  assert.equal(validateManagedLaunch(fixture.input, fixture.policy).reasonCode,
    'canonical_evidence_capacity_exhausted');
  assert.equal(fixture.policy.status().canonicalEvidenceUsed, 0);
});

test('fullscreen and arbitrary managed executable reject', () => {
  const fullscreen = launchFixture();
  fullscreen.input.launch.fullscreen = true;
  assert.equal(validateManagedLaunch(fullscreen.input, fullscreen.policy).reasonCode,
    'fullscreen_forbidden');

  const arbitrary = launchFixture();
  arbitrary.input.executable.canonicalCandidatePath = 'C:\\GameDeck\\runtime\\other.exe';
  assert.equal(validateManagedLaunch(arbitrary.input, arbitrary.policy).reasonCode,
    'canonical_evidence_rejected');
});

test('early verification rejects without trapping escalation', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  assert.equal(policy.transition({
    type: 'request_graceful', atMs: 100, deadlineMs: 200, ...treeIdentity
  }).phase, 'graceful_requested');
  assert.equal(policy.transition({
    type: 'begin_verification', atMs: 110, ...treeIdentity
  }).reasonCode, 'illegal_stop_transition');
  assert.equal(policy.transition({
    type: 'request_escalation', atMs: 200, deadlineMs: 300, ...treeIdentity
  }).phase, 'escalated_requested');
});

test('time rollback after graceful request rejects', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  policy.transition({ type: 'request_graceful', atMs: 100, deadlineMs: 200, ...treeIdentity });
  assert.equal(policy.transition({
    type: 'observe_exit', atMs: 50, ...treeIdentity
  }).reasonCode, 'invalid_time');
});

test('graceful escalate exit verify succeeds', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  assert.equal(policy.transition({
    type: 'request_graceful', atMs: 100, deadlineMs: 200, ...treeIdentity
  }).phase, 'graceful_requested');
  assert.equal(policy.transition({
    type: 'request_escalation', atMs: 200, deadlineMs: 300, ...treeIdentity
  }).phase, 'escalated_requested');
  assert.equal(policy.transition({
    type: 'observe_exit', atMs: 250, ...treeIdentity
  }).phase, 'exited');
  assert.equal(policy.transition({
    type: 'begin_verification', atMs: 251, ...treeIdentity
  }).phase, 'verifying');
  assert.equal(policy.transition({
    type: 'verify_complete', atMs: 252, rootAlive: false,
    descendantsAlive: 0, handlesOpen: 0, ...treeIdentity
  }).phase, 'stopped');
});

test('escalation timeout fails closed', () => {
  const policy = createStopPolicy({ managedProcessId: 7, managedTreeReceipt: 'tree' });
  policy.transition({ type: 'request_graceful', atMs: 1, deadlineMs: 2, ...treeIdentity });
  policy.transition({ type: 'request_escalation', atMs: 2, deadlineMs: 3, ...treeIdentity });
  assert.equal(policy.transition({
    type: 'escalation_timeout', atMs: 3, ...treeIdentity
  }).phase, 'failed');
});

test('rejected stop actions leave status unchanged and reasons sanitize', () => {
  const policy = createStopPolicy({
    managedProcessId: 7,
    managedTreeReceipt: 'tree',
    maxGraceMs: 10,
    maxEscalationMs: 10
  });
  const before = JSON.stringify(policy.status());
  assert.equal(policy.transition({
    type: 'request_graceful', atMs: 100, deadlineMs: 111, ...treeIdentity
  }).reasonCode, 'invalid_deadline');
  assert.equal(JSON.stringify(policy.status()), before);
  assert.equal(policy.transition({
    type: 'observe_exit', atMs: 1, reasonCode: 'bad path C:\\secret', ...treeIdentity
  }).reasonCode, 'process_exited');
});

console.log(`play-session-process-policy: ${passed} tests passed`);
