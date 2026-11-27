import {LOAD_METRIC_EVENT,recordLoadMetric} from '../shared/load-performance.js';

const durations=new Set(['duration_ms','active_ms','ttfb_ms','dom_ready_ms','load_event_ms']);
const integers={load_sequence:10000,video_width:8192,media_bytes:2**30,network_bytes:2**30,cached_bytes:2**30,discarded_bytes:2**30,quality_switches:10,download_attempts:10,progress_percent:100,viewport_width:16384,viewport_height:16384,screen_width:16384,screen_height:16384,cpu_cores:256,browser_major:1000,os_major:1000,rtt_ms:60000};
const decimals={downlink_mbps:10000,device_memory_gb:256,pixel_ratio:10};
const enums={load_stage:['page','entrance','cinematic','game'],load_outcome:['started','slow','ready','failed','abandoned','cancelled'],device_type:['mobile','tablet','desktop','unknown'],browser:['Instagram','Facebook','SamsungInternet','Edge','Firefox','Opera','Chrome','Safari','Other'],os:['Android','iOS','macOS','Windows','Linux','Other'],connection_type:['bluetooth','cellular','ethernet','none','wifi','wimax','other','unknown'],effective_type:['slow-2g','2g','3g','4g','unknown'],selection_reason:['preferred','option','data-saver','connection-slow','slow-network','cdn-fallback','local-fallback','cached-hd'],renderer:['poster','video','webgl'],failure_code:['memory','graphics','wasm','asset','runtime','timeout','cancelled']};
const booleans=new Set(['was_hidden','save_data']);
function model(value){
 if(typeof value!=='string')return;
 const result=value.trim();
 if(result&&result.length<=64&&/^[A-Za-z0-9 ._()+-]+$/.test(result)&&!/[A-Za-z0-9]{24,}|\d{6,}/.test(result))return result;
}
export function cleanLoadProperties(properties={}){
 const clean={};
 for(const [key,value] of Object.entries(properties||{})){
  if(durations.has(key)){if(typeof value==='number'&&Number.isFinite(value))clean[key]=Math.round(Math.max(0,Math.min(86400000,value)));}
  else if(Object.hasOwn(integers,key)){if(typeof value==='number'&&Number.isFinite(value)&&value>=0)clean[key]=Math.min(integers[key],Math.round(value));}
  else if(Object.hasOwn(decimals,key)){if(typeof value==='number'&&Number.isFinite(value)&&value>=0)clean[key]=Math.round(Math.min(decimals[key],value)*100)/100;}
  else if(Object.hasOwn(enums,key)){if(enums[key].includes(value))clean[key]=value;}
  else if(booleans.has(key)){if(typeof value==='boolean')clean[key]=value;}
  else if(key==='device_model'){const safe=model(value);if(safe)clean[key]=safe;}
 }
 return clean;
}

export function deviceContext(win){
 const nav=win.navigator||{},ua=String(nav.userAgent||'').slice(0,1024);
 const ios=/iPhone|iPad|iPod/.test(ua)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 const os=/Android/.test(ua)?'Android':ios?'iOS':/Windows/.test(ua)?'Windows':/Macintosh|Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Other';
 const tablet=/iPad|Tablet/.test(ua)||(ios&&!/iPhone|iPod/.test(ua))||(os==='Android'&&!/Mobile/.test(ua)&&nav.userAgentData?.mobile!==true);
 const type=tablet?'tablet':ios||/Mobile/.test(ua)||nav.userAgentData?.mobile===true?'mobile':'desktop';
 const browser=/Instagram/i.test(ua)?'Instagram':/FBAN|FBAV/.test(ua)?'Facebook':/SamsungBrowser/.test(ua)?'SamsungInternet':/Edg/.test(ua)?'Edge':/Firefox|FxiOS/.test(ua)?'Firefox':/OPR|OPiOS/.test(ua)?'Opera':/Chrome|CriOS/.test(ua)?'Chrome':/Safari/.test(ua)?'Safari':'Other';
 const versions={Instagram:/Instagram\s+(\d+)/,Facebook:/FBAV\/(\d+)/,SamsungInternet:/SamsungBrowser\/(\d+)/,Edge:/(?:EdgA?|EdgiOS)\/(\d+)/,Firefox:/(?:Firefox|FxiOS)\/(\d+)/,Opera:/(?:OPR|OPiOS)\/(\d+)/,Chrome:/(?:Chrome|CriOS)\/(\d+)/,Safari:/Version\/(\d+)/};
 const version=ua.match(versions[browser]||/$^/);
 const osVersions={Android:/Android (\d+)/,iOS:/(?:CPU (?:iPhone )?OS |iPhone OS )(\d+)/,macOS:/Mac OS X (\d+)/};
 const osVersion=ua.match(osVersions[os]||/$^/);
 let deviceModel=ios?(type==='tablet'?'iPad':'iPhone'):os==='Android'?'Android':'unknown';
 const android=ua.match(/Android[^;)]*;\s*([^)]*?)(?:\s+Build\/|\))/)?.[1]?.replace(/;\s*wv$/,'').trim();
 if(os==='Android'&&android&&android!=='K'&&model(android))deviceModel=android;
 const connection=nav.connection||nav.mozConnection||nav.webkitConnection||{};
 return cleanLoadProperties({device_type:type,device_model:deviceModel,browser,os,browser_major:version?Number(version[1]):undefined,os_major:osVersion?Number(osVersion[1]):undefined,
  viewport_width:win.innerWidth,viewport_height:win.innerHeight,screen_width:win.screen?.width,screen_height:win.screen?.height,pixel_ratio:win.devicePixelRatio,
  device_memory_gb:nav.deviceMemory,cpu_cores:nav.hardwareConcurrency,connection_type:connection.type||'unknown',effective_type:connection.effectiveType||'unknown',downlink_mbps:connection.downlink,rtt_ms:connection.rtt,save_data:connection.saveData});
}

export function installLoadPerformance(win,{allowed,emit}){
 const seen=new Set();let context,preparing=null,settled=true,revision=0,timer,cancelPrepare;
 const call=fn=>{try{return fn()}catch{}};
 function flush({immediate=false}={}){
  if(!allowed())return;
  if(!immediate&&!settled){void preparing?.then(()=>flush());return;}
  context??=deviceContext(win);
  for(const entry of win.__sofacetLoadMetrics?.entries||[]){
   if(!allowed())return;
   if(seen.has(entry.id))continue;seen.add(entry.id);
   emit({...context,...cleanLoadProperties(entry.properties)},entry.path);
  }
 }
 function prepare(){
  context=deviceContext(win);
  const hints=win.navigator?.userAgentData;
  if(!allowed()||!hints?.getHighEntropyValues||preparing)return;
  const epoch=++revision;settled=false;
  preparing=new Promise(resolve=>{
   let complete=false;
   const finish=value=>{
    if(complete)return;complete=true;cancelPrepare=null;call(()=>win.clearTimeout(timer));
    if(epoch===revision&&allowed()){
     const deviceModel=model(value?.model);
     if(deviceModel)context.device_model=deviceModel;
     const major=Number(value?.platformVersion?.split('.')[0]);
     if(['Android','macOS'].includes(context.os)&&Number.isInteger(major)&&major>0&&major<1000)context.os_major=major;
    }
    if(epoch===revision)settled=true;
    resolve();
   };
   cancelPrepare=()=>finish();timer=win.setTimeout(()=>finish(),500);
   Promise.resolve().then(()=>hints.getHighEntropyValues(['model','platformVersion'])).then(finish,()=>finish());
  });
 }
 function stop(){revision++;cancelPrepare?.();call(()=>win.clearTimeout(timer));preparing=null;settled=true;context=undefined;}
 function navigation(){
  call(()=>win.setTimeout(()=>{
   const nav=win.performance?.getEntriesByType?.('navigation')?.[0];if(!nav)return;
   recordLoadMetric(win,{load_stage:'page',load_outcome:'ready',duration_ms:nav.loadEventEnd||win.performance.now(),ttfb_ms:Math.max(0,nav.responseStart-nav.requestStart),dom_ready_ms:nav.domContentLoadedEventEnd,load_event_ms:nav.loadEventEnd});
  },0));
 }
 win.addEventListener(LOAD_METRIC_EVENT,event=>flush({immediate:event.detail?.immediate===true}));
 win.addEventListener('pagehide',()=>flush({immediate:true}));
 if(win.document?.readyState==='complete')navigation();else win.addEventListener('load',navigation,{once:true});
 return {prepare,flush,stop};
}
