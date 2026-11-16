// posthog-js is pinned to 1.447.11. Its retry queue bypasses before_send and
// SDK opt-out, and offers no public discard API. Keep this small per-instance
// adapter covered by actual failed-transport browser tests before upgrading.
// Never call unload()/shutdown() to discard: both can beacon queued payloads.
const installation=Symbol('sofacetPosthogConsentTransport');
const requestEpoch=Symbol('sofacetPosthogRequestEpoch');
const isReplay=options=>options?.data?.event==='$snapshot'||(Array.isArray(options?.data)&&options.data.some(item=>item.event==='$snapshot'))||options?.batchKey==='recordings'||/\/s\/?(?:\?|$)/.test(options?.url||'');

export function installConsentTransport(instance,allowed,recordingAllowed){
 let state=instance[installation];
 if(!state){
  // The published dist/module.js mangles TS-private names. These aliases are
  // verified against this exact pinned distribution as well as its lib build.
  const queue=instance._retryQueue||instance.ad;
  const keys=instance._retryQueue?{enqueue:'_enqueue',queue:'_queue',poller:'_poller',polling:'_isPolling'}:{enqueue:'js',queue:'Sc',poller:'Nc',polling:'Rc'};
  if(!queue||typeof queue.retriableRequest!=='function'||typeof queue[keys.enqueue]!=='function'||!Array.isArray(queue[keys.queue]))throw Error('Unsupported PostHog consent transport');
  state={live:false,analyticsEpoch:{},recordingEpoch:{},allowed,recordingAllowed,queue,keys};instance[installation]=state;
  {
   const dispatch=queue.retriableRequest.bind(queue),enqueue=queue[keys.enqueue].bind(queue);
   const guard=(options,send)=>{
    const replay=isReplay(options),epoch=replay?state.recordingEpoch:state.analyticsEpoch;
    if(!state.live||!state.allowed()||replay&&!state.recordingAllowed()||options?.[requestEpoch]&&options[requestEpoch]!==epoch)return;
    return send({...options,[requestEpoch]:epoch});
   };
   queue.retriableRequest=(options,transport)=>guard(options,value=>dispatch(value,transport));
   queue[keys.enqueue]=(options,retryAfter)=>guard(options,value=>enqueue(value,retryAfter));
  }
 }
 const discard=replayOnly=>{
  const {queue,keys}=state;
  queue[keys.queue]=queue[keys.queue].filter(item=>replayOnly&&!isReplay(item.requestOptions));
  if(queue.length===0){if(queue[keys.poller])clearTimeout(queue[keys.poller]);queue[keys.poller]=undefined;queue[keys.polling]=false}
  if(Array.isArray(instance.__request_queue))instance.__request_queue=instance.__request_queue.filter(options=>replayOnly&&!isReplay(options));
 };
 // A reused instance must not retry events from the previous provider epoch.
 state.live=false;discard(false);state.analyticsEpoch={};state.recordingEpoch={};
 state.allowed=allowed;state.recordingAllowed=recordingAllowed;state.live=true;
 return {
  revokeRecording(){state.recordingEpoch={};discard(true)},
  stop(){state.live=false;state.analyticsEpoch={};state.recordingEpoch={};discard(false)},
 };
}
