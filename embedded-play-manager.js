'use strict';

const crypto = require('crypto');

const MODES = new Set(['docked', 'fullscreen', 'popout']);
const ACTIVE_PHASES = new Set(['resolving', 'spawning', 'discovering', 'capture_armed', 'playing', 'external_playing', 'stopping']);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeMode(value) {
  return MODES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'docked';
}

function createSessionId() {
  return `embedded-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function publicStatus(session) {
  if (!session) {
    return {
      version: 1,
      active: false,
      phase: 'idle',
      sessionId: '',
      title: '',
      systemId: '',
      classification: '',
      mode: 'docked',
      aspectRatio: 16 / 9,
      captureReady: false,
      inputMode: 'none',
      startedAt: 0,
      updatedAt: Date.now(),
      endedAt: 0,
      endReason: '',
      error: '',
      message: 'Ready for integrated play.',
      presentation: { docked: true, fullscreen: true, popOut: true }
    };
  }
  const active = ACTIVE_PHASES.has(session.phase);
  return {
    version: 1,
    active,
    phase: session.phase,
    sessionId: session.id,
    title: session.title,
    systemId: session.systemId,
    classification: session.classification,
    mode: session.mode,
    aspectRatio: session.aspectRatio,
    captureReady: Boolean(session.sourceId && session.mode !== 'popout' && active),
    inputMode: session.mode === 'popout' ? 'engine' : 'controller',
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt || 0,
    endReason: session.endReason || '',
    error: session.error || '',
    message: session.message || '',
    presentation: { docked: true, fullscreen: true, popOut: true }
  };
}

class EmbeddedPlayManager {
  constructor(options = {}) {
    this.listSources = options.listSources;
    this.rankSources = options.rankSources;
    this.spawnProcess = options.spawnProcess;
    this.terminateProcess = options.terminateProcess;
    this.checkReadiness = typeof options.checkReadiness === 'function' ? options.checkReadiness : null;
    this.windowController = options.windowController || {};
    this.onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
    this.onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.wait = typeof options.wait === 'function' ? options.wait : delay;
    this.sourceTimeoutMs = Math.max(1000, Number(options.sourceTimeoutMs || 16000));
    this.sourcePollMs = Math.max(50, Number(options.sourcePollMs || 250));
    this.session = null;
    this.lastStatus = publicStatus(null);
  }

  status() {
    return this.session ? publicStatus(this.session) : { ...this.lastStatus };
  }

  emit() {
    const status = this.status();
    this.lastStatus = status;
    this.onUpdate(status);
    return status;
  }

  update(patch = {}) {
    if (!this.session) return this.status();
    Object.assign(this.session, patch, { updatedAt: this.now() });
    return this.emit();
  }

  async discoverSource(session, beforeSources) {
    const timeoutMs = Math.max(this.sourceTimeoutMs, Number(session.spec?.sourceTimeoutMs || 0));
    const deadline = this.now() + timeoutMs;
    let previousSources = [];
    while (this.session === session && this.now() < deadline) {
      await this.wait(this.sourcePollMs);
      if (this.session !== session || session.phase === 'stopping') throw new Error('Integrated play was stopped.');
      const sources = await this.listSources();
      const ranked = this.rankSources(sources, {
        beforeSourceIds: beforeSources,
        previousSources,
        gameTitle: session.title,
        shortName: session.shortName,
        titleTerms: session.sourceTerms,
        engineLabel: session.engineLabel,
        gameDeckSourceId: session.gameDeckSourceId
      });
      if (ranked.automaticSourceId) {
        const selected = sources.find(source => source.id === ranked.automaticSourceId);
        if (selected) return selected;
      }
      const exactStable = ranked.candidates.find(candidate => candidate.isNew && candidate.stable && (
        candidate.engineMatch || candidate.titleMatch || session.sourceTerms.some(term => candidate.normalizedName === String(term).toLowerCase())
      ));
      if (exactStable) {
        const selected = sources.find(source => source.id === exactStable.id);
        if (selected) return selected;
      }
      previousSources = sources;
    }
    throw new Error('GameDeck could not identify the game window. Use Pop out to continue in the engine window.');
  }

  async waitForReadiness(session) {
    const readiness = session.spec?.readiness;
    if (!readiness || !this.checkReadiness) return;
    const timeoutMs = Math.max(1000, Number(readiness.timeoutMs || 30000));
    const deadline = this.now() + timeoutMs;
    while (this.session === session && this.now() < deadline) {
      if (session.phase === 'stopping') throw new Error('Integrated play was stopped.');
      let result = null;
      try {
        result = await this.checkReadiness(readiness, session);
      } catch (error) {
        result = { ready: false, fatal: false, detail: error.message };
      }
      if (result?.ready) return;
      if (result?.fatal) throw new Error(result.error || readiness.failureMessage || 'The selected game did not load.');
      await this.wait(Math.max(50, Number(readiness.pollMs || 200)));
    }
    throw new Error(readiness.failureMessage || 'The selected game did not become ready in time.');
  }

  bindChild(session) {
    const child = session.child;
    child.once?.('error', error => {
      if (this.session !== session || session.stopRequested) return;
      this.fail(session, error.message || 'The game engine could not start.');
    });
    child.once?.('exit', (code, signal) => {
      if (this.session !== session) return;
      const reason = session.stopRequested ? session.endReason || 'stopped' : (code === 0 || code === null ? 'game_closed' : `engine_exit_${code ?? signal ?? 'unknown'}`);
      this.finish(session, reason);
    });
  }

  async start(spec = {}, options = {}) {
    if (this.session && ACTIVE_PHASES.has(this.session.phase)) {
      return { ok: false, error: 'session_active', status: this.status() };
    }
    if (!spec.executable || !Array.isArray(spec.args) || typeof this.listSources !== 'function' || typeof this.rankSources !== 'function' || typeof this.spawnProcess !== 'function') {
      return { ok: false, error: 'integration_unavailable', status: this.status() };
    }

    const startedAt = this.now();
    const requestedMode = normalizeMode(options.mode);
    const session = {
      id: createSessionId(),
      phase: 'resolving',
      title: String(spec.title || 'Game').slice(0, 160),
      shortName: String(spec.shortName || '').slice(0, 160),
      systemId: String(spec.systemId || '').slice(0, 64),
      classification: String(spec.classification || 'embedded_experimental').slice(0, 64),
      engineLabel: String(spec.engineLabel || 'Game engine').slice(0, 120),
      sourceTerms: Array.isArray(spec.sourceTerms) ? spec.sourceTerms.map(value => String(value || '').trim()).filter(Boolean).slice(0, 8) : [],
      gameDeckSourceId: String(spec.gameDeckSourceId || ''),
      requestedMode,
      mode: 'docked',
      aspectRatio: Number.isFinite(Number(spec.aspectRatio)) && Number(spec.aspectRatio) > 0.4 && Number(spec.aspectRatio) < 3 ? Number(spec.aspectRatio) : 16 / 9,
      startedAt,
      updatedAt: startedAt,
      endedAt: 0,
      endReason: '',
      error: '',
      message: `Preparing ${String(spec.title || 'game')} inside GameDeck…`,
      sourceId: '',
      sourceName: '',
      child: null,
      stopRequested: false,
      spec
    };
    this.session = session;
    this.emit();

    try {
      const beforeSources = await this.listSources();
      await this.windowController.prepare?.('docked');
      this.update({ phase: 'spawning', message: `Starting ${session.engineLabel} behind the GameDeck play surface…` });
      session.child = this.spawnProcess(spec);
      if (!session.child) throw new Error('The game engine did not return a process handle.');
      this.bindChild(session);
      if (spec.readiness) {
        this.update({ phase: 'discovering', message: spec.readiness.message || 'Verifying the selected game…' });
        await this.waitForReadiness(session);
      }
      this.update({ phase: 'discovering', message: 'Connecting the live game window…' });
      const source = await this.discoverSource(session, beforeSources);
      if (this.session !== session) throw new Error('Integrated play was replaced by another session.');
      await this.windowController.integrate?.(session, source, requestedMode);
      if (requestedMode === 'popout') {
        await this.windowController.setMode?.('popout', session);
        this.update({
          phase: 'external_playing',
          mode: 'popout',
          sourceId: source.id,
          sourceName: source.name,
          message: session.title + ' is playing in its engine window. Press F10 to return to GameDeck.'
        });
        return { ok: true, status: this.status() };
      }
      this.update({
        phase: 'capture_armed',
        sourceId: source.id,
        sourceName: source.name,
        message: 'Game window connected. Starting the integrated player…'
      });
      if (requestedMode === 'fullscreen') await this.setMode(session.id, 'fullscreen');
      return { ok: true, status: this.status() };
    } catch (error) {
      return this.fail(session, error.message || 'Integrated play could not start.');
    }
  }

  captureSource(sessionId) {
    if (!this.session || this.session.id !== String(sessionId || '') || !this.session.sourceId || this.session.mode === 'popout') return null;
    return { sourceId: this.session.sourceId, sourceName: this.session.sourceName || '', audio: this.session.spec?.captureAudio === true };
  }

  captureStarted(sessionId) {
    if (!this.session || this.session.id !== String(sessionId || '')) return { ok: false, error: 'stale_session', status: this.status() };
    if (!['capture_armed', 'playing'].includes(this.session.phase)) return { ok: false, error: 'capture_not_armed', status: this.status() };
    this.windowController.captureStarted?.(this.session);
    this.update({ phase: 'playing', message: `${this.session.title} is playing inside GameDeck.` });
    return { ok: true, status: this.status() };
  }

  setAspect(sessionId, aspectRatio) {
    if (!this.session || this.session.id !== String(sessionId || '')) return { ok: false, error: 'stale_session', status: this.status() };
    const aspect = Number(aspectRatio);
    if (!Number.isFinite(aspect) || aspect <= 0.4 || aspect >= 3) return { ok: false, error: 'invalid_aspect', status: this.status() };
    this.session.aspectRatio = aspect;
    this.windowController.setAspect?.(aspect, this.session);
    return { ok: true, status: this.update({ aspectRatio: aspect }) };
  }

  async setMode(sessionId, mode) {
    if (!this.session || this.session.id !== String(sessionId || '')) return { ok: false, error: 'stale_session', status: this.status() };
    const session = this.session;
    const nextMode = normalizeMode(mode);
    const previousMode = session.mode;
    const previousPhase = session.phase;
    const returningFromPopout = previousMode === 'popout' || previousPhase === 'external_playing';
    await this.windowController.setMode?.(nextMode, session);

    if (nextMode !== 'popout' && returningFromPopout) {
      this.update({
        mode: nextMode,
        phase: 'discovering',
        sourceId: '',
        sourceName: '',
        message: `Reconnecting ${session.title} to GameDeck…`
      });
      try {
        const source = await this.discoverSource(session, []);
        if (this.session !== session) return { ok: false, error: 'stale_session', status: this.status() };
        this.update({
          mode: nextMode,
          phase: 'capture_armed',
          sourceId: source.id,
          sourceName: source.name,
          message: nextMode === 'fullscreen'
            ? `${session.title} is reconnecting in fullscreen GameDeck.`
            : `${session.title} is reconnecting in the docked GameDeck player.`
        });
        return { ok: true, status: this.status() };
      } catch (error) {
        if (this.session === session) {
          try { await this.windowController.setMode?.('popout', session); } catch {}
          this.update({
            mode: 'popout',
            phase: 'external_playing',
            sourceId: '',
            sourceName: '',
            message: `GameDeck could not reconnect the live window. ${session.title} is still running in Pop out.`
          });
        }
        return { ok: false, error: error.message || 'The game window could not be reconnected.', status: this.status() };
      }
    }

    const phase = nextMode === 'popout' ? 'external_playing' : previousPhase;
    this.update({
      mode: nextMode,
      phase,
      message: nextMode === 'popout'
        ? `${session.title} is playing in its engine window. Press F10 to return to GameDeck.`
        : nextMode === 'fullscreen'
          ? `${session.title} is ready in fullscreen GameDeck.`
          : `${session.title} is ready in the docked GameDeck player.`
    });
    return { ok: true, status: this.status() };
  }

  async stop(sessionId, reason = 'requested') {
    if (!this.session) return { ok: true, idempotent: true, status: this.status() };
    if (this.session.id !== String(sessionId || '')) return { ok: false, error: 'stale_session', status: this.status() };
    const session = this.session;
    session.stopRequested = true;
    session.endReason = String(reason || 'requested').slice(0, 120);
    this.update({ phase: 'stopping', message: `Closing ${session.title}…` });
    try {
      await this.terminateProcess?.(session.child);
    } catch (error) {
      this.onLog('info', `Integrated play cleanup: ${error.message}`);
    }
    if (this.session === session) this.finish(session, session.endReason);
    return { ok: true, idempotent: false, status: this.status() };
  }

  fail(session, message) {
    if (this.session !== session) return { ok: false, error: message, status: this.status() };
    session.stopRequested = true;
    try { this.terminateProcess?.(session.child); } catch {}
    session.phase = 'failed';
    session.error = String(message || 'Integrated play failed.').slice(0, 400);
    session.message = session.error;
    session.updatedAt = this.now();
    session.endedAt = session.updatedAt;
    this.windowController.release?.(session);
    this.windowController.restore?.();
    const status = this.emit();
    this.lastStatus = status;
    this.session = null;
    return { ok: false, error: session.error, status };
  }

  finish(session, reason = 'game_closed') {
    if (this.session !== session) return this.status();
    session.phase = 'ended';
    session.endedAt = this.now();
    session.updatedAt = session.endedAt;
    session.endReason = String(reason || 'game_closed').slice(0, 160);
    session.message = session.stopRequested ? 'Integrated play closed.' : `${session.title} closed.`;
    this.windowController.release?.(session);
    this.windowController.restore?.();
    const status = this.emit();
    this.lastStatus = status;
    this.session = null;
    return status;
  }
}

function createEmbeddedPlayManager(options = {}) {
  return new EmbeddedPlayManager(options);
}

module.exports = { EmbeddedPlayManager, createEmbeddedPlayManager, normalizeMode, publicStatus };
