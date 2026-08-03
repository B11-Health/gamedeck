'use strict';

const path = require('node:path');

const PLATFORMS = Object.freeze(['win32', 'linux', 'darwin']);
const STOP_PHASES = Object.freeze([
  'running',
  'graceful_requested',
  'escalated_requested',
  'exited',
  'verifying',
  'stopped',
  'failed'
]);
const PROCESS_HARD_CAPS = Object.freeze({ maxCanonicalEvidence: 64 });
const POLICY_BRAND = Symbol('managed-process-policy');
const fail = reasonCode => Object.freeze({ ok: false, reasonCode });
const isToken = (value, max = 4096) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
const isOpaqueId = value =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);
const isSha256 = value =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const isTime = value => Number.isSafeInteger(value) && value >= 0;

function validateLimits(input = {}) {
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(PROCESS_HARD_CAPS, key)) throw new RangeError(`unknown process limit: ${key}`);
  }
  const limits = { ...PROCESS_HARD_CAPS, ...input };
  for (const [key, cap] of Object.entries(PROCESS_HARD_CAPS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > cap) {
      throw new RangeError(`${key} exceeds security cap`);
    }
  }
  return Object.freeze(limits);
}

function normalizeCanonical(value, platform) {
  if (!PLATFORMS.includes(platform) || !isToken(value)) return null;
  return platform === 'win32' ? value.replaceAll('/', '\\').toLowerCase() : value;
}

function isAbsolutePath(value, platform) {
  if (!isToken(value)) return false;
  if (platform === 'win32') {
    const normalized = value.replaceAll('/', '\\');
    return /^[A-Za-z]:\\/.test(normalized) || /^\\\\[^\\]+\\[^\\]+/.test(normalized);
  }
  if (platform === 'linux' || platform === 'darwin') return value.startsWith('/');
  return false;
}

function hasDotTraversal(value, platform) {
  if (!isToken(value)) return true;
  const separatorPattern = platform === 'win32' ? /[\\/]+/ : /\/+/;
  return value.split(separatorPattern).some(segment => segment === '.' || segment === '..');
}

function isCanonicalSyntax(value, platform) {
  if (!isAbsolutePath(value, platform) || hasDotTraversal(value, platform)) return false;
  if (platform === 'win32') {
    if (value.includes('/')) return false;
    return path.win32.normalize(value) === value;
  }
  if (value.includes('\\')) return false;
  return path.posix.normalize(value) === value;
}

function canonicalDirname(value, platform) {
  if (!isCanonicalSyntax(value, platform)) return null;
  return platform === 'win32' ? path.win32.dirname(value) : path.posix.dirname(value);
}

function validateReceipt(input = {}) {
  const { receipt, expectedReceipt } = input;
  if (!receipt || !expectedReceipt ||
      !isOpaqueId(receipt.installId) || !isOpaqueId(receipt.receiptId) ||
      !isOpaqueId(expectedReceipt.installId) || !isOpaqueId(expectedReceipt.receiptId)) {
    return fail('invalid_receipt_identity');
  }
  const digestKeys = [
    'executableDigest',
    'coreDigest',
    'configDigest',
    'contentDigest'
  ];
  for (const key of digestKeys) {
    if (!isSha256(receipt[key]) || !isSha256(expectedReceipt[key])) {
      return fail('invalid_receipt_identity');
    }
  }
  for (const key of ['installId', 'receiptId', ...digestKeys]) {
    if (receipt[key] !== expectedReceipt[key]) return fail('receipt_identity_mismatch');
  }
  return Object.freeze({ ok: true });
}

function createManagedProcessPolicy({
  verifyCanonicalEvidence,
  expectedLaunchIdentity = null,
  expectedReceipt = null,
  limits: limitOverrides
} = {}) {
  if (typeof verifyCanonicalEvidence !== 'function') {
    throw new TypeError('verifyCanonicalEvidence must be injected');
  }
  const limits = validateLimits(limitOverrides);
  const usedEvidenceIds = new Set();
  let approvedLaunchIdentity = null;
  let approvedReceipt = null;

  if (expectedLaunchIdentity !== null || expectedReceipt !== null) {
    if (!expectedLaunchIdentity || !expectedReceipt ||
        !PLATFORMS.includes(expectedLaunchIdentity.platform)) {
      throw new TypeError('trusted expected launch identity and receipt are required');
    }
    const requiredPathKeys = [
      'executablePath',
      'corePath',
      'configPath',
      'contentPath',
      'homePath',
      'homeRoot'
    ];
    for (const key of requiredPathKeys) {
      if (!isCanonicalSyntax(expectedLaunchIdentity[key], expectedLaunchIdentity.platform)) {
        throw new TypeError('trusted expected launch paths must be canonical');
      }
    }
    const receiptCheck = validateReceipt({
      receipt: expectedReceipt,
      expectedReceipt
    });
    if (!receiptCheck.ok) {
      throw new TypeError('trusted expected receipt identity is invalid');
    }
    approvedLaunchIdentity = Object.freeze({
      platform: expectedLaunchIdentity.platform,
      executablePath: expectedLaunchIdentity.executablePath,
      corePath: expectedLaunchIdentity.corePath,
      configPath: expectedLaunchIdentity.configPath,
      contentPath: expectedLaunchIdentity.contentPath,
      homePath: expectedLaunchIdentity.homePath,
      homeRoot: expectedLaunchIdentity.homeRoot
    });
    approvedReceipt = Object.freeze({ ...expectedReceipt });
  }

  function inspectContainment(contract = {}, options = {}, pendingEvidenceIds = new Set()) {
    const {
      platform,
      candidatePath,
      canonicalCandidatePath,
      canonicalRootPath,
      canonicalizationComplete,
      canonicalizedFromRaw,
      canonicalizationEvidenceId,
      reparseOrSymlink,
      pathKind
    } = contract;
    const { allowRoot = false, expectedKind = null } = options;

    if (!PLATFORMS.includes(platform)) return fail('unsupported_platform');
    if (!isAbsolutePath(candidatePath, platform) ||
        !isCanonicalSyntax(canonicalCandidatePath, platform) ||
        !isCanonicalSyntax(canonicalRootPath, platform)) {
      return fail('canonical_path_required');
    }
    if (canonicalizationComplete !== true || canonicalizedFromRaw !== true ||
        !isOpaqueId(canonicalizationEvidenceId)) {
      return fail('canonical_binding_required');
    }
    if (typeof reparseOrSymlink !== 'boolean') return fail('reparse_decision_required');
    if (reparseOrSymlink) return fail('reparse_or_symlink_rejected');
    if (expectedKind && pathKind !== expectedKind) return fail('path_kind_mismatch');
    if (usedEvidenceIds.has(canonicalizationEvidenceId) ||
        pendingEvidenceIds.has(canonicalizationEvidenceId)) {
      return fail('canonical_evidence_reused');
    }

    const evidence = Object.freeze({
      platform,
      candidatePath,
      canonicalCandidatePath,
      canonicalRootPath,
      pathKind,
      reparseOrSymlink,
      canonicalizationEvidenceId
    });
    let verified = false;
    try {
      verified = verifyCanonicalEvidence(evidence) === true;
    } catch {
      verified = false;
    }
    if (!verified) return fail('canonical_evidence_rejected');

    const candidate = normalizeCanonical(canonicalCandidatePath, platform);
    const root = normalizeCanonical(canonicalRootPath, platform);
    const separator = platform === 'win32' ? '\\' : '/';
    const rootWithSeparator = root.endsWith(separator) ? root : root + separator;
    if (!(allowRoot && candidate === root) && !candidate.startsWith(rootWithSeparator)) {
      return fail('path_outside_managed_root');
    }

    pendingEvidenceIds.add(canonicalizationEvidenceId);
    return Object.freeze({
      ok: true,
      canonicalPath: canonicalCandidatePath,
      canonicalRootPath,
      pathKind,
      canonicalizationEvidenceId
    });
  }

  function commitEvidence(pendingEvidenceIds) {
    if (usedEvidenceIds.size + pendingEvidenceIds.size > limits.maxCanonicalEvidence) {
      return fail('canonical_evidence_capacity_exhausted');
    }
    for (const evidenceId of pendingEvidenceIds) usedEvidenceIds.add(evidenceId);
    return Object.freeze({ ok: true });
  }

  function validateContainmentBound(contract = {}, options = {}) {
    const pendingEvidenceIds = new Set();
    const result = inspectContainment(contract, options, pendingEvidenceIds);
    if (!result.ok) return result;
    const committed = commitEvidence(pendingEvidenceIds);
    if (!committed.ok) return committed;
    return result;
  }

  function validateManagedLaunchBound(input = {}) {
    const {
      platform,
      executable,
      core,
      config,
      content,
      environmentHome,
      environmentPath,
      launch
    } = input;
    if (!PLATFORMS.includes(platform)) return fail('unsupported_platform');
    if (!approvedLaunchIdentity || !approvedReceipt) {
      return fail('launch_identity_authority_required');
    }
    if (platform !== approvedLaunchIdentity.platform) {
      return fail('unexpected_platform');
    }
    const untrustedExpectedKeys = [
      'expectedExecutablePath',
      'expectedCorePath',
      'expectedConfigPath',
      'expectedContentPath',
      'expectedHomePath',
      'expectedHomeRoot',
      'expectedReceipt'
    ];
    if (untrustedExpectedKeys.some(key => Object.hasOwn(input, key))) {
      return fail('untrusted_expected_identity');
    }

    const pendingEvidenceIds = new Set();
    const inspect = (contract, options) =>
      inspectContainment({ ...contract, platform }, options, pendingEvidenceIds);

    const executableCheck = inspect(executable, { expectedKind: 'file' });
    if (!executableCheck.ok) return executableCheck;
    const coreCheck = inspect(core, { expectedKind: 'file' });
    if (!coreCheck.ok) return coreCheck;
    const configCheck = inspect(config, { expectedKind: 'file' });
    if (!configCheck.ok) return configCheck;
    const contentCheck = inspect(content, { expectedKind: 'file' });
    if (!contentCheck.ok) return contentCheck;
    const homeCheck = inspect(environmentHome, {
      allowRoot: true,
      expectedKind: 'directory'
    });
    if (!homeCheck.ok) return fail('environment_home_policy_mismatch');
    const pathCheck = inspect(environmentPath, {
      allowRoot: true,
      expectedKind: 'directory'
    });
    if (!pathCheck.ok) return fail('environment_path_policy_mismatch');

    const exact = (actual, expected) =>
      normalizeCanonical(actual, platform) === normalizeCanonical(expected, platform);
    if (!exact(executableCheck.canonicalPath, approvedLaunchIdentity.executablePath)) {
      return fail('unexpected_executable_path');
    }
    if (!exact(coreCheck.canonicalPath, approvedLaunchIdentity.corePath)) {
      return fail('unexpected_core_path');
    }
    if (!exact(configCheck.canonicalPath, approvedLaunchIdentity.configPath)) {
      return fail('unexpected_config_path');
    }
    if (!exact(contentCheck.canonicalPath, approvedLaunchIdentity.contentPath)) {
      return fail('unexpected_content_path');
    }
    if (!exact(homeCheck.canonicalPath, approvedLaunchIdentity.homePath) ||
        !exact(homeCheck.canonicalRootPath, approvedLaunchIdentity.homeRoot)) {
      return fail('environment_home_policy_mismatch');
    }

    const receiptCheck = validateReceipt({
      receipt: input.receipt,
      expectedReceipt: approvedReceipt
    });
    if (!receiptCheck.ok) return receiptCheck;
    if (!launch || launch.fullscreen !== false) return fail('fullscreen_forbidden');

    const expectedArgs = [
      '--config',
      configCheck.canonicalPath,
      '-L',
      coreCheck.canonicalPath,
      contentCheck.canonicalPath
    ];
    if (!Array.isArray(launch.args) || launch.args.length !== expectedArgs.length ||
        launch.args.some((value, index) => value !== expectedArgs[index])) {
      return fail('launch_contract_mismatch');
    }

    const managedCwd = canonicalDirname(executableCheck.canonicalPath, platform);
    if (!managedCwd || !exact(managedCwd, executableCheck.canonicalRootPath)) {
      return fail('managed_runtime_directory_mismatch');
    }
    if (!exact(pathCheck.canonicalPath, managedCwd) ||
        !exact(pathCheck.canonicalRootPath, executableCheck.canonicalRootPath)) {
      return fail('environment_path_policy_mismatch');
    }
    if (!exact(launch.cwd, managedCwd)) return fail('cwd_policy_mismatch');

    const expectedEnvironment = Object.freeze({
      HOME: homeCheck.canonicalPath,
      LANG: 'C',
      LC_ALL: 'C',
      PATH: pathCheck.canonicalPath
    });
    const environmentKeys = launch.environment && Object.keys(launch.environment).sort();
    if (!environmentKeys || environmentKeys.join(',') !== 'HOME,LANG,LC_ALL,PATH' ||
        Object.entries(expectedEnvironment).some(([key, value]) => launch.environment[key] !== value)) {
      return fail('environment_policy_mismatch');
    }

    const committed = commitEvidence(pendingEvidenceIds);
    if (!committed.ok) return committed;

    return Object.freeze({
      ok: true,
      executablePath: executableCheck.canonicalPath,
      corePath: coreCheck.canonicalPath,
      configPath: configCheck.canonicalPath,
      contentPath: contentCheck.canonicalPath,
      args: Object.freeze([...expectedArgs]),
      spawnOptions: Object.freeze({
        shell: false,
        detached: false,
        windowsHide: true,
        unref: false,
        cwd: managedCwd,
        env: expectedEnvironment
      })
    });
  }

  function status() {
    return Object.freeze({
      canonicalEvidenceUsed: usedEvidenceIds.size,
      maxCanonicalEvidence: limits.maxCanonicalEvidence
    });
  }

  return Object.freeze({
    [POLICY_BRAND]: true,
    validateContainment: validateContainmentBound,
    validateManagedLaunch: validateManagedLaunchBound,
    status
  });
}

function validateContainment(contract = {}, policy, options = {}) {
  if (!policy || policy[POLICY_BRAND] !== true) return fail('canonical_authority_required');
  return policy.validateContainment(contract, options);
}

function validateManagedLaunch(input = {}, policy) {
  if (!policy || policy[POLICY_BRAND] !== true) return fail('canonical_authority_required');
  return policy.validateManagedLaunch(input);
}

function createStopPolicy({
  managedProcessId,
  managedTreeReceipt,
  maxGraceMs = 10000,
  maxEscalationMs = 10000
} = {}) {
  if (!Number.isSafeInteger(managedProcessId) || managedProcessId <= 0 ||
      !isToken(managedTreeReceipt, 256)) {
    throw new TypeError('managed process identity is required');
  }
  if (!Number.isSafeInteger(maxGraceMs) || maxGraceMs <= 0 || maxGraceMs > 10000) {
    throw new RangeError('maxGraceMs exceeds security cap');
  }
  if (!Number.isSafeInteger(maxEscalationMs) || maxEscalationMs <= 0 ||
      maxEscalationMs > 10000) {
    throw new RangeError('maxEscalationMs exceeds security cap');
  }

  let phase = 'running';
  let reasonCode = null;
  let gracefulDeadlineMs = null;
  let escalationDeadlineMs = null;
  let exitedAtMs = null;
  let lastTransitionAtMs = null;

  const identityMatches = action =>
    action.managedProcessId === managedProcessId &&
    action.managedTreeReceipt === managedTreeReceipt &&
    action.observedTreeReceipt === managedTreeReceipt;
  const safeReason = value =>
    typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;

  function status() {
    return Object.freeze({
      phase,
      reasonCode,
      gracefulDeadlineMs,
      escalationDeadlineMs,
      exitedAtMs,
      lastTransitionAtMs,
      completeTreeRequired: true,
      verificationRequired: true
    });
  }

  function transition(action = {}) {
    if (!isTime(action.atMs) ||
        (lastTransitionAtMs !== null && action.atMs < lastTransitionAtMs)) {
      return fail('invalid_time');
    }
    if (!identityMatches(action)) return fail('process_identity_mismatch');

    let next = null;
    if (action.type === 'observe_exit' &&
        ['running', 'graceful_requested', 'escalated_requested'].includes(phase)) {
      next = {
        phase: 'exited',
        exitedAtMs: action.atMs,
        reasonCode: safeReason(action.reasonCode) || 'process_exited'
      };
    } else if (action.type === 'request_graceful' && phase === 'running') {
      if (!isTime(action.deadlineMs) || action.deadlineMs <= action.atMs ||
          action.deadlineMs - action.atMs > maxGraceMs) {
        return fail('invalid_deadline');
      }
      next = { phase: 'graceful_requested', gracefulDeadlineMs: action.deadlineMs };
    } else if (action.type === 'request_escalation' && phase === 'graceful_requested') {
      if (action.atMs < gracefulDeadlineMs) return fail('grace_period_not_elapsed');
      if (!isTime(action.deadlineMs) || action.deadlineMs <= action.atMs ||
          action.deadlineMs - action.atMs > maxEscalationMs) {
        return fail('invalid_deadline');
      }
      next = { phase: 'escalated_requested', escalationDeadlineMs: action.deadlineMs };
    } else if (action.type === 'escalation_timeout' && phase === 'escalated_requested') {
      if (action.atMs < escalationDeadlineMs) return fail('escalation_period_not_elapsed');
      next = { phase: 'failed', reasonCode: 'escalation_timeout' };
    } else if (action.type === 'begin_verification' && phase === 'exited') {
      next = { phase: 'verifying' };
    } else if (action.type === 'verify_complete' && phase === 'verifying') {
      if (action.rootAlive !== false || action.descendantsAlive !== 0 ||
          action.handlesOpen !== 0) {
        return fail('post_stop_verification_failed');
      }
      next = {
        phase: 'stopped',
        reasonCode: safeReason(action.reasonCode) || 'complete_tree_stopped'
      };
    } else if (action.type === 'fail' && phase !== 'stopped') {
      next = {
        phase: 'failed',
        reasonCode: safeReason(action.reasonCode) || 'stop_failed'
      };
    } else {
      return fail('illegal_stop_transition');
    }

    phase = next.phase ?? phase;
    reasonCode = Object.hasOwn(next, 'reasonCode') ? next.reasonCode : reasonCode;
    gracefulDeadlineMs = Object.hasOwn(next, 'gracefulDeadlineMs') ?
      next.gracefulDeadlineMs : gracefulDeadlineMs;
    escalationDeadlineMs = Object.hasOwn(next, 'escalationDeadlineMs') ?
      next.escalationDeadlineMs : escalationDeadlineMs;
    exitedAtMs = Object.hasOwn(next, 'exitedAtMs') ? next.exitedAtMs : exitedAtMs;
    lastTransitionAtMs = action.atMs;
    return status();
  }

  return Object.freeze({ transition, status });
}

module.exports = {
  PLATFORMS,
  PROCESS_HARD_CAPS,
  STOP_PHASES,
  canonicalDirname,
  createManagedProcessPolicy,
  createStopPolicy,
  hasDotTraversal,
  isAbsolutePath,
  isCanonicalSyntax,
  isOpaqueId,
  isSha256,
  normalizeCanonical,
  validateContainment,
  validateLimits,
  validateManagedLaunch,
  validateReceipt
};
