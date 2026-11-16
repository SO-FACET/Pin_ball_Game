import posthog from 'posthog-js';
import {safePagePath,safeReplayText,safeReplayAttribute,safeReplayRequest,safeCanvasRegions,privateReplaySelector} from './privacy.js';
import {installConsentTransport} from './consent-transport.js';

export function posthogProvider(config,allowed,userId=null){
 const replayContext=config.replayContext,replayOnly=!!replayContext;
 const cleanUrl=value=>location.origin+safePagePath(value,location.origin);
 const readyCanvas=()=>typeof document!=='undefined'&&Array.from(document.querySelectorAll('canvas[data-sofacet-replay-ready="true"]')).some(canvas=>safeCanvasRegions(canvas)!==null);
 let recordingAllowed=false,canvasEnabled=readyCanvas();
 const options={
  api_host:config.posthogHost,defaults:'2025-05-24',person_profiles:'identified_only',
  autocapture:false,capture_pageview:false,capture_pageleave:false,capture_exceptions:false,
  disable_capture_url_hashes:true,save_referrer:false,save_campaign_params:false,
  // These low-volume events are sent while consent is current, without an SDK batch queue.
  request_batching:false,
  capture_dead_clicks:false,capture_heatmaps:false,capture_performance:false,
  disable_surveys:true,advanced_disable_feature_flags_on_first_load:true,enable_recording_console_log:false,
  disable_session_recording:true,persistence:replayOnly?'memory':'localStorage+cookie',cookie_expiration:365,cross_subdomain_cookie:false,
  ...(replayOnly?{bootstrap:{distinctID:replayContext.distinctId,sessionID:replayContext.sessionId}}:{}),
  opt_out_persistence_by_default:true,opt_out_capturing_by_default:true,
  session_recording:{maskAllInputs:true,maskInputFn:()=> '[redacted]',maskTextSelector:'*',maskTextFn:safeReplayText,blockSelector:privateReplaySelector,
   recordCrossOriginIframes:false,recordHeaders:false,recordBody:false,recordPerformance:false,
   captureCanvas:{recordCanvas:canvasEnabled,canvasFps:2,canvasQuality:'0.2'},canvasCapture:{resolutionScale:.5,maskRegionsFn:safeCanvasRegions},
   maskAttributeFn:(name,value)=>safeReplayAttribute(name,value,location.origin),
   collectFonts:false,inlineStylesheet:false,maskCapturedNetworkRequestFn:data=>safeReplayRequest(data,location.origin)},
  before_send:event=>{
   if(!allowed())return null;
   if(replayOnly&&event.event!=='$snapshot')return null;
   if(event.event==='$snapshot'&&!recordingAllowed)return null;
   delete event.$set;delete event.$set_once;
   const properties=event.properties;
   if(properties){
    for(const key of Object.keys(properties)){
     if(/(?:url|referrer|pathname|title|initial|utm_|gclid|fbclid|search|hash|host)/i.test(key))delete properties[key];
    }
    properties.$current_url=cleanUrl(properties.page_path||location.href);
    properties.$pathname=safePagePath(properties.page_path||location.href,location.origin);
    delete properties.$set;delete properties.$set_once;
   }
   return event;
  },
 };
 const existing=replayOnly?posthog['sofacet-game-replay']:posthog.config?.token===config.posthogKey?posthog:null;
 // Pinned posthog-js init() is a no-op on an existing instance. Regrant must
 // install fresh consent closures instead of retaining the stopped provider.
 const instance=existing||posthog.init(config.posthogKey,options,replayOnly?'sofacet-game-replay':undefined);
 if(existing){existing.stopSessionRecording();existing.set_config(options)}
 if(!instance)throw Error('PostHog initialization failed');
 const transport=installConsentTransport(instance,allowed,()=>recordingAllowed);
 // Verify the persisted member before opting in, then identify before replay starts.
 if(!replayOnly){
  const previousUser=instance.get_property('$user_id');
  if(previousUser&&previousUser!==userId)instance.reset(true);
  instance.opt_in_capturing({captureEventName:false});
  if(userId)instance.identify(userId);
 }else{
  // Reusing a named SDK after a new consent epoch must follow the outer
  // anonymous ID/session. These updates affect memory only and emit no event.
  instance.register({distinct_id:replayContext.distinctId});
  instance.sessionManager?.setBootstrapSessionId(replayContext.sessionId);
 }
 const syncRecording=()=>{
  const enabled=config.sessionReplay===true&&recordingAllowed&&allowed();
  const nextCanvas=readyCanvas();
  if(nextCanvas!==canvasEnabled){
   // rrweb changes FUTURE getContext options. All authored WebGL contexts
   // are created before publishing this marker, so their buffers stay native.
   instance.stopSessionRecording();canvasEnabled=nextCanvas;
   instance.set_config({session_recording:{...options.session_recording,captureCanvas:{recordCanvas:canvasEnabled,canvasFps:2,canvasQuality:'0.2'}}});
  }
  instance.set_config({disable_session_recording:!enabled});
  if(!enabled)instance.stopSessionRecording();
 };
 const canvasReady=()=>syncRecording();
 if(typeof window!=='undefined')window.addEventListener('sofacet:public-canvas-ready',canvasReady);
 const resetIdentity=()=>{
  instance.reset(true);
  // This SDK resets its own consent too; retain the site's current choice.
  if(allowed())instance.opt_in_capturing({captureEventName:false});
  syncRecording();
 };
 return {
  track(name,properties){instance.capture(name==='page_view'?'$pageview':name==='page_leave'?'$pageleave':name,properties)},
  error(error,properties){instance.captureException(error,properties)},
  identify(userId){instance.identify(userId)},reset:resetIdentity,
  clearIdentity(){if(instance.get_property('$user_id'))resetIdentity()},
  setRecordingAllowed(value){if(value!==true)transport.revokeRecording();recordingAllowed=value===true;syncRecording()},
  replayContext(){return allowed()?{posthogKey:config.posthogKey,posthogHost:config.posthogHost,sessionReplay:config.sessionReplay,environment:config.environment,release:config.release,replayContext:{distinctId:instance.get_distinct_id(),sessionId:instance.get_session_id()}}:null},
  onSessionId(callback){return instance.onSessionId?.(callback)||(()=>{})},
  recording(){return instance.sessionRecordingStarted()},
  stop(){recordingAllowed=false;transport.stop();if(typeof window!=='undefined')window.removeEventListener('sofacet:public-canvas-ready',canvasReady);instance.stopSessionRecording();if(!replayOnly){instance.reset(true);instance.opt_out_capturing()}},
 };
}
