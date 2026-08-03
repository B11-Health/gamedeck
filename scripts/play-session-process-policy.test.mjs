import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStopPolicy, validateContainment, validateManagedLaunch } = require('../play-session-process-policy.js');
let passed=0; const test=(n,f)=>{f();passed++;console.log(`ok - ${n}`)};
const pathContract=(canonical,root)=>({ candidatePath:canonical, canonicalCandidatePath:canonical, canonicalRootPath:root, canonicalizationComplete:true, reparseOrSymlink:false });
const launchInput=(platform='win32')=>{
 const sep=platform==='win32'?'\\':'/'; const root=platform==='win32'?'C:\\GameDeck\\runtime':'/opt/gamedeck/runtime';
 const executablePath=`${root}${sep}retroarch${platform==='win32'?'.exe':''}`;
 const corePath=`${root}${sep}cores${sep}snes.dll`;
 const configPath=`${root}${sep}config${sep}retroarch.cfg`;
 const contentPath=`${root}${sep}content${sep}game.sfc`;
 return { platform, executable:pathContract(executablePath,root), core:pathContract(corePath,root), config:pathContract(configPath,root), content:pathContract(contentPath,root), expectedExecutablePath:executablePath, expectedCorePath:corePath, expectedConfigPath:configPath, expectedContentPath:contentPath, receipt:{installId:'i',executableDigest:'e',coreDigest:'c',configDigest:'g',contentDigest:'r'}, expectedInstallId:'i',expectedExecutableDigest:'e',expectedCoreDigest:'c',expectedConfigDigest:'g',expectedContentDigest:'r', launch:{fullscreen:false,args:['--config',configPath,'-L',corePath,contentPath]} };
};

test('Windows containment is case insensitive',()=>assert.equal(validateContainment({...pathContract('c:\\gamedeck\\runtime\\A.exe','C:\\GAMEDECK\\RUNTIME'),platform:'win32'}).ok,true));
test('POSIX containment remains case sensitive',()=>assert.equal(validateContainment({...pathContract('/Opt/GameDeck/runtime/a','/opt/gamedeck/runtime'),platform:'linux'}).reasonCode,'path_outside_managed_root'));
test('unknown platform and reparse decisions reject',()=>{assert.equal(validateContainment({...pathContract('/a/b','/a'),platform:'plan9'}).reasonCode,'unsupported_platform'); assert.equal(validateContainment({...pathContract('/a/b','/a'),platform:'linux',reparseOrSymlink:true}).reasonCode,'reparse_or_symlink_rejected')});
test('exact managed launch contract succeeds with no shell or detach',()=>{const r=validateManagedLaunch(launchInput());assert.equal(r.ok,true);assert.deepEqual(r.spawnOptions,{shell:false,detached:false,windowsHide:true,unref:false})});
test('arbitrary file under root is rejected',()=>{const x=launchInput();x.executable.canonicalCandidatePath='C:\\GameDeck\\runtime\\other.exe';assert.equal(validateManagedLaunch(x).reasonCode,'unexpected_executable_path')});
test('fullscreen and invented argument forms reject',()=>{const a=launchInput();a.launch.fullscreen=true;assert.equal(validateManagedLaunch(a).reasonCode,'fullscreen_forbidden');const b=launchInput();b.launch.args=['--libretro',b.expectedCorePath,b.expectedContentPath];assert.equal(validateManagedLaunch(b).reasonCode,'launch_contract_mismatch')});
test('receipt identity mismatch rejects',()=>{const x=launchInput();x.receipt.coreDigest='wrong';assert.equal(validateManagedLaunch(x).reasonCode,'receipt_identity_mismatch')});
test('spontaneous running exit is modeled',()=>{const p=createStopPolicy({managedProcessId:7,managedTreeReceipt:'tree'});const s=p.transition({type:'observe_exit',atMs:5,managedProcessId:7,managedTreeReceipt:'tree',observedTreeReceipt:'tree'});assert.equal(s.phase,'exited')});
test('tree identity mismatch and negative time reject',()=>{const p=createStopPolicy({managedProcessId:7,managedTreeReceipt:'tree'});assert.equal(p.transition({type:'observe_exit',atMs:1,managedProcessId:7,managedTreeReceipt:'tree',observedTreeReceipt:'other'}).reasonCode,'process_identity_mismatch');assert.equal(p.transition({type:'observe_exit',atMs:-1,managedProcessId:7,managedTreeReceipt:'tree',observedTreeReceipt:'tree'}).reasonCode,'invalid_time')});
test('grace escalation verification deadlines and complete tree proof',()=>{const p=createStopPolicy({managedProcessId:7,managedTreeReceipt:'tree'});const id={managedProcessId:7,managedTreeReceipt:'tree',observedTreeReceipt:'tree'};assert.equal(p.transition({type:'request_graceful',atMs:10,deadlineMs:20,...id}).phase,'graceful_requested');assert.equal(p.transition({type:'request_escalation',atMs:19,deadlineMs:30,...id}).reasonCode,'grace_period_not_elapsed');assert.equal(p.transition({type:'request_escalation',atMs:20,deadlineMs:30,...id}).phase,'escalated_requested');assert.equal(p.transition({type:'begin_verification',atMs:29,...id}).reasonCode,'escalation_period_not_elapsed');assert.equal(p.transition({type:'begin_verification',atMs:30,...id}).phase,'verifying');assert.equal(p.transition({type:'verify_complete',atMs:31,rootAlive:false,descendantsAlive:1,handlesOpen:0,...id}).reasonCode,'post_stop_verification_failed');assert.equal(p.transition({type:'verify_complete',atMs:32,rootAlive:false,descendantsAlive:0,handlesOpen:0,...id}).phase,'stopped')});
test('public status excludes process identities',()=>{const p=createStopPolicy({managedProcessId:7,managedTreeReceipt:'secret-tree'});const text=JSON.stringify(p.status());assert.equal(text.includes('secret-tree'),false);assert.equal(text.includes('7'),false)});
console.log(`play-session-process-policy: ${passed} tests passed`);
