import test from 'node:test';
import assert from 'node:assert/strict';
import {installConsentTransport} from '../analytics-source/consent-transport.js';
function fixture(){
 const sent=[],queue={_queue:[],get length(){return this._queue.length},retriableRequest(options){sent.push(options)},_enqueue(options){this._queue.push({requestOptions:options})}};
 const instance={_retryQueue:queue,__request_queue:[]};let allowed=true,recording=true;
 const install=()=>installConsentTransport(instance,()=>allowed,()=>recording);
 return {sent,queue,instance,install,analytics:value=>allowed=value,recording:value=>recording=value};
}
const event=control=>({url:'https://posthog.test/e/',data:{event:'ui_click',properties:{control}}});
const replay=()=>({url:'https://posthog.test/s/',data:{event:'$snapshot',properties:{$snapshot_data:[]}}});
test('an unsupported SDK queue fails closed rather than silently omitting consent enforcement',()=>{
 assert.throws(()=>installConsentTransport({},()=>true,()=>true),/Unsupported PostHog consent transport/);
});
test('the pinned published browser distribution aliases receive the same dispatch/enqueue and purge guards',()=>{
 const sent=[],queue={Sc:[],get length(){return this.Sc.length},retriableRequest(options){sent.push(options)},js(options){this.Sc.push({requestOptions:options})}};
 const guard=installConsentTransport({ad:queue},()=>true,()=>true);queue.retriableRequest(replay());queue.js(sent[0]);assert.equal(queue.length,1);guard.stop();assert.equal(queue.length,0);queue.js(sent[0]);queue.retriableRequest(sent[0]);assert.equal(queue.length,0);assert.equal(sent.length,1);
});
test('recording revoke discards only replay requests and analytics can continue',()=>{
 const f=fixture(),guard=f.install();f.queue.retriableRequest(event('play'));f.queue.retriableRequest(replay());
 for(const options of f.sent)f.queue._enqueue(options);
 f.recording(false);guard.revokeRecording();assert.equal(f.queue.length,1);assert.equal(f.queue._queue[0].requestOptions.data.event,'ui_click');
 f.queue.retriableRequest(replay());assert.equal(f.sent.length,2);f.queue.retriableRequest(event('pause'));assert.equal(f.sent.length,3);
});
test('stale queued and in-flight requests cannot requeue or dispatch after revoke and regrant',()=>{
 const f=fixture(),first=f.install();f.queue.retriableRequest(event('old'));const old=f.sent[0];f.queue._enqueue(old);
 first.stop();assert.equal(f.queue.length,0);f.queue.retriableRequest(old);f.queue._enqueue(old);assert.equal(f.sent.length,1);assert.equal(f.queue.length,0);
 f.install();f.queue._enqueue(old);f.queue.retriableRequest(old);assert.equal(f.sent.length,1);assert.equal(f.queue.length,0);
 f.queue.retriableRequest(event('new'));assert.equal(f.sent.length,2);f.queue._enqueue(f.sent[1]);assert.equal(f.queue.length,1);
});
test('emptying the queue cancels polling without using unload or beacons',()=>{
 const f=fixture(),guard=f.install();f.queue._poller=setTimeout(()=>assert.fail('Stopped queue polled'),10000);f.queue._isPolling=true;
 f.queue.unload=()=>assert.fail('unload sends beacons');guard.stop();assert.equal(f.queue._poller,undefined);assert.equal(f.queue._isPolling,false);
});
