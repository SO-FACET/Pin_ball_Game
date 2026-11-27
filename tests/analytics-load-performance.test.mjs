import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadTracker,recordLoadMetric} from '../shared/load-performance.js';
import {deviceContext,cleanLoadProperties} from '../analytics-source/load-performance.js';
import {installAnalytics} from '../analytics-source/runtime.js';
import {googleProvider} from '../analytics-source/providers.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){await turn();await turn()}
function fixture({consent=false,hints}={}){
 let now=0,sequence=0,allowed=consent;
 const timers=new Map(),calls=[],requests=[];
 const document=Object.assign(new EventTarget(),{hidden:false,visibilityState:'visible',readyState:'loading',hasFocus:()=>true});
 const navigator={userAgent:'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',hardwareConcurrency:8,deviceMemory:4,
  connection:{effectiveType:'4g',downlink:8.5,rtt:150,saveData:false},...hints?{userAgentData:{mobile:true,getHighEntropyValues:hints}}:{}};
 const win=Object.assign(new EventTarget(),{document,navigator,CustomEvent,innerWidth:393,innerHeight:852,screen:{width:393,height:852},devicePixelRatio:3,
  location:new URL('https://sofacet.com/?token=private@example.com'),performance:{now:()=>now,getEntriesByType:()=>[]},
  sofacetCookiePreferences:{allows:()=>allowed},
  setTimeout(callback,delay){const id=++sequence;timers.set(id,{callback,at:now+delay});return id},clearTimeout(id){timers.delete(id)},
  history:{pushState(){},replaceState(){}},
  fetch:async path=>{requests.push(path);return {ok:true,json:async()=>path==='/api/analytics-config'?{enabled:true,gaId:'G-TEST',posthogKey:'phc_test',environment:'test'}:{userId:null}}},
 });win.top=win;
 const provider=kind=>({track:(name,properties)=>calls.push({kind,name,properties}),identify(){},clearIdentity(){},stop(){}});
 return {win,document,calls,requests,timers,
  install(){return installAnalytics(win,{loadGoogle:async()=>provider('ga'),loadPosthog:async()=>provider('ph')})},
  advance(time){now=time;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}},
  consent(value){allowed=value;win.dispatchEvent(new CustomEvent('sofacet:cookie-preferences'))},
  metrics(){return win.__sofacetLoadMetrics.entries.map(entry=>entry.properties)},
 };
}

test('a 30-second logo wait measures from navigation and preserves visibility and download context',()=>{
 const f=fixture();f.advance(2500);
 let bytes=0;
 const tracker=createLoadTracker(f.win,{stage:'entrance',fromNavigation:true,metrics:()=>({network_bytes:bytes,video_width:3840})});
 f.advance(9000);f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
 bytes=20000000;f.advance(15000);
 f.advance(19000);f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
 bytes=199898628;f.advance(30000);tracker.finish();tracker.finish();
 assert.deepEqual(f.metrics().map(x=>x.load_outcome),['started','slow','ready']);
 const ready=f.metrics().at(-1);
 assert.equal(ready.duration_ms,30000);assert.equal(ready.active_ms,20000);assert.equal(ready.was_hidden,true);
 assert.equal(ready.network_bytes,199898628);assert.equal(ready.video_width,3840);assert.equal(f.timers.size,0);
});

test('late analytics consent sends the original startup duration once to both providers',async()=>{
 const f=fixture();const tracker=createLoadTracker(f.win,{stage:'entrance',fromNavigation:true});
 f.advance(30000);tracker.finish();f.install();await settle();
 assert.deepEqual(f.requests,[]);assert.deepEqual(f.calls,[]);
 f.consent(true);await settle();
 const ready=f.calls.filter(x=>x.name==='load_performance'&&x.properties.load_outcome==='ready');
 assert.equal(ready.length,2);assert.ok(ready.every(x=>x.properties.duration_ms===30000));
 assert.ok(ready.every(x=>x.properties.device_type==='mobile'&&x.properties.browser==='Chrome'&&x.properties.os==='Android'));
 assert.doesNotMatch(JSON.stringify(f.calls),/private@example|Mozilla|token=/);
 f.win.dispatchEvent(new CustomEvent('sofacet:load-performance'));f.consent(true);await settle();
 assert.equal(f.calls.filter(x=>x.name==='load_performance'&&x.properties.load_outcome==='ready').length,2);
});

test('available Android client hints enrich the model only after consent without delaying the app',async()=>{
 let lookups=0;
 const f=fixture({hints:async keys=>{lookups++;assert.deepEqual(keys,['model','platformVersion']);return {model:'SM-S928B',platformVersion:'14.0.0'}}});
 f.install();await settle();assert.equal(lookups,0);
 const tracker=createLoadTracker(f.win,{stage:'entrance',fromNavigation:true});f.advance(30000);tracker.finish();
 f.consent(true);await settle();assert.equal(lookups,1);
 const ready=f.calls.find(x=>x.name==='load_performance'&&x.properties.load_outcome==='ready');
 assert.equal(ready.properties.device_model,'SM-S928B');assert.equal(ready.properties.os_major,14);
 assert.equal(ready.properties.duration_ms,30000);assert.equal(ready.properties.viewport_width,393);
 assert.equal(ready.properties.device_memory_gb,4);assert.equal(ready.properties.cpu_cores,8);
 assert.equal(ready.properties.effective_type,'4g');assert.equal(ready.properties.connection_type,'unknown','effective 4g is not proof of cellular transport');
});

test('model lookup timeout and immediate abandonment cannot hold up or lose loading events',async()=>{
 const f=fixture({consent:true,hints:()=>new Promise(()=>{})});f.install();await settle();
 const tracker=createLoadTracker(f.win,{stage:'entrance',fromNavigation:true});
 f.advance(200);f.win.dispatchEvent(new Event('pagehide'));tracker.finish();
 const abandoned=f.calls.filter(x=>x.name==='load_performance'&&x.properties.load_outcome==='abandoned');
 assert.equal(abandoned.length,2);assert.equal(abandoned[0].properties.duration_ms,200);
 f.advance(1000);await settle();
 assert.equal(f.calls.filter(x=>x.name==='load_performance'&&x.properties.load_outcome==='abandoned').length,2);
 assert.equal(f.calls.filter(x=>x.name==='load_performance'&&x.properties.load_outcome==='ready').length,0);
});

test('revocation cancels pending model enrichment and cannot release old performance events',async()=>{
 let resolve;
 const f=fixture({consent:true,hints:()=>new Promise(yes=>{resolve=yes})});f.install();await settle();
 const tracker=createLoadTracker(f.win,{stage:'entrance',fromNavigation:true});f.advance(100);tracker.finish();
 f.consent(false);resolve({model:'SM-S928B'});await settle();
 assert.equal(f.calls.filter(x=>x.name==='load_performance').length,0);
 assert.equal(f.timers.size,0);
});

test('bfcache pagehide is not abandoned; failures and retries have one terminal result each',()=>{
 const f=fixture();const first=createLoadTracker(f.win,{stage:'game'});
 const cached=new Event('pagehide');cached.persisted=true;f.win.dispatchEvent(cached);
 f.advance(800);first.finish('failed',{failure_code:'asset'});first.finish();
 const second=createLoadTracker(f.win,{stage:'game'});f.advance(1800);second.finish();
 const terminal=f.metrics().filter(x=>['ready','failed','abandoned'].includes(x.load_outcome));
 assert.deepEqual(terminal.map(x=>[x.load_sequence,x.load_outcome,x.duration_ms]),[[1,'failed',800],[2,'ready',1000]]);
});

test('all ordinary pages report document timing separately from the entrance logo',async()=>{
 const f=fixture({consent:true});f.win.performance.getEntriesByType=()=>[{requestStart:100,responseStart:500,domContentLoadedEventEnd:800,loadEventEnd:1200}];
 f.install();await settle();f.win.dispatchEvent(new Event('load'));f.advance(1300);
 const page=f.calls.find(x=>x.name==='load_performance'&&x.properties.load_stage==='page');
 assert.equal(page.properties.duration_ms,1200);assert.equal(page.properties.ttfb_ms,400);
 assert.equal(page.properties.dom_ready_ms,800);assert.equal(page.properties.load_outcome,'ready');
});

test('device context labels iPhone honestly and parses browser-specific versions',()=>{
 const f=fixture();f.win.navigator={userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'};
 const iphone=deviceContext(f.win);assert.equal(iphone.device_model,'iPhone');assert.equal(iphone.os,'iOS');assert.equal(iphone.os_major,17);assert.equal(iphone.browser_major,17);
 f.win.navigator.userAgent='Mozilla/5.0 (Linux; Android 14; SM-S928B) Chrome/130.0 Mobile Safari/537.36 SamsungBrowser/27.0';
 const samsung=deviceContext(f.win);assert.equal(samsung.device_model,'SM-S928B');assert.equal(samsung.browser,'SamsungInternet');assert.equal(samsung.browser_major,27);
 f.win.navigator={userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',platform:'MacIntel',maxTouchPoints:5};
 const ipad=deviceContext(f.win);assert.equal(ipad.device_model,'iPad');assert.equal(ipad.os,'iOS');assert.equal(ipad.os_major,undefined,'desktop-style iPad UA does not disclose the iPadOS version');
 f.win.navigator={userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'};
 assert.equal(deviceContext(f.win).os_major,undefined,'Windows compatibility versions do not identify Windows 10 versus 11');
});

test('performance schema rejects identifiers, raw user agents and unsafe or unbounded values',()=>{
 const data=cleanLoadProperties({load_stage:'entrance',load_outcome:'ready',duration_ms:30000.2,network_bytes:Infinity,cached_bytes:-2,video_width:3840,
  device_model:'private@example.com',user_agent:'private',phone:'1234567890',url:'https://private.test',device_memory_gb:99999,was_hidden:false});
 assert.deepEqual(data,{load_stage:'entrance',load_outcome:'ready',duration_ms:30000,video_width:3840,device_memory_gb:256,was_hidden:false});
 const f=fixture();for(let n=0;n<100;n++)recordLoadMetric(f.win,{load_stage:'game',load_outcome:'ready'});
 assert.equal(f.win.__sofacetLoadMetrics.entries.length,64,'pre-consent local summaries stay bounded and do not use storage');
});

test('GA receives a bounded performance projection while full context can go to PostHog',()=>{
 const f=fixture();f.win.document.getElementById=()=>({});
 const provider=googleProvider(f.win,{gaId:'G-TEST'});
 const properties={page_path:'/',environment:'test',release:'abc',...deviceContext(f.win),load_stage:'entrance',load_outcome:'ready',duration_ms:30000,video_width:3840,media_bytes:200000000,network_bytes:190000000,cached_bytes:10000000,discarded_bytes:0,quality_switches:0,selection_reason:'preferred',download_attempts:1,active_ms:29900,was_hidden:true};
 provider.track('load_performance',properties);
 const payload=f.win.dataLayer.at(-1)[2];
 assert.ok(Object.keys(payload).filter(key=>key!=='send_to').length<=25);
 assert.equal(payload.duration_ms,30000);assert.equal(payload.device_model,'Android');assert.equal(payload.video_width,3840);
 assert.equal(payload.cpu_cores,undefined);assert.equal(properties.cpu_cores,8,'projection does not mutate the full event');
});
