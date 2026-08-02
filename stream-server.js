'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function randomId() {
  return crypto.randomBytes(12).toString('hex');
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (/^(169\.254|0\.)/.test(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function safeJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  response.end(body);
}

function readBody(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function createStreamServer(options = {}) {
  const mobileRoot = path.resolve(options.mobileRoot);
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  let server = null;
  let active = false;
  let code = '';
  let port = 0;
  let startedAt = 0;
  let title = 'GameDeck Live';
  let sourceName = 'Primary display';
  let quality = '1080p';
  let audio = true;
  let hostQueue = [];
  const viewers = new Map();
  let cleanupTimer = null;

  function publicViewer(viewer) {
    return {
      id: viewer.id,
      label: viewer.label,
      joinedAt: viewer.joinedAt,
      lastSeenAt: viewer.lastSeenAt,
      connected: viewer.connected !== false
    };
  }

  function status() {
    const addresses = localAddresses();
    const urls = port ? addresses.map(address => `http://${address}:${port}/?code=${code}`) : [];
    return {
      active,
      code: active ? code : '',
      port,
      urls,
      primaryUrl: urls[0] || '',
      viewers: [...viewers.values()].map(publicViewer),
      viewerCount: viewers.size,
      startedAt,
      title,
      sourceName,
      quality,
      audio,
      localOnly: true,
      protocol: 'GameDeck WebRTC LAN'
    };
  }

  function emit(extra = {}) {
    const value = { ...status(), ...extra, at: Date.now() };
    onUpdate(value);
    return value;
  }

  function validCode(value) {
    return active && String(value || '').trim() === code;
  }

  function viewerFor(id) {
    const viewer = viewers.get(String(id || ''));
    if (viewer) viewer.lastSeenAt = Date.now();
    return viewer;
  }

  function pushHost(event) {
    hostQueue.push({ ...event, at: Date.now() });
    if (hostQueue.length > 500) hostQueue = hostQueue.slice(-500);
  }

  function staticPath(urlPath) {
    const requested = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath).replace(/\\/g, '/');
    const normalized = path.posix.normalize(requested).replace(/^\.\.(\/|$)/, '');
    const candidate = path.resolve(mobileRoot, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
    return candidate.startsWith(mobileRoot) ? candidate : '';
  }

  async function api(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      safeJson(response, 200, { ok: true, stream: status() });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/pair') {
      const body = await readBody(request);
      if (!validCode(body.code)) {
        safeJson(response, 403, { ok: false, error: 'Pairing code is invalid or the stream is offline.' });
        return true;
      }
      const id = randomId();
      const label = String(body.label || 'Mobile viewer').trim().slice(0, 64) || 'Mobile viewer';
      const viewer = { id, label, joinedAt: Date.now(), lastSeenAt: Date.now(), connected: true, queue: [] };
      viewers.set(id, viewer);
      pushHost({ type: 'viewer-joined', viewerId: id, label });
      emit({ event: 'viewer-joined', viewer: publicViewer(viewer) });
      safeJson(response, 200, { ok: true, viewerId: id, stream: status() });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/signal') {
      const body = await readBody(request);
      const viewer = viewerFor(body.viewerId);
      if (!viewer || !validCode(body.code)) {
        safeJson(response, 403, { ok: false, error: 'Viewer session expired.' });
        return true;
      }
      pushHost({ type: 'signal', viewerId: viewer.id, payload: body.payload || {} });
      safeJson(response, 200, { ok: true });
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/messages') {
      const viewer = viewerFor(url.searchParams.get('viewerId'));
      if (!viewer || !validCode(url.searchParams.get('code'))) {
        safeJson(response, 403, { ok: false, error: 'Viewer session expired.' });
        return true;
      }
      const messages = viewer.queue.splice(0, 100);
      safeJson(response, 200, { ok: true, messages, stream: status() });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/leave') {
      const body = await readBody(request);
      const viewer = viewers.get(String(body.viewerId || ''));
      if (viewer) {
        viewers.delete(viewer.id);
        pushHost({ type: 'viewer-left', viewerId: viewer.id });
        emit({ event: 'viewer-left', viewerId: viewer.id });
      }
      safeJson(response, 200, { ok: true });
      return true;
    }
    return false;
  }

  function serveStatic(response, url) {
    const file = staticPath(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      safeJson(response, 404, { ok: false, error: 'Not found.' });
      return;
    }
    const stat = fs.statSync(file);
    response.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': path.basename(file) === 'index.html' ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()'
    });
    fs.createReadStream(file).pipe(response);
  }

  function requestHandler(request, response) {
    const url = new URL(request.url || '/', 'http://gamedeck.local');
    Promise.resolve(api(request, response, url)).then(handled => {
      if (!handled) serveStatic(response, url);
    }).catch(error => {
      onLog('error', `GameDeck Live request failed: ${error.message}`);
      if (!response.headersSent) safeJson(response, 400, { ok: false, error: error.message });
      else response.end();
    });
  }

  function ensureServer(preferredPort = 41783) {
    if (server) return Promise.resolve(status());
    return new Promise((resolve, reject) => {
      const candidate = http.createServer(requestHandler);
      candidate.on('error', error => {
        if (error.code === 'EADDRINUSE' && preferredPort !== 0) {
          candidate.close();
          server = null;
          ensureServer(0).then(resolve, reject);
          return;
        }
        reject(error);
      });
      candidate.listen(preferredPort, '0.0.0.0', () => {
        server = candidate;
        port = Number(candidate.address()?.port || 0);
        cleanupTimer = setInterval(() => {
          const cutoff = Date.now() - 45000;
          for (const viewer of viewers.values()) {
            if (viewer.lastSeenAt >= cutoff) continue;
            viewers.delete(viewer.id);
            pushHost({ type: 'viewer-left', viewerId: viewer.id });
          }
          if (active) emit();
        }, 15000);
        cleanupTimer.unref?.();
        resolve(status());
      });
    });
  }

  async function start(config = {}) {
    await ensureServer(Number(config.port || 41783));
    active = true;
    code = randomCode();
    startedAt = Date.now();
    title = String(config.title || 'GameDeck Live').slice(0, 120);
    sourceName = String(config.sourceName || 'Primary display').slice(0, 120);
    quality = String(config.quality || '1080p').slice(0, 24);
    audio = config.audio !== false;
    hostQueue = [];
    viewers.clear();
    onLog('success', `GameDeck Live started on the local network at port ${port}.`);
    return emit({ event: 'started' });
  }

  function stop() {
    if (!active) return status();
    for (const viewer of viewers.values()) viewer.queue.push({ type: 'stream-stopped' });
    viewers.clear();
    hostQueue = [];
    active = false;
    code = '';
    startedAt = 0;
    onLog('info', 'GameDeck Live stopped.');
    return emit({ event: 'stopped' });
  }

  function hostPull() {
    const messages = hostQueue.splice(0, 100);
    return { ok: true, messages, stream: status() };
  }

  function hostSend(viewerId, payload) {
    const viewer = viewerFor(viewerId);
    if (!viewer) return { ok: false, error: 'Viewer is no longer connected.' };
    viewer.queue.push({ type: 'signal', payload, at: Date.now() });
    if (viewer.queue.length > 300) viewer.queue = viewer.queue.slice(-300);
    return { ok: true };
  }

  function close() {
    stop();
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    return new Promise(resolve => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
      port = 0;
    });
  }

  return { status, start, stop, hostPull, hostSend, close };
}

module.exports = { createStreamServer, localAddresses };
