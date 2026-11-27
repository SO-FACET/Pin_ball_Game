import {boundedDuration,createDurationClock} from './duration.js';
import {safePagePath,isKnownPagePath,redactText,sanitizeException} from './privacy.js';
import {installEmbeddedReplay} from './embedded-replay.js';
import {createGameFunnel} from './game-funnel.js';
import {cleanLoadProperties,installLoadPerformance} from './load-performance.js';

const eventKeys={
 page_view:[],page_leave:['duration_ms'],navigation_click:['destination','link_kind','control'],ui_click:['control'],
 ui_change:['control','control_type','checked'],ui_toggle:['control','expanded'],scroll_depth:['percent'],game_control:['control','action','input_method'],
 page_engagement:['page_active_ms'],game_engagement:['game_active_ms'],
 form_submit:['form'],form_invalid:['form','field'],game_load_started:['run_sequence'],game_started:['online','run_sequence'],game_finished:['points','duration_ms','run_sequence'],
 game_play_started:['run_sequence'],game_engaged:['run_sequence','duration_ms'],game_abandoned:['run_sequence','stage','reason','duration_ms','early'],
 game_session_outcome:['run_sequence','stage','reason','outcome','duration_ms','points'],
 game_paused:[],game_resumed:[],game_ready:['run_sequence'],game_load_failed:['phase','code'],tutorial_completed:['outcome'],
 score_verified:['points','best_points','run_sequence'],reward_saved:['points','run_sequence'],reward_discarded:['run_sequence'],reward_save_started:['run_sequence','method'],reward_save_failed:['run_sequence','status'],
 otp_requested:['method','flow'],otp_verified:['method','flow'],login:['method','flow'],sign_up:['method','flow'],
 logout:['method','flow'],profile_updated:['method','flow'],account_deleted:['method','flow'],
 first_cuts_registered:['method','flow'],share:['method'],
 api_request:['endpoint','status','duration_ms','outcome'],client_error:['source','endpoint','status','error_type'],
 load_performance:[],
};
const endpoints=new Set(['/api/player','/api/account','/api/account/session','/api/account/details','/api/account/signout','/api/account/delete','/api/account/otp/request','/api/account/otp/verify','/api/membership','/api/membership/config','/api/membership/otp/request','/api/membership/otp/verify','/api/membership/rewards','/api/leaderboard','/api/first-cuts','/api/games/start','/api/games/:id/finish']);
export const safePath=safePagePath;
export const redact=redactText;
export function cleanProperties(name,properties){
 if(name==='load_performance')return cleanLoadProperties(properties);
 const clean={};
 const numeric=new Set(['points','best_points','status','run_sequence']);
 const durations=new Set(['duration_ms','page_active_ms','game_active_ms']);
 const enums={method:new Set(['button','form','phone_otp','clipboard','native','whatsapp','telegram','x','email','gmail']),link_kind:new Set(['internal','external','email','phone']),flow:new Set(['account','signin','signup']),action:new Set(['press','release']),input_method:new Set(['keyboard','touch']),control_type:new Set(['checkbox','radio','range','select-one','select-multiple'])};
 for(const key of eventKeys[name]||[]){
  const value=properties?.[key];
  if(key==='endpoint'){if(endpoints.has(value))clean[key]=value;continue}
  if(key==='destination'){if(isKnownPagePath(value)||['external','email','phone'].includes(value))clean[key]=value;continue}
  if(key==='percent'){if([25,50,75,100].includes(value))clean[key]=value;continue}
  if(key==='checked'||key==='expanded'||key==='early'){if(typeof value==='boolean')clean[key]=value;continue}
  if(durations.has(key)){const duration=boundedDuration(value);if(duration!==null)clean[key]=duration;continue}
  if(numeric.has(key)){if(typeof value==='number'&&Number.isFinite(value))clean[key]=Math.max(0,Math.round(value));continue}
  if(key==='online'){if(typeof value==='boolean')clean[key]=value;continue}
  if(enums[key]){if(enums[key].has(value))clean[key]=value;continue}
  if(typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)&&!/[a-zA-Z0-9]{24,}|\d{6,}/.test(value))clean[key]=value;
 }
 return clean;
}

export function installAnalytics(win,{loadGoogle,loadPosthog}={}){
 if(win.sofacetAnalytics)return win.sofacetAnalytics;
 const embedded=win.top!==win;
 let enabled=false,config=null,google=null,posthog=null,queue=[],generation=0,starting=null,identityRevision=0,userId=null,identityPending=null,releaseReplaySession=null;
 let lastPage='',errors=0,gameActivity=false,activityPublished=false,timingReady=false,durationTimer=null,scrollTimer=null,scrollThreshold=0;
 const capturedErrors=new WeakSet();
 const allowed=()=>{try{return win.sofacetCookiePreferences?.allows('analytics')===true}catch{return false}};
 const recordingAllowed=()=>{try{return allowed()&&win.sofacetCookiePreferences?.allows('recording')===true}catch{return false}};
 const call=(fn)=>{try{return fn()}catch{}};
 const publishReplayContext=()=>{if(recordingAllowed()&&typeof posthog?.replayContext==='function')call(()=>win.dispatchEvent(new (win.CustomEvent||win.Event)('sofacet:replay-context')))};
 const topApi=()=>call(()=>win.top.sofacetAnalytics);
 const common=(path=win.top.location.href)=>({page_path:safePath(path,win.location.origin),environment:config?.environment||'production',release:config?.release||''});
 const duration=createDurationClock({now:()=>typeof win.performance?.now==='function'?win.performance.now():Date.now(),emit:(name,properties,path)=>{record(name,properties,path);if(name==='game_engagement')funnel.sample()}});
 const funnel=createGameFunnel({emit:(name,properties)=>record(name,properties),gameDuration:()=>duration.gameDuration()});
 const foreground=()=>win.document.hidden!==true&&(!win.document.visibilityState||win.document.visibilityState==='visible')&&(typeof win.document.hasFocus!=='function'||call(()=>win.document.hasFocus())===true);
 const loadPerformance=embedded?null:installLoadPerformance(win,{allowed:()=>enabled&&allowed(),emit:(properties,path)=>record('load_performance',properties,path)});
 function clearDurationTimer(){if(durationTimer!==null){call(()=>win.clearInterval(durationTimer));durationTimer=null}}
 function syncDuration(){
  const active=timingReady&&enabled&&allowed()&&Boolean(lastPage)&&foreground();
  duration.setForeground(active);
  if(active&&durationTimer===null&&typeof win.setInterval==='function')durationTimer=call(()=>win.setInterval(()=>{
   if(!enabled||!allowed()){stop();return}
   syncDuration();if(lastPage&&foreground())duration.flush();
  },15000))??null;
  else if(!active)clearDurationTimer();
 }
 function setGameActivity(active){
  if(typeof active!=='boolean')return;
  gameActivity=active;activityPublished=true;
  if(embedded)return call(()=>topApi()?.setGameActivity(active));
  duration.setGameActivity(active&&lastPage==='/game');
 }
 function send(item){
  if(!enabled||!allowed())return;
  call(()=>google?.track(item.name,item.properties));
  call(()=>item.error?posthog?.error(item.error,item.properties):posthog?.track(item.name,item.properties));
 }
 function track(name,properties={}){
  if(embedded)return call(()=>topApi()?.track(name,properties));
  if(!enabled||!allowed())return;
  if(name==='game_finished'){gameActivity=false;properties={...properties,duration_ms:duration.finishGame()}}
  properties=funnel.event(name,properties);
  if(!properties)return;
  if(name==='game_started')duration.startGame();
  record(name,properties);
 }
 function record(name,properties={},path){
  if(!Object.hasOwn(eventKeys,name)||!enabled||!allowed())return;
  const item={name,properties:{...cleanProperties(name,properties),...common(path)}};
  if(starting){if(queue.length<100)queue.push(item)}else send(item);
 }
 function captureError(error,context={}){
  if(embedded)return call(()=>topApi()?.captureError(error,context));
  if(!enabled||!allowed()||errors>=20)return;
  if(error&&typeof error==='object'){if(capturedErrors.has(error))return;capturedErrors.add(error)}
  errors++;
  const safe=sanitizeException(error,win.location.origin);
  const item={name:'client_error',error:safe,properties:{...cleanProperties('client_error',{...context,error_type:safe.name}),...common()}};
  if(starting){if(queue.length<100)queue.push(item)}else send(item);
 }
 function pageView(){
  const path=safePath(win.location.href,win.location.origin);
  if(path===lastPage)return;
  if(lastPage)leavePage();
  lastPage=path;scrollThreshold=0;duration.enterPage(path);duration.setGameActivity(gameActivity&&path==='/game');track('page_view');syncDuration();
 }
 function leavePage(){
  if(!lastPage)return;
  record('page_leave',{duration_ms:duration.leavePage()},lastPage);
  lastPage='';
  duration.setGameActivity(false);
  syncDuration();
 }
 async function refreshIdentity(){
  if(embedded)return topApi()?.refreshIdentity();
  if(!enabled||!allowed())return;
  const revision=++identityRevision,epoch=generation;
  identityPending=(async()=>{
  try{
   const response=await win.fetch('/api/analytics-identity',{credentials:'same-origin',cache:'no-store',signal:win.AbortSignal?.timeout?.(5000)});
   if(!response.ok)return;
   const data=await response.json();
   if(!enabled||!allowed()||epoch!==generation||revision!==identityRevision)return;
   if(/^user_[a-f0-9]{64}$/.test(data.userId||'')){userId=data.userId;call(()=>google?.identify(userId));call(()=>posthog?.identify(userId))}
   else if(data.userId===null){userId=null;call(()=>google?.identify(null));call(()=>posthog?.clearIdentity())}
   publishReplayContext();
  }catch{}
  })();
  await identityPending;
 }
 async function settleIdentity(){
  let pending;
  do{pending=identityPending;await pending}while(pending!==identityPending);
 }
 function resetIdentity(){
  if(embedded)return call(()=>topApi()?.resetIdentity());
  identityRevision++;userId=null;call(()=>google?.identify(null));
  call(()=>posthog?.reset());
  publishReplayContext();
 }
 function clearIdentity(){
  if(embedded)return call(()=>topApi()?.clearIdentity?.());
  // A routine signed-out session response clears only a stale member, while
  // explicit logout/account expiry still uses resetIdentity to rotate IDs.
  identityRevision++;userId=null;call(()=>google?.identify(null));call(()=>posthog?.clearIdentity?.());
  publishReplayContext();
 }
 function stop(){
  loadPerformance?.stop();
  timingReady=false;clearDurationTimer();duration.stop();funnel.reset();
  if(scrollTimer!==null){call(()=>win.clearTimeout(scrollTimer));scrollTimer=null}
  enabled=false;generation++;identityRevision++;userId=null;queue=[];lastPage='';
  call(()=>releaseReplaySession?.());releaseReplaySession=null;
  call(()=>google?.stop());call(()=>posthog?.stop());
  google=null;posthog=null;
 }
 async function start(){
  if(embedded||enabled||starting||!allowed())return;
  const epoch=++generation;
  starting=(async()=>{
   try{
    const response=await win.fetch('/api/analytics-config',{cache:'no-store',credentials:'omit'});
    if(!response.ok)return;
    config=await response.json();
    if(!config.enabled||(!config.gaId&&!config.posthogKey)||epoch!==generation||!allowed())return;
    enabled=true;
    loadPerformance?.prepare();
    // Verify a persisted account before the first event or recording is attributed.
    await refreshIdentity();
    await settleIdentity();
    if(epoch!==generation||!allowed())return;
    // Resolve independently so a blocked provider cannot disable the other.
    const isCurrent=()=>epoch===generation&&allowed();
    await Promise.allSettled([
     config.gaId&&Promise.resolve().then(()=>loadGoogle(config,userId,isCurrent)).then(provider=>{if(!provider)return;if(!isCurrent())provider.stop();else {google=provider;call(()=>google.identify(userId))}}),
     config.posthogKey&&Promise.resolve().then(()=>loadPosthog(config,allowed,userId,isCurrent)).then(provider=>{if(!provider)return;if(!isCurrent())provider.stop();else {posthog=provider;call(()=>userId?posthog.identify(userId):posthog.clearIdentity?.());call(()=>posthog.setRecordingAllowed?.(recordingAllowed()));releaseReplaySession=call(()=>posthog.onSessionId?.(publishReplayContext))}}),
    ]);
    await settleIdentity();
    if(epoch!==generation||!allowed())return;
    call(()=>google?.identify(userId));call(()=>userId?posthog?.identify(userId):posthog?.clearIdentity?.());
   }catch{}finally{starting=null;}
   if(!enabled||epoch!==generation||!allowed())return;
   timingReady=Boolean(google||posthog);
   if(timingReady)duration.start({visible:foreground()});else duration.stop();
   pageView();
   // History may already have queued this pageview while providers loaded.
   // start() reset the clock, so reconcile its page even when pageView dedupes.
   duration.enterPage(lastPage);duration.setGameActivity(gameActivity&&lastPage==='/game');syncDuration();
   for(const item of queue.splice(0))send(item);
   loadPerformance?.flush();
   call(()=>win.dispatchEvent(new (win.CustomEvent||win.Event)('sofacet:analytics-enabled')));
   publishReplayContext();
  })();
  await starting;
  // A rapid revoke/regrant during SDK loading should restart with the new choice.
  if(allowed()&&!enabled&&epoch!==generation)void start();
 }
 const api={track,setGameActivity,captureError,refreshIdentity,resetIdentity,clearIdentity,getGameContext:()=>embedded?call(()=>topApi()?.getGameContext?.()):enabled&&allowed()?funnel.context():{},getReplayContext:()=>enabled&&recordingAllowed()?call(()=>posthog?.replayContext?.()):null,getStatus:()=>({enabled:enabled&&allowed(),google:!!google,posthog:!!posthog,recording:!!call(()=>posthog?.recording())})};
 win.sofacetAnalytics=api;
 call(()=>win.dispatchEvent(new (win.CustomEvent||win.Event)('sofacet:analytics-ready')));
 win.addEventListener('error',event=>{
  if(event.error||event.message)captureError(event.error||new Error(event.message),{source:'uncaught'});
  else if(event.target?.tagName==='SCRIPT'||event.target?.tagName==='LINK')captureError(new Error('Application asset failed to load'),{source:'asset'});
 },true);
 win.addEventListener('unhandledrejection',event=>captureError(event.reason instanceof Error?event.reason:new Error('Unhandled promise rejection'),{source:'promise'}));
 // Capture the originating page/control before a workflow handler changes it.
 win.document.addEventListener('click',event=>{
  const element=event.target?.closest?.('[data-analytics-event],a[href],button,[role="button"],summary');
  if(!element||element.closest?.('#sf-cookie-root,[data-analytics-private]')||element.disabled||element.getAttribute('aria-disabled')==='true')return;
  const control=element.getAttribute('data-analytics-control')||element.id||'button';
  const explicit=element.getAttribute('data-analytics-event');
  if(explicit){track(explicit,{method:element.getAttribute('data-analytics-method')||'button',control});return}
  if(element.tagName==='A'){
   try{const url=new URL(element.href,win.location.href);
    const contact={ 'mailto:':'email','tel:':'phone' }[url.protocol];
    if(contact){track('navigation_click',{destination:contact,link_kind:contact,control});return}
    if(!['https:','http:'].includes(url.protocol))return;
    track('navigation_click',{destination:url.origin===win.location.origin?safePath(url.href,win.location.origin):'external',link_kind:url.origin===win.location.origin?'internal':'external',control});
   }catch{}
  }else track('ui_click',{control});
 },true);
 win.document.addEventListener('submit',event=>{if(!event.target.closest?.('#sf-cookie-root,[data-analytics-private]'))track('form_submit',{form:event.target.id||'form'})},true);
 win.document.addEventListener('invalid',event=>{if(!event.target.closest?.('#sf-cookie-root,[data-analytics-private]'))track('form_invalid',{form:event.target.form?.id||'form',field:event.target.type||'unknown'})},true);
 win.document.addEventListener('change',event=>{
  const element=event.target;
  if(!element||element.closest?.('#sf-cookie-root,[data-analytics-private]')||element.disabled)return;
  if(!['checkbox','radio','range','select-one','select-multiple'].includes(element.type))return;
  track('ui_change',{control:element.getAttribute?.('data-analytics-control')||element.id||'control',control_type:element.type,...['checkbox','radio'].includes(element.type)?{checked:element.checked===true}:{}});
 },true);
 win.document.addEventListener('toggle',event=>{
  const element=event.target;
  if(!element||!['DETAILS','DIALOG'].includes(element.tagName)||element.closest?.('#sf-cookie-root,[data-analytics-private]'))return;
  track('ui_toggle',{control:element.getAttribute?.('data-analytics-control')||element.id||element.tagName.toLowerCase(),expanded:element.open===true});
 },true);
 win.addEventListener('scroll',()=>{
  if(!enabled||!allowed()||scrollTimer!==null||typeof win.setTimeout!=='function')return;
  scrollTimer=win.setTimeout(()=>{
   scrollTimer=null;if(!enabled||!allowed())return;
   const height=win.document.documentElement?.scrollHeight-win.innerHeight;
   if(!(height>0))return;
   const percent=Math.min(100,Math.max(0,Math.round((win.scrollY||0)/height*100)));
   for(const threshold of [25,50,75,100])if(threshold>scrollThreshold&&percent>=threshold){scrollThreshold=threshold;track('scroll_depth',{percent:threshold})}
  },250);
 },{passive:true});
 if(!embedded){
  for(const method of ['pushState','replaceState']){
   const original=win.history[method];
   win.history[method]=function(...args){const result=original.apply(this,args);if(enabled&&allowed())pageView();return result};
  }
  win.addEventListener('popstate',()=>{if(enabled&&allowed())pageView()});
  win.addEventListener('pagehide',event=>{if(!event?.persisted&&enabled&&allowed())funnel.finish('pagehide');leavePage()});
  win.addEventListener('pageshow',event=>{if(event.persisted&&enabled&&allowed())pageView()});
  win.addEventListener('focus',syncDuration);
  win.addEventListener('blur',syncDuration);
  win.document.addEventListener('visibilitychange',syncDuration);
  win.addEventListener('sofacet:cookie-preferences',()=>{if(allowed()){call(()=>posthog?.setRecordingAllowed?.(recordingAllowed()));void start()}else stop()});
  void start();
 }else{
  call(()=>win.top.addEventListener('sofacet:analytics-ready',()=>{if(activityPublished)topApi()?.setGameActivity(gameActivity)}));
  installEmbeddedReplay(win,{loadPosthog});
 }
 return api;
}
