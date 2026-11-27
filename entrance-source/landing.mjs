import {createLoadTracker} from '../shared/load-performance.js';

const parameters=new URLSearchParams(location.search);
const automatic=['entrance','quality','debug','debug/1','perf','profile'].some(key=>parameters.has(key))||location.hash==='#experience'||history.state?.sofacetGame||Number(history.state?.sofacetWorldScroll)>0;
let starting;
export function startExperience(){
 return starting??=(async()=>{
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
 const load=createLoadTracker(window,{stage:'entrance',fromNavigation:true,metrics:()=>({renderer:'poster'})});
 const poster=document.getElementById('scene-poster');
 Promise.resolve(poster?.decode?.()).catch(()=>load.finish('failed',{failure_code:'asset'})).then(()=>requestAnimationFrame(()=>load.finish('ready')));
 document.getElementById('scroll-hint').addEventListener('click',()=>void startExperience(),{once:true});
}
