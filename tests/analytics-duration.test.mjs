import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedDuration,createDurationClock,MAX_DURATION_MS} from '../analytics-source/duration.js';
import {cleanProperties,installAnalytics} from '../analytics-source/runtime.js';

function clock(){
 let time=0;const events=[];
 const value=createDurationClock({now:()=>time,emit:(name,properties,path)=>events.push({name,properties,path})});
 return {value,events,advance:ms=>time+=ms,setTime:value=>time=value};
}
const sum=(events,name,key)=>events.filter(event=>event.name===name).reduce((total,event)=>total+event.properties[key],0);

test('duration schema accepts finite numbers, bounds time only, and keeps native GA engagement untouched',()=>{
 for(const value of [undefined,null,'15000',NaN,Infinity,-Infinity])assert.equal(boundedDuration(value),null);
 assert.equal(boundedDuration(-5),0);assert.equal(boundedDuration(MAX_DURATION_MS+1),MAX_DURATION_MS);
 assert.deepEqual(cleanProperties('page_engagement',{page_active_ms:15000,email:'private',engagement_time_msec:15000}),{page_active_ms:15000});
 assert.deepEqual(cleanProperties('game_engagement',{game_active_ms:MAX_DURATION_MS*2}),{game_active_ms:MAX_DURATION_MS});
 assert.deepEqual(cleanProperties('game_finished',{points:MAX_DURATION_MS*10,duration_ms:MAX_DURATION_MS*2}),{points:MAX_DURATION_MS*10,duration_ms:MAX_DURATION_MS});
 assert.deepEqual(cleanProperties('api_request',{duration_ms:12.2,status:200}),{status:200,duration_ms:12});
});

test('page and game deltas exclude hidden time, while paused game time still counts as page time',()=>{
 const s=clock();s.value.start({active:true,visible:true});s.value.enterPage('/game');
 s.advance(2500);s.value.flush();s.advance(1000);s.value.setGameActivity(false);
 s.advance(60000);s.value.flush();s.value.setForeground(false);s.advance(600000);s.value.flush();
 s.value.setForeground(true);s.advance(500);const total=s.value.leavePage();
 assert.equal(total,64000);assert.equal(sum(s.events,'page_engagement','page_active_ms'),64000);
 assert.equal(sum(s.events,'game_engagement','game_active_ms'),3500);
 assert.ok(s.events.every(event=>Object.values(event.properties).every(value=>Number.isFinite(value)&&value>0)));
});

test('route transitions flush the old page once and each page total excludes time already spent elsewhere',()=>{
 const s=clock();s.value.start({visible:true});s.value.enterPage('/how-coins-work');
 s.advance(1500);s.value.enterPage('/privacy');s.value.enterPage('/privacy');s.advance(750);
 assert.equal(s.value.leavePage(),750);s.value.leavePage();s.value.flush();
 assert.deepEqual(s.events,[{name:'page_engagement',properties:{page_active_ms:1500},path:'/how-coins-work'},{name:'page_engagement',properties:{page_active_ms:750},path:'/privacy'}]);
});

test('game fractions cannot follow a route transition into a different page',()=>{
 const s=clock();s.value.start({active:true,visible:true});s.value.enterPage('/game');
 s.advance(.75);s.value.leavePage();s.value.enterPage('/about');s.value.setGameActivity(false);
 s.advance(1000);s.value.flush();assert.equal(sum(s.events,'game_engagement','game_active_ms'),0);
 assert.ok(s.events.every(event=>event.path!=='/about'||event.name!=='game_engagement'));
});

test('fractional foreground segments carry their remainder instead of rounding every transition away',()=>{
 const s=clock();s.value.start({active:true,visible:true});s.value.enterPage('/game');
 for(let index=0;index<100;index++){s.advance(.25);s.value.flush()}
 assert.equal(sum(s.events,'page_engagement','page_active_ms'),25);assert.equal(sum(s.events,'game_engagement','game_active_ms'),25);
});

test('revoke discards unsent page and run time; a new epoch never includes the consent gap',()=>{
 const s=clock();s.value.start({active:true,visible:true});s.value.enterPage('/game');
 s.advance(1000);s.value.stop();s.advance(60000);s.value.flush();assert.deepEqual(s.events,[]);
 s.value.start({active:true,visible:true});s.value.enterPage('/game');s.advance(2000);
 assert.equal(s.value.finishGame(),2000);assert.equal(s.value.leavePage(),2000);
 assert.equal(sum(s.events,'game_engagement','game_active_ms'),2000);
});

test('run restart flushes an unfinished run and resets only the next run total',()=>{
 const s=clock();s.value.start({active:true,visible:true});s.value.enterPage('/game');
 s.advance(1200);s.value.startGame();s.advance(800);s.value.setGameActivity(false);s.advance(5000);
 assert.equal(s.value.finishGame(),800);assert.equal(sum(s.events,'game_engagement','game_active_ms'),2000);
 assert.equal(s.value.leavePage(),7000);
});

test('bad clock samples and provider failures cannot duplicate elapsed time or break other emissions',()=>{
 let time=100,attempts=[];
 const value=createDurationClock({now:()=>time,emit:(name,properties)=>{attempts.push({name,properties});if(name==='page_engagement')throw Error('blocked provider')}});
 value.start({visible:true,active:true});value.enterPage('/game');time=200;value.flush();
 time=NaN;value.flush();time=50;value.flush();time=300;value.flush();value.flush();
 assert.equal(sum(attempts,'page_engagement','page_active_ms'),200);assert.equal(sum(attempts,'game_engagement','game_active_ms'),200);
 time=MAX_DURATION_MS*3;value.flush();assert.ok(attempts.every(event=>Object.values(event.properties).every(ms=>ms<=MAX_DURATION_MS)));
});

function runtime({consent=true,enabled=true,holdProvider=false}={}){
 let time=0,allowed=consent,resolveProvider,nextTimer=0;
 const events=new Map(),documentEvents=new Map(),timers=new Map(),calls=[],requests=[],ready=[];
 const add=(map,name,listener)=>{if(!map.has(name))map.set(name,new Set());map.get(name).add(listener)};
 const dispatch=(map,name,event={})=>{for(const listener of map.get(name)||[])listener(event)};
 const win={
  location:new URL('https://site.test/game?email=private@example.com#secret'),performance:{now:()=>time},
  document:{hidden:false,visibilityState:'visible',hasFocus:()=>win.focused,addEventListener:(name,listener)=>add(documentEvents,name,listener)},focused:true,
  sofacetCookiePreferences:{allows:()=>allowed},addEventListener:(name,listener)=>add(events,name,listener),
  Event:class{constructor(type){this.type=type}},dispatchEvent:event=>{ready.push(event.type);dispatch(events,event.type,event)},
  history:{pushState(_state,_title,path){win.location=new URL(path,win.location)},replaceState(_state,_title,path){win.location=new URL(path,win.location)}},
  setInterval(callback,ms){assert.equal(ms,15000);const id=++nextTimer;timers.set(id,callback);return id},clearInterval:id=>timers.delete(id),
  fetch:async path=>{requests.push(path);return {ok:true,json:async()=>path==='/api/analytics-config'?{enabled,gaId:'G-TEST',posthogKey:'',environment:'test'}:{userId:null}}},
 };win.top=win;
 const api=installAnalytics(win,{loadGoogle:async()=>{if(holdProvider)await new Promise(resolve=>resolveProvider=resolve);return {track:(name,properties)=>calls.push({name,properties}),identify(){},stop(){}}}});
 return {api,win,calls,requests,timers,ready,advance:ms=>time+=ms,tick(){for(const callback of [...timers.values()])callback()},release:()=>resolveProvider?.(),dispatch:(name,event)=>dispatch(events,name,event),consent(value){allowed=value;dispatch(events,'sofacet:cookie-preferences')},visible(value){win.document.hidden=!value;win.document.visibilityState=value?'visible':'hidden';dispatch(documentEvents,'visibilitychange')},focus(value){win.focused=value;dispatch(events,value?'focus':'blur')}};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('one foreground interval reports positive deltas and stops while unfocused, hidden or revoked',async()=>{
 const s=runtime();await settled();assert.equal(s.timers.size,1);assert.deepEqual(s.ready,['sofacet:analytics-ready','sofacet:analytics-enabled']);
 s.api.track('game_started');s.api.setGameActivity(true);s.advance(15000);s.tick();
 assert.equal(sum(s.calls,'page_engagement','page_active_ms'),15000);assert.equal(sum(s.calls,'game_engagement','game_active_ms'),15000);
 s.focus(false);assert.equal(s.timers.size,0);s.advance(60000);s.visible(false);s.dispatch('pagehide',{persisted:true});
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),15000);
 s.visible(true);s.focus(true);s.dispatch('pageshow',{persisted:true});s.dispatch('pageshow',{persisted:true});assert.equal(s.timers.size,1);
 s.advance(1000);s.api.setGameActivity(false);s.advance(2000);s.api.track('game_finished',{points:200,duration_ms:999999});
 assert.equal(s.calls.find(event=>event.name==='game_finished').properties.duration_ms,16000);
 s.consent(false);assert.equal(s.timers.size,0);const count=s.calls.length;s.advance(10000);s.tick();s.dispatch('pagehide');assert.equal(s.calls.length,count);
});

test('mid-game consent/provider readiness starts a fresh clock and never backfills earlier activity',async()=>{
 const s=runtime({consent:false,holdProvider:true});s.api.setGameActivity(true);s.advance(30000);assert.equal(s.timers.size,0);assert.deepEqual(s.requests,[]);
 s.consent(true);await settled();s.advance(10000);assert.equal(s.timers.size,0);s.release();await settled();assert.equal(s.timers.size,1);
 s.advance(2000);s.api.setGameActivity(false);assert.equal(sum(s.calls,'game_engagement','game_active_ms'),2000);
 s.api.setGameActivity(true);s.advance(500);s.consent(false);s.advance(30000);s.consent(true);await settled();s.release();await settled();
 s.advance(1000);s.api.track('game_finished',{duration_ms:999999});assert.equal(s.calls.find(event=>event.name==='game_finished').properties.duration_ms,1000);
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),3000);
});

test('a route queued while the provider loads gets a fresh ready clock without another pageview',async()=>{
 const s=runtime({holdProvider:true});await settled();s.advance(12000);
 s.win.history.pushState({},'','/privacy?token=private');s.advance(40000);assert.equal(s.timers.size,0);
 s.release();await settled();assert.equal(s.timers.size,1);
 assert.equal(s.calls.filter(event=>event.name==='page_view'&&event.properties.page_path==='/privacy').length,1);
 s.advance(5000);s.dispatch('pagehide');
 assert.equal(s.calls.find(event=>event.name==='page_leave'&&event.properties.page_path==='/privacy').properties.duration_ms,5000);
 assert.equal(sum(s.calls.filter(event=>event.properties.page_path==='/privacy'),'page_engagement','page_active_ms'),5000);
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),0);assert.equal(s.timers.size,0);
});

test('SPA paths, repeated hide and BFCache restoration attribute only foreground segments once',async()=>{
 const s=runtime();await settled();s.advance(1000);s.win.history.pushState({},'','/privacy?token=private');
 s.advance(2000);s.visible(false);s.dispatch('pagehide');s.dispatch('pagehide');s.advance(60000);
 s.visible(true);s.dispatch('pageshow',{persisted:true});s.dispatch('pageshow',{persisted:true});s.advance(500);s.dispatch('pagehide');
 assert.deepEqual(s.calls.filter(event=>event.name==='page_engagement').map(event=>[event.properties.page_path,event.properties.page_active_ms]),[['/game',1000],['/privacy',2000],['/privacy',500]]);
 assert.deepEqual(s.calls.filter(event=>event.name==='page_leave').map(event=>event.properties.duration_ms),[1000,2000,500]);
 assert.doesNotMatch(JSON.stringify(s.calls),/private|token|email=/);
});

test('stale active iframe state cannot accrue gameplay on information routes or override a later pause',async()=>{
 const s=runtime();await settled();s.api.track('game_started');s.api.setGameActivity(true);
 s.advance(1000.75);s.win.history.pushState({},'','/about');
 s.api.setGameActivity(true);s.advance(60000);s.tick();s.win.history.pushState({},'','/privacy');s.advance(15000);s.tick();
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),1000);
 assert.ok(s.calls.filter(event=>event.name==='game_engagement').every(event=>event.properties.page_path==='/game'));
 s.api.setGameActivity(false);s.win.history.pushState({},'','/game');s.advance(5000);s.tick();
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),1000);
 s.api.setGameActivity(true);s.advance(2000);s.api.setGameActivity(false);
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),3000);s.api.track('game_finished');
 assert.equal(s.calls.find(event=>event.name==='game_finished').properties.duration_ms,3000);
 s.consent(false);
});

test('returning to the canonical game route uses cached activity without backfilling the other page',async()=>{
 const s=runtime();await settled();s.api.setGameActivity(true);s.advance(1000);s.win.history.pushState({},'','/about');
 s.advance(60000);s.win.history.pushState({},'','/game');s.advance(2000);s.api.setGameActivity(false);
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),3000);s.consent(false);
});

test('embedded activity delegates once, creates no interval, and invalid inputs cannot change the gate',async()=>{
 const s=runtime();await settled();
 const child={...s.win,top:s.win,sofacetAnalytics:undefined};const proxy=installAnalytics(child,{loadGoogle:()=>assert.fail('child must not load an SDK')});
 proxy.setGameActivity(true);s.advance(1000);proxy.setGameActivity('false');proxy.setGameActivity(false);
 assert.equal(sum(s.calls,'game_engagement','game_active_ms'),1000);assert.equal(s.timers.size,1);assert.equal(s.requests.filter(path=>path==='/api/analytics-config').length,1);
 s.consent(false);
});

test('disabled configuration installs no timer and discards active-state time',async()=>{
 const s=runtime({enabled:false});s.api.setGameActivity(true);await settled();s.advance(15000);s.tick();s.dispatch('pagehide');
 assert.equal(s.timers.size,0);assert.deepEqual(s.calls,[]);
});
