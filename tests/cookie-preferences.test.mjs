import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
const script=readFileSync(new URL('../assets/cookie-preferences.js',import.meta.url),'utf8');
function boot(record,{blocked=false,path='/'}={}){
 const events={},published=[],root={dataset:{}},CustomEvent=class{constructor(type,options){this.type=type;this.detail=options?.detail}};
 const window={location:{pathname:path},CustomEvent,dispatchEvent(event){published.push(event)},addEventListener(name,fn){events[name]=fn}};window.top=window;
 const document={documentElement:root,readyState:'loading',querySelectorAll:()=>[],addEventListener(){}};
 window.document=document;
 vm.runInNewContext(script,{window,document,Date,Number,JSON,Element:class{},CustomEvent,localStorage:{getItem(){if(blocked)throw Error('Blocked');return record},setItem(key,value){if(blocked)throw Error('Blocked');record=value}}});
 return{api:window.sofacetCookiePreferences,root,events,published,stored:()=>record,replace(value){record=value;events.storage({key:'sofacet-cookie-preferences'})},clear(){record=null;events.storage({key:null})}};
}
test('optional cookies default off for absent, expired, malformed or inaccessible storage',()=>{
 for(const record of [null,'broken','{}',JSON.stringify({version:1,expires:Date.now()-1,analytics:true,advertising:true}),JSON.stringify({version:1,expires:Date.now()+100000,analytics:'true',advertising:true}),JSON.stringify({version:2,expires:Date.now()+100000,analytics:true,advertising:false}),JSON.stringify({version:2,expires:Date.now()+100000,analytics:true,advertising:false,recording:'true'})]){
  const {api}=boot(record);assert.equal(api.allows('essential'),true);assert.equal(api.allows('analytics'),false);assert.equal(api.allows('advertising'),false);assert.equal(api.allows('recording'),false);assert.equal(api.allows('unknown'),false);
 }
 assert.equal(boot(null,{blocked:true}).api.allows('analytics'),false);
});
test('saved preferences are read independently and reset when another tab clears storage',()=>{
 const {api,root,clear}=boot(JSON.stringify({version:1,expires:Date.now()+100000,analytics:true,advertising:false}));
 assert.equal(api.allows('analytics'),true);assert.equal(api.allows('advertising'),false);assert.equal(api.allows('recording'),false);assert.equal(root.dataset.analytics,'true');
 clear();assert.equal(api.allows('analytics'),false);assert.equal(root.dataset.analytics,'false');assert.equal(root.dataset.recording,'false');
});
test('every rebuilt page includes exactly one preferences controller',()=>{
 const html=withGameLoader(withGameLoader('<html><head><meta charset="utf-8"></head><body></body></html>'));
 assert.equal((html.match(/id="cookie-preferences"/g)||[]).length,1);
 assert(html.indexOf('id="cookie-preferences"')<html.indexOf('</head>'));
 assert.equal((html.match(/src="\/assets\/cookie-popup\.js\?v=/g)||[]).length,1);
});

test('the React notice is landing-only and current saved choices suppress it',()=>{
 for(const path of ['/','/index.html','/entrance-3d.html','/video','/about.html','/play.html','/account.html']){
  const {api}=boot(null,{path});let view;api.mount(value=>{view=value});
  assert.equal(view.showNotice,['/','/index.html','/entrance-3d.html','/video'].includes(path),path);
 }
 const {api}=boot(JSON.stringify({version:2,expires:Date.now()+100000,analytics:true,advertising:false,recording:false}));
 let view;api.mount(value=>{view=value});assert.equal(view.showNotice,false);
});

test('older Analytics consent stays valid but never becomes permission to record',()=>{
 const legacy={version:1,expires:Date.now()+100000,analytics:true,advertising:false,recording:true,email:'private@example.invalid'};
 const f=boot(JSON.stringify(legacy));let view;f.api.mount(value=>{view=value});
 assert.equal(f.api.allows('analytics'),true);assert.equal(f.api.allows('recording'),false);
 assert.equal(view.choice.recording,false);assert.equal(view.showNotice,true,'The landing notice offers the new recording choice');
 assert.doesNotMatch(JSON.stringify(f.published),/private@example/,'Only recognized preference fields are published');
 view.save(true,false);assert.equal(f.api.allows('analytics'),true);assert.equal(f.api.allows('recording'),false);assert.equal(view.showNotice,false);
 const saved=JSON.parse(f.stored());assert.equal(saved.version,2);assert.equal(saved.recording,false);
 const again=boot(f.stored());again.api.mount(value=>{view=value});assert.equal(view.showNotice,false,'The explicit new choice is remembered');
 const rejected=boot(JSON.stringify({...legacy,analytics:false}));rejected.api.mount(value=>{view=value});
 assert.equal(view.showNotice,false,'An earlier rejection does not cause another notice');assert.equal(rejected.api.allows('recording'),false);
 const inner=boot(JSON.stringify(legacy),{path:'/game'});inner.api.mount(value=>{view=value});assert.equal(view.showNotice,false,'The new automatic notice remains landing-only');
});

test('recording needs a fresh explicit choice with Analytics and can be changed independently',()=>{
 const f=boot(null);let view;f.api.mount(value=>{view=value});
 view.save(true,false,true);assert.equal(f.api.allows('analytics'),true);assert.equal(f.api.allows('recording'),true);assert.equal(f.root.dataset.recording,'true');
 const restored=boot(f.stored());assert.equal(restored.api.allows('analytics'),true);assert.equal(restored.api.allows('recording'),true);
 view.save(true,false,false);assert.equal(f.api.allows('analytics'),true);assert.equal(f.api.allows('recording'),false);
 view.save(true,false,true);view.save(false,false,true);
 assert.equal(f.api.allows('analytics'),false);assert.equal(f.api.allows('recording'),false);assert.equal(JSON.parse(f.stored()).recording,false);
 view.save('true',false,true);assert.equal(f.api.allows('analytics'),false);assert.equal(f.api.allows('recording'),false,'Truthy strings cannot enable optional collection');
 const choices=f.published.filter(event=>event.type==='sofacet:cookie-preferences').map(event=>event.detail);
 assert.equal(choices.at(-1).recording,false);assert.equal(choices.at(-1).analytics,false);
});

test('cross-tab recording changes and storage clearing update the same consent event',()=>{
 const f=boot(JSON.stringify({version:2,expires:Date.now()+100000,analytics:true,advertising:false,recording:true}));
 assert.equal(f.api.allows('recording'),true);
 f.replace(JSON.stringify({version:2,expires:Date.now()+100000,analytics:true,advertising:false,recording:false}));
 assert.equal(f.api.allows('analytics'),true);assert.equal(f.api.allows('recording'),false);assert.equal(f.root.dataset.recording,'false');
 const choice=f.published.filter(event=>event.type==='sofacet:cookie-preferences').at(-1).detail;
 assert.equal(choice.analytics,true);assert.equal(choice.recording,false);
 f.replace(JSON.stringify({version:2,expires:Date.now()+100000,analytics:false,advertising:false,recording:true}));
 assert.equal(f.api.allows('recording'),false,'Stored recording cannot bypass Analytics');
 f.clear();assert.equal(f.api.allows('analytics'),false);assert.equal(f.api.allows('recording'),false);
});

test('React settings preserve consent, close state, and storage failure feedback',()=>{
 for(const blocked of [false,true]){
  const {api,root}=boot(null,{blocked});let view;api.mount(value=>{view=value});
  api.open();assert.equal(view.settingsOpen,true);assert.equal(view.showNotice,false);assert.equal(root.dataset.cookieSettingsOpen,'true');
  view.save(true,false,true);assert.equal(api.allows('analytics'),true);assert.equal(api.allows('advertising'),false);assert.equal(api.allows('recording'),true);
  assert.equal(view.persisted,!blocked);assert.equal(view.settingsOpen,blocked);
  view.close();assert.equal(view.settingsOpen,false);assert.equal(root.dataset.cookieSettingsOpen,'false');
  api.open();view.save(false,false);assert.equal(api.allows('analytics'),false);assert.equal(api.allows('recording'),false);
 }
});
