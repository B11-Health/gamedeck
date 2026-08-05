const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('headless');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<section class="launch-handoff visible" id="launchHandoff" role="status">
  <div class="launch-handoff-card">
    <div class="launch-handoff-art"><span>OB</span></div>
    <div class="launch-handoff-copy">
      <span class="launch-handoff-kicker">OPENING FULLSCREEN</span>
      <b>A deliberately long OpenBOR title that must remain readable and centered</b>
      <small>GameDeck is opening an isolated OpenBOR session, preserving aspect ratio, and handing over controller focus.</small>
    </div>
    <span class="launch-handoff-spinner"></span>
  </div>
  <div class="launch-handoff-foot"><span>CONTROLLER READY</span><span>FULLSCREEN HANDOFF</span><span>GAMEDECK STAYS OPEN</span></div>
</section></body></html>`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const inside = (inner, outer, tolerance = 1) => inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
const zeroDurations = value => String(value).split(',').every(item => parseFloat(item) <= 0.001);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const scenarios = [];
  for (const [width, height] of [[1440, 900], [1080, 720], [980, 650], [660, 720], [480, 720]]) {
    win.setBounds({ x: 0, y: 0, width, height });
    await sleep(80);
    const result = await win.webContents.executeJavaScript(`(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      const panel = document.querySelector('.launch-handoff');
      const card = document.querySelector('.launch-handoff-card');
      const art = document.querySelector('.launch-handoff-art');
      const copy = document.querySelector('.launch-handoff-copy');
      const title = document.querySelector('.launch-handoff-copy b');
      const spinner = document.querySelector('.launch-handoff-spinner');
      const foot = document.querySelector('.launch-handoff-foot');
      return {
        viewport: { left:0, top:0, right:innerWidth, bottom:innerHeight, width:innerWidth, height:innerHeight },
        panel: rect(panel), card: rect(card), art: rect(art), copy: rect(copy), title: rect(title), spinner: rect(spinner), foot: rect(foot),
        titleOverflow: title.scrollWidth > title.clientWidth + 1,
        copyOverflow: copy.scrollWidth > copy.clientWidth + 1 || copy.scrollHeight > copy.clientHeight + 1,
        panelOverflow: panel.scrollWidth > innerWidth + 1 || panel.scrollHeight > innerHeight + 1,
        artRatio: art.getBoundingClientRect().width / art.getBoundingClientRect().height
      };
    })()`);
    assert(inside(result.card, result.viewport), `${width}x${height}: launch card clips outside viewport`);
    assert(inside(result.foot, result.viewport), `${width}x${height}: launch footer clips outside viewport`);
    assert(inside(result.art, result.card), `${width}x${height}: artwork clips outside card`);
    assert(inside(result.copy, result.card), `${width}x${height}: copy clips outside card`);
    assert(inside(result.spinner, result.card), `${width}x${height}: spinner clips outside card`);
    assert.equal(result.panelOverflow, false, `${width}x${height}: panel creates scroll overflow`);
    assert.equal(result.copyOverflow, false, `${width}x${height}: copy overflows its grid area`);
    assert(result.artRatio > 0.76 && result.artRatio < 0.84, `${width}x${height}: artwork ratio ${result.artRatio} is not 4:5`);
    scenarios.push(result);
  }

  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(40);
    const motion = await win.webContents.executeJavaScript(`(() => ({
      panel: getComputedStyle(document.querySelector('.launch-handoff')).transitionDuration,
      card: getComputedStyle(document.querySelector('.launch-handoff-card')).transitionDuration,
      sweep: getComputedStyle(document.querySelector('.launch-handoff-card'), '::after').animationName
    }))()`);
    assert(zeroDurations(motion.panel), `reduced-motion panel transition remains ${motion.panel}`);
    assert(zeroDurations(motion.card), `reduced-motion card transition remains ${motion.card}`);
    assert.equal(motion.sweep, 'none', `reduced-motion sweep remains ${motion.sweep}`);
    win.webContents.debugger.detach();
  } finally {
    win.destroy();
  }

  console.log(`launch handoff layout: ${scenarios.length} viewport scenarios passed`);
  app.quit();
}).catch(error => {
  console.error(error.stack || error.message || error);
  app.exit(1);
});
