import {createLoadTracker} from '../shared/load-performance.js';

const parameters=new URLSearchParams(location.search);
const automatic=['entrance','quality','debug','debug/1','perf','profile'].some(key=>parameters.has(key))||location.hash==='#experience'||history.state?.sofacetGame||Number(history.state?.sofacetWorldScroll)>0;
let preparing,starting,landingLoad,stopListening=()=>{},pendingScroll=0,idleTimer;
function showFailure(){
 document.body.removeAttribute('data-interaction-pending');document.body.setAttribute('data-entrance-error','');
 document.body.setAttribute('data-awaiting-explore','');
 const status=document.getElementById('scene-loading-status');
 if(status){status.hidden=false;status.querySelector('[data-scene-status]').textContent='The journey couldn’t load. Please try again.';}
 const retry=document.getElementById('journey-retry');if(retry)retry.hidden=false;
}
export function prepareExperience(){
 return preparing??=(async()=>{
  clearTimeout(idleTimer);window.__sofacetExperienceStart=performance.now();
  try{return await import('./entrance.mjs')}
  catch(error){showFailure();throw error}
 })();
}
export function startExperience(){
 if(automatic)return starting??=(async()=>{
  document.body.removeAttribute('data-awaiting-explore');document.body.setAttribute('data-loading','');document.body.dataset.phase='buffering';
  const main=document.getElementById('entrance');main.inert=true;main.setAttribute('aria-hidden','true');
  try{await import('./entrance.mjs')}catch{showFailure();document.body.removeAttribute('data-loading');main.inert=false;main.removeAttribute('aria-hidden')}
 })();
 return starting??=(async()=>{
  landingLoad?.finish('cancelled');document.body.setAttribute('data-interaction-pending','');
  try{
   const entrance=await prepareExperience();
   await entrance.activateEntrance({scroll:pendingScroll});
   document.body.removeAttribute('data-interaction-pending');stopListening();
  }catch{starting=undefined;showFailure()}
 })();
}
document.getElementById('journey-retry')?.addEventListener('click',()=>location.reload());
if(automatic)void startExperience();
else{
 landingLoad=createLoadTracker(window,{stage:'entrance',fromNavigation:true,metrics:()=>({renderer:'poster'})});
 const poster=document.getElementById('scene-poster');
 Promise.resolve(poster?.decode?.()).catch(()=>landingLoad.finish('failed',{failure_code:'asset'})).then(()=>requestAnimationFrame(()=>{
  landingLoad.finish('ready');
  // Let the artwork/fonts paint first, then prepare the real movie without
  // waiting for a gesture or covering the opening with a second loading screen.
  idleTimer=setTimeout(()=>{if(!document.hidden)void prepareExperience().catch(()=>{})},1200);
 }));
 const button=document.getElementById('scroll-hint'),types=['pointerdown','touchstart','touchmove','wheel','keydown'];
 let touchY;
 const begin=event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.type==='pointerdown'&&event.button!==undefined&&event.button!==0)return;
  if(event.type==='keydown'&&!['Enter',' ','ArrowDown','PageDown'].includes(event.key))return;
  if(document.documentElement?.dataset.cookieSettingsOpen==='true'||document.body.hasAttribute?.('data-menu-open'))return;
  const control=event.target?.closest?.('a,button,input,select,textarea,summary,dialog,[role="button"],#sf-cookie-root');
  if(control&&control!==button)return;
  if(event.type==='touchstart')touchY=event.touches?.[0]?.clientY;
  const amount=event.type==='wheel'?event.deltaY:event.type==='touchmove'?touchY-event.touches?.[0]?.clientY:event.type==='keydown'?innerHeight*.8:0;
  if(event.type==='touchmove')touchY=event.touches?.[0]?.clientY;
  if(amount>0)pendingScroll=Math.min(innerHeight*.8,pendingScroll+amount);
  void startExperience();
 };
 const fallback=()=>{pendingScroll=innerHeight*.8;void startExperience()};
 const resume=()=>{if(!document.hidden&&!preparing)void prepareExperience().catch(()=>{})};
 for(const type of types)window.addEventListener(type,begin,{passive:true});
 document.addEventListener('visibilitychange',resume);button.addEventListener('click',fallback);
 stopListening=()=>{for(const type of types)window.removeEventListener(type,begin);document.removeEventListener('visibilitychange',resume);button.removeEventListener('click',fallback)};
}
