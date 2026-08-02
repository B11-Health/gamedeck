'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { path7za } = require('7zip-bin');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function run(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = chunk => { output = (output + chunk).slice(-12000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(exe)} exited ${code}: ${output.trim()}`)));
  });
}
function key(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return `darwin-${arch}`;
  return `${platform}-${arch}`;
}
function pathsFor(root, platform = process.platform) {
  if (platform === 'darwin') return {
    root,
    retroArch: path.join(root, 'RetroArch.app', 'Contents', 'MacOS', 'RetroArch'),
    cores: path.join(root, 'RetroArch.app', 'Contents', 'Resources', 'cores'),
    system: path.join(root, 'system'),
    saves: path.join(root, 'saves'),
    states: path.join(root, 'states'),
    config: path.join(root, 'gamedeck-retroarch.cfg')
  };
  return {
    root,
    retroArch: path.join(root, 'retroarch', platform === 'win32' ? 'RetroArch-Win64' : '', platform === 'win32' ? 'retroarch.exe' : 'retroarch'),
    cores: path.join(root, 'retroarch', ...(platform === 'win32' ? ['RetroArch-Win64', 'cores'] : ['cores'])),
    system: path.join(root, 'retroarch', ...(platform === 'win32' ? ['RetroArch-Win64', 'system'] : ['system'])),
    saves: path.join(root, 'saves'),
    states: path.join(root, 'states'),
    config: path.join(root, 'gamedeck-retroarch.cfg')
  };
}
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function createRuntimeManager(options) {
  const root = path.resolve(options.root);
  const manifest = readJson(options.manifestPath, null);
  if (!manifest?.platforms) throw new Error('Managed runtime manifest is invalid.');
  const platform = options.platform || process.platform;
  const platformKey = key(platform, options.arch || process.arch);
  const spec = manifest.platforms[platformKey] || null;
  const paths = pathsFor(root, platform);
  const stateFile = path.join(root, 'runtime-state.json');
  const cache = path.join(root, 'downloads');
  const state = readJson(stateFile, { assets: {} });
  const allowedHosts = new Set(manifest.allowedHosts || []);
  let task = null;
  let current = null;
  const emit = update => {
    current = { ...status(), ...update, at: Date.now() };
    options.onUpdate?.(current);
    return current;
  };
  const resolve = value => path.join(root, ...String(value || '').split('/').filter(Boolean));
  const ready = component => (component.expected || []).every(value => {
    try { return fs.statSync(resolve(value)).size > 0; } catch { return false; }
  });
  function status() {
    const components = (spec?.components || []).map(component => ({
      id: component.id,
      label: component.label,
      ready: ready(component),
      required: component.required !== false
    }));
    const required = components.filter(component => component.required);
    const isReady = Boolean(spec && required.length && required.every(component => component.ready));
    return {
      supported: Boolean(spec),
      platformKey,
      ready: isReady,
      installing: Boolean(task),
      root,
      paths,
      runtimeVersion: manifest.runtimeVersion,
      retroArchVersion: manifest.retroArchVersion,
      components,
      phase: current?.phase || (isReady ? 'ready' : 'idle'),
      progress: current?.progress ?? (isReady ? 100 : 0),
      message: current?.message || (isReady ? 'Game engines are ready.' : 'Game engines need setup.')
    };
  }
  function validateUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error(`Unapproved runtime source: ${url.hostname}`);
    return url;
  }
  async function download(urlValue, target, component, base, span) {
    const url = validateUrl(urlValue);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    let existing = 0;
    try { existing = fs.statSync(part).size; } catch {}
    const headers = { 'user-agent': `GameDeck/${options.appVersion || 'dev'}` };
    if (existing > 0) headers.range = `bytes=${existing}-`;
    let response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(1800000), headers });
    if (existing > 0 && response.status !== 206) {
      fs.rmSync(part, { force: true });
      existing = 0;
      response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(1800000), headers: { 'user-agent': headers['user-agent'] } });
    }
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const rangeTotal = String(response.headers.get('content-range') || '').match(/\/(\d+)$/);
    const total = rangeTotal ? Number(rangeTotal[1]) : existing + Number(response.headers.get('content-length') || 0);
    if (total > 1024 ** 3) throw new Error('Runtime package exceeds safety limit.');
    const file = fs.createWriteStream(part, { flags: existing ? 'a' : 'w' });
    const reader = response.body.getReader();
    let received = existing;
    const started = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 1024 ** 3) throw new Error('Runtime package exceeds safety limit.');
      if (!file.write(Buffer.from(value))) await new Promise(resolveDrain => file.once('drain', resolveDrain));
      const ratio = total ? received / total : 0;
      emit({
        phase: 'downloading',
        component: component.id,
        progress: Math.min(98, base + ratio * span),
        downloadedBytes: received,
        totalBytes: total,
        speedBytes: Math.round(received / Math.max(.25, (Date.now() - started) / 1000)),
        message: `Downloading ${component.label}…`
      });
    }
    await new Promise((resolveEnd, rejectEnd) => file.end(error => error ? rejectEnd(error) : resolveEnd()));
    fs.renameSync(part, target);
  }
  async function verify(asset, component) {
    emit({ phase: 'verifying', component: component.id, message: `Verifying ${component.label}…` });
    const digest = await sha256(asset);
    const expected = String(component.sha256 || '').toLowerCase();
    const pinned = state.assets?.[component.url]?.sha256 || '';
    if (expected && digest !== expected) throw new Error(`${component.label} failed SHA-256 verification.`);
    if (!expected && pinned && digest !== pinned) throw new Error(`${component.label} changed unexpectedly; update GameDeck before retrying.`);
    state.assets ||= {};
    state.assets[component.url] = { sha256: digest, verifiedAt: Date.now(), size: fs.statSync(asset).size };
    writeJson(stateFile, state);
  }
  async function extract(asset, destination, component) {
    fs.mkdirSync(destination, { recursive: true });
    emit({ phase: 'installing', component: component.id, message: `Installing ${component.label}…` });
    let seven = String(path7za).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (!fs.existsSync(seven)) seven = pat7za;
    await run(seven, ['x', '-y', asset, `-o${destination}`], root);
  }
  async function installDmg(asset, component) {
    const mount = path.join(root, `.mount-${Date.now()}`);
    fs.mkdirSync(mount, { recursive: true });
    try {
      await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, asset], root);
      const source = path.join(mount, component.appName || 'RetroArch.app');
      const destination = resolve(component.destination);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true });
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount, '-force'], root).catch(() => {});
      fs.rmSync(mount, { recursive: true, force: true });
    }
  }
  async function installComponent(component, index, total) {
    if (ready(component)) return;
    const base = index / total * 100;
    const span = 100 / total;
    if (component.type === 'core-set') {
      fs.mkdirSync(resolve(component.destination), { recursive: true });
      for (let i = 0; i < component.files.length; i++) {
        const name = component.files[i];
        const output = resolve(`${component.destination}/${name.replace(/\.zip$/i, '')}`);
        if (fs.existsSync(output)) continue;
        const url = `${component.baseUrl.replace(/\/$/, '')}/${name}`;
        const pseudo = { ...component, id: `${component.id}:${name}`, label: name, url };
        const asset = path.join(cache, `${platformKey}-${name}`);
        if (!fs.existsSync(asset)) await download(url, asset, pseudo, base + i / component.files.length * span, span / component.files.length * .7);
        await verify(asset, pseudo);
        await extract(asset, resolve(component.destination), pseudo);
      }
    } else {
      const name = path.basename(new URL(component.url).pathname);
      const asset = path.join(cache, `${platformKey}-${component.id}-${name}`);
      if (!fs.existsSync(asset)) await download(component.url, asset, component, base, span * .7);
      await verify(asset, component);
      if (component.type === 'dmg') await installDmg(asset, component);
      else await extract(asset, resolve(component.destination), component);
    }
    if (!ready(component)) throw new Error(`${component.label} installation is incomplete.`);
    emit({ phase: 'installing', component: component.id, progress: base + span, message: `${component.label} installed.` });
  }
  function writeConfig() {
    for (const folder of [paths.system, paths.saves, paths.states, paths.cores]) fs.mkdirSync(folder, { recursive: true });
    const q = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    fs.writeFileSync(paths.config, [
      `libretro_directory = "${q(paths.cores)}"`,
      `system_directory = "${q(paths.system)}"`,
      `savefile_directory = "${q(paths.saves)}"`,
      `savestate_directory = "${q(paths.states)}"`,
      'video_fullscreen = "true"',
      'pause_nonactive = "false"',
      'menu_show_core_updater = "false"'
    ].join('\n') + '\n');
    if (platform !== 'win32') try { fs.chmodSync(paths.retroArch, 0o755); } catch {}
  }
  async function perform(force = false) {
    if (!spec) return emit({ phase: 'unsupported', message: `Managed runtime is unavailable for ${platformKey}.` });
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(cache, { recursive: true });
    const components = spec.components.filter(component => component.required !== false);
    if (!force && components.every(ready)) {
      writeConfig();
      return emit({ phase: 'ready', ready: true, progress: 100, message: 'Game engines are ready.' });
    }
    emit({ phase: 'preparing', progress: 1, message: 'Preparing GameDeck game engines…' });
    for (let i = 0; i < components.length; i++) await installComponent(components[i], i, components.length);
    writeConfig();
    state.runtimeVersion = manifest.runtimeVersion;
    state.installedAt = Date.now();
    writeJson(stateFile, state);
    return emit({ phase: 'ready', ready: true, progress: 100, message: 'Game engines are ready.' });
  }
  function ensure({ force = false } = {}) {
    if (task) return task;
    task = perform(force).catch(error => {
      options.onLog?.('error', `Managed runtime setup failed: ${error.message}`);
      return emit({ phase: 'error', ready: false, error: error.message, message: error.message });
    }).finally(() => { task = null; });
    return task;
  }
  return { key: platformKey, root, paths, carInstall: Boolean(spec), status, ensure };
}
module.exports = { createRuntimeManager, pathsFor, key };
