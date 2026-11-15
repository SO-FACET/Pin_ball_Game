import test from 'node:test';import assert from 'node:assert/strict';
import {withRewardsSite,member} from './helpers/rewards-fixture.mjs';
import {routeDocuments,canonicalHref,setScreenRoute} from '../site-routes.js';
import {registrationScreenRoute} from '../site-routes.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('public URLs serve the existing documents, including direct refresh and HEAD',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const [route,document] of Object.entries(routeDocuments))for(const method of ['GET','HEAD']){
   const response=await fetch(origin+route,{method,redirect:'manual'});
   assert.equal(response.status,route==='/404'?404:200,route);
   assert.match(response.headers.get('content-type'),/text\/html/,route);
   assert.equal(response.headers.get('location'),null,route);
   if(method==='GET')assert.match(await response.text(),/<html/i,document);
  }
  for(const [old,current] of [['/play.html','/game'],['/account.html?view=signin','/sign-in'],['/membership.html?from=score','/claim'],['/exit','/notify'],['/launch','/notify'],['/launch?nav=game','/notify?nav=game'],['/launching-soon.html','/notify'],['/membership.html?from=collective','/join'],['/faq.html','/how-coins-work'],['/terms/','/terms']]){
   const response=await fetch(origin+old,{redirect:'manual'});assert.equal(response.status,308,old);assert.equal(response.headers.get('location'),current);
  }
  for(const [old,current] of [['/my-coins','/join'],['/my-coins?nav=game','/join?nav=game'],['/account.html','/join']]){
   const response=await fetch(origin+old,{redirect:'manual'});assert.equal(response.status,302,old);assert.equal(response.headers.get('location'),current);
  }
  assert.equal((await fetch(origin+'/site-routes.js')).status,200);
 });
});
test('Launch URLs redirect guests and members to Notify',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const path of ['/launch','/launch?nav=game','/launching-soon.html'])for(const method of ['GET','HEAD'])for(const cookie of ['',`sofacet_pinball_player=${member}`]){
   const response=await fetch(origin+path,{method,headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
   assert.equal(response.status,308);
   assert.equal(response.headers.get('location'),canonicalHref(path));
  }
 });
});
test('legacy fragments map to distinct screens and game history updates the outer address',t=>{
 assert.equal(canonicalHref('/play.html#leaderboard'),'/leaderboard');
 assert.equal(canonicalHref('/faq.html#contact'),'/contact');
 assert.equal(canonicalHref('/membership.html?from=account'),'/join?from=account');
 assert.equal(canonicalHref('/game#profile'),'/join');
 assert.equal(canonicalHref('//other.example/path'),'//other.example/path');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),calls=[];
 const host={location:{pathname:'/game',search:'',hash:''},history:{state:{sofacetGame:true},pushState:(state,_,url)=>calls.push({state,url}),replaceState:(state,_,url)=>calls.push({state,url})}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{top:host,name:'',frameElement:null}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window});
 setScreenRoute('/reward',{replace:false});
 assert.deepEqual(calls,[{state:{sofacetGame:true},url:'/reward'}]);
});
test('unknown document URLs render the React 404 page; missing assets and API errors keep their errors',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const path of ['/missing-page','/some/deep/path/missing.html','/404'])for(const method of ['GET','HEAD']){
   const response=await fetch(origin+path,{method,headers:{Accept:'text/html'},redirect:'manual'});assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('content-type'),/text\/html/);
   const html=await response.text();
   if(method==='HEAD')assert.equal(html,'');
   else{assert.match(html,/id="not-found-root"/);assert.match(html,/src="\/assets\/sofacet-not-found-[^"]+\.js"/);assert.match(html,/name="robots" content="noindex, follow"/)}
  }
  const asset=await fetch(origin+'/assets/missing.js');assert.equal(asset.status,404);
  const api=await fetch(origin+'/api/not-a-route',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(api.status,404);assert.match(api.headers.get('content-type'),/application\/json/);
  const faq=await fetch(origin+'/how-coins-work',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(faq.status,200);assert.match(faq.headers.get('content-type'),/text\/html/);
 });
});

test('auth success reserves coins-saved for actual saved rewards and preserves the parent destination',async()=>{
 const source=readFileSync(new URL('../collective-source/AuthFlow.jsx',import.meta.url),'utf8');
 const complete=source.slice(source.indexOf('  async function complete(value)'),source.indexOf('  const requestCreateOtp='));
 const routing=source.slice(source.indexOf("  useEffect(()=>{\n    if(memberCheck"),source.indexOf('  const exitHeading='));
 for(const scenario of [
  {name:'returning sign-in waits for dashboard navigation',kind:'signin',pointsSaved:false,dashboard:true,expected:['/my-coins']},
  {name:'first-cuts signup without a game',kind:'signup',pointsSaved:false,firstCut:true,expected:['/confirmation']},
  {name:'ordinary signup without a game',kind:'signup',pointsSaved:false,expected:['/notify']},
  {name:'standalone sign-in',kind:'signin',pointsSaved:false,expected:['/notify']},
  {name:'embedded sign-in delegates destination to parent',kind:'signin',pointsSaved:false,embedded:true,expected:[]},
  {name:'saved game reward',kind:'signup',pointsSaved:true,expected:['/coins-saved']},
 ]){
  const routes=[],messages=[],state={step:'claim',saved:null};let finishParent;
  const context={
   pendingRef:{current:scenario.pointsSaved?{points:3205}:null},savedRef:{current:false},
   setSaved:value=>{state.saved=value},setStep:value=>{state.step=value},setResendAt(){},writeScreenData(){},
   embedded:scenario.embedded===true,post:message=>messages.push(message),
   completeRef:{current:scenario.dashboard?async()=>{await new Promise(resolve=>{finishParent=resolve});routes.push('/my-coins')}:null},
   firstCut:scenario.firstCut===true,challenge:{kind:scenario.kind},accountNavigationHref:href=>href,location:{replace:href=>routes.push(href)},
  };
  vm.runInNewContext(complete+';this.complete=complete',context);
  const pending=context.complete({player:{member:true,best_score:3205,display_name:'Player'},pointsSaved:scenario.pointsSaved,savedPoints:scenario.pointsSaved?3205:0});
  const runEffect=()=>vm.runInNewContext(routing,{
   ...context,...state,memberCheck:'guest',tab:scenario.kind==='signin'?'registered':'create',exit:null,
   claimFirst:false,fromAccount:{current:false},registrationScreenRoute,
   useEffect:effect=>effect(),setScreenRoute:href=>routes.push(href),window:{dispatchEvent(){}},Event,
  });
  runEffect();
  if(scenario.dashboard){assert.deepEqual(routes,[],'pending parent completion cannot expose a false coins-saved screen');finishParent();}
  await pending;
  assert.deepEqual(routes,scenario.expected,scenario.name);
  if(scenario.embedded)assert.equal(messages[0]?.type,'contest-registration:complete');
 }
});
