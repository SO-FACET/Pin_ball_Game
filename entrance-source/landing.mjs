import {createLoadTracker} from '../shared/load-performance.js';

const parameters=new URLSearchParams(location.search);
const automatic=['entrance','quality','debug','debug/1','perf','profile'].some(key=>parameters.has(key))||location.hash==='#experience'||history.state?.sofacetGame||Number(history.state?.sofacetWorldScroll)>0;
let starting,landingLoad,stopListening=()=>{};
export function startExperience(){
 return starting??=(async()=>{
  stopListening();landingLoad?.finish('cancelled');
  if(!automatic)window.__sofacetExperienceStart=performance.now();
  document.body.removeAttribute('data-awaiting-explore');
  document.body.setAttribute('data-loading','');document.body.dataset.phase='buffering';
  const main=document.getElementById('entrance');main.inert=true;main.setAttribute('aria-hidden','true');
  document.getElementById('scroll-hint').firstChild.textContent='Scroll Up to Explore ';
  try{await import('./entrance.mjs')}
  catch{location.assign('/game')}
 })();
}
if(automatic)void startExperience();
else{
 landingLoad=createLoadTracker(window,{stage:'entrance',fromNavigation:true,metrics:()=>({renderer:'poster'})});
 const poster=document.getElementById('scene-poster');
 Promise.resolve(poster?.decode?.()).catch(()=>landingLoad.finish('failed',{failure_code:'asset'})).then(()=>requestAnimationFrame(()=>landingLoad.finish('ready')));
 const button=document.getElementById('scroll-hint'),types=['pointerdown','touchstart','wheel','keydown'];
 const begin=event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.type==='pointerdown'&&event.button!==undefined&&event.button!==0)return;
  if(event.type==='keydown'&&!['Enter',' ','ArrowDown','PageDown'].includes(event.key))return;
  if(document.documentElement?.dataset.cookieSettingsOpen==='true'||document.body.hasAttribute?.('data-menu-open'))return;
  if(event.target?.closest?.('a,button,input,select,textarea,summary,dialog,[role="button"],#sf-cookie-root'))return;
  void startExperience();
 };
 const fallback=()=>void startExperience();
 for(const type of types)window.addEventListener(type,begin,{passive:true});
 button.addEventListener('click',fallback);
 stopListening=()=>{for(const type of types)window.removeEventListener(type,begin);button.removeEventListener('click',fallback)};
}
