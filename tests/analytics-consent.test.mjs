import test from 'node:test';
import assert from 'node:assert/strict';
import {installAnalytics,cleanProperties} from '../analytics-source/runtime.js';
import {providerLoaders} from '../analytics-source/provider-loaders.js';
import {googleProvider} from '../analytics-source/providers.js';

const settled=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({defer=false,url='https://site.test/privacy?email=private@example.com&otp=012345#secret'}={}){
 const events={},commands=[],scripts=[],imports=[];
 let allowed=true;
 const dataLayer=[];dataLayer.push=function(item){commands.push(Array.from(item));return Array.prototype.push.call(this,item)};
 const document={addEventListener(){},getElementById:id=>scripts.find(script=>script.id===id),createElement:()=>({}),head:{append:script=>scripts.push(script)},cookie:''};
 const win={location:new URL(url),document,dataLayer,addEventListener:(name,callback)=>events[name]=callback,
  history:{pushState(_state,_title,path){win.location=new URL(path,win.location)},replaceState(_state,_title,path){win.location=new URL(path,win.location)}},
  sofacetCookiePreferences:{allows:()=>allowed},
  fetch:async path=>({ok:true,json:async()=>path==='/api/analytics-config'?{enabled:true,gaId:'G-TEST123',posthogKey:''}:{userId:null}}),
 };
 win.top=win;
 const loaders=providerLoaders(win,{importGoogle:()=>defer?new Promise(resolve=>imports.push(resolve)):Promise.resolve({googleProvider}),importPosthog:()=>assert.fail('PostHog must stay disabled')});
 const api=installAnalytics(win,loaders);
 return {win,api,commands,scripts,imports,setConsent(value){allowed=value;events['sofacet:cookie-preferences']()}};
}

test('revoking consent during the real provider import never appends the Google tag or grants storage',async()=>{
 const f=fixture({defer:true});await settled();assert.equal(f.imports.length,1);
 f.api.track('game_started',{online:true});f.setConsent(false);
 f.imports[0]({googleProvider});await settled();
 assert.equal(f.scripts.length,0);assert.deepEqual(f.commands,[]);
 assert.equal(f.api.getStatus().enabled,false);assert.equal(f.api.getStatus().google,false);
});

test('a revoked generation stays inactive after regrant until the new provider import resolves',async()=>{
 const f=fixture({defer:true});await settled();f.api.track('game_started',{online:true});
 f.setConsent(false);f.setConsent(true);f.imports[0]({googleProvider});await settled();
 assert.equal(f.scripts.length,0);assert.deepEqual(f.commands,[]);assert.equal(f.imports.length,2);
 f.imports[1]({googleProvider});await settled();
 assert.equal(f.scripts.length,1);assert.equal(f.api.getStatus().google,true);
 assert.equal(f.commands.filter(command=>command[0]==='event'&&command[1]==='page_view').length,1);
 assert.equal(f.commands.filter(command=>command[0]==='event'&&command[1]==='game_started').length,0,'revoked queued actions never cross into the new choice');
});

test('initial config, route defaults, identity updates and revoke/reconsent omit sensitive URL metadata',async()=>{
 const f=fixture({url:'https://site.test/customer/private@example.com?otp=012345#secret'});await settled();
 assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].referrerPolicy,'no-referrer');
 const initial=f.commands.find(command=>command[0]==='config')[2];
 assert.equal(initial.page_location,'https://site.test/404');assert.equal(initial.page_title,'/404');assert.equal(initial.page_referrer,'');
 f.win.history.pushState({},'','/reward?email=private@example.com&otp=012345#secret');
 let config=f.commands.filter(command=>command[0]==='config').at(-1)[2];
 assert.equal(config.page_location,'https://site.test/reward');assert.equal(config.page_title,'/reward');
 await f.api.refreshIdentity();
 config=f.commands.filter(command=>command[0]==='config').at(-1)[2];assert.equal(config.page_location,'https://site.test/reward');
 f.setConsent(false);f.setConsent(true);await settled();
 assert.equal(f.scripts.length,1,'reconsent reuses the existing tag');
 assert.doesNotMatch(JSON.stringify(f.commands),/private@example|customer\/|012345|#secret|email=/);
 for(const command of f.commands){
  const data=command[0]==='config'?command[2]:command[0]==='set'?command[1]:null;
  if(data){assert.equal(data.page_referrer,'');assert.ok(['/404','/reward'].includes(data.page_title));}
 }
});

test('event property types reject phone, OTP, URL and token-like values while retaining static control names',()=>{
 for(const value of ['012345','919876543210','otp_012345','https://site.test/private','private@example.com','abcdefghijklmnopqrstuvwxyz'])assert.deepEqual(cleanProperties('ui_click',{control:value}),{},value);
 assert.deepEqual(cleanProperties('ui_click',{control:'faq_question_game-and-points-0'}),{control:'faq_question_game-and-points-0'});
 assert.deepEqual(cleanProperties('form_submit',{form:'claim-details-form'}),{form:'claim-details-form'});
 assert.deepEqual(cleanProperties('share',{method:'clipboard'}),{method:'clipboard'});
 assert.deepEqual(cleanProperties('share',{method:'012345'}),{});
 assert.deepEqual(cleanProperties('game_finished',{points:'919876543210',duration_ms:true}),{});
 assert.deepEqual(cleanProperties('navigation_click',{destination:'/customer/private',link_kind:'012345'}),{});
});
