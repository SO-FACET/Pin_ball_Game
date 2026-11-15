export const MAX_DURATION_MS=24*60*60*1000;
export function boundedDuration(value){return typeof value==='number'&&Number.isFinite(value)?Math.min(MAX_DURATION_MS,Math.max(0,Math.round(value))):null}

// One owner supplies a monotonic clock and already-sanitized page paths. This
// module has no timers, storage, browser access, identity or network behavior.
export function createDurationClock({now,emit}){
 let enabled=false,foreground=false,playing=false,page='',sample=null;
 let pagePending=0,gamePending=0,pageTotal=0,gameTotal=0;
 function timestamp(){
  let value;try{value=now()}catch{}
  if(typeof value!=='number'||!Number.isFinite(value))return sample??0;
  return Math.max(sample??value,value);
 }
 function accrue(){
  const value=timestamp(),elapsed=sample===null?0:Math.min(MAX_DURATION_MS,Math.max(0,value-sample));sample=value;
  if(!enabled||!foreground||!page)return;
  pagePending=Math.min(MAX_DURATION_MS,pagePending+elapsed);pageTotal=Math.min(MAX_DURATION_MS,pageTotal+elapsed);
  if(playing){gamePending=Math.min(MAX_DURATION_MS,gamePending+elapsed);gameTotal=Math.min(MAX_DURATION_MS,gameTotal+elapsed)}
 }
 function flush(){
  accrue();
  if(!enabled||!page)return;
  const pageDelta=Math.floor(pagePending),gameDelta=Math.floor(gamePending);
  // Remove each segment before calling external code: a failed provider or a
  // reentrant lifecycle notification must not send the same segment twice.
  pagePending-=pageDelta;gamePending-=gameDelta;
  if(pageDelta>0)try{emit('page_engagement',{page_active_ms:pageDelta},page)}catch{}
  if(gameDelta>0)try{emit('game_engagement',{game_active_ms:gameDelta},page)}catch{}
 }
 function start({active=false,visible=false}={}){
  enabled=true;foreground=visible;playing=active;page='';sample=null;
  pagePending=gamePending=pageTotal=gameTotal=0;sample=timestamp();
 }
 function stop(){enabled=false;foreground=false;playing=false;page='';sample=null;pagePending=gamePending=pageTotal=gameTotal=0}
 function enterPage(path){
  if(page===path)return;
  flush();page=path;pagePending=gamePending=0;pageTotal=0;sample=timestamp();
 }
 function leavePage(){flush();const total=Math.floor(pageTotal);page='';pagePending=gamePending=0;pageTotal=0;sample=timestamp();return total}
 function setForeground(value){if(foreground===value)return;flush();foreground=value;sample=timestamp()}
 function setGameActivity(value){if(playing===value)return;flush();playing=value;sample=timestamp()}
 function startGame(){flush();gamePending=0;gameTotal=0;sample=timestamp()}
 function finishGame(){flush();playing=false;sample=timestamp();return Math.floor(gameTotal)}
 return {start,stop,enterPage,leavePage,setForeground,setGameActivity,startGame,finishGame,flush};
}
