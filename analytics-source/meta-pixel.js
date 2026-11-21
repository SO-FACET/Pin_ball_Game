import {safePagePath} from './privacy.js';

// Advertising consent is independent of Analytics consent. Only the top page
// owns this provider; embedded game screens update the top page's history.
export function installMetaPixel(win){
 if(win.top!==win||win.sofacetMetaPixel)return;
 let config=null,loaded=false,loading=false,initialized=false,lastPage='',active=false;
 const allowed=()=>{try{return win.sofacetCookiePreferences?.allows('advertising')===true}catch{return false}};
 const enabled=()=>config?.metaPixelEnabled===true&&/^\d{5,20}$/.test(config.metaPixelId||'');
 const consent=()=>win.fbq?.('consent',allowed()?'grant':'revoke');
 function clearCookies(){
  const host=win.location.hostname,parts=host.split('.'),domains=['',host,'.'+host];
  for(let i=1;i<parts.length-1;i++)domains.push('.'+parts.slice(i).join('.'));
  for(const name of ['_fbp','_fbc'])for(const domain of domains)win.document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax; Secure'+(domain?'; Domain='+domain:'');
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
   active=false;lastPage='';if(win.fbq)win.fbq('consent','revoke');clearCookies();return;
  }
  active=true;
  if(loaded){
   if(!initialized){
    win.fbq('consent','revoke');
    win.fbq('set','autoConfig',false,config.metaPixelId);
    win.fbq('init',config.metaPixelId);
    initialized=true;
   }
   consent();pageView();return;
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
 const api={sync};win.sofacetMetaPixel=api;
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
