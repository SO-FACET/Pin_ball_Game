import posthog from 'posthog-js';
import {safePath} from './runtime.js';

export function posthogProvider(config,allowed,userId=null){
 const cleanUrl=value=>{try{const url=new URL(value,location.origin);return url.origin+safePath(url.href,location.origin)}catch{return ''}};
 const instance=posthog.init(config.posthogKey,{
  api_host:config.posthogHost,defaults:'2025-05-24',person_profiles:'identified_only',
  autocapture:false,capture_pageview:false,capture_pageleave:false,capture_exceptions:false,
  disable_capture_url_hashes:true,save_referrer:false,save_campaign_params:false,
  // These low-volume events are sent while consent is current, without an SDK batch queue.
  request_batching:false,
  capture_dead_clicks:false,capture_heatmaps:false,capture_performance:false,
  disable_surveys:true,advanced_disable_feature_flags_on_first_load:true,enable_recording_console_log:false,
  disable_session_recording:true,persistence:'localStorage+cookie',cookie_expiration:365,cross_subdomain_cookie:false,
  opt_out_persistence_by_default:true,opt_out_capturing_by_default:true,
  session_recording:{maskAllInputs:true,maskTextSelector:'*',blockSelector:'.ph-no-capture,[data-analytics-private]',
   recordCrossOriginIframes:false,recordHeaders:false,recordBody:false,captureCanvas:{recordCanvas:false},
   maskAttributeFn:(name,value)=>{
    if(['value','placeholder','aria-label','title'].includes(name)||name.startsWith('data-'))return '[redacted]';
    if(['href','src','action'].includes(name)){try{const url=new URL(value,location.origin);return ['http:','https:'].includes(url.protocol)?url.origin+url.pathname:''}catch{return ''}}
    return value;
   },
   collectFonts:false,inlineStylesheet:false,maskCapturedNetworkRequestFn:()=>null},
  before_send:event=>{
   if(!allowed())return null;
   delete event.$set;delete event.$set_once;
   const properties=event.properties;
   if(properties){
    for(const key of Object.keys(properties)){
     if(/(?:url|referrer|pathname|title|initial|utm_|gclid|fbclid|search|hash|host)/i.test(key))delete properties[key];
    }
    properties.$current_url=cleanUrl(properties.page_path||location.href);
    properties.$pathname=safePath(properties.page_path||location.href,location.origin);
    delete properties.$set;delete properties.$set_once;
   }
   return event;
  },
 });
 if(!instance)throw Error('PostHog initialization failed');
 // Verify the persisted member before opting in, then identify before replay starts.
 const previousUser=instance.get_property('$user_id');
 if(previousUser&&previousUser!==userId)instance.reset(true);
 instance.opt_in_capturing({captureEventName:false});
 if(userId)instance.identify(userId);
 instance.set_config({disable_session_recording:!config.sessionReplay});
 const resetIdentity=()=>{
  instance.reset(true);
  // This SDK resets its own consent too; retain the site's current choice.
  if(allowed())instance.opt_in_capturing({captureEventName:false});
 };
 return {
  track(name,properties){instance.capture(name==='page_view'?'$pageview':name==='page_leave'?'$pageleave':name,properties)},
  error(error,properties){instance.captureException(error,properties)},
  identify(userId){instance.identify(userId)},reset:resetIdentity,
  clearIdentity(){if(instance.get_property('$user_id'))resetIdentity()},
  recording(){return instance.sessionRecordingStarted()},
  stop(){instance.stopSessionRecording();instance.reset(true);instance.opt_out_capturing()},
 };
}
