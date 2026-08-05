"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createCommunityMatchmaking,
  normalizeMatch,
  parseRoomState,
  roomParameters,
  signatureMessage,
  verifyRoom
} = require("../community-matchmaking");
const { encodeInvite } = require("../netplay-manager");

function rawPublicHex(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("hex");
}

function signedRoom(matchInput) {
  const match = normalizeMatch(matchInput);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const room = {
    version: 1,
    roomId: "room-offline-qa",
    title: match.title,
    systemId: match.systemId,
    hostName: "Offline Host",
    maxPlayers: 4,
    playerCount: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
    invite: "GDPLAY1.dGVzdA",
    status: "open",
    hostPublicKey: rawPublicHex(publicKey),
    signature: ""
  };
  room.signature = crypto.sign(
    null,
    Buffer.from(signatureMessage(room, match), "utf8"),
    privateKey
  ).toString("hex");
  return room;
}

function createMockClient() {
  const states = new Map();
  function keyFor(parameters) {
    return crypto.createHash("sha256").update(parameters).digest("hex");
  }
  return {
    async derivedContract(_wasm, parameters) {
      return { encoded: keyFor(parameters) };
    },
    async getState(key) {
      return Buffer.from(states.get(key) || JSON.stringify({ version: 1, rooms: [] }), "utf8");
    },
    async putState(_wasm, parameters, stateBytes) {
      const key = keyFor(parameters);
      const incoming = JSON.parse(Buffer.from(stateBytes).toString("utf8"));
      const current = JSON.parse(states.get(key) || JSON.stringify({ version: 1, rooms: [] }));
      for (const room of incoming.rooms || []) {
        current.rooms = current.rooms.filter(existing =>
          existing.roomId !== room.roomId && existing.hostPublicKey !== room.hostPublicKey
        );
        current.rooms.push(room);
      }
      current.rooms.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      current.rooms = current.rooms.slice(0, 64);
      states.set(key, JSON.stringify(current));
      return key;
    },
    async close() {},
    states
  };
}

(async () => {
  const match = {
    contentSha256: crypto.createHash("sha256").update("offline-game").digest("hex"),
    coreSha256: crypto.createHash("sha256").update("offline-core").digest("hex"),
    systemId: "snes",
    title: "Offline Matchmaking QA"
  };

  assert.strictEqual(roomParameters(match).length, 65, "room parameters must bind game and core hashes");
  const room = signedRoom(match);
  assert.strictEqual(verifyRoom(room, match), true, "valid signed room should verify");
  assert.strictEqual(parseRoomState({ version: 1, rooms: [room] }, match).length, 1);
  assert.strictEqual(verifyRoom({ ...room, title: "Tampered" }, match), false, "tampered room must fail verification");
  assert.strictEqual(verifyRoom(room, { ...match, coreSha256: crypto.createHash("sha256").update("other-core").digest("hex") }), false, "room signature must bind the core hash");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-matchmaking-unit-"));
  const client = createMockClient();
  const contractWasmPath = path.join(__dirname, "..", "contracts", "gamedeck-rooms.wasm");
  const host = createCommunityMatchmaking({ root: path.join(root, "host"), contractWasmPath, client });
  const guest = createCommunityMatchmaking({ root: path.join(root, "guest"), contractWasmPath, client });
  const invite = encodeInvite({
    version: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
    title: match.title,
    systemId: match.systemId,
    fileName: "offline.sfc",
    fileSize: 1234,
    contentSha256: match.contentSha256,
    coreSha256: match.coreSha256,
    coreFile: "snes9x_libretro.dll",
    maxPlayers: 4,
    password: "offline-password",
    relay: { id: "nyc", label: "New York", address: "127.0.0.1", port: 55435, session: "offline-session" }
  });

  await host.publishRoom({ ...match, roomId: "offline-room", hostName: "Offline Host", maxPlayers: 4, playerCount: 1, invite });
  let rooms = await guest.listRooms(match);
  assert.strictEqual(rooms.length, 1, "guest should discover host through shared contract state");
  assert.strictEqual(rooms[0].hostName, "Offline Host");

  await host.updateActiveRoom(3);
  rooms = await guest.listRooms(match);
  assert.strictEqual(rooms[0].playerCount, 3, "player count update should replace the host room");

  const wrongCore = { ...match, coreSha256: crypto.createHash("sha256").update("wrong-core").digest("hex") };
  assert.strictEqual((await guest.listRooms(wrongCore)).length, 0, "different core must use a different room directory");

  await host.closeActiveRoom();
  assert.strictEqual((await guest.listRooms(match)).length, 0, "signed tombstone should remove closed room from discovery");
  await host.close();
  await guest.close();
  console.log("community matchmaking unit QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
