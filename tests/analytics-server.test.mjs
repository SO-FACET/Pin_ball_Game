import test from 'node:test';
import assert from 'node:assert/strict';
import {withRewardsSite,registration,other} from './helpers/rewards-fixture.mjs';
import {routeDocuments} from '../site-routes.js';

test('anonymous analytics identity does not create a player cookie when HMAC correlation is disabled',async()=>{
 const before={...process.env};
 Object.assign(process.env,{ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST'});delete process.env.ANALYTICS_ID_SECRET;
 try{
  await withRewardsSite(async({origin})=>{
   const response=await fetch(origin+'/api/analytics-identity');
   assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await response.json(),{userId:null});
  });
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before)}
});

test('analytics config is public, identity requires a verified session and signout revokes it',async()=>{
 const before={...process.env};
 Object.assign(process.env,{ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST',POSTHOG_PUBLIC_KEY:'phc_test',ANALYTICS_ID_SECRET:'a'.repeat(32)});
 try{
  await withRewardsSite(async({origin,request})=>{
   const response=await fetch(origin+'/api/analytics-config');const config=await response.json();
   assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(config.gaId,'G-TEST');assert.doesNotMatch(JSON.stringify(config),/fixture-partner|aaaaaaa|SECRET|customer/);
   for(const path of Object.keys(routeDocuments)){
    const html=await (await fetch(origin+path)).text();
    assert.equal((html.match(/src="\/assets\/analytics.js/g)||[]).length,1,path);
   }
   assert.equal((await request('/api/analytics-identity')).data.userId,null,'stored profile alone is not a verified session');
   const sent=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber});
   assert.equal(sent.status,200);
   const verified=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,otp:'012345',challengeId:sent.data.challengeId});
   assert.equal(verified.status,200);
   const identity=await request('/api/analytics-identity');assert.match(identity.data.userId,/^user_[a-f0-9]{64}$/);
   assert.doesNotMatch(JSON.stringify(identity.data),/cus_fixture|919876|phone|email/);
   assert.equal((await request('/api/analytics-identity')).data.userId,identity.data.userId);
   assert.equal((await request('/api/analytics-identity',undefined,other)).data.userId,null);
   await request('/api/account/signout',{});
   assert.equal((await request('/api/analytics-identity')).data.userId,null);
  },{returningMember:true});
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before)}
});
