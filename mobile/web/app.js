const $=selector=>document.querySelector(selector);
let viewerId='';
let code='';
let peer=null;
let pollTimer=null;
let installPrompt=null;
let streamInfo=null;

function deviceLabel(){
  const saved=localStorage.getItem('gamedeck:device-name');
  if(saved)return saved;
  const platform=navigator.userAgentData?.platform||navigator.platform||'Mobile device';
  return `${platform} receiver`;
}

function setConnection(value){
  $('#connection').textContent=String(value||'').toUpperCase();
}

async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',headers:{'content-type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));
  if(!response.ok||body.ok===false){const error=Error(body.error||`HTTP ${response.status}`);error.status=response.status;throw error}
  return body;
}

function pairingError(error){
  const status=Number(error?.status||0);
  const message=String(error?.message||'');
  if(status===404||/HTTP 404|not found/i.test(message))return 'GameDeck host not found. Open this page from the address or QR code shown on the host.';
  if(status===401||status===403||/invalid|expired|pairing code/i.test(message))return 'That pairing code is invalid or expired. Request a fresh code from the host.';
  if(/Failed to fetch|NetworkError|Load failed/i.test(message))return 'Could not reach the GameDeck host. Confirm both devices are on the same network.';
  return message||'Could not connect to GameDeck. Check the host and try again.';
}

async function sendSignal(payload){
  if(!viewerId)return;
  await api('/api/signal',{method:'POST',body:JSON.stringify({code,viewerId,payload})});
}

function closePeer(){
  if(peer){try{peer.close()}catch{}peer=null}
  $('#video').srcObject=null;
  $('#waiting').classList.remove('hidden');
  setConnection('disconnected');
}

async function createPeer(){
  closePeer();
  peer=new RTCPeerConnection({iceServers:[]});
  peer.ontrack=event=>{
    const stream=event.streams?.[0]||new MediaStream([event.track]);
    $('#video').srcObject=stream;
    $('#video').play().catch(()=>{});
    $('#waiting').classList.add('hidden');
  };
  peer.onicecandidate=event=>{
    if(event.candidate)sendSignal({candidate:event.candidate.toJSON()}).catch(()=>{});
  };
  peer.onconnectionstatechange=()=>{
    setConnection(peer?.connectionState||'closed');
    if(['failed','closed'].includes(peer?.connectionState))$('#waiting').classList.remove('hidden');
  };
}

async function handleSignal(payload){
  if(payload.description){
    if(!peer)await createPeer();
    await peer.setRemoteDescription(payload.description);
    if(payload.description.type==='offer'){
      const answer=await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal({description:peer.localDescription});
    }
  }else if(payload.candidate){
    if(!peer)await createPeer();
    await peer.addIceCandidate(payload.candidate).catch(()=>{});
  }
}

async function poll(){
  if(!viewerId)return;
  try{
    const result=await api(`/api/messages?viewerId=${encodeURIComponent(viewerId)}&code=${encodeURIComponent(code)}`);
    streamInfo=result.stream||streamInfo;
    $('#streamTitle').textContent=streamInfo?.title||'GameDeck Live';
    $('#streamMeta').textContent=`${streamInfo?.sourceName||'GameDeck'} · ${streamInfo?.viewerCount||1} viewer${streamInfo?.viewerCount===1?'':'s'}`;
    $('#quality').textContent=streamInfo?.quality||'1080p';
    for(const message of result.messages||[]){
      if(message.type==='signal')await handleSignal(message.payload||{});
      if(message.type==='stream-stopped')throw Error('The stream ended on the computer.');
    }
    pollTimer=setTimeout(poll,450);
  }catch(error){
    setConnection('offline');
    $('#waiting').classList.remove('hidden');
    $('#waiting b').textContent='Stream unavailable';
    $('#waiting small').textContent=error.message;
    pollTimer=setTimeout(poll,2200);
  }
}

async function pair(event){
  event?.preventDefault();
  $('#pairError').classList.add('hidden');
  code=$('#pairCode').value.replace(/\D/g,'').slice(0,6);
  const label=$('#deviceName').value.trim()||deviceLabel();
  if(code.length!==6){
    $('#pairError').textContent='Enter the six-digit code from GameDeck.';
    $('#pairError').classList.remove('hidden');
    return;
  }
  try{
    const result=await api('/api/pair',{method:'POST',body:JSON.stringify({code,label})});
    viewerId=result.viewerId;
    streamInfo=result.stream;
    localStorage.setItem('gamedeck:device-name',label);
    history.replaceState(null,'',`/?code=${code}`);
    $('#pairCard').classList.add('hidden');
    $('#playerCard').classList.remove('hidden');
    $('#streamTitle').textContent=streamInfo.title||'GameDeck Live';
    $('#streamMeta').textContent=`${streamInfo.sourceName||'GameDeck'} · connecting`;
    $('#quality').textContent=streamInfo.quality||'1080p';
    setConnection('pairing');
    await createPeer();
    poll();
  }catch(error){
    $('#pairError').textContent=pairingError(error);
    $('#pairError').classList.remove('hidden');
  }
}

async function disconnect(){
  clearTimeout(pollTimer);
  if(viewerId)api('/api/leave',{method:'POST',body:JSON.stringify({code,viewerId})}).catch(()=>{});
  viewerId='';
  closePeer();
  $('#playerCard').classList.add('hidden');
  $('#pairCard').classList.remove('hidden');
}

$('#pairForm').addEventListener('submit',pair);
$('#disconnect').onclick=disconnect;
$('#fullscreen').onclick=()=>$('#videoShell').requestFullscreen?.();
$('#mute').onclick=()=>{
  const video=$('#video');video.muted=!video.muted;$('#mute').textContent=video.muted?'Unmute':'Mute';
};
$('#install').onclick=async()=>{
  if(!installPrompt)return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(()=>{});
  installPrompt=null;
  $('#install').classList.add('hidden');
};
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();installPrompt=event;$('#install').classList.remove('hidden');
});
window.addEventListener('beforeunload',()=>{if(viewerId)navigator.sendBeacon('/api/leave',JSON.stringify({code,viewerId}))});

const preset=new URLSearchParams(location.search).get('code')||'';
$('#pairCode').value=preset.replace(/\D/g,'').slice(0,6);
$('#deviceName').value=deviceLabel();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
if($('#pairCode').value.length===6)pair();
