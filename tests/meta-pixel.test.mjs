import test from 'node:test';
import assert from 'node:assert/strict';
import {installMetaPixel} from '../analytics-source/meta-pixel.js';
import {analyticsConfig} from '../analytics-config.mjs';
function setup({allowed=false,embedded=false,enabled=true}={}){
 const handlers={},scripts=[],calls=[];let choice=allowed;
 const win={location:new URL('https://sofacet.com/game'),document:{head:{append:s=>scripts.push(s)},createElement:()=>({remove(){}}),cookie:''},
 history:{pushState(s,t,url){win.location=new URL(url,win.location)},replaceState(s,t,url){win.location=new URL(url,win.location)}},
 addEventListener:(n,fn)=>handlers[n]=fn,sofacetCookiePreferences:{allows:category=>category==='advertising'&&choice},
 fetch:async()=>({ok:true,json:async()=>({metaPixelEnabled:enabled,metaPixelId:'1139720465654244'})})};
 win.top=embedded?{}:win;
 installMetaPixel(win);
 return {win,scripts,calls,handlers,change(value){choice=value;handlers['sofacet:cookie-preferences']()},load(){win.fbq.callMethod=(...args)=>calls.push(args);scripts[0].onload()}};
}
const settle=()=>new Promise(r=>setImmediate(r));
const views=s=>s.calls.filter(c=>c[0]==='trackSingle');
test('no Meta request before Advertising consent; Analytics alone is insufficient',async()=>{const s=setup();await settle();assert.equal(s.scripts.length,0);assert.equal(s.win.fbq,undefined);s.change(true);assert.equal(s.scripts.length,1);s.load();assert.equal(views(s).length,1)});
test('initialization and pageviews dedupe, navigation still works',async()=>{const s=setup({allowed:true});await settle();s.load();s.change(true);s.win.history.replaceState({},'', '/game?from=home');assert.equal(views(s).length,1);s.win.history.pushState({},'', '/about');assert.equal(views(s).length,2);assert.equal(s.calls.filter(c=>c[0]==='init').length,1)});
test('withdrawal stops events and regrant only records the current page',async()=>{const s=setup({allowed:true});await settle();s.load();s.change(false);s.win.history.pushState({},'', '/about');assert.equal(views(s).length,1);assert.ok(s.calls.some(c=>c[0]==='consent'&&c[1]==='revoke'));s.change(true);assert.equal(views(s).length,2);assert.equal(s.scripts.length,1)});
test('withdrawal while loading cannot replay a queued pageview',async()=>{const s=setup({allowed:true});await settle();s.change(false);s.load();assert.equal(views(s).length,0);assert.equal(s.calls.filter(c=>c[0]==='init').length,0)});
test('embedded game does not install a second pixel',async()=>{const s=setup({allowed:true,embedded:true});await settle();assert.equal(s.scripts.length,0)});
test('disabled configuration never loads the SDK',async()=>{const s=setup({allowed:true,enabled:false});await settle();assert.equal(s.scripts.length,0)});
test('sensitive URL parameters never fire pageviews',async()=>{const s=setup({allowed:true});s.win.location=new URL('https://sofacet.com/verify?token=secret');await settle();s.load();assert.equal(views(s).length,0)});
test('public config requires explicit opt-in and a valid pixel ID',()=>{assert.equal(analyticsConfig({META_PIXEL_ENABLED:'true',META_PIXEL_ID:'1139720465654244'}).metaPixelEnabled,true);assert.equal(analyticsConfig({META_PIXEL_ID:'1139720465654244'}).metaPixelId,'');assert.equal(analyticsConfig({META_PIXEL_ENABLED:'true',META_PIXEL_ID:'invalid'}).metaPixelEnabled,false)});
test('ViewContent and Lead remain independent of Analytics and reject personal properties',async()=>{
 const s=setup({allowed:true});await settle();s.load();
 s.win.sofacetMetaPixel.track('ViewContent',{email:'private@example.com'},'ready:1');
 s.win.sofacetMetaPixel.track('ViewContent',{},'ready:1');
 s.win.sofacetMetaPixel.track('Lead',{form_type:'login',phone:'private'});
 assert.equal(s.calls.filter(c=>c[2]==='ViewContent').length,1);
 assert.deepEqual(s.calls.find(c=>c[2]==='Lead')[3],{form_type:'login'});
 assert.ok(!JSON.stringify(s.calls).includes('private'));
});
test('custom click events use custom tracking and only the approved names',async()=>{
 const s=setup({allowed:true});await settle();s.load();
 s.win.sofacetMetaPixel.track('JoinCollectiveClick');s.win.sofacetMetaPixel.track('LoginClick');s.win.sofacetMetaPixel.track('Unknown');
 assert.equal(s.calls.filter(c=>c[0]==='trackSingleCustom').length,2);
 assert.ok(!s.calls.some(c=>c[2]==='Unknown'));
});
test('new events are never replayed after consent withdrawal during SDK loading',async()=>{
 const s=setup({allowed:true});await settle();s.win.sofacetMetaPixel.track('Lead',{form_type:'login'});s.change(false);s.load();s.change(true);
 assert.ok(!s.calls.some(c=>c[2]==='Lead'));
});
test('consented events during SDK loading are sent once after the initial pageview',async()=>{
 const s=setup({allowed:true});await settle();s.win.sofacetMetaPixel.track('ViewContent',{},'ready:1');s.load();
 assert.deepEqual(s.calls.filter(c=>c[0]==='trackSingle').map(c=>c[2]),['PageView','ViewContent']);
});
test('all public page changes generate PageView without duplicate history notifications',async()=>{
 const s=setup({allowed:true});await settle();s.load();
 for(const path of ['/about','/join','/sign-in','/leaderboard','/privacy']){s.win.history.pushState({},'',path);s.handlers.popstate()}
 assert.equal(s.calls.filter(c=>c[2]==='PageView').length,6);
});
