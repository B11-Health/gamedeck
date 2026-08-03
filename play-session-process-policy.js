'use strict';

const PLATFORMS = Object.freeze(['win32', 'linux', 'darwin']);
const STOP_PHASES = Object.freeze(['running', 'graceful_requested', 'escalated_requested', 'verifying', 'exited', 'stopped', 'failed']);
const fail = reasonCode => Object.freeze({ ok: false, reasonCode });
const isToken = (value, max = 4096) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
const isTime = value => Number.isSafeInteger(value) && value >= 0;

function normalizeCanonical(value, platform) {
  if (!PLATFORMS.includes(platform) || !isToken(value)) return null;
  if (platform === 'win32') return value.replaceAll('/', '\\').toLowerCase();
  return value;
}

function validateContainment(contract = {}) {
  const { platform, candidatePath, canonicalCandidatePath, canonicalRootPath, reparseOrSymlink, canonicalizationComplete } = contract;
  const candidate = normalizeCanonical(canonicalCandidatePath, platform);
  const root = normalizeCanonical(canonicalRootPath, platform);
  if (!candidate || !root || !isToken(candidatePath)) return fail(PLATFORMS.includes(platform) ? 'invalid_path_contract' : 'unsupported_platform');
  if (canonicalizationComplete !== true) return fail('canonicalization_required');
  if (typeof reparseOrSymlink !== 'boolean') return fail('reparse_decision_required');
  if (reparseOrSymlink) return fail('reparse_or_symlink_rejected');
  const separator = platform === 'win32' ? '\\' : '/';
  const rootWithSeparator = root.endsWith(separator) ? root : root + separator;
  if (!candidate.startsWith(rootWithSeparator)) return fail('path_outside_managed_root');
  return Object.freeze({ ok: true, canonicalPath: canonicalCandidatePath });
}

function validateManagedLaunch(input = {}) {
  const { platform, executable, core, config, content, receipt, launch } = input;
  if (!PLATFORMS.includes(platform)) return fail('unsupported_platform');
  const executableCheck = validateContainment({ ...executable, platform });
  if (!executableCheck.ok) return executableCheck;
  const coreCheck = validateContainment({ ...core, platform });
  if (!coreCheck.ok) return coreCheck;
  const configCheck = validateContainment({ ...config, platform });
  if (!configCheck.ok) return configCheck;
  const contentCheck = validateContainment({ ...content, platform });
  if (!contentCheck.ok) return contentCheck;
  const exact = (actual, expected) => normalizeCanonical(actual, platform) === normalizeCanonical(expected, platform);
  if (!exact(executableCheck.canonicalPath, input.expectedExecutablePath)) return fail('unexpected_executable_path');
  if (!exact(coreCheck.canonicalPath, input.expectedCorePath)) return fail('unexpected_core_path');
  if (!exact(configCheck.canonicalPath, input.expectedConfigPath)) return fail('unexpected_config_path');
  if (!exact(contentCheck.canonicalPath, input.expectedContentPath)) return fail('unexpected_content_path');
  if (!receipt || !isToken(receipt.installId, 256) || !isToken(receipt.executableDigest, 256) || !isToken(receipt.coreDigest, 256) || !isToken(receipt.configDigest, 256) || !isToken(receipt.contentDigest, 256)) return fail('invalid_receipt_identity');
  for (const [actual, expected] of [[receipt.installId,input.expectedInstallId],[receipt.executableDigest,input.expectedExecutableDigest],[receipt.coreDigest,input.expectedCoreDigest],[receipt.configDigest,input.expectedConfigDigest],[receipt.contentDigest,input.expectedContentDigest]]) if (actual !== expected) return fail('receipt_identity_mismatch');
  if (!launch || launch.fullscreen !== false) return fail('fullscreen_forbidden');
  const expectedArgs = ['--config', configCheck.canonicalPath, '-L', coreCheck.canonicalPath, contentCheck.canonicalPath];
  if (!Array.isArray(launch.args) || launch.args.length !== expectedArgs.length || launch.args.some((value, index) => value !== expectedArgs[index])) return fail('launch_contract_mismatch');
  return Object.freeze({ ok: true, executablePath: executableCheck.canonicalPath, corePath: coreCheck.canonicalPath, configPath: configCheck.canonicalPath, contentPath: contentCheck.canonicalPath, args: Object.freeze([...expectedArgs]), spawnOptions: Object.freeze({ shell: false, detached: false, windowsHide: true, unref: false }) });
}

function createStopPolicy({ managedProcessId, managedTreeReceipt } = {}) {
  if (!Number.isSafeInteger(managedProcessId) || managedProcessId <= 0 || !isToken(managedTreeReceipt, 256)) throw new TypeError('managed process identity is required');
  let phase = 'running';
  let reasonCode = null;
  let gracefulDeadlineMs = null;
  let escalationDeadlineMs = null;
  let exitedAtMs = null;
  const identityMatches = action => action.managedProcessId === managedProcessId && action.managedTreeReceipt === managedTreeReceipt && action.observedTreeReceipt === managedTreeReceipt;
  function status() { return Object.freeze({ phase, reasonCode, gracefulDeadlineMs, escalationDeadlineMs, exitedAtMs, completeTreeRequired: true, verificationRequired: true }); }
  function transition(action = {}) {
    if (!isTime(action.atMs)) return fail('invalid_time');
    if (!identityMatches(action)) return fail('process_identity_mismatch');
    if (action.type === 'observe_exit' && ['running','graceful_requested','escalated_requested'].includes(phase)) { phase='exited'; exitedAtMs=action.atMs; reasonCode=action.reasonCode || 'process_exited'; return status(); }
    if (action.type === 'request_graceful' && phase === 'running') { if (!isTime(action.deadlineMs) || action.deadlineMs <= action.atMs) return fail('invalid_deadline'); phase='graceful_requested'; gracefulDeadlineMs=action.deadlineMs; return status(); }
    if (action.type === 'request_escalation' && phase === 'graceful_requested') { if (action.atMs < gracefulDeadlineMs) return fail('grace_period_not_elapsed'); if (!isTime(action.deadlineMs) || action.deadlineMs <= action.atMs) return fail('invalid_deadline'); phase='escalated_requested'; escalationDeadlineMs=action.deadlineMs; return status(); }
    if (action.type === 'begin_verification' && ['graceful_requested','escalated_requested','exited'].includes(phase)) { if (phase === 'escalated_requested' && action.atMs < escalationDeadlineMs) return fail('escalation_period_not_elapsed'); phase='verifying'; return status(); }
    if (action.type === 'verify_complete' && phase === 'verifying') { if (action.rootAlive !== false || action.descendantsAlive !== 0 || action.handlesOpen !== 0) return fail('post_stop_verification_failed'); phase='stopped'; reasonCode=action.reasonCode || 'complete_tree_stopped'; return status(); }
    if (action.type === 'fail' && phase !== 'stopped') { phase='failed'; reasonCode=isToken(action.reasonCode,128)?action.reasonCode:'stop_failed'; return status(); }
    return fail('illegal_stop_transition');
  }
  return Object.freeze({ transition, status });
}
module.exports = { PLATFORMS, STOP_PHASES, createStopPolicy, normalizeCanonical, validateContainment, validateManagedLaunch };
