import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {apiOutcome,apiFailure} from '../shared/analytics.js';
import {installAnalytics} from '../analytics-source/runtime.js';

const settled=()=>new Promise(resolve=>setImmediate(resolve));
async function withAnalytics(api,check){
 const before=globalThis.window;
 const win={sofacetAnalytics:api};win.top=win;globalThis.window=win;
 try{await check()}finally{if(before===undefined)delete globalThis.window;else globalThis.window=before}
}

test('confirmed account and signup actions record the method actually used',async()=>{
 const calls=[];
 await withAnalytics({track:(name,properties)=>calls.push({name,properties}),refreshIdentity(){},resetIdentity(){}},()=>{
  apiOutcome('/api/account/otp/request',200,{success:true,challengeId:'private-challenge',expiresIn:300},5);
  apiOutcome('/api/account/otp/verify',200,{verified:true},5);
  apiOutcome('/api/membership/otp/verify',200,{verified:true,verificationToken:'private-token'},5);
  apiOutcome('/api/membership',200,{success:true,player:{member:true,email:'private@example.com'},savedPoints:0,pointsSaved:false},5);
  apiOutcome('/api/first-cuts',200,{success:true},5);
  apiOutcome('/api/account/details',200,{success:true},5);
  apiOutcome('/api/account/signout',200,{success:true},5);
  apiOutcome('/api/membership/rewards',200,{success:true,pointsSaved:true,savedPoints:50},5);
 });
 assert.deepEqual(calls.filter(x=>x.name!=='api_request'),[
  {name:'otp_requested',properties:{method:'phone_otp',flow:'signin'}},
  {name:'login',properties:{method:'phone_otp',flow:'signin'}},
  {name:'otp_verified',properties:{method:'phone_otp',flow:'signup'}},
  {name:'sign_up',properties:{method:'phone_otp',flow:'signup'}},
  {name:'first_cuts_registered',properties:{method:'form',flow:'signup'}},
  {name:'profile_updated',properties:{method:'form',flow:'account'}},
  {name:'logout',properties:{method:'button',flow:'account'}},
  {name:'reward_saved',properties:{points:50}},
 ]);
 assert.doesNotMatch(JSON.stringify(calls),/private|email/);
});

test('unsuccessful or incomplete mutation payloads never produce success or reward events',async()=>{
 const calls=[];
 await withAnalytics({track:(name,properties)=>calls.push({name,properties}),refreshIdentity(){},resetIdentity(){}},()=>{
  apiOutcome('/api/membership',200,{success:false},5);
  apiOutcome('/api/membership',200,{success:true,player:{member:true},savedPoints:-1},5);
  apiOutcome('/api/membership/otp/request',200,{success:true,challengeId:'challenge'},5);
  apiOutcome('/api/membership/otp/verify',200,{verified:true},5);
  apiOutcome('/api/membership/rewards',200,{success:true,pointsSaved:false,savedPoints:0},5);
  apiOutcome('/api/account/session',200,{},5);
  apiOutcome('/api/first-cuts',500,{success:true},5);
 });
 assert.equal(calls.length,7);
 assert.ok(calls.every(x=>x.name==='api_request'&&x.properties.outcome==='failure'));
});

test('session loss clears identity while invalid OTPs and temporary failures preserve it',async()=>{
 let resets=0,refreshes=0;
 await withAnalytics({track(){},captureError(){},resetIdentity(){resets++},refreshIdentity(){refreshes++}},()=>{
  apiFailure('/api/account/otp/verify',{status:401,code:'invalid_otp'},5);
  apiFailure('/api/membership/otp/verify',{status:401,code:'invalid_token'},5);
  apiFailure('/api/account',{status:503},5);
  assert.equal(resets,0);
  apiOutcome('/api/account/session',200,{signedIn:true,expiresIn:1000},5);
  assert.equal(refreshes,1);
  apiOutcome('/api/account/session',200,{signedIn:false,expiresIn:null},5);
  assert.equal(resets,1);
  apiFailure('/api/membership/rewards',{status:401,code:'rewards_verification_required'},5);
  apiFailure('/api/account',{status:503,code:'invalid_token'},5);
  assert.equal(resets,3);
 });
});

test('an identity response started before a rejected session cannot restore the old user',async()=>{
 const calls=[],userId='user_'+'a'.repeat(64);
 let release,hold=false;
 const provider=()=>({track(){},identify:id=>calls.push(id),reset:()=>calls.push(null),stop(){},clearIdentity:()=>calls.push(null)});
 const win={location:new URL('https://site.test/my-coins'),document:{addEventListener(){}},history:{pushState(){},replaceState(){}},addEventListener(){},
  sofacetCookiePreferences:{allows:()=>true},fetch:async path=>{
   if(path==='/api/analytics-config')return {ok:true,json:async()=>({enabled:true,gaId:'G-TEST',posthogKey:'phc_test'})};
   if(hold)await new Promise(resolve=>release=resolve);
   return {ok:true,json:async()=>({userId})};
  }};
 win.top=win;
 const api=installAnalytics(win,{loadGoogle:async()=>provider(),loadPosthog:async()=>provider()});
 await settled();hold=true;
 const pending=api.refreshIdentity();
 await withAnalytics(api,()=>apiFailure('/api/account',{status:401,code:'rewards_verification_required'},5));
 const afterReset=calls.length;
 release();await pending;
 assert.deepEqual(calls.slice(-2),[null,null]);
 assert.equal(calls.length,afterReset);
});

test('the join shell clears identity when its expiry poll discovers a signed-out session',async()=>{
 const code=await readFile(new URL('../assets/site-join.js',import.meta.url),'utf8');
 const attributes=new Map(),timers=[],events={},calls=[];
 let session={signedIn:true,expiresIn:1000};
 const win={addEventListener:(name,fn)=>events[name]=fn,sofacetAnalytics:{track:(name,props)=>calls.push({name,...props}),refreshIdentity:()=>calls.push({name:'refresh'}),resetIdentity:()=>calls.push({name:'reset'})}};
 runInNewContext(code,{window:win,document:{documentElement:{toggleAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name)}},location:{pathname:'/notify',origin:'https://site.test'},
  AbortController,Date,Number,Error,fetch:async()=>({ok:true,status:200,json:async()=>session}),setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length},clearTimeout(){}});
 await settled();
 assert.equal(timers[0].delay,1000);assert.equal(calls.at(-1).name,'refresh');
 session={signedIn:false,expiresIn:null};await timers[0].fn();
 assert.equal(calls.at(-1).name,'reset');assert.equal(attributes.get('data-signed-in'),false);assert.equal(attributes.get('data-signed-out'),true);
 assert.deepEqual(calls.filter(x=>x.name==='api_request').map(x=>[x.endpoint,x.outcome]),[['/api/account/session','success'],['/api/account/session','success']]);
});
