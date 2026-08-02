'use strict';
const cp=require('child_process'),path=require('path'),fs=require('fs');
const ff=require('ffmpeg-static');
const root=path.resolve(__dirname,'..');
const y=path.join(root,'marketing','youtube');
const ch=path.join(y,'channel');
const output=path.join(y,'GameDeck-Official-Launch-YouTube.mp4');
const narration=process.env.GAMEDECK_NARRATION
 ? path.resolve(process.env.GAMEDECK_NARRATION)
 : path.join(y,'GameDeck-Launch-Narration-Gemini.wav');
function findMusic(){
 if(process.env.GAMEDECK_MUSIC){const explicit=path.resolve(process.env.GAMEDECK_MUSIC);if(!fs.existsSync(explicit))throw new Error('GAMEDECK_MUSIC does not exist: '+explicit);return explicit;}
 const downloads=path.join(process.env.USERPROFILE||'','Downloads');
 const matches=fs.existsSync(downloads)?fs.readdirSync(downloads).filter(name=>/^Quiet Focus.*\.mp3$/i.test(name)).map(name=>{const file=path.join(downloads,name);return{file,mtime:fs.statSync(file).mtimeMs}}).sort((a,b)=>b.mtime-a.mtime):[];
 if(!matches.length)throw new Error('No Quiet Focus MP3 found. Set GAMEDECK_MUSIC to an owner-supplied track.');
 return matches[0].file;
}
const music=findMusic();
for(const required of [narration,music,path.join(y,'GameDeck-Motion-Capture.mp4'),path.join(y,'GameDeck-Official-Launch.mp4')])if(!fs.existsSync(required))throw new Error('Missing render input: '+required);
const args=[
 '-loop','1','-t','4.5','-i',path.join(ch,'gamedeck-youtube-banner.jpg'),
 '-i',path.join(y,'GameDeck-Motion-Capture.mp4'),
 '-i',path.join(y,'GameDeck-Official-Launch.mp4'),
 '-loop','1','-t','6','-i',path.join(ch,'gamedeck-end-card.jpg'),
 '-i',narration,
 '-i',music,
 '-loop','1','-i',path.join(ch,'overlays','01-one-library.png'),
 '-loop','1','-i',path.join(ch,'overlays','02-counts.png'),
 '-loop','1','-i',path.join(ch,'overlays','03-features.png'),
 '-loop','1','-i',path.join(ch,'overlays','04-open-source.png')
];
const filter=[
 "[0:v]scale=1920:1080,zoompan=z='min(zoom+0.00035,1.035)':d=135:s=1920x1080:fps=30,trim=duration=4.5,setpts=PTS-STARTPTS[v0]",
 "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,trim=duration=28.5,setpts=PTS-STARTPTS[v1]",
 "[2:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,trim=start=0:duration=34,setpts=PTS-STARTPTS[v2]",
 "[3:v]scale=1920:1080,zoompan=z='min(zoom+0.00025,1.025)':d=180:s=1920x1080:fps=30,trim=duration=6,setpts=PTS-STARTPTS[v3]",
 "[v0][v1]xfade=transition=fade:duration=0.8:offset=3.7[v01]",
 "[v01][v2]xfade=transition=smoothleft:duration=0.8:offset=31.4[v012]",
 "[v012][v3]xfade=transition=fadeblack:duration=0.8:offset=64.6[vx]",
 "[6:v]scale=1920:1080,format=rgba,trim=duration=70.6,setpts=PTS-STARTPTS[ov1]",
 "[7:v]scale=1920:1080,format=rgba,trim=duration=70.6,setpts=PTS-STARTPTS[ov2]",
 "[8:v]scale=1920:1080,format=rgba,trim=duration=70.6,setpts=PTS-STARTPTS[ov3]",
 "[9:v]scale=1920:1080,format=rgba,trim=duration=70.6,setpts=PTS-STARTPTS[ov4]",
 "[vx][ov1]overlay=0:0:enable='between(t,6,12)':shortest=1:eof_action=pass[o1]",
 "[o1][ov2]overlay=0:0:enable='between(t,15,22)':shortest=1:eof_action=pass[o2]",
 "[o2][ov3]overlay=0:0:enable='between(t,34,42)':shortest=1:eof_action=pass[o3]",
 "[o3][ov4]overlay=0:0:enable='between(t,52,60)':shortest=1:eof_action=pass,fade=t=out:st=69.5:d=1[v]",
 "[4:a]adelay=1500|1500,aresample=48000,volume=1.05,asplit=2[side][mixvoice]",
 "[5:a]atrim=0:70.6,asetpts=PTS-STARTPTS,volume=0.28,afade=t=in:st=0:d=2,afade=t=out:st=66.5:d=4[music]",
 "[music][side]sidechaincompress=threshold=0.035:ratio=12:attack=15:release=350:makeup=1[ducked]",
 "[mixvoice][ducked]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-14:TP=-1.5:LRA=7,alimiter=limit=0.95[a]"
].join(';');
args.push('-filter_complex',filter,'-map','[v]','-map','[a]','-r','30','-c:v','libx264','-preset','medium','-crf','18','-profile:v','high','-level','4.2','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000','-movflags','+faststart','-t','70.6',output,'-y');
const run=cp.spawnSync(ff,args,{stdio:'inherit'});if(run.status!==0)process.exit(run.status||1);console.log(JSON.stringify({output,size:fs.statSync(output).size}));
