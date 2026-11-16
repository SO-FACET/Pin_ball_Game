import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=stripTypeScriptTypes(readFileSync(new URL('../game-source/src/main.ts',import.meta.url),'utf8'));
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));

function game(){
 const events=[],listeners={},documentListeners={},elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,inert:false,textContent:'',style:{},dataset:{},classList:{toggle(){}},setAttribute(){},focus(){}});return elements.get(id)};
 const makePhysics=()=>({active:false,paused:false,state:'launcher',charge:0,lives:3,score:0,launches:0,position:[0,0,0],
  setPaused(value){this.paused=value},pose(){return {...this}},start(){this.active=true;this.paused=false;this.state='launcher';this.launches=0},dispose(){}});
 const physics=makePhysics(),parent={},document={hidden:false,activeElement:null,documentElement:{dataset:{}},addEventListener:(name,fn)=>documentListeners[name]=fn};
 let navigationOpen=false,navigationReads=0,tutorialDone;
 const context={events,loaded:true,physics,starting:false,inspecting:false,infoOpen:false,parentVisible:true,gamePageVisible:true,cookieSettingsOpen:false,
  analyticsGameActivity:undefined,previousUi:[],previousCharge:-1,completedRunRecorded:false,phone:true,highScore:null,holdCharge:false,
  accumulator:0,lastFrame:0,animationFrame:0,resumeAfterInfo:false,resumeAfterMembership:false,
  document,window:{parent,top:{removeEventListener(){}},addEventListener:(name,fn)=>listeners[name]=fn},location:{origin:'https://site.test'},
  addEventListener:(name,fn)=>listeners[name]=fn,cancelAnimationFrame(){},syncLoadingAnimation(){},requestGameFrame(){},restoreScreenRoute(){},
  $:element,chargeFill:element('charge'),chargeMeter:element('charge-meter'),mobileLives:element('lives'),lifeHearts:[],stage:element('stage'),settings:element('settings'),launchButton:element('launch'),
  menu:{hidden:true},navToggle:{getAttribute(){navigationReads++;return String(navigationOpen)}},registration:{open:false},
  rewards:{dialog:{open:false,close(){this.open=false}},clear(){}},leaderboard:{dialog:{open:false},finish:()=>Promise.resolve(),start:async()=>1,setAnalyticsContext(value){this.analyticsContext=value},gameId:'test'},
  tutorial:{active:false,open(_mode,callback){this.active=true;tutorialDone=callback},cancelHold(){}},
  view:{scoreboard:{update:()=>false},resetPerformanceSampling(){},resetFeedback(){},setReference(){},resize(){},follow(){}},
  scorecard:{update(){},showScore(){}},touchInput:{matches:false},canTouch:()=>true,mobileView:()=>false,
  setGameActivity:active=>events.push(['activity',active]),track:(name,properties)=>events.push([name,structuredClone(properties)]),gameContext:()=>({run_sequence:1}),
  captureError:error=>{throw error},formatPoints:String,clearKeys(){},closeSettings(){},closeNavigation(){},toggleInspection(){},
  applyNavigationLayout(){},applyScoreboardLayout(){},syncPlaybackControls(){},showResult(){},showLeaderboard(){},bindFeedback(){},connectMembership:options=>options,
  sound:{unlock(){},setMusic(){},setOutputActive(){},play(){}},siteSound:{handoff(){},setMusic(){},setActive(){}},canvas:{focus(){}},
  physicsAssets:{vertices:[],indices:[],obstacles:[]},PinballPhysics:{create:async()=>makePhysics()},console,
 };
 const code=[part('function syncGameActivity(){','function syncPlaybackControls(){'),
  part('function sync(p=','function toggleInspection(){'),
  part('function setGamePaused(','function togglePause(){'),
  part('async function beginGame(){',"$('start').onclick="),
  part('function openPractice(',"$('practice-replay').onclick="),
  part('membership=connectMembership({','function showLeaderboard(){'),
  part("window.addEventListener('message',",'const menu='),
  part("addEventListener('sofacet:game-info',",'new MutationObserver('),
  part("window.addEventListener('sofacet:cookie-settings',",'tutorial=connectControlsTutorial('),
  part('function pauseOnFocusLoss(){',"window.addEventListener('resize',"),
  part("window.addEventListener('pageshow',",'void restoreScreenRoute();')].join('\n');
 vm.runInNewContext(code,context);
 // Exercise the production frame's launch edge, not a second implementation of
 // its analytics calls. Physics itself is covered by simulation/replay tests.
 const launchEdge=part('if(physics.launches>launches){','accumulator-=DT}');
 return {context,events,listeners,documentListeners,document,parent,physics,
  launch(){vm.runInNewContext('var launches=physics.launches;physics.launches++;'+launchEdge,context)},
  navigation(value){navigationOpen=value;context.syncGameActivity()},get navigationReads(){return navigationReads},
  finishPractice(result='skip'){context.tutorial.active=false;tutorialDone(result)},
  cookie(value){document.documentElement.dataset.cookieSettingsOpen=String(value);listeners['sofacet:cookie-settings']()},
 };
}

test('real game UI publishes activity only after first launch, across lives, and before its completed result',()=>{
 const f=game(),{context:c,events}=f;
 c.sync();assert.deepEqual(events,[['activity',false]],'the loaded table is not a played game');
 c.physics.active=true;c.sync();assert.deepEqual(events,[['activity',false]],'Play and idle launcher time are excluded');
 f.launch();assert.deepEqual(events.slice(-2),[['game_play_started',undefined],['activity',true]]);
 const reads=f.navigationReads;
 for(let i=0;i<500;i++)c.sync();
 assert.equal(f.navigationReads,reads,'unchanged frame updates do not republish activity or reread the navigation gate');
 for(const state of ['charging','playing','draining','resetting','spring_return','launcher']){c.physics.state=state;c.sync()}
 f.launch();
 assert.equal(events.length,3,'launcher and between-life animations belong to the same active run');
 assert.equal(events.filter(([name])=>name==='game_play_started').length,1,'a new life does not create another first-launch milestone');
 c.physics.state='finished';c.sync();
 assert.deepEqual(events.slice(-2),[['activity',false],['game_finished',{points:0}]],'the clock stops before final totals are recorded');
 c.physics.score=30;c.sync();c.sync();
 assert.equal(events.filter(([name])=>name==='game_finished').length,1,'verification/UI updates cannot finish the same run again');
});

test('overlapping pause, cookie and dialog blockers cannot resume game activity early',()=>{
 const f=game(),c=f.context;c.physics.active=true;c.physics.launches=1;c.sync();
 c.setGamePaused(true);assert.deepEqual(f.events.at(-1),['activity',false]);
 f.cookie(true);c.setGamePaused(false);
 assert.deepEqual(f.events.filter(([name])=>name==='activity'),[['activity',true],['activity',false]],'closing the pause menu leaves cookie settings blocking play');
 c.registration.open=true;c.sync();f.cookie(false);
 assert.deepEqual(f.events.filter(([name])=>name==='activity').at(-1),['activity',false]);
 c.registration.open=false;c.sync();assert.deepEqual(f.events.at(-1),['activity',true]);
 f.navigation(true);assert.deepEqual(f.events.at(-1),['activity',false]);
 c.rewards.dialog.open=true;c.sync();f.navigation(false);assert.deepEqual(f.events.filter(([name])=>name==='activity').at(-1),['activity',false]);
 c.rewards.dialog.open=false;c.sync();assert.deepEqual(f.events.at(-1),['activity',true]);
});

test('a replay excludes asynchronous preparation and waits for its own first launch after game_started',async()=>{
 const f=game(),c=f.context;c.physics.active=true;c.physics.launches=1;c.sync();
 let release;c.leaderboard.start=()=>new Promise(resolve=>release=resolve);
 const pending=c.beginGame();
 assert.deepEqual(f.events,[['activity',true],['activity',false]],'restart stops the old run before awaiting the start request');
 release(123);await pending;
 assert.deepEqual(f.events.slice(-2),[['activity',false],['game_started',{online:true}]],'new run resets without counting idle launcher time');
 assert.equal(c.physics.state,'launcher');assert.equal(c.physics.paused,false);
 assert.equal(c.physics.launches,0);assert.deepEqual(c.leaderboard.analyticsContext,{run_sequence:1});
 f.launch();assert.deepEqual(f.events.slice(-2),[['game_play_started',undefined],['activity',true]],'the replay owns a fresh first-launch edge');
});

test('practice pauses and restores an existing run without inventing a new game or bypassing another blocker',()=>{
 const f=game(),c=f.context;c.physics.active=true;c.physics.launches=1;c.sync();
 c.openPractice('replay');assert.deepEqual(f.events.at(-1),['activity',false]);
 f.cookie(true);f.finishPractice();
 assert.deepEqual(f.events.at(-1),['tutorial_completed',{outcome:'skip'}]);
 assert.equal(c.physics.paused,false,'the existing physics resume behavior is retained');
 f.cookie(false);assert.deepEqual(f.events.at(-1),['activity',true]);
 assert.equal(f.events.some(([name])=>name==='game_started'),false);
});

test('membership and information overlays stop active play even when physics pause bypasses the public pause control',()=>{
 const f=game(),c=f.context;c.physics.active=true;c.physics.launches=1;c.sync();
 c.membership.beforeOpen();assert.equal(c.physics.paused,true);assert.deepEqual(f.events.at(-1),['activity',false]);
 f.cookie(true);c.membership.afterClose(true,false);
 assert.equal(c.physics.paused,false);assert.deepEqual(f.events.filter(([name])=>name==='activity').at(-1),['activity',false]);
 f.cookie(false);assert.deepEqual(f.events.at(-1),['activity',true]);
 f.listeners['sofacet:game-info']({detail:true});assert.deepEqual(f.events.at(-1),['activity',false]);
 f.listeners['sofacet:game-info']({detail:false});assert.deepEqual(f.events.at(-1),['activity',true]);
 assert.equal(f.events.some(([name])=>name==='game_started'),false,'returning from an overlay keeps the existing run');
});

test('embedded visibility, backgrounding and BFCache stop activity without weakening message checks or the early pageshow guard',()=>{
 const f=game(),c=f.context;c.physics.active=true;c.physics.launches=1;c.sync();
 const visibility=(visible,changes={})=>f.listeners.message({source:f.parent,origin:c.location.origin,data:{type:'sofacet:experience-visibility',visible},...changes});
 visibility(false,{origin:'https://other.test'});visibility(false,{source:{}});
 assert.equal(f.events.length,1,'untrusted messages cannot change the activity clock');
 visibility(false);assert.deepEqual(f.events.at(-1),['activity',false]);
 visibility(true);assert.deepEqual(f.events.at(-1),['activity',true]);
 f.document.hidden=true;f.documentListeners.visibilitychange();assert.deepEqual(f.events.at(-1),['activity',false]);
 f.document.hidden=false;f.documentListeners.visibilitychange();
 assert.equal(c.physics.paused,true,'returning to the tab does not change existing manual-resume behavior');
 c.setGamePaused(false);assert.deepEqual(f.events.at(-1),['activity',true]);
 f.listeners.pagehide({persisted:true});assert.deepEqual(f.events.at(-1),['activity',false]);
 f.listeners.pageshow({persisted:true});assert.deepEqual(f.events.at(-1),['activity',true]);
 c.loaded=false;c.physics=undefined;
 assert.doesNotThrow(()=>f.listeners.pageshow({persisted:false}),'Safari can show the page before physics loads');
});

test('the shared facade replays only the latest activity when the outer runtime installs',()=>{
 const source=readFileSync(new URL('../shared/analytics.js',import.meta.url),'utf8').replace(/^export /gm,'');
 const top=new EventTarget(),calls=[],childCalls=[];
 const context={window:{top,sofacetAnalytics:{setGameActivity:value=>childCalls.push(value)}}};
 const api=vm.runInNewContext(source+';({setGameActivity,track})',context);
 api.setGameActivity(true);api.setGameActivity(false);api.setGameActivity(true);
 assert.deepEqual(calls,[]);assert.deepEqual(childCalls,[],'embedded activity has one outer owner');
 top.sofacetAnalytics={setGameActivity:value=>calls.push(value)};
 top.dispatchEvent(new Event('sofacet:analytics-ready'));
 top.dispatchEvent(new Event('sofacet:analytics-ready'));
 assert.deepEqual(calls,[true],'the readiness listener sends the current state once, without replaying old transitions');
 api.setGameActivity(false);api.setGameActivity('true');assert.deepEqual(calls,[true,false]);
 const guarded={sofacetAnalytics:{setGameActivity(){throw Error('unavailable')}}};
 Object.defineProperty(guarded,'top',{get(){throw Error('blocked')}});context.window=guarded;
 assert.doesNotThrow(()=>api.setGameActivity(true),'tracking must never break gameplay if an API or frame boundary is unavailable');
});
