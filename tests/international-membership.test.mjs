import test from 'node:test';
import assert from 'node:assert/strict';
import {normalisePhone} from '../membership-source/src/api.js';
import {normaliseDesignPhone} from '../collective-source/auth-values.js';
import {withRewardsSite,registration,profile} from './helpers/rewards-fixture.mjs';

for(const [number,dial,local] of [
 ['+12025550123','+1','2025550123'],['+442079460018','+44','02079460018'],
 ['+971501234567','+971','0501234567'],['+6581234567','+65','81234567'],
 ['+61412345678','+61','0412345678'],['+919876543210','+91','9876543210'],
]) {
 test(`shared input preserves ${dial} and local formatting`,()=>{
  assert.equal(normalisePhone(number),number);
  assert.equal(normaliseDesignPhone(local,dial),number);
  assert.equal(normaliseDesignPhone(number,dial),number);
 });
 test(`signup and rewards preserve verified identity for ${dial}`,async()=>{
  await withRewardsSite(async({request,events,awards,readStore})=>{
   const start=await request('/api/membership/otp/request',{...registration,phoneNumber:number});
   assert.equal(start.status,200);
   const verified=await request('/api/membership/otp/verify',{phoneNumber:number,challengeId:start.data.challengeId,otp:'012345'});
   assert.equal(verified.status,200);
   const saved=await request('/api/membership',{...profile,phoneNumber:number,verificationToken:verified.data.verificationToken});
   assert.equal(saved.status,200);
   assert.equal(events[0].body.phone,number);
   assert.equal((await readStore()).players['a'.repeat(64)].profile.phone,number);
   assert.equal(awards.size,1);
  },{phoneNumber:number});
 });
 test(`returning member sign-in works for ${dial}`,async()=>{
  await withRewardsSite(async({request,events})=>{
   const start=await request('/api/account/otp/request',{phoneNumber:number});
   assert.equal(start.status,200);
   const verified=await request('/api/account/otp/verify',{phoneNumber:number,challengeId:start.data.challengeId,otp:'012345'});
   assert.equal(verified.status,200);
   assert.equal(events[0].body.phone,number);
   assert.equal((await request('/api/account')).status,200);
  },{phoneNumber:number,returningMember:true});
 });
}
test('invalid numbers never request an OTP',async()=>{
 await withRewardsSite(async({request,events})=>{
  for(const phoneNumber of ['+123','not a phone','+999123456789'])assert.equal((await request('/api/membership/otp/request',{...registration,phoneNumber})).status,400);
  assert.equal(events.length,0);
 });
});
