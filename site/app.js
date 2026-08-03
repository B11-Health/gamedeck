const REPO='B11-Health/gamedeck';const RELEASE='https://github.com/'+REPO+'/releases/latest';const API='https://api.github.com/repos/'+REPO+'/releases/latest';const fallback={windows:{label:'Installer · x64',test:a=>/\.exe$/i.test(a.name)&&!/portable/i.test(a.name)},mac:{label:'Universal DMG · Intel + Apple Silicon',test:a=>/\.dmg$/i.test(a.name)},linux:{label:'AppImage · x64',test:a=>/\.AppImage$/i.test(a.name)}};const platformText=/Win/i.test(navigator.userAgent)?'Windows':/Mac/i.test(navigator.userAgent)?'macOS':/Linux/i.test(navigator.userAgent)?'Linux':'';function formatBytes(value){if(!Number.isFinite(value)||value<=0)return'';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+units[i]}function setAutoLink(cards){if(!platformText)return;const key=platformText==='Windows'?'windows':platformText==='macOS'?'mac':'linux';const card=cards[key];if(!card)return;document.querySelectorAll('[data-download="auto"]').forEach(a=>{a.href=card.href;a.textContent='Download for '+platformText})}async function hydrateRelease(){const cards={};document.querySelectorAll('[data-platform]').forEach(a=>{cards[a.dataset.platform]=a;a.href=RELEASE});try{const response=await fetch(API,{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error('release unavailable');const release=await response.json();const version=String(release.tag_name||'').replace(/^v/,'');if(version)document.querySelector('#releaseVersion').textContent='GameDeck '+version;document.querySelector('#releaseStatus').textContent=release.prerelease?'Preview release':'Release assets verified';for(const [key,config] of Object.entries(fallback)){const asset=(release.assets||[]).find(config.test);if(!asset)continue;cards[key].href=asset.browser_download_url;const detail=cards[key].querySelector('[data-asset-detail]');const size=formatBytes(asset.size);detail.textContent=config.label+(size?' · '+size:'')}setAutoLink(cards)}catch{document.querySelector('#releaseStatus').textContent='Open the latest GitHub release';setAutoLink(cards)}}hydrateRelease();
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
