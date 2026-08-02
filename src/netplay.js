(() => {
  const DISCORD_REMOTE_PLAY_URL = 'https://discord.com/channels/1533539059207504093/1533539469372821555';
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

  let remoteStatus = { active: false, phase: 'idle', title: '', playerCount: 1, maxPlayers: 0, message: 'Ready for Remote Play Together.' };
  let currentTab = 'host';
  let selectedInfo = null;
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

  function openStudio(tab = 'host') {
    currentTab = tab;
    $('#netplayStudio').classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderTabs();
    refreshSelectedGame();
    renderRemotePlay();
    if (tab === 'join') setTimeout(() => $('#netplayJoinInvite').focus(), 80);
  }

  function closeStudio() {
    $('#netplayStudio').classList.add('hidden');
    document.body.classList.remove('modal-open');
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

  async function refreshSelectedGame() {
    const game = selectedGame();
    selectedInfo = null;
    const card = $('#netplayGameCard');
    if (!game) {
      $('#netplayGameTitle').textContent = 'Select a game from your library';
      $('#netplayGameMeta').textContent = 'Choose SF2, Contra, Smash TV, or another supported local multiplayer title.';
      $('#netplayHost').disabled = true;
      card.classList.add('unsupported');
      updatePlayerSlots(2);
      return;
    }
    $('#netplayGameTitle').textContent = game.title;
    $('#netplayGameMeta').textContent = 'Checking Remote Play support…';
    $('#netplayHost').disabled = true;
    try {
      selectedInfo = await window.deck.netplayGameInfo(game.file);
      const supported = Boolean(selectedInfo?.ok && selectedInfo.supported);
      card.classList.toggle('unsupported', !supported);
      $('#netplayGameMeta').textContent = supported
        ? `${selectedInfo.systemName} · up to ${selectedInfo.maxPlayers} players · only the host needs the game`
        : selectedInfo?.issue || 'This game is not yet supported for Remote Play Together.';
      updatePlayerSlots(selectedInfo?.maxPlayers || 2);
      $('#netplayHost').disabled = !supported || remoteStatus.active;
    } catch (error) {
      card.classList.add('unsupported');
      $('#netplayGameMeta').textContent = error.message || 'Remote Play compatibility check failed.';
    }
  }

  function renderRemotePlay() {
    const hostActive = Boolean(remoteStatus.active);
    const guestActive = Boolean(guestPeer);
    const active = hostActive || guestActive;
    const count = activePlayerCount();
    $('#netplayActive').classList.toggle('hidden', !active && remoteStatus.phase !== 'error');
    $('#netplayActiveRole').textContent = guestActive
      ? guestConnected ? 'CONNECTED AS REMOTE PLAYER' : 'WAITING FOR HOST RESPONSE'
      : hostActive ? 'HOSTING REMOTE PLAY TOGETHER' : remoteStatus.phase === 'error' ? 'REMOTE PLAY ISSUE' : 'REMOTE PLAY STATUS';
    $('#netplayActiveTitle').textContent = guestInvite?.title || remoteStatus.title || (remoteStatus.phase === 'error' ? 'Session could not start' : 'Preparing multiplayer');
    $('#netplayActiveMessage').textContent = remoteStatus.error || (guestActive
      ? guestConnected ? 'Video and controller input are connected directly to the host.' : 'Send the response code to the host, then keep this window open.'
      : remoteStatus.message || 'Ready for Remote Play Together.');
    $('#netplayPlayerCount').textContent = String(count || (hostActive ? 1 : 0));
    $('#netplayStop').classList.toggle('hidden', !active);
    $('#netplayHostTools').classList.toggle('hidden', !hostActive);
    $('#netplayHost').classList.toggle('hidden', hostActive);
    $('#netplayHost').disabled = hostActive || !selectedInfo?.supported;

    const header = $('#netplayToggle');
    header.classList.toggle('active', active);
    header.setAttribute('aria-pressed', String(active));
    $('#netplayButtonLabel').textContent = active ? guestConnected ? 'Playing Online' : hostActive ? 'Room Live' : 'Pairing' : 'Play Online';
    $('#headerPlayerCount').textContent = String(count || 0);
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

  async function endSession() {
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
    refreshSelectedGame();
    toast('Remote Play Together ended.', 'success');
  }

  $('#netplayToggle').onclick = () => openStudio(remoteStatus.active ? 'host' : guestPeer ? 'join' : 'host');
  $('#spotlightOnline').onclick = () => openStudio('host');
  $('#netplayClose').onclick = closeStudio;
  document.querySelector('[data-netplay-close]').onclick = closeStudio;
  document.querySelectorAll('[data-netplay-tab]').forEach(button => {
    button.onclick = () => {
      currentTab = button.dataset.netplayTab;
      renderTabs();
      renderRemotePlay();
    };
  });
  $('#netplayHost').onclick = startHost;
  $('#netplayCreateInvite').onclick = () => createHostInvite().catch(error => toast(error.message, 'warning'));
  $('#netplayAcceptAnswer').onclick = () => acceptHostAnswer().catch(error => toast(error.message, 'warning'));
  $('#netplayJoin').onclick = () => createGuestResponse().catch(error => {
    stopGuest();
    toast(error.message || 'The Remote Play invitation could not be opened.', 'warning');
  });
  $('#netplayStop').onclick = endSession;
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
    if (event.key === 'Escape' && !$('#netplayStudio').classList.contains('hidden')) {
      event.preventDefault();
      closeStudio();
      return;
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
    renderRemotePlay();
  });

  (async () => {
    try { remoteStatus = await window.deck.remotePlayStatus(); } catch {}
    renderRemotePlay();
  })();
})();
