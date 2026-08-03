(() => {
  'use strict';

  const query = selector => document.querySelector(selector);
  const stage = query('#playSession');
  if (!stage || !window.deck?.playSessionStart) return;

  const shell = query('#playSessionShell');
  const video = query('#playSessionVideo');
  const loading = query('#playSessionLoading');
  const chrome = query('#playSessionChrome');
  const overlay = query('#playSessionOverlay');
  const chooser = query('#playSessionSourceChooser');
  const sourceList = query('#playSessionSourceList');
  const fullscreenButtons = [query('#playSessionFullscreen'), query('#playSessionMenuFullscreen')];
  const GAMEPAD_TO_RETROPAD = [8, 0, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7];
  const KEY_TO_RETROPAD = Object.freeze({
    ArrowUp: 4,
    ArrowDown: 5,
    ArrowLeft: 6,
    ArrowRight: 7,
    KeyZ: 0,
    KeyA: 1,
    ShiftLeft: 2,
    ShiftRight: 2,
    Enter: 3,
    KeyX: 8,
    KeyS: 9,
    KeyQ: 10,
    KeyW: 11
  });

  let active = false;
  let currentGame = null;
  let currentStatus = { active: false, phase: 'idle', sessionId: '', fullscreen: false };
  let captureStream = null;
  let acquiringCapture = false;
  let overlayOpen = false;
  let ending = false;
  let cancelRequested = false;
  let inputFrame = 0;
  let previousButtons = Array(16).fill(false);
  let previousGuide = false;
  let chromeTimer = 0;
  let endConfirmUntil = 0;
  const pressedKeys = new Map();

  function setText(selector, value) {
    const element = query(selector);
    if (element) element.textContent = String(value || '');
  }

  function notify(message, tone = 'info') {
    if (typeof window.toast === 'function') window.toast(message, tone);
    else if (typeof toast === 'function') toast(message, tone);
  }

  function phaseTitle(phase) {
    return ({
      resolving: 'Preparing ' + (currentGame?.title || 'your game'),
      preparing: 'Preparing the game engine',
      spawning: 'Starting the game',
      discovering: 'Finding the game window',
      awaiting_source: 'Choose the game window',
      capture_armed: 'Connecting the play surface',
      playing: currentGame?.title || 'Playing',
      failed: 'Play Session needs attention',
      stopping: 'Ending the Play Session',
      ended: 'Returning to your library'
    })[phase] || (currentGame?.title || 'Play Session');
  }

  function setReadiness(id, state, label) {
    const dot = query('#' + id + 'Dot');
    const text = query('#' + id + 'State');
    if (text) text.textContent = label;
    if (dot) {
      dot.classList.toggle('ready', state === 'ready');
      dot.classList.toggle('issue', state === 'issue');
    }
  }

  function showChrome() {
    if (!active || currentStatus.phase !== 'playing') return;
    stage.classList.remove('chrome-hidden');
    clearTimeout(chromeTimer);
    if (!overlayOpen) chromeTimer = setTimeout(() => stage.classList.add('chrome-hidden'), 2500);
  }

  function applyFullscreen(fullscreen) {
    currentStatus.fullscreen = Boolean(fullscreen);
    document.body.classList.toggle('play-session-fullscreen', currentStatus.fullscreen);
    fullscreenButtons.forEach(button => {
      if (!button) return;
      const label = button.querySelector('b') || button;
      label.textContent = currentStatus.fullscreen ? 'Exit fullscreen' : 'Fullscreen';
    });
    const menuButton = query('#playSessionMenuFullscreen');
    if (menuButton) menuButton.textContent = currentStatus.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  }

  function renderSources(candidates = []) {
    sourceList.replaceChildren();
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'play-session-source-empty';
      empty.textContent = 'No likely game window is visible yet. Refresh after the emulator finishes opening.';
      sourceList.appendChild(empty);
      return;
    }
    candidates.forEach(candidate => {
      const button = document.createElement('button');
      button.type = 'button';
      const icon = document.createElement('span');
      icon.textContent = '▣';
      const copy = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = candidate.name || 'Game window';
      const detail = document.createElement('small');
      const reasons = Array.isArray(candidate.reason) ? candidate.reason : [];
      detail.textContent = reasons.includes('title_match') ? 'New window · title match'
        : reasons.includes('engine_match') ? 'New window · game engine match'
          : reasons.includes('new_window') ? 'New window'
            : 'Available game window';
      copy.append(title, detail);
      button.append(icon, copy);
      button.onclick = () => chooseSource(candidate.id);
      sourceList.appendChild(button);
    });
  }

  function renderStatus(update = {}) {
    currentStatus = { ...currentStatus, ...update };
    if (currentStatus.sessionId && currentStatus.phase !== 'idle') active = true;
    if (!active && currentStatus.phase === 'idle') return;

    setText('#playSessionTitle', phaseTitle(currentStatus.phase));
    setText('#playSessionHeaderTitle', currentStatus.title || currentGame?.title || 'Selected game');
    setText('#playSessionMessage', currentStatus.error || currentStatus.message || 'Preparing the Play Session.');
    setText('#playSessionMode', currentStatus.mode === 'external' ? 'EXTERNAL SESSION' : 'EMBEDDED SESSION');
    setText('#playSessionOverlayStatus', currentStatus.message || 'Your game keeps running while this menu is open.');

    const videoState = currentStatus.phase === 'playing' ? 'Ready'
      : currentStatus.phase === 'capture_armed' ? 'Connecting'
        : currentStatus.phase === 'failed' ? 'Unavailable' : 'Preparing';
    setReadiness('playSessionVideo', currentStatus.phase === 'playing' ? 'ready' : currentStatus.phase === 'failed' ? 'issue' : 'waiting', videoState);
    const audioState = currentStatus.audioState === 'ready' ? 'Ready'
      : currentStatus.audioState === 'unavailable' ? 'Unavailable'
        : currentStatus.audioState === 'muted' ? 'Click game to enable' : 'Checking';
    setReadiness('playSessionAudio', currentStatus.audioState === 'ready' ? 'ready' : currentStatus.audioState === 'unavailable' ? 'issue' : 'waiting', audioState);
    const controllerPresent = Boolean(navigator.getGamepads?.() && [...navigator.getGamepads()].some(Boolean));
    const controllerState = controllerPresent || currentStatus.controllerState === 'connected' ? 'Connected' : 'Keyboard ready';
    setReadiness('playSessionController', 'ready', controllerState);

    stage.classList.toggle('playing', currentStatus.phase === 'playing');
    loading.classList.toggle('hidden', currentStatus.phase === 'playing');
    chrome.classList.toggle('hidden', !['capture_armed', 'playing'].includes(currentStatus.phase));
    chooser.classList.toggle('hidden', currentStatus.phase !== 'awaiting_source');
    query('#playSessionHint')?.classList.toggle('hidden', currentStatus.phase !== 'playing');
    renderSources(currentStatus.candidates || []);
    applyFullscreen(currentStatus.fullscreen);

    if (currentStatus.phase === 'capture_armed' && !captureStream && !acquiringCapture) acquireCapture();
    if (currentStatus.phase === 'playing') {
      document.body.classList.add('play-session-active');
      shell.focus({ preventScroll: true });
      showChrome();
      startInputLoop();
    }
    if (currentStatus.phase === 'failed') {
      query('#playSessionCancel').textContent = 'Return to library';
      setTimeout(() => setOverlay(true), 0);
    }
    if (currentStatus.phase === 'ended') finishUi(currentStatus.message || 'Play Session ended.');
  }

  function stopMedia() {
    if (captureStream) {
      captureStream.getTracks().forEach(track => track.stop());
      captureStream = null;
    }
    video.pause();
    video.srcObject = null;
  }

  async function acquireDisplayMedia(audio) {
    const armed = await window.deck.playSessionArmCapture(currentStatus.sessionId, audio);
    if (!armed?.ok) throw Error(armed?.error || 'The game window could not be captured.');
    return navigator.mediaDevices.getDisplayMedia({
      audio,
      video: {
        width: { ideal: 1920, max: 2560 },
        height: { ideal: 1080, max: 1440 },
        frameRate: { ideal: 60, max: 60 }
      }
    });
  }

  async function acquireCapture() {
    if (acquiringCapture || !currentStatus.sessionId) return;
    acquiringCapture = true;
    try {
      let requestedAudio = true;
      try {
        captureStream = await acquireDisplayMedia(true);
      } catch (firstError) {
        requestedAudio = false;
        captureStream = await acquireDisplayMedia(false).catch(() => { throw firstError; });
      }
      if (!active || !captureStream) return;
      video.srcObject = captureStream;
      video.muted = !requestedAudio;
      video.volume = 1;
      let audible = captureStream.getAudioTracks().length > 0 && requestedAudio;
      try {
        await video.play();
      } catch {
        video.muted = true;
        audible = false;
        await video.play();
        currentStatus.audioState = captureStream.getAudioTracks().length ? 'muted' : 'unavailable';
      }
      const videoTrack = captureStream.getVideoTracks()[0];
      videoTrack?.addEventListener('ended', () => {
        if (active && !ending) endSession('The captured game window closed.');
      }, { once: true });
      if (video.readyState < 2) await new Promise(resolve => {
        const done = () => resolve();
        video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 2500);
      });
      const controller = Boolean(navigator.getGamepads?.() && [...navigator.getGamepads()].some(Boolean));
      const ready = await window.deck.playSessionMediaReady(currentStatus.sessionId, {
        audio: audible,
        controller
      });
      if (!ready?.ok) throw Error(ready?.error || 'The play surface could not be activated.');
      const status = ready.status || { phase: 'playing' };
      if (currentStatus.audioState === 'muted') status.audioState = 'muted';
      renderStatus(status);
    } catch (error) {
      stopMedia();
      currentStatus = { ...currentStatus, phase: 'failed', error: error.message, message: error.message };
      renderStatus(currentStatus);
      notify(error.message || 'Embedded Play could not connect.', 'warning');
    } finally {
      acquiringCapture = false;
    }
  }

  async function chooseSource(sourceId) {
    const result = await window.deck.playSessionSelectSource(currentStatus.sessionId, sourceId);
    if (!result?.ok) {
      notify(result?.error || 'That window is no longer available.', 'warning');
      return;
    }
    renderStatus(result.status || { phase: 'capture_armed', captureReady: true });
    acquireCapture();
  }

  async function refreshSources() {
    const button = query('#playSessionRefreshSources');
    button.disabled = true;
    try {
      const result = await window.deck.playSessionSources(currentStatus.sessionId);
      if (!result?.ok) throw Error(result?.error || 'Game windows could not be refreshed.');
      currentStatus.candidates = result.candidates || [];
      renderSources(currentStatus.candidates);
    } catch (error) {
      notify(error.message, 'warning');
    } finally {
      button.disabled = false;
    }
  }

  function sendInputEvents(events) {
    if (!events.length || !currentStatus.sessionId) return;
    window.deck.playSessionInput({ sessionId: currentStatus.sessionId, events });
  }

  function releaseAllInputs() {
    const events = [];
    previousButtons.forEach((pressed, index) => {
      if (pressed) events.push({ id: GAMEPAD_TO_RETROPAD[index], state: 0 });
    });
    previousButtons = Array(16).fill(false);
    for (const id of pressedKeys.values()) events.push({ id, state: 0 });
    pressedKeys.clear();
    sendInputEvents(events);
  }

  function setOverlay(open) {
    if (!active || !['capture_armed', 'playing', 'failed'].includes(currentStatus.phase)) return;
    overlayOpen = Boolean(open);
    overlay.classList.toggle('hidden', !overlayOpen);
    document.body.classList.toggle('modal-open', overlayOpen);
    if (overlayOpen) {
      releaseAllInputs();
      stage.classList.remove('chrome-hidden');
      clearTimeout(chromeTimer);
      query('#playSessionResume').focus();
    } else {
      shell.focus({ preventScroll: true });
      showChrome();
    }
  }

  async function toggleFullscreen() {
    if (!active || !currentStatus.sessionId) return;
    const result = await window.deck.playSessionFullscreen(currentStatus.sessionId, !currentStatus.fullscreen);
    if (!result?.ok) {
      notify(result?.error || 'Fullscreen could not be changed.', 'warning');
      return;
    }
    renderStatus(result.status || { fullscreen: !currentStatus.fullscreen });
  }

  function resetEndButtons() {
    endConfirmUntil = 0;
    [query('#playSessionEnd'), query('#playSessionMenuEnd')].forEach(button => {
      if (!button) return;
      const label = button.querySelector('b') || button;
      label.textContent = 'End session';
    });
  }

  async function requestEnd() {
    if (Date.now() > endConfirmUntil) {
      endConfirmUntil = Date.now() + 3000;
      [query('#playSessionEnd'), query('#playSessionMenuEnd')].forEach(button => {
        if (!button) return;
        const label = button.querySelector('b') || button;
        label.textContent = 'Press again to end';
      });
      setText('#playSessionOverlayStatus', 'Press End session again to close the running game.');
      setTimeout(() => { if (Date.now() > endConfirmUntil) resetEndButtons(); }, 3100);
      return;
    }
    await endSession('Ended by player.');
  }

  async function endSession(reason = 'Ended by player.') {
    if (!active || ending) return;
    if (!currentStatus.sessionId) {
      cancelRequested = true;
      setText('#playSessionMessage', 'Canceling the launch…');
      return;
    }
    ending = true;
    releaseAllInputs();
    stopMedia();
    try {
      await window.deck.playSessionStop(currentStatus.sessionId, reason);
    } finally {
      finishUi(reason);
      ending = false;
    }
  }

  async function useExternalWindow() {
    if (!active || ending || !currentStatus.sessionId) return;
    ending = true;
    releaseAllInputs();
    stopMedia();
    try {
      const result = await window.deck.playSessionExternal(currentStatus.sessionId);
      if (!result?.ok) throw Error(result?.error || 'The external game window could not be opened.');
      finishUi('');
      notify(result.message || 'Game opened in its own window.', 'success');
    } catch (error) {
      ending = false;
      notify(error.message, 'warning');
    }
  }

  function finishUi(message = '') {
    if (!active && stage.classList.contains('hidden')) return;
    const finishedGame = currentGame;
    active = false;
    overlayOpen = false;
    ending = false;
    cancelRequested = false;
    stopMedia();
    cancelAnimationFrame(inputFrame);
    inputFrame = 0;
    clearTimeout(chromeTimer);
    resetEndButtons();
    previousButtons = Array(16).fill(false);
    previousGuide = false;
    pressedKeys.clear();
    stage.classList.add('hidden');
    stage.classList.remove('playing', 'chrome-hidden');
    overlay.classList.add('hidden');
    chooser.classList.add('hidden');
    document.body.classList.remove('play-session-active', 'play-session-fullscreen', 'modal-open');
    currentStatus = { active: false, phase: 'idle', sessionId: '', fullscreen: false };
    const card = finishedGame?.id ? document.querySelector('.game[data-id="' + CSS.escape(finishedGame.id) + '"]') : null;
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card?.focus({ preventScroll: true });
    if (message && !/switching|external/i.test(message)) notify(message);
    currentGame = null;
  }

  function buttonPressed(button) {
    return Boolean(button && (button.pressed || button.value > 0.5));
  }

  function inputLoop() {
    if (!active) return;
    const pad = navigator.getGamepads?.() ? [...navigator.getGamepads()].find(Boolean) : null;
    const guide = buttonPressed(pad?.buttons?.[16]);
    if (guide && !previousGuide) setOverlay(!overlayOpen);
    previousGuide = guide;

    if (pad && overlayOpen) {
      const rising = index => buttonPressed(pad.buttons[index]) && !previousButtons[index];
      if (rising(0) || rising(1)) setOverlay(false);
      else if (rising(2)) toggleFullscreen();
      else if (rising(3)) requestEnd();
      previousButtons = Array.from({ length: 16 }, (_, index) => buttonPressed(pad.buttons[index]));
    } else if (pad && ['capture_armed', 'playing'].includes(currentStatus.phase)) {
      const nextButtons = Array.from({ length: 16 }, (_, index) => buttonPressed(pad.buttons[index]));
      const events = [];
      nextButtons.forEach((pressed, index) => {
        if (pressed !== previousButtons[index]) events.push({ id: GAMEPAD_TO_RETROPAD[index], state: pressed ? 1 : 0 });
      });
      previousButtons = nextButtons;
      sendInputEvents(events);
    } else if (!pad) {
      const releases = [];
      previousButtons.forEach((pressed, index) => {
        if (pressed) releases.push({ id: GAMEPAD_TO_RETROPAD[index], state: 0 });
      });
      previousButtons = Array(16).fill(false);
      sendInputEvents(releases);
    }
    inputFrame = requestAnimationFrame(inputLoop);
  }

  function startInputLoop() {
    if (!inputFrame) inputFrame = requestAnimationFrame(inputLoop);
  }

  async function start(game) {
    if (!game?.file) return { handled: false };
    if (active) return { handled: true, error: 'A Play Session is already active.' };
    active = true;
    ending = false;
    cancelRequested = false;
    currentGame = game;
    currentStatus = {
      active: true,
      phase: 'resolving',
      sessionId: '',
      title: game.title,
      systemId: game.system,
      mode: 'embedded',
      fullscreen: false,
      audioState: 'checking',
      controllerState: 'waiting',
      message: 'Checking the game, engine, and controller.'
    };
    const cardImage = document.querySelector('[data-game-art="' + CSS.escape(game.id) + '"]');
    const art = game.art || cardImage?.src || '';
    query('#playSessionArt').src = art;
    query('#playSessionArt').alt = game.title + ' cover';
    query('#playSessionAmbientArt').src = art;
    query('#playSessionAmbientArt').alt = '';
    query('#playSessionCancel').textContent = 'Cancel launch';
    stage.classList.remove('hidden', 'playing', 'chrome-hidden');
    document.body.classList.add('play-session-active');
    renderStatus(currentStatus);
    startInputLoop();

    try {
      const result = await window.deck.playSessionStart(game.file);
      if (!result?.ok) throw Error(result?.error || 'The Play Session could not start.');
      if (result.external) {
        finishUi('');
        notify(result.message || 'This game opened in its own window.');
        return { handled: true, external: true, result };
      }
      renderStatus(result.status || {});
      if (cancelRequested) {
        await endSession('Launch canceled.');
        return { handled: true, canceled: true };
      }
      if (result.awaitingSource) {
        currentStatus.phase = 'awaiting_source';
        currentStatus.candidates = result.candidates || [];
        renderStatus(currentStatus);
      } else if (result.captureReady) {
        currentStatus.phase = 'capture_armed';
        renderStatus(currentStatus);
        acquireCapture();
      }
      return { handled: true, embedded: true, result };
    } catch (error) {
      if (!currentStatus.sessionId) {
        finishUi('');
        notify(error.message || 'The Play Session could not start.', 'warning');
      } else {
        currentStatus = { ...currentStatus, phase: 'failed', error: error.message, message: error.message };
        renderStatus(currentStatus);
        notify(error.message || 'The Play Session could not start.', 'warning');
      }
      return { handled: true, error: error.message };
    }
  }

  query('#playSessionCancel').onclick = () => endSession('Launch canceled.');
  query('#playSessionSourceCancel').onclick = () => endSession('Launch canceled.');
  query('#playSessionRefreshSources').onclick = refreshSources;
  query('#playSessionUseExternal').onclick = useExternalWindow;
  query('#playSessionFullscreen').onclick = toggleFullscreen;
  query('#playSessionControls').onclick = () => setOverlay(true);
  query('#playSessionEnd').onclick = requestEnd;
  query('#playSessionResume').onclick = () => setOverlay(false);
  query('#playSessionMenuFullscreen').onclick = toggleFullscreen;
  query('#playSessionMenuExternal').onclick = useExternalWindow;
  query('#playSessionMenuEnd').onclick = requestEnd;

  stage.addEventListener('mousemove', showChrome, { passive: true });
  stage.addEventListener('pointerdown', () => {
    showChrome();
    if (video.muted && captureStream?.getAudioTracks().length) {
      video.muted = false;
      currentStatus.audioState = 'ready';
      setReadiness('playSessionAudio', 'ready', 'Ready');
    }
  }, { passive: true });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'F11') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOverlay(!overlayOpen);
      return;
    }
    const id = KEY_TO_RETROPAD[event.code];
    if (id === undefined || overlayOpen || !['capture_armed', 'playing'].includes(currentStatus.phase)) return;
    event.preventDefault();
    if (event.repeat || pressedKeys.has(event.code)) return;
    pressedKeys.set(event.code, id);
    sendInputEvents([{ id, state: 1 }]);
  }, true);
  document.addEventListener('keyup', event => {
    if (!active) return;
    const id = pressedKeys.get(event.code);
    if (id === undefined) return;
    event.preventDefault();
    pressedKeys.delete(event.code);
    sendInputEvents([{ id, state: 0 }]);
  }, true);
  window.addEventListener('blur', releaseAllInputs);
  window.addEventListener('beforeunload', stopMedia);
  window.deck.onPlaySession?.(renderStatus);

  window.GameDeckPlaySession = Object.freeze({
    start,
    active: () => active,
    openControls: () => setOverlay(true),
    end: endSession,
    toggleFullscreen
  });
})();
