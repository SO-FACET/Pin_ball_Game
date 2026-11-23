import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build,transform} from 'esbuild-wasm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {leaveCopy} from '../game-source/src/player-copy.ts';
import {rewardFromPoints} from '../shared/reward-value.js';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../game-source/src/score-page.jsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require});
const {ScorePage}=module.exports;
const result=points=>({points,rewardValue:points/10,completedAt:123,gameId:'verified-game-reference',status:'completed'});
function elements(node){return React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[]}

test('React score screen uses the game result and preserves exact rupee conversion',()=>{
 const html=renderToStaticMarkup(React.createElement(ScorePage,{result:result(3205)}));
 assert.match(html,/id="rewards-points">3,205<\//);assert.match(html.replace(/<[^>]+>/g,''),/₹320\.5 off/);
 assert.match(html,/SO\/ COINS/);assert.doesNotMatch(html,/>pts</);
 assert.match(html,/id="rewards-register"/);assert.match(html.replace(/<[^>]+>/g,''),/SAVE MY SO\/ COINS/);assert.match(html,/id="rewards-leaderboard"/);
 assert.doesNotMatch(html,/site-join-button|JOIN THE SO\/ COLLECTIVE/);
 assert.doesNotMatch(html,/<nav|<header|4,800|₹480|href="#"/);
});
test('zero and low scores retain replay without offering to save unredeemable points',()=>{
 for(const points of [0,9]){
  const html=renderToStaticMarkup(React.createElement(ScorePage,{result:result(points)}));
  assert.match(html,/Not much to keep yet/);assert.doesNotMatch(html,/id="rewards-register"|id="rewards-expiry"/);
  assert.match(html,/id="rewards-retry"/);assert.match(html,/id="rewards-low-copy"/);
 }
});
test('score sharing sends every destination to the primary launch domain',async()=>{
 const shareBundle=await build({entryPoints:[fileURLToPath(new URL('../shared/ShareScoreDialog.jsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
 const shareModule={exports:{}};vm.runInNewContext(shareBundle.outputFiles[0].text,{module:shareModule,exports:shareModule.exports,require});
 const html=renderToStaticMarkup(React.createElement(shareModule.exports.default,{score:3205,dialogRef:{current:null}}));
 const destinations=[...html.matchAll(/href="([^"]+)"/g)].map(([,href])=>href.replaceAll('&amp;','&')).filter(href=>/^https:\/\/(wa\.me|t\.me|x\.com|mail\.google\.com)\//.test(href));
 assert.equal(destinations.length,4);
 for(const href of destinations)assert.ok(decodeURIComponent(href).includes('https://sofacet.com/game'),href);
 assert.match(html,/sofacet\.com\/game/);assert.doesNotMatch(html,/shopsofacet\.com/);
});
test('the three React actions invoke their existing callbacks once',()=>{
 const calls=[],props={result:result(4800),onSave:()=>calls.push('save'),onReplay:()=>calls.push('replay'),onLeaderboard:()=>calls.push('leaderboard')};
 const nodes=elements(ScorePage(props));
 for(const id of ['rewards-register','rewards-retry','rewards-leaderboard'])nodes.find(node=>node.props.id===id).props.onClick();
 assert.deepEqual(calls,['save','replay','leaderboard']);
});

async function controllerFixture(member=false){
 const nodes=new Map(),events=new Map(),captured={},analytics=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,hidden:false,open:false,dataset:{},style:{setProperty(){}},offsetTop:1,offsetHeight:1,
   setAttribute(key,value){this[key]=value},getAttribute(key){return this[key]},focus(){captured.focused=id},prepend(){},querySelector:selector=>node(id+selector),
   addEventListener(type,fn){this[type+'Listener']=fn},showModal(){this.open=true},close(){this.open=false;this.closeListener?.()},click(){this.onclick?.()}});
  return nodes.get(id);
 };
 const source=readFileSync(new URL('../game-source/src/post-game-rewards.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const compiled=await transform(source,{loader:'ts',format:'cjs'}),exports={};
 const context={exports,module:{exports},Date,Math,Number,URL,Element:class{},location:{origin:'http://test.local',href:'http://test.local/play.html'},
  document:{getElementById:node,querySelector:()=>node('header'),body:{prepend(){}},addEventListener:(key,fn)=>events.set(key,fn)},
  setScreenRoute:route=>{captured.route=route},writeScreenData:(key,value)=>{captured[key+'Storage']=value},ResizeObserver:class{observe(){}disconnect(){}},addEventListener:(key,fn)=>events.set(key,fn),leaveCopy,rewardFromPoints,track:(name,properties)=>analytics.push({name,properties}),
  mountRewardNoticeArtwork:()=>()=>{},mountScorePage:(_container,actions)=>{captured.actions=actions;return {render:(value,member,popup)=>{captured.result=value;captured.member=member;captured.popup=popup;captured.scoreVisible=true},clear:()=>{captured.scoreVisible=false}}},window:{addEventListener(){},top:{addEventListener:(key,fn)=>events.set(key,fn),removeEventListener(){},history:{state:{}},location:{pathname:'/game',assign:value=>{captured.destination=value}}}},
 };
 vm.runInNewContext(compiled.code,context);
 const registered=[],openers=[],replays=[],boards=[];
 const controller=context.module.exports.connectPostGameRewards((value,opener)=>{registered.push(value);openers.push(opener.id)},()=>replays.push(true),()=>boards.push(true),()=>member);
 return {controller,node,captured,registered,openers,replays,boards,events,analytics,element:context.Element};
}
test('score controller passes the immutable completed result and game ID into registration',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(3205,'real-game-id');
 assert.equal(fixture.captured.result.points,3205);assert.equal(fixture.captured.result.rewardValue,320.5);assert.equal(Object.isFrozen(fixture.captured.result),true);
 fixture.captured.actions.onSave();assert.equal(fixture.registered[0],fixture.captured.result);assert.equal(fixture.registered[0].gameId,'real-game-id');assert.equal(fixture.openers[0],'rewards-register');
 assert.equal(fixture.controller.result.points,3205);assert.equal(fixture.captured.destination,undefined);
});
test('the score heading receives focus after its styles finish loading without interrupting an open menu',async()=>{
 const f=await controllerFixture();f.controller.show(200);f.captured.focused=null;
 f.controller.dialog['sofacet:page-readyListener']();assert.equal(f.captured.focused,'rewards-resulth1');
 f.node('nav-toggle').setAttribute('aria-expanded','true');f.captured.focused=null;
 f.controller.dialog['sofacet:page-readyListener']();assert.equal(f.captured.focused,null);
});
test('the leave warning opens Claim or discards the reward and opens Notify',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(4800,'game');
 const escape=()=>fixture.controller.dialog.oncancel({preventDefault(){}});
 fixture.captured.actions.onLeaderboard();assert.equal(fixture.boards.length,1);
 assert.equal(fixture.captured.popup,false);escape();assert.equal(fixture.captured.popup,true);assert.equal(fixture.captured.scoreVisible,true);
 escape();assert.equal(fixture.controller.dialog.dataset.view,'result');assert.equal(fixture.captured.scoreVisible,true);
 escape();fixture.node('rewards-keep').click();assert.equal(fixture.registered[0].points,4800);assert.equal(fixture.openers[0],'save-coins-login');
 fixture.controller.show();escape();fixture.node('rewards-leave-anyway').click();assert.equal(fixture.captured.destination,'/notify');assert.equal(fixture.captured.rewardStorage,null);
 fixture.controller.clear();fixture.controller.show(9);escape();assert.equal(fixture.captured.destination,'/');
});

test('internal game pages can open over the score without treating it as discarded',async()=>{
 const f=await controllerFixture();f.controller.show(3205,'completed-game');
 const link={id:'about-link',target:'_top',hasAttribute:name=>name==='data-game-info'};
 let prevented=false;
 f.events.get('click')({button:0,target:Object.assign(Object.create(f.element.prototype),{closest:()=>link}),preventDefault(){prevented=true;}});
 assert.equal(prevented,false);
 assert.equal(f.controller.result.points,3205);
 assert.equal(f.controller.dialog.dataset.view,'result');
});

test('explicit reward exit records one discard while programmatic clearing and low scores do not',async()=>{
 const f=await controllerFixture();f.controller.show(3205,'completed-game');
 f.node('rewards-leave-anyway').click();f.node('rewards-leave-anyway').click();
 assert.deepEqual(f.analytics.map(event=>event.name),['reward_discarded']);
 assert.equal(f.captured.destination,'/notify');
 f.controller.clear();f.controller.show(3205);f.controller.discard();
 assert.equal(f.analytics.length,1,'AuthFlow already records the discard before sending its message');
 f.controller.clear();f.controller.show(9);f.node('rewards-leave-anyway').click();
 assert.equal(f.analytics.length,1,'unredeemable scores are not counted as rewards lost');
});

test('exit popup is opt-in and Maybe Later delegates to the launch action',()=>{
 const base={result:result(3205),onSave(){}};
 assert.ok(!elements(ScorePage(base)).some(n=>n.props.id==='save-coins-modal'));
 let later=0;const popup=elements(ScorePage({...base,showPopup:true,onMaybeLater:()=>later++}));
 popup.find(n=>n.props.id==='save-coins-later').props.onClick();assert.equal(later,1);
 assert.ok(!elements(ScorePage({...base,isMember:true,showPopup:true})).some(n=>n.props.id==='save-coins-modal'));
});
test('browser Back shows the nudge and Maybe Later discards only the pending score',async()=>{
 const f=await controllerFixture();f.controller.show(3205,'game');let stopped=false;
 f.events.get('popstate')({stopImmediatePropagation(){stopped=true}});
 assert.equal(stopped,true);assert.equal(f.captured.popup,true);
 f.captured.actions.onMaybeLater();assert.equal(f.captured.destination,'/notify');assert.equal(f.captured.rewardStorage,null);
 assert.equal(f.controller.result,null);
});
test('browser close requests a native warning only for unsaved redeemable scores',async()=>{
 const f=await controllerFixture();let warnings=0;
 const event=()=>({preventDefault(){warnings++},returnValue:undefined});
 f.events.get('beforeunload')(event());assert.equal(warnings,0);
 f.controller.show(3205,'game');f.events.get('beforeunload')(event());assert.equal(warnings,1);
 f.controller.discard();f.events.get('beforeunload')(event());assert.equal(warnings,1);
});

test('members never get the save-coins exit nudge',async()=>{
 const f=await controllerFixture(true);f.controller.show(3205,'game');
 f.events.get('popstate')({stopImmediatePropagation(){assert.fail('member navigation should not be intercepted')}});
 assert.equal(f.captured.popup,false);
 let warnings=0;f.events.get('beforeunload')({preventDefault(){warnings++}});assert.equal(warnings,0);
});
