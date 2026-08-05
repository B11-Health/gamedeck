"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createStreamServer } = require("../stream-server");

(async () => {
  const inputs = [];
  const joins = [];
  const chat = [];
  const server = createStreamServer({
    mobileRoot: path.join(__dirname, "..", "mobile", "web"),
    onInput: (viewer, payload) => { inputs.push({ viewer, payload }); return true; },
    onCommunityRooms: async () => ({ ok: true, rooms: [{ roomId: "room-1", gameTitle: "QA Game" }] }),
    onCommunityJoin: async (_viewer, payload) => { joins.push(payload); return { ok: true, roomId: payload.roomId }; },
    onCommunityChatList: async () => ({ ok: true, messages: chat }),
    onCommunityChatSend: async (viewer, payload) => {
      const message = { id: `m-${chat.length + 1}`, authorName: payload.authorName || viewer.label, text: payload.text, createdAt: Date.now() };
      chat.push(message);
      return { ok: true, message };
    }
  });
  const status = await server.start({ port: 0, title: "QA" });
  const base = `http://127.0.0.1:${status.port}`;
  const pair = await fetch(`${base}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: status.code, label: "Android QA", controllerConnected: true })
  }).then(response => response.json());
  assert.strictEqual(pair.ok, true);
  assert.strictEqual(pair.viewer.playerIndex, 0);

  const auth = `viewerId=${encodeURIComponent(pair.viewerId)}&code=${status.code}`;
  const input = await fetch(`${base}/api/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: status.code, viewerId: pair.viewerId, events: [{ id: 8, state: 1 }], controllerConnected: true })
  }).then(response => response.json());
  assert.strictEqual(input.accepted, true);
  assert.strictEqual(inputs.length, 1);
  assert.strictEqual(inputs[0].payload.events[0].id, 8);

  const direct = server.viewerInput(pair.viewerId, { events: [{ id: 8, state: 0 }], controllerConnected: true });
  assert.strictEqual(direct.accepted, true);
  assert.strictEqual(inputs.length, 2);

  const rooms = await fetch(`${base}/api/community/rooms?${auth}`).then(response => response.json());
  assert.strictEqual(rooms.rooms[0].roomId, "room-1");
  const joined = await fetch(`${base}/api/community/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: status.code, viewerId: pair.viewerId, roomId: "room-1" })
  }).then(response => response.json());
  assert.strictEqual(joined.ok, true);
  assert.strictEqual(joins[0].roomId, "room-1");

  const posted = await fetch(`${base}/api/community/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: status.code, viewerId: pair.viewerId, authorName: "Android QA", text: "Hello" })
  }).then(response => response.json());
  assert.strictEqual(posted.message.text, "Hello");
  const listed = await fetch(`${base}/api/community/chat?${auth}`).then(response => response.json());
  assert.strictEqual(listed.messages.length, 1);

  const html = await fetch(`${base}/`).then(response => response.text());
  assert(html.includes("touchController") && html.includes("communityPanel"), "mobile gameplay/community UI must be served");
  await server.close();
  console.log("mobile stream server QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
