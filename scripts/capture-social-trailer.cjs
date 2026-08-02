'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const WebSocket = require('ws');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..');
const youtubeDir = path.join(root, 'marketing', 'youtube');
const captureDir = path.join(youtubeDir, 'capture');
const portFile = path.join(process.env.APPDATA || '', 'GameDeck', 'DevToolsActivePort');
const outputFile = path.join(youtubeDir, 'GameDeck-Motion-Capture.mp4');
const captureFps = 10;

if (!fs.existsSync(portFile)) {
  throw new Error('GameDeck is not running with DevTools enabled. Missing: ' + portFile);
}

fs.rmSync(captureDir, { recursive: true, force: true });
fs.mkdirSync(captureDir, { recursive: true });

const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then(response => response.json());
  const target = targets.find(item => item.title === 'GameDeck') || targets[0];
  if (!target) throw new Error('No GameDeck DevTools target was found.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let requestId = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    return result.result.value;
  };

  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await evaluate("document.body.style.cursor='none';document.documentElement.style.scrollBehavior='smooth';true");

  let frame = 0;
  const grab = async () => {
    const image = await call('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 84,
      fromSurface: true
    });
    fs.writeFileSync(path.join(captureDir, String(frame++).padStart(6, '0') + '.jpg'), Buffer.from(image.data, 'base64'));
  };

  const segment = async (name, seconds, action) => {
    console.log('SEGMENT', name);
    if (action) await evaluate(action);
    await sleep(700);
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const started = Date.now();
      await grab();
      const delay = Math.round(1000 / captureFps) - (Date.now() - started);
      if (delay > 0) await sleep(delay);
    }
  };

  await segment('library', 4, "document.querySelector('[data-view=\"home\"]')?.click();window.scrollTo(0,0);true");
  await segment('library-scroll', 4, "window.scrollTo({top:420,behavior:'smooth'});true");
  await segment('n64', 4, "([...document.querySelectorAll('.system')].find(x=>x.innerText.includes('Nintendo 64'))||{}).click?.();window.scrollTo(0,0);true");
  await segment('n64-scroll', 3, "window.scrollTo({top:520,behavior:'smooth'});true");
  await segment('surprise', 4, "document.querySelector('[data-view=\"home\"]')?.click();setTimeout(()=>document.querySelector('#surpriseMe')?.click(),400);true");
  await segment('discover', 4, "document.querySelector('[data-view=\"discover\"]')?.click();window.scrollTo(0,0);true");
  await segment('discover-scroll', 4, "window.scrollTo({top:540,behavior:'smooth'});true");
  await segment('search', 4, "document.querySelector('[data-view=\"home\"]')?.click();setTimeout(()=>{const e=document.querySelector('#search');if(e){e.value='Mario';e.dispatchEvent(new Event('input',{bubbles:true}))}},450);window.scrollTo(0,0);true");
  await segment('favorites', 4, "document.querySelector('[data-view=\"favorites\"]')?.click();window.scrollTo(0,0);true");
  await segment('recent', 4, "document.querySelector('[data-view=\"recent\"]')?.click();window.scrollTo(0,0);true");
  await segment('community', 4, "document.querySelector('[data-view=\"community\"]')?.click();window.scrollTo(0,0);true");
  await segment('community-scroll', 3, "window.scrollTo({top:500,behavior:'smooth'});true");
  await segment('final-library', 4, "document.querySelector('[data-view=\"home\"]')?.click();window.scrollTo(0,0);true");

  socket.close();

  cp.execFileSync(ffmpeg, [
    '-framerate', String(captureFps),
    '-i', path.join(captureDir, '%06d.jpg'),
    '-vf', 'fps=30,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-movflags', '+faststart',
    outputFile,
    '-y'
  ], { stdio: 'inherit' });

  console.log(JSON.stringify({ frames: frame, video: outputFile }));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
