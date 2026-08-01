'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const WebSocket = require('ws');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'marketing', 'youtube');
const model = 'gemini-3.1-flash-tts-preview';
const voice = 'Sulafat';
const frameRate = 30;

fs.mkdirSync(out, { recursive: true });

const transcript = [
  'Your games were never meant to disappear into folders.',
  'GameDeck brings the collection you legally own into one cinematic, controller-first library.',
  'From classic consoles and arcade favorites to modern emulation, every system feels connected.',
  'GameDeck scans local files, checks emulator readiness, matches artwork, and puts every title one move away.',
  'Browse by system. Search the catalog. Save favorites. Resume recent games.',
  'Or let Surprise Me choose what comes next.',
  'Setup stays visible. Downloads stay understandable. Your collection stays local-first.',
  'Built for Windows, macOS, and Linux, GameDeck is open source, community driven, and designed around the games already yours.',
  "This is more than a launcher. It's your library. Your history. Your deck. GameDeck."
].join(' ');

const ttsPrompt = `# AUDIO PROFILE
A premium technology and entertainment launch narrator with a warm, resonant, contemporary voice. Natural American English. Confident and magnetic, but never a stereotypical movie-trailer announcer.

# SCENE
A sophisticated cinematic product film for an open-source gaming app. Dark room, glowing interface, restrained electronic music underneath. The listener should feel discovery, nostalgia, and control.

# DIRECTOR'S NOTES
Deliver the exact transcript in approximately 52 to 62 seconds. Use clean articulation and an assured conversational pace. Give the short feature sentences distinct, elegant pauses. Build gently through the platform statement, then slow down and land the final lines with emotional weight. No shouting, no cheesy hype, no added words, and do not read these instructions.

# TRANSCRIPT
${transcript}`;

function activePort() {
  const file = path.join(process.env.APPDATA || '', 'GameDeck', 'DevToolsActivePort');
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
}

async function connect() {
  const targets = await fetch(`http://127.0.0.1:${activePort()}/json`).then(response => response.json());
  const target = targets.find(item => item.title === 'GameDeck') || targets[0];
  if (!target) throw new Error('GameDeck DevTools target was not found.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let sequence = 0;
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
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  return { socket, call };
}

function waveBuffer(pcm, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write('RIFF');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function findAudioBlock(payload) {
  if (payload.output_audio?.data) return payload.output_audio;
  let audio = null;
  for (const step of payload.steps || []) {
    for (const content of step.content || []) {
      if (content?.type === 'audio' && content.data) audio = content;
    }
  }
  return audio;
}

async function synthesizeNarration(file) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required. The production workflow no longer falls back to Windows SAPI.');
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: ttsPrompt,
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice }]
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = raw;
    try {
      message = JSON.parse(raw).error?.message || raw;
    } catch {}
    throw new Error(`Gemini TTS HTTP ${response.status}: ${message.slice(0, 1600)}`);
  }

  const audio = findAudioBlock(JSON.parse(raw));
  if (!audio?.data) throw new Error('Gemini returned no audio block.');

  const bytes = Buffer.from(audio.data, 'base64');
  if (audio.mime_type === 'audio/wav') {
    fs.writeFileSync(file, bytes);
  } else {
    fs.writeFileSync(file, waveBuffer(bytes, audio.sample_rate || 24000, audio.channels || 1));
  }

  return {
    model,
    voice,
    mimeType: audio.mime_type || 'audio/l16',
    sampleRate: audio.sample_rate || 24000,
    channels: audio.channels || 1
  };
}

function findMusic() {
  const explicit = process.env.GAMEDECK_MUSIC;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) throw new Error(`GAMEDECK_MUSIC does not exist: ${resolved}`);
    return resolved;
  }

  const downloads = path.join(process.env.USERPROFILE || '', 'Downloads');
  const candidates = fs.existsSync(downloads)
    ? fs.readdirSync(downloads)
        .filter(name => /^Quiet Focus.*\.mp3$/i.test(name))
        .map(name => {
          const file = path.join(downloads, name);
          return { file, modified: fs.statSync(file).mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified)
    : [];

  if (!candidates.length) {
    throw new Error('No Quiet Focus MP3 was found. Set GAMEDECK_MUSIC to an owner-supplied licensed track.');
  }

  return candidates[0].file;
}

function wavDuration(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bits = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);
  return dataSize / (sampleRate * channels * (bits / 8));
}

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function writeSubtitles(file, duration) {
  const captions = [
    'Your games were never meant to disappear into folders.',
    'GameDeck brings the collection you legally own into one cinematic, controller-first library.',
    'From classic consoles and arcade favorites to modern emulation, every system feels connected.',
    'GameDeck scans local files, checks emulator readiness, matches artwork, and puts every title one move away.',
    'Browse by system. Search the catalog. Save favorites. Resume recent games.',
    'Or let Surprise Me choose what comes next.',
    'Setup stays visible. Downloads stay understandable. Your collection stays local-first.',
    'Built for Windows, macOS, and Linux, GameDeck is open source, community driven, and designed around the games already yours.',
    "This is more than a launcher. It's your library. Your history. Your deck. GameDeck."
  ];

  const weights = captions.map(text => text.split(/\s+/).length);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const usable = Math.max(1, duration - 1.8);
  let cursor = 0.7;

  const blocks = captions.map((text, index) => {
    const length = usable * (weights[index] / totalWeight);
    const start = cursor;
    const end = Math.min(duration - 0.5, cursor + length);
    cursor = end;
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${text}\n`;
  });

  fs.writeFileSync(file, blocks.join('\n'));
}

(async () => {
  const { socket, call } = await connect();
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
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

  const capture = async name => {
    await new Promise(resolve => setTimeout(resolve, 1600));
    const image = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(image.data, 'base64'));
  };

  const scenes = [
    ['01-library', `document.querySelector('[data-view="home"]').click();window.scrollTo(0,0);true`],
    ['02-n64', `([...document.querySelectorAll('.system')].find(x=>x.innerText.includes('Nintendo 64'))||{}).click?.();true`],
    ['03-surprise', `document.querySelector('#surpriseMe')?.click();true`],
    ['04-discover', `document.querySelector('[data-view="discover"]').click();true`],
    ['05-search', `document.querySelector('#catalogSearch')&&(document.querySelector('#catalogSearch').value='Zelda',document.querySelector('#catalogSearch').dispatchEvent(new Event('input',{bubbles:true})));true`],
    ['06-favorites', `document.querySelector('[data-view="favorites"]').click();true`],
    ['07-recent', `document.querySelector('[data-view="recent"]').click();true`],
    ['08-community', `document.querySelector('[data-view="community"]').click();true`]
  ];

  for (const [name, expression] of scenes) {
    await evaluate(expression);
    await capture(name);
  }
  socket.close();

  const narrationFile = path.join(out, 'narration-gemini.wav');
  const narration = await synthesizeNarration(narrationFile);
  const narrationSeconds = wavDuration(narrationFile);
  const targetSeconds = Math.max(64, Math.ceil(narrationSeconds + 3));
  const sceneSeconds = targetSeconds / scenes.length;
  const musicFile = findMusic();
  const outputFile = path.join(out, 'GameDeck-Official-Launch.mp4');

  const args = [];
  for (const [name] of scenes) {
    args.push('-loop', '1', '-t', sceneSeconds.toFixed(3), '-i', path.join(out, `${name}.png`));
  }
  args.push('-i', narrationFile, '-i', musicFile);

  const sceneFilters = scenes.map((_, index) => {
    const frames = Math.round(sceneSeconds * frameRate);
    const fadeOut = Math.max(0, sceneSeconds - 0.6).toFixed(3);
    return `[${index}:v]scale=1920:1080:flags=lanczos,zoompan=z='min(zoom+0.00022,1.025)':d=${frames}:s=1920x1080:fps=${frameRate},fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.6,format=yuv420p[v${index}]`;
  }).join(';');

  const concat = scenes.map((_, index) => `[v${index}]`).join('');
  const narrationIndex = scenes.length;
  const musicIndex = scenes.length + 1;
  const musicFade = Math.max(0, targetSeconds - 2).toFixed(3);

  const filter = `${sceneFilters};${concat}concat=n=${scenes.length}:v=1:a=0,fade=t=out:st=${Math.max(0, targetSeconds - 1).toFixed(3)}:d=1[v];` +
    `[${narrationIndex}:a]aresample=48000,adelay=700|700,highpass=f=70,lowpass=f=14000,acompressor=threshold=-20dB:ratio=2.5:attack=15:release=140:makeup=3,loudnorm=I=-16:LRA=6:TP=-1.5,pan=stereo|c0=c0|c1=c0,asplit=2[voice_sc][voice_mix];` +
    `[${musicIndex}:a]atrim=start=0:end=${targetSeconds},asetpts=PTS-STARTPTS,aresample=48000,volume=0.42[music_raw];` +
    `[music_raw][voice_sc]sidechaincompress=threshold=0.035:ratio=9:attack=18:release=320:makeup=1[ducked];` +
    `[ducked]volume=0.36,afade=t=in:st=0:d=1.5,afade=t=out:st=${musicFade}:d=2[music];` +
    `[voice_mix][music]amix=inputs=2:duration=longest:dropout_transition=2,alimiter=limit=0.95,loudnorm=I=-14:LRA=8:TP=-1[a]`;

  args.push(
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(targetSeconds),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '19',
    '-profile:v', 'high',
    '-level', '4.1',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y',
    outputFile
  );

  cp.execFileSync(ffmpeg, args, { stdio: 'inherit' });

  fs.writeFileSync(path.join(out, 'NARRATION.txt'), `${transcript}\n`);
  fs.writeFileSync(path.join(out, 'TTS_PROMPT.txt'), `${ttsPrompt}\n`);
  writeSubtitles(path.join(out, 'GameDeck-Official-Launch.srt'), targetSeconds);

  const production = {
    video: path.basename(outputFile),
    resolution: '1920x1080',
    frameRate,
    durationSeconds: targetSeconds,
    narrationModel: narration.model,
    narrationVoice: narration.voice,
    narrationSource: 'Gemini API',
    music: path.basename(musicFile),
    mix: {
      integratedLoudnessTarget: '-14 LUFS',
      truePeakTarget: '-1 dBTP',
      sidechainDucking: true
    },
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(out, 'PRODUCTION.json'), `${JSON.stringify(production, null, 2)}\n`);
  console.log(`DONE ${outputFile}`);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
