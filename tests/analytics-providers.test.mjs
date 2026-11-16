import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {safePath} from '../analytics-source/runtime.js';
import * as privacy from '../analytics-source/privacy.js';
import {installConsentTransport} from '../analytics-source/consent-transport.js';

const source=(await readFile(new URL('../analytics-source/posthog.js',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replace('export function posthogProvider','function posthogProvider')+'\nglobalThis.providerFactory=posthogProvider;';
const user='user_'+'a'.repeat(64),otherUser='user_'+'b'.repeat(64);

function setup({previousUser=null,consent=true,replay=true,recordingConsent=true,canvasReady=false,userId=null}={}){
 const calls=[];
 let allowed=consent,identified=previousUser,capturing=false,ready=canvasReady,config;
 const listeners={},canvas={tagName:'CANVAS',id:'game',closest:selector=>selector==='#viewport'||selector==='#stage'};
 const instance={
  _retryQueue:{_queue:[],get length(){return this._queue.length},retriableRequest(){},_enqueue(){}},
  get_property:()=>identified,
  // Installed SDK reset() clears its own consent, even when site consent remains on.
  reset(){calls.push({name:'reset'});identified=null;capturing=false},
  opt_in_capturing(options){calls.push({name:'opt_in',options});capturing=true},
  opt_out_capturing(){calls.push({name:'opt_out'});capturing=false},
  identify(id){calls.push({name:'identify',id,capturing,replaying:capturing&&!config.disable_session_recording});identified=id},
  set_config(values){calls.push({name:'config',values,identified});Object.assign(config,values)},
  capture(name,properties){if(capturing)calls.push({name:'event',event:name,properties})},
  captureException(){},
  sessionRecordingStarted:()=>capturing&&!config.disable_session_recording,
  stopSessionRecording(){calls.push({name:'stop_recording'});config.disable_session_recording=true},
 };
 const context={URL,safePath,...privacy,installConsentTransport,document:{querySelectorAll:()=>ready?[canvas]:[]},window:{addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]},location:new URL('https://site.test/game?email=private@example.com#secret'),posthog:{init(_key,values){calls.push({name:'init',recordingDisabled:values.disable_session_recording});config??=values;return instance}}};
 runInNewContext(source,context);
 const create=nextId=>{const provider=context.providerFactory({posthogKey:'phc_test',posthogHost:'https://ph.test',sessionReplay:replay},()=>allowed,nextId);provider.setRecordingAllowed(recordingConsent);return provider};
 const provider=create(userId);
 return {calls,provider,create,instance,get config(){return config},setConsent:value=>allowed=value,canvasReady(value){ready=value;listeners['sofacet:public-canvas-ready']?.()}};
}

test('PostHog clears a stale member before opt-in and identifies the verified member before replay',()=>{
 const s=setup({previousUser:otherUser,userId:user});
 assert.equal(s.calls[0].recordingDisabled,true);
 const reset=s.calls.findIndex(x=>x.name==='reset'),optin=s.calls.findIndex(x=>x.name==='opt_in'),identify=s.calls.findIndex(x=>x.name==='identify'),replay=s.calls.findIndex(x=>x.name==='config');
 assert.ok(reset<optin&&optin<identify&&identify<replay);
 assert.deepEqual(s.calls[identify],{name:'identify',id:user,capturing:true,replaying:false});
 assert.equal(s.provider.recording(),true);
 const anonymous=setup({previousUser:user});
 assert.equal(anonymous.calls.some(x=>x.name==='identify'),false);
 assert.ok(anonymous.calls.findIndex(x=>x.name==='reset')<anonymous.calls.findIndex(x=>x.name==='opt_in'));
});

test('clearing identity retains current site consent despite the SDK resetting its own consent',()=>{
 const s=setup({userId:user});
 s.calls.length=0;s.provider.clearIdentity();s.provider.track('page_view',{page_path:'/sign-in'});
 assert.deepEqual(s.calls.map(x=>x.name),['reset','opt_in','config','event']);
 assert.equal(s.calls.at(-1).event,'$pageview');
 assert.equal(s.provider.recording(),true);
 s.calls.length=0;s.provider.reset();s.provider.track('game_started',{});
 assert.deepEqual(s.calls.map(x=>x.name),['reset','opt_in','config','event']);
 s.setConsent(false);s.calls.length=0;s.provider.reset();s.provider.track('game_started',{});
 assert.deepEqual(s.calls.map(x=>x.name),['reset','config','stop_recording']);
});

test('revocation stays opted out, and regrant can initialize the same SDK instance safely',()=>{
 const s=setup({userId:user});s.calls.length=0;
 s.provider.stop();s.provider.track('game_started',{});
 assert.deepEqual(s.calls.map(x=>x.name),['stop_recording','reset','opt_out']);
 assert.equal(s.provider.recording(),false);
 s.calls.length=0;const regranted=s.create(otherUser);
 const identify=s.calls.find(x=>x.name==='identify');
 assert.equal(identify.id,otherUser);assert.equal(identify.replaying,false);
 regranted.track('page_leave',{page_path:'/game'});
 assert.equal(s.calls.at(-1).event,'$pageleave');assert.equal(regranted.recording(),true);
});

test('PostHog removes person enrichment and raw URL metadata before sending, and drops revoked events',()=>{
 const s=setup();
 const event={$set:{email:'private@example.com'},$set_once:{name:'Private'},properties:{page_path:'/game',points:50,
  $current_url:'https://site.test/game?email=private@example.com#secret',$initial_referrer:'https://private.example/?token=secret',
  $set:{email:'private@example.com'},$set_once:{phone:'+919876543210'},utm_source:'secret'}};
 const sanitized=s.config.before_send(event);
 assert.equal(sanitized.properties.$current_url,'https://site.test/game');assert.equal(sanitized.properties.$pathname,'/game');
 assert.equal(sanitized.properties.points,50);assert.doesNotMatch(JSON.stringify(sanitized),/private|secret|919876|\$set/);
 const mask=s.config.session_recording.maskAttributeFn;
 assert.equal(mask('value','private@example.com'),'[redacted]');assert.equal(mask('data-customer','private'),'[redacted]');
 assert.equal(mask('href','https://site.test/game?token=secret#private'),'https://site.test/game');
 assert.equal(s.config.session_recording.maskCapturedNetworkRequestFn({body:'private'}),null);
 const meta=s.config.session_recording.maskCapturedNetworkRequestFn({name:'https://site.test/game?email=private@example.com#secret'});
 assert.equal(meta.name,'https://site.test/game','rrweb Meta URL must survive without private query/hash');
 s.setConsent(false);assert.equal(s.config.before_send({properties:{page_path:'/game'}}),null);
});

test('analytics consent alone never starts recording; recording choice can change without reinitializing',()=>{
 const s=setup({recordingConsent:false});assert.equal(s.provider.recording(),false);
 s.provider.setRecordingAllowed(true);assert.equal(s.provider.recording(),true);
 s.provider.setRecordingAllowed(false);assert.equal(s.provider.recording(),false);
 assert.equal(s.calls.filter(x=>x.name==='init').length,1);
 s.setConsent(false);s.provider.setRecordingAllowed(true);assert.equal(s.provider.recording(),false);
 assert.equal(s.config.autocapture,false);assert.equal(s.config.capture_exceptions,false);
 const options=s.config.session_recording;
 assert.equal(options.recordBody,false);assert.equal(options.recordHeaders,false);
 assert.equal(options.captureCanvas.canvasFps,2);assert.equal(options.canvasCapture.resolutionScale,.5);
});

test('late authored canvas readiness retains every replay privacy option under SDK shallow set_config semantics',()=>{
 const s=setup();const original=s.config.session_recording;
 assert.equal(original.captureCanvas.recordCanvas,false);s.canvasReady(true);
 const recording=s.config.session_recording;assert.equal(recording.captureCanvas.recordCanvas,true);
 for(const key of Object.keys(original))if(key!=='captureCanvas')assert.equal(recording[key],original[key],key+' must survive late readiness');
 assert.equal(recording.canvasCapture.resolutionScale,.5);assert.equal(recording.maskAllInputs,true);
 assert.equal(recording.canvasCapture.maskRegionsFn({tagName:'CANVAS',id:'unknown',closest:()=>false}),null);
 assert.equal(recording.maskCapturedNetworkRequestFn({name:'https://site.test/game?token=private'}).name,'https://site.test/game');
});
