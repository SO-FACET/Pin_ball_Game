import {safePagePath} from './privacy.js';

// Advertising consent is independent of Analytics consent. Only the top page
// owns this provider; embedded game screens update the top page's history.
export function installMetaPixel(win){
 if(win.top!==win||win.sofacetMetaPixel)return;
 let pending=[],seen=new Set();
 let config=null,loaded=false,loading=false,initialized=false,lastPage='',active=false;
 const allowed=()=>{try{return win.sofacetCookiePreferences?.allows('advertising')===true}catch{return false}};
 const enabled=()=>config?.metaPixelEnabled===true&&/^\d{5,20}$/.test(config.metaPixelId||'');
 const consent=()=>win.fbq?.('consent',allowed()?'grant':'revoke');
 function clearCookies(){
  const host=win.location.hostname,parts=host.split('.'),domains=['',host,'.'+host];
  for(let i=1;i<parts.length-1;i++)domains.push('.'+parts.slice(i).join('.'));
  for(const name of ['_fbp','_fbc'])for(const domain of domains)win.document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax; Secure'+(domain?'; Domain='+domain:'');
 }
 function safeUrl(){
  const url=new URL(win.location.href);
  return ![...url.searchParams.keys()].some(k=>/email|phone|otp|token|password|signature/i.test(k))&&!url.hash;
 }
 function track(name,properties={},key){
  if(!['ViewContent','JoinCollectiveClick','LoginClick','Lead'].includes(name)||!allowed()||!safeUrl())return;
  if(config&&!enabled())return;
  const clean={};
  if(name==='Lead'&&['login','join_collective'].includes(properties.form_type))clean.form_type=properties.form_type;
  if(name==='ViewContent')clean.content_name='Pinball';
  const dedupe=typeof key==='string'?name+':'+key:null;
  if(dedupe&&seen.has(dedupe))return;
  if(dedupe){seen.add(dedupe);if(seen.size>100)seen.delete(seen.values().next().value)}
  if(!loaded||!active){if(pending.length<20)pending.push({name,clean});return}
  win.fbq(['JoinCollectiveClick','LoginClick'].includes(name)?'trackSingleCustom':'trackSingle',config.metaPixelId,name,clean);
 }
 function flush(){
  if(!active||!allowed()||!loaded||!safeUrl()){pending=[];return}
  for(const {name,clean} of pending.splice(0))win.fbq(['JoinCollectiveClick','LoginClick'].includes(name)?'trackSingleCustom':'trackSingle',config.metaPixelId,name,clean);
 }
 function pageView(){
  if(!active||!loaded||!enabled()||!allowed())return;
  const url=new URL(win.location.href);
  // Meta's SDK reads the document URL: do not activate on sensitive return URLs.
  if([...url.searchParams.keys()].some(k=>/email|phone|otp|token|password|signature/i.test(k))||url.hash)return;
  const path=safePagePath(url.href,url.origin);
  if(path===lastPage)return;
  lastPage=path;win.fbq('trackSingle',config.metaPixelId,'PageView');
 }
 function sync(){
  if(!enabled()||!allowed()){
   active=false;lastPage='';pending=[];if(win.fbq)win.fbq('consent','revoke');clearCookies();return;
  }
  active=true;
  if(loaded){
   if(!initialized){
    win.fbq('consent','revoke');
    win.fbq('set','autoConfig',false,config.metaPixelId);
    win.fbq('init',config.metaPixelId);
    initialized=true;
   }
   consent();pageView();flush();return;
  }
  if(loading)return;
  loading=true;
  // The SDK is requested only after Advertising consent. No events are queued
  // while it loads, so a withdrawal during loading cannot replay old pageviews.
  if(!win.fbq){
   const fbq=function(...args){if(fbq.callMethod)fbq.callMethod.apply(fbq,args);else fbq.queue.push(args)};
   fbq.push=fbq;fbq.loaded=true;fbq.version='2.0';fbq.queue=[];win.fbq=fbq;win._fbq??=fbq;
  }
  const script=win.document.createElement('script');script.id='sofacet-meta-pixel';script.async=true;
  script.src='https://connect.facebook.net/en_US/fbevents.js';
  script.onload=()=>{loading=false;loaded=true;sync()};
  script.onerror=()=>{loading=false;script.remove()};
  win.document.head.append(script);
 }
 const api={sync,track};win.sofacetMetaPixel=api;
 win.addEventListener('sofacet:cookie-preferences',sync);
 for(const method of ['pushState','replaceState']){
  const original=win.history[method];
  win.history[method]=function(...args){const result=original.apply(this,args);pageView();return result};
 }
 win.addEventListener('popstate',pageView);
 win.addEventListener('pageshow',event=>{if(event.persisted){lastPage='';sync()}});
 Promise.resolve().then(()=>win.fetch('/api/analytics-config',{cache:'no-store',credentials:'omit'}))
  .then(response=>response.ok?response.json():null).then(value=>{config=value;sync()}).catch(()=>{});
 return api;
}
