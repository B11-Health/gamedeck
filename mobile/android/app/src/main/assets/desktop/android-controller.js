'use strict';

(() => {
  const native = window.GameDeckAndroid;
  const held = new Map();
  const state = { current: null, mode: false, lastInputAt: 0 };
  const directions = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);
  const focusSelector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '.nav',
    '.system',
    '.game',
    '.catalog-game',
    '.console-card',
    '.community-card',
    '.settings-card'
  ].join(',');

  const visible = element => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) < 0.05) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 12 && rect.height >= 12;
  };

  const focusables = () => [...document.querySelectorAll(focusSelector)]
    .filter(visible)
    .filter(element => !element.closest('[inert], .hidden'));

  const haptic = type => {
    try { native?.haptic?.(type || 'tick'); } catch {}
  };

  const showControllerMode = () => {
    state.mode = true;
    state.lastInputAt = performance.now();
    document.documentElement.classList.add('controller-mode');
    ensureHints();
  };

  const hideControllerMode = () => {
    state.mode = false;
    document.documentElement.classList.remove('controller-mode');
    document.querySelectorAll('.controller-pressed').forEach(item => item.classList.remove('controller-pressed'));
  };

  const ensureHints = () => {
    if (document.querySelector('#androidControllerHints')) return;
    const hints = document.createElement('div');
    hints.id = 'androidControllerHints';
    hints.setAttribute('aria-hidden', 'true');
    hints.innerHTML = '<span><b>A</b>Select</span><span><b>B</b>Back</span><span><b>X</b>Favorite</span><span><b>L/R</b>Tabs</span>';
    document.body.appendChild(hints);
  };

  const clearFocus = () => {
    document.querySelectorAll('.controller-focus').forEach(element => element.classList.remove('controller-focus'));
  };

  const setFocus = (element, options = {}) => {
    if (!visible(element)) return false;
    if (state.current === element && element.classList.contains('controller-focus')) return true;
    clearFocus();
    state.current = element;
    element.classList.add('controller-focus');
    if (!element.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
      element.setAttribute('tabindex', '-1');
      element.dataset.controllerTabindex = 'true';
    }
    try { element.focus({ preventScroll: true }); } catch { try { element.focus(); } catch {} }
    if (options.scroll !== false) {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: options.smooth ? 'smooth' : 'auto' });
    }
    if (!options.silent) haptic('tick');
    return true;
  };

  const initialFocus = () => {
    const preferred = [
      '.primary-nav .nav.active',
      '#catalogFeatureAction:not([disabled])',
      '.game',
      '.catalog-game',
      'button:not([disabled])'
    ].map(selector => document.querySelector(selector)).find(visible);
    const target = preferred || focusables()[0];
    if (target) setFocus(target, { silent: true });
    return target;
  };

  const center = element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect };
  };

  const directionalScore = (from, to, direction) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let primary;
    let secondary;
    if (direction === 'LEFT') { if (dx >= -4) return Infinity; primary = -dx; secondary = Math.abs(dy); }
    else if (direction === 'RIGHT') { if (dx <= 4) return Infinity; primary = dx; secondary = Math.abs(dy); }
    else if (direction === 'UP') { if (dy >= -4) return Infinity; primary = -dy; secondary = Math.abs(dx); }
    else { if (dy <= 4) return Infinity; primary = dy; secondary = Math.abs(dx); }
    const anglePenalty = secondary / Math.max(1, primary);
    const overlap = direction === 'LEFT' || direction === 'RIGHT'
      ? Math.max(0, Math.min(from.rect.bottom, to.rect.bottom) - Math.max(from.rect.top, to.rect.top))
      : Math.max(0, Math.min(from.rect.right, to.rect.right) - Math.max(from.rect.left, to.rect.left));
    return primary + secondary * 2.3 + anglePenalty * 180 - Math.min(overlap, 80) * 1.3;
  };

  const move = direction => {
    showControllerMode();
    const items = focusables();
    if (!items.length) return;
    if (!state.current || !visible(state.current) || !items.includes(state.current)) {
      initialFocus();
      if (!state.current || !visible(state.current)) return;
    }
    if ((direction === 'LEFT' || direction === 'RIGHT') && state.current?.matches('.primary-nav .nav')) {
      const tabs = [...document.querySelectorAll('.primary-nav .nav')].filter(visible);
      const index = tabs.indexOf(state.current);
      const next = tabs[index + (direction === 'RIGHT' ? 1 : -1)];
      if (next) {
        setFocus(next, { smooth: true });
        return;
      }
      haptic('edge');
      return;
    }
    const from = center(state.current);
    let best = null;
    let bestScore = Infinity;
    for (const candidate of items) {
      if (candidate === state.current) continue;
      const score = directionalScore(from, center(candidate), direction);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) setFocus(best, { smooth: true });
    else {
      const scroller = document.querySelector('.content') || document.scrollingElement;
      const amount = direction === 'UP' || direction === 'DOWN' ? Math.round(innerHeight * .55) : Math.round(innerWidth * .55);
      if (direction === 'UP') scroller?.scrollBy({ top: -amount, behavior: 'smooth' });
      if (direction === 'DOWN') scroller?.scrollBy({ top: amount, behavior: 'smooth' });
      if (direction === 'LEFT') scroller?.scrollBy({ left: -amount, behavior: 'smooth' });
      if (direction === 'RIGHT') scroller?.scrollBy({ left: amount, behavior: 'smooth' });
      haptic('edge');
    }
  };

  const pressVisual = element => {
    if (!element) return;
    element.classList.add('controller-pressed');
    setTimeout(() => element.classList.remove('controller-pressed'), 130);
  };

  const activate = () => {
    showControllerMode();
    const target = state.current && visible(state.current) ? state.current : initialFocus();
    if (!target) return;
    pressVisual(target);
    haptic('confirm');
    if (target instanceof HTMLSelectElement) {
      target.focus();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return;
    }
    target.click();
    setTimeout(() => {
      if (!visible(state.current)) initialFocus();
    }, 100);
  };

  const back = () => {
    showControllerMode();
    const menu = document.querySelector('#headerMenu');
    if (menu && !menu.classList.contains('hidden')) {
      document.querySelector('#headerMenuToggle')?.click();
      haptic('back');
      return;
    }
    const closers = [...document.querySelectorAll('[data-close], .modal-close, .dialog-close, [aria-label*="Close" i]')].filter(visible);
    if (closers.length) {
      closers[closers.length - 1].click();
      haptic('back');
      return;
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    haptic('back');
  };

  const favorite = () => {
    showControllerMode();
    const card = state.current?.closest('.game, .catalog-game, .spotlight, .catalog-feature') || state.current;
    const button = card?.querySelector('.fav, [data-action="favorite"], [aria-label*="favorite" i]');
    if (button && visible(button)) {
      pressVisual(button);
      button.click();
      haptic('confirm');
    } else haptic('edge');
  };

  const details = () => {
    showControllerMode();
    const target = state.current?.closest('.game, .catalog-game, .console-card') || state.current;
    if (target && visible(target)) {
      pressVisual(target);
      target.click();
      haptic('confirm');
    }
  };

  const switchTab = delta => {
    showControllerMode();
    const tabs = [...document.querySelectorAll('.primary-nav .nav')].filter(visible);
    if (!tabs.length) return;
    const active = Math.max(0, tabs.findIndex(tab => tab.classList.contains('active')));
    const next = tabs[(active + delta + tabs.length) % tabs.length];
    next.click();
    setTimeout(() => setFocus(next, { silent: true }), 80);
    haptic('tab');
  };

  const page = delta => {
    showControllerMode();
    const scroller = document.querySelector('.content') || document.scrollingElement;
    scroller?.scrollBy({ top: delta * Math.round(innerHeight * .78), behavior: 'smooth' });
    haptic('tick');
  };

  const selectMenu = () => {
    showControllerMode();
    document.querySelector('#headerMenuToggle')?.click();
    setTimeout(() => {
      const first = [...document.querySelectorAll('#headerMenu button, #headerMenu a')].find(visible);
      if (first) setFocus(first, { silent: true });
    }, 80);
    haptic('confirm');
  };

  const dispatch = input => {
    if (directions.has(input)) return move(input);
    if (input === 'A') return activate();
    if (input === 'B') return back();
    if (input === 'X') return favorite();
    if (input === 'Y') return details();
    if (input === 'L1') return switchTab(-1);
    if (input === 'R1') return switchTab(1);
    if (input === 'L2') return page(-1);
    if (input === 'R2') return page(1);
    if (input === 'SELECT') return selectMenu();
    if (input === 'START') {
      showControllerMode();
      window.GameDeckMultiplayer?.open?.();
      haptic('confirm');
    }
  };

  const release = input => {
    const timer = held.get(input);
    if (!timer) return;
    clearTimeout(timer.timeout);
    clearInterval(timer.interval);
    held.delete(input);
  };

  const handle = (input, pressed) => {
    const key = String(input || '').toUpperCase();
    if (!pressed) return release(key);
    if (held.has(key)) return;
    dispatch(key);
    if (!directions.has(key)) return;
    const record = { timeout: 0, interval: 0 };
    record.timeout = setTimeout(() => {
      record.interval = setInterval(() => dispatch(key), 82);
    }, 285);
    held.set(key, record);
  };

  window.GameDeckInput = Object.freeze({ handle });

  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse') hideControllerMode();
  }, true);
  document.addEventListener('mousemove', hideControllerMode, { passive: true });
  document.addEventListener('focusin', event => {
    if (state.mode && visible(event.target)) setFocus(event.target, { silent: true, scroll: false });
  });

  const observer = new MutationObserver(() => {
    if (!state.mode) return;
    if (!state.current || !visible(state.current) || !document.contains(state.current)) initialFocus();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'hidden'] });

  ensureHints();
})();
