// Real pinned browser SDK + rrweb against an isolated local application. No
// project settings or production capture rules are changed by this fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild-wasm';
import {build as buildGame} from 'vite';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const browserType=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright')[engine];
const output=resolve(process.env.SOFACET_POSTHOG_OUTPUT||'work/posthog-browser/'+engine);
const direct=process.env.SOFACET_POSTHOG_GAME_MODE==='direct';
await mkdir(output,{recursive:true});
// Build the real game from current source without changing deployable assets.
const gameBuild=await buildGame({root:resolve(new URL('../game-source',import.meta.url).pathname),publicDir:false,base:'./',logLevel:'error',build:{write:false,rollupOptions:{output:{entryFileNames:'assets/sofacet-game-[hash].js',chunkFileNames:'assets/sofacet-game-chunk-[hash].js',assetFileNames:'assets/sofacet-game-[hash][extname]'}}}});
const gameFiles=new Map(gameBuild.output.map(file=>['/'+file.fileName,file.type==='asset'?file.source:file.code]));
const gameEntry=gameBuild.output.find(file=>file.type==='chunk'&&file.isEntry);
const bundle=await build({absWorkingDir:resolve(new URL('../',import.meta.url).pathname),bundle:true,write:false,format:'iife',target:'es2020',minify:true,define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:resolve(new URL('../',import.meta.url).pathname),contents:`
 import posthog from 'posthog-js';
 import {posthogProvider} from './analytics-source/posthog.js';
 import {installAnalytics} from './analytics-source/runtime.js';
 const loadPosthog=async(config,allowed,id)=>{
  const provider=posthogProvider(config,allowed,id);
  // Headless capture is overridden only in this in-memory local fixture.
  const instance=config.replayContext?posthog['sofacet-game-replay']:posthog;
  instance.set_config({opt_out_useragent_filter:true});window.__fixturePosthog=instance;
  return provider;
 };
 if(window===window.top){
  let analytics=false,recording=false;
  window.sofacetCookiePreferences={allows:category=>analytics&&(category!=='recording'||recording),fixtureSet(a,r){analytics=a;recording=r;window.dispatchEvent(new CustomEvent('sofacet:cookie-preferences'))}};
  installAnalytics(window,{loadPosthog});
 }else installAnalytics(window,{loadPosthog});
`}});
const recorder=await readFile(new URL('../node_modules/posthog-js/dist/lazy-recorder.js',import.meta.url));
const playerBundle=await build({absWorkingDir:resolve(new URL('../',import.meta.url).pathname),bundle:true,write:false,format:'iife',target:'es2020',minify:true,stdin:{resolveDir:resolve(new URL('../',import.meta.url).pathname),contents:"import {Replayer} from 'posthog-js/rrweb';window.FixtureReplayer=Replayer;"}});
const remote={hasFeatureFlags:false,supportedCompression:[],sessionRecording:{endpoint:'/s/',sampleRate:1,minimumDurationMilliseconds:0,consoleLogRecordingEnabled:false,recordCanvas:true,canvasFps:2,canvasQuality:'0.2',networkPayloadCapture:{recordBody:false,recordHeaders:false,capturePerformance:false}}};
const summary={engine,sdk:JSON.parse(await readFile(new URL('../node_modules/posthog-js/package.json',import.meta.url))).version,scope:'Real browser SDK and rrweb in an isolated rewards fixture. Headless capture override exists only in this in-memory test bundle. This is not a physical-device performance benchmark.',passed:false};
const forbidden=/private@example\.com|Private Member|919876543210|012345|token=secret|#private|request-secret|response-secret/;
const captures=[],snapshots=[],failures=[],providerRequests=[];
const transportAttempts=[];
let failReplay=false,failEvent=false,holdEvent=false,releaseHeldEvent=null;
summary.sdkWarnings=[];
async function until(predicate,message){const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await delay(25);assert.ok(predicate(),message)}
function decodeRequest(request){
 let data=request.postDataBuffer();
 if(!data)return null;
 if(data[0]===31&&data[1]===139)data=gunzipSync(data);
 let text=data.toString();
 if(text.startsWith('data=')){const params=new URLSearchParams(text);text=Buffer.from(params.get('data'),'base64').toString()}
 return JSON.parse(text);
}
function unpack(event){
 if(event.cv!=='2024-10')return event;
 const decompress=value=>typeof value==='string'?JSON.parse(gunzipSync(Buffer.from(value,'latin1')).toString()):value;
 return {...event,data:typeof event.data==='string'?decompress(event.data):Object.fromEntries(Object.entries(event.data).map(([key,value])=>[key,['texts','attributes','removes','adds'].includes(key)?decompress(value):value]))};
}
function ingest(payload,frame){
 for(const event of Array.isArray(payload)?payload:payload.batch||[payload]){
  captures.push({...event,fixtureFrame:frame});
  if(event.event==='$snapshot')for(const item of event.properties?.$snapshot_data||[])snapshots.push({...unpack(item),fixtureFrame:frame,fixtureWindow:event.properties.$window_id});
 }
}
const browser=await browserType.launch({...engine==='chromium'?{channel:'chromium',args:['--enable-unsafe-swiftshader']}:{}});
const previous={...process.env};
Object.assign(process.env,{ANALYTICS_ENABLED:'false',GA4_MEASUREMENT_ID:'',POSTHOG_PUBLIC_KEY:'',POSTHOG_SERVER_ERRORS:'false',ARTWORK_CDN_BASE_URL:''});
try{
 await withRewardsSite(async({origin})=>{
  const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>failures.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type())&&/rrweb|PostHog|canvas/i.test(message.text()))summary.sdkWarnings.push(message.text())});
  await context.addInitScript(()=>{sessionStorage.setItem('sofacet-game-visited','1');localStorage.setItem('sofacet.controls-practised.v1','done');localStorage.setItem('sofacet.game-quality.v1','low')});
  await context.route('**/assets/analytics.js*',route=>route.fulfill({contentType:'application/javascript',body:bundle.outputFiles[0].text}));
  await context.route(origin+'/__rrweb-player.js',route=>route.fulfill({contentType:'application/javascript',body:playerBundle.outputFiles[0].text}));
  await context.route(origin+'/__replay-viewer',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><script src="/__rrweb-player.js" defer></script><style>body{margin:0;background:#151515}#player,.replayer-wrapper{position:relative}.replayer-mouse,.replayer-mouse-tail{position:absolute;left:0;top:0;pointer-events:none}.replayer-wrapper iframe{border:0}</style></head><body><div id="player"></div></body></html>'}));
  await context.route(/\/assets\/sofacet-game-[^/]+\.js(?:\?|$)/,route=>route.fulfill({contentType:'application/javascript',body:gameFiles.get(new URL(route.request().url()).pathname)||gameEntry.code}));
  await context.route('**/api/analytics-config',route=>route.fulfill({json:{enabled:true,posthogKey:'phc_fixture',posthogHost:'https://posthog.test',sessionReplay:true,environment:'test',release:'fixture'}}));
  await context.route('**/api/analytics-identity',route=>route.fulfill({json:{userId:null}}));
  await context.route('https://posthog.test/**',async route=>{
   const request=route.request(),url=new URL(request.url());providerRequests.push(url.pathname);
   if(/\/config(?:\.js)?$/.test(url.pathname))return route.fulfill(url.pathname.endsWith('.js')?{contentType:'application/javascript',body:'window._POSTHOG_REMOTE_CONFIG={phc_fixture:{config:'+JSON.stringify(remote)+'}};'}:{json:remote});
   if(url.pathname.includes('lazy-recorder'))return route.fulfill({contentType:'application/javascript',body:recorder});
   if(url.pathname==='/flags/')return route.fulfill({json:{featureFlags:{},featureFlagPayloads:{}}});
   if(request.method()==='POST'){
    const payload=decodeRequest(request),events=Array.isArray(payload)?payload:payload.batch||[payload];
    const replay=events.some(event=>event.event==='$snapshot');
    const controls=events.map(event=>event.properties?.control).filter(Boolean);
    transportAttempts.push({replay,controls,url:request.url()});
    ingest(payload,request.frame().parentFrame()?'game':'top');
    if(holdEvent&&controls.includes('inflight-fixture')){holdEvent=false;await new Promise(resolve=>releaseHeldEvent=resolve);return route.fulfill({status:500,json:{status:0}})}
    if(failReplay&&replay||failEvent&&controls.includes('retry-fixture'))return route.fulfill({status:500,json:{status:0}});
    return route.fulfill({json:{status:1}});
   }
   failures.push('Unexpected PostHog request: '+url.pathname);return route.fulfill({status:404,body:''});
  });
  await context.route(origin+'/game?fixture=top*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Private Member</title><script src="/assets/analytics.js" defer></script><style>body{margin:0;background:#111;color:white}iframe{width:100%;height:800px;border:0}button,select,input{margin:4px}</style></head><body><button id="public-play">Play pinball</button><select id="quality-test"><option>Private Member</option><option>High</option></select><input id="email-test" value="private@example.com"><p>Private Member +919876543210</p><div data-analytics-private>request-secret response-secret</div><canvas id="private-canvas" width="16" height="16"></canvas><iframe id="game-child" src="/game?fixture=child"></iframe></body></html>`}));
  await page.goto(origin+'/game?fixture='+(direct?'direct':'top')+'&email=private@example.com#private');
  await page.waitForFunction(()=>window.sofacetAnalytics&&window.sofacetCookiePreferences);
  assert.equal(captures.length,0,'No SDK transport before analytics consent');
  if(direct)await page.evaluate(()=>{const controls=document.createElement('div');controls.style.cssText='position:fixed;top:0;left:0;z-index:999999';controls.innerHTML='<button id="public-play">Play pinball</button><select id="quality-test"><option>Private Member</option><option>High</option></select><input id="email-test" value="private@example.com"><p hidden>Private Member +919876543210</p><canvas id="private-canvas" width="16" height="16" hidden></canvas>';document.body.append(controls)});
  const child=direct?page:page.frameLocator('#game-child');
  await child.locator('#stage[data-ready="true"]').waitFor({timeout:90000});
  if(!direct)await page.evaluate(()=>document.getElementById('game-child').contentWindow.postMessage({type:'sofacet:experience-visibility',visible:true},location.origin));
  await child.locator('body').evaluate(body=>{const box=document.createElement('div');box.id='public-layout-fixture';box.style.cssText='position:fixed;left:16px;top:120px;width:24px;height:32px;background-color:#fff;z-index:2';body.append(box);const unknown=document.createElement('canvas');unknown.id='unknown-test-canvas';unknown.width=16;unknown.height=16;unknown.hidden=true;const draw=unknown.getContext('2d');draw.fillStyle='red';draw.fillRect(0,0,16,16);body.append(unknown)});
  summary.gameQuality=await child.locator('#quality').inputValue();
  const contextBefore=await child.locator('#game').evaluate(canvas=>({width:canvas.width,height:canvas.height,attributes:(canvas.getContext('webgl2')||canvas.getContext('webgl')).getContextAttributes()}));
  summary.contextBefore=contextBefore;
  summary.liveLayout=await child.locator('#game').evaluate(canvas=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}});
  assert.equal(contextBefore.attributes.preserveDrawingBuffer,false,'Replay must not require a persistent game drawing buffer');
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,false));
  await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().posthog);
  assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().recording),false,'Analytics alone must not start replay');
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,true));
  await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().recording);
  // Exercise the consent-before-context path independently of the game iframe:
  // the DOM recorder is already running when this public art context appears.
  summary.lateReadyPrivacy=await page.evaluate(()=>{
   const viewport=document.createElement('div');viewport.id='scene-viewport';const stage=document.createElement('div');stage.id='scene-frame';const canvas=document.createElement('canvas');canvas.id='public-art-canvas';canvas.width=160;canvas.height=80;
   viewport.append(stage);stage.append(canvas);document.body.append(viewport);
   const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,160,80);gradient.addColorStop(0,'#8000ff');gradient.addColorStop(1,'#ccff00');context.fillStyle=gradient;context.fillRect(0,0,160,80);
   canvas.dataset.sofacetReplayReady='true';window.dispatchEvent(new CustomEvent('sofacet:public-canvas-ready'));
   const config=window.__fixturePosthog.config.session_recording;
   return {fields:Object.keys(config),maskAllInputs:config.maskAllInputs,maskInput:typeof config.maskInputFn,maskText:typeof config.maskTextFn,maskAttributes:typeof config.maskAttributeFn,maskNetwork:typeof config.maskCapturedNetworkRequestFn,maskCanvas:typeof config.canvasCapture?.maskRegionsFn,scale:config.canvasCapture?.resolutionScale,recordBody:config.recordBody,recordHeaders:config.recordHeaders,unknown:config.canvasCapture?.maskRegionsFn(document.getElementById('private-canvas'))};
  });
  assert.equal(summary.lateReadyPrivacy.maskAllInputs,true);assert.equal(summary.lateReadyPrivacy.scale,.5);
  for(const key of ['maskInput','maskText','maskAttributes','maskNetwork','maskCanvas'])assert.equal(summary.lateReadyPrivacy[key],'function','Late readiness must retain '+key);
  assert.equal(summary.lateReadyPrivacy.recordBody,false);assert.equal(summary.lateReadyPrivacy.recordHeaders,false);assert.equal(summary.lateReadyPrivacy.unknown,null);
  await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().recording);
  await page.locator('#public-play').click();await page.locator('#quality-test').selectOption({label:'High'});
  await child.locator('#start').click();
  await child.locator('#touch-launch:not([disabled])').waitFor({state:'visible'});
  await child.locator('#game').press('ArrowLeft');
  await child.locator('#game').press('ArrowRight');
  await child.locator('#game').press('Space');
  await page.evaluate(()=>{
   document.getElementById('email-test').value='private@example.com';document.getElementById('email-test').dispatchEvent(new Event('input',{bubbles:true}));
   console.log('request-secret private@example.com');
   const error=new TypeError('Render failed for private@example.com OTP 012345');error.stack='TypeError: private@example.com\n    at render ('+location.origin+'/assets/test-game.js?token=secret:7:328765)';
   window.sofacetAnalytics.captureError(error,{source:'browser_test'});
  });
  await delay(6500);
  summary.liveLayout=await child.locator('#game').evaluate(canvas=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}});
  summary.clients=await page.evaluate(()=>[window,...Array.from(document.querySelectorAll('iframe')).map(frame=>frame.contentWindow)].map(scope=>{const sdk=scope.__fixturePosthog;return sdk?{name:sdk.config.name,persistence:sdk.config.persistence,recording:sdk.sessionRecordingStarted(),distinctId:sdk.get_distinct_id(),sessionId:sdk.get_session_id(),optedOut:sdk.has_opted_out_capturing(),canvas:sdk.config.session_recording.captureCanvas}:null}));
  await page.screenshot({path:resolve(output,'game-with-recording.png')});
  summary.providerRequests=providerRequests;summary.captureCounts=Object.fromEntries([...new Set(captures.map(x=>x.event))].map(name=>[name,captures.filter(x=>x.event===name).length]));
  summary.snapshotCounts=Object.fromEntries([...new Set(snapshots.map(x=>x.type))].map(type=>[type,snapshots.filter(x=>x.type===type).length]));
  await writeFile(resolve(output,'decoded-fixture-payload.json'),JSON.stringify({captures:captures.filter(x=>x.event!=='$snapshot'),snapshots},null,2));
  assert.ok(snapshots.some(x=>x.type===4&&x.data.href===origin+'/game'),'A canonical rrweb Meta page URL is required');
  assert.ok(snapshots.some(x=>x.type===2),'A complete DOM snapshot is required');
  const serialized=JSON.stringify({captures:captures.filter(x=>x.event!=='$snapshot'),snapshots});
  assert.doesNotMatch(serialized,forbidden,'Actual decoded SDK/rrweb payload must omit private values');
  assert.equal(captures.filter(x=>x.event==='$pageview').length,1,'Only the outer SDK records pageviews');
  assert.equal(captures.filter(x=>x.event==='$exception').length,1,'Manual error path reports one exception');
  if(!direct){
   const root=summary.clients[0],game=summary.clients[1];
   assert.equal(game.persistence,'memory');assert.equal(game.distinctId,root.distinctId);assert.equal(game.sessionId,root.sessionId);
   assert.ok(captures.some(x=>x.fixtureFrame==='game'&&x.event==='$snapshot'),'The dedicated game replay window must upload snapshots');
   assert.ok(captures.filter(x=>x.fixtureFrame==='game').every(x=>x.event==='$snapshot'),'Game replay client must never send pageviews, identify, actions or exceptions');
   const sessions=new Set(captures.map(x=>x.properties?.$session_id).filter(Boolean));assert.equal(sessions.size,1,'All events and replay windows must share the outer session');
   const distinct=new Set(captures.map(x=>x.properties?.distinct_id).filter(Boolean));assert.equal(distinct.size,1,'Replay must use the existing anonymous visitor');
   assert.equal(new Set(captures.filter(x=>x.event==='$snapshot').map(x=>x.properties.$window_id)).size,2,'The iframe is a dedicated replay window within the same session');
  }
  assert.ok(captures.some(x=>x.event==='ui_click'&&x.properties.control==='public-play'));
  assert.ok(captures.some(x=>x.event==='ui_change'&&x.properties.control==='quality-test'));
  assert.ok(captures.some(x=>x.event==='game_control'&&x.properties.control==='left_flipper'));
  assert.ok(captures.some(x=>x.event==='game_control'&&x.properties.control==='right_flipper'));
  assert.ok(captures.some(x=>x.event==='game_control'&&x.properties.control==='launcher'));
  assert.ok(snapshots.some(x=>(x.type===2||x.type===3&&x.data.source===0)&&JSON.stringify(x).includes('game')),'Game DOM must be captured');
  const gameFrame=direct?'top':'game',gameSnapshots=snapshots.filter(event=>event.fixtureFrame===gameFrame);
  const gameCanvasIds=new Set(),publicCanvasIds=new Set();
  const walk=node=>{if(!node||typeof node!=='object')return;if(node.tagName==='canvas'&&node.attributes?.id==='game')gameCanvasIds.add(node.id);if(node.tagName==='canvas'&&['game','public-art-canvas'].includes(node.attributes?.id))publicCanvasIds.add(node.id);for(const child of node.childNodes||[])walk(child)};
  for(const event of snapshots){if(event.type===2)walk(event.data.node);if(event.type===3)for(const add of event.data.adds||[])walk(add.node)}
  const canvasEvents=gameSnapshots.filter(x=>x.type===3&&x.data.source===9&&gameCanvasIds.has(x.data.id));
  summary.canvasEvents=canvasEvents.length;
  assert.ok(canvasEvents.length>0,'Late-start recording must include real game canvas frames');
  summary.canvasPixels=[];
  for(const event of canvasEvents.slice(0,3)){
   const blob=event.data.commands.find(command=>command.property==='drawImage')?.args[0]?.args[0];
   assert.equal(blob?.rr_type,'Blob','Canvas replay must contain an encoded bitmap');
   const pixels=await page.evaluate(async({base64,type})=>{
    const image=new Image();image.src='data:'+type+';base64,'+base64;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    const colors=new Set();let opaque=0;
    for(let i=0;i<data.length;i+=16){if(data[i+3]>0)opaque++;colors.add((data[i]>>3)+','+(data[i+1]>>3)+','+(data[i+2]>>3))}
    return {width:canvas.width,height:canvas.height,colors:colors.size,opaqueSamples:opaque};
   },{base64:blob.data[0].base64,type:blob.type});
   summary.canvasPixels.push(pixels);
   assert.ok(pixels.colors>16&&pixels.opaqueSamples>100,'Actual canvas replay pixels must contain visible game artwork, not a blank frame');
   assert.ok(pixels.width<=Math.ceil(event.data.displayWidth*.5)&&pixels.height<=Math.ceil(event.data.displayHeight*.5),'Replay bitmaps obey the downsample budget');
  }
  assert.ok(snapshots.filter(x=>x.type===3&&x.data.source===9).every(event=>publicCanvasIds.has(event.data.id)),'Only allowlisted public canvases can contribute pixels; unknown/private canvases cannot');
  const viewer=await context.newPage();await viewer.goto(origin+'/__replay-viewer');
  await viewer.waitForFunction(()=>window.FixtureReplayer);
  await viewer.evaluate(async events=>{
   window.fixturePlayer=new window.FixtureReplayer(events,{root:document.getElementById('player'),UNSAFE_replayCanvas:true,showWarning:false,showDebug:false,loadTimeout:5000,pauseAnimation:true});
   await window.fixturePlayer.preloadAllImages();
   // Seeking applies events strictly before its target. Include the final
   // bitmap rather than stopping exactly on its timestamp boundary.
   window.fixturePlayer.pause(events.at(-1).timestamp-events[0].timestamp+1);
  },gameSnapshots.map(({fixtureFrame,fixtureWindow,...event})=>event));
  const replayFrame=viewer.frameLocator('#player iframe');await replayFrame.locator('#game').waitFor();await delay(1500);
  summary.replayedLayout=await replayFrame.locator('#game').evaluate(canvas=>{const r=canvas.getBoundingClientRect(),context=canvas.getContext('2d'),data=context.getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();for(let i=0;i<data.length;i+=64)colors.add((data[i]>>3)+','+(data[i+1]>>3)+','+(data[i+2]>>3));return {left:r.left,top:r.top,width:r.width,height:r.height,pixelColors:colors.size}});
  for(const key of ['left','top','width','height'])assert.ok(Math.abs(summary.replayedLayout[key]-summary.liveLayout[key])<2,'Replayed game '+key+' must preserve authored layout');
  assert.ok(summary.replayedLayout.pixelColors>16,'The real rrweb Replayer must display nonblank canvas artwork');
  const inline=await replayFrame.locator('#public-layout-fixture').boundingBox();assert.ok(Math.abs(inline.width-24)<1&&Math.abs(inline.height-32)<1,'Masked replay preserves safe inline CSS layout');
  await replayFrame.locator('body').screenshot({path:resolve(output,'replayed-game.png')});await viewer.close();
  await page.bringToFront();
  const rotated=await page.evaluate(()=>{const sdk=window.__fixturePosthog,before=sdk.get_session_id();sdk.sessionManager.resetSessionId();const after=sdk.get_session_id();return {before,after}});
  assert.notEqual(rotated.before,rotated.after);
  if(!direct)await page.waitForFunction(sessionId=>document.querySelector('iframe').contentWindow.__fixturePosthog?.get_session_id()===sessionId,rotated.after);
  summary.sessionRotationLinked=true;
  const pageviews=captures.filter(x=>x.event==='$pageview').length;
  failReplay=true;const beforeFailure=transportAttempts.filter(attempt=>attempt.replay).length;
  await page.locator('#public-play').click();await until(()=>transportAttempts.filter(attempt=>attempt.replay).length>beforeFailure,'A real replay request must fail before testing revocation');
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,false));
  await page.waitForFunction(()=>!window.sofacetAnalytics.getStatus().recording);
  if(!direct)await page.waitForFunction(()=>!document.querySelector('iframe').contentWindow.__fixturePosthog.sessionRecordingStarted());
  await delay(500);const atRevoke=captures.filter(x=>x.event==='$snapshot').length;
  await delay(7000);await page.evaluate(()=>dispatchEvent(new Event('online')));await delay(500);assert.equal(captures.filter(x=>x.event==='$snapshot').length,atRevoke,'No replay retry transport after recording revocation');
  failReplay=false;
  assert.equal(captures.filter(x=>x.event==='$pageview').length,pageviews,'Replay changes must not duplicate pageviews');
  const continuing=captures.length;await page.evaluate(()=>window.sofacetAnalytics.track('ui_click',{control:'after-recording-revoke'}));await until(()=>captures.length>continuing,'Analytics must continue after recording-only revoke');
  failEvent=true;await page.evaluate(()=>window.sofacetAnalytics.track('ui_click',{control:'retry-fixture'}));
  await until(()=>transportAttempts.some(attempt=>attempt.controls.includes('retry-fixture')),'A real event request must fail before testing revoke');
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(false,false));await delay(250);
  const stopped=captures.length;await page.locator('#public-play').click();await delay(500);
  assert.equal(captures.length,stopped,'No analytics transport after analytics revocation');
  await delay(7000);await page.evaluate(()=>dispatchEvent(new Event('online')));await delay(500);
  assert.equal(transportAttempts.filter(attempt=>attempt.controls.includes('retry-fixture')).length,1,'A queued failed event cannot retry after analytics revoke');
  failEvent=false;
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,true));
  await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().recording);
  if(!direct)await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.__fixturePosthog.sessionRecordingStarted());
  await page.locator('#public-play').click();await delay(4000);
  assert.ok(captures.length>stopped,'Regrant must capture using fresh consent closures');
  assert.ok(captures.slice(stopped).some(event=>event.event==='ui_click'));
  assert.ok(captures.slice(stopped).some(event=>event.event==='$snapshot'));
  assert.equal(transportAttempts.filter(attempt=>attempt.controls.includes('retry-fixture')).length,1,'Regrant cannot backfill an earlier failed event');
  holdEvent=true;await page.evaluate(()=>window.sofacetAnalytics.track('ui_click',{control:'inflight-fixture'}));await until(()=>typeof releaseHeldEvent==='function','In-flight failure fixture must reach the SDK transport');
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(false,false));
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,false));await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().posthog);
  releaseHeldEvent();await delay(7500);await page.evaluate(()=>dispatchEvent(new Event('online')));await delay(250);
  assert.equal(transportAttempts.filter(attempt=>attempt.controls.includes('inflight-fixture')).length,1,'An old in-flight failure cannot requeue into a new consent epoch');
  summary.failedTransportRevocation={replayOnly:true,analyticsContinues:true,eventRevoke:true,regrant:true,lateOldFailure:true};
  await page.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(false,false));
  await page.waitForFunction(()=>!window.sofacetAnalytics.getStatus().recording);
  if(process.env.SOFACET_POSTHOG_PERF==='1'){
   const benchmark=await context.newPage();await benchmark.goto(origin+'/game?fixture=top');
   const game=benchmark.frameLocator('#game-child');await game.locator('#stage[data-ready="true"]').waitFor({timeout:90000});
   await benchmark.evaluate(()=>{window.sofacetCookiePreferences.fixtureSet(true,false);document.getElementById('game-child').contentWindow.postMessage({type:'sofacet:experience-visibility',visible:true},location.origin)});
   await benchmark.waitForFunction(()=>window.sofacetAnalytics.getStatus().posthog);
   await game.locator('#start').click();await game.locator('#touch-launch:not([disabled])').waitFor({state:'visible'});await game.locator('#game').focus();
   const sample=async()=>{await delay(2000);return game.locator('#game').evaluate(()=>new Promise(resolve=>{
    const deltas=[];let previous=0,start=0;function next(now){if(!start)start=now;if(previous)deltas.push(now-previous);previous=now;if(now-start<3000)requestAnimationFrame(next);else{const sorted=[...deltas].sort((a,b)=>a-b);resolve({samples:deltas.length,durationMs:now-start,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],over50ms:deltas.filter(value=>value>50).length})}}requestAnimationFrame(next);
   }))};
   const disabledBefore=await sample();
   await benchmark.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,true));await benchmark.waitForFunction(()=>window.sofacetAnalytics.getStatus().recording&&document.querySelector('iframe').contentWindow.__fixturePosthog?.sessionRecordingStarted());
   const enabled=await sample();
   await benchmark.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(true,false));await benchmark.waitForFunction(()=>!window.sofacetAnalytics.getStatus().recording&&!document.querySelector('iframe').contentWindow.__fixturePosthog.sessionRecordingStarted());
   const disabledAfter=await sample();
   summary.performance={scope:'One local software-GPU desktop run; analytics on throughout, native RAF/physics unchanged, same low quality, active launcher scene. 2s warmup + 3s native samples per phase. This cannot establish phone performance.',quality:await game.locator('#quality').inputValue(),disabledBefore,enabled,disabledAfter};
   assert.equal(summary.performance.quality,summary.gameQuality);
   await benchmark.evaluate(()=>window.sofacetCookiePreferences.fixtureSet(false,false));await benchmark.close();
  }
  assert.deepEqual(failures,[]);await context.close();
 });
 summary.passed=true;
}catch(error){summary.failure=error.stack;throw error}
finally{
 await writeFile(resolve(output,'summary.json'),JSON.stringify(summary,null,2));
 await browser.close();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
 console.log(JSON.stringify(summary,null,2));
}
