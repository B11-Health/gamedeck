const REPO='B11-Health/gamedeck';
const RELEASE='https://github.com/'+REPO+'/releases/latest';
const STABLE_API='https://api.github.com/repos/'+REPO+'/releases/latest';
const PREVIEW_API='https://api.github.com/repos/'+REPO+'/releases/tags/community-preview';
const CONTROLLER_API='https://api.github.com/repos/'+REPO+'/releases/tags/android-preview';
const ANDROID_DIRECT='https://github.com/'+REPO+'/releases/download/community-preview/GameDeck-Android-community-preview.apk';
const CONTROLLER_DIRECT='https://github.com/'+REPO+'/releases/download/android-preview/GameDeck-Controller-Android-preview.apk';

const platforms={
  windows:{label:'Installer · x64',score:a=>/\.(exe|msi)$/i.test(a.name)&&!/portable|blockmap|sha256|checksum/i.test(a.name)?(/setup|installer/i.test(a.name)?3:2):0},
  mac:{label:'Universal DMG',score:a=>/\.dmg$/i.test(a.name)&&!/blockmap/i.test(a.name)?3:0},
  linux:{label:'AppImage or DEB',score:a=>/\.AppImage$/i.test(a.name)?3:/\.deb$/i.test(a.name)?2:0},
  android:{label:'Full GameDeck APK',score:a=>/GameDeck-Android.*\.apk$/i.test(a.name)&&!/Controller/i.test(a.name)?5:0}
};
const ua=navigator.userAgent||'';
const platformKey=/Android/i.test(ua)?'android':/Windows|Win64|Win32/i.test(ua)?'windows':/Macintosh|Mac OS X/i.test(ua)?'mac':/Linux/i.test(ua)?'linux':'';
const platformNames={windows:'Windows',mac:'macOS',linux:'Linux',android:'Android'};

function formatBytes(value){if(!Number.isFinite(value)||value<=0)return'';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+units[i]}
function bestAsset(assets,config){return[...(assets||[])].map(asset=>({asset,score:config.score(asset)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Number(b.asset.size||0)-Number(a.asset.size||0))[0]?.asset||null}
function applyAutoDownload(cards){if(!platformKey||!cards[platformKey])return;const card=cards[platformKey];document.querySelectorAll('[data-download="auto"]').forEach(link=>{link.href=card.href;link.textContent='Download for '+platformNames[platformKey]})}
async function releaseJson(url){try{const r=await fetch(url,{headers:{Accept:'application/vnd.github+json'}});return r.ok?await r.json():null}catch{return null}}

async function hydrateRelease(){
  const cards={};
  document.querySelectorAll('[data-platform]').forEach(card=>{cards[card.dataset.platform]=card});
  const [preview,stable,controllerRelease]=await Promise.all([releaseJson(PREVIEW_API),releaseJson(STABLE_API),releaseJson(CONTROLLER_API)]);
  const previewAssets=preview?.assets||[];
  const stableAssets=stable?.assets||[];
  const preferred=previewAssets.length?previewAssets:stableAssets;
  for(const[key,config]of Object.entries(platforms)){
    const card=cards[key];if(!card)continue;
    const asset=bestAsset(preferred,config)||bestAsset(stableAssets,config);
    if(asset){card.href=asset.browser_download_url;const size=formatBytes(asset.size);card.querySelector('[data-asset-detail]').textContent=config.label+(size?' · '+size:'');card.classList.remove('unavailable')}
    else if(key==='android'){card.href=ANDROID_DIRECT}
    else{card.href=RELEASE;card.classList.add('unavailable');card.querySelector('em').textContent='View release'}
  }
  const controllerAssets=[...(controllerRelease?.assets||[]),...previewAssets];
  const controllerAsset=controllerAssets.find(a=>/GameDeck-Controller-Android.*\.apk$/i.test(a.name));
  document.querySelectorAll('[data-controller-android]').forEach(link=>link.href=controllerAsset?.browser_download_url||CONTROLLER_DIRECT);
  const version=document.querySelector('#releaseVersion');
  const status=document.querySelector('#releaseStatus');
  const previewVersion=String(preview?.name||'').match(/(\d+\.\d+\.\d+)/)?.[1]||'';
  const stableVersion=String(stable?.tag_name||'').replace(/^v/,'');
  if(version)version.textContent='GameDeck '+(previewVersion||stableVersion||'');
  if(status)status.textContent=previewAssets.length?'Preview build':'Latest release';
  applyAutoDownload(cards);
}
hydrateRelease();
