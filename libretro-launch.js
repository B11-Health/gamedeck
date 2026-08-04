const path = require('path');

function requiredPath(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(name + ' is required');
  return path.resolve(text);
}

function isFbneoCore(corePath) {
  return /^fbneo_libretro.(?:dll|so|dylib)$/i.test(path.basename(String(corePath || '').trim()));
}

function resolveLibretroLaunchCwd({ contentFile, emulatorExecutable, arcade = false } = {}) {
  if (arcade) return path.dirname(requiredPath(contentFile, 'contentFile'));
  return path.dirname(requiredPath(emulatorExecutable, 'emulatorExecutable'));
}

function safeDriverName(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!normalized) throw new TypeError('shortName must contain a valid driver name');
  return normalized;
}

function buildFbneoReadiness({ userData, shortName } = {}) {
  const driver = safeDriverName(shortName);
  const root = requiredPath(userData, 'userData');
  return {
    logFile: path.join(root, 'runtime', 'logs', 'fbneo-' + driver + '.log'),
    requiredText: 'Driver ' + driver + ' was successfully started',
    timeoutMs: 30000,
    pollMs: 150,
    message: 'Validating the selected arcade ROM set…',
    failureMessage: 'FinalBurn Neo opened, but the selected arcade ROM set did not start.'
  };
}

function isFatalLibretroReadinessLog(value) {
  return /None of those archives was found|Failed to load content|Content failed to load|Error loading content|ROM data is missing|essential data is missing|This romset is unknown/i.test(String(value || ''));
}

module.exports = {
  buildFbneoReadiness,
  isFatalLibretroReadinessLog,
  isFbneoCore,
  resolveLibretroLaunchCwd,
  safeDriverName
};
