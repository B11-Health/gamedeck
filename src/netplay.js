(() => {
  const DISCORD_REMOTE_PLAY_URL = 'https://discord.gg/uv2G7QPX4K';
  const RTC_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    bundlePolicy: 'max-bundle'
  };
  const BUTTON_MAP = new Map([
    [0, 0], [1, 8], [2, 1], [3, 9],
    [4, 10], [5, 11], [6, 12], [7, 13],
    [8, 2], [9, 3], [10, 14], [11, 15],
    [12, 4], [13, 5], [14, 6], [15, 7]
  ]);
  const KEY_MAP = new Map([
    ['ArrowUp', 4], ['ArrowDown', 5], ['ArrowLeft', 6], ['ArrowRight', 7],
    ['z', 0], ['x', 8], ['a', 1], ['s', 9],
    ['q', 10], ['w', 11], ['Enter', 3], ['Shift', 2]
  ]);
  const PLAY_STYLE_DETAILS = Object.freeze({
    couch: { label: 'Couch co-op', short: 'COUCH', title: 'Play together on this PC', text: 'Local controllers join automatically. No invitation or network is required.' },
    remote: { label: 'Remote Play', short: 'REMOTE', title: 'Stream the game to a friend', text: 'Only the host needs the game. Video and controller input are encrypted.' },
    sync: { label: 'Synced netplay', short: 'SYNC', title: 'Run the game on both PCs', text: 'Lowest latency. Everyone needs the matching game revision and core.' }
  });

  let remoteStatus = { active: false, phase: 'idle', title: '', playerCount: 1, maxPlayers: 0, message: 'Ready for Remote Play Together.' };
  let syncStatus = { active: false, phase: 'idle', title: '', playerCount: 0, maxPlayers: 0, message: 'Ready for synchronized netplay.' };
  let currentTab = 'host';
  let syncTab = 'host';
  let currentPlayStyle = localStorage.getItem('gamedeck.multiplayer.style') || 'remote';
  let selectedInfo = null;
  let syncInfo = null;
  let syncRelays = [];
  let syncBusy = false;
  let modalGamepadState = { buttons: [], direction: null, nextRepeat: 0 };
  let hostCapture = null;
  let hostOwnsCapture = false;
  const hostPeers = new Map();
  let guestPeer = null;
  let guestChannel = null;
  let guestInvite = null;
  let guestConnected = false;
  let guestResponse = '';
  let gamepadFrame = 0;
  let pingTimer = null;
  const lastButtons = new Map();
  const keyboardButtons = new Set();

  function selectedGame() {
    try { return typeof focusedGame === 'function' ? focusedGame() : null; }
    catch { return null; }
  }

  function multiplayerTitle(value) {
    return String(value || 'Game').replace(/\s*\((?:NGM|NGH)-[^)]+\)$/i, '');
  }

  function randomToken(bytes = 18) {
    const value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    return [...value].map(item => item.toString(16).padStart(2, '0')).join('');
  }

  async function encodeCode(prefix, payload) {
    return window.deck.remotePlayCodeEncode(prefix, payload);
  }

  async function decodeCode(value, prefixes) {
    return window.deck.remotePlayCodeDecode(value, Array.isArray(prefixes) ? prefixes : [prefixes]);
  }

  function discordCodeStatus(length) {
    const remaining = 2000 - Number(length || 0);
    return remaining >= 0
      ? `${length.toLocaleString()} characters · fits in one Discord message`
      : `${length.toLocaleString()} characters · ${Math.abs(remaining).toLocaleString()} over Discord's message limit`;
  }

  function preferRemotePlayCodecs(peer, track, sender) {
    const transceiver = peer.getTransceivers().find(item => item.sender === sender);
    if (!transceiver?.setCodecPreferences || !window.RTCRtpReceiver?.getCapabilities) return;
    const codecs = RTCRtpReceiver.getCapabilities(track.kind)?.codecs || [];
    const preferred = codecs.filter(codec => {
      const mime = String(codec.mimeType || '').toLowerCase();
      return track.kind === 'video' ? mime === 'video/vp8' : mime === 'audio/opus';
    });
    if (preferred.length) transceiver.setCodecPreferences(preferred);
  }

  function waitForIce(peer, timeout = 9000) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      let timer = null;
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', changed);
        resolve();
      };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      peer.addEventListener('icegatheringstatechange', changed);
      timer = setTimeout(finish, timeout);
    });
  }

  function connectedControllerCount() {
    const active = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
    return Math.max(active, Number(window.GameDeckInputStatus?.effectiveControllers || 0));
  }

  function recommendationForSetup() {
    const game = selectedGame();
    const controllers = connectedControllerCount();
    const remoteReady = Boolean(selectedInfo?.ok && selectedInfo.supported);
    const syncReady = Boolean(syncInfo?.ok && syncInfo.supported);
    if (!game) return { style: 'remote', title: 'Choose a game to build a session plan', text: 'GameDeck will compare local inputs, streaming support, and exact-match netplay.' };
    if (controllers >= 2) return { style: 'couch', title: 'Couch co-op is ready now', text: `${controllers} controllers are connected. Launch locally with no invite or network setup.` };
    if (syncReady) return { style: 'sync', title: 'Synced netplay is the best online route', text: 'Lowest latency and native gameplay. Your friend needs the same game and matching core ID.' };
    if (remoteReady) return { style: 'remote', title: 'Remote Play is ready for your friend', text: 'Only this PC needs the game. Send an encrypted invite after the stream starts.' };
    return { style: 'couch', title: 'Local play is available while online setup finishes', text: 'Connect another controller, or review the game/core readiness message above.' };
  }

  function renderRecommendation() {
    const recommendation = recommendationForSetup();
    const labels = { couch: 'SAME SCREEN', remote: 'NO GUEST GAME', sync: 'LOWEST LATENCY' };
    document.querySelectorAll('[data-play-style]').forEach(button => {
      const recommended = button.dataset.playStyle === recommendation.style;
      button.classList.toggle('recommended', recommended);
      const badge = button.querySelector('[data-style-badge]');
      if (badge) badge.textContent = recommended ? 'RECOMMENDED' : labels[button.dataset.playStyle];
    });
    const detail = PLAY_STYLE_DETAILS[currentPlayStyle] || PLAY_STYLE_DETAILS.remote;
    const recommendedDetail = PLAY_STYLE_DETAILS[recommendation.style] || PLAY_STYLE_DETAILS.remote;
    const selectedIsRecommended = currentPlayStyle === recommendation.style;
    $('#multiplayerCoachKicker').textContent = selectedIsRecommended
      ? 'RECOMMENDED FOR THIS SETUP'
      : `${detail.short} SELECTED · ${recommendedDetail.short} RECOMMENDED`;
    $('#multiplayerCoachTitle').textContent = selectedIsRecommended ? recommendation.title : detail.title;
    $('#multiplayerCoachText').textContent = selectedIsRecommended ? recommendation.text : detail.text;
  }

  function playerRailState() {
    const controllers = connectedControllerCount();
    const remotePlayers = activePlayerCount();
    const syncPlayers = Math.max(0, Number(syncStatus.playerCount || 0));
    const maxPlayers = Math.max(2, Math.min(4, Number(
      currentPlayStyle === 'sync' ? syncStatus.maxPlayers || syncInfo?.maxPlayers || selectedInfo?.maxPlayers || 2
        : currentPlayStyle === 'remote' ? remoteStatus.maxPlayers || selectedInfo?.maxPlayers || 2
          : selectedInfo?.maxPlayers || 2
    )));
    const readyCount = currentPlayStyle === 'couch'
      ? Math.max(1, Math.min(maxPlayers, controllers))
      : currentPlayStyle === 'sync' ? (syncStatus.active ? Math.max(1, Math.min(maxPlayers, syncPlayers)) : 1)
        : remoteStatus.active || guestPeer ? Math.max(1, Math.min(maxPlayers, remotePlayers)) : 1;
    return { controllers, maxPlayers, displaySlots: 4, readyCount };
  }

  function renderPlayerRail() {
    const { controllers, maxPlayers, displaySlots, readyCount } = playerRailState();
    const modeLabel = currentPlayStyle === 'couch' ? 'LOCAL LOBBY' : currentPlayStyle === 'sync' ? 'MATCHED LOBBY' : 'REMOTE LOBBY';
    const slots = Array.from({ length: displaySlots }, (_, index) => {
      const player = index + 1;
      const available = player <= maxPlayers;
      const ready = available && player <= readyCount;
      let label = player === 1 ? 'Host' : `Player ${player}`;
      let detail = 'Waiting';
      let state = 'WAITING';
      if (!available) {
        label = 'Locked';
        detail = `${maxPlayers}-player game`;
        state = 'LOCKED';
      } else if (player === 1) {
        label = currentPlayStyle === 'remote' && guestPeer ? 'Guest' : 'Host';
        detail = 'Ready';
        state = 'READY';
      } else if (currentPlayStyle === 'couch') {
        detail = player <= controllers ? 'Controller ready' : 'Connect controller';
        state = ready ? 'READY' : 'WAITING';
      } else if (currentPlayStyle === 'sync') {
        detail = ready ? 'Exact match' : 'Invite required';
        state = ready ? 'READY' : 'WAITING';
      } else {
        detail = ready ? 'Connected' : 'Invite required';
        state = ready ? 'READY' : 'WAITING';
      }
      return `<div class="multiplayer-player-slot ${!available ? 'locked' : ready ? 'ready' : 'waiting'}"><span>P${player}</span><div><b>${label}</b><small>${detail}</small></div><i>${state}</i></div>`;
    }).join('');
    const markup = `<div class="multiplayer-player-rail-label"><span>${modeLabel}</span><b>${Math.min(readyCount, maxPlayers)} of ${maxPlayers}</b><small>READY</small></div><div class="multiplayer-player-slots">${slots}</div>`;
    $('#multiplayerPlayerRail').innerHTML = markup;
    const activeRail = $('#multiplayerActivePlayerRail');
    if (activeRail) activeRail.innerHTML = markup;
  }

  function routeClipboardInvite(value) {
    const invite = String(value || '').trim();
    if (!invite) return toast('Clipboard is empty.', 'warning');
    if (/^GDPLAY1\./i.test(invite)) {
      currentPlayStyle = 'sync';
      syncTab = 'join';
      $('#syncJoinInvite').value = invite;
      renderPlayStyles();
      renderSyncTabs();
      $('#syncJoinInvite').focus();
      toast('Synchronized invite recognized. Ready to verify.', 'success');
      return;
    }
    if (/^GDREMOTEANSWER[12]\./i.test(invite)) {
      currentPlayStyle = 'remote';
      currentTab = 'host';
      $('#netplayAnswerInput').value = invite;
      renderAcceptAnswerAction();
      renderPlayStyles();
      renderTabs();
      $('#netplayAnswerInput').focus();
      toast('Remote Play response recognized.', 'success');
      return;
    }
    if (/^GDREMOTE[12]\./i.test(invite)) {
      currentPlayStyle = 'remote';
      currentTab = 'join';
      $('#netplayJoinInvite').value = invite;
      renderPlayStyles();
      renderTabs();
      $('#netplayJoinInvite').focus();
      toast('Remote Play invite recognized. Ready to join.', 'success');
      return;
    }
    toast('Clipboard does not contain a GameDeck multiplayer invite.', 'warning');
  }

  async function pasteMultiplayerInvite() {
    try {
      routeClipboardInvite(await window.deck.readClipboard());
    } catch (error) {
      toast(error.message || 'Clipboard could not be read.', 'warning');
    }
  }

  function modalOpen() {
    return !$('#netplayStudio').classList.contains('hidden');
  }

  function modalFocusable() {
    return [...$('#netplayStudio').querySelectorAll('button:not([disabled]):not(.netplay-backdrop), summary, input:not([disabled]), textarea:not([disabled]), select:not([disabled])')]
      .filter(element => !element.closest('.hidden') && element.offsetParent !== null);
  }

  function moveModalFocus(direction) {
    const items = modalFocusable();
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement));
    const delta = direction === 'left' || direction === 'up' ? -1 : 1;
    items[(current + delta + items.length) % items.length].focus();
  }

  function handleModalGamepad() {
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
    if (!modalOpen() || guestConnected || !pad) {
      modalGamepadState = { buttons: pad ? [...pad.buttons].map(button => button.pressed) : [], direction: null, nextRepeat: 0 };
      return;
    }
    const now = performance.now();
    const direction = pad.buttons[12]?.pressed || (pad.axes[1] || 0) < -0.65 ? 'up'
      : pad.buttons[13]?.pressed || (pad.axes[1] || 0) > 0.65 ? 'down'
      : pad.buttons[14]?.pressed || (pad.axes[0] || 0) < -0.65 ? 'left'
      : pad.buttons[15]?.pressed || (pad.axes[0] || 0) > 0.65 ? 'right' : null;
    if (direction && (direction !== modalGamepadState.direction || now >= modalGamepadState.nextRepeat)) {
      moveModalFocus(direction);
      modalGamepadState.nextRepeat = now + (direction === modalGamepadState.direction ? 145 : 330);
    }
    if (!direction) modalGamepadState.nextRepeat = 0;
    modalGamepadState.direction = direction;
    const pressed = index => Boolean(pad.buttons[index]?.pressed && !modalGamepadState.buttons[index]);
    if (pressed(0)) document.activeElement?.click();
    if (pressed(1)) closeStudio();
    if (pressed(2)) {
      const styles = ['couch', 'remote', 'sync'];
      setPlayStyle(styles[(styles.indexOf(currentPlayStyle) + 1) % styles.length], true);
    }
    modalGamepadState.buttons = [...pad.buttons].map(button => button.pressed);
  }

  function setPlayStyle(style, focus = false) {
    if (!['couch', 'remote', 'sync'].includes(style)) return;
    currentPlayStyle = style;
    localStorage.setItem('gamedeck.multiplayer.style', style);
    renderPlayStyles();
    renderRemotePlay();
    if (focus) document.querySelector(`[data-play-style="${style}"]`)?.focus();
  }

  function renderPlayStyles() {
    document.querySelectorAll('[data-play-style]').forEach(button => {
      const active = button.dataset.playStyle === currentPlayStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-style-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.stylePanel !== currentPlayStyle);
    });
    renderTabs();
    renderSyncTabs();
    renderRecommendation();
    renderPlayerRail();
  }

  function openStudio(tab = 'host', style = currentPlayStyle) {
    currentTab = tab === 'join' ? 'join' : 'host';
    if (['couch', 'remote', 'sync'].includes(style)) currentPlayStyle = style;
    $('#netplayStudio').classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderPlayStyles();
    refreshSelectedGame();
    renderRemotePlay();
    const target = currentPlayStyle === 'remote' && currentTab === 'join'
      ? $('#netplayJoinInvite')
      : document.querySelector(`[data-play-style="${currentPlayStyle}"]`);
    setTimeout(() => target?.focus(), 80);
  }

  function closeStudio() {
    $('#netplayStudio').classList.add('hidden');
    document.body.classList.remove('modal-open');
    $('#spotlightOnline')?.focus();
  }

  function renderTabs() {
    const host = currentTab === 'host';
    $('#netplayHostPanel').classList.toggle('hidden', !host);
    $('#netplayJoinPanel').classList.toggle('hidden', host);
    $('#netplayHostTab').classList.toggle('active', host);
    $('#netplayJoinTab').classList.toggle('active', !host);
    $('#netplayHostTab').setAttribute('aria-selected', String(host));
    $('#netplayJoinTab').setAttribute('aria-selected', String(!host));
  }

  function renderSyncTabs() {
    const host = syncTab === 'host';
    $('#syncHostPanel').classList.toggle('hidden', !host);
    $('#syncJoinPanel').classList.toggle('hidden', host);
    $('#syncHostTab').classList.toggle('active', host);
    $('#syncJoinTab').classList.toggle('active', !host);
    $('#syncHostTab').setAttribute('aria-selected', String(host));
    $('#syncJoinTab').setAttribute('aria-selected', String(!host));
  }

  function connectedHostPeers() {
    return [...hostPeers.values()].filter(entry => entry.peer.connectionState === 'connected' || entry.channel?.readyState === 'open').length;
  }

  function activePlayerCount() {
    if (guestConnected) return 2;
    return remoteStatus.active ? 1 + connectedHostPeers() : 0;
  }

  function updatePlayerSlots(maxPlayers) {
    const total = Math.max(2, Math.min(4, Number(maxPlayers || 2)));
    const totalSelect = $('#netplayMaxPlayers');
    totalSelect.innerHTML = Array.from({ length: total - 1 }, (_, index) => index + 2)
      .map(count => `<option value="${count}">${count} players</option>`).join('');
    totalSelect.value = String(total);
    const slotSelect = $('#netplayPlayerSlot');
    slotSelect.innerHTML = Array.from({ length: total - 1 }, (_, index) => index + 1)
      .map(index => `<option value="${index}">Player ${index + 1}</option>`).join('');
  }

  function updateSyncPlayerSlots(maxPlayers) {
    const total = Math.max(2, Math.min(4, Number(maxPlayers || 2)));
    const select = $('#syncMaxPlayers');
    select.innerHTML = Array.from({ length: total - 1 }, (_, index) => index + 2)
      .map(count => `<option value="${count}">${count} players</option>`).join('');
    select.value = String(total);
  }

  function renderReadiness() {
    const game = selectedGame();
    const controllers = connectedControllerCount();
    const coreReady = Boolean(syncInfo?.ok && syncInfo.supported);
    const cards = [
      { tone: game ? 'ready' : 'loading', label: 'GAME', value: game ? 'Installed' : 'Select a title' },
      { tone: syncInfo ? (coreReady ? 'ready' : 'issue') : 'loading', label: 'CORE', value: syncInfo ? (coreReady ? syncInfo.coreLabel : 'Needs attention') : 'Checking' },
      { tone: controllers >= 2 ? 'ready' : 'attention', label: 'INPUT', value: controllers >= 2 ? `${controllers} controllers` : controllers === 1 ? '1 controller' : 'Keyboard only' }
    ];
    $('#multiplayerReadiness').innerHTML = cards.map(item => `<div class="readiness-chip ${item.tone}"><span aria-hidden="true"></span><small>${escapeHtml(item.label)}</small><b>${escapeHtml(item.value)}</b></div>`).join('');
    const couchCapacity = Math.max(2, Math.min(4, Number(selectedInfo?.maxPlayers || 2)));
    $('#multiplayerControllers').innerHTML = Array.from({ length: couchCapacity }, (_, index) => {
      const player = index + 1;
      const ready = player === 1 || controllers >= player;
      const detail = player === 1 && controllers < 1 ? 'Keyboard ready' : ready ? 'Controller connected' : 'Connect controller';
      return `<div class="controller-slot ${ready ? 'ready' : 'waiting'}"><span>P${player}</span><div><b>Player ${player}</b><small>${detail}</small></div><i>${ready ? 'READY' : 'WAITING'}</i></div>`;
    }).join('');
    $('#multiplayerMatchPill').classList.toggle('verified', coreReady);
    renderRecommendation();
    renderPlayerRail();
  }

  async function refreshSelectedGame() {
    const game = selectedGame();
    selectedInfo = null;
    syncInfo = null;
    const card = $('#netplayGameCard');
    const art = $('#netplayGameArt');
    if (!game) {
      $('#netplayGameTitle').textContent = 'Select a game from your library';
      $('#netplayGameMeta').textContent = 'Choose a multiplayer game before opening this command center.';
      $('#multiplayerMatchId').textContent = 'Waiting for game';
      $('#multiplayerCopyMatch').disabled = true;
      art.textContent = 'P1';
      $('#netplayHost').disabled = true;
      $('#syncHost').disabled = true;
      $('#multiplayerCouchLaunch').disabled = true;
      card.classList.add('unsupported');
      updatePlayerSlots(2);
      updateSyncPlayerSlots(2);
      renderReadiness();
      renderRemotePlay();
      return;
    }

    $('#netplayGameTitle').textContent = multiplayerTitle(game.title);
    $('#netplayGameMeta').textContent = 'Checking game, core, and multiplayer routes…';
    $('#multiplayerMatchId').textContent = 'Calculating local match IDs…';
    art.textContent = '';
    const artUrl = game.art || (typeof gameArt === 'function' ? gameArt(game) : '');
    if (artUrl) {
      const image = document.createElement('img');
      image.src = artUrl;
      image.alt = '';
      art.appendChild(image);
    } else {
      art.textContent = String(game.title || 'P1').slice(0, 2).toUpperCase();
    }
    $('#netplayHost').disabled = true;
    $('#syncHost').disabled = true;
    $('#multiplayerCouchLaunch').disabled = true;

    try {
      const [basic, match] = await Promise.all([
        window.deck.netplayGameInfo(game.file),
        window.deck.netplayMatchInfo(game.file)
      ]);
      selectedInfo = basic;
      syncInfo = match;
      const supported = Boolean(basic?.ok && basic.supported);
      const verified = Boolean(match?.ok && match.supported);
      card.classList.toggle('unsupported', !supported);
      if (supported) {
        const coreLabel = match?.coreLabel || basic.coreFile || 'Libretro core';
        const meta = [basic.systemName, `${Math.min(4, basic.maxPlayers)}-player game`];
        if (coreLabel && coreLabel !== basic.systemName) meta.push(coreLabel);
        $('#netplayGameMeta').textContent = meta.join(' · ');
      } else {
        $('#netplayGameMeta').textContent = basic?.issue || 'This game is not yet supported for multiplayer.';
      }
      $('#multiplayerMatchId').textContent = verified
        ? `GAME ${match.matchId} · CORE ${match.coreMatchId}`
        : match?.issue || 'Exact-match netplay unavailable';
      $('#multiplayerCopyMatch').disabled = !verified;
      updatePlayerSlots(basic?.maxPlayers || 2);
      updateSyncPlayerSlots(match?.maxPlayers || basic?.maxPlayers || 2);
      $('#netplayHost').disabled = !supported || remoteStatus.active || syncStatus.active;
      $('#syncHost').disabled = !verified || remoteStatus.active || syncStatus.active;
      $('#multiplayerCouchLaunch').disabled = false;
    } catch (error) {
      card.classList.add('unsupported');
      $('#netplayGameMeta').textContent = error.message || 'Multiplayer compatibility check failed.';
      $('#multiplayerMatchId').textContent = 'Verification unavailable';
      $('#multiplayerCopyMatch').disabled = true;
    }
    renderReadiness();
    renderRemotePlay();
  }

  function renderAcceptAnswerAction() {
    const button = $('#netplayAcceptAnswer');
    if (!button) return;
    const hasResponse = Boolean($('#netplayAnswerInput')?.value.trim());
    button.classList.toggle('hidden', !remoteStatus.active || !hasResponse);
  }

  function renderRemotePlay() {
    const hostActive = Boolean(remoteStatus.active);
    const guestActive = Boolean(guestPeer);
    const syncActive = Boolean(syncStatus.active);
    const active = hostActive || guestActive || syncActive;
    const hasError = remoteStatus.phase === 'error' || syncStatus.phase === 'error';
    const commandWindow = document.querySelector('.multiplayer-command-window');
    commandWindow?.classList.toggle('session-active', active);
    commandWindow?.classList.toggle('session-sync', syncActive);
    commandWindow?.classList.toggle('session-remote', hostActive || guestActive);
    commandWindow?.classList.toggle('session-guest', guestActive);
    if (commandWindow) commandWindow.scrollTop = 0;
    const count = syncActive ? Math.max(1, Number(syncStatus.playerCount || 1)) : activePlayerCount();
    $('#netplayActive').classList.toggle('hidden', !active && !hasError);

    if (syncActive || syncStatus.phase === 'error') {
      $('#netplayActiveRole').textContent = syncStatus.phase === 'error'
        ? 'SYNCHRONIZED NETPLAY ISSUE'
        : syncStatus.role === 'host' ? 'HOSTING SYNCHRONIZED NETPLAY' : 'CONNECTED WITH MATCHING GAME';
      $('#netplayActiveTitle').textContent = syncStatus.title || selectedGame()?.title || 'Synchronized netplay';
      $('#netplayActiveMessage').textContent = syncStatus.error || syncStatus.message || 'Preparing the exact-match session…';
    } else {
      $('#netplayActiveRole').textContent = guestActive
        ? guestConnected ? 'CONNECTED AS REMOTE PLAYER' : 'WAITING FOR HOST RESPONSE'
        : hostActive ? 'HOSTING REMOTE PLAY TOGETHER' : remoteStatus.phase === 'error' ? 'REMOTE PLAY ISSUE' : 'REMOTE PLAY STATUS';
      $('#netplayActiveTitle').textContent = guestInvite?.title || remoteStatus.title || (remoteStatus.phase === 'error' ? 'Session could not start' : 'Preparing multiplayer');
      $('#netplayActiveMessage').textContent = remoteStatus.error || (guestActive
        ? guestConnected ? 'Video and controller input are connected directly to the host.' : 'Send the response code to the host, then keep this window open.'
        : remoteStatus.message || 'Ready for Remote Play Together.');
    }

    $('#netplayPlayerCount').textContent = String(count || (active ? 1 : 0));
    const countLabel = $('#netplayPlayerCount')?.nextElementSibling;
    if (countLabel) countLabel.textContent = Number(count || (active ? 1 : 0)) === 1 ? 'PLAYER' : 'PLAYERS';
    $('#netplayStop').classList.toggle('hidden', !active);
    $('#netplayHostTools').classList.toggle('hidden', !hostActive);
    renderAcceptAnswerAction();
    $('#netplayHost').classList.toggle('hidden', hostActive);
    $('#netplayHost').disabled = hostActive || syncActive || !selectedInfo?.supported;
    $('#syncHost').disabled = syncBusy || hostActive || guestActive || syncActive || !syncInfo?.supported;
    $('#syncJoin').disabled = syncBusy || hostActive || guestActive || syncActive;
    $('#multiplayerCouchLaunch').disabled = !selectedGame();

    const progressVisible = syncActive || syncStatus.phase === 'error';
    $('#syncProgress').classList.toggle('hidden', !progressVisible);
    $('#syncProgressTitle').textContent = syncStatus.phase === 'error' ? 'Session could not start'
      : syncStatus.phase === 'ready' ? 'Room ready'
      : syncStatus.role === 'client' ? 'Connecting to host…' : 'Publishing room…';
    $('#syncProgressMessage').textContent = syncStatus.error || syncStatus.message || 'RetroArch is reserving a relay session.';
    const invite = String(syncStatus.invite || '');
    $('#syncInvite').classList.toggle('hidden', !invite);
    if (invite) {
      $('#syncInviteValue').value = invite;
      $('#syncInviteMeta').textContent = `${invite.length.toLocaleString()} characters · exact game and core required`;
    }

    const header = $('#netplayToggle');
    header.classList.toggle('active', active);
    header.setAttribute('aria-pressed', String(active));
    $('#netplayButtonLabel').textContent = active
      ? syncActive ? 'Netplay Live' : guestConnected ? 'Playing Online' : hostActive ? 'Room Live' : 'Pairing'
      : 'Multiplayer';
    $('#headerPlayerCount').textContent = String(count || 0);
    renderReadiness();
  }

  function closeHostPeer(playerIndex) {
    const entry = hostPeers.get(playerIndex);
    if (!entry) return;
    try { entry.channel?.close(); } catch {}
    try { entry.peer.close(); } catch {}
    hostPeers.delete(playerIndex);
    renderRemotePlay();
  }

  function setHostChannel(playerIndex, entry, channel) {
    entry.channel = channel;
    channel.onopen = () => {
      entry.connected = true;
      renderRemotePlay();
      toast(`${entry.name || `Player ${playerIndex + 1}`} connected.`, 'success');
    };
    channel.onclose = () => {
      entry.connected = false;
      renderRemotePlay();
    };
    channel.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.token !== entry.token) return;
        if (message.type === 'hello') {
          entry.name = String(message.name || `Player ${playerIndex + 1}`).slice(0, 32);
          renderRemotePlay();
          return;
        }
        if (message.type === 'input' && Array.isArray(message.events)) {
          window.deck.remotePlayInput({
            sessionId: remoteStatus.sessionId,
            playerIndex,
            events: message.events
          });
          return;
        }
        if (message.type === 'ping') {
          channel.send(JSON.stringify({ type: 'pong', token: entry.token, sentAt: message.sentAt }));
        }
      } catch {}
    };
  }

  async function createHostInvite(playerIndex = Number($('#netplayPlayerSlot').value || 1)) {
    if (!remoteStatus.active || !hostCapture) throw Error('Start Remote Play Together first.');
    if (playerIndex < 1 || playerIndex >= remoteStatus.maxPlayers) throw Error('Choose an available remote player slot.');
    closeHostPeer(playerIndex);
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const token = randomToken();
    const entry = { peer, token, channel: null, name: `Player ${playerIndex + 1}`, connected: false };
    hostPeers.set(playerIndex, entry);
    for (const track of hostCapture.getTracks()) {
      const sender = peer.addTrack(track, hostCapture);
      preferRemotePlayCodecs(peer, track, sender);
    }
    setHostChannel(playerIndex, entry, peer.createDataChannel('gamedeck-controls', { ordered: true }));
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) entry.connected = false;
      renderRemotePlay();
    };
    const offer = await peer.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await peer.setLocalDescription(offer);
    await waitForIce(peer);
    const payload = {
      version: 1,
      createdAt: Date.now(),
      expiresAt: Date.now() + (20 * 60 * 1000),
      sessionId: remoteStatus.sessionId,
      token,
      playerIndex,
      title: remoteStatus.title,
      maxPlayers: remoteStatus.maxPlayers,
      description: { type: peer.localDescription.type, sdp: peer.localDescription.sdp }
    };
    entry.invite = await encodeCode('GDREMOTE2', payload);
    $('#netplayInviteValue').value = entry.invite;
    $('#netplayInviteMeta').textContent = discordCodeStatus(entry.invite.length);
    $('#netplayInvite').classList.remove('hidden');
    $('#netplayAnswerInput').value = '';
    toast(`Player ${playerIndex + 1} invitation ready.`, 'success');
    return entry.invite;
  }

  async function acceptHostAnswer() {
    const payload = await decodeCode($('#netplayAnswerInput').value, ['GDREMOTEANSWER2', 'GDREMOTEANSWER1']);
    if (payload.sessionId !== remoteStatus.sessionId) throw Error('This response belongs to a different Remote Play session.');
    const entry = hostPeers.get(Number(payload.playerIndex));
    if (!entry || payload.token !== entry.token) throw Error('This response does not match the active player invitation.');
    await entry.peer.setRemoteDescription(payload.description);
    entry.name = String(payload.name || entry.name).slice(0, 32);
    toast(`${entry.name} response accepted. Connecting…`, 'success');
    renderRemotePlay();
  }

  async function startHost() {
    const game = selectedGame();
    if (!game || !selectedInfo?.supported) return toast(selectedInfo?.issue || 'Select a supported game first.', 'warning');
    if (syncStatus.active) await endSyncSession(true);
    currentPlayStyle = 'remote';
    const button = $('#netplayHost');
    button.disabled = true;
    button.querySelector('b').textContent = 'Launching game and capture…';
    try {
      const result = await window.deck.remotePlayStart(game.file, { maxPlayers: Number($('#netplayMaxPlayers').value || selectedInfo.maxPlayers || 2) });
      if (!result?.ok) throw Error(result?.error || 'Remote Play Together could not start.');
      remoteStatus = result.status || remoteStatus;
      renderRemotePlay();
      hostCapture = await window.GameDeckLive.startForRemote({
        title: `${game.title} · Remote Play Together`,
        quality: $('#netplayQuality').value,
        audio: true
      });
      hostOwnsCapture = true;
      await createHostInvite(1);
      toast('Game is live. Send the player invitation in Discord.', 'success');
    } catch (error) {
      await window.deck.remotePlayStop().catch(() => {});
      if (hostOwnsCapture) await window.GameDeckLive.stop().catch(() => {});
      hostCapture = null;
      hostOwnsCapture = false;
      remoteStatus = { active: false, phase: 'error', error: error.message, message: error.message, playerCount: 1, maxPlayers: 0 };
      toast(error.message || 'Remote Play Together could not start.', 'warning');
    } finally {
      button.querySelector('b').textContent = 'Start Remote Play Together';
      renderRemotePlay();
    }
  }

  function stopGuest() {
    cancelAnimationFrame(gamepadFrame);
    gamepadFrame = 0;
    clearInterval(pingTimer);
    pingTimer = null;
    try { guestChannel?.close(); } catch {}
    try { guestPeer?.close(); } catch {}
    guestChannel = null;
    guestPeer = null;
    guestInvite = null;
    guestConnected = false;
    guestResponse = '';
    lastButtons.clear();
    keyboardButtons.clear();
    $('#netplayRemoteVideo').srcObject = null;
    $('#netplayRemoteStage').classList.add('hidden');
    $('#netplayRemoteEmpty').classList.remove('hidden');
    $('#netplayJoinResponse').classList.add('hidden');
    $('#netplayJoinResponseValue').value = '';
  }

  function sendGuestMessage(message) {
    if (!guestChannel || guestChannel.readyState !== 'open' || !guestInvite) return false;
    guestChannel.send(JSON.stringify({ ...message, token: guestInvite.token }));
    return true;
  }

  function sendInputEvents(events) {
    if (events.length) sendGuestMessage({ type: 'input', events });
  }

  function gamepadStates(gamepad) {
    const states = new Map();
    for (const [source, target] of BUTTON_MAP) states.set(target, Boolean(gamepad?.buttons?.[source]?.pressed));
    if (gamepad?.axes?.length >= 2) {
      states.set(6, states.get(6) || gamepad.axes[0] < -0.45);
      states.set(7, states.get(7) || gamepad.axes[0] > 0.45);
      states.set(4, states.get(4) || gamepad.axes[1] < -0.45);
      states.set(5, states.get(5) || gamepad.axes[1] > 0.45);
    }
    return states;
  }

  function pollGamepad() {
    if (!guestPeer) return;
    const gamepad = [...navigator.getGamepads()].find(Boolean);
    const states = gamepadStates(gamepad);
    const events = [];
    for (let id = 0; id < 16; id += 1) {
      const pressed = Boolean(states.get(id));
      if (lastButtons.get(id) === pressed) continue;
      lastButtons.set(id, pressed);
      events.push({ id, state: pressed ? 1 : 0 });
    }
    sendInputEvents(events);
    const guide = document.querySelector('.netplay-controller-guide b');
    if (guide) guide.textContent = gamepad ? `${gamepad.id.split('(')[0].trim()} connected` : 'Keyboard controls active';
    gamepadFrame = requestAnimationFrame(pollGamepad);
  }

  function setGuestChannel(channel) {
    guestChannel = channel;
    channel.onopen = () => {
      guestConnected = true;
      sendGuestMessage({ type: 'hello', name: $('#netplayNickname').value.trim() || 'Friend' });
      $('#netplayRemoteEmpty').querySelector('b').textContent = 'Connected — press a button';
      renderRemotePlay();
      cancelAnimationFrame(gamepadFrame);
      gamepadFrame = requestAnimationFrame(pollGamepad);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => sendGuestMessage({ type: 'ping', sentAt: performance.now() }), 2000);
      toast('Connected to the host. Your controller is Player ' + (guestInvite.playerIndex + 1) + '.', 'success');
    };
    channel.onclose = () => {
      guestConnected = false;
      renderRemotePlay();
    };
    channel.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.token !== guestInvite?.token) return;
        if (message.type === 'pong') {
          const latency = Math.max(0, Math.round(performance.now() - Number(message.sentAt || performance.now())));
          $('#netplayLatency').textContent = `DIRECT · ${latency} MS`;
        }
      } catch {}
    };
  }

  async function createGuestResponse() {
    if (syncStatus.active) await endSyncSession(true);
    currentPlayStyle = 'remote';
    const invite = await decodeCode($('#netplayJoinInvite').value, ['GDREMOTE2', 'GDREMOTE1']);
    stopGuest();
    guestInvite = invite;
    guestPeer = new RTCPeerConnection(RTC_CONFIG);
    guestPeer.ontrack = event => {
      const video = $('#netplayRemoteVideo');
      video.srcObject = event.streams[0];
      video.play().catch(() => {});
      $('#netplayRemoteStage').classList.remove('hidden');
      $('#netplayRemoteEmpty').classList.add('hidden');
    };
    guestPeer.ondatachannel = event => setGuestChannel(event.channel);
    guestPeer.onconnectionstatechange = () => {
      if (guestPeer?.connectionState === 'connected') guestConnected = true;
      if (['failed', 'closed', 'disconnected'].includes(guestPeer?.connectionState)) guestConnected = false;
      renderRemotePlay();
    };
    await guestPeer.setRemoteDescription(invite.description);
    const answer = await guestPeer.createAnswer();
    await guestPeer.setLocalDescription(answer);
    await waitForIce(guestPeer);
    guestResponse = await encodeCode('GDREMOTEANSWER2', {
      version: 1,
      createdAt: Date.now(),
      expiresAt: invite.expiresAt,
      sessionId: invite.sessionId,
      token: invite.token,
      playerIndex: invite.playerIndex,
      name: $('#netplayNickname').value.trim() || 'Friend',
      description: { type: guestPeer.localDescription.type, sdp: guestPeer.localDescription.sdp }
    });
    $('#netplayJoinResponseValue').value = guestResponse;
    $('#netplayResponseMeta').textContent = discordCodeStatus(guestResponse.length);
    $('#netplayJoinResponse').classList.remove('hidden');
    $('#netplayRemoteStage').classList.remove('hidden');
    $('#netplayRemoteEmpty').classList.remove('hidden');
    $('#netplayRemoteEmpty').querySelector('span').textContent = `P${invite.playerIndex + 1}`;
    $('#netplayRemoteEmpty').querySelector('b').textContent = 'Waiting for the host response';
    $('#netplayLatency').textContent = 'DIRECT · PAIRING';
    remoteStatus = { active: false, phase: 'pairing', title: invite.title, playerCount: 1, maxPlayers: invite.maxPlayers, message: 'Send the response code to the host.' };
    renderRemotePlay();
    toast('Response ready. Send it back to the host in Discord.', 'success');
  }

  async function endSession(silent = false) {
    for (const playerIndex of [...hostPeers.keys()]) closeHostPeer(playerIndex);
    stopGuest();
    if (remoteStatus.active) await window.deck.remotePlayStop().catch(() => {});
    if (hostOwnsCapture) await window.GameDeckLive.stop().catch(() => {});
    hostCapture = null;
    hostOwnsCapture = false;
    remoteStatus = { active: false, phase: 'idle', title: '', playerCount: 1, maxPlayers: 0, message: 'Remote Play Together ended.' };
    $('#netplayHostTools').classList.add('hidden');
    $('#netplayInvite').classList.add('hidden');
    renderRemotePlay();
    if (!silent) {
      refreshSelectedGame();
      toast('Remote Play Together ended.', 'success');
    }
  }

  async function endSyncSession(silent = false) {
    if (syncStatus.active || syncStatus.phase === 'error') await window.deck.netplayStop().catch(() => {});
    syncStatus = { active: false, phase: 'idle', title: '', playerCount: 0, maxPlayers: 0, message: 'Synchronized netplay ended.' };
    syncBusy = false;
    $('#syncInvite').classList.add('hidden');
    $('#syncInviteValue').value = '';
    renderRemotePlay();
    if (!silent) {
      refreshSelectedGame();
      toast('Synchronized netplay ended.', 'success');
    }
  }

  async function endActiveSession() {
    if (syncStatus.active || syncStatus.phase === 'error') return endSyncSession();
    return endSession();
  }

  async function launchCouchCoop() {
    const game = selectedGame();
    if (!game) return toast('Select a game first.', 'warning');
    if (syncStatus.active) await endSyncSession(true);
    if (remoteStatus.active || guestPeer) await endSession(true);
    const controllers = connectedControllerCount();
    if (controllers < 2) toast('Launching with one local input. Connect player two in RetroArch when ready.', 'warning');
    const button = $('#multiplayerCouchLaunch');
    button.disabled = true;
    button.querySelector('b').textContent = 'Launching couch co-op…';
    try {
      const result = await window.deck.launch(game.file);
      if (!result?.ok) throw Error(result?.error || 'The game could not launch.');
      toast('Couch co-op launched.', 'success');
      closeStudio();
    } catch (error) {
      toast(error.message || 'Couch co-op could not launch.', 'warning');
    } finally {
      button.querySelector('b').textContent = 'Launch couch co-op';
      button.disabled = false;
    }
  }

  async function startSyncHost() {
    const game = selectedGame();
    if (!game || !syncInfo?.supported) return toast(syncInfo?.issue || 'Select a verified netplay game first.', 'warning');
    if (remoteStatus.active || guestPeer) await endSession(true);
    syncBusy = true;
    currentPlayStyle = 'sync';
    syncTab = 'host';
    renderPlayStyles();
    renderRemotePlay();
    const button = $('#syncHost');
    button.querySelector('b').textContent = 'Opening synchronized room…';
    try {
      const result = await window.deck.netplayHost(game.file, {
        relayId: $('#syncRelay').value || 'nyc',
        maxPlayers: Number($('#syncMaxPlayers').value || syncInfo.maxPlayers || 2)
      });
      if (!result?.ok) throw Error(result?.error || 'The synchronized room could not start.');
      syncStatus = result.status || syncStatus;
      toast('Game launched. GameDeck is preparing the relay invitation.', 'success');
    } catch (error) {
      syncStatus = { active: false, phase: 'error', error: error.message, message: error.message, playerCount: 0, maxPlayers: 0 };
      toast(error.message || 'Synchronized netplay could not start.', 'warning');
    } finally {
      syncBusy = false;
      button.querySelector('b').textContent = 'Create synchronized room';
      renderRemotePlay();
    }
  }

  async function joinSyncRoom() {
    const invite = $('#syncJoinInvite').value.trim();
    if (!invite) return toast('Paste the host invitation first.', 'warning');
    if (remoteStatus.active || guestPeer) await endSession(true);
    syncBusy = true;
    currentPlayStyle = 'sync';
    syncTab = 'join';
    renderPlayStyles();
    renderRemotePlay();
    const button = $('#syncJoin');
    button.querySelector('b').textContent = 'Verifying game and core…';
    try {
      const game = selectedGame();
      const result = await window.deck.netplayJoin(invite, game?.file || '', { nickname: $('#syncNickname').value.trim() || 'Player 2' });
      if (!result?.ok) throw Error(result?.error || 'The synchronized room could not be joined.');
      syncStatus = result.status || syncStatus;
      toast('Exact match verified. Connecting to the host.', 'success');
    } catch (error) {
      syncStatus = { active: false, phase: 'error', error: error.message, message: error.message, playerCount: 0, maxPlayers: 0 };
      toast(error.message || 'The synchronized room could not be joined.', 'warning');
    } finally {
      syncBusy = false;
      button.querySelector('b').textContent = 'Verify and join';
      renderRemotePlay();
    }
  }

  $('#netplayToggle').onclick = () => {
    const style = syncStatus.active ? 'sync' : remoteStatus.active || guestPeer ? 'remote' : currentPlayStyle;
    openStudio(style === 'remote' && guestPeer ? 'join' : 'host', style);
  };
  $('#spotlightOnline').onclick = () => openStudio('host', currentPlayStyle);
  $('#netplayClose').onclick = closeStudio;
  document.querySelector('[data-netplay-close]').onclick = closeStudio;
  document.querySelectorAll('[data-play-style]').forEach(button => {
    button.onclick = () => setPlayStyle(button.dataset.playStyle, true);
  });
  document.querySelectorAll('[data-netplay-tab]').forEach(button => {
    button.onclick = () => {
      currentTab = button.dataset.netplayTab;
      renderTabs();
      renderRemotePlay();
    };
  });
  document.querySelectorAll('[data-sync-tab]').forEach(button => {
    button.onclick = () => {
      syncTab = button.dataset.syncTab;
      renderSyncTabs();
      renderRemotePlay();
    };
  });
  $('#netplayHost').onclick = startHost;
  $('#netplayCreateInvite').onclick = () => createHostInvite().catch(error => toast(error.message, 'warning'));
  $('#netplayAnswerInput').addEventListener('input', renderAcceptAnswerAction);
  $('#netplayAcceptAnswer').onclick = () => acceptHostAnswer().catch(error => toast(error.message, 'warning'));
  $('#netplayJoin').onclick = () => createGuestResponse().catch(error => {
    stopGuest();
    toast(error.message || 'The Remote Play invitation could not be opened.', 'warning');
  });
  $('#multiplayerPasteInvite').onclick = pasteMultiplayerInvite;
  $('#multiplayerCopyMatch').onclick = async () => {
    if (!syncInfo?.supported) return;
    const game = selectedGame();
    const value = `${multiplayerTitle(game?.title)} | GAME ${syncInfo.matchId} | CORE ${syncInfo.coreMatchId}`;
    await window.deck.copyText(value);
    toast('Game and core match IDs copied.', 'success');
  };
  $('#multiplayerCouchLaunch').onclick = launchCouchCoop;
  $('#syncHost').onclick = startSyncHost;
  $('#syncJoin').onclick = joinSyncRoom;
  $('#netplayStop').onclick = endActiveSession;
  $('#syncCopyInvite').onclick = async () => {
    const value = $('#syncInviteValue').value;
    if (!value) return;
    await window.deck.copyText(value);
    toast('Same-game invitation copied.', 'success');
  };
  $('#syncShareInvite').onclick = async () => {
    const value = $('#syncInviteValue').value;
    if (!value) return;
    const title = String(syncStatus.title || selectedGame()?.title || 'GameDeck netplay').slice(0, 80);
    const message = `🎮 ${title} · exact-match GameDeck invitation\n${value}\nBoth players need the matching game and core.`;
    await window.deck.copyText(message.length <= 2000 ? message : value);
    const opened = await window.deck.openExternal(DISCORD_REMOTE_PLAY_URL);
    toast(opened?.ok ? 'Invite copied. Paste it in #remote-play.' : 'Invite copied. Open #remote-play when Discord is available.', opened?.ok ? 'success' : 'warning');
  };
  $('#netplayCopyInvite').onclick = async () => {
    const value = $('#netplayInviteValue').value;
    if (!value) return;
    await window.deck.copyText(value);
    toast('Encrypted player invitation copied.', 'success');
  };
  $('#netplayShareInvite').onclick = async () => {
    const value = $('#netplayInviteValue').value;
    if (!value) return;
    const player = Number($('#netplayPlayerSlot').value || 1) + 1;
    const title = String(remoteStatus.title || 'GameDeck Remote Play').slice(0, 80);
    const message = `🎮 ${title} · Player ${player} invite\n${value}\nPaste into GameDeck → Play Online → Join a friend.`;
    await window.deck.copyText(message.length <= 2000 ? message : value);
    const opened = await window.deck.openExternal(DISCORD_REMOTE_PLAY_URL);
    toast(opened?.ok ? 'Discord message copied. Paste it in #remote-play.' : 'Message copied. Open #remote-play when Discord is available.', opened?.ok ? 'success' : 'warning');
  };
  $('#netplayCopyResponse').onclick = async () => {
    if (!guestResponse) return;
    await window.deck.copyText(guestResponse);
    toast('Join response copied. Send it to the host.', 'success');
  };
  $('#netplayShareResponse').onclick = async () => {
    if (!guestResponse) return;
    const title = String(guestInvite?.title || 'GameDeck Remote Play').slice(0, 80);
    const message = `✅ ${title} · join response\n${guestResponse}\nHost: paste this into the response field and connect the player.`;
    await window.deck.copyText(message.length <= 2000 ? message : guestResponse);
    const opened = await window.deck.openExternal(DISCORD_REMOTE_PLAY_URL);
    toast(opened?.ok ? 'Response copied. Paste it in #remote-play.' : 'Response copied. Open #remote-play when Discord is available.', opened?.ok ? 'success' : 'warning');
  };

  document.addEventListener('keydown', event => {
    if (modalOpen()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStudio();
        return;
      }
      if (!guestConnected) {
        if (event.key === 'Tab') {
          const items = modalFocusable();
          if (items.length) {
            event.preventDefault();
            const current = Math.max(0, items.indexOf(document.activeElement));
            const next = (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
            items[next].focus();
          }
          return;
        }
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          document.activeElement?.click();
          return;
        }
        const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
        if (direction) {
          event.preventDefault();
          moveModalFocus(direction);
        }
        return;
      }
    }
    if (!guestConnected || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const id = KEY_MAP.get(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    if (id === undefined || keyboardButtons.has(id)) return;
    keyboardButtons.add(id);
    event.preventDefault();
    sendInputEvents([{ id, state: 1 }]);
  });
  document.addEventListener('keyup', event => {
    if (!guestConnected || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const id = KEY_MAP.get(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    if (id === undefined || !keyboardButtons.has(id)) return;
    keyboardButtons.delete(id);
    event.preventDefault();
    sendInputEvents([{ id, state: 0 }]);
  });
  window.addEventListener('blur', () => {
    const events = [...keyboardButtons].map(id => ({ id, state: 0 }));
    keyboardButtons.clear();
    sendInputEvents(events);
  });

  window.deck.onRemotePlay(update => {
    if (!guestPeer) remoteStatus = { ...remoteStatus, ...update };
    if (remoteStatus.active) currentPlayStyle = 'remote';
    renderPlayStyles();
    renderRemotePlay();
  });

  window.deck.onNetplay(update => {
    syncStatus = { ...syncStatus, ...update };
    if (syncStatus.active || syncStatus.phase === 'error') currentPlayStyle = 'sync';
    renderPlayStyles();
    renderRemotePlay();
    if (syncStatus.invite && modalOpen()) $('#syncCopyInvite')?.focus();
  });

  window.GameDeckMultiplayer = {
    open: (style = currentPlayStyle) => openStudio('host', style),
    close: closeStudio,
    refresh: refreshSelectedGame
  };

  setInterval(handleModalGamepad, 90);
  setInterval(() => { if (modalOpen()) renderReadiness(); }, 900);

  (async () => {
    try { remoteStatus = await window.deck.remotePlayStatus(); } catch {}
    try { syncStatus = await window.deck.netplayStatus(); } catch {}
    try {
      syncRelays = await window.deck.netplayRelays();
      if (syncRelays.length) {
        $('#syncRelay').innerHTML = syncRelays.map(relay => `<option value="${escapeHtml(relay.id)}">${escapeHtml(relay.label)}</option>`).join('');
      }
    } catch {}
    if (syncStatus.active) currentPlayStyle = 'sync';
    else if (remoteStatus.active) currentPlayStyle = 'remote';
    renderPlayStyles();
    renderRemotePlay();
  })();
})();
