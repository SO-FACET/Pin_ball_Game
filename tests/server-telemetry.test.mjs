import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {PostHog} from 'posthog-node';
import {createServerTelemetry,sanitiseServerException,sanitiseServerEvent,installServerErrorHandlers} from '../server-telemetry.mjs';

const root=new URL('../',import.meta.url),sourceRoot='/app/sofacet';
const enabled={POSTHOG_SERVER_ERRORS:'true',POSTHOG_PUBLIC_KEY:'phc_localtest',POSTHOG_HOST:'https://posthog.test',ANALYTICS_ENVIRONMENT:'test',APP_RELEASE:'abcdefabcdefa'};
const settled=()=>new Promise(resolve=>setImmediate(resolve));
const privateData='alice@example.com secret=topsecret otp=123456';
function failure(){
 const error=new TypeError(privateData,{cause:new Error('Bearer hidden-token')});error.code='EACCES';
 error.request={headers:{cookie:'private-cookie'},body:{email:'alice@example.com'}};
 error.stack='TypeError: '+privateData+'\n    at commit (file:///app/sofacet/server.mjs:40:9)\n    at Object.api (file:///app/sofacet/membership-api.mjs:31:4)\n    at readFileSync (node:fs:443:20)\n    at private (/Users/alice/customer-secret.mjs:3:2)';
 return error;
}

function recordedTelemetry(options={}){
 const requests=[];
 const telemetry=createServerTelemetry({env:enabled,sourceRoot,...options,clientFactory:(key,config)=>new PostHog(key,{...config,fetch:async(url,request)=>{
  const headers=new Headers(request.headers),body=headers.get('content-encoding')==='gzip'?gunzipSync(request.body).toString():String(request.body);
  requests.push({url,payload:JSON.parse(body)});
  return {status:200,headers:{},text:async()=>'{"status":1}',json:async()=>({status:1})};
 }})});
 return {telemetry,requests,events:()=>requests.flatMap(request=>request.payload.batch)};
}

test('server monitoring requires its own switch, valid public ingest key and HTTPS host',async()=>{
 let created=0;
 for(const env of [{},{...enabled,POSTHOG_SERVER_ERRORS:'false'},{...enabled,POSTHOG_PUBLIC_KEY:'phx_private-key'},{...enabled,POSTHOG_HOST:'http://posthog.test'},{...enabled,POSTHOG_HOST:'https://user:pass@posthog.test'}]){
  const telemetry=createServerTelemetry({env,clientFactory(){created++}});
  assert.equal(telemetry.enabled,false);assert.equal(telemetry.capture(failure()),false);await telemetry.shutdown();
 }
 assert.equal(created,0);
 const telemetry=createServerTelemetry({env:{...enabled,ANALYTICS_ENABLED:'false'},clientFactory(){created++;return {shutdown:async()=>{}}}});
 assert.equal(telemetry.enabled,true,'operational errors use the explicit server switch independently of browser analytics consent');await telemetry.shutdown();
 assert.equal(created,1);
});

test('exception sanitizer preserves useful original source positions and known codes without messages, causes or customer data',()=>{
 const safe=sanitiseServerException(failure(),{sourceRoot});
 assert.equal(safe.name,'TypeError');assert.equal(safe.code,'EACCES');assert.equal(safe.message,'Unexpected server error (EACCES)');
 assert.match(safe.stack,/server\.mjs:40:9/);assert.match(safe.stack,/membership-api\.mjs:31:4/);assert.match(safe.stack,/node:fs:443:20/);
 assert.doesNotMatch(safe.stack,/alice|topsecret|123456|Bearer|customer-secret|\/Users/);
 assert.equal(safe.cause,undefined);assert.equal(safe.request,undefined);
 const hostile={get name(){throw Error('private')},get code(){throw Error('private')},get stack(){throw Error('private')}};
 assert.equal(sanitiseServerException(hostile).message,'Unexpected server error');
 assert.equal(sanitiseServerException({code:'SECRET_TOKEN',name:'PrivateCustomer'}).name,'Error');
});

test('final SDK payload is rebuilt from allowed exception fields and excludes automatic request context and source snippets',()=>{
 const event=sanitiseServerEvent({event:'$exception',distinctId:'private-customer',groups:{email:privateData},properties:{
  $set:{email:privateData},$session_id:'private-session',$current_url:'https://site.test?token=private',request:{body:privateData},
  server_error_source:'request',route:'/api/games/customer-secret/finish?otp=123456',method:'POST',status_code:500,error_code:'EACCES',
  $exception_list:[{type:'TypeError',value:privateData,module:privateData,stacktrace:{frames:[{filename:'/app/sofacet/server.mjs',function:'commit',lineno:40,colno:9,context_line:privateData,pre_context:[privateData],post_context:[privateData],vars:{token:privateData},abs_path:'/Users/alice/private'}]}}],
 }},{sourceRoot,metadata:{environment:'test'}});
 assert.equal(event.distinctId,'sofacet-server');assert.equal(event.disableGeoip,true);assert.equal(event.properties.$process_person_profile,false);
 assert.equal(event.properties.route,'/api/games/:id/finish');assert.equal(event.properties.status_code,500);
 assert.deepEqual(event.properties.$exception_list[0].stacktrace.frames,[{platform:'node:javascript',filename:'server.mjs',in_app:true,function:'commit',lineno:40,colno:9}]);
 assert.doesNotMatch(JSON.stringify(event),/alice|topsecret|123456|private|customer-secret|token|cookie|headers|body|context_line|abs_path|\$set|\$session_id/);
 assert.equal(sanitiseServerEvent({event:'$identify',properties:{email:privateData}}),null);
 assert.equal(sanitiseServerEvent({event:'$exception',properties:{$exception_list:'private'}}),null);
 const stream=sanitiseServerEvent({event:'$exception',properties:{route:'/static/:asset',server_error_source:'static_stream',$exception_list:[{type:'Error',stacktrace:{frames:'private'}}]}});
 assert.equal(stream.properties.route,'/static/:asset');assert.equal(stream.properties.$exception_list[0].stacktrace,undefined);
});

test('real PostHog SDK sends sanitized grouped exceptions through a local transport only',async()=>{
 const requests=[];
 const telemetry=createServerTelemetry({env:enabled,sourceRoot,clientFactory:(key,options)=>new PostHog(key,{...options,fetch:async(url,request)=>{
  const headers=new Headers(request.headers),body=headers.get('content-encoding')==='gzip'?gunzipSync(request.body).toString():String(request.body);
  requests.push({url,payload:JSON.parse(body)});
  return {status:200,headers:{},text:async()=>'{"status":1}',json:async()=>({status:1})};
 }})});
 assert.equal(telemetry.capture(failure(),{source:'request',path:'/api/membership?phone=private',method:'POST',status:500,headers:privateData,body:privateData}),true);
 await telemetry.shutdown();
 assert.equal(requests.length,1);assert.ok(requests.every(x=>new URL(x.url).hostname==='posthog.test'));
 const event=requests[0].payload.batch[0];
 assert.equal(event.event,'$exception');assert.equal(event.distinct_id,'sofacet-server');assert.equal(event.properties.route,'/api/membership');
 assert.equal(event.properties.error_code,'EACCES');assert.equal(event.properties.release,'abcdefabcdefa');
 assert.ok(event.properties.$exception_list[0].stacktrace.frames.some(frame=>frame.filename==='server.mjs'&&frame.lineno===40));
 assert.doesNotMatch(JSON.stringify(requests),/alice|topsecret|123456|Bearer|hidden-token|private-cookie|private-customer|context_line|pre_context|post_context|abs_path|customer-secret/);
 assert.equal(event.properties.$session_id,undefined);assert.equal(event.properties.$set,undefined);
});

test('capture deduplicates original errors and caps aggregate bursts while retaining new errors after the minute',async()=>{
 let now=0;const captures=[];
 const telemetry=createServerTelemetry({env:enabled,now:()=>now,clientFactory:()=>({captureException:(...args)=>captures.push(args),shutdown:async()=>{}})});
 const first=failure();assert.equal(telemetry.capture(first),true);assert.equal(telemetry.capture(first),false);
 for(let i=0;i<19;i++)assert.equal(telemetry.capture(new Error('request '+i)),true);
 assert.equal(telemetry.capture(new Error('overflow')),false);assert.equal(captures.length,20);
 now=60000;assert.equal(telemetry.capture(new Error('next minute')),true);
 await telemetry.shutdown();assert.equal(telemetry.capture(new Error('closed')),false);
});

test('real SDK preserves one fatal report beyond the handled cap even for an already reported Error',async()=>{
 for(const source of ['startup','uncaught_exception','unhandled_rejection']){
  let now=0;
  const {telemetry,requests,events}=recordedTelemetry({now:()=>now}),first=failure();
  assert.equal(telemetry.capture(first,{source:'request'}),true);
  for(let i=0;i<19;i++)assert.equal(telemetry.capture(new Error(privateData),{source:'static_stream'}),true);
  assert.equal(telemetry.capture(new Error(privateData),{source:'request'}),false);
  assert.equal(telemetry.capture(first,{source}),true,source+' must retain its fatal report');
  assert.equal(telemetry.capture(first,{source}),false);
  assert.equal(telemetry.capture(new Error(privateData),{source:'uncaught_exception'}),false);
  now=60000;
  assert.equal(telemetry.capture(new Error(privateData),{source:'unhandled_rejection'}),false,'fatal allowance must not reset each minute');
  await telemetry.shutdown();
  assert.equal(events().length,21);
  const fatalEvents=events().filter(event=>event.properties.$exception_level==='fatal');
  assert.equal(fatalEvents.length,1);assert.equal(fatalEvents[0].properties.server_error_source,source);
  assert.equal(fatalEvents[0].properties.$exception_list[0].mechanism.handled,false);
  assert.ok(requests.every(request=>new URL(request.url).hostname==='posthog.test'));
  assert.doesNotMatch(JSON.stringify(requests),/alice|topsecret|123456|Bearer|hidden-token|private-cookie|customer-secret/);
 }
});

test('real SDK coalesces concurrent fatal signals into one report, shutdown and failed exit after handled overflow',async()=>{
 const {telemetry,events}=recordedTelemetry(),first=failure(),fake=new EventEmitter(),exits=[];
 let shutdowns=0;
 fake.exit=code=>exits.push(code);
 assert.equal(telemetry.capture(first,{source:'request'}),true);
 for(let i=0;i<19;i++)assert.equal(telemetry.capture(new Error(privateData)),true);
 const handlers=installServerErrorHandlers({enabled:true,capture:telemetry.capture.bind(telemetry),shutdown(){shutdowns++;return telemetry.shutdown()}},{processRef:fake,stderr(){}});
 try{
  const pending=handlers.fatal(first,'unhandled_rejection');
  assert.equal(pending,handlers.fatal(new Error(privateData),'startup'));
  fake.emit('uncaughtException',first);
  fake.emit('unhandledRejection',new Error(privateData));
  await pending;
  assert.equal(shutdowns,1);assert.equal(fake.exitCode,1);assert.deepEqual(exits,[1]);
  assert.equal(events().length,21);
  assert.deepEqual(events().filter(event=>event.properties.$exception_level==='fatal').map(event=>event.properties.server_error_source),['unhandled_rejection']);
 }finally{handlers.dispose();await telemetry.shutdown()}
});

test('shutdown is idempotent and bounded even if the SDK transport never settles',async()=>{
 let calls=0;
 const telemetry=createServerTelemetry({env:enabled,clientFactory:()=>({captureException(){},shutdown(timeout){calls++;assert.ok(timeout<1500);return new Promise(()=>{})}})});
 const start=Date.now(),first=telemetry.shutdown();assert.equal(first,telemetry.shutdown());await first;
 assert.equal(calls,1);assert.ok(Date.now()-start<1900);
});

test('fatal process handlers deduplicate and preserve exit 1 after bounded shutdown',async()=>{
 const fake=new EventEmitter(),captures=[],logs=[],exits=[];let shutdowns=0;
 fake.exit=code=>exits.push(code);
 const telemetry={enabled:true,capture:(error,context)=>captures.push(context),shutdown:async()=>{shutdowns++}};
 const handlers=installServerErrorHandlers(telemetry,{processRef:fake,stderr:message=>logs.push(message)});
 fake.emit('unhandledRejection',failure());fake.emit('uncaughtException',failure());await settled();await settled();
 assert.equal(fake.exitCode,1);assert.deepEqual(exits,[1]);assert.equal(shutdowns,1);assert.deepEqual(captures,[{source:'unhandled_rejection'}]);
 assert.doesNotMatch(logs.join(''),/alice|topsecret|123456/);handlers.dispose();assert.equal(fake.listenerCount('uncaughtException'),0);
});

test('native unhandled throws and rejections still terminate with exit 1',async()=>{
 for(const trigger of ["setImmediate(()=>{throw Error('private-customer')})","Promise.reject(Error('private-customer'))"]){
  const code=`import {installServerErrorHandlers} from ${JSON.stringify(new URL('../server-telemetry.mjs',import.meta.url).href)};installServerErrorHandlers({enabled:true,capture(){},shutdown:async()=>{}});${trigger}`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data);const [exitCode,signal]=await once(child,'exit');
  assert.equal(exitCode,1);assert.equal(signal,null);assert.doesNotMatch(stderr,/private-customer/);
 }
});

async function withSite({startupFailure=false}={},check){
 const dir=await mkdtemp(join(tmpdir(),'sofacet-server-telemetry-')),captureFile=join(dir,'captured.jsonl');
 if(startupFailure)await writeFile(join(dir,'players.json'),'private-customer invalid JSON');
 const child=spawn(process.execPath,['--import',new URL('./helpers/posthog-transport-fixture.mjs',import.meta.url).href,'server.mjs'],{
  cwd:root,env:{...process.env,...enabled,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,POSTHOG_TEST_CAPTURE_FILE:captureFile,ARTWORK_CDN_BASE_URL:'',REWARDS_API_KEY:'',REWARDS_ADMIN_SECRET:''},stdio:['ignore','pipe','pipe'],
 });
 const exited=once(child,'exit');let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 let startupTimer;
 try{
  const origin=startupFailure?null:await Promise.race([
   new Promise(resolve=>child.stdout.on('data',()=>{const origin=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];if(origin)resolve(origin)})),
   exited.then(()=>{throw Error('Telemetry fixture stopped: '+output)}),new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('Telemetry fixture startup timed out')),10000);startupTimer.unref()}),
  ]);
  await check({dir,origin,child,exited,captureFile,output:()=>output});
 }finally{clearTimeout(startupTimer);if(child.exitCode===null&&!child.signalCode)child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true})}
}

test('HTTP errors keep existing safe 500 responses, known 4xx are excluded and shutdown flushes the actual server SDK',async()=>{
 await withSite({},async({dir,origin,child,exited,captureFile})=>{
  const missing=await fetch(origin+'/api/does-not-exist?email=private-customer');assert.equal(missing.status,404);
  await mkdir(join(dir,'players.json.tmp'));
  const failed=await fetch(origin+'/api/player?token=private-customer');assert.equal(failed.status,500);
  assert.deepEqual(await failed.json(),{message:'The service could not complete this request. Please try again.'});
  child.kill('SIGTERM');const [exitCode]=await exited;assert.equal(exitCode,0);
  const lines=(await readFile(captureFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const events=lines.flatMap(line=>line.payload.batch);assert.equal(events.length,1);
  assert.equal(events[0].properties.route,'/api/player');assert.equal(events[0].properties.server_error_source,'request');assert.equal(events[0].properties.error_code,'EISDIR');
  assert.doesNotMatch(JSON.stringify(events),/private-customer|token|players\.json\.tmp|headers|cookie|body|context_line/);
 });
});

test('startup failures are captured anonymously and remain fatal',async()=>{
 await withSite({startupFailure:true},async({exited,captureFile,output})=>{
  const [exitCode]=await exited;assert.equal(exitCode,1);
  const lines=(await readFile(captureFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const event=lines.flatMap(line=>line.payload.batch)[0];assert.equal(event.properties.server_error_source,'startup');assert.equal(event.properties.$exception_level,'fatal');
  assert.equal(event.properties.$exception_list[0].type,'SyntaxError');assert.doesNotMatch(JSON.stringify(lines)+output(),/private-customer/);
 });
});
