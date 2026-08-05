'use strict';

(() => {
  const native = window.GameDeckAndroid;
  if (!native || typeof native.appInfo !== 'function' || typeof native.reportQaState !== 'function') return;

  let appInfo = {};
  try { appInfo = JSON.parse(native.appInfo() || '{}'); } catch {}
  if (!appInfo.debugFixture) return;

  let lastKey = '';

  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    return !element.classList.contains('hidden')
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity || '1') > 0.01;
  };

  const emit = () => {
    const view = document.querySelector('.nav.active[data-view]')?.dataset.view || '';
    const menuOpen = visible(document.querySelector('#headerMenu'));
    const orientation = innerWidth >= innerHeight ? 'landscape' : 'portrait';
    const scroller = document.querySelector('.content');
    const scrollTop = Math.round(Math.max(
      document.scrollingElement?.scrollTop || 0,
      document.documentElement?.scrollTop || 0,
      document.body?.scrollTop || 0,
      scroller?.scrollTop || 0
    ));
    const discoverVisible = visible(document.querySelector('#discover'));
    const communityVisible = visible(document.querySelector('#community'));
    const gamesVisible = visible(document.querySelector('#games'));
    const surface = communityVisible
      ? 'community'
      : discoverVisible
        ? 'discover'
        : gamesVisible
          ? 'library'
          : 'unknown';
    const header = document.querySelector('.app-shell-header');
    const headerRect = header?.getBoundingClientRect();
    const payload = {
      view,
      surface,
      menuOpen,
      orientation,
      width: innerWidth,
      height: innerHeight,
      scrollBucket: scrollTop > 240 ? 'scrolled' : 'top',
      gameCards: document.querySelectorAll('.game').length,
      catalogCards: document.querySelectorAll('.catalog-game').length,
      heroVisible: visible(document.querySelector('.hero')),
      spotlightVisible: visible(document.querySelector('#spotlight')),
      headerVisible: visible(header) && Boolean(headerRect && headerRect.bottom > 0 && headerRect.top < innerHeight),
      headerTop: Math.round(headerRect?.top || 0)
    };
    const key = JSON.stringify(payload);
    if (key === lastKey) return;
    lastKey = key;
    try { native.reportQaState(key); } catch {}
  };

  addEventListener('resize', () => setTimeout(emit, 120));
  addEventListener('orientationchange', () => setTimeout(emit, 220));
  document.addEventListener('click', () => setTimeout(emit, 80), true);
  document.addEventListener('scroll', () => setTimeout(emit, 80), true);
  setInterval(emit, 300);
  setTimeout(emit, 500);
})();
