import {PostHog} from 'posthog-node';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {routeDocuments} from './site-routes.js';
import {posthogPublicKey} from './analytics-config.mjs';

const SOURCE_ROOT=resolve(fileURLToPath(new URL('.',import.meta.url)));
const DISTINCT_ID='sofacet-server';
const SOURCES=new Set(['request','static_stream','startup','uncaught_exception','unhandled_rejection']);
const FATAL_SOURCES=new Set(['startup','uncaught_exception','unhandled_rejection']);
const ERROR_NAMES=new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','AggregateError','ServiceError']);
const ERROR_CODES=new Set(['EACCES','EPERM','ENOENT','EEXIST','EISDIR','ENOTDIR','ENOSPC','EMFILE','ENFILE','EIO','EADDRINUSE','EADDRNOTAVAIL','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','ERR_HTTP_HEADERS_SENT','ERR_STREAM_PREMATURE_CLOSE','ERR_STREAM_DESTROYED','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_INVALID_URL']);
const API_ROUTES=new Set(['/api/analytics-config','/api/analytics-identity','/api/media-config','/api/first-cuts','/api/game-load-failure','/api/account','/api/account/session','/api/account/details','/api/account/signout','/api/account/otp/request','/api/account/otp/verify','/api/player','/api/member','/api/membership','/api/membership/config','/api/membership/rewards','/api/membership/otp/request','/api/membership/otp/verify','/api/games/start','/api/leaderboard','/api/rewards/leaderboard','/api/internal/rewards/award']);
const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const MAX_EVENTS_PER_MINUTE=20;
const SHUTDOWN_TIMEOUT_MS=1500;

function field(value,key){try{return value?.[key]}catch{return undefined}}
function errorName(error){const name=field(error,'name');return ERROR_NAMES.has(name)?name:'Error'}
function errorCode(error){const code=field(error,'code');return ERROR_CODES.has(code)?code:undefined}
function exceptionMessage(code){return code?'Unexpected server error ('+code+')':'Unexpected server error'}

function sourceFile(value,sourceRoot){
 if(typeof value!=='string'||value.length>1024||/[?#\r\n]/.test(value))return undefined;
 let path=value;
 try{if(path.startsWith('file://'))path=fileURLToPath(path)}catch{return undefined}
 if(path.startsWith('node:'))return /^node:[A-Za-z0-9_./-]+$/.test(path)?path:undefined;
 if(isAbsolute(path))path=relative(sourceRoot,path);
 if(path.startsWith('../')||path.includes('\\')||!/^[-A-Za-z0-9_@./]+\.(?:[cm]?js|tsx?)$/.test(path)||path.split('/').includes('..'))return undefined;
 return path;
}

// Messages, error causes and arbitrary error properties can contain submitted
// customer data. Send a fixed message, a known Node error code and source frames.
export function sanitiseServerException(error,{sourceRoot=SOURCE_ROOT}={}){
 const name=errorName(error),code=errorCode(error),safe=new Error(exceptionMessage(code));
 safe.name=name;
 if(code)safe.code=code;
 const stack=field(error,'stack'),frames=[];
 if(typeof stack==='string')for(const line of stack.slice(0,32768).split('\n').slice(1,33)){
  const match=/^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
  if(!match)continue;
  const filename=sourceFile(match[2],sourceRoot);
  if(!filename)continue;
  const fn=match[1]&&/^[A-Za-z_$<>][\w.$<> ]{0,99}$/.test(match[1])?match[1]:null;
  frames.push('    at '+(fn?fn+' (':'')+filename+':'+match[3]+':'+match[4]+(fn?')':''));
 }
 safe.stack=name+': '+safe.message+(frames.length?'\n'+frames.join('\n'):'');
 return safe;
}

function route(path){
 if(typeof path!=='string')return 'unknown';
 const clean=path.split(/[?#]/,1)[0];
 if(clean==='/static/:asset')return clean;
 if(Object.hasOwn(routeDocuments,clean)||API_ROUTES.has(clean)||clean==='/health')return clean;
 if(/^\/api\/games\/[^/]+\/(?:finish|score)$/.test(clean))return '/api/games/:id/'+clean.split('/').at(-1);
 if(clean.startsWith('/api/'))return '/api/:unknown';
 if(/^\/(?:assets|vendor|sounds|leaderboard|scoreboard|references)\//.test(clean))return '/static/:asset';
 return 'unknown';
}

function safeFrame(frame,sourceRoot){
 const filename=sourceFile(frame?.filename,sourceRoot);
 if(!filename)return null;
 const safe={platform:'node:javascript',filename,in_app:!filename.startsWith('node:')&&!filename.startsWith('node_modules/')};
 if(typeof frame.function==='string'&&/^[A-Za-z_$<>][\w.$<> ]{0,99}$/.test(frame.function))safe.function=frame.function;
 for(const key of ['lineno','colno'])if(Number.isSafeInteger(frame[key])&&frame[key]>0&&frame[key]<10000000)safe[key]=frame[key];
 return safe;
}

function safeMetadata(env){
 const environment=['production','staging','development','test'].includes(env.ANALYTICS_ENVIRONMENT)?env.ANALYTICS_ENVIRONMENT:'production';
 const candidate=env.RAILWAY_GIT_COMMIT_SHA||env.APP_RELEASE||'';
 const release=/^(?:[a-f0-9]{7,64}|v?\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?)$/.test(candidate)?candidate:'';
 return {environment,...(release?{release}:{}),service:'sofacet-web',telemetry_scope:'anonymous_server_errors'};
}

// Defense in depth: the Node SDK can add source snippets and request context.
// Rebuild the final exception from permitted fields rather than deleting known
// sensitive fields. No request/user/session context is ever forwarded.
export function sanitiseServerEvent(event,{metadata={},sourceRoot=SOURCE_ROOT}={}){
 if(event?.event!=='$exception')return null;
 const props=event.properties||{},exception=Array.isArray(props.$exception_list)?props.$exception_list[0]:null;
 if(!exception)return null;
 const code=ERROR_CODES.has(props.error_code)?props.error_code:undefined;
 const source=SOURCES.has(props.server_error_source)?props.server_error_source:'request';
 const rawFrames=Array.isArray(exception.stacktrace?.frames)?exception.stacktrace.frames:[];
 const frames=rawFrames.slice(-32).map(frame=>safeFrame(frame,sourceRoot)).filter(Boolean);
 const clean={type:ERROR_NAMES.has(exception.type)?exception.type:'Error',value:exceptionMessage(code),mechanism:{type:'generic',handled:!FATAL_SOURCES.has(source)}};
 if(frames.length)clean.stacktrace={type:'raw',frames};
 const properties={...metadata,$exception_list:[clean],$exception_level:clean.mechanism.handled?'error':'fatal',$process_person_profile:false,server_error_source:source,route:route(props.route)};
 if(code)properties.error_code=code;
 if(METHODS.has(props.method))properties.method=props.method;
 if(Number.isInteger(props.status_code)&&props.status_code>=500&&props.status_code<=599)properties.status_code=props.status_code;
 return {event:'$exception',distinctId:DISTINCT_ID,disableGeoip:true,properties};
}

export function createServerTelemetry({env=process.env,clientFactory=(key,options)=>new PostHog(key,options),now=Date.now,sourceRoot=SOURCE_ROOT}={}){
 let host='';
 try{const url=new URL(env.POSTHOG_HOST||'https://us.i.posthog.com');if(url.protocol==='https:'&&!url.username&&!url.password)host=url.origin}catch{}
 const publicKey=posthogPublicKey(env.POSTHOG_PUBLIC_KEY);
 const enabled=env.POSTHOG_SERVER_ERRORS==='true'&&!!publicKey&&!!host;
 if(!enabled)return {enabled:false,capture(){return false},shutdown:async()=>{}};
 const metadata=safeMetadata(env),seen=new WeakSet();
 let client;
 try{client=clientFactory(publicKey,{
  host,enableExceptionAutocapture:false,enableLocalEvaluation:false,readPostHogCookie:false,disableGeoip:true,
  flushAt:5,flushInterval:5000,maxQueueSize:40,requestTimeout:1000,fetchRetryCount:0,
  before_send:event=>sanitiseServerEvent(event,{metadata,sourceRoot}),
 })}catch{return {enabled:false,capture(){return false},shutdown:async()=>{}}}
 let windowStart=now(),count=0,fatalCaptured=false,closed=false,shutdownPromise;
 return {
  enabled:true,
  capture(error,{source='request',path,method,status}={}){
   if(closed)return false;
   const errorSource=SOURCES.has(source)?source:'request',fatal=FATAL_SOURCES.has(errorSource);
   // Preserve one process-fatal report even after a handled-error burst or when
   // that Error was already reported from a request. Further fatal signals are
   // coalesced for this process, independently of the per-minute handled limit.
   if(fatal?fatalCaptured:error&&typeof error==='object'&&seen.has(error))return false;
   const time=now();if(time-windowStart>=60000){windowStart=time;count=0}
   if(!fatal&&count>=MAX_EVENTS_PER_MINUTE)return false;
   try{
    const safe=sanitiseServerException(error,{sourceRoot}),code=errorCode(safe);
    client.captureException(safe,DISTINCT_ID,{...metadata,$process_person_profile:false,server_error_source:errorSource,route:route(path),...(METHODS.has(method)?{method}:{}),...(Number.isInteger(status)&&status>=500&&status<=599?{status_code:status}:{}),...(code?{error_code:code}:{})});
    if(error&&typeof error==='object')seen.add(error);
    if(fatal)fatalCaptured=true;else count++;
    return true;
   }catch{return false}
  },
  shutdown(){
   if(shutdownPromise)return shutdownPromise;
   closed=true;
   shutdownPromise=new Promise(resolve=>{
    const timer=setTimeout(resolve,SHUTDOWN_TIMEOUT_MS);
    Promise.resolve().then(()=>client.shutdown(SHUTDOWN_TIMEOUT_MS-100)).catch(()=>{}).finally(()=>{clearTimeout(timer);resolve()});
   });
   return shutdownPromise;
  },
 };
}

export function installServerErrorHandlers(telemetry,{processRef=process,stderr=message=>process.stderr.write(message)}={}){
 let failing=false,fatalPromise;
 const fatal=(error,source='uncaught_exception')=>{
  if(failing)return fatalPromise;
  failing=true;
  // A second fatal error must not turn a failed process into a healthy one.
  processRef.exitCode=1;
  const deadline=setTimeout(()=>processRef.exit(1),SHUTDOWN_TIMEOUT_MS+100);
  try{stderr('SOFACET stopped after a server error.\n')}catch{}
  try{telemetry.capture(error,{source})}catch{}
  fatalPromise=Promise.resolve().then(()=>telemetry.shutdown()).catch(()=>{}).finally(()=>{clearTimeout(deadline);processRef.exit(1)});
  return fatalPromise;
 };
 const uncaught=error=>fatal(error,'uncaught_exception'),rejected=error=>fatal(error,'unhandled_rejection');
 if(telemetry.enabled){processRef.on('uncaughtException',uncaught);processRef.on('unhandledRejection',rejected)}
 return {
  fatal,
  dispose(){if(telemetry.enabled){processRef.removeListener('uncaughtException',uncaught);processRef.removeListener('unhandledRejection',rejected)}},
 };
}
