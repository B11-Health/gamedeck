const REPO='B11-Health/gamedeck';
const RELEASE=`https://github.com/${REPO}/releases/latest`;
const API=`https://api.github.com/repos/${REPO}/releases/latest`;
const COMMUNITY_PREVIEW_API=`https://api.github.com/repos/${REPO}/releases/tags/community-preview`;
const ANDROID_PREVIEW_API=`https://api.github.com/repos/${REPO}/releases/tags/android-preview`;
const ANDROID_DIRECT=`https://github.com/${REPO}/releases/download/community-preview/GameDeck-Android-community-preview.apk`;
const CONTROLLER_ANDROID_DIRECT=`https://github.com/${REPO}/releases/download/community-preview/GameDeck-Controller-Android-community-preview.apk`;
const platforms={
  windows:{label:'Installer · x64',score:asset=>/\.(exe|msi)$/i.test(asset.name)&&!/blockmap|sha256|checksum/i.test(asset.name)?(/setup|installer/i.test(asset.name)?3:2):0},
  mac:{label:'DMG · macOS',score:asset=>/\.dmg$/i.test(asset.name)?(/universal/i.test(asset.name)?3:2):0},
  linux:{label:'AppImage or DEB',score:asset=>/\.AppImage$/i.test(asset.name)?3:/\.deb$/i.test(asset.name)?2:0},
  android:{label:'Full GameDeck APK',score:asset=>/\.apk$/i.test(asset.name)&&!/Controller/i.test(asset.name)?(/community-preview/i.test(asset.name)?6:/release/i.test(asset.name)?4:/debug/i.test(asset.name)?2:3):0}
};
const userAgent=navigator.userAgent||'';
const platformKey=/Android/i.test(userAgent)?'android':/Windows|Win64|Win32/i.test(userAgent)?'windows':/Macintosh|Mac OS X/i.test(userAgent)?'mac':/Linux/i.test(userAgent)?'linux':'';
const platformNames={windows:'Windows',mac:'macOS',linux:'Linux',android:'Android'};
function formatBytes(value){if(!Number.isFinite(value)||value<=0)return'';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+units[i]}
function bestAsset(assets,config){return[...(assets||[])].map(asset=>({asset,score:config.score(asset)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||Number(b.asset.size||0)-Number(a.asset.size||0))[0]?.asset||null}
function setAutoLink(cards){if(!platformKey||!cards[platformKey])return;const card=cards[platformKey];document.querySelectorAll('[data-download="auto"]').forEach(link=>{link.href=card.href;link.textContent=`Download for ${platformNames[platformKey]}`})}
function upgradeAndroidMessaging(){
  document.title='GameDeck — Full deck + separate phone controller';
  const description=document.querySelector('meta[name="description"]');
  if(description)description.content='Open-source, local-first GameDeck for Windows, macOS, Linux, and Android, plus a separate GameDeck Controller for iPhone, iPad, Android, and browsers. Full GameDeck installs participate in the Freenet-backed community; Controller clients pair to a GameDeck.';
  const schema=document.querySelector('script[type="application/ld+json"]');
  if(schema){try{const data=JSON.parse(schema.textContent);data.softwareVersion='1.3.0-controller-preview';data.downloadUrl=`https://github.com/${REPO}/releases/tag/community-preview`;data.description='Open-source, local-first game library with separate GameDeck and GameDeck Controller downloads. Full GameDeck handles local gameplay and Freenet-backed community services; Controller clients provide WebRTC screen and input without bundling the game library.';schema.textContent=JSON.stringify(data)}catch{}}
  const androidCard=document.querySelector('[data-platform="android"]');
  if(androidCard){androidCard.href=ANDROID_DIRECT;const detail=androidCard.querySelector('[data-asset-detail]');if(detail)detail.textContent='Community Preview · full GameDeck APK';}
  const controllerLink=document.querySelector('[data-controller-android]');
  if(controllerLink)controllerLink.href=CONTROLLER_ANDROID_DIRECT;
}
upgradeAndroidMessaging();
async function hydrateRelease(){
  const cards={};
  document.querySelectorAll('[data-platform]').forEach(card=>{cards[card.dataset.platform]=card;card.href=card.dataset.platform==='android'?ANDROID_DIRECT:RELEASE});
  try{
    const stableResponse=await fetch(API,{headers:{Accept:'application/vnd.github+json'}});
    if(!stableResponse.ok)throw new Error('release unavailable');
    const stable=await stableResponse.json();
    let preview=null;
    try{const response=await fetch(COMMUNITY_PREVIEW_API,{headers:{Accept:'application/vnd.github+json'}});if(response.ok)preview=await response.json()}catch{}
    const stableAssets=stable.assets||[];
    let previewAssets=preview?.assets||[];
    if(!bestAsset(previewAssets,platforms.android)){try{const response=await fetch(ANDROID_PREVIEW_API,{headers:{Accept:'application/vnd.github+json'}});if(response.ok){const androidPreview=await response.json();previewAssets=[...previewAssets,...(androidPreview.assets||[])]}}catch{}}
    const usePreview=previewAssets.some(asset=>Object.values(platforms).some(config=>config.score(asset)>0));
    const controllerAsset=previewAssets.find(asset=>/GameDeck-Controller-Android.*\.apk$/i.test(asset.name));
    const controllerLink=document.querySelector('[data-controller-android]');
    if(controllerLink){controllerLink.href=controllerAsset?.browser_download_url||CONTROLLER_ANDROID_DIRECT;const detail=controllerLink.querySelector('[data-controller-asset-detail]');if(detail&&controllerAsset){const size=formatBytes(controllerAsset.size);detail.textContent=`Android controller-only APK${size?' · '+size:''}`;}}
    const previewName=String(preview?.name||'GameDeck Community Preview 1.3.0-preview.2').replace(/^GameDeck\s*/i,'');
    const version=usePreview?previewName:String(stable.tag_name||'').replace(/^v/,'');
    document.querySelector('#releaseVersion').textContent=`GameDeck ${version}`;
    const checksum=[...previewAssets,...stableAssets].find(asset=>/sha256|checksums?/i.test(asset.name));
    document.querySelector('#releaseStatus').textContent=usePreview?(checksum?'Matching preview builds + checksums':'Matching community preview builds'):(checksum?'Assets + checksums available':'Release assets available');
    for(const[key,config]of Object.entries(platforms)){
      const card=cards[key];if(!card)continue;
      const previewAsset=bestAsset(previewAssets,config);
      const stableAsset=bestAsset(stableAssets,config);
      const asset=previewAsset||stableAsset;
      if(!asset){if(key==='android'){card.href=ANDROID_DIRECT;card.classList.remove('unavailable');continue}card.classList.add('unavailable');card.querySelector('em').textContent='View release';continue}
      card.classList.remove('unavailable');card.href=asset.browser_download_url;
      card.dataset.channel=previewAsset?'preview':'stable';
      const size=formatBytes(asset.size);
      const prefix=previewAsset?'Community Preview · ':'';
      card.querySelector('[data-asset-detail]').textContent=`${prefix}${config.label}${size?' · '+size:''}`;
      card.querySelector('em').textContent=key==='android'?'Download APK':'Download';
    }
    document.querySelectorAll('[data-stable-release]').forEach(link=>link.href=stable.html_url||RELEASE);
    setAutoLink(cards);
  }catch{
    document.querySelector('#releaseStatus').textContent='Open the latest GitHub release';
    if(cards.android)cards.android.href=ANDROID_DIRECT;
    setAutoLink(cards);
  }
}
hydrateRelease();
function hydrateLiveEvent(){
  const event=document.querySelector('#liveEvent');
  const status=document.querySelector('#liveEventStatus');
  if(!event||!status)return;
  const start=Date.parse(event.dataset.start||'');
  const end=Date.parse(event.dataset.end||'');
  const countdown=milliseconds=>{
    const totalMinutes=Math.max(1,Math.ceil(milliseconds/60000));
    if(totalMinutes<60)return 'Starts in '+totalMinutes+' minute'+(totalMinutes===1?'':'s');
    const hours=Math.floor(totalMinutes/60);
    const minutes=totalMinutes%60;
    return 'Starts in '+hours+' hour'+(hours===1?'':'s')+(minutes?' '+minutes+' minute'+(minutes===1?'':'s'):'');
  };
  const update=()=>{
    const now=Date.now();
    if(!Number.isFinite(start)||!Number.isFinite(end)||now>=end){event.hidden=true;return}
    event.hidden=false;
    status.textContent=now<start?countdown(start-now):'Live now · Ends at midnight ET';
  };
  update();
  const timer=setInterval(()=>{update();if(event.hidden)clearInterval(timer)},30000);
}
hydrateLiveEvent();