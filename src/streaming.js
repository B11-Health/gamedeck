(() => {
  let captureStream = null;
  let streamReturnFocus = null;
  let streamInfo = { active: false, viewerCount: 0, viewers: [], urls: [] };
  let signalingTimer = null;
  let elapsedTimer = null;
  const peers = new Map();
  const controlChannels = new Map();
  const viewerSlots = new Map();

  const qualityProfiles = {
    '1080p': { width: 1920, height: 1080, frameRate: 60 },
    '720p': { width: 1280, height: 720, frameRate: 60 },
    balanced: { width: 1280, height: 720, frameRate: 30 }
  };

  function formatElapsed(timestamp) {
    if (!timestamp) return '00:00';
    const total = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function headerSnapshot() {
    const games = state.library?.games?.length || 0;
    const systems = state.library?.systems || [];
    const ready = systems.filter(system => system.ready).length;
    const installedSystems = systems.filter(system => Number(system.installedCount || system.count || 0) > 0);
    const installed = installedSystems.length;
    const readyInstalled = installedSystems.filter(system => system.ready).length;
    const running = state.downloads.filter(download => download.status === 'running').length;
    const paused = state.downloads.filter(download => download.status === 'paused').length;
    const runtimeReady = Boolean(state.runtime?.ready || state.diagnostics?.managedRuntime?.ready || state.diagnostics?.retroarch);
    return { games, ready, installed, readyInstalled, running, paused, runtimeReady };
  }

  function renderHeaderOps() {
    const snapshot = headerSnapshot();
    const gameInfo = $('#headerGameInfo');
    if (!gameInfo) return;
    gameInfo.textContent = `${snapshot.games.toLocaleString()} game${snapshot.games === 1 ? '' : 's'}`;
    const engine = $('#headerEngineInfo');
    $('#headerEngineInfoText').textContent = snapshot.runtimeReady
      ? snapshot.installed ? `${snapshot.readyInstalled}/${snapshot.installed} ready` : `${snapshot.ready} systems`
      : 'Setup needed';
    engine.classList.toggle('ready', snapshot.runtimeReady);
    engine.classList.toggle('issue', !snapshot.runtimeReady);
    $('#headerTransferInfoText').textContent = snapshot.running
      ? `${snapshot.running} active`
      : snapshot.paused
        ? `${snapshot.paused} paused`
        : 'Idle';
    $('#streamToggle').classList.toggle('active', Boolean(streamInfo.active));
    $('#streamToggle').setAttribute('aria-pressed', String(Boolean(streamInfo.active)));
    $('#streamButtonLabel').textContent = streamInfo.active ? 'Live' : 'Go Live';
    $('#headerViewerCount').textContent = String(streamInfo.viewerCount || 0);
  }

  function renderStreamInfo() {
    renderHeaderOps();
    const active = Boolean(streamInfo.active);
    $('#streamPairing').classList.toggle('hidden', !active);
    $('#streamStop').classList.toggle('hidden', !active);
    $('#streamStart').classList.toggle('hidden', active);
    $('#streamLiveBadge').classList.toggle('hidden', !active);
    $('#streamSource').disabled = active;
    $('#streamQuality').disabled = active;
    $('#streamAudio').disabled = active;
    $('#streamPairCode').textContent = streamInfo.code || '000000';
    $('#streamPairUrl').textContent = streamInfo.primaryUrl || 'No local network address found';
    $('#streamViewerCount').textContent = String(streamInfo.viewerCount || 0);
    $('#streamViewerNames').textContent = streamInfo.viewers?.length
      ? streamInfo.viewers.map(viewer => viewer.label).join(' · ')
      : 'Waiting for a device';
    if (active) {
      clearInterval(elapsedTimer);
      elapsedTimer = setInterval(() => {
        $('#streamElapsed').textContent = formatElapsed(streamInfo.startedAt);
      }, 1000);
      $('#streamElapsed').textContent = formatElapsed(streamInfo.startedAt);
    } else {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
      $('#streamElapsed').textContent = '00:00';
    }
  }

  async function loadSources() {
    const select = $('#streamSource');
    select.innerHTML = '<option value="">Finding screens and game windows…</option>';
    const result = await window.deck.streamSources();
    const sources = Array.isArray(result) ? result : result?.sources || [];
    if (!sources.length) {
      select.innerHTML = '<option value="">No capture sources found</option>';
      return [];
    }
    const current = select.value;
    select.innerHTML = sources.map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.type === 'screen' ? `Display · ${source.name}` : `Window · ${source.name}`)}</option>`).join('');
    const gamePattern = /retroarch|mame|dolphin|pcsx2|duckstation|ppsspp|cemu/i;
    const preferred = sources.find(source => source.id === current)
      || sources.find(source => source.type === 'window' && gamePattern.test(source.name))
      || sources.find(source => source.type === 'screen')
      || sources[0];
    select.value = preferred.id;
    return sources;
  }

  function openStudio() {
    streamReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    $('#streamStudio').classList.remove('hidden');
    document.body.classList.add('modal-open');
    loadSources().catch(error => toast(error.message || 'Capture sources are unavailable.', 'warning'));
    window.deck.streamStatus().then(status => {
      streamInfo = status || streamInfo;
      renderStreamInfo();
    }).catch(() => {});
    setTimeout(() => $('#streamClose')?.focus(), 0);
  }

  function closeStudio() {
    $('#streamStudio').classList.add('hidden');
    document.body.classList.remove('modal-open');
    const target = streamReturnFocus;
    streamReturnFocus = null;
    setTimeout(() => target?.focus?.(), 0);
  }

  async function sendSignal(viewerId, payload) {
    return window.deck.streamHostSend(viewerId, payload);
  }

  function closePeer(viewerId) {
    const peer = peers.get(viewerId);
    const channel = controlChannels.get(viewerId);
    if (channel) {
      try { channel.close(); } catch {}
      controlChannels.delete(viewerId);
    }
    viewerSlots.delete(viewerId);
    if (peer) {
      try { peer.close(); } catch {}
      peers.delete(viewerId);
    }
  }

  async function createViewerPeer(viewerId, playerIndex = 0) {
    if (!captureStream || peers.has(viewerId)) return;
    const peer = new RTCPeerConnection({ iceServers: [] });
    peers.set(viewerId, peer);
    viewerSlots.set(viewerId, Number(playerIndex || 0));
    for (const track of captureStream.getTracks()) peer.addTrack(track, captureStream);
    const control = peer.createDataChannel('gamedeck-control', { ordered: false, maxRetransmits: 0 });
    controlChannels.set(viewerId, control);
    control.onopen = () => {
      control.send(JSON.stringify({ type: 'ready', playerIndex: viewerSlots.get(viewerId) || 0, protocol: 1 }));
    };
    control.onmessage = async event => {
      try {
        const payload = JSON.parse(String(event.data || ''));
        if (payload?.type !== 'input' && payload?.type !== 'controller-state') return;
        const result = await window.deck.streamViewerInput(viewerId, {
          playerIndex: viewerSlots.get(viewerId) || 0,
          controllerConnected: Boolean(payload.controllerConnected),
          events: Array.isArray(payload.events) ? payload.events.slice(0, 32) : []
        });
        if (control.readyState === 'open' && payload.sequence !== undefined) {
          control.send(JSON.stringify({ type: 'ack', sequence: payload.sequence, accepted: Boolean(result?.accepted) }));
        }
      } catch (error) {
        console.warn('GameDeck controller channel:', error);
      }
    };
    peer.onicecandidate = event => {
      if (event.candidate) sendSignal(viewerId, { candidate: event.candidate.toJSON() }).catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(peer.connectionState)) closePeer(viewerId);
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal(viewerId, { description: peer.localDescription });
  }

  async function handleHostSignal(message) {
    const viewerId = message.viewerId;
    if (message.type === 'viewer-joined') {
      await createViewerPeer(viewerId, message.playerIndex || 0);
      return;
    }
    if (message.type === 'viewer-left') {
      closePeer(viewerId);
      return;
    }
    if (message.type !== 'signal') return;
    let peer = peers.get(viewerId);
    if (!peer) {
      await createViewerPeer(viewerId, viewerSlots.get(viewerId) || 0);
      peer = peers.get(viewerId);
    }
    const payload = message.payload || {};
    if (payload.description) await peer.setRemoteDescription(payload.description);
    if (payload.candidate) await peer.addIceCandidate(payload.candidate).catch(() => {});
  }

  async function pollHostSignals() {
    if (!streamInfo.active || !captureStream) return;
    try {
      const result = await window.deck.streamHostPull();
      streamInfo = result.stream || streamInfo;
      for (const message of result.messages || []) await handleHostSignal(message);
      renderStreamInfo();
    } catch (error) {
      console.warn('GameDeck Live signaling:', error);
    }
    signalingTimer = setTimeout(pollHostSignals, 350);
  }

  async function acquireCapture(profile, audioEnabled) {
    return navigator.mediaDevices.getDisplayMedia({
      audio: audioEnabled,
      video: {
        width: { ideal: profile.width, max: profile.width },
        height: { ideal: profile.height, max: profile.height },
        frameRate: { ideal: profile.frameRate, max: profile.frameRate }
      }
    });
  }

  async function startStream(options = {}) {
    if (captureStream && streamInfo.active) return captureStream;
    let sourceId = options.sourceId || $('#streamSource').value;
    if (!sourceId) {
      await loadSources();
      sourceId = $('#streamSource').value;
    }
    if (!sourceId) {
      const error = new Error('Choose a screen or game window to stream.');
      if (options.throwOnError) throw error;
      toast(error.message, 'warning');
      return null;
    }
    const quality = options.quality || $('#streamQuality').value;
    const profile = qualityProfiles[quality] || qualityProfiles['1080p'];
    let audioEnabled = options.audio === undefined ? $('#streamAudio').checked : options.audio !== false;
    const game = options.game || focusedGame?.();
    const title = options.title || (game ? `${game.title} · GameDeck Live` : 'GameDeck Live');
    const button = $('#streamStart');
    button.disabled = true;
    button.querySelector('b').textContent = options.remote ? 'Preparing Remote Play…' : 'Starting local stream…';
    try {
      let start = await window.deck.streamStart({ sourceId, quality, audio: audioEnabled, title });
      if (!start?.ok) throw Error(start?.error || 'GameDeck Live could not start.');
      streamInfo = start.stream;
      try {
        captureStream = await acquireCapture(profile, audioEnabled);
      } catch (error) {
        if (!audioEnabled) throw error;
        await window.deck.streamStop();
        audioEnabled = false;
        $('#streamAudio').checked = false;
        start = await window.deck.streamStart({ sourceId, quality, audio: false, title });
        if (!start?.ok) throw Error(start?.error || error.message);
        streamInfo = start.stream;
        captureStream = await acquireCapture(profile, false);
        toast('GameDeck Live started without system audio on this device.', 'warning');
      }
      $('#streamPreview').srcObject = captureStream;
      $('#streamPreview').play().catch(() => {});
      $('#streamPreviewEmpty').classList.add('hidden');
      captureStream.getVideoTracks()[0]?.addEventListener('ended', () => stopStream('Capture source closed.'));
      renderStreamInfo();
      clearTimeout(signalingTimer);
      pollHostSignals();
      if (!options.silent) toast(options.remote ? 'Remote Play capture is ready.' : 'GameDeck Live is ready for Android and iPhone.', 'success');
      return captureStream;
    } catch (error) {
      await window.deck.streamStop().catch(() => {});
      streamInfo = { ...streamInfo, active: false, viewerCount: 0, viewers: [] };
      renderStreamInfo();
      if (!options.silent) toast(error.message || 'GameDeck Live could not start.', 'warning');
      if (options.throwOnError) throw error;
      return null;
    } finally {
      button.disabled = false;
      button.querySelector('b').textContent = 'Start GameDeck Live';
    }
  }

  async function stopStream(message = '') {
    clearTimeout(signalingTimer);
    signalingTimer = null;
    for (const viewerId of [...peers.keys()]) closePeer(viewerId);
    if (captureStream) {
      for (const track of captureStream.getTracks()) track.stop();
      captureStream = null;
    }
    $('#streamPreview').srcObject = null;
    $('#streamPreviewEmpty').classList.remove('hidden');
    const result = await window.deck.streamStop().catch(() => null);
    streamInfo = result?.stream || { active: false, viewerCount: 0, viewers: [], urls: [] };
    renderStreamInfo();
    if (message) toast(message);
  }

  $('#streamToggle').onclick = openStudio;
  $('#streamClose').onclick = closeStudio;
  document.querySelectorAll('[data-stream-close]').forEach(element => { element.onclick = closeStudio; });
  $('#streamStart').onclick = startStream;
  $('#streamStop').onclick = () => stopStream('GameDeck Live stopped.');
  $('#streamCopyUrl').onclick = async () => {
    if (!streamInfo.primaryUrl) return toast('No local network link is available.', 'warning');
    await window.deck.copyText(streamInfo.primaryUrl);
    toast('Mobile receiver link copied', 'success');
  };
  $('#streamOpenReceiver').onclick = () => {
    if (streamInfo.primaryUrl) window.deck.openExternal(streamInfo.primaryUrl);
  };
  $('#headerLibraryInfo').onclick = () => changeView('home');
  $('#headerEngineInfo').onclick = () => {
    state.setupCoachOpen = true;
    state.setupCoachDismissed = false;
    writePreference('setup-coach', 'open');
    renderSetupCoach();
  };
  $('#headerTransferInfo').onclick = () => {
    state.transferExpanded = true;
    renderDownloads();
    document.querySelector('#transferDock:not(.hidden)')?.focus?.();
  };
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#streamStudio').classList.contains('hidden')) closeStudio();
  });
  window.deck.onStream(update => {
    streamInfo = update || streamInfo;
    renderStreamInfo();
  });

  window.GameDeckLive = {
    async startForRemote(options = {}) {
      if (captureStream && streamInfo.active) return captureStream;
      let sources = [];
      const gameWindowPattern = /retroarch|mame|dolphin|pcsx2|duckstation|ppsspp|cemu/i;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        sources = await loadSources();
        const preferred = sources.find(source => source.type === 'window' && gameWindowPattern.test(source.name));
        if (preferred) {
          $('#streamSource').value = preferred.id;
          break;
        }
        if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 350));
      }
      return startStream({
        sourceId: $('#streamSource').value,
        quality: options.quality || '720p',
        audio: options.audio !== false,
        title: options.title || 'GameDeck Remote Play',
        remote: true,
        silent: true,
        throwOnError: true
      });
    },
    getCaptureStream: () => captureStream,
    status: () => ({ ...streamInfo }),
    stop: message => stopStream(message || '')
  };

  window.renderHeaderOps = renderHeaderOps;
  setInterval(renderHeaderOps, 1000);
  window.deck.streamStatus().then(status => {
    streamInfo = status || streamInfo;
    renderStreamInfo();
  }).catch(renderHeaderOps);
})();
