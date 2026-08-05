"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  chatParameters,
  createCommunityChat,
  parseChatState,
  signatureMessage,
  verifyMessage
} = require("../community-chat");

function createMockClient() {
  const states = new Map();
  function keyFor(parameters) {
    return crypto.createHash("sha256").update(parameters).digest("hex");
  }
  return {
    async derivedContract(_wasm, parameters) { return { encoded: keyFor(parameters) }; },
    async getState(key) { return Buffer.from(states.get(key) || JSON.stringify({ version: 1, messages: [] }), "utf8"); },
    async putState(_wasm, parameters, stateBytes) {
      const key = keyFor(parameters);
      const incoming = JSON.parse(Buffer.from(stateBytes).toString("utf8"));
      const current = JSON.parse(states.get(key) || JSON.stringify({ version: 1, messages: [] }));
      const ids = new Set(current.messages.map(message => message.id));
      for (const message of incoming.messages || []) if (!ids.has(message.id)) current.messages.push(message);
      current.messages.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      current.messages = current.messages.slice(-200);
      states.set(key, JSON.stringify(current));
      return key;
    },
    async close() {},
    states
  };
}

(async () => {
  assert.strictEqual(chatParameters().length, 33, "chat parameters must bind the global topic");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-chat-unit-"));
  const client = createMockClient();
  const chat = createCommunityChat({
    root,
    contractWasmPath: path.join(__dirname, "..", "contracts", "gamedeck-chat.wasm"),
    client
  });

  const sent = await chat.postMessage({ authorName: "Player One", text: "Ready to play?" });
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(verifyMessage(sent.message), true, "signed chat message must verify");
  assert.strictEqual(verifyMessage({ ...sent.message, text: "Tampered" }), false, "tampered chat must fail verification");
  const messages = await chat.listMessages();
  assert.strictEqual(messages.ok, true);
  assert.strictEqual(messages.messages.length, 1);
  assert.strictEqual(messages.messages[0].text, "Ready to play?");
  assert.strictEqual(parseChatState({ version: 1, messages: [sent.message] }).length, 1);
  assert(signatureMessage(sent.message).includes("GDCHAT1"));

  const rateLimited = await chat.postMessage({ authorName: "Player One", text: "Again" });
  assert.strictEqual(rateLimited.ok, false, "chat should rate-limit immediate repeat messages");
  await chat.close();
  console.log("community chat unit QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
