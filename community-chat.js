"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createSdkClient } = require("./community-matchmaking");

const CHAT_TOPIC = "gamedeck-community-global-v1";
const MAX_MESSAGES = 200;
const MAX_TEXT_BYTES = 600;

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

function publicKeyFromRawHex(value) {
  const raw = Buffer.from(String(value || ""), "hex");
  if (raw.length !== 32) throw new Error("Chat author key is invalid.");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

function loadIdentity(root) {
  const file = path.join(root, "chat-identity.json");
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    const privateKey = crypto.createPrivateKey(stored.privateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicHex = rawPublicKey(publicKey).toString("hex");
    if (publicHex !== String(stored.publicKey || "").toLowerCase()) throw new Error("identity mismatch");
    return { privateKey, publicKey, publicHex };
  } catch {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicHex = rawPublicKey(publicKey).toString("hex");
    atomicWriteJson(file, {
      version: 1,
      createdAt: Date.now(),
      publicKey: publicHex,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" })
    });
    return { privateKey, publicKey, publicHex };
  }
}

function cleanText(value, max, fallback = "") {
  const text = String(value || fallback).replace(/[\0\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim();
  return Buffer.byteLength(text) <= max ? text : Buffer.from(text).subarray(0, max).toString("utf8").replace(/�+$/g, "").trim();
}

function topicHash(topic = CHAT_TOPIC) {
  return crypto.createHash("sha256").update(String(topic), "utf8").digest();
}

function chatParameters(topic = CHAT_TOPIC) {
  return Buffer.concat([Buffer.from([1]), topicHash(topic)]);
}

function signatureMessage(message, topic = CHAT_TOPIC) {
  return [
    "GDCHAT1",
    message.id,
    topicHash(topic).toString("hex"),
    message.authorName,
    String(message.createdAt),
    message.text
  ].join("\n");
}

function verifyMessage(message, topic = CHAT_TOPIC) {
  if (!message || message.version !== 1) return false;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(message.id || ""))) return false;
  if (!cleanText(message.authorName, 40) || cleanText(message.authorName, 40) !== message.authorName) return false;
  if (!cleanText(message.text, MAX_TEXT_BYTES) || cleanText(message.text, MAX_TEXT_BYTES) !== message.text) return false;
  if (!Number.isFinite(Number(message.createdAt)) || Number(message.createdAt) <= 0) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(signatureMessage({ ...message, signature: "" }, topic), "utf8"),
      publicKeyFromRawHex(message.authorPublicKey),
      Buffer.from(String(message.signature || ""), "hex")
    );
  } catch {
    return false;
  }
}

function parseChatState(value, topic = CHAT_TOPIC) {
  const state = Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : value;
  if (!state || state.version !== 1 || !Array.isArray(state.messages)) throw new Error("Community chat state is invalid.");
  const seen = new Set();
  return state.messages
    .filter(message => verifyMessage(message, topic) && !seen.has(message.id) && seen.add(message.id))
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .slice(-MAX_MESSAGES);
}

function createCommunityChat(options = {}) {
  const root = path.resolve(options.root);
  const contractWasmPath = path.resolve(options.contractWasmPath);
  const topic = options.topic || CHAT_TOPIC;
  fs.mkdirSync(root, { recursive: true });
  const identity = loadIdentity(root);
  const client = options.client || createSdkClient(options);
  const parameters = chatParameters(topic);
  const contractWasm = fs.readFileSync(contractWasmPath);
  let contractKey = "";
  let initialized = false;
  let connected = false;
  let lastError = "";
  let lastSentAt = 0;

  async function contract() {
    if (!contractKey) contractKey = (await client.derivedContract(contractWasm, parameters)).encoded;
    return contractKey;
  }

  async function ensureInitialized() {
    const key = await contract();
    if (!initialized) {
      await client.putState(contractWasm, parameters, Buffer.from(JSON.stringify({ version: 1, messages: [] }), "utf8"));
      initialized = true;
    }
    return key;
  }

  async function listMessages() {
    try {
      const key = await ensureInitialized();
      const state = await client.getState(key);
      const messages = parseChatState(state, topic);
      connected = true;
      lastError = "";
      return { ok: true, messages, status: status() };
    } catch (error) {
      connected = false;
      lastError = error.message;
      options.onLog?.("debug", `Community chat lookup failed: ${error.message}`);
      return { ok: false, error: error.message, messages: [], status: status() };
    }
  }

  async function postMessage(input = {}) {
    const now = Date.now();
    if (now - lastSentAt < 900) return { ok: false, error: "Wait a moment before sending another message." };
    const text = cleanText(input.text, MAX_TEXT_BYTES);
    const authorName = cleanText(input.authorName, 40, "Player");
    if (!text) return { ok: false, error: "Write a message first." };
    const unsigned = {
      version: 1,
      id: `message-${now}-${crypto.randomBytes(8).toString("hex")}`,
      authorName,
      createdAt: now,
      text,
      authorPublicKey: identity.publicHex,
      signature: ""
    };
    const message = {
      ...unsigned,
      signature: crypto.sign(null, Buffer.from(signatureMessage(unsigned, topic), "utf8"), identity.privateKey).toString("hex")
    };
    try {
      await ensureInitialized();
      await client.putState(contractWasm, parameters, Buffer.from(JSON.stringify({ version: 1, messages: [message] }), "utf8"));
      lastSentAt = now;
      connected = true;
      lastError = "";
      options.onUpdate?.({ type: "message", message, at: now });
      return { ok: true, message, status: status() };
    } catch (error) {
      connected = false;
      lastError = error.message;
      options.onLog?.("debug", `Community chat send failed: ${error.message}`);
      return { ok: false, error: error.message, status: status() };
    }
  }

  function status() {
    return { connected, publicKey: identity.publicHex, lastError, topic };
  }

  return {
    status,
    listMessages,
    postMessage,
    close: () => client.close?.()
  };
}

module.exports = {
  CHAT_TOPIC,
  MAX_MESSAGES,
  chatParameters,
  createCommunityChat,
  parseChatState,
  signatureMessage,
  verifyMessage
};
