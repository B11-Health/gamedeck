const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('headless');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><main class="content" style="display:block;grid-column:auto;padding:24px;overflow:auto">
<section class="spotlight" id="spotlight">
  <div class="feature-backdrop"><img class="is-ready" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>
  <div class="spotlight-art"><img alt="Game cover" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>
  <div class="spotlight-copy">
    <div class="eyebrow">NINTENDO GAMECUBE</div>
    <h2>A deliberately long selected game title that must never collide with controls</h2>
    <div class="feature-detail-head"><div class="feature-facts"><span>Ready</span><span>4 players</span></div></div>
    <p class="feature-description">Controller-first local and online play with truthful status and recovery guidance.</p>
    <p class="feature-status">Ready when you are.</p>
  </div>
  <div class="spotlight-actions">
    <div class="spotlight-primary-actions">
      <button type="button" class="primary">Play now</button><button type="button" class="online">Multiplayer</button><button type="button">Save</button>
    </div>
    <div class="spotlight-utility-actions">
      <button type="button"><span>▧</span><b>Artwork</b></button><button type="button"><span>↻</span><b>Details</b></button><button type="button" class="danger"><span>⌫</span><b>Remove</b></button>
    </div>
  </div>
</section></main></body></html>`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const closeToZero = value => String(value).split(',').every(part => parseFloat(part) <= 0.001);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const results = [];
  for (const width of [1440, 1080, 820, 480]) {
    win.setBounds({ x: 0, y: 0, width, height: 900 });
    await sleep(80);
    const result = await win.webContents.executeJavaScript(`(() => {
      const spotlight = document.querySelector('.spotlight');
      const actions = document.querySelector('.spotlight-actions');
      const copy = document.querySelector('.spotlight-copy');
      const buttons = [...document.querySelectorAll('.spotlight-actions button')];
      const sr = spotlight.getBoundingClientRect();
      const ar = actions.getBoundingClientRect();
      const cr = copy.getBoundingClientRect();
      return {
        width: innerWidth,
        spotlight: { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom },
        actions: { left: ar.left, top: ar.top, right: ar.right, bottom: ar.bottom },
        copy: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom },
        buttons: buttons.map(button => {
          const r = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return { text: button.innerText.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, fontSize: parseFloat(style.fontSize) };
        })
      };
    })()`);
    for (const button of result.buttons) {
      assert(button.height >= 43.5, `${width}px ${button.text} height ${button.height} is below 44px`);
      assert(button.width > 0, `${width}px ${button.text} has zero width`);
      assert(button.left >= result.spotlight.left - 1 && button.right <= result.spotlight.right + 1, `${width}px ${button.text} clips horizontally`);
      assert(button.top >= result.spotlight.top - 1 && button.bottom <= result.spotlight.bottom + 1, `${width}px ${button.text} clips vertically`);
    }
    for (const button of result.buttons.slice(3)) assert(button.fontSize >= 10, `${width}px ${button.text} utility text is too small`);
    if (width >= 821) assert(result.copy.right <= result.actions.left + 1, `${width}px copy overlaps spotlight actions`);
    results.push(result);
  }

  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(40);
    const motion = await win.webContents.executeJavaScript(`(() => ({
      spotlight: getComputedStyle(document.querySelector('.spotlight')).transitionDuration,
      backdrop: getComputedStyle(document.querySelector('.feature-backdrop img')).transitionDuration
    }))()`);
    assert(closeToZero(motion.spotlight), `reduced-motion spotlight transition remains ${motion.spotlight}`);
    assert(closeToZero(motion.backdrop), `reduced-motion backdrop transition remains ${motion.backdrop}`);
    win.webContents.debugger.detach();
  } finally {
    win.destroy();
  }
  console.log(`spotlight layout probe: ${results.length} viewport scenarios passed`);
  app.quit();
}).catch(error => {
  console.error(error.stack || error.message || error);
  app.exit(1);
});
