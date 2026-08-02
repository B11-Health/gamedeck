"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const LOBBY_LIST_URL = "http://lobby.libretro.com/list";
const RELAYS = Object.freeze({
  nyc: { id: "nyc", label: "New York", address: "us-east1.relay.retroarch.com", port: 55435 },
  madrid: { id: "madrid", label: "Madrid", address: "europe-west1.relay.retroarch.com", port: 55435 },
  singapore: { id: "singapore", label: "Singapore", address: "asia-southeast1.relay.retroarch.com", port: 55435 }
});

function randomToken(bytes = 8) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function configValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function encodeInvite(payload) {
  return `GDPLAY1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function decodeInvite(value) {
  let text = String(value || "").trim();
  if (!text) throw new Error("Paste a GameDeck multiplayer invite.");
  if (/^gamedeck:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = url.searchParams.get("invite") || url.pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      throw new Error("This GameDeck invite link is malformed.");
    }
  }
  const encoded = text.startsWith("GDPLAY1.") ? text.slice("GDPLAY1.".length) : text;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload?.version !== 1 || !payload?.relay?.address || !payload?.relay?.session) {
      throw new Error("Invite data is incomplete.");
    }
    return payload;
  } catch (error) {
    if (error.message === "Invite data is incomplete.") throw error;
    throw new Error("This is not a valid GameDeck multiplayer invite.");
  }
}

function createNetplayManager(options = {}) {
  const root = path.resolve(options.root);
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  const appVersion = String(options.appVersion || "dev");
  let child = null;
  let roomTimer = null;
  let current = null;

  fs.mkdirSync(root, { recursive: true });

  function status() {
    if (!current) {
      return {
        active: false,
        phase: "idle",
        role: "",
        title: "",
        playerCount: 0,
        maxPlayers: 0,
        invite: "",
        relay: null,
        message: "Ready to host or join a game."
      };
    }
    return {
      ...current,
      active: Boolean(current.active),
      pid: child?.pid || 0
    };
  }

  function emit(extra = {}) {
    if (current) current = { ...current, ...extra, updatedAt: Date.now() };
    const value = { ...status(), ...extra, at: Date.now() };
    onUpdate(value);
    return value;
  }

  function writeConfig(id, values) {
    const file = path.join(root, `${id}.cfg`);
    const lines = Object.entries(values).map(([key, value]) => {
      if (typeof value === "boolean") return `${key} = "${value ? "true" : "false"}"`;
      return `${key} = "${configValue(value)}"`;
    });
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    return file;
  }

  function terminateProcess() {
    if (!child?.pid) return;
    const pid = child.pid;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(-pid, "SIGTERM");
      }
    } catch {
      try { process.kill(pid); } catch {}
    }
    child = null;
  }

  function clearRoomTimer() {
    if (roomTimer) clearTimeout(roomTimer);
    roomTimer = null;
  }

  function stop(reason = "Multiplayer session ended.") {
    clearRoomTimer();
    terminateProcess();
    const previous = current;
    current = null;
    const value = {
      active: false,
      phase: "idle",
      role: "",
      title: previous?.title || "",
      playerCount: 0,
      maxPlayers: 0,
      invite: "",
      relay: null,
      message: reason,
      at: Date.now()
    };
    onUpdate(value);
    return value;
  }

  function spawnSession(spec, args, id) {
    const logFile = path.join(root, `${id}.log`);
    const fullArgs = ["--verbose", `--log-file=${logFile}`, ...args];
    child = spawn(spec.executable, fullArgs, {
      cwd: path.dirname(spec.executable),
      detached: true,
      windowsHide: false,
      stdio: "ignore"
    });
    child.once("error", error => {
      onLog("error", `Multiplayer launch failed: ${error.message}`);
      emit({ active: false, phase: "error", error: error.message, message: error.message });
    });
    child.once("exit", code => {
      if (!current || current.id !== id) return;
      const message = code === 0 ? "Multiplayer game closed." : `Multiplayer game exited with code ${code}.`;
      onLog(code === 0 ? "success" : "error", message);
      stop(message);
    });
    child.unref();
    return { pid: child.pid, logFile };
  }

  async function lobbyRooms() {
    const response = await fetch(LOBBY_LIST_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": `GameDeck/${appVersion}` }
    });
    if (!response.ok) throw new Error(`RetroArch lobby returned HTTP ${response.status}.`);
    const body = await response.json();
    return (Array.isArray(body) ? body : []).map(row => row?.fields || row).filter(Boolean);
  }

  function roomForNickname(rooms, nickname, startedAt) {
    return rooms.find(room => {
      if (String(room.username || "") !== nickname) return false;
      const updated = Date.parse(room.updated || room.created || 0);
      return !updated || updated >= startedAt - 15000;
    }) || null;
  }

  async function waitForHostRoom(id, nickname, startedAt, deadline = Date.now() + 45000) {
    if (!current || current.id !== id || !current.active) return;
    try {
      const rooms = await lobbyRooms();
      const room = roomForNickname(rooms, nickname, startedAt);
      if (room?.mitm_ip && room?.mitm_session) {
        const invitePayload = {
          version: 1,
          createdAt: Date.now(),
          expiresAt: Date.now() + (12 * 60 * 60 * 1000),
          hostAppVersion: appVersion,
          title: current.title,
          systemId: current.systemId,
          fileName: current.fileName,
          fileSize: current.fileSize,
          contentSha256: current.contentSha256,
          coreSha256: current.coreSha256,
          coreFile: current.coreFile,
          coreLabel: current.coreLabel,
          password: current.password,
          maxPlayers: current.maxPlayers,
          relay: {
            id: current.relay.id,
            label: current.relay.label,
            address: String(room.mitm_ip),
            port: Number(room.mitm_port || 55435),
            session: String(room.mitm_session)
          }
        };
        const invite = encodeInvite(invitePayload);
        emit({
          phase: "ready",
          invite,
          roomId: Number(room.id || 0),
          relay: invitePayload.relay,
          playerCount: Math.max(1, Number(room.player_count || 1)),
          spectatorCount: Math.max(0, Number(room.spectator_count || 0)),
          message: "Invite ready. Share it with friends who own the same game."
        });
        onLog("success", `GameDeck multiplayer room ready for ${current.title}.`);
        monitorRoom(id, nickname);
        return;
      }
    } catch (error) {
      onLog("info", `Waiting for RetroArch relay: ${error.message}`);
    }
    if (Date.now() >= deadline) {
      const error = "The RetroArch relay did not publish this room. Try another relay region.";
      emit({ active: false, phase: "error", error, message: error });
      terminateProcess();
      return;
    }
    roomTimer = setTimeout(() => waitForHostRoom(id, nickname, startedAt, deadline), 1500);
  }

  function monitorRoom(id, nickname) {
    clearRoomTimer();
    const poll = async () => {
      if (!current || current.id !== id || !current.active || current.role !== "host") return;
      try {
        const room = roomForNickname(await lobbyRooms(), nickname, current.startedAt);
        if (room) {
          emit({
            playerCount: Math.max(1, Number(room.player_count || 1)),
            spectatorCount: Math.max(0, Number(room.spectator_count || 0)),
            message: Number(room.player_count || 1) > 1 ? "Friend connected. Game on." : current.message
          });
        }
      } catch {}
      roomTimer = setTimeout(poll, 4000);
    };
    roomTimer = setTimeout(poll, 4000);
  }

  async function host(spec = {}) {
    stop("Starting a new multiplayer room.");
    const relay = RELAYS[spec.relayId] || RELAYS.nyc;
    const id = `host-${Date.now()}-${randomToken(4)}`;
    const nickname = `GameDeck-${randomToken(5)}`.slice(0, 28);
    const password = randomToken(9);
    const startedAt = Date.now();
    const contentSha256 = spec.contentSha256 || await fileSha256(spec.contentFile);
    const coreSha256 = spec.coreSha256 || await fileSha256(spec.corePath);
    const config = writeConfig(id, {
      netplay_use_mitm_server: true,
      netplay_mitm_server: relay.id,
      netplay_public_announce: true,
      netplay_nat_traversal: true,
      netplay_ping_show: true,
      netplay_allow_pausing: false,
      netplay_max_connections: Math.max(1, Math.min(15, Number(spec.maxPlayers || 4) - 1)),
      netplay_password: password,
      netplay_spectate_password: randomToken(10)
    });
    const appendConfig = [...(spec.appendConfigs || []), config].filter(Boolean).join("|");
    const args = [
      ...spec.baseArgs,
      ...(appendConfig ? [`--appendconfig=${appendConfig}`] : []),
      "--host",
      `--nick=${nickname}`,
      "-L",
      spec.corePath,
      spec.contentFile
    ];
    const processInfo = spawnSession(spec, args, id);
    current = {
      active: true,
      id,
      role: "host",
      phase: "publishing",
      title: spec.title,
      systemId: spec.systemId,
      fileName: path.basename(spec.contentFile),
      fileSize: Number(spec.fileSize || fs.statSync(spec.contentFile).size),
      contentSha256,
      coreSha256,
      coreFile: path.basename(spec.corePath),
      coreLabel: spec.coreLabel || path.basename(spec.corePath),
      nickname,
      password,
      maxPlayers: Math.max(2, Math.min(16, Number(spec.maxPlayers || 4))),
      playerCount: 1,
      spectatorCount: 0,
      relay,
      invite: "",
      startedAt,
      pid: processInfo.pid,
      logFile: processInfo.logFile,
      message: `Opening ${spec.title} and reserving the ${relay.label} relay…`
    };
    emit();
    waitForHostRoom(id, nickname, startedAt);
    return status();
  }

  async function join(inviteValue, spec = {}) {
    const invite = decodeInvite(inviteValue);
    if (invite.expiresAt && Date.now() > Number(invite.expiresAt)) throw new Error("This GameDeck invite has expired.");
    if (String(invite.systemId) !== String(spec.systemId)) throw new Error("The installed game is for a different system.");
    if (path.basename(String(invite.coreFile || "")).toLowerCase() !== path.basename(spec.corePath).toLowerCase()) {
      throw new Error(`This room requires ${invite.coreFile}. GameDeck found ${path.basename(spec.corePath)}.`);
    }
    const contentSha256 = spec.contentSha256 || await fileSha256(spec.contentFile);
    if (String(invite.contentSha256 || "").toLowerCase() !== contentSha256.toLowerCase()) {
      throw new Error("Your game file does not exactly match the host. Netplay requires the same revision.");
    }
    const coreSha256 = spec.coreSha256 || await fileSha256(spec.corePath);
    if (invite.coreSha256 && String(invite.coreSha256).toLowerCase() !== coreSha256.toLowerCase()) {
      throw new Error("Your multiplayer core build does not match the host. Update GameDeck on both computers.");
    }
    stop("Joining a multiplayer room.");
    const id = `client-${Date.now()}-${randomToken(4)}`;
    const nickname = String(spec.nickname || `Friend-${randomToken(4)}`).slice(0, 28);
    const config = writeConfig(id, {
      netplay_password: invite.password || "",
      netplay_ping_show: true,
      netplay_allow_pausing: false
    });
    const appendConfig = [...(spec.appendConfigs || []), config].filter(Boolean).join("|");
    const args = [
      ...spec.baseArgs,
      ...(appendConfig ? [`--appendconfig=${appendConfig}`] : []),
      `--connect=${invite.relay.address}`,
      `--port=${Number(invite.relay.port || 55435)}`,
      `--mitm-session=${invite.relay.session}`,
      `--nick=${nickname}`,
      "-L",
      spec.corePath,
      spec.contentFile
    ];
    const processInfo = spawnSession(spec, args, id);
    current = {
      active: true,
      id,
      role: "client",
      phase: "connecting",
      title: invite.title || spec.title,
      systemId: spec.systemId,
      fileName: path.basename(spec.contentFile),
      fileSize: Number(spec.fileSize || fs.statSync(spec.contentFile).size),
      contentSha256,
      coreSha256,
      coreFile: path.basename(spec.corePath),
      coreLabel: spec.coreLabel || path.basename(spec.corePath),
      nickname,
      maxPlayers: Number(invite.maxPlayers || 4),
      playerCount: 0,
      spectatorCount: 0,
      relay: invite.relay,
      invite: "",
      startedAt: Date.now(),
      pid: processInfo.pid,
      logFile: processInfo.logFile,
      message: `Connecting to ${invite.title || spec.title} through ${invite.relay.label || invite.relay.address}…`
    };
    emit();
    setTimeout(() => {
      if (current?.id === id && current.active) emit({ phase: "ready", playerCount: 2, message: "Connected to the host." });
    }, 3500);
    onLog("success", `Joining GameDeck multiplayer room for ${current.title}.`);
    return status();
  }

  return {
    relays: () => Object.values(RELAYS),
    status,
    host,
    join,
    stop,
    decodeInvite,
    encodeInvite,
    fileSha256
  };
}

module.exports = {
  createNetplayManager,
  decodeInvite,
  encodeInvite,
  fileSha256,
  RELAYS
};
