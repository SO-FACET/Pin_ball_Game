// rrweb's FPS sampler visits only its own document. The same-origin game gets
// a replay-only window in the outer session; all semantic analytics still use
// the parent facade. The SDK persists nothing in this child.
export function installEmbeddedReplay(win,{loadPosthog}={}){
 let provider=null,pending=null,generation=0,signature='',pageActive=true;
 const topApi=()=>{try{return win.top.sofacetAnalytics}catch{return null}};
 const consent=()=>{try{return pageActive&&win.top.sofacetCookiePreferences?.allows('analytics')===true&&win.top.sofacetCookiePreferences?.allows('recording')===true}catch{return false}};
 const ready=()=>!!win.document.querySelector?.('#stage[data-ready="true"] #viewport canvas#game[data-sofacet-replay-ready="true"]');
 const safely=fn=>{try{return fn()}catch{}};
 function stop(){generation++;signature='';safely(()=>provider?.stop());provider=null}
 async function sync(){
  const context=consent()&&ready()?safely(()=>topApi()?.getReplayContext?.()):null;
  if(!context?.replayContext||typeof loadPosthog!=='function'){stop();return}
  const next=context.replayContext.sessionId+':'+context.replayContext.distinctId;
  if(provider&&next===signature)return;
  if(pending){if(next!==signature){generation++;signature=next}return}
  stop();const epoch=generation;signature=next;
  const current=()=>{
   const latest=safely(()=>topApi()?.getReplayContext?.())?.replayContext;
   return epoch===generation&&consent()&&ready()&&latest?.sessionId+':'+latest?.distinctId===next;
  };
  pending=Promise.resolve().then(()=>loadPosthog(context,consent,null,current)).then(value=>{
   if(!value)return;
   if(!current())value.stop();else{provider=value;provider.setRecordingAllowed(true)}
  }).catch(error=>safely(()=>topApi()?.captureError(error,{source:'session_replay'}))).finally(()=>{pending=null;if(consent()&&!provider&&epoch!==generation)void sync()});
  await pending;
 }
 const onPreferences=()=>{if(!consent())stop();else void sync()};
 safely(()=>win.top.addEventListener('sofacet:cookie-preferences',onPreferences));
 safely(()=>win.top.addEventListener('sofacet:replay-context',()=>void sync()));
 win.addEventListener('sofacet:public-canvas-ready',()=>void sync());
 win.addEventListener('pagehide',()=>{pageActive=false;stop()});
 win.addEventListener('pageshow',()=>{pageActive=true;void sync()});
 win.document.addEventListener('DOMContentLoaded',()=>void sync(),{once:true});
 void sync();
 return {recording:()=>!!safely(()=>provider?.recording()),stop};
}
