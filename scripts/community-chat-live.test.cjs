"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCommunityChat } = require("../community-chat");

(async () => {
  const nodeUrl = process.env.GAMEDECK_FREENET_LIVE_URL;
  if (!nodeUrl) throw new Error("Set GAMEDECK_FREENET_LIVE_URL for live chat QA.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-chat-live-"));
  const contractWasmPath = path.join(__dirname, "..", "contracts", "gamedeck-chat.wasm");
  const alpha = createCommunityChat({ root: path.join(root, "alpha"), contractWasmPath, nodeUrl });
  const beta = createCommunityChat({ root: path.join(root, "beta"), contractWasmPath, nodeUrl });
  const first = await alpha.postMessage({ authorName: "Alpha", text: "Who wants to play?" });
  assert.strictEqual(first.ok, true, first.error);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const second = await beta.postMessage({ authorName: "Beta", text: "I am ready." });
  assert.strictEqual(second.ok, true, second.error);
  const messages = await alpha.listMessages();
  assert.strictEqual(messages.ok, true, messages.error);
  assert(messages.messages.some(message => message.text === "Who wants to play?"));
  assert(messages.messages.some(message => message.text === "I am ready."));
  await alpha.close();
  await beta.close();
  console.log(`live community chat QA passed with ${messages.messages.length} signed messages`);
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
