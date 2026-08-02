'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..');
const source = path.resolve(
  process.env.GAMEDECK_SHORT_SOURCE ||
  path.join(root, 'marketing', 'youtube', 'GameDeck-Official-Launch-YouTube.mp4')
);
const outputDir = path.resolve(
  process.env.GAMEDECK_SHORT_OUTPUT_DIR ||
  path.join(root, 'dist', 'social')
);
const slug = String(process.env.GAMEDECK_SHORT_SLUG || '30s').replace(/[^a-z0-9-]+/gi, '-');
const output = path.join(outputDir, `GameDeck-Short-${slug}-1080x1920.mp4`);
const captions = path.join(outputDir, `GameDeck-Short-${slug}-1080x1920.srt`);
const captionCopy = path.join(outputDir, `GameDeck-Short-${slug}-Caption.txt`);
const start = String(process.env.GAMEDECK_SHORT_START || '4.5');
const duration = String(process.env.GAMEDECK_SHORT_DURATION || '30');
const preset = process.env.GAMEDECK_SHORT_PRESET || 'medium';
const headline = process.env.GAMEDECK_SHORT_HEADLINE || 'YOUR LIBRARY. ONE BEAUTIFUL DECK.';
const messages = [
  process.env.GAMEDECK_SHORT_MESSAGE_1 || 'ONE INSTALL. ONE BEAUTIFUL GAME LIBRARY.',
  process.env.GAMEDECK_SHORT_MESSAGE_2 || 'CONTROLLER-FIRST ON WINDOWS, MACOS & LINUX',
  process.env.GAMEDECK_SHORT_MESSAGE_3 || 'REMOTE PLAY TOGETHER. ONLY THE HOST NEEDS THE GAME.',
  process.env.GAMEDECK_SHORT_MESSAGE_4 || 'LOCAL FIRST. OPEN SOURCE. NO ROMS INCLUDED.',
  process.env.GAMEDECK_SHORT_MESSAGE_5 || 'GET GAMEDECK ON GITHUB'
];
const socialCopy = process.env.GAMEDECK_SHORT_COPY || 'One install. One beautiful game library. GameDeck is open source, local first, controller friendly, and now supports encrypted Remote Play Together. No ROMs included.';

if (!ffmpeg || !fs.existsSync(ffmpeg)) {
  throw new Error('ffmpeg-static is not installed. Run npm install first.');
}
if (!fs.existsSync(source)) {
  throw new Error(`Short-form source video is missing: ${source}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const fontCandidates = [
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
];
const font = fontCandidates.find(file => fs.existsSync(file));
if (!font) {
  throw new Error('No supported bold system font was found for the social overlay.');
}

const escapeFilter = value => String(value)
  .replace(/\\/g, '/')
  .replace(/:/g, '\\:')
  .replace(/'/g, "\\'");
const fontArg = escapeFilter(font);
const text = value => String(value)
  .replace(/:/g, '\\:')
  .replace(/'/g, "\\'");
const draw = (copy, y, size, enable = '') => {
  const gate = enable ? `:enable='${enable}'` : '';
  return `drawtext=fontfile='${fontArg}':text='${text(copy)}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.75:shadowx=0:shadowy=4${gate}`;
};

const filters = [
  '[0:v]split=2[bg0][fg0]',
  '[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30,eq=brightness=-0.19:saturation=0.72[bg]',
  '[fg0]scale=1000:-2,setsar=1[fg]',
  '[bg][fg]overlay=(W-w)/2:(H-h)/2-36,' +
    'drawbox=x=0:y=0:w=iw:h=270:color=black@0.52:t=fill,' +
    'drawbox=x=0:y=1510:w=iw:h=410:color=black@0.64:t=fill,' +
    draw('GAMEDECK', 74, 76) + ',' +
    draw(headline, 172, 30) + ',' +
    draw(messages[0], 1580, 43, 'between(t,0,6)') + ',' +
    draw(messages[1], 1580, 39, 'between(t,6,12)') + ',' +
    draw(messages[2], 1580, 31, 'between(t,12,18)') + ',' +
    draw(messages[3], 1580, 38, 'between(t,18,24)') + ',' +
    draw(messages[4], 1580, 46, 'between(t,24,30)') + ',' +
    draw('github.com/B11-Health/gamedeck', 1754, 30) +
    ',setsar=1[v]'
].join(';');

const args = [
  '-y', '-hide_banner',
  '-ss', start,
  '-t', duration,
  '-i', source,
  '-filter_complex', filters,
  '-map', '[v]',
  '-map', '0:a?',
  '-c:v', 'libx264',
  '-preset', preset,
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-ar', '48000',
  '-r', '30',
  '-movflags', '+faststart',
  '-shortest',
  output
];

const result = spawnSync(ffmpeg, args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'pipe']
});
if (result.status !== 0) {
  throw new Error(`FFmpeg short render failed:\n${String(result.stderr || '').slice(-5000)}`);
}

const srtTimes = [['00:00:00,000','00:00:06,000'],['00:00:06,000','00:00:12,000'],['00:00:12,000','00:00:18,000'],['00:00:18,000','00:00:24,000'],['00:00:24,000','00:00:30,000']];
fs.writeFileSync(captions, messages.map((message, index) => `${index + 1}\r\n${srtTimes[index][0]} --> ${srtTimes[index][1]}\r\n${message}\r\n`).join('\r\n'));

fs.writeFileSync(captionCopy, `${socialCopy}\r\n\r\nhttps://b11-health.github.io/gamedeck/\r\n\r\n#GameDeck #OpenSource #RetroGaming #PCGaming #RemotePlay\r\n`);

console.log(JSON.stringify({
  output,
  captions,
  captionCopy,
  bytes: fs.statSync(output).size
}, null, 2));
