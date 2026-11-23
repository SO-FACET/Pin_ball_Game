import {mountScorePage} from './score-page.jsx';
import {mountRewardNoticeArtwork} from '../../collective-source/artwork/RewardNoticeArtwork.jsx';
import './post-game-rewards.css';
import '../../collective-source/reward-notice.css';
import {rewardFromPoints} from '../../shared/reward-value.js';
import {setScreenRoute,writeScreenData} from '../../site-routes.js';
import {track} from '../../shared/analytics.js';

export type CompletedGameResult=Readonly<{points:number;rewardValue:number;completedAt:number;status:'completed';gameId?:string}>;
export function captureGameResult(finalScore:number,gameId?:string):CompletedGameResult{
 const whole=Math.trunc(finalScore),points=Number.isSafeInteger(whole)?Math.max(0,whole):0;
 return Object.freeze({points,rewardValue:rewardFromPoints(points),completedAt:Date.now(),status:'completed',gameId});
}
export function connectPostGameRewards(onRegister:(result:CompletedGameResult,opener:HTMLElement)=>void,onRetry:()=>void,onLeaderboard:()=>void=()=>{},isMember:()=>boolean=()=>false){
 const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const dialog=$<HTMLDialogElement>('post-game-rewards'),header=document.querySelector<HTMLElement>('body > header')!,toggle=$('nav-toggle');
 const views={result:$('rewards-result'),leave:$('rewards-leave')};
 let result:CompletedGameResult|null=null,discarded=false,current:keyof typeof views='result',destination='/',exitIntent=false;
 const scorePage=mountScorePage($('score-page-root'),{onSave:register,onReplay:replay,onLeaderboard,onMaybeLater:notify});
 const showNoticeArtwork=mountRewardNoticeArtwork($('reward-notice-art'));
 const unsaved=()=>!!result&&result.points>=10&&!discarded&&!isMember();
 const placeFloor=()=>{if(current==='result')return;const actions=views[current].querySelector<HTMLElement>('.rewards-actions')!;if(dialog.open)dialog.style.setProperty('--rewards-floor-top',actions.offsetTop+actions.offsetHeight+12+'px')};
 const resize=new ResizeObserver(placeFloor);
 function setView(view:keyof typeof views){
  if(view==='result')setScreenRoute('/reward',{replace:false});
  current=view;dialog.dataset.view=view;for(const [key,element] of Object.entries(views))element.hidden=key!==view;
  showNoticeArtwork(view==='result'?null:view);
  if(view==='result')scorePage.render(result!,isMember(),exitIntent);else scorePage.clear();
  const heading=views[view].querySelector<HTMLElement>('h1')!;
  dialog.setAttribute('aria-labelledby',heading.id);
  dialog.setAttribute('aria-describedby',view==='result'?(result!.points<10?'rewards-score rewards-low-copy':'rewards-score rewards-value-line rewards-expiry'):'rewards-leave-copy');
  resize.disconnect();if(!dialog.open){dialog.prepend(header);dialog.showModal()}
  dialog.scrollTop=0;
  resize.observe(views[view]);placeFloor();heading.focus({preventScroll:true});
 }
 function register(){
  if(!result){dialog.close();return;}
  const opener=$(exitIntent?'save-coins-login':current==='leave'?'rewards-keep':'rewards-register');
  exitIntent=false;dialog.close();onRegister(result,opener);
 }
 function notify(){if(unsaved())track('reward_discarded');discard();window.top!.location.assign('/notify')}
 function discard(){exitIntent=false;discarded=true;result=null;writeScreenData('reward',null)}
 function replay(){discarded=true;dialog.close();onRetry()}
 function world(){discarded=true;window.top!.location.assign(destination)}
 function leave(href='/'){
  destination=href;
  if(!unsaved()){world();return}
  exitIntent=true;setView('result');
  dialog.setAttribute('aria-labelledby','save-coins-heading');
  dialog.setAttribute('aria-describedby','save-coins-desc');
  $('save-coins-login').focus({preventScroll:true});
 }
 dialog.addEventListener('close',()=>{if(dialog.open)return;resize.disconnect();scorePage.clear?.();showNoticeArtwork(null);if(toggle.getAttribute('aria-expanded')==='true')toggle.click();document.body.prepend(header)});
 $('rewards-keep').onclick=register;
 $('rewards-leave-anyway').onclick=notify;
 dialog.addEventListener('sofacet:page-ready',()=>{if(dialog.open&&current==='result'&&!exitIntent&&toggle.getAttribute('aria-expanded')!=='true')views.result.querySelector<HTMLElement>('h1')!.focus({preventScroll:true})});
 dialog.oncancel=event=>{event.preventDefault();if(exitIntent){exitIntent=false;setView('result')}else if(current==='leave'){if(result)setView('result');else dialog.close()}else if(current==='result')leave()};
 function onExitLink(event:MouseEvent){
  if(!dialog.open||!unsaved()||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const target=event.target as Element|null;
  const link=typeof target?.closest==='function'?target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!link||link.target==='_blank'||link.hasAttribute('download')||link.hasAttribute('data-game-info'))return;
  const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
  event.preventDefault();leave(url.href);
 }
 document.addEventListener('click',onExitLink,true);
 const historyHost=window.top!;
 if(historyHost!==window)historyHost.document?.addEventListener('click',onExitLink,true);
 const onBack=(event:PopStateEvent)=>{
  if(!dialog.open||!unsaved()||historyHost.location.pathname==='/reward'||historyHost.history?.state?.sofacetInfo||historyHost.history?.state?.sofacetJoin)return;
  event.stopImmediatePropagation();leave();
 };
 const onUnload=(event:BeforeUnloadEvent)=>{
  if(!dialog.open||!unsaved())return;
  event.preventDefault();event.returnValue='';
 };
 historyHost.addEventListener?.('popstate',onBack,true);
 historyHost.addEventListener?.('beforeunload',onUnload);
 window.addEventListener?.('pagehide',event=>{
  if(event.persisted)return;
  historyHost.removeEventListener?.('popstate',onBack,true);
  historyHost.removeEventListener?.('beforeunload',onUnload);
  document.removeEventListener?.('click',onExitLink,true);
  if(historyHost!==window)historyHost.document?.removeEventListener('click',onExitLink,true);
 });
 return{dialog,get result(){return discarded?null:result},
  show(finalScore?:number,gameId?:string){
   if(discarded)return;
   if(!result){if(finalScore===undefined)return;result=captureGameResult(finalScore,gameId);writeScreenData('reward',result)}
   setView('result');
  },
  discard,
  clear(){exitIntent=false;dialog.close();result=null;discarded=false;destination='/';writeScreenData('reward',null);setScreenRoute('/game')},
 };
}
