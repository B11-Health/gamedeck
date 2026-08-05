'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const DEFAULT_MAX_ASSET_BYTES = 64 * 1024 * 1024 * 1024;
const ALLOWED_DISTRIBUTION_POLICIES = new Set([
  'community-cache-allowed',
  'publisher-authorized',
  'redistributable',
  'open-source',
  'public-domain',
  'freeware-redistributable'
]);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function safeSegment(value, label) {
  const text = String(value || '').trim();
  if (!text || text === '.' || text === '..' || /[\\/\0]/.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function safeTarget(root, folder, fileName) {
  const base = path.resolve(root);
  const target = path.resolve(base, safeSegment(folder, 'content folder'), safeSegment(fileName, 'content filename'));
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Content target escaped the GameDeck library.');
  return target;
}

function publicKeyFromValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.includes('BEGIN PUBLIC KEY')) return crypto.createPublicKey(text);
  const raw = Buffer.from(text, 'base64');
  if (raw.length !== 32) throw new Error('Trusted Ed25519 public keys must be PEM or 32-byte base64 values.');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

function verifyManifestEnvelope(envelope, options = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('Community content manifest is missing.');
  const payload = envelope.payload;
  if (!payload || !Array.isArray(payload.assets)) throw new Error('Community content manifest payload is invalid.');

  const signature = envelope.signature || null;
  const trustedKeys = options.trustedKeys || {};
  const allowUnsigned = options.allowUnsigned === true;
  if (!signature) {
    if (!allowUnsigned) throw new Error('Community content manifest is not signed.');
    return payload;
  }

  if (String(signature.algorithm || '').toLowerCase() !== 'ed25519') {
    throw new Error('Community content manifest uses an unsupported signature algorithm.');
  }
  const keyValue = trustedKeys[signature.keyId];
  if (!keyValue) throw new Error('Community content manifest signer is not trusted.');
  const key = publicKeyFromValue(keyValue);
  const valid = crypto.verify(
    null,
    Buffer.from(canonicalize(payload), 'utf8'),
    key,
    Buffer.from(String(signature.value || ''), 'base64')
  );
  if (!valid) throw new Error('Community content manifest signature is invalid.');
  return payload;
}

function normalizeChunk(chunk, index) {
  const hash = String(chunk?.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Chunk ${index + 1} has an invalid SHA-256.`);
  const size = Number(chunk?.size || 0);
  if (!Number.isSafeInteger(size) || size <= 0 || size > 64 * 1024 * 1024) {
    throw new Error(`Chunk ${index + 1} has an invalid size.`);
  }
  const urls = (Array.isArray(chunk?.urls) ? chunk.urls : []).map(String).filter(value => /^https:\/\//i.test(value));
  return {
    index,
    sha256: hash,
    size,
    contractKey: String(chunk?.contractKey || '').trim(),
    urls,
    localPath: String(chunk?.localPath || '').trim(),
    inlineBase64: String(chunk?.inlineBase64 || '')
  };
}

function normalizeAsset(asset, index, maxAssetBytes) {
  const folder = safeSegment(asset?.folder, 'content folder');
  const fileName = safeSegment(asset?.fileName, 'content filename');
  const sha256 = String(asset?.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Asset ${index + 1} has an invalid SHA-256.`);
  const size = Number(asset?.size || 0);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxAssetBytes) {
    throw new Error(`Asset ${index + 1} has an invalid size.`);
  }
  const distributionPolicy = String(asset?.distributionPolicy || '').toLowerCase();
  if (!ALLOWED_DISTRIBUTION_POLICIES.has(distributionPolicy)) {
    throw new Error(`Asset ${index + 1} is not approved for community delivery.`);
  }
  const chunks = (Array.isArray(asset?.chunks) ? asset.chunks : []).map(normalizeChunk);
  if (!chunks.length) throw new Error(`Asset ${index + 1} has no chunks.`);
  const chunkBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  if (chunkBytes !== size) throw new Error(`Asset ${index + 1} chunk sizes do not match the file size.`);
  return {
    id: String(asset?.id || `${folder}:${fileName}`).slice(0, 240),
    title: String(asset?.title || fileName).slice(0, 240),
    systemId: String(asset?.systemId || folder).slice(0, 64),
    systemName: String(asset?.systemName || asset?.systemId || folder).slice(0, 120),
    folder,
    fileName,
    size,
    sha256,
    distributionPolicy,
    listed: asset?.listed !== false,
    chunks
  };
}

function normalizePayload(payload, maxAssetBytes = DEFAULT_MAX_ASSET_BYTES) {
  return {
    version: Number(payload?.version || 1),
    generatedAt: Number(payload?.generatedAt || 0),
    assets: payload.assets.map((asset, index) => normalizeAsset(asset, index, maxAssetBytes))
  };
}

function manifestAssetKey(folder, fileName) {
  return `${String(folder || '').toLowerCase()}\0${String(fileName || '').toLowerCase()}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function buildBlobParameters(hashHex, size) {
  const hash = Buffer.from(String(hashHex || ''), 'hex');
  if (hash.length !== 32) throw new Error('Chunk hash must be 32 bytes.');
  const length = Number(size);
  if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Chunk size is invalid.');
  const output = Buffer.alloc(41);
  output[0] = 1;
  hash.copy(output, 1);
  output.writeBigUInt64LE(BigInt(length), 33);
  return output;
}

function createSdkClient(options = {}) {
  const {
    FreenetWsApi,
    ContractContainer,
    ContractKey,
    ContractType,
    DisconnectRequest,
    GetRequest,
    PutRequest,
    WasmContractV1
  } = require('@freenetorg/freenet-stdlib');
  const { ContractCodeT } = require('@freenetorg/freenet-stdlib/common');

  const url = new URL(options.nodeUrl || 'ws://127.0.0.1:7509/v1/contract/command');
  const authToken = String(options.authToken || '');
  let api = null;
  let opening = null;

  async function ensureOpen() {
    if (api) return api;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        api = null;
        reject(new Error('GameDeck community network did not respond.'));
      }, Math.max(1000, Number(options.connectTimeoutMs || 8000)));
      const fail = error => {
        options.onLog?.('debug', error?.message || String(error));
      };
      const handler = {
        onContractPut: () => {},
        onContractGet: () => {},
        onContractUpdate: () => {},
        onContractUpdateNotification: () => {},
        onContractNotFound: () => {},
        onDelegateResponse: () => {},
        onErr: fail,
        onOpen: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(api);
        },
        onClose: () => {
          api = null;
          opening = null;
        }
      };
      try {
        api = new FreenetWsApi(new URL(url.toString()), handler, authToken);
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        api = null;
        reject(error);
      }
    }).finally(() => {
      opening = null;
    });
    return opening;
  }

  return {
    async getState(contractKey) {
      const client = await ensureOpen();
      const response = await client.get(new GetRequest(ContractKey.fromInstanceId(contractKey), false, false, false));
      return Buffer.from(response.state || []);
    },
    async putState(contractWasm, parameters, state) {
      const client = await ensureOpen();
      const code = new ContractCodeT([...contractWasm], []);
      const contract = new WasmContractV1(code, [...parameters], null);
      const container = new ContractContainer(ContractType.WasmContractV1, contract);
      const response = await client.put(new PutRequest(container, [...state], null, false, false));
      return response.key.encode();
    },
    async close() {
      const client = api;
      api = null;
      if (!client) return;
      try {
        await client.disconnect(new DisconnectRequest('GameDeck closed the community connection.'));
      } catch {}
    }
  };
}

function createFreenetContentProvider(options = {}) {
  const libraryRoot = path.resolve(options.libraryRoot);
  const cacheRoot = path.resolve(options.cacheRoot || path.join(libraryRoot, '.gamedeck-community'));
  const bootstrapManifestPath = options.bootstrapManifestPath ? path.resolve(options.bootstrapManifestPath) : '';
  const manifestCachePath = options.manifestCachePath ? path.resolve(options.manifestCachePath) : '';
  const contractWasmPath = options.contractWasmPath ? path.resolve(options.contractWasmPath) : '';
  const maxAssetBytes = Number(options.maxAssetBytes || DEFAULT_MAX_ASSET_BYTES);
  const trustedKeys = options.trustedKeys || {};
  const allowUnsigned = options.allowUnsigned === true;
  const allowLocalSources = options.allowLocalSources === true;
  const manifestContractKey = String(options.manifestContractKey || '').trim();
  const nodeUrl = String(options.nodeUrl || 'ws://127.0.0.1:7509/v1/contract/command');
  const client = options.client || createSdkClient({
    nodeUrl,
    authToken: options.authToken,
    connectTimeoutMs: options.connectTimeoutMs,
    onLog: options.onLog
  });

  let payload = { version: 1, generatedAt: 0, assets: [] };
  let assetsByKey = new Map();
  let lastError = '';
  let refreshedAt = 0;
  let connected = false;

  function applyEnvelope(envelope, source) {
    const verified = verifyManifestEnvelope(envelope, { trustedKeys, allowUnsigned });
    const normalized = normalizePayload(verified, maxAssetBytes);
    payload = normalized;
    assetsByKey = new Map(normalized.assets.map(asset => [manifestAssetKey(asset.folder, asset.fileName), asset]));
    lastError = '';
    options.onLog?.('debug', `Loaded ${normalized.assets.length} approved community assets from ${source}.`);
    return normalized;
  }

  function loadInitial() {
    for (const candidate of [manifestCachePath, bootstrapManifestPath]) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      try {
        applyEnvelope(readJson(candidate), path.basename(candidate));
        return;
      } catch (error) {
        lastError = error.message;
        options.onLog?.('debug', `Ignored invalid community manifest: ${error.message}`);
      }
    }
  }
  loadInitial();

  async function refresh() {
    if (!manifestContractKey) return status();
    try {
      const state = await client.getState(manifestContractKey);
      if (!state.length) throw new Error('Community content manifest is empty.');
      const envelope = JSON.parse(state.toString('utf8'));
      applyEnvelope(envelope, 'network');
      if (manifestCachePath) atomicWriteJson(manifestCachePath, envelope);
      connected = true;
      refreshedAt = Date.now();
    } catch (error) {
      connected = false;
      lastError = error.message;
      options.onLog?.('debug', `Community manifest refresh failed: ${error.message}`);
    }
    return status();
  }

  function status() {
    return {
      available: payload.assets.length > 0,
      connected,
      assetCount: payload.assets.length,
      refreshedAt,
      lastError
    };
  }

  function findAsset(spec = {}) {
    const asset = assetsByKey.get(manifestAssetKey(spec.folder, spec.fileName)) || null;
    if (!asset) return null;
    if (spec.expectedSha256 && String(spec.expectedSha256).toLowerCase() !== asset.sha256) return null;
    return asset;
  }

  function catalogSystems() {
    const groups = new Map();
    for (const asset of payload.assets) {
      if (!asset.listed) continue;
      const key = asset.folder.toLowerCase();
      const current = groups.get(key) || {
        id: key,
        name: asset.systemName,
        folder: asset.folder,
        source: `community:${key}`,
        image: '',
        count: 0,
        gamesFile: `community:${key}`,
        systemId: asset.systemId,
        playable: true,
        issue: ''
      };
      current.count += 1;
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function catalogGames(source) {
    const folder = String(source || '').replace(/^community:/, '').toLowerCase();
    return payload.assets
      .filter(asset => asset.listed && asset.folder.toLowerCase() === folder)
      .map((asset, index) => ({
        id: Index,
        name: asset.title,
        fileName: asset.fileName,
        edition: '',
        region: '',
        tags: [],
        size: asset.size,
        installedFile: fs.existsSync(safeTarget(libraryRoot, asset.folder, asset.fileName))
          ? safeTarget(libraryRoot, asset.folder, asset.fileName)
          : '',
        installedReady: fs.existsSync(safeTarget(libraryRoot, asset.folder, asset.fileName))
      }));
  }

  async function readExistingChunk(part, offset, size) {
    const handle = await fs.promises.open(part, 'r');
    try {
      const buffer = Buffer.alloc(size);
      const result = await handle.read(buffer, 0, size, offset);
      return result.bytesRead === size ? buffer : null;
    } finally {
      await handle.close();
    }
  }

  async function validatedResumeOffset(part, asset) {
    if (!fs.existsSync(part)) return 0;
    const stat = fs.statSync(part);
    if (stat.size > asset.size) {
      fs.truncateSync(part, 0);
      return 0;
    }
    let offset = 0;
    for (const chunk of asset.chunks) {
      if (offset + chunk.size > stat.size) break;
      const bytes = await readExistingChunk(part, offset, chunk.size);
      if (!bytes || sha256Buffer(bytes) !== chunk.sha256) break;
      offset += chunk.size;
    }
    if (stat.size !== offset) fs.truncateSync(part, offset);
    return offset;
  }

  async function fetchHttps(url, expectedSize) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60 * 1000),
      headers: { 'user-agent': `GameDeck/${options.appVersion || 'dev'}` }
    });
    if (!response.ok || !response.body) throw new Error(`Community peer returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length !== expectedSize) throw new Error('Community peer returned an unexpected chunk size.');
    const values = [];
    let total = 0;
    for await (const value of response.body) {
      total += value.length;
      if (total > expectedSize) throw new Error('Community peer exceeded the expected chunk size.');
      values.push(Buffer.from(value));
    }
    if (total !== expectedSize) throw new Error('Community peer returned an incomplete chunk.');
    return Buffer.concat(values, total);
  }

  async function fetchChunk(chunk) {
    const errors = [];
    if (chunk.contractKey) {
      try {
        const bytes = await client.getState(chunk.contractKey);
        connected = true;
        return bytes;
      } catch (error) {
        connected = false;
        errors.push(error.message);
      }
    }
    for (const url of chunk.urls) {
      try {
        return await fetchHttps(url, chunk.size);
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (allowLocalSources && chunk.localPath) {
      try {
        return fs.readFileSync(path.resolve(chunk.localPath));
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (allowLocalSources && chunk.inlineBase64) {
      try {
        return Buffer.from(chunk.inlineBase64, 'base64');
      } catch (error) {
        errors.push(error.message);
      }
    }
    throw new Error(errors.filter(Boolean).at(-1) || 'No community peer currently has this chunk.');
  }

  async function downloadAsset(assetInput, control = {}) {
    let asset = typeof assetInput === 'string'
      ? payload.assets.find(item => item.id === assetInput)
      : assetInput;
    if (!asset) throw new Error('No verified community copy is available.');
    const normalizedAsset = normalizeAsset(asset, 0, maxAssetBytes);
    const target = safeTarget(libraryRoot, normalizedAsset.folder, normalizedAsset.fileName);
    asset = normalizedAsset;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(cacheRoot, { recursive: true });
    const part = `${target}.gamedeck.part`;
    let offset = await validatedResumeOffset(part, asset);
    const output = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
    const startedAt = Date.now();
    try {
      for (const chunk of asset.chunks) {
        if (control.isCancelled?.()) throw new Error('Transfer paused.');
        if (offset >= chunk.size) {
          offset -= chunk.size;
          continue;
        }
        if (offset !== 0) throw new Error('Community transfer resume state is invalid.');
        control.onProgress?.({
          phase: 'downloading',
          downloadedBytes: output.bytesWritten + (fs.existsSync(part) ? fs.statSync(part).size - output.bytesWritten : 0),
          totalBytes: asset.size,
          message: 'Finding an available community copy…'
        });
        const bytes = await fetchChunk(chunk);
        if (bytes.length !== chunk.size) throw new Error('Community chunk size did not match the signed manifest.');
        if (sha256Buffer(bytes) !== chunk.sha256) throw new Error('Community chunk failed verification.');
        if (!output.write(bytes)) await new Promise(resolve => output.once('drain', resolve));
        const downloadedBytes = fs.statSync(part).size + output.writableLength;
        const elapsed = Math.max(0.25, (Date.now() - startedAt) / 1000);
        control.onProgress?.({
          phase: 'downloading',
          downloadedBytes: Math.min(asset.size, downloadedBytes),
          totalBytes: asset.size,
          speedBytes: Math.round(Math.max(0, downloadedBytes) / elapsed),
          progress: Math.min(98, downloadedBytes / asset.size * 98),
          message: 'Downloading game…'
        });
      }
      await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    } catch (error) {
      output.destroy();
      throw error;
    }

    control.onProgress?.({ phase: 'verifying', progress: 99, downloadedBytes: asset.size, totalBytes: asset.size, message: 'Verifying game…' });
    const stat = fs.statSync(part);
    if (stat.size !== asset.size) throw new Error('Downloaded game size did not match the signed manifest.');
    const digest = await sha256File(part);
    if (digest !== asset.sha256) throw new Error('Downloaded game failed final verification.');
    fs.rmSync(target, { force: true });
    fs.renameSync(part, target);
    control.onProgress?.({ phase: 'complete', progress: 100, downloadedBytes: asset.size, totalBytes: asset.size, message: 'Game is ready.' });
    return { file: target, asset };
  }

  async function seedAsset(assetInput, file, control = {}) {
    const asset = typeof assetInput === 'string'
      ? payload.assets.find(item => item.id === assetInput)
      : assetInput;
    if (!asset) return { seeded: false, reason: 'not-approved' };
    if (!contractWasmPath || !fs.existsSync(contractWasmPath)) return { seeded: false, reason: 'contract-unavailable' };
    const resolved = path.resolve(file);
    const stat = fs.statSync(resolved);
    if (stat.size !== asset.size) return { seeded: false, reason: 'size-mismatch' };
    if (await sha256File(resolved) !== asset.sha256) return { seeded: false, reason: 'hash-mismatch' };
    const wasm = fs.readFileSync(contractWasmPath);
    const handle = await fs.promises.open(resolved, 'r');
    let offset = 0;
    let seeded = 0;
    try {
      for (const chunk of asset.chunks) {
        if (control.isCancelled?.()) throw new Error('Transfer paused.');
        const bytes = Buffer.alloc(chunk.size);
        const result = await handle.read(bytes, 0, chunk.size, offset);
        if (result.bytesRead !== chunk.size || sha256Buffer(bytes) !== chunk.sha256) {
          throw new Error('Local game chunk does not match the signed manifest.');
        }
        const key = await client.putState(wasm, buildBlobParameters(chunk.sha256, chunk.size), bytes);
        if (chunk.contractKey && key !== chunk.contractKey) {
          throw new Error('Published chunk key did not match the signed manifest.');
        }
        offset += chunk.size;
        seeded += 1;
        control.onProgress?.({ seeded, total: asset.chunks.length });
      }
    } finally {
      await handle.close();
    }
    connected = true;
    return { seeded: true, chunks: seeded };
  }

  return {
    status,
    refresh,
    findAsset,
    catalogSystems,
    catalogGames,
    downloadAsset,
    seedAsset,
    close: () => client.close?.(),
    manifest: () => payload
  };
}

module.exports = {
  ALLOWED_DISTRIBUTION_POLICIES,
  DEFAULT_CHUNK_SIZE,
  buildBlobParameters,
  canonicalize,
  createFreenetContentProvider,
  manifestAssetKey,
  normalizePayload,
  sha256Buffer,
  sha256File,
  verifyManifestEnvelope
};
