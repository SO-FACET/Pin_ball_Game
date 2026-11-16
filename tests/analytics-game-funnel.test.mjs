import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameFunnel} from '../analytics-source/game-funnel.js';
import {installAnalytics,cleanProperties} from '../analytics-source/runtime.js';
import {apiStarted,apiOutcome,apiFailure} from '../shared/analytics.js';

function funnel(){
 let duration=0;const events=[];
 const value=createGameFunnel({gameDuration:()=>duration,emit:(name,properties)=>events.push({name,properties})});
 return {value,events,time:ms=>duration=ms,event:(name,properties)=>value.event(name,properties)};
}
const outcomes=events=>events.filter(event=>event.name==='game_session_outcome').map(event=>event.properties);

test('loading or waiting at the launcher is before-play and never inherits another run duration',()=>{
 const s=funnel();s.event('game_started');s.event('game_play_started');s.time(45000);
 s.event('game_finished',{points:100,duration_ms:45000});s.event('reward_saved',{points:100});
 s.event('game_load_started');s.value.finish('pagehide');s.value.finish('pagehide');
 assert.deepEqual(outcomes(s.events).map(x=>[x.outcome,x.duration_ms,x.run_sequence]),[['saved',45000,1],['before_play',0,2]]);
 assert.equal(s.events.filter(event=>event.name==='game_abandoned').length,0);
});

test('only unfinished first-launch runs below30 active seconds are early quits; short completed games are separate',()=>{
 const s=funnel();s.event('game_started');s.event('game_play_started');s.time(29999);s.value.finish('restart');
 s.event('game_started');s.event('game_play_started');s.time(30000);s.value.finish('restart');
 s.event('game_started');s.event('game_play_started');s.time(2000);s.event('game_finished',{points:20,duration_ms:2000});s.value.finish('restart');
 s.event('game_started');s.event('game_play_started');s.time(1000);s.event('game_finished',{points:5,duration_ms:1000});s.value.finish('pagehide');
 assert.deepEqual(outcomes(s.events).map(x=>x.outcome),['quit_early','quit','completed_unsaved','completed_ineligible']);
 assert.deepEqual(s.events.filter(x=>x.name==='game_abandoned').map(x=>x.properties.early),[true,false]);
 assert.equal(s.events.filter(x=>x.name==='game_engaged').length,1);
});

test('save intent/success/outcome dedupe per run and stale or independent responses cannot save the next run',()=>{
 const s=funnel();s.event('game_started');const old=s.value.context();s.event('game_play_started');s.time(12000);s.event('game_finished',{points:100,duration_ms:12000});
 assert.ok(s.event('reward_save_started',{method:'button'}));assert.equal(s.event('reward_save_started',{method:'form'}),null);
 s.event('game_started');assert.equal(s.event('reward_saved',{...old,points:100}),null);
 assert.deepEqual(s.event('reward_saved',{run_sequence:0,points:100}),{points:100});
 s.event('game_play_started');s.time(5000);s.event('game_finished',{points:50,duration_ms:5000});s.event('reward_saved',{points:50});
 assert.equal(s.event('reward_saved',{points:50}),null);s.value.finish('pagehide');
 assert.deepEqual(outcomes(s.events).map(x=>[x.outcome,x.run_sequence]),[['completed_unsaved',1],['saved',2]]);
});

test('a restored old reward saving while a new game is active cannot complete or discard that unfinished game',()=>{
 const s=funnel();s.event('game_started');s.event('game_play_started');s.time(10000);
 assert.deepEqual(s.event('reward_save_started',{run_sequence:1,method:'form'}),{method:'form'});
 assert.deepEqual(s.event('reward_saved',{run_sequence:1,points:100}),{points:100});
 s.event('reward_discarded');assert.deepEqual(outcomes(s.events),[]);
 s.value.finish('pagehide');assert.equal(outcomes(s.events)[0].outcome,'quit_early');
});

function runtime(){
 let time=0,consent=true;const events=new Map(),documentEvents=new Map(),calls=[],timers=new Set();
 const add=(map,name,fn)=>{if(!map.has(name))map.set(name,[]);map.get(name).push(fn)};
 const dispatch=(map,name,value={})=>{for(const fn of map.get(name)||[])fn(value)};
 const win={location:new URL('https://site.test/game'),performance:{now:()=>time},document:{hidden:false,visibilityState:'visible',hasFocus:()=>true,addEventListener:(name,fn)=>add(documentEvents,name,fn)},
  history:{pushState(_state,_title,path){win.location=new URL(path,win.location)},replaceState(_state,_title,path){win.location=new URL(path,win.location)}},
  addEventListener:(name,fn)=>add(events,name,fn),dispatchEvent:event=>dispatch(events,event.type,event),Event:class{constructor(type){this.type=type}},
  sofacetCookiePreferences:{allows:()=>consent},setInterval(fn){timers.add(fn);return fn},clearInterval:fn=>timers.delete(fn),
  fetch:async path=>({ok:true,json:async()=>path==='/api/analytics-config'?{enabled:true,gaId:'G-TEST'}:{userId:null}})};
 win.top=win;
 const api=installAnalytics(win,{loadGoogle:async()=>({track:(name,properties)=>calls.push({name,properties}),identify(){},stop(){}})});
 return {api,win,calls,advance:ms=>time+=ms,tick(){for(const fn of [...timers])fn()},dispatch:(name,event)=>dispatch(events,name,event),
  visible(value){win.document.hidden=!value;win.document.visibilityState=value?'visible':'hidden';dispatch(documentEvents,'visibilitychange')},
  consent(value){consent=value;dispatch(events,'sofacet:cookie-preferences')}};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('runtime measures active foreground play, never treating pause/background/BFCache as a final quit',async()=>{
 const s=runtime();await settled();s.api.track('game_started');
 s.advance(60000);s.api.track('game_play_started');s.api.setGameActivity(true);s.advance(10000);s.api.setGameActivity(false);
 s.advance(60000);s.visible(false);s.advance(600000);s.dispatch('pagehide',{persisted:true});
 assert.deepEqual(outcomes(s.calls),[]);
 s.visible(true);s.dispatch('pageshow',{persisted:true});s.api.setGameActivity(true);s.advance(5000);s.api.track('game_started');
 assert.deepEqual(outcomes(s.calls).map(x=>[x.outcome,x.duration_ms]),[['quit_early',15000]]);
 s.api.setGameActivity(false);s.api.track('game_play_started');s.api.setGameActivity(true);s.advance(30000);s.tick();s.tick();
 assert.equal(s.calls.filter(x=>x.name==='game_engaged').length,1);
 s.api.track('game_finished',{points:50});s.api.track('reward_save_started',{method:'form'});s.api.track('reward_saved',{points:50});s.dispatch('pagehide',{persisted:false});
 assert.deepEqual(outcomes(s.calls).map(x=>x.outcome),['quit_early','saved']);
});

test('revocation drops all pending run state; regrant cannot backfill or label a previously untracked game',async()=>{
 const s=runtime();await settled();s.api.track('game_started');s.api.track('game_play_started');s.api.setGameActivity(true);s.advance(10000);s.consent(false);
 const before=s.calls.length;s.dispatch('pagehide',{persisted:false});s.api.track('reward_saved',{points:100});assert.equal(s.calls.length,before);
 s.consent(true);await settled();assert.deepEqual(s.api.getGameContext(),{});s.dispatch('pagehide',{persisted:false});assert.deepEqual(outcomes(s.calls),[]);
});

test('save request context captures run before network and covers signup, automatic saves and unsuccessful responses',()=>{
 const before=globalThis.window,calls=[];let run=1;
 const win={sofacetAnalytics:{getGameContext:()=>({run_sequence:run}),track:(name,properties)=>calls.push({name,properties}),captureError(){},refreshIdentity(){}}};win.top=win;globalThis.window=win;
 try{
  const signup=apiStarted('/api/membership',{gameId:'private-game-id',phone:'private'});run=2;
  apiFailure('/api/membership',{status:503},10,signup);
  const automatic=apiStarted('/api/membership/rewards',{gameId:'private-game-id'});
  apiOutcome('/api/membership/rewards',200,{success:true,pointsSaved:true,savedPoints:50},10,automatic);
  assert.deepEqual(calls.filter(x=>x.name==='reward_save_started').map(x=>x.properties.run_sequence),[1,2]);
  assert.equal(calls.find(x=>x.name==='reward_save_failed').properties.run_sequence,1);
  assert.equal(calls.find(x=>x.name==='reward_saved').properties.run_sequence,2);
  assert.doesNotMatch(JSON.stringify(calls),/private|phone/);
 }finally{if(before===undefined)delete globalThis.window;else globalThis.window=before}
});

test('funnel schema admits only bounded structural properties and no customer/game identifiers',()=>{
 assert.deepEqual(cleanProperties('game_abandoned',{run_sequence:2,stage:'playing',reason:'restart',duration_ms:15000,early:true,gameId:'private',email:'private',url:'private'}),{run_sequence:2,stage:'playing',reason:'restart',duration_ms:15000,early:true});
 assert.deepEqual(cleanProperties('game_session_outcome',{outcome:'completed_unsaved',stage:'verified',reason:'pagehide',points:50,run_sequence:1,save_requested:true}),{run_sequence:1,stage:'verified',reason:'pagehide',outcome:'completed_unsaved',points:50});
});
