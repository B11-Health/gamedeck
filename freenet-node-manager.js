"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { path7za } = require("7zip-bin");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") return "win32-x64";
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) return `linux-${arch}`;
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) return `darwin-${arch}`;
  return `${platform}-${arch}`;
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = chunk => { output = `${output}${chunk}`.slice(-16000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", code => code === 0
      ? resolve(output)
      : reject(new Error(`${path.basename(executable)} exited with code ${code}: ${output.trim()}`)));
  });
}

function tcpReady(host, port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createFreenetNodeManager(options = {}) {
  const root = path.resolve(options.root);
  const manifest = readJson(options.manifestPath, null);
  if (!manifest?.platforms) throw new Error("GameDeck community runtime manifest is invalid.");
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const key = platformKey(platform, arch);
  const spec = manifest.platforms[key] || null;
  const allowedHosts = new Set(manifest.allowedHosts || []);
  const downloads = path.join(root, "downloads");
  const installRoot = path.join(root, "bin");
  const dataRoot = path.join(root, "data");
  const configRoot = path.join(root, "config");
  const logsRoot = path.join(root, "logs");
  const stateFile = path.join(root, "runtime-state.json");
  const state = readJson(stateFile, {});
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 7509);
  const networkPort = Number(options.networkPort || 31337);
  const executable = path.resolve(options.executableOverride || path.join(installRoot, spec?.executable || (platform === "win32" ? "freenet.exe" : "freenet")));
  const nodeUrl = `ws://${host}:${port}/v1/contract/command`;
  let installTask = null;
  let startTask = null;
  let child = null;
  let external = false;
  let stopping = false;
  let restartTimer = null;
  let current = null;

  function emit(update = {}) {
    current = { ...status(), ...update, at: Date.now() };
    options.onUpdate?.(current);
    return current;
  }

  function installed() {
    try { return fs.statSync(executable).size > 1024 * 1024; } catch { return false; }
  }

  function status() {
    return {
      supported: Boolean(spec || options.executableOverride),
      platformKey: key,
      version: manifest.version || "",
      ready: installed() || Boolean(options.executableOverride) || external,
      running: Boolean(child && child.exitCode === null) || external,
      external,
      installing: Boolean(installTask),
      starting: Boolean(startTask),
      root,
      executable,
      nodeUrl,
      phase: current?.phase || ((child || external) ? "ready" : installed() ? "stopped" : "idle"),
      progress: current?.progress ?? ((child || external) ? 100 : installed() ? 100 : 0),
      message: current?.message || ((child || external) ? "Community network is ready." : installed() ? "Community network is installed." : "Preparing the community network.")
    };
  }

  function validateUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
      throw new Error("GameDeck rejected an unapproved community runtime source.");
    }
    return url;
  }

  async function downloadAsset(urlValue, target) {
    const url = validateUrl(urlValue);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    let existing = 0;
    try { existing = fs.statSync(part).size; } catch {}
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const headers = { "user-agent": `GameDeck/${options.appVersion || "dev"}` };
        if (existing) headers.range = `bytes=${existing}-`;
        let response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60 * 1000), headers });
        if (existing && response.status !== 206) {
          fs.rmSync(part, { force: true });
          existing = 0;
          response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60 * 1000), headers: { "user-agent": headers["user-agent"] } });
        }
        const finalUrl = validateUrl(response.url);
        if (!response.ok || !response.body) throw new Error(`Community runtime download returned HTTP ${response.status}.`);
        const expectedSize = Number(spec.size || 0);
        const headerSize = Number(response.headers.get("content-length") || 0);
        if (headerSize && headerSize + existing > 100 * 1024 * 1024) throw new Error("Community runtime package exceeds its safety limit.");
        const output = fs.createWriteStream(part, { flags: existing ? "a" : "w" });
        const reader = response.body.getReader();
        let received = existing;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > 100 * 1024 * 1024) throw new Error("Community runtime package exceeds its safety limit.");
            if (!output.write(Buffer.from(value))) await new Promise(resolve => output.once("drain", resolve));
            const total = expectedSize || headerSize + existing;
            emit({
              phase: "downloading",
              progress: total ? Math.min(94, received / total * 94) : 10,
              downloadedBytes: received,
              totalBytes: total,
              message: "Preparing GameDeck community services…",
              sourceHost: finalUrl.hostname
            });
          }
          await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
        } catch (error) {
          output.destroy();
          throw error;
        }
        fs.renameSync(part, target);
        return;
      } catch (error) {
        if (attempt >= 4) throw error;
        emit({ phase: "retrying", message: "Community setup was interrupted. GameDeck is resuming automatically…" });
        await sleep(800 * 2 ** (attempt - 1));
        try { existing = fs.statSync(part).size; } catch { existing = 0; }
      }
    }
  }

  async function extractArchive(archive) {
    const sevenZip = String(path7za).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (!fs.existsSync(sevenZip)) throw new Error("GameDeck's extraction helper is missing.");
    const temporary = path.join(root, `.extract-${Date.now()}`);
    const first = path.join(temporary, "first");
    const second = path.join(temporary, "second");
    fs.mkdirSync(first, { recursive: true });
    try {
      await run(sevenZip, ["x", "-y", archive, `-o${first}`], root);
      let searchRoot = first;
      if (/\.tar\.gz$/i.test(archive)) {
        const tar = fs.readdirSync(first).map(name => path.join(first, name)).find(file => /\.tar$/i.test(file));
        if (!tar) throw new Error("Community runtime archive did not contain its expected tar package.");
        fs.mkdirSync(second, { recursive: true });
        await run(sevenZip, ["x", "-y", tar, `-o${second}`], root);
        searchRoot = second;
      }
      const queue = [searchRoot];
      let found = "";
      const expectedName = path.basename(spec.executable || (platform === "win32" ? "freenet.exe" : "freenet")).toLowerCase();
      while (queue.length && !found) {
        const directory = queue.shift();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const candidate = path.join(directory, entry.name);
          if (entry.isDirectory()) queue.push(candidate);
          else if (entry.name.toLowerCase() === expectedName) { found = candidate; break; }
        }
      }
      if (!found) throw new Error("Community runtime archive did not contain its expected executable.");
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.copyFileSync(found, executable);
      if (platform !== "win32") fs.chmodSync(executable, 0o755);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  async function performInstall() {
    if (installed()) return emit({ phase: "installed", ready: true, progress: 100, message: "Community network is installed." });
    if (options.executableOverride) {
      if (!fs.existsSync(executable)) throw new Error("The supplied community runtime executable was not found.");
      return emit({ phase: "installed", ready: true, progress: 100, message: "Community network is installed." });
    }
    if (!spec) return emit({ phase: "unsupported", ready: false, message: "Community services are not available on this device yet." });
    fs.mkdirSync(downloads, { recursive: true });
    const archive = path.join(downloads, path.basename(new URL(spec.url).pathname));
    emit({ phase: "preparing", progress: 1, message: "Preparing GameDeck community services…" });
    if (!fs.existsSync(archive)) await downloadAsset(spec.url, archive);
    emit({ phase: "verifying", progress: 95, message: "Verifying GameDeck community services…" });
    const digest = await fileSha256(archive);
    if (digest !== String(spec.sha256 || "").toLowerCase()) {
      fs.rmSync(archive, { force: true });
      throw new Error("GameDeck community services failed verification.");
    }
    await extractArchive(archive);
    state.version = manifest.version;
    state.sha256 = digest;
    state.installedAt = Date.now();
    writeJson(stateFile, state);
    return emit({ phase: "installed", ready: true, progress: 100, message: "Community network is installed." });
  }

  function ensureInstalled() {
    if (installTask) return installTask;
    installTask = performInstall().catch(error => {
      options.onLog?.("info", `Community setup is temporarily unavailable: ${error.message}`);
      return emit({ phase: "error", ready: false, error: error.message, message: "Community features will retry automatically." });
    }).finally(() => { installTask = null; });
    return installTask;
  }

  function nodeArgs() {
    const args = [
      "local",
      "--ws-api-address", host,
      "--ws-api-port", String(port),
      "--network-address", options.networkAddress || "0.0.0.0",
      "--network-port", String(networkPort),
      "--config-dir", configRoot,
      "--data-dir", dataRoot,
      "--log-dir", logsRoot,
      "--max-hosting-storage", String(options.maxHostingStorage || 10 * 1024 * 1024 * 1024),
      "--max-hosting-disk", String(options.maxHostingDisk || 20 * 1024 * 1024 * 1024),
      "--hosting-disk-pct", String(options.hostingDiskPct || 0.15),
      "--bandwidth-limit", String(options.bandwidthLimit || 3_000_000),
      "--shutdown-drain-secs", "3"
    ];
    if (options.mode === "local") args.push("--skip-load-from-network", "local");
    return args;
  }

  async function waitUntilReady(deadline = Date.now() + 20000) {
    while (Date.now() < deadline) {
      if (await tcpReady(host, port)) return true;
      if (child && child.exitCode !== null) throw new Error(`Community service exited with code ${child.exitCode}.`);
      await sleep(250);
    }
    throw new Error("GameDeck community services did not start in time.");
  }

  function scheduleRestart() {
    if (stopping || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!stopping) void start();
    }, 2500);
  }

  async function performStart() {
    if (await tcpReady(host, port)) {
      external = !child;
      return emit({ phase: "ready", progress: 100, running: true, external, message: "Community network is ready." });
    }
    external = false;
    const installation = await ensureInstalled();
    if (!installation?.ready && !installed()) return status();
    stopping = false;
    fs.mkdirSync(logsRoot, { recursive: true });
    fs.mkdirSync(configRoot, { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
    const stdout = fs.openSync(path.join(logsRoot, "node.stdout.log"), "a");
    const stderr = fs.openSync(path.join(logsRoot, "node.stderr.log"), "a");
    emit({ phase: "starting", progress: 99, message: "Connecting GameDeck to the community…" });
    child = spawn(executable, nodeArgs(), {
      cwd: path.dirname(executable),
      windowsHide: true,
      detached: platform !== "win32",
      stdio: ["ignore", stdout, stderr]
    });
    child.once("error", error => {
      options.onLog?.("info", `Community services could not start: ${error.message}`);
      child = null;
      emit({ phase: "error", running: false, error: error.message, message: "Community features will retry automatically." });
      scheduleRestart();
    });
    child.once("exit", code => {
      const wasStopping = stopping;
      child = null;
      if (wasStopping) return emit({ phase: "stopped", running: false, message: "Community network stopped." });
      options.onLog?.("info", `Community services restarted after exit code ${code}.`);
      emit({ phase: "restarting", running: false, message: "Reconnecting GameDeck to the community…" });
      scheduleRestart();
    });
    await waitUntilReady();
    return emit({ phase: "ready", progress: 100, running: true, message: "Community network is ready." });
  }

  function start() {
    if (startTask) return startTask;
    startTask = performStart().catch(error => {
      options.onLog?.("info", `Community services are temporarily unavailable: ${error.message}`);
      return emit({ phase: "error", running: false, error: error.message, message: "Community features will retry automatically." });
    }).finally(() => { startTask = null; });
    return startTask;
  }

  async function stop() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (external || !child?.pid) {
      external = false;
      child = null;
      return emit({ phase: "stopped", running: false, message: "Community network stopped." });
    }
    const processId = child.pid;
    if (platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      try { process.kill(-processId, "SIGTERM"); } catch { try { process.kill(processId, "SIGTERM"); } catch {} }
    }
    const deadline = Date.now() + 2500;
    while (child && Date.now() < deadline) await sleep(50);
    child = null;
    return emit({ phase: "stopped", running: false, message: "Community network stopped." });
  }

  return {
    key,
    root,
    nodeUrl,
    status,
    ensureInstalled,
    start,
    stop,
    close: stop
  };
}

module.exports = { createFreenetNodeManager, fileSha256, platformKey, tcpReady };
