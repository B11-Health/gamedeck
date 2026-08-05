"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createNetplayManager } = require("../netplay-manager");

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`${label} did not become ready in ${Math.round(timeoutMs / 1000)} seconds.`);
}

(async () => {
  const runtime = process.env.GAMEDECK_RETROARCH_QA_ROOT || path.join(os.homedir(), "AppData", "Roaming", "gamedeck", "runtime", "retroarch", "RetroArch-Win64");
  const executable = path.join(runtime, "retroarch.exe");
  const corePath = path.join(runtime, "cores", "fceumm_libretro.dll");
  if (!fs.existsSync(executable) || !fs.existsSync(corePath)) throw new Error("Managed RetroArch/FCEUmm QA runtime is unavailable.");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-safe-netplay-"));
  const prg = Buffer.alloc(16 * 1024, 0xEA);
  const code = [
    0x78, 0xD8,
    0xA2, 0x40, 0x8E, 0x17, 0x40,
    0xA2, 0xFF, 0x9A, 0xE8,
    0x8E, 0x00, 0x20, 0x8E, 0x01, 0x20, 0x8E, 0x10, 0x40,
    0x2C, 0x02, 0x20, 0x10, 0xFB,
    0x2C, 0x02, 0x20, 0x10, 0xFB,
    0xA9, 0x3F, 0x8D, 0x06, 0x20,
    0xA9, 0x00, 0x8D, 0x06, 0x20,
    0xA9, 0x0F, 0x8D, 0x07, 0x20,
    0xA9, 0x30, 0x8D, 0x07, 0x20,
    0xA9, 0x08, 0x8D, 0x01, 0x20
  ];
  Buffer.from(code).copy(prg, 0);
  const loopAddress = 0xC000 + code.length;
  Buffer.from([0x4C, loopAddress & 0xFF, loopAddress >> 8]).copy(prg, code.length);
  for (const offset of [0x3FFA, 0x3FFC, 0x3FFE]) {
    prg[offset] = 0x00;
    prg[offset + 1] = 0xC0;
  }
  const header = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const game = path.join(root, "gamedeck-community-qa.nes");
  fs.writeFileSync(game, Buffer.concat([header, prg, Buffer.alloc(8 * 1024)]));
  const config = path.join(root, "headless.cfg");
  fs.writeFileSync(config, [
    `video_driver = "null"`,
    `audio_driver = "xaudio"`,
    `audio_mute_enable = "true"`,
    `video_fullscreen = "false"`,
    `pause_nonactive = "false"`,
    `network_cmd_enable = "false"`,
    `content_history_write = "false"`,
    `config_save_on_exit = "false"`,
    `save_config_on_exit = "false"`
  ].join("\n") + "\n");

  const hostUpdates = [];
  const joinUpdates = [];
  const logs = [];
  const host = createNetplayManager({
    root: path.join(root, "host"),
    appVersion: "safe-live-qa",
    onUpdate: update => hostUpdates.push(update),
    onLog: (level, message) => logs.push(`[host:${level}] ${message}`)
  });
  const guest = createNetplayManager({
    root: path.join(root, "guest"),
    appVersion: "safe-live-qa",
    onUpdate: update => joinUpdates.push(update),
    onLog: (level, message) => logs.push(`[guest:${level}] ${message}`)
  });
  const spec = {
    executable,
    baseArgs: ["--config", config],
    appendConfigs: [],
    corePath,
    coreLabel: "FCEUmm",
    contentFile: game,
    fileSize: fs.statSync(game).size,
    systemId: "nes",
    title: "GameDeck Community QA",
    maxPlayers: 2,
    relayId: process.env.GAMEDECK_NETPLAY_QA_RELAY || "nyc",
    nickname: "QA Host",
    discoverable: false
  };

  try {
    await host.host(spec);
    const hosted = await waitFor("host relay room", () => {
      const status = host.status();
      return status.active && status.phase === "ready" && status.invite ? status : null;
    }, 55000);
    await guest.join(hosted.invite, { ...spec, nickname: "QA Guest" });
    await waitFor("guest session", () => guest.status().active && guest.status().phase === "ready", 12000);
    const connectedHost = await waitFor("host player count", () => host.status().playerCount >= 2 ? host.status() : null, 40000);
    console.log(JSON.stringify({
      ok: true,
      host: { phase: connectedHost.phase, playerCount: connectedHost.playerCount, relay: connectedHost.relay?.label },
      guest: { phase: guest.status().phase, playerCount: guest.status().playerCount },
      gameBytes: fs.statSync(game).size,
      hostLog: connectedHost.logFile,
      guestLog: guest.status().logFile
    }, null, 2));
  } catch (error) {
    for (const file of [host.status().logFile, guest.status().logFile].filter(Boolean)) {
      try { console.error(`\n--- ${file} ---\n${fs.readFileSync(file, "utf8").slice(-16000)}`); } catch {}
    }
    console.error(logs.join("\n"));
    throw error;
  } finally {
    host.stop("QA complete.");
    guest.stop("QA complete.");
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
