const REPO='B11-Health/gamedeck';
const RELEASE=`https://github.com/${REPO}/releases/latest`;
const API=`https://api.github.com/repos/${REPO}/releases/latest`;
const COMMUNITY_PREVIEW_API=`https://api.github.com/repos/${REPO}/releases/tags/community-preview`;
const ANDROID_PREVIEW_API=`https://api.github.com/repos/${REPO}/releases/tags/android-preview`;
const ANDROID_DIRECT=`https://github.com/${REPO}/releases/download/community-preview/GameDeck-Android-community-preview.apk`;
const platforms={
  windows:{label:'Installer · x64',score:asset=>/\.(exe|msi)$/i.test(asset.name)&&!/blockmap|sha256|checksum/i.test(asset.name)?(/setup|installer/i.test(asset.name)?3:2):0},
  mac:{label:'DMG · macOS',score:asset=>/\.dmg$/i.test(asset.name)?(/universal/i.test(asset.name)?3:2):0},
  linux:{label:'AppImage or DEB',score:asset=>/\.AppImage$/i.test(asset.name)?3:/\.deb$/i.test(asset.name)?2:0},
  android:{label:'Standalone APK · premium touch',score:asset=>/\.apk$/i.test(asset.name)?(/community-preview/i.test(asset.name)?6:/release/i.test(asset.name)?4:/debug/i.test(asset.name)?2:3):0}
};
const userAgent=navigator.userAgent||'';
const platformKey=/Android/i.test(userAgent)?'android':/Windows|Win64|Win32/i.test(userAgent)?'windows':/Macintosh|Mac OS X/i.test(userAgent)?'mac':/Linux/i.test(userAgent)?'linux':'';
const platformNames={windows:'Windows',mac:'macOS',linux:'Linux',android:'Android'};
function formatBytes(value){if(!Number.isFinite(value)||value<=0)return'';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+units[i]}
function bestAsset(assets,config){return[...(assets||[])].map(asset=>({asset,score:config.score(asset)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||Number(b.asset.size||0)-Number(a.asset.size||0))[0]?.asset||null}
function setAutoLink(cards){if(!platformKey||!cards[platformKey])return;const card=cards[platformKey];document.querySelectorAll('[data-download="auto"]').forEach(link=>{link.href=card.href;link.textContent=`Download for ${platformNames[platformKey]}`})}
function upgradeAndroidMessaging(){
  document.title='GameDeck — Desktop, Android library, and phone controller';
  const description=document.querySelector('meta[name="description"]');
  if(description)description.content='Open-source, local-first GameDeck for Windows, macOS, Linux, and Android. The Android preview includes standalone GameDeck plus GameDeck Controller for Wi-Fi gameplay streaming and input, optional Bluetooth HID, touch, motion, and haptics.';
  const schema=document.querySelector('script[type="application/ld+json"]');
  if(schema){try{const data=JSON.parse(schema.textContent);data.softwareVersion='1.3.0-controller-preview';data.downloadUrl=`https://github.com/${REPO}/releases/tag/community-preview`;data.description='Open-source, local-first game library with a combined Android preview: standalone GameDeck plus GameDeck Controller for Wi-Fi screen and control, optional Bluetooth HID, touch, motion, haptics, Couch Co-op, Remote Play Together, and synchronized netplay.';schema.textContent=JSON.stringify(data)}catch{}}
  const mobileCard=[...document.querySelectorAll('.feature-grid article')].find(card=>card.querySelector('h3')?.textContent.includes('GameDeck Mobile'));
  if(mobileCard){mobileCard.querySelector('h3').textContent='Android deck + phone controller';mobileCard.querySelector('p').textContent='One APK gives you standalone GameDeck plus GameDeck Controller. Stream gameplay and controls over local Wi-Fi, use optional Bluetooth HID for controller-only input, switch portrait or landscape, and use touch, motion, or a physical gamepad.'}
  const guide=document.querySelectorAll('.install-guide article');
  if(guide[1])guide[1].innerHTML='<b>Android preview</b><span>Install the Community Preview APK. Launch GameDeck for the on-device library, or GameDeck Controller to pair with your desktop over local Wi-Fi.</span>';
  if(guide[2])guide[2].innerHTML='<b>Controller Mode</b><span>Use the Switch-style touch rails, phone motion, haptics, or a physical gamepad. On Android 9+, optional Bluetooth HID can send controller input directly; gameplay video still uses Wi-Fi.</span>';
  const androidCard=document.querySelector('[data-platform="android"]');
  if(androidCard){androidCard.href=ANDROID_DIRECT;const detail=androidCard.querySelector('[data-asset-detail]');if(detail)detail.textContent='Community Preview · standalone APK';}
  if(!document.querySelector('.android-preview-banner')){
    const banner=document.createElement('section');
    banner.className='android-preview-banner';
    banner.innerHTML='<div><p class="eyebrow">ANDROID GAMEDECK + CONTROLLER</p><h2>Your library. Your phone. Your controller.</h2><p>The combined Android preview includes standalone GameDeck and a separate GameDeck Controller launcher. Pair over local Wi-Fi for low-latency gameplay video and controls, use Switch-style touch rails in portrait or landscape, add motion steering and haptics, or use optional Bluetooth HID on Android 9+ for controller-only input.</p></div><div class="actions"><a class="primary" href="'+ANDROID_DIRECT+'">Download Android APK</a><a class="secondary" href="https://github.com/'+REPO+'/pull/14">View controller implementation</a></div>';
    const hero=document.querySelector('.hero');
    if(hero)hero.insertAdjacentElement('afterend',banner);
    const style=document.createElement('style');
    style.textContent='.android-preview-banner{margin:24px auto 0;max-width:1180px;padding:28px;border:1px solid rgba(114,231,255,.25);border-radius:24px;background:radial-gradient(circle at 90% 10%,rgba(154,134,255,.18),transparent 34%),linear-gradient(145deg,rgba(15,25,39,.96),rgba(7,11,20,.98));display:flex;align-items:center;justify-content:space-between;gap:28px;box-shadow:0 24px 70px rgba(0,0,0,.35)}.android-preview-banner h2{margin:.35rem 0 .65rem;font-size:clamp(1.7rem,4vw,3rem);line-height:1}.android-preview-banner p:not(.eyebrow){max-width:760px;color:var(--muted,#9aa8ba);line-height:1.6}.android-preview-banner .actions{flex:0 0 auto;display:flex;gap:10px;flex-wrap:wrap}@media(max-width:800px){.android-preview-banner{margin:18px 14px 0;align-items:flex-start;flex-direction:column}.android-preview-banner .actions{width:100%}.android-preview-banner .actions a{flex:1;text-align:center}}';
    document.head.appendChild(style);
  }
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