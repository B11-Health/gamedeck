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
let gamepadAxes=[0,0,0,0];
let fallbackEvents=[];
let fallbackTimer=null;
let chromeTimer=null;
let roomCache=[];
let chatCache=[];
const pointerButtons=new Map();
const buttonPressCounts=new Map();
const NATIVE_CONTROLLER_APP=location.origin==='http://appassets.local';
const PUBLIC_CONTROLLER_APP=/(^|\.)github\.io$/i.test(location.hostname)&&/\/controller\/?/i.test(location.pathname);
const NEEDS_DECK_ADDRESS=NATIVE_CONTROLLER_APP||PUBLIC_CONTROLLER_APP;
let deckBaseUrl=NEEDS_DECK_ADDRESS?'':location.origin;
let screenEnabled=localStorage.getItem('gamedeck:screen-enabled')!=='off';
let hapticsEnabled=localStorage.getItem('gamedeck:haptics')!=='off';
let adaptiveHapticsEnabled=localStorage.getItem('gamedeck:adaptive-haptics')==='on';
let hapticStrength=Math.max(20,Math.min(255,Number(localStorage.getItem('gamedeck:haptic-strength')||120)));
let motionEnabled=localStorage.getItem('gamedeck:motion')==='on';
let motionCenter={roll:0,pitch:0};
let lastMotion={roll:0,pitch:0,yaw:0,gyroX:0,gyroY:0,gyroZ:0};
let bluetoothState={supported:false,enabled:false,permission:false,registered:false,connected:false,hostName:''};
let audioContext=null;
let audioAnalyser=null;
let adaptiveTimer=null;
let lastImpactAt=0;
const stickPointers=new Map();
const analogValues=[0,0,0,0];

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function deviceLabel(){const saved=localStorage.getItem('gamedeck:device-name');if(saved)return saved;const platform=navigator.userAgentData?.platform||navigator.platform||'Android';return `${platform} Player`.slice(0,40)}
function nativeBridge(){return window.GameDeckNative||null}
function parseJson(value,fallback={}){try{return typeof value==='string'?JSON.parse(value):value||fallback}catch{return fallback}}
function normalizeDeckUrl(raw){
  let value=String(raw||'').trim();if(!value)return'';if(!/^https?:\/\//i.test(value))value=`http://${value}`;
  try{const url=new URL(value);const host=url.hostname.toLowerCase();const local=host==='localhost'||host==='127.0.0.1'||host==='::1'||host.endsWith('.local')||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||(/^172\.(\d+)\./.test(host)&&Number(host.split('.')[1])>=16&&Number(host.split('.')[1])<=31);return local?url.origin:''}catch{return''}
}
function hapticPulse(strength=hapticStrength,duration=18){
  if(!hapticsEnabled)return false;const amplitude=Math.max(1,Math.min(255,Number(strength)||hapticStrength));
  try{if(nativeBridge()?.hapticPulse)return Boolean(nativeBridge().hapticPulse(amplitude,Math.max(8,Math.min(600,Number(duration)||18))))}catch{}
  if(navigator.vibrate){navigator.vibrate(Math.max(8,Math.min(120,Number(duration)||18)));return true}return false;
}
function visualHaptic(style='tick'){document.body.dataset.haptic=style;document.body.classList.remove('haptic-pulse');void document.body.offsetWidth;document.body.classList.add('haptic-pulse');clearTimeout(visualHaptic.timer);visualHaptic.timer=setTimeout(()=>document.body.classList.remove('haptic-pulse'),180)}
function haptic(style='tick'){
  if(!hapticsEnabled)return;const scale={tick:[Math.round(hapticStrength*.55),12],success:[hapticStrength,28],warning:[Math.min(255,hapticStrength+55),48],heavy:[Math.min(255,hapticStrength+35),36]};
  const [strength,duration]=scale[style]||scale.tick;visualHaptic(style);hapticPulse(strength,duration);
}
function setConnection(value){$('#connection').textContent=String(value||'').toUpperCase()}
function authQuery(){return `viewerId=${encodeURIComponent(viewerId)}&code=${encodeURIComponent(code)}`}
function apiUrl(path){if(!deckBaseUrl&&NEEDS_DECK_ADDRESS)throw Error('Enter the local GameDeck computer address.');return `${deckBaseUrl}${path}`}
async function api(path,options={}){const response=await fetch(apiUrl(path),{cache:'no-store',headers:{'content-type':'application/json',...(options.headers||{})},...options});const body=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));if(!response.ok||body.ok===false){const error=Error(body.error||`HTTP ${response.status}`);error.status=response.status;throw error}return body}
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
function renderBluetooth(){
  bluetoothState=parseJson(bluetoothState,{supported:false});
  const status=$('#bluetoothStatus');if(status)status.textContent=!bluetoothState.supported?'Bluetooth gamepad requires Android 9+':!bluetoothState.permission?'Bluetooth permission required':bluetoothState.connected?`Connected to ${bluetoothState.hostName||'computer'}`:bluetoothState.registered?'Ready � choose a paired computer':'Set up Bluetooth gamepad';
  const devices=parseJson(nativeBridge()?.bluetoothDevices?.()||'[]',[]);for(const target of [$('#bluetoothDevices'),$('#bluetoothHosts')]){if(!target)continue;target.innerHTML=devices.length?devices.map(device=>`<button type="button" data-bt-address="${escapeHtml(device.address)}"><b>${escapeHtml(device.name||'Paired computer')}</b><small>${device.connected?'Connected':device.bonded?'Connect':'Pair in Android settings'}</small></button>`).join(''):'<span>No paired computers found yet.</span>';target.querySelectorAll('[data-bt-address]').forEach(button=>button.onclick=()=>{nativeBridge()?.bluetoothConnect?.(button.dataset.btAddress);setTimeout(refreshBluetooth,500)})}
}
function refreshBluetooth(){try{bluetoothState=parseJson(nativeBridge()?.bluetoothState?.()||'{}',{});renderBluetooth()}catch{}}
function applyOrientation(value){const state=parseJson(value,{mode:'auto',current:matchMedia('(orientation:landscape)').matches?'landscape':'portrait'});document.body.dataset.orientation=state.current;$$('[data-orientation]').forEach(button=>button.classList.toggle('active',button.dataset.orientation===state.mode))}
function handleMotion(value){lastMotion={...lastMotion,...parseJson(value,{})};$('#sensorReadout').textContent=`ROLL ${Number(lastMotion.roll||0).toFixed(2)} � PITCH ${Number(lastMotion.pitch||0).toFixed(2)}`;if(!motionEnabled||controllerState.connected)return;const x=Math.max(-1,Math.min(1,(Number(lastMotion.roll||0)-motionCenter.roll)*1.65));const y=Math.max(-1,Math.min(1,(Number(lastMotion.pitch||0)-motionCenter.pitch)*1.65));sendInputEvents([{axis:0,value:x},{axis:1,value:y}],'motion')}
window.GameDeckAndroid={
  onControllerState:value=>applyControllerState(value),
  onDeckUrl:value=>{const normalized=normalizeDeckUrl(value);if(normalized){deckBaseUrl=normalized;$('#deckAddress').value=normalized.replace(/^https?:\/\//,'')}},
  onBluetoothState:value=>{bluetoothState=parseJson(value,{});renderBluetooth()},
  onBluetoothRumble:value=>{const rumble=parseJson(value,{});hapticPulse(Math.max(Number(rumble.low||0),Number(rumble.high||0),hapticStrength),Number(rumble.duration||40))},
  onNativeInput:event=>{if(!event)return;sendInputEvents([{id:Number(event.id),state:event.state?1:0}],'native')},
  onNativeAxis:event=>{if(!event)return;sendInputEvents([{axis:Number(event.axis),value:Number(event.value)}],'native')},
  onOrientation:applyOrientation,
  onMotion:handleMotion
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
    try{const message=JSON.parse(String(event.data||''));if(message.type==='ready'){playerIndex=Math.max(0,Number(message.playerIndex||0));$('#playerSlot').textContent=`PLAYER ${playerIndex+1}`;sendControl({type:'controller-state',controllerConnected:controllerState.connected,events:[]})}if(message.type==='haptic'){if(message.strength)hapticPulse(message.strength,message.duration||30);else haptic(message.style||'tick')}}catch{}
  };
}
async function createPeer(){
  closePeer();
  peer=new RTCPeerConnection({iceServers:[]});
  peer.ondatachannel=event=>{if(event.channel?.label==='gamedeck-control')setControlChannel(event.channel)};
  peer.ontrack=event=>{const stream=event.streams?.[0]||new MediaStream([event.track]);$('#video').srcObject=stream;$('#video').play().catch(()=>{});$('#waiting').classList.add('hidden');if(controllerState.connected)document.body.classList.remove('show-chrome');startAdaptiveHaptics()};
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
function sendInputEvents(events,source='touch'){
  const safe=[];
  for(const event of events||[]){
    const axis=Number(event?.axis);
    if(Number.isInteger(axis)&&axis>=0&&axis<=3){const value=Math.max(-1,Math.min(1,Number(event.value)||0));safe.push({axis,value,source});try{nativeBridge()?.bluetoothAxis?.(axis,value)}catch{};continue}
    const id=Number(event?.id);if(!Number.isInteger(id)||id<0||id>15)continue;const state=event.state?1:0;safe.push({id,state,source});try{nativeBridge()?.bluetoothButton?.(id,Boolean(state))}catch{}
  }
  if(safe.length)sendControl({type:'input',events:safe.slice(0,32)})
}

function releaseTouchInputs(){
  const events=[];
  for(const [id,count]of buttonPressCounts){if(count>0)events.push({id,state:0})}
  for(let axis=0;axis<4;axis++){if(Math.abs(analogValues[axis])>.001)events.push({axis,value:0});analogValues[axis]=0}
  pointerButtons.clear();buttonPressCounts.clear();stickPointers.clear();$$('[data-button].pressed').forEach(button=>button.classList.remove('pressed'));$$('[data-stick] span').forEach(knob=>knob.style.transform='translate(0,0)');sendInputEvents(events,'touch');
}
function spawnTouchRipple(target,event){const rect=target.getBoundingClientRect();const ripple=document.createElement('span');ripple.className='touch-ripple';const x=event?.clientX?event.clientX-rect.left:rect.width/2;const y=event?.clientY?event.clientY-rect.top:rect.height/2;ripple.style.left=`${x}px`;ripple.style.top=`${y}px`;target.appendChild(ripple);ripple.addEventListener('animationend',()=>ripple.remove(),{once:true})}
function touchButtonDown(button,event){
  if(controllerState.connected||!touchEnabled)return;
  event.preventDefault();
  const id=Number(button.dataset.button);if(!Number.isInteger(id))return;
  button.setPointerCapture?.(event.pointerId);pointerButtons.set(event.pointerId,{id,button});spawnTouchRipple(button,event);
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
function setStickValue(stick,x,y,source='touch-stick'){
  const base=stick.dataset.stick==='right'?2:0;const magnitude=Math.hypot(x,y);if(magnitude>1){x/=magnitude;y/=magnitude}
  analogValues[base]=x;analogValues[base+1]=y;const knob=stick.querySelector('span');if(knob)knob.style.transform=`translate(${x*34}px,${y*34}px)`;sendInputEvents([{axis:base,value:x},{axis:base+1,value:y}],source)
}
function stickMove(stick,event){const active=stickPointers.get(event.pointerId);if(!active)return;event.preventDefault();const rect=stick.getBoundingClientRect();setStickValue(stick,(event.clientX-(rect.left+rect.width/2))/(rect.width*.38),(event.clientY-(rect.top+rect.height/2))/(rect.height*.38))}
function stickDown(stick,event){if(controllerState.connected||!touchEnabled)return;event.preventDefault();stick.setPointerCapture?.(event.pointerId);stickPointers.set(event.pointerId,stick);stick.classList.add('pressed');spawnTouchRipple(stick,event);stickMove(stick,event);haptic('tick')}
function stickUp(event){const stick=stickPointers.get(event.pointerId);if(!stick)return;event.preventDefault();stickPointers.delete(event.pointerId);stick.classList.remove('pressed');setStickValue(stick,0,0)}
$$('[data-stick]').forEach(stick=>{stick.addEventListener('pointerdown',event=>stickDown(stick,event));stick.addEventListener('pointermove',event=>stickMove(stick,event));stick.addEventListener('pointerup',stickUp);stick.addEventListener('pointercancel',stickUp);stick.addEventListener('lostpointercapture',stickUp)});


function gamepadStates(gamepad){const states=new Map();for(const[source,target]of BUTTON_MAP)states.set(target,Boolean(gamepad?.buttons?.[source]?.pressed));if(gamepad?.axes?.length>=2){states.set(6,states.get(6)||gamepad.axes[0]<-.48);states.set(7,states.get(7)||gamepad.axes[0]>.48);states.set(4,states.get(4)||gamepad.axes[1]<-.48);states.set(5,states.get(5)||gamepad.axes[1]>.48)}return states}
function pollGamepads(){
  if(!nativeBridge()){
    const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
    const gamepad=pads[0]||null;
    const next={connected:Boolean(gamepad),count:pads.length,names:pads.map(pad=>pad.id)};
    if(next.connected!==controllerState.connected||next.count!==controllerState.count||next.names[0]!==controllerState.names[0])applyControllerState(next);
    const states=gamepadStates(gamepad);const events=[];
    for(let id=0;id<16;id++){const pressed=Boolean(states.get(id));if(gamepadButtons.get(id)===pressed)continue;gamepadButtons.set(id,pressed);events.push({id,state:pressed?1:0})}
    for(let axis=0;axis<4;axis++){const raw=Number(gamepad?.axes?.[axis]||0);const value=Math.abs(raw)<.12?0:Math.max(-1,Math.min(1,raw));if(Math.abs(value-gamepadAxes[axis])<.02)continue;gamepadAxes[axis]=value;events.push({axis,value})}
    sendInputEvents(events,'browser-gamepad');
  }
  gamepadFrame=requestAnimationFrame(pollGamepads);
}

function stopAdaptiveHaptics(){clearInterval(adaptiveTimer);adaptiveTimer=null;if(audioContext){audioContext.close().catch(()=>{});audioContext=null;audioAnalyser=null}}
function startAdaptiveHaptics(){
  if(!adaptiveHapticsEnabled||!hapticsEnabled||audioAnalyser)return;const video=$('#video');if(!video?.srcObject)return;
  try{audioContext=new(window.AudioContext||window.webkitAudioContext)();const source=audioContext.createMediaElementSource(video);audioAnalyser=audioContext.createAnalyser();audioAnalyser.fftSize=256;source.connect(audioAnalyser);audioAnalyser.connect(audioContext.destination);const bins=new Uint8Array(audioAnalyser.frequencyBinCount);let baseline=0;adaptiveTimer=setInterval(()=>{if(!adaptiveHapticsEnabled||!audioAnalyser)return;audioAnalyser.getByteFrequencyData(bins);let energy=0;for(let i=2;i<Math.min(48,bins.length);i++)energy+=bins[i];energy/=46;baseline=baseline*.92+energy*.08;const impact=energy-baseline;const now=performance.now();if(impact>32&&now-lastImpactAt>130){lastImpactAt=now;hapticPulse(Math.min(255,hapticStrength+Math.round(impact)),Math.min(55,16+impact))}},55)}catch{stopAdaptiveHaptics()}
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
  event?.preventDefault();$('#pairError').classList.add('hidden');code=$('#pairCode').value.replace(/\D/g,'').slice(0,6);const label=$('#deviceName').value.trim()||deviceLabel();
  if(NEEDS_DECK_ADDRESS){const normalized=normalizeDeckUrl($('#deckAddress').value);if(!normalized){$('#pairError').textContent='Enter the private-network GameDeck address shown on your computer.';$('#pairError').classList.remove('hidden');return}deckBaseUrl=normalized;try{nativeBridge()?.saveDeckUrl?.(normalized)}catch{}}
  if(code.length!==6){$('#pairError').textContent='Enter the six-digit code from GameDeck.';$('#pairError').classList.remove('hidden');return}
  if(PUBLIC_CONTROLLER_APP){localStorage.setItem('gamedeck:device-name',label);location.assign(`${deckBaseUrl}/?code=${encodeURIComponent(code)}`);return}
  try{const result=await api('/api/pair',{method:'POST',body:JSON.stringify({code,label,controllerConnected:controllerState.connected})});viewerId=result.viewerId;streamInfo=result.stream;playerIndex=Number(result.viewer?.playerIndex||0);localStorage.setItem('gamedeck:device-name',label);if(!NEEDS_DECK_ADDRESS)history.replaceState(null,'',`/?code=${code}`);$('#pairCard').classList.add('hidden');$('#mobileTabs').classList.remove('hidden');$('#settingsToggle').classList.remove('hidden');$('#playerSlot').textContent=`PLAYER ${playerIndex+1}`;$('#streamTitle').textContent=streamInfo.title||'GameDeck';$('#streamMeta').textContent=`${streamInfo.sourceName||'GameDeck'} � connecting`;$('#quality').textContent=streamInfo.quality||'1080p';setConnection('pairing');setTab('play');await createPeer();poll();scheduleCommunity();haptic('success')}catch(error){haptic('warning');$('#pairError').textContent=pairingError(error);$('#pairError').classList.remove('hidden')}
}
async function disconnect(){clearTimeout(pollTimer);clearTimeout(communityTimer);cancelAnimationFrame(gamepadFrame);stopAdaptiveHaptics();releaseTouchInputs();if(viewerId)api('/api/leave',{method:'POST',body:JSON.stringify({code,viewerId})}).catch(()=>{});viewerId='';closePeer();$('#mobileTabs').classList.add('hidden');$('#settingsToggle').classList.add('hidden');$('#playerCard').classList.add('hidden');$('#communityPanel').classList.add('hidden');$('#pairCard').classList.remove('hidden');document.body.classList.remove('show-chrome','play-active')}

$('#pairForm').addEventListener('submit',pair);
$('#disconnect').onclick=disconnect;
$('#fullscreen').onclick=()=>$('#videoShell').requestFullscreen?.();
$('#mute').onclick=()=>{const video=$('#video');video.muted=!video.muted;$('#mute').textContent=video.muted?'Unmute':'Mute';haptic('tick')};
$('#touchToggle').onclick=()=>{touchEnabled=!touchEnabled;localStorage.setItem('gamedeck:touch-controls',touchEnabled?'on':'off');applyControllerState(controllerState,{notify:false});if(!touchEnabled)releaseTouchInputs();haptic('tick')};
$('#screenToggle').onclick=()=>{screenEnabled=!screenEnabled;localStorage.setItem('gamedeck:screen-enabled',screenEnabled?'on':'off');document.body.classList.toggle('controller-only',!screenEnabled);$('#screenToggle').textContent=screenEnabled?'Controller only':'Show game screen';$('#screenBadge').textContent=screenEnabled?'SCREEN + CONTROLLER':'CONTROLLER ONLY';haptic('tick')};
$('#settingsToggle').onclick=()=>$('#controllerSettings').classList.toggle('hidden');
$('#settingsClose').onclick=()=>$('#controllerSettings').classList.add('hidden');
$$('[data-orientation]').forEach(button=>button.onclick=()=>{nativeBridge()?.setOrientation?.(button.dataset.orientation);applyOrientation({mode:button.dataset.orientation,current:matchMedia('(orientation:landscape)').matches?'landscape':'portrait'});haptic('tick')});
$('#hapticToggle').onchange=event=>{hapticsEnabled=event.target.checked;localStorage.setItem('gamedeck:haptics',hapticsEnabled?'on':'off');if(hapticsEnabled)haptic('success');else stopAdaptiveHaptics()};
$('#adaptiveHaptics').onchange=event=>{adaptiveHapticsEnabled=event.target.checked;localStorage.setItem('gamedeck:adaptive-haptics',adaptiveHapticsEnabled?'on':'off');stopAdaptiveHaptics();if(adaptiveHapticsEnabled)startAdaptiveHaptics()};
$('#hapticStrength').oninput=event=>{hapticStrength=Math.max(20,Math.min(255,Number(event.target.value)||120));localStorage.setItem('gamedeck:haptic-strength',String(hapticStrength))};
$('#hapticStrength').onchange=()=>hapticPulse(hapticStrength,30);
$('#motionToggle').onchange=event=>{motionEnabled=event.target.checked;localStorage.setItem('gamedeck:motion',motionEnabled?'on':'off');nativeBridge()?.setMotionEnabled?.(motionEnabled);if(!motionEnabled)sendInputEvents([{axis:0,value:0},{axis:1,value:0}],'motion')};
$('#motionCenter').onclick=()=>{motionCenter={roll:Number(lastMotion.roll||0),pitch:Number(lastMotion.pitch||0)};haptic('success')};
$('#bluetoothPrepare').onclick=$('#bluetoothSettings').onclick=()=>{nativeBridge()?.bluetoothPrepare?.();setTimeout(refreshBluetooth,700)};
$('#revealChrome').onclick=showChrome;
$('#videoShell').addEventListener('pointerdown',()=>{if(controllerState.connected)showChrome()});
$('#refreshCommunity').onclick=()=>refreshCommunity(true);
$('#chatForm').addEventListener('submit',sendChat);
$$('#mobileTabs [data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));
$('#install').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice.catch(()=>{});installPrompt=null;$('#install').classList.add('hidden')};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').classList.remove('hidden')});
window.addEventListener('beforeunload',()=>{if(viewerId)try{navigator.sendBeacon(apiUrl('/api/leave'),JSON.stringify({code,viewerId}))}catch{}});
window.addEventListener('blur',releaseTouchInputs);
window.addEventListener('orientationchange',()=>setTimeout(()=>applyOrientation({mode:parseJson(nativeBridge()?.orientation?.()||'{}',{mode:'auto'}).mode,current:matchMedia('(orientation:landscape)').matches?'landscape':'portrait'}),120));
window.addEventListener('gamepadconnected',()=>{if(!nativeBridge())applyControllerState({connected:true,count:[...navigator.getGamepads()].filter(Boolean).length,names:[...navigator.getGamepads()].filter(Boolean).map(pad=>pad.id)})});
window.addEventListener('gamepaddisconnected',()=>{if(!nativeBridge())applyControllerState({connected:[...navigator.getGamepads()].filter(Boolean).length>0,count:[...navigator.getGamepads()].filter(Boolean).length,names:[...navigator.getGamepads()].filter(Boolean).map(pad=>pad.id)})});

document.body.classList.toggle('standalone-app',NEEDS_DECK_ADDRESS);
document.body.classList.toggle('public-controller-app',PUBLIC_CONTROLLER_APP);
$('#deckAddressLabel').classList.toggle('hidden',!NEEDS_DECK_ADDRESS);
document.body.classList.toggle('controller-only',!screenEnabled);
$('#screenToggle').textContent=screenEnabled?'Controller only':'Show game screen';
$('#screenBadge').textContent=screenEnabled?'SCREEN + CONTROLLER':'CONTROLLER ONLY';
$('#hapticToggle').checked=hapticsEnabled;
$('#adaptiveHaptics').checked=adaptiveHapticsEnabled;
$('#hapticStrength').value=String(hapticStrength);
$('#motionToggle').checked=motionEnabled;
try{if(nativeBridge()?.platform?.()==='android'){document.body.classList.add('native-android');const saved=normalizeDeckUrl(nativeBridge().savedDeckUrl?.()||'');if(saved){deckBaseUrl=saved;$('#deckAddress').value=saved.replace(/^https?:\/\//,'')}applyOrientation(nativeBridge().orientation?.()||'{}');nativeBridge().setMotionEnabled?.(motionEnabled);refreshBluetooth()}}catch{}
applyControllerState(readNativeController(),{notify:false});
document.body.classList.toggle('touch-disabled',!touchEnabled);
const preset=new URLSearchParams(location.search).get('code')||'';
$('#pairCode').value=preset.replace(/\D/g,'').slice(0,6);
$('#deviceName').value=deviceLabel();
if(!NATIVE_CONTROLLER_APP&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
gamepadFrame=requestAnimationFrame(pollGamepads);
if($('#pairCode').value.length===6&&(!NEEDS_DECK_ADDRESS||deckBaseUrl))pair();
