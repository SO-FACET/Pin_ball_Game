const eventKeys={
 page_view:[],page_leave:['duration_ms'],navigation_click:['destination','link_kind','control'],ui_click:['control'],
 form_submit:['form'],form_invalid:['form','field'],game_started:['online'],game_finished:['points','duration_ms'],
 game_paused:[],game_resumed:[],game_ready:[],game_load_failed:['phase','code'],tutorial_completed:['outcome'],
 score_verified:['points','best_points'],reward_saved:['points'],reward_discarded:[],
 otp_requested:['method','flow'],otp_verified:['method','flow'],login:['method','flow'],sign_up:['method','flow'],
 logout:['method','flow'],profile_updated:['method','flow'],account_deleted:['method','flow'],
 first_cuts_registered:['method','flow'],share:['method'],
 api_request:['endpoint','status','duration_ms','outcome'],client_error:['source','endpoint','status','error_type'],
};
const routes=new Set(['/','/video','/entrance-3d','/game','/leaderboard','/reward','/claim','/join','/sign-in','/verify','/coins-saved','/my-coins','/exit','/launch','/notify','/confirmation','/about','/how-coins-work','/contact','/terms','/privacy','/404']);
const endpoints=new Set(['/api/player','/api/account','/api/account/session','/api/account/details','/api/account/signout','/api/account/delete','/api/account/otp/request','/api/account/otp/verify','/api/membership','/api/membership/config','/api/membership/otp/request','/api/membership/otp/verify','/api/membership/rewards','/api/leaderboard','/api/first-cuts','/api/games/start','/api/games/:id/finish']);
export function safePath(value,origin){
 try{const url=new URL(value,origin);return routes.has(url.pathname)?url.pathname:'/404'}catch{return '/404'}
}
export function redact(value){
 return String(value||'').replace(/https?:\/\/[^\s)]+/g,value=>{try{const url=new URL(value);return url.origin+url.pathname.replace(/[a-f0-9-]{32,}/gi,'[id]')}catch{return '[url]'}})
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
  .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*/g,'[token]')
  .replace(/\+?\d[\d ()-]{4,}\d/g,'[number]').slice(0,500);
}
export function cleanProperties(name,properties){
 const clean={};
 const numeric=new Set(['duration_ms','points','best_points','status']);
 const enums={method:new Set(['button','form','phone_otp','clipboard','native','whatsapp','telegram','x','email','gmail']),link_kind:new Set(['internal','external','email','phone']),flow:new Set(['account','signin','signup'])};
 for(const key of eventKeys[name]||[]){
  const value=properties?.[key];
  if(key==='endpoint'){if(endpoints.has(value))clean[key]=value;continue}
  if(key==='destination'){if(routes.has(value)||['external','email','phone'].includes(value))clean[key]=value;continue}
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
 let enabled=false,config=null,google=null,posthog=null,queue=[],generation=0,starting=null,identityRevision=0,userId=null,identityPending=null;
 let lastPage='',pageAt=Date.now(),errors=0;
 const allowed=()=>{try{return win.sofacetCookiePreferences?.allows('analytics')===true}catch{return false}};
 const call=(fn)=>{try{return fn()}catch{}};
 const topApi=()=>call(()=>win.top.sofacetAnalytics);
 const common=(path=win.top.location.href)=>({page_path:safePath(path,win.location.origin),environment:config?.environment||'production',release:config?.release||''});
 function send(item){
  if(!enabled||!allowed())return;
  call(()=>google?.track(item.name,item.properties));
  call(()=>item.error?posthog?.error(item.error,item.properties):posthog?.track(item.name,item.properties));
 }
 function track(name,properties={}){
  if(embedded)return call(()=>topApi()?.track(name,properties));
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
  errors++;
  const safe=new Error(redact(error?.message||'Unknown client error'));
  safe.name=/^[A-Za-z]+Error$/.test(error?.name||'')?error.name:'Error';
  // Retain source positions without serializing the original Error or arbitrary context.
  safe.stack=String(error?.stack||safe.stack).split('\n').slice(0,9).map(redact).join('\n');
  const item={name:'client_error',error:safe,properties:{...cleanProperties('client_error',{...context,error_type:safe.name}),...common()}};
  if(starting){if(queue.length<100)queue.push(item)}else send(item);
 }
 function pageView(){
  const path=safePath(win.location.href,win.location.origin);
  if(path===lastPage)return;
  if(lastPage)leavePage();
  lastPage=path;pageAt=Date.now();track('page_view');
 }
 function leavePage(){
  if(!lastPage)return;
  record('page_leave',{duration_ms:Date.now()-pageAt},lastPage);
  lastPage='';
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
  identityRevision++;userId=null;call(()=>google?.identify(null));call(()=>posthog?.reset());
 }
 function stop(){
  enabled=false;generation++;identityRevision++;userId=null;queue=[];lastPage='';
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
    // Verify a persisted account before the first event or recording is attributed.
    await refreshIdentity();
    await settleIdentity();
    if(epoch!==generation||!allowed())return;
    // Resolve independently so a blocked provider cannot disable the other.
    const isCurrent=()=>epoch===generation&&allowed();
    await Promise.allSettled([
     config.gaId&&Promise.resolve().then(()=>loadGoogle(config,userId,isCurrent)).then(provider=>{if(!provider)return;if(!isCurrent())provider.stop();else {google=provider;call(()=>google.identify(userId))}}),
     config.posthogKey&&Promise.resolve().then(()=>loadPosthog(config,allowed,userId,isCurrent)).then(provider=>{if(!provider)return;if(!isCurrent())provider.stop();else {posthog=provider;call(()=>userId?posthog.identify(userId):posthog.clearIdentity?.())}}),
    ]);
    await settleIdentity();
    if(epoch!==generation||!allowed())return;
    call(()=>google?.identify(userId));call(()=>userId?posthog?.identify(userId):posthog?.clearIdentity?.());
   }catch{}finally{starting=null;}
   if(!enabled||epoch!==generation||!allowed())return;
   pageView();for(const item of queue.splice(0))send(item);
  })();
  await starting;
  // A rapid revoke/regrant during SDK loading should restart with the new choice.
  if(allowed()&&!enabled&&epoch!==generation)void start();
 }
 const api={track,captureError,refreshIdentity,resetIdentity,getStatus:()=>({enabled:enabled&&allowed(),google:!!google,posthog:!!posthog,recording:!!call(()=>posthog?.recording())})};
 win.sofacetAnalytics=api;
 win.addEventListener('error',event=>{
  if(event.error||event.message)captureError(event.error||new Error(event.message),{source:'uncaught'});
  else if(event.target?.tagName==='SCRIPT'||event.target?.tagName==='LINK')captureError(new Error('Application asset failed to load'),{source:'asset'});
 },true);
 win.addEventListener('unhandledrejection',event=>captureError(event.reason instanceof Error?event.reason:new Error('Unhandled promise rejection'),{source:'promise'}));
 // Capture the originating page/control before a workflow handler changes it.
 win.document.addEventListener('click',event=>{
  const element=event.target?.closest?.('[data-analytics-event],a[href],button,[role="button"],summary');
  if(!element||element.closest?.('#sf-cookie-root')||element.disabled||element.getAttribute('aria-disabled')==='true')return;
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
 win.document.addEventListener('submit',event=>{if(!event.target.closest?.('#sf-cookie-root'))track('form_submit',{form:event.target.id||'form'})},true);
 win.document.addEventListener('invalid',event=>{if(!event.target.closest?.('#sf-cookie-root'))track('form_invalid',{form:event.target.form?.id||'form',field:event.target.type||'unknown'})},true);
 if(!embedded){
  for(const method of ['pushState','replaceState']){
   const original=win.history[method];
   win.history[method]=function(...args){const result=original.apply(this,args);if(enabled&&allowed())pageView();return result};
  }
  win.addEventListener('popstate',()=>{if(enabled&&allowed())pageView()});
  win.addEventListener('pagehide',leavePage);
  win.addEventListener('pageshow',event=>{if(event.persisted&&enabled&&allowed())pageView()});
  win.addEventListener('sofacet:cookie-preferences',()=>{if(allowed())void start();else stop()});
  void start();
 }
 return api;
}
