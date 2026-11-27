import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareJourney} from '../entrance-source/prepare-journey.mjs';

test('a failed preferred decoder is disposed before native HD is created',async()=>{
 const calls=[];let attempt=0;
 const renderer=await prepareJourney({video:true,create:async options=>{
  const index=attempt++;calls.push(['create',options.option,options.forceNative]);
  return {loadVariant:async()=>{if(index===0)throw Error('Decoder failed')},dispose(){calls.push(['dispose',index])}};
 }});
 assert.ok(renderer);assert.deepEqual(calls,[['create',undefined,undefined],['dispose',0],['create','2',true]]);
});

test('a first-frame paint failure also retries using native HD',async()=>{
 let disposed=0,created=0;
 await prepareJourney({video:true,create:async()=>({id:created++,loadVariant:async()=>{},dispose(){disposed++}}),prepare:async renderer=>{if(renderer.id===0)throw Error('No first frame')}});
 assert.equal(created,2);assert.equal(disposed,1);
});

test('errors while preparing belong to the preparation attempt, and ready errors reach recovery',async()=>{
 let callback,recovered=0;
 await prepareJourney({video:true,options:{onError:()=>recovered++},create:async options=>{callback=options.onError;return {loadVariant:async()=>{callback(Error('Loading'))},dispose(){}}}});
 assert.equal(recovered,0);callback(Error('Seek failed'));assert.equal(recovered,1);
});

test('native-only retry and aborts are bounded and dispose failed resources',async()=>{
 let created=0,disposed=0;
 const create=async()=>{created++;return {loadVariant:async()=>{throw Error('Unavailable')},dispose(){disposed++}}};
 await assert.rejects(prepareJourney({video:true,nativeOnly:true,create}),/Unavailable/);assert.equal(created,1);assert.equal(disposed,1);
 created=0;await assert.rejects(prepareJourney({video:true,create:async()=>{created++;throw new DOMException('Stopped','AbortError')}}),{name:'AbortError'});assert.equal(created,1);
});

test('failed HD preparation surfaces the error without a game handoff',async()=>{
 let created=0,disposed=0;
 await assert.rejects(prepareJourney({video:true,create:async()=>{created++;return {loadVariant:async()=>{throw Error('No media')},dispose(){disposed++}}}}),/No media/);
 assert.equal(created,2);assert.equal(disposed,2);
});

test('leaving for the game cancels an in-progress decoder and does not start HD',async()=>{
 const controller=new AbortController();let created=0,disposed=0,reject;
 const loading=prepareJourney({video:true,signal:controller.signal,create:async()=>{created++;return {loadVariant:()=>new Promise((_resolve,no)=>{reject=no}),dispose(){disposed++;reject(new DOMException('Stopped','AbortError'))}}}});
 await new Promise(resolve=>setImmediate(resolve));controller.abort(new DOMException('Game chosen','AbortError'));
 await assert.rejects(loading,{name:'AbortError'});assert.equal(created,1);assert.equal(disposed,1);
});

test('the active renderer is published while downloading so progress and quality remain observable',async()=>{
 let complete,published;const renderer={loadVariant:()=>new Promise(resolve=>{complete=resolve}),dispose(){}};
 const loading=prepareJourney({create:async()=>renderer,onCreated:value=>{published=value}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(published,renderer);
 complete();assert.equal(await loading,renderer);
});
