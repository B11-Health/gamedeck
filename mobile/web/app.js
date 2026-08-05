const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const BUTTON_MAP=new Map([[0,0],[1,8],[2,1],[3,9],[4,10],[5,11],[6,12],[7,13],[8,2],[9,3],[10,14],[11,15],[12,4],[13,5],[14,6],[15,7]]);
let viewerId='';
let code='';
let peer=null;
let controlChannel=null;
let pollTimer=null;
let communityTimer=null;
let installPrompt=null;
let streamInfo=null;
let playerIndex=0;
let sequence=0;
let activeTab='play';
let touchEnabled=localStorage.getItem('gamedeck:touch-controls')!=='off';
let controllerState={connected:false,count:0,names:[]};
let gamepadFrame=0;
let gamepadButtons=new Map();
let fallbackEvents=[];
let fallbackTimer=null;
let chromeTimer=null;
let roomCache=[];
let chatCache=[];
const pointerButtons=new Map();
const buttonPressCounts=new Map();

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function deviceLabel(){const saved=localStorage.getItem('gamedeck:device-name');if(saved)return saved;const platform=navigator.userAgentData?.platform||navigator.platform||'Android';return `${platform} Player`.slice(0,40)}
function nativeBridge(){return window.GameDeckNative||null}
function haptic(style='tick'){
  try{if(nativeBridge()?.haptic){nativeBridge().haptic(style);return}}catch{}
  if(navigator.vibrate)navigator.vibrate(style==='warning'?[24,35,34]:style==='success'?28:style==='heavy'?36:12);
}
function setConnection(value){$('#connection').textContent=String(value||'').toUpperCase()}
function authQuery(){return `viewerId=${encodeURIComponent(viewerId)}&code=${encodeURIComponent(code)}`}
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',headers:{'content-type':'application/json',...(options.headers||{})},...options});const body=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));if(!response.ok||body.ok===false){const error=Error(body.error||`HTTP ${response.status}`);error.status=response.status;throw error}return body}
function pairingError(error){const status=Number(error?.status||0);const message=String(error?.message||'');if(status===404||/HTTP 404|not found/i.test(message))return'GameDeck host not found. Open this page from the address shown on the host.';if(status===401||status===403||/invalid|expired|pairing code/i.test(message))return'That pairing code is invalid or expired. Request a fresh code from the host.';if(/Failed to fetch|NetworkError|Load failed/i.test(message))return'Could not reach GameDeck. Confirm both devices are on the same network.';return message||'Could not connect to GameDeck.'}

function normalizedControllerState(value){
  try{if(typeof value==='string')value=JSON.parse(value)}catch{return{connected:false,count:0,names:[]}}
  return{connected:Boolean(value?.connected),count:Math.max(0,Number(value?.count||0)),names:Array.isArray(value?.names)?value.names.map(String).slice(0,4):[]};
}
function controllerLabel(){if(!controllerState.connected)return touchEnabled?'Touch controls active':'Touch controls hidden';const name=controllerState.names[0]||'Gamepad';return controllerState.count>1?`${controllerState.count} controllers connected`:`${name} connected`}
function applyControllerState(value,{notify=true}={}){
  controllerState=normalizedControllerState(value);
  document.body.classList.toggle('controller-connected',controllerState.connected);
  document.body.classList.toggle('touch-disabled',!touchEnabled);
  $('#controllerState').textContent=controllerLabel();
  $('#touchToggle').textContent=touchEnabled?'Hide touch':'Show touch';
  if(controllerState.connected)releaseTouchInputs();
  if(notify&&viewerId)sendControl({type:'controller-state',controllerConnected:controllerState.connected,events:[]});
}
function readNativeController(){try{return normalizedControllerState(nativeBridge()?.controllerState?.())}catch{return{connected:false,count:0,names:[]}}}
window.GameDeckAndroid={
  onControllerState:value=>applyControllerState(value),
  onNativeInput:event=>{if(!event)return;sendInputEvents([{id:Number(event.id),state:event.state?1:0}],'native')}
};

function showChrome(){
  document.body.classList.add('show-chrome');
  clearTimeout(chromeTimer);
  chromeTimer=setTimeout(()=>document.body.classList.remove('show-chrome'),4200);
}
function setTab(tab){
  activeTab=tab==='community'?'community':'play';
  document.body.classList.toggle('play-active',activeTab==='play');
  $$('#mobileTabs [data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===activeTab));
  $('#playerCard').classList.toggle('hidden',activeTab!=='play'||!viewerId);
  $('#communityPanel').classList.toggle('hidden',activeTab!=='community'||!viewerId);
  if(activeTab==='community')refreshCommunity(true);
  else showChrome();
}

async function sendSignal(payload){if(viewerId)await api('/api/signal',{method:'POST',body:JSON.stringify({code,viewerId,payload})})}
function closePeer(){if(controlChannel){try{controlChannel.close()}catch{}controlChannel=null}if(peer){try{peer.close()}catch{}peer=null}$('#video').srcObject=null;$('#waiting').classList.remove('hidden');setConnection('disconnected')}
function setControlChannel(channel){
  controlChannel=channel;
  channel.onopen=()=>{setConnection('connected');sendControl({type:'controller-state',controllerConnected:controllerState.connected,events:[]});haptic('success')};
  channel.onclose=()=>{controlChannel=null};
  channel.onmessage=event=>{
    try{const message=JSON.parse(String(event.data||''));if(message.type==='ready'){playerIndex=Math.max(0,Number(message.playerIndex||0));$('#playerSlot').textContent=`PLAYER ${playerIndex+1}`;sendControl({type:'controller-state',controllerConnected:controllerState.connected,events:[]})}if(message.type==='haptic')haptic(message.style||'tick')}catch{}
  };
}
async function createPeer(){
  closePeer();
  peer=new RTCPeerConnection({iceServers:[]});
  peer.ondatachannel=event=>{if(event.channel?.label==='gamedeck-control')setControlChannel(event.channel)};
  peer.ontrack=event=>{const stream=event.streams?.[0]||new MediaStream([event.track]);$('#video').srcObject=stream;$('#video').play().catch(()=>{});$('#waiting').classList.add('hidden');if(controllerState.connected)document.body.classList.remove('show-chrome')};
  peer.onicecandidate=event=>{if(event.candidate)sendSignal({candidate:event.candidate.toJSON()}).catch(()=>{})};
  peer.onconnectionstatechange=()=>{setConnection(peer?.connectionState||'closed');if(['failed','closed'].includes(peer?.connectionState))$('#waiting').classList.remove('hidden')};
}
async function handleSignal(payload){if(payload.description){if(!peer)await createPeer();await peer.setRemoteDescription(payload.description);if(payload.description.type==='offer'){const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await sendSignal({description:peer.localDescription})}}else if(payload.candidate){if(!peer)await createPeer();await peer.addIceCandidate(payload.candidate).catch(()=>{})}}
async function poll(){if(!viewerId)return;try{const result=await api(`/api/messages?${authQuery()}`);streamInfo=result.stream||streamInfo;$('#streamTitle').textContent=streamInfo?.title||'GameDeck';$('#streamMeta').textContent=`${streamInfo?.sourceName||'GameDeck'} · ${streamInfo?.viewerCount||1} connected`;$('#quality').textContent=streamInfo?.quality||'1080p';for(const message of result.messages||[]){if(message.type==='signal')await handleSignal(message.payload||{});if(message.type==='stream-stopped')throw Error('The stream ended on the computer.')}pollTimer=setTimeout(poll,420)}catch(error){setConnection('offline');$('#waiting').classList.remove('hidden');$('#waiting b').textContent='Stream unavailable';$('#waiting small').textContent=error.message;pollTimer=setTimeout(poll,1800)}}

function scheduleFallbackInput(){
  if(fallbackTimer||!fallbackEvents.length||!viewerId)return;
  fallbackTimer=setTimeout(async()=>{const events=fallbackEvents.splice(0,32);fallbackTimer=null;try{await api('/api/input',{method:'POST',body:JSON.stringify({code,viewerId,playerIndex,controllerConnected:controllerState.connected,events})})}catch{}if(fallbackEvents.length)scheduleFallbackInput()},24);
}
function sendControl(message){
  const payload={...message,playerIndex,controllerConnected:controllerState.connected,sequence:++sequence};
  if(controlChannel?.readyState==='open'){controlChannel.send(JSON.stringify(payload));return true}
  if(Array.isArray(payload.events)&&payload.events.length){fallbackEvents.push(...payload.events.slice(0,32));if(fallbackEvents.length>96)fallbackEvents.splice(0,fallbackEvents.length-96);scheduleFallbackInput()}
  return false;
}
function sendInputEvents(events,source='touch'){const safe=events.filter(event=>Number.isInteger(Number(event.id))&&Number(event.id)>=0&&Number(event.id)<=15).slice(0,32).map(event=>({id:Number(event.id),state:event.state?1:0,source}));if(safe.length)sendControl({type:'input',events:safe})}

function releaseTouchInputs(){
  const events=[];
  for(const [id,count]of buttonPressCounts){if(count>0)events.push({id,state:0})}
  pointerButtons.clear();buttonPressCounts.clear();$$('[data-button].pressed').forEach(button=>button.classList.remove('pressed'));sendInputEvents(events,'touch');
}
function touchButtonDown(button,event){
  if(controllerState.connected||!touchEnabled)return;
  event.preventDefault();
  const id=Number(button.dataset.button);if(!Number.isInteger(id))return;
  button.setPointerCapture?.(event.pointerId);pointerButtons.set(event.pointerId,{id,button});
  const count=Number(buttonPressCounts.get(id)||0)+1;buttonPressCounts.set(id,count);button.classList.add('pressed');
  if(count===1)sendInputEvents([{id,state:1}],'touch');haptic('tick');
}
function touchButtonUp(event){
  const entry=pointerButtons.get(event.pointerId);if(!entry)return;
  event.preventDefault();pointerButtons.delete(event.pointerId);
  const count=Math.max(0,Number(buttonPressCounts.get(entry.id)||1)-1);buttonPressCounts.set(entry.id,count);
  if(count===0){entry.button.classList.remove('pressed');sendInputEvents([{id:entry.id,state:0}],'touch')}
}
$$('[data-button]').forEach(button=>{button.addEventListener('pointerdown',event=>touchButtonDown(button,event));button.addEventListener('pointerup',touchButtonUp);button.addEventListener('pointercancel',touchButtonUp);button.addEventListener('lostpointercapture',touchButtonUp);button.addEventListener('contextmenu',event=>event.preventDefault())});

function gamepadStates(gamepad){const states=new Map();for(const[source,target]of BUTTON_MAP)states.set(target,Boolean(gamepad?.buttons?.[source]?.pressed));if(gamepad?.axes?.length>=2){states.set(6,states.get(6)||gamepad.axes[0]<-.48);states.set(7,states.get(7)||gamepad.axes[0]>.48);states.set(4,states.get(4)||gamepad.axes[1]<-.48);states.set(5,states.get(5)||gamepad.axes[1]>.48)}return states}
function pollGamepads(){
  if(!nativeBridge()){
    const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
    const gamepad=pads[0]||null;
    const next={connected:Boolean(gamepad),count:pads.length,names:pads.map(pad=>pad.id)};
    if(next.connected!==controllerState.connected||next.count!==controllerState.count||next.names[0]!==controllerState.names[0])applyControllerState(next);
    const states=gamepadStates(gamepad);const events=[];
    for(let id=0;id<16;id++){const pressed=Boolean(states.get(id));if(gamepadButtons.get(id)===pressed)continue;gamepadButtons.set(id,pressed);events.push({id,state:pressed?1:0})}
    sendInputEvents(events,'browser-gamepad');
  }
  gamepadFrame=requestAnimationFrame(pollGamepads);
}

function roomExpiry(room){const minutes=Math.max(1,Math.ceil((Number(room.expiresAt||0)-Date.now())/60000));return minutes>=60?`${Math.ceil(minutes/60)}h left`:`${minutes}m left`}
function renderRooms(){const list=$('#roomsList');if(!roomCache.length){list.innerHTML='<div class="empty">No compatible rooms are open for games in your deck.</div>';return}list.innerHTML=roomCache.map(room=>`<article class="room-row"><div><b>${escapeHtml(room.gameTitle||room.title||'GameDeck room')}</b><span>${escapeHtml(room.hostName||'Player')} · ${Number(room.playerCount||1)}/${Number(room.maxPlayers||2)} players</span><small>Exact game + core · ${escapeHtml(roomExpiry(room))}</small></div><button type="button" data-room-id="${escapeHtml(room.roomId)}">Join</button></article>`).join('');$$('[data-room-id]').forEach(button=>button.onclick=()=>joinRoom(button.dataset.roomId,button))}
async function loadRooms(){if(!viewerId)return;$('#roomsStatus').textContent='Searching…';try{const result=await api(`/api/community/rooms?${authQuery()}`);roomCache=Array.isArray(result.rooms)?result.rooms:[];$('#roomsStatus').textContent=roomCache.length?`${roomCache.length} available`:'No open rooms';renderRooms()}catch(error){roomCache=[];$('#roomsStatus').textContent='Retrying';$('#roomsList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`}}
async function joinRoom(roomId,button){button.disabled=true;button.textContent='Joining…';try{await api('/api/community/join',{method:'POST',body:JSON.stringify({code,viewerId,roomId})});haptic('success');setTab('play');$('#waiting').classList.remove('hidden');$('#waiting b').textContent='Joining room';$('#waiting small').textContent='GameDeck is launching the verified local copy on your computer.'}catch(error){haptic('warning');button.disabled=false;button.textContent='Join';$('#roomsStatus').textContent=error.message}}
function messageTime(value){try{return new Date(Number(value)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}catch{return''}}
function renderChat(){const list=$('#chatList');if(!chatCache.length){list.innerHTML='<div class="empty">No messages yet. Ask who wants to play.</div>';return}list.innerHTML=chatCache.slice(-100).map(message=>`<article class="chat-message"><header><b>${escapeHtml(message.authorName||'Player')}</b><time>${escapeHtml(messageTime(message.createdAt))}</time></header><p>${escapeHtml(message.text)}</p></article>`).join('');list.scrollTop=list.scrollHeight}
async function loadChat(){if(!viewerId)return;try{const result=await api(`/api/community/chat?${authQuery()}`);chatCache=Array.isArray(result.messages)?result.messages:[];$('#chatStatus').textContent=`${chatCache.length} signed`;renderChat()}catch(error){$('#chatStatus').textContent='Retrying';if(!chatCache.length)$('#chatList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`}}
async function sendChat(event){event.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;const button=$('#chatForm button');button.disabled=true;try{const result=await api('/api/community/chat',{method:'POST',body:JSON.stringify({code,viewerId,text,authorName:$('#deviceName').value.trim()||deviceLabel()})});input.value='';if(result.message)chatCache=[...chatCache.filter(item=>item.id!==result.message.id),result.message];renderChat();haptic('success');setTimeout(loadChat,350)}catch(error){haptic('warning');$('#chatStatus').textContent=error.message}finally{button.disabled=false}}
function scheduleCommunity(){clearTimeout(communityTimer);if(!viewerId)return;communityTimer=setTimeout(async()=>{if(activeTab==='community'){await Promise.all([loadRooms(),loadChat()])}scheduleCommunity()},5000)}
async function refreshCommunity(force=false){if(!viewerId)return;if(force||activeTab==='community')await Promise.all([loadRooms(),loadChat()]);scheduleCommunity()}

async function pair(event){
  event?.preventDefault();$('#pairError').classList.add('hidden');code=$('#pairCode').value.replace(/\D/g,'').slice(0,6);const label=$('#deviceName').value.trim()||deviceLabel();if(code.length!==6){$('#pairError').textContent='Enter the six-digit code from GameDeck.';$('#pairError').classList.remove('hidden');return}
  try{const result=await api('/api/pair',{method:'POST',body:JSON.stringify({code,label,controllerConnected:controllerState.connected})});viewerId=result.viewerId;streamInfo=result.stream;playerIndex=Number(result.viewer?.playerIndex||0);localStorage.setItem('gamedeck:device-name',label);history.replaceState(null,'',`/?code=${code}`);$('#pairCard').classList.add('hidden');$('#mobileTabs').classList.remove('hidden');$('#playerSlot').textContent=`PLAYER ${playerIndex+1}`;$('#streamTitle').textContent=streamInfo.title||'GameDeck';$('#streamMeta').textContent=`${streamInfo.sourceName||'GameDeck'} · connecting`;$('#quality').textContent=streamInfo.quality||'1080p';setConnection('pairing');setTab('play');await createPeer();poll();scheduleCommunity();haptic('success')}catch(error){haptic('warning');$('#pairError').textContent=pairingError(error);$('#pairError').classList.remove('hidden')}
}
async function disconnect(){clearTimeout(pollTimer);clearTimeout(communityTimer);cancelAnimationFrame(gamepadFrame);releaseTouchInputs();if(viewerId)api('/api/leave',{method:'POST',body:JSON.stringify({code,viewerId})}).catch(()=>{});viewerId='';closePeer();$('#mobileTabs').classList.add('hidden');$('#playerCard').classList.add('hidden');$('#communityPanel').classList.add('hidden');$('#pairCard').classList.remove('hidden');document.body.classList.remove('show-chrome','play-active')}

$('#pairForm').addEventListener('submit',pair);
$('#disconnect').onclick=disconnect;
$('#fullscreen').onclick=()=>$('#videoShell').requestFullscreen?.();
$('#mute').onclick=()=>{const video=$('#video');video.muted=!video.muted;$('#mute').textContent=video.muted?'Unmute':'Mute';haptic('tick')};
$('#touchToggle').onclick=()=>{touchEnabled=!touchEnabled;localStorage.setItem('gamedeck:touch-controls',touchEnabled?'on':'off');applyControllerState(controllerState,{notify:false});haptic('tick')};
$('#revealChrome').onclick=showChrome;
$('#videoShell').addEventListener('pointerdown',()=>{if(controllerState.connected)showChrome()});
$('#refreshCommunity').onclick=()=>refreshCommunity(true);
$('#chatForm').addEventListener('submit',sendChat);
$$('#mobileTabs [data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));
$('#install').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice.catch(()=>{});installPrompt=null;$('#install').classList.add('hidden')};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').classList.remove('hidden')});
window.addEventListener('beforeunload',()=>{if(viewerId)navigator.sendBeacon('/api/leave',JSON.stringify({code,viewerId}))});
window.addEventListener('blur',releaseTouchInputs);
window.addEventListener('gamepadconnected',()=>{if(!nativeBridge())applyControllerState({connected:true,count:[...navigator.getGamepads()].filter(Boolean).length,names:[...navigator.getGamepads()].filter(Boolean).map(pad=>pad.id)})});
window.addEventListener('gamepaddisconnected',()=>{if(!nativeBridge())applyControllerState({connected:[...navigator.getGamepads()].filter(Boolean).length>0,count:[...navigator.getGamepads()].filter(Boolean).length,names:[...navigator.getGamepads()].filter(Boolean).map(pad=>pad.id)})});

try{if(nativeBridge()?.platform?.()==='android')document.body.classList.add('native-android')}catch{}
applyControllerState(readNativeController(),{notify:false});
document.body.classList.toggle('touch-disabled',!touchEnabled);
const preset=new URLSearchParams(location.search).get('code')||'';
$('#pairCode').value=preset.replace(/\D/g,'').slice(0,6);
$('#deviceName').value=deviceLabel();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
gamepadFrame=requestAnimationFrame(pollGamepads);
if($('#pairCode').value.length===6)pair();
