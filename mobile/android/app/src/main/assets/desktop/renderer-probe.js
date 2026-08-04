'use strict';

(() => {
  const native = window.GameDeckAndroid;
  const startedAt = performance.now();
  let terminal = false;

  const send = (method, payload) => {
    if (terminal || !native || typeof native[method] !== 'function') return;
    terminal = true;
    try { native[method](JSON.stringify(payload)); } catch {}
  };

  const describeError = value => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    return { message: String(value || 'Unknown renderer error') };
  };

  addEventListener('error', event => {
    send('reportRendererError', {
      phase: 'window-error',
      ...describeError(event.error || event.message),
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0
    });
  });

  addEventListener('unhandledrejection', event => {
    send('reportRendererError', { phase: 'unhandled-rejection', ...describeError(event.reason) });
  });

  const timer = setInterval(() => {
    if (terminal) {
      clearInterval(timer);
      return;
    }

    const loadingPanel = document.querySelector('#appLoading');
    const loading = document.body.classList.contains('is-loading')
      || (loadingPanel && !loadingPanel.classList.contains('hidden'));
    const header = document.querySelector('.app-header');
    const content = document.querySelector('.content');
    const libraryView = document.querySelector('[data-view-panel="home"], #homeView, #games');

    if (!loading && header && content && libraryView && window.deck) {
      clearInterval(timer);
      send('reportRendererReady', {
        phase: 'ready',
        title: document.title,
        elapsedMs: Math.round(performance.now() - startedAt),
        renderer: 'shared-desktop',
        navigation: [...document.querySelectorAll('.nav[data-view]')].map(item => item.dataset.view),
        gameCards: document.querySelectorAll('.game').length,
        catalogCards: document.querySelectorAll('.catalog-game').length
      });
      return;
    }

    if (performance.now() - startedAt > 30000) {
      clearInterval(timer);
      send('reportRendererError', {
        phase: 'startup-timeout',
        elapsedMs: Math.round(performance.now() - startedAt),
        hasDeck: Boolean(window.deck),
        hasHeader: Boolean(header),
        hasContent: Boolean(content),
        hasLibraryView: Boolean(libraryView),
        bodyClass: document.body.className
      });
    }
  }, 250);
})();
