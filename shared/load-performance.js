// Local, bounded measurements only. The analytics runtime owns consent and delivery.
export const LOAD_METRIC_EVENT='sofacet:load-performance';
export function classifyLoadFailure(error){
 const message=String(error?.message||error||'');
 if(error?.name==='TimeoutError'||/timeout|timed out|stalled/i.test(message))return 'timeout';
 if(/memory|allocation|array buffer|out of bounds/i.test(message))return 'memory';
 if(/webgl|context lost|gpu|canvas/i.test(message))return 'graphics';
 if(/wasm|webassembly|unreachable/i.test(message))return 'wasm';
 if(/fetch|network|load|asset|http|manifest|download/i.test(message))return 'asset';
 return 'runtime';
}
export function recordLoadMetric(win,properties){
 try{
  const state=win.__sofacetLoadMetrics??={next:0,sequence:0,entries:[]};
  const entry={id:++state.next,path:win.location?.pathname||'/',properties:{...properties}};
  state.entries.push(entry);if(state.entries.length>64)state.entries.shift();
  win.dispatchEvent(new win.CustomEvent(LOAD_METRIC_EVENT,{detail:{immediate:properties.load_outcome==='abandoned'}}));
 }catch{}
}

export function createLoadTracker(win,{stage,fromNavigation=false,metrics=()=>({}),slowMs=15000}={}){
 const now=()=>{try{return win.performance.now()}catch{return 0}};
 const start=fromNavigation?0:now();
 let finished=false,hidden=win.document?.hidden===true,hiddenAt=hidden?now():null,hiddenMs=0;
 let sequence=1;
 try{const state=win.__sofacetLoadMetrics??={next:0,sequence:0,entries:[]};sequence=++state.sequence}catch{}
 const visibility=()=>{
  const time=now();
  if(win.document.hidden){hidden=true;hiddenAt??=time;}
  else if(hiddenAt!==null){hiddenMs+=Math.max(0,time-hiddenAt);hiddenAt=null;}
 };
 const report=(outcome,extra={})=>{
  const time=now(),duration=Math.max(0,time-start);
  let snapshot={};try{snapshot=metrics()||{}}catch{}
  recordLoadMetric(win,{...snapshot,...extra,load_stage:stage,load_outcome:outcome,load_sequence:sequence,
   duration_ms:duration,active_ms:Math.max(0,duration-hiddenMs-(hiddenAt===null?0:time-hiddenAt)),was_hidden:hidden});
 };
 const pagehide=event=>{if(!event?.persisted)finish('abandoned');};
 let timer;
 function finish(outcome='ready',extra={}){
  if(finished)return;finished=true;
  try{win.clearTimeout(timer);win.removeEventListener('pagehide',pagehide);win.document?.removeEventListener('visibilitychange',visibility)}catch{}
  report(outcome,extra);
 }
 try{
  win.addEventListener('pagehide',pagehide);
  win.document?.addEventListener('visibilitychange',visibility);
  timer=win.setTimeout(()=>{if(!finished)report('slow')},Math.max(0,slowMs-(now()-start)));
 }catch{}
 report('started');
 return {finish};
}
