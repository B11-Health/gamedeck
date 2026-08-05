const REPO='B11-Health/gamedeck';
const RELEASE=`https://github.com/${REPO}/releases/latest`;
const API=`https://api.github.com/repos/${REPO}/releases/latest`;
const ANDROID_PREVIEW_API=`https://api.github.com/repos/${REPO}/releases/tags/android-preview`;
const platforms={
  windows:{label:'Installer · x64',score:asset=>/\.(exe|msi)$/i.test(asset.name)&&!/blockmap|sha256|checksum/i.test(asset.name)?(/setup|installer/i.test(asset.name)?3:2):0},
  mac:{label:'DMG · macOS',score:asset=>/\.dmg$/i.test(asset.name)?(/universal/i.test(asset.name)?3:2):0},
  linux:{label:'AppImage or DEB',score:asset=>/\.AppImage$/i.test(asset.name)?3:/\.deb$/i.test(asset.name)?2:0},
  android:{label:'APK · controller + touch',score:asset=>/\.apk$/i.test(asset.name)?(/release/i.test(asset.name)?4:/debug/i.test(asset.name)?2:3):0}
};
const userAgent=navigator.userAgent||'';
const platformKey=/Android/i.test(userAgent)?'android':/Windows|Win64|Win32/i.test(userAgent)?'windows':/Macintosh|Mac OS X/i.test(userAgent)?'mac':/Linux/i.test(userAgent)?'linux':'';
const platformNames={windows:'Windows',mac:'macOS',linux:'Linux',android:'Android'};
function formatBytes(value){if(!Number.isFinite(value)||value<=0)return'';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+units[i]}
function bestAsset(assets,config){return[...(assets||[])].map(asset=>({asset,score:config.score(asset)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||Number(b.asset.size||0)-Number(a.asset.size||0))[0]?.asset||null}
function setAutoLink(cards){if(!platformKey||!cards[platformKey])return;const card=cards[platformKey];document.querySelectorAll('[data-download="auto"]').forEach(link=>{link.href=card.href;link.textContent=`Download for ${platformNames[platformKey]}`})}
async function hydrateRelease(){
  const cards={};
  document.querySelectorAll('[data-platform]').forEach(card=>{cards[card.dataset.platform]=card;card.href=RELEASE});
  try{
    const response=await fetch(API,{headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw new Error('release unavailable');
    const release=await response.json();
    const version=String(release.tag_name||'').replace(/^v/,'');
    if(version)document.querySelector('#releaseVersion').textContent=`GameDeck ${version}`;
    let assets=release.assets||[];
    if(!bestAsset(assets,platforms.android)){try{const previewResponse=await fetch(ANDROID_PREVIEW_API,{headers:{Accept:'application/vnd.github+json'}});if(previewResponse.ok){const preview=await previewResponse.json();assets=[...assets,...(preview.assets||[])]}}catch{}}
    const checksum=assets.find(asset=>/sha256|checksums?/i.test(asset.name));
    document.querySelector('#releaseStatus').textContent=release.prerelease?'Preview release':checksum?'Assets + checksums available':'Release assets available';
    for(const[key,config]of Object.entries(platforms)){
      const card=cards[key];if(!card)continue;
      const asset=bestAsset(assets,config);
      if(!asset){card.classList.add('unavailable');card.querySelector('em').textContent='View release';continue}
      card.classList.remove('unavailable');card.href=asset.browser_download_url;
      const size=formatBytes(asset.size);card.querySelector('[data-asset-detail]').textContent=`${config.label}${size?' · '+size:''}`;
      if(key==='android')card.querySelector('em').textContent='Download APK';
    }
    setAutoLink(cards);
  }catch{
    document.querySelector('#releaseStatus').textContent='Open the latest GitHub release';
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
