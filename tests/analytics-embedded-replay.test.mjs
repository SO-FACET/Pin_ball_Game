import test from 'node:test';
import assert from 'node:assert/strict';
import {installEmbeddedReplay} from '../analytics-source/embedded-replay.js';

const settled=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({hold=false}={}){
 const parentListeners={},listeners={},calls=[],providers=[],pending=[];
 let analytics=false,recording=false,ready=false,context={sessionReplay:true,replayContext:{distinctId:'anonymous',sessionId:'session'}};
 const parent={sofacetCookiePreferences:{allows:category=>analytics&&(category!=='recording'||recording)},sofacetAnalytics:{getReplayContext:()=>analytics&&recording?context:null,captureError:error=>calls.push(['error',error.message])},addEventListener(name,fn){(parentListeners[name]??=[]).push(fn)}};
 const win={top:parent,document:{querySelector:()=>ready?{}:null,addEventListener(name,fn){listeners[name]=fn}},addEventListener(name,fn){listeners[name]=fn}};
 const replay=installEmbeddedReplay(win,{loadPosthog:async(config,allowed,_id,current)=>{
  calls.push(['load',structuredClone(config)]);if(hold)await new Promise(resolve=>pending.push(resolve));
  const provider={active:false,setRecordingAllowed(value){this.active=value;calls.push(['recording',value])},recording(){return this.active},stop(){this.active=false;calls.push(['stop'])}};
  providers.push(provider);assert.equal(typeof allowed,'function');assert.equal(typeof current,'function');return provider;
 }});
 const emit=name=>parentListeners[name]?.forEach(fn=>fn());
 return {calls,providers,replay,ready(value=true){ready=value;listeners['sofacet:public-canvas-ready']()},consent(a,r){analytics=a;recording=r;emit('sofacet:cookie-preferences')},context(value){context={...context,replayContext:value};emit('sofacet:replay-context')},release(index=0){pending[index]?.()},hide(){listeners.pagehide()},show(){listeners.pageshow()}};
}
test('iframe replay loads only for an initialized authored game with both consents',async()=>{
 const f=fixture();f.ready();f.consent(true,false);await settled();assert.deepEqual(f.calls,[]);
 f.consent(true,true);await settled();assert.equal(f.calls.filter(x=>x[0]==='load').length,1);assert.equal(f.replay.recording(),true);
 f.ready();f.consent(true,true);await settled();assert.equal(f.providers.length,1);
 f.consent(true,false);assert.equal(f.replay.recording(),false);assert.equal(f.providers[0].active,false);
 f.consent(true,true);await settled();assert.equal(f.providers.length,2);assert.equal(f.replay.recording(),true);
 f.hide();assert.equal(f.replay.recording(),false);f.show();await settled();assert.equal(f.providers.length,3);
});
test('revocation and a newer parent identity invalidate an SDK that is still importing',async()=>{
 const f=fixture({hold:true});f.ready();f.consent(true,true);await settled();f.consent(false,false);f.release();await settled();
 assert.equal(f.replay.recording(),false);assert.equal(f.providers[0].active,false);
 f.consent(true,true);await settled();f.context({distinctId:'new-anonymous',sessionId:'new-session'});f.release(1);await settled();
 assert.equal(f.providers[1].active,false);assert.equal(f.calls.filter(x=>x[0]==='load').length,3);
 f.release(2);await settled();assert.equal(f.replay.recording(),true);
 assert.deepEqual(f.calls.filter(x=>x[0]==='load').at(-1)[1].replayContext,{distinctId:'new-anonymous',sessionId:'new-session'});
});
