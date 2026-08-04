'use strict';

(() => {
  const native = window.GameDeckAndroid;
  const startedAt = performance.now();
  let appInfo = {};
  try { appInfo = JSON.parse(native?.appInfo?.() || '{}'); } catch {}
  const requireFixture = Boolean(appInfo.debugFixture);
  let terminal = false;
  let sawLoading = false;
  let stableSince = 0;

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

    const stage = document.querySelector('#appLoading');
    const bodyLoading = document.body.classList.contains('is-loading');
    const stageVisible = Boolean(stage && !stage.classList.contains('hidden') && getComputedStyle(stage).display !== 'none');
    if (bodyLoading && stageVisible) sawLoading = true;

    const loadingComplete = Boolean(
      sawLoading
      && stage
      && stage.classList.contains('hidden')
      && !bodyLoading
      && document.querySelector('#loadingPercent')?.textContent?.trim() === '100%'
    );
    const header = document.querySelector('.app-header');
    const content = document.querySelector('.content');
    const hero = document.querySelector('.hero');
    const libraryToolbar = document.querySelector('#libraryToolbar');
    const games = document.querySelector('#games');
    const emptyState = document.querySelector('#empty');
    const gameCards = document.querySelectorAll('.game').length;
    const firstTitle = document.querySelector('.game .meta > b')?.textContent?.trim() || '';
    const firstArtwork = document.querySelector('.game [data-game-art]')?.getAttribute('src') || '';
    const description = document.querySelector('#spotlightDescription')?.textContent?.trim() || '';
    const facts = document.querySelector('#spotlightFacts')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const fixtureReady = !requireFixture || Boolean(
      gameCards >= 1
      && firstTitle === 'Chrono Trigger'
      && firstArtwork.startsWith('data:image/svg+xml')
      && description.includes('time-traveling role-playing adventure')
      && facts.includes('1995')
      && facts.includes('Role-playing')
    );
    const activeLibrarySurface = Boolean(
      header
      && content
      && hero
      && libraryToolbar
      && games
      && hero.getBoundingClientRect().height > 0
      && content.getBoundingClientRect().height > 0
      && fixtureReady
    );

    if (loadingComplete && activeLibrarySurface && window.deck) {
      if (!stableSince) stableSince = performance.now();
      if (performance.now() - stableSince >= 900) {
        clearInterval(timer);
        send('reportRendererReady', {
          phase: 'ready',
          title: document.title,
          elapsedMs: Math.round(performance.now() - startedAt),
          renderer: 'shared-desktop',
          startupObserved: true,
          fixtureVerified: requireFixture,
          loadingPercent: document.querySelector('#loadingPercent')?.textContent?.trim() || '',
          navigation: [...document.querySelectorAll('.nav[data-view]')].map(item => item.dataset.view),
          gameCards,
          catalogCards: document.querySelectorAll('.catalog-game').length,
          firstGameTitle: firstTitle,
          artworkKind: firstArtwork.split(':')[0] || '',
          descriptionVerified: description.includes('time-traveling role-playing adventure'),
          factsVerified: facts.includes('1995') && facts.includes('Role-playing'),
          emptyStateVisible: Boolean(emptyState && !emptyState.classList.contains('hidden'))
        });
      }
    } else {
      stableSince = 0;
    }

    if (performance.now() - startedAt > 45000) {
      clearInterval(timer);
      send('reportRendererError', {
        phase: 'startup-timeout',
        elapsedMs: Math.round(performance.now() - startedAt),
        requireFixture,
        sawLoading,
        bodyLoading,
        stageClass: stage?.className || '',
        loadingPercent: document.querySelector('#loadingPercent')?.textContent?.trim() || '',
        hasDeck: Boolean(window.deck),
        hasHeader: Boolean(header),
        hasContent: Boolean(content),
        hasHero: Boolean(hero),
        hasToolbar: Boolean(libraryToolbar),
        gameCards,
        firstTitle,
        firstArtwork: firstArtwork.slice(0, 80),
        description: description.slice(0, 180),
        facts: facts.slice(0, 180),
        bodyClass: document.body.className
      });
    }
  }, 200);
})();
