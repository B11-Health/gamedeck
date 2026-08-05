"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCommunityMatchmaking } = require("../community-matchmaking");
const { encodeInvite } = require("../netplay-manager");

(async () => {
  const step = message => console.log(`[step] ${message}`);
  step("start");
  const nodeUrl = process.env.GAMEDECK_FREENET_LIVE_URL;
  if (!nodeUrl) throw new Error("Set GAMEDECK_FREENET_LIVE_URL for live matchmaking QA.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-rooms-live-"));
  const contractWasmPath = path.join(__dirname, "..", "contracts", "gamedeck-rooms.wasm");
  const host = createCommunityMatchmaking({ root: path.join(root, "host"), contractWasmPath, nodeUrl });
  const guest = createCommunityMatchmaking({ root: path.join(root, "guest"), contractWasmPath, nodeUrl });
  const match = {
    contentSha256: crypto.createHash("sha256").update("gamedeck-room-game").digest("hex"),
    coreSha256: crypto.createHash("sha256").update("gamedeck-room-core").digest("hex"),
    systemId: "snes",
    title: "GameDeck Room QA"
  };
  const invite = encodeInvite({
    version: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
    title: match.title,
    systemId: match.systemId,
    fileName: "room-qa.sfc",
    fileSize: 1234,
    contentSha256: match.contentSha256,
    coreSha256: match.coreSha256,
    coreFile: "snes9x_libretro.dll",
    coreLabel: "Snes9x",
    password: "qa-password",
    maxPlayers: 4,
    relay: { id: "nyc", label: "New York", address: "127.0.0.1", port: 55435, session: "qa-session" }
  });
  step("publishing room");
  const published = await host.publishRoom({
    ...match,
    roomId: "live-room-qa",
    hostName: "Host Player",
    maxPlayers: 4,
    playerCount: 1,
    invite,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000
  });
  step("room published");
  assert.strictEqual(published.status, "open");
  step("guest listing room");
  let rooms = await guest.listRooms(match);
  assert.strictEqual(rooms.length, 1, "guest should discover the compatible room");
  assert.strictEqual(rooms[0].hostName, "Host Player");
  assert.strictEqual(rooms[0].invite, invite);

  step("updating player count");
  await host.updateActiveRoom(2);
  step("guest listing updated room");
  step("guest listing closed room");
  rooms = await guest.listRooms(match);
  assert.strictEqual(rooms.length, 1);
  assert.strictEqual(rooms[0].playerCount, 2, "player count should update through the contract");

  step("checking mismatched core");
  const otherMatch = { ...match, coreSha256: crypto.createHash("sha256").update("different-core").digest("hex") };
  assert.strictEqual((await guest.listRooms(otherMatch)).length, 0, "mismatched core should use a different room directory");

  step("closing room");
  await host.closeActiveRoom();
  rooms = await guest.listRooms(match);
  assert.strictEqual(rooms.length, 0, "closed room should disappear from discovery");

  step("closing clients");
  await host.close();
  await guest.close();
  console.log("live community matchmaking QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
