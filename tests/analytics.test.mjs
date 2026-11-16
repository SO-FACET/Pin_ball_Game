import test from 'node:test';
import assert from 'node:assert/strict';
import {installAnalytics,redact,cleanProperties,safePath} from '../analytics-source/runtime.js';
import {googleProvider} from '../analytics-source/providers.js';
import {analyticsConfig,analyticsUserId} from '../analytics-config.mjs';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
import {apiOutcome,apiFailure} from '../shared/analytics.js';

function setup({consent=false,recording=false,enabled=true,googleFails=false,holdPosthog=false,holdIdentity=false,identity='user_'+'a'.repeat(64)}={}){
 const events={},documentEvents={},calls=[],requests=[],loads=[];
 let allowed=consent,recordingAllowed=recording,resolvePosthog;
 const identityResolvers=[];
 const provider=kind=>({track:(name,properties)=>calls.push({kind,name,properties}),error:(error,properties)=>calls.push({kind,name:'error',message:error.message,stack:error.stack,properties}),identify:id=>calls.push({kind,name:'identify',id}),setRecordingAllowed:value=>calls.push({kind,name:'recording',value}),reset:()=>calls.push({kind,name:'reset'}),stop:()=>calls.push({kind,name:'stop'})});
 const win={location:new URL('https://site.test/game?email=private@example.com#secret'),document:{addEventListener:(name,fn)=>documentEvents[name]=fn},
  sofacetCookiePreferences:{allows:category=>allowed&&(category!=='recording'||recordingAllowed)},addEventListener:(name,fn)=>events[name]=fn,
  history:{pushState(state,_,url){win.location=new URL(url,win.location)},replaceState(state,_,url){win.location=new URL(url,win.location)}},
  fetch:async path=>{requests.push(path);if(path==='/api/analytics-identity'&&holdIdentity)await new Promise(resolve=>identityResolvers.push(resolve));return {ok:true,json:async()=>path==='/api/analytics-config'?{enabled,gaId:'G-TEST',posthogKey:'phc_test',environment:'test'}:{userId:identity}}},
 };win.top=win;
 const api=installAnalytics(win,{
  loadGoogle:async(_config,userId)=>{loads.push({kind:'ga',userId});if(googleFails)throw Error('Blocked');return provider('ga')},
  loadPosthog:async(_config,_allowed,userId)=>{loads.push({kind:'ph',userId});if(holdPosthog)await new Promise(resolve=>resolvePosthog=resolve);return provider('ph')},
 });
 return {win,api,calls,requests,loads,events,documentEvents,release:()=>resolvePosthog?.(),releaseIdentity:(index=0)=>identityResolvers[index]?.(),consent(value){allowed=value;events['sofacet:cookie-preferences']()},recording(value){recordingAllowed=value;events['sofacet:cookie-preferences']()}};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('recording-only preferences update the provider without another pageview, identity request or SDK load',async()=>{
 const s=setup({consent:true});await settled();
 const baseline={loads:s.loads.length,requests:s.requests.length,pageviews:s.calls.filter(x=>x.name==='page_view').length};
 assert.equal(s.calls.find(x=>x.kind==='ph'&&x.name==='recording').value,false);
 s.recording(true);await settled();assert.equal(s.calls.at(-1).value,true);
 s.recording(false);await settled();assert.equal(s.calls.at(-1).value,false);
 assert.deepEqual({loads:s.loads.length,requests:s.requests.length,pageviews:s.calls.filter(x=>x.name==='page_view').length},baseline);
 assert.equal(s.calls.filter(x=>x.name==='stop').length,0);
});

test('ordinary anonymous account-session refreshes preserve the PostHog visitor and session',async()=>{
 const s=setup({consent:true,identity:null});await settled();s.api.clearIdentity();s.api.clearIdentity();
 assert.equal(s.calls.filter(x=>x.kind==='ph'&&x.name==='reset').length,0);
 assert.equal(s.calls.filter(x=>x.kind==='ga'&&x.name==='page_view').length,1);
 s.api.resetIdentity();assert.equal(s.calls.filter(x=>x.kind==='ph'&&x.name==='reset').length,1,'Explicit logout still rotates an anonymous visitor');
});

test('one Error traversing multiple recovery boundaries is reported once with a symbolizable stack',async()=>{
 const s=setup({consent:true});await settled();const error=new TypeError('Renderer failed for private@example.com');
 error.stack='TypeError: private@example.com\n at render (https://site.test/assets/game-test.js?token=secret:4:328765)';
 s.api.captureError(error,{source:'entrance_renderer'});s.api.captureError(error,{source:'entrance_startup'});
 const errors=s.calls.filter(x=>x.kind==='ph'&&x.name==='error');assert.equal(errors.length,1);assert.match(errors[0].stack,/game-test\.js:4:328765/);assert.doesNotMatch(errors[0].stack,/private@example|token=secret/);
});

test('control changes and toggles report structure and state without input values',async()=>{
 const s=setup({consent:true});await settled();
 const control={id:'quality',type:'select-one',value:'private@example.com',getAttribute:()=>null,closest:()=>false};
 s.documentEvents.change({target:control});
 s.documentEvents.change({target:{...control,type:'email'}});
 s.documentEvents.change({target:{...control,id:'sound',type:'checkbox',checked:true}});
 s.documentEvents.toggle({target:{...control,tagName:'DETAILS',id:'faq_coins',open:true}});
 const actions=s.calls.filter(x=>x.kind==='ph'&&['ui_change','ui_toggle'].includes(x.name));
 assert.equal(actions.length,3);assert.equal(actions[1].properties.checked,true);assert.equal(actions[2].properties.expanded,true);
 assert.doesNotMatch(JSON.stringify(actions),/private@example|value/);
 s.api.track('game_control',{control:'launcher',action:'press',input_method:'keyboard',key:'Space'});
 assert.deepEqual(s.calls.at(-1).properties,{control:'launcher',action:'press',input_method:'keyboard',page_path:'/game',environment:'test',release:''});
});

test('no config, SDK, events or identity requests before analytics consent',async()=>{
 const s=setup();s.api.track('game_started');s.api.captureError(Error('hidden'));await settled();
 assert.deepEqual(s.requests,[]);assert.deepEqual(s.calls,[]);
 s.consent(true);await settled();assert.equal(s.api.getStatus().enabled,true);
 assert.equal(s.calls.filter(x=>x.name==='page_view').length,2);
 assert.equal(s.requests.filter(x=>x==='/api/analytics-identity').length,1);
});
test('disabled config does not load providers or collect',async()=>{
 const s=setup({consent:true,enabled:false});await settled();s.api.track('game_started');
 assert.deepEqual(s.calls,[]);assert.equal(s.api.getStatus().enabled,false);
});
test('route changes track one pageview per path and omit queries, hashes and unknown URLs',async()=>{
 const s=setup({consent:true});await settled();
 s.win.history.replaceState({},'', '/game?token=private');
 s.win.history.pushState({},'', '/reward?email=private@example.com');
 s.win.history.replaceState({},'', '/reward#private');
 s.win.history.pushState({},'', '/person/private@example.com');
 assert.deepEqual(s.calls.filter(x=>x.kind==='ga'&&x.name==='page_view').map(x=>x.properties.page_path),['/game','/reward','/404']);
 assert.doesNotMatch(JSON.stringify(s.calls),/private|token|email=/);
});
test('history transitions attribute leave time to the screen being left and restore cached pages once',async()=>{
 const s=setup({consent:true});await settled();
 s.win.history.pushState({},'','/claim?game=private');
 s.win.history.replaceState({},'','/verify');
 assert.deepEqual(s.calls.filter(x=>x.kind==='ga'&&x.name==='page_leave').map(x=>x.properties.page_path),['/game','/claim']);
 s.events.pagehide();s.events.pagehide();
 assert.deepEqual(s.calls.filter(x=>x.kind==='ga'&&x.name==='page_leave').map(x=>x.properties.page_path),['/game','/claim','/verify']);
 s.events.pageshow({persisted:true});s.events.pageshow({persisted:true});
 assert.deepEqual(s.calls.filter(x=>x.kind==='ga'&&x.name==='page_view').map(x=>x.properties.page_path),['/game','/claim','/verify','/verify']);
 assert.ok(s.calls.filter(x=>x.name==='page_leave').every(x=>x.properties.duration_ms>=0));
});
test('providers wait for verified identity before collecting the first pageview',async()=>{
 const s=setup({consent:true,holdIdentity:true});await settled();
 assert.deepEqual(s.loads,[]);assert.deepEqual(s.calls,[]);
 s.api.track('game_started');s.releaseIdentity();await settled();
 assert.ok(s.loads.every(x=>x.userId==='user_'+'a'.repeat(64)));
 assert.deepEqual(s.calls.filter(x=>x.kind==='ga'&&['page_view','game_started'].includes(x.name)).map(x=>x.name),['page_view','game_started']);
 const expired=setup({consent:true,holdIdentity:true});await settled();
 expired.api.resetIdentity();expired.releaseIdentity();await settled();
 assert.ok(expired.loads.length===2&&expired.loads.every(x=>x.userId===null),'old identity response cannot overwrite signout during startup');
});
test('a concurrent session refresh cannot release startup before its latest identity response',async()=>{
 const s=setup({consent:true,holdIdentity:true});await settled();
 const latest=s.api.refreshIdentity();
 s.releaseIdentity(0);await settled();
 assert.deepEqual(s.loads,[]);assert.equal(s.calls.filter(x=>x.name==='page_view').length,0);
 s.releaseIdentity(1);await latest;await settled();
 assert.equal(s.loads.length,2);assert.ok(s.loads.every(x=>x.userId==='user_'+'a'.repeat(64)));
 assert.equal(s.calls.filter(x=>x.name==='page_view').length,2);
});
test('contact links and FAQ controls are useful without collecting link addresses or cookie-dialog actions',async()=>{
 const s=setup({consent:true});await settled();
 const click=({tagName='BUTTON',href='',control,cookie=false,disabled=false}={})=>{
  const element={tagName,href,disabled,id:'',closest:selector=>selector.includes('#sf-cookie-root')&&cookie,
   getAttribute:name=>name==='data-analytics-control'?control:null};
  s.documentEvents.click({target:{closest:()=>element}});
 };
 click({tagName:'A',href:'mailto:private@example.com?subject=secret',control:'contact_support'});
 click({tagName:'A',href:'tel:+919876543210',control:'contact_phone'});
 click({tagName:'SUMMARY',control:'faq_coins'});
 click({control:'claim_verify',disabled:true});click({control:'accept',cookie:true});
 s.documentEvents.submit({target:{id:'cookie',closest:()=>true}});
 s.documentEvents.invalid({target:{type:'email',form:{id:'cookie'},closest:()=>true}});
 const actions=s.calls.filter(x=>x.kind==='ga'&&['navigation_click','ui_click','form_submit','form_invalid'].includes(x.name));
 assert.deepEqual(actions.map(x=>x.properties.control),['contact_support','contact_phone','faq_coins']);
 assert.deepEqual(actions.slice(0,2).map(x=>[x.properties.destination,x.properties.link_kind]),[['email','email'],['phone','phone']]);
 assert.doesNotMatch(JSON.stringify(actions),/private|secret|9876543210/);
 s.api.track('notify_form_completed');
 assert.equal(s.calls.filter(x=>x.name==='notify_form_completed').length,0,'removed Notify form is no longer an event');
 assert.deepEqual(cleanProperties('api_request',{endpoint:'/api/account/session'}),{endpoint:'/api/account/session'});
});
test('revoke stops providers, drops events, clears pending queues and can regrant',async()=>{
 const s=setup({consent:true});await settled();s.consent(false);
 const length=s.calls.length;s.api.track('game_started');s.api.captureError(Error('ignored'));await s.api.refreshIdentity();
 assert.equal(s.calls.length,length);assert.equal(s.calls.filter(x=>x.name==='stop').length,2);
 s.consent(true);await settled();assert.equal(s.calls.filter(x=>x.name==='page_view').length,4);
});
test('revocation while an SDK loads drops the consented queue and stops the late provider',async()=>{
 const s=setup({consent:true,holdPosthog:true});await settled();s.api.track('game_started');s.consent(false);s.release();await settled();
 assert.equal(s.calls.filter(x=>x.name==='game_started'||x.name==='page_view').length,0);
 assert.equal(s.calls.filter(x=>x.name==='stop').length,2);
});
test('blocked GA does not prevent PostHog events, error limits or identity',async()=>{
 const s=setup({consent:true,googleFails:true});await settled();s.api.track('game_finished',{points:20,email:'secret@example.com'});
 for(let i=0;i<25;i++)s.api.captureError(Error('OTP 012345 for secret@example.com +919876543210 token=abcdefghijklmnopqrstuvwxyz'),{source:'api',body:'private',endpoint:'/api/account'});
 assert.equal(s.calls.filter(x=>x.name==='game_finished').length,1);
 assert.equal(s.calls.filter(x=>x.name==='error').length,20);
 assert.doesNotMatch(JSON.stringify(s.calls),/secret@example|012345|919876|abcdefghijklmnopqrstuvwxyz|"body"/);
});
test('embedded documents forward events and errors without initializing SDKs or pageviews',async()=>{
 const s=setup({consent:true});await settled();
 const child={...s.win,top:s.win,sofacetAnalytics:undefined};const proxy=installAnalytics(child,{loadGoogle:()=>assert.fail('child SDK')});
 proxy.track('game_started',{online:true});proxy.captureError(Error('child failed'),{source:'game'});await settled();
 assert.equal(s.calls.filter(x=>x.name==='page_view').length,2);
 assert.equal(s.calls.filter(x=>x.name==='game_started').length,2);
 assert.equal(s.requests.filter(x=>x==='/api/analytics-config').length,1);
 proxy.resetIdentity();
 assert.equal(s.calls.filter(x=>x.name==='reset').length,1,'embedded account expiry clears the outer identity');
});
test('unknown events, properties, unsafe endpoint identifiers and nonfinite values are discarded',()=>{
 assert.deepEqual(cleanProperties('game_finished',{points:Infinity,email:'x',duration_ms:2.2}),{duration_ms:2});
 assert.deepEqual(cleanProperties('api_request',{endpoint:'/api/games/secret/finish',status:500}),{status:500});
 assert.equal(safePath('/customer/123','https://site.test'),'/404');
 assert.doesNotMatch(redact('https://site.test/game?token=secret#private x@example.com 654321'),/secret|private|x@example|654321/);
});
test('public config is explicitly enabled and does not expose private credentials',()=>{
 assert.equal(analyticsConfig({GA4_MEASUREMENT_ID:'G-TEST'}).enabled,false);
 const config=analyticsConfig({ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST',POSTHOG_PUBLIC_KEY:'phc_test',POSTHOG_HOST:'http://invalid.test',REWARDS_API_KEY:'private',ANALYTICS_ID_SECRET:'private'});
 assert.equal(config.gaId,'G-TEST');assert.equal(config.posthogKey,'');assert.doesNotMatch(JSON.stringify(config),/private/);
 assert.equal(analyticsUserId('cus_test','short'),null);
 assert.match(analyticsUserId('cus_test','a'.repeat(32)),/^user_[a-f0-9]{64}$/);
 assert.notEqual(analyticsUserId('cus_test','a'.repeat(32)),analyticsUserId('cus_test','b'.repeat(32)));
});
test('optional session recording is off by default and requires an explicit true flag',()=>{
 for(const value of [undefined,'','false','TRUE','1'])assert.equal(analyticsConfig({ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST',POSTHOG_SESSION_REPLAY:value}).sessionReplay,false,String(value));
 const explicit=analyticsConfig({ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST',POSTHOG_SESSION_REPLAY:'true'});
 assert.equal(explicit.sessionReplay,true);assert.equal(explicit.posthogKey,'','a replay flag alone cannot configure or activate another provider');
});
test('GA config disables automatic pageviews and all advertising; revoke disables queued tracking',()=>{
 const scripts=[],cookies=[];
 const doc={getElementById:()=>null,createElement:()=>({}),head:{append:script=>scripts.push(script)},get cookie(){return '_ga=one; _ga_TEST=two; essential=keep'},set cookie(value){cookies.push(value)}};
 const win={document:doc,location:new URL('https://site.test/game?secret=yes')};
 const provider=googleProvider(win,{gaId:'G-TEST'});
 provider.track('game_started',{page_path:'/game'});provider.stop();
 assert.equal(win['ga-disable-G-TEST'],true);assert.equal(win.dataLayer.at(-1)[0],'consent');assert.equal(win.dataLayer.at(-1)[2].analytics_storage,'denied');
 assert.equal(scripts.length,1);assert.ok(cookies.length>=2);assert.ok(cookies.every(x=>!x.startsWith('essential=')));
});
test('shared page shell inserts one versioned analytics controller after cookie preferences',()=>{
 const html=withGameLoader(withGameLoader('<html><head></head><body></body></html>'));
 assert.equal((html.match(/src="\/assets\/analytics.js/g)||[]).length,1);
 assert.ok(html.indexOf('id="cookie-preferences"')<html.indexOf('src="/assets/analytics.js'));
});
test('API event facade distinguishes confirmed results from unsuccessful payloads and masks game IDs',()=>{
 const before=globalThis.window,calls=[];
 globalThis.window={};globalThis.window.top=globalThis.window;
 globalThis.window.sofacetAnalytics={track:(name,props)=>calls.push({name,props}),refreshIdentity(){},captureError(){},resetIdentity(){}};
 try{
  apiOutcome('/api/membership',200,{success:false},10);
  assert.equal(calls.filter(x=>x.name==='sign_up').length,0);
  apiOutcome('/api/membership',200,{success:true,player:{member:true},pointsSaved:true,savedPoints:50,email:'private@example.com'},20);
  assert.equal(calls.filter(x=>x.name==='sign_up').length,1);assert.equal(calls.filter(x=>x.name==='reward_saved').length,1);
  apiFailure('/api/games/private-id/finish',{status:503},10);
  assert.doesNotMatch(JSON.stringify(calls),/private|email/);assert.ok(calls.some(x=>x.props.endpoint==='/api/games/:id/finish'));
 }finally{if(before===undefined)delete globalThis.window;else globalThis.window=before}
});
