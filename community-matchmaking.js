"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOM_VERSION = 1;
const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_INVITE_BYTES = 32 * 1024;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function normalizeHash(value, label) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${label} is invalid.`);
  return hash;
}

function cleanText(value, max, fallback) {
  const text = String(value || fallback || "").replace(/[\r\n\0\x00-\x1f\x7f]/g, " ").trim();
  return text.slice(0, max) || String(fallback || "Player").slice(0, max);
}

function normalizeMatch(spec = {}) {
  return {
    contentSha256: normalizeHash(spec.contentSha256, "Game match ID"),
    coreSha256: normalizeHash(spec.coreSha256, "Core match ID"),
    systemId: cleanText(spec.systemId, 64, "game"),
    title: cleanText(spec.title, 160, "Multiplayer game")
  };
}

function roomParameters(matchInput) {
  const match = normalizeMatch(matchInput);
  return Buffer.concat([
    Buffer.from([1]),
    Buffer.from(match.contentSha256, "hex"),
    Buffer.from(match.coreSha256, "hex")
  ]);
}

function signatureMessage(room, matchInput) {
  const match = normalizeMatch(matchInput);
  return [
    "GDROOM1",
    room.roomId,
    match.contentSha256,
    match.coreSha256,
    room.systemId,
    room.title,
    room.hostName,
    String(room.maxPlayers),
    String(room.playerCount),
    String(room.createdAt),
    String(room.expiresAt),
    room.invite,
    room.status
  ].join("\n");
}

function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

function loadIdentity(root) {
  const file = path.join(root, "room-identity.json");
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    const privateKey = crypto.createPrivateKey(stored.privateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicHex = rawPublicKey(publicKey).toString("hex");
    if (publicHex !== String(stored.publicKey || "").toLowerCase()) throw new Error("identity mismatch");
    return { file, privateKey, publicKey, publicHex };
  } catch {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicHex = rawPublicKey(publicKey).toString("hex");
    atomicWriteJson(file, {
      version: 1,
      createdAt: Date.now(),
      publicKey: publicHex,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" })
    });
    return { file, privateKey, publicKey, publicHex };
  }
}

function signRoom(room, match, identity) {
  const unsigned = { ...room, hostPublicKey: identity.publicHex, signature: "" };
  const signature = crypto.sign(null, Buffer.from(signatureMessage(unsigned, match), "utf8"), identity.privateKey).toString("hex");
  return { ...unsigned, signature };
}

function publicKeyFromRawHex(value) {
  const raw = Buffer.from(String(value || ""), "hex");
  if (raw.length !== 32) throw new Error("Room host key is invalid.");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

function verifyRoom(room, matchInput) {
  const match = normalizeMatch(matchInput);
  if (!room || room.version !== ROOM_VERSION) return false;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(room.roomId || ""))) return false;
  if (!String(room.invite || "").startsWith("GDPLAY1.") || Buffer.byteLength(room.invite) > MAX_INVITE_BYTES) return false;
  if (!['open', 'closed'].includes(room.status)) return false;
  if (Number(room.maxPlayers) < 2 || Number(room.maxPlayers) > 16) return false;
  if (Number(room.playerCount) < 1 || Number(room.playerCount) > Number(room.maxPlayers)) return false;
  if (Number(room.expiresAt) <= Number(room.createdAt) || Number(room.expiresAt) - Number(room.createdAt) > ROOM_LIFETIME_MS) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(signatureMessage({ ...room, signature: "" }, match), "utf8"),
      publicKeyFromRawHex(room.hostPublicKey),
      Buffer.from(String(room.signature || ""), "hex")
    );
  } catch {
    return false;
  }
}

function parseRoomState(value, match) {
  const state = Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : value;
  if (!state || state.version !== 1 || !Array.isArray(state.rooms)) throw new Error("Community room directory is invalid.");
  return state.rooms.filter(room => verifyRoom(room, match));
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
    StateUpdate,
    UpdateData,
    UpdateDataType,
    UpdateRequest,
    WasmContractV1
  } = require("@freenetorg/freenet-stdlib");
  const { ContractCodeT } = require("@freenetorg/freenet-stdlib/common");
  const { RelatedContractsT } = require("@freenetorg/freenet-stdlib/client-request");
  const url = new URL(options.nodeUrl || "ws://127.0.0.1:7509/v1/contract/command");
  let api = null;
  let opening = null;
  let blake3Module = null;

  async function blake3Bytes(value) {
    blake3Module ||= import("@noble/hashes/blake3.js");
    const { blake3 } = await blake3Module;
    return Uint8Array.from(blake3(Uint8Array.from(value)));
  }

  function encodeKey(key) {
    return `${key.encode()}.${Buffer.from(key.codePart()).toString("base64url")}`;
  }

  function decodeKey(value) {
    const [instanceValue, codeValue = ""] = String(value || "").split(".", 2);
    const partial = ContractKey.fromInstanceId(instanceValue);
    const code = Buffer.from(codeValue, "base64url");
    if (code.length !== 32) throw new Error("Community room contract key is invalid.");
    return new ContractKey(partial.bytes(), code);
  }

  async function derivedContract(contractWasm, parameters) {
    const codeHash = await blake3Bytes(contractWasm);
    const instanceId = await blake3Bytes(Buffer.concat([Buffer.from(codeHash), Buffer.from(parameters)]));
    const key = new ContractKey(instanceId, codeHash);
    return { key, encoded: encodeKey(key), codeHash };
  }

  async function ensureOpen() {
    if (api) return api;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        api = null;
        reject(new Error("GameDeck community did not respond."));
      }, Math.max(1000, Number(options.connectTimeoutMs || 8000)));
      const handler = {
        onContractPut: () => {},
        onContractGet: () => {},
        onContractUpdate: response => {
          const pending = api?.pendingPuts?.shift?.();
          if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(response);
          }
        },
        onContractUpdateNotification: () => {},
        onContractNotFound: () => {},
        onDelegateResponse: () => {},
        onErr: error => {
          options.onLog?.("debug", error?.message || String(error));
          for (const queue of [api?.pendingGets, api?.pendingPuts, api?.pendingUpdates]) {
            const pending = queue?.shift?.();
            if (!pending) continue;
            clearTimeout(pending.timer);
            pending.reject(error instanceof Error ? error : new Error(String(error)));
            break;
          }
        },
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
        api = new FreenetWsApi(new URL(url.toString()), handler, options.authToken || "");
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        api = null;
        reject(error);
      }
    }).finally(() => { opening = null; });
    return opening;
  }

  return {
    derivedContract,
    async getState(contractKey) {
      const client = await ensureOpen();
      const response = await client.get(new GetRequest(decodeKey(contractKey), false, false, false));
      return Buffer.from(response.state || []);
    },
    async putState(contractWasm, parameters, state) {
      const client = await ensureOpen();
      const derived = await derivedContract(contractWasm, parameters);
      const code = new ContractCodeT([...contractWasm], [...derived.codeHash]);
      const contract = new WasmContractV1(code, [...parameters], derived.key);
      const container = new ContractContainer(ContractType.WasmContractV1, contract);
      const response = await client.put(new PutRequest(container, [...state], new RelatedContractsT([]), false, false));
      if (response.key.encode() !== derived.key.encode()) throw new Error("Freenet returned an unexpected room contract key.");
      return derived.encoded;
    },
    async updateState(contractKey, state) {
      const client = await ensureOpen();
      const update = new UpdateData(UpdateDataType.StateUpdate, new StateUpdate([...state]));
      await client.update(new UpdateRequest(decodeKey(contractKey), update));
      return contractKey;
    },
    async close() {
      const client = api;
      api = null;
      if (!client) return;
      try { await client.disconnect(new DisconnectRequest("GameDeck closed community matchmaking.")); } catch {}
    }
  };
}

function createCommunityMatchmaking(options = {}) {
  const root = path.resolve(options.root);
  const contractWasmPath = path.resolve(options.contractWasmPath);
  fs.mkdirSync(root, { recursive: true });
  const identity = loadIdentity(root);
  const client = options.client || createSdkClient(options);
  let activeRoom = null;
  let lastError = "";
  let connected = false;
  const initializedDirectories = new Set();

  async function contractFor(matchInput) {
    const match = normalizeMatch(matchInput);
    const parameters = roomParameters(match);
    const wasm = fs.readFileSync(contractWasmPath);
    const derived = await client.derivedContract(wasm, parameters);
    return { match, parameters, wasm, key: derived.encoded };
  }

  async function listRooms(matchInput) {
    const contract = await contractFor(matchInput);
    try {
      if (!initializedDirectories.has(contract.key)) {
        const empty = Buffer.from(JSON.stringify({ version: 1, rooms: [] }), "utf8");
        await client.putState(contract.wasm, contract.parameters, empty);
        initializedDirectories.add(contract.key);
      }
      const state = await client.getState(contract.key);
      connected = true;
      lastError = "";
      const now = Date.now();
      return parseRoomState(state, contract.match)
        .filter(room => room.status === "open" && Number(room.expiresAt) > now && Number(room.playerCount) < Number(room.maxPlayers))
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    } catch (error) {
      if (/contract not found/i.test(error.message)) {
        connected = true;
        lastError = "";
        return [];
      }
      connected = false;
      lastError = error.message;
      options.onLog?.("debug", `Community room lookup failed: ${error.message}`);
      return [];
    }
  }

  async function writeRoom(room, matchInput) {
    const contract = await contractFor(matchInput);
    const state = Buffer.from(JSON.stringify({ version: 1, rooms: [room] }), "utf8");
    await client.putState(contract.wasm, contract.parameters, state);
    initializedDirectories.add(contract.key);
    connected = true;
    lastError = "";
    return room;
  }

  async function publishRoom(spec = {}) {
    const match = normalizeMatch(spec);
    const invite = String(spec.invite || "").trim();
    if (!invite.startsWith("GDPLAY1.") || Buffer.byteLength(invite) > MAX_INVITE_BYTES) {
      throw new Error("The multiplayer invitation is not ready for community discovery.");
    }
    let expiresAt = Number(spec.expiresAt || Date.now() + ROOM_LIFETIME_MS);
    const createdAt = Math.max(1, Number(spec.createdAt || Date.now()));
    expiresAt = Math.min(expiresAt, createdAt + ROOM_LIFETIME_MS);
    const unsigned = {
      version: ROOM_VERSION,
      roomId: cleanText(spec.roomId || `room-${crypto.randomBytes(12).toString("hex")}`, 80, "room").replace(/[^A-Za-z0-9_-]/g, "-"),
      title: match.title,
      systemId: match.systemId,
      hostName: cleanText(spec.hostName, 40, "Player"),
      maxPlayers: Math.max(2, Math.min(16, Number(spec.maxPlayers || 2))),
      playerCount: Math.max(1, Number(spec.playerCount || 1)),
      createdAt,
      expiresAt,
      invite,
      status: "open"
    };
    const room = signRoom(unsigned, match, identity);
    await writeRoom(room, match);
    activeRoom = { room, match };
    options.onUpdate?.({ type: "room-published", room: { ...room, invite: "" }, match });
    return room;
  }

  async function updateActiveRoom(playerCount) {
    if (!activeRoom) return null;
    const room = signRoom({
      ...activeRoom.room,
      playerCount: Math.max(1, Math.min(activeRoom.room.maxPlayers, Number(playerCount || activeRoom.room.playerCount))),
      status: "open"
    }, activeRoom.match, identity);
    await writeRoom(room, activeRoom.match);
    activeRoom = { room, match: activeRoom.match };
    return room;
  }

  async function closeActiveRoom() {
    if (!activeRoom) return null;
    const current = activeRoom;
    activeRoom = null;
    const room = signRoom({
      ...current.room,
      playerCount: Math.max(1, Number(current.room.playerCount || 1)),
      status: "closed"
    }, current.match, identity);
    try {
      await writeRoom(room, current.match);
      options.onUpdate?.({ type: "room-closed", room: { ...room, invite: "" }, match: current.match });
    } catch (error) {
      lastError = error.message;
      options.onLog?.("debug", `Community room close failed: ${error.message}`);
    }
    return room;
  }

  return {
    status: () => ({ connected, active: Boolean(activeRoom), publicKey: identity.publicHex, lastError }),
    listRooms,
    publishRoom,
    updateActiveRoom,
    closeActiveRoom,
    activeRoom: () => activeRoom,
    close: async () => {
      await closeActiveRoom();
      await client.close?.();
    }
  };
}

module.exports = {
  ROOM_LIFETIME_MS,
  createCommunityMatchmaking,
  createSdkClient,
  normalizeMatch,
  parseRoomState,
  roomParameters,
  signatureMessage,
  verifyRoom
};
