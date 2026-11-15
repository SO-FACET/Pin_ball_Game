import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {withRewardsSite,member,gameId} from '../tests/helpers/rewards-fixture.mjs';
import {routeDocuments} from '../site-routes.js';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
const workflows=process.env.SOFACET_ANALYTICS_WORKFLOW?[process.env.SOFACET_ANALYTICS_WORKFLOW]:['signup','signin','claim'];
assert.ok(workflows.every(value=>['signup','signin','claim'].includes(value)),'Supported analytics workflow');
const browserType=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright')[engine];
assert.ok(['chromium','webkit'].includes(engine),'Supported analytics browser engine');
const output=resolve(process.env.SOFACET_ANALYTICS_OUTPUT||'work/analytics-browser/'+engine);
await mkdir(output,{recursive:true});
const browser=await browserType.launch({...engine==='chromium'?{args:['--enable-unsafe-swiftshader']}:{}});
const previous={...process.env};
Object.assign(process.env,{ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST123',POSTHOG_PUBLIC_KEY:'',POSTHOG_SESSION_REPLAY:'false',ANALYTICS_ID_SECRET:'',ARTWORK_CDN_BASE_URL:''});
const summary={engine,scope:'Desktop browser functional checks against isolated rewards fixtures. Google SDK requests are intercepted with a mock tag; this does not prove real GA collection or physical-phone performance.',posthogEnabled:false,identifiedUsers:false,workflows:[],passed:false};
const forbidden=/private@example|test@example\.invalid|9876543210|012345|Updated Member|Test Member|token=private|#secret|cus_fixture|user_[a-f0-9]{64}/;

function mockGoogleTag(){
 window.__gaEvents=[];
 const capture=item=>{const values=Array.from(item);window.__gaEvents.push(values);window.__collectGaEvent(values);};
 for(const item of window.dataLayer)capture(item);
 window.dataLayer.push=function(){for(const item of arguments)capture(item);return Array.prototype.push.apply(this,arguments);};
}
try{
 for(const workflow of workflows)await withRewardsSite(async({origin,awards})=>{
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const page=await context.newPage(),providerRequests=[],gaEvents=[],failures=[];
  const report={engine,workflow,origin,passed:false,errors:failures};
  summary.workflows.push(report);
  page.setDefaultTimeout(20000);
  const gaItems=name=>gaEvents.filter(item=>item[0]==='event'&&item[1]===name).map(item=>item[2]);
  async function waitForGa(name,predicate=()=>true){
   const until=Date.now()+20000;
   while(!gaItems(name).some(predicate)&&Date.now()<until)await delay(25);
   assert.ok(gaItems(name).some(predicate),'Missing '+name+' event: '+JSON.stringify(gaItems(name)));
  }
  async function setConsent(value){
   await page.evaluate(()=>window.sofacetCookiePreferences.open());
   await page.locator('#sf-cookie-settings input[name="analytics"]').setChecked(value);
   await page.locator('#sf-cookie-settings button[type="submit"]').click();
  }
  let releaseProvider,providerRequested;
  const providerGate=new Promise(resolve=>{releaseProvider=resolve;});
  const pendingProvider=new Promise(resolve=>{providerRequested=resolve;});
  try{
   await context.exposeFunction('__collectGaEvent',item=>gaEvents.push(item));
   page.on('pageerror',error=>failures.push(error.message));
   await context.route('https://www.googletagmanager.com/**',route=>{
    providerRequests.push(route.request().url());
    return route.fulfill({contentType:'application/javascript',body:'('+mockGoogleTag.toString()+')();'});
   });
   await context.route(/https:\/\/(?:[^/]*google-analytics\.com|[^/]*analytics\.google\.com|[^/]*posthog\.com|analytics\.test)\//,route=>{
    providerRequests.push(route.request().url());
    failures.push('Unexpected unmocked analytics provider request');
    return route.abort();
   });
   if(workflow==='signup')await context.route(/\/assets\/analytics-google-[A-Za-z0-9_-]+\.js(?:\?|$)/,async route=>{
    providerRequested();await providerGate;await route.continue();
   });
   await page.goto(origin+'/privacy?email=private@example.com&otp=012345#secret');
   await page.waitForFunction(()=>window.sofacetAnalytics&&window.sofacetCookiePreferences);
   assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().enabled),false);
   assert.equal(providerRequests.length,0,'No external provider requests before consent');
   await setConsent(false);
   await page.reload();
   await page.waitForFunction(()=>window.sofacetAnalytics&&window.sofacetCookiePreferences);
   assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().enabled),false);
   assert.equal(providerRequests.length,0,'Persisted rejection must not load providers');
   await setConsent(true);
   if(workflow==='signup'){
    await Promise.race([pendingProvider,delay(20000).then(()=>{throw Error('Google provider module was not requested');})]);
    await setConsent(false);
    const moduleResponse=page.waitForResponse(response=>/\/assets\/analytics-google-/.test(response.url()));
    releaseProvider();
    await moduleResponse;
    await delay(100);
    assert.equal(providerRequests.length,0,'Revoked pending module import must not append the external Google tag');
    assert.equal(await page.evaluate(()=>window.dataLayer?.some(item=>item[0]==='consent'&&item[2]?.analytics_storage==='granted')||false),false);
    assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().google),false);
    report.pendingImportRevocationPassed=true;
    await setConsent(true);
   }else releaseProvider();
   await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().google&&window.__gaEvents);
   await waitForGa('page_view',properties=>properties.page_path==='/privacy');
   assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().posthog),false);
   assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().recording),false);
   assert.equal(await page.evaluate(()=>document.getElementById('sofacet-ga').referrerPolicy),'no-referrer');
   await page.evaluate(()=>{
    window.sofacetAnalytics.track('game_started',{online:true,email:'private@example.com'});
    history.pushState({},'','/reward?token=private');history.replaceState({},'','/reward#secret');
    window.sofacetAnalytics.captureError(new Error('Failed for private@example.com OTP 012345'),{source:'browser_test'});
   });
   await waitForGa('client_error');
   await waitForGa('page_view',properties=>properties.page_path==='/reward');
   assert.deepEqual(gaItems('page_view').map(item=>item.page_path),['/privacy','/reward']);
   assert.equal(gaItems('page_leave')[0]?.page_path,'/privacy','History duration belongs to the previous page');
   assert.doesNotMatch(JSON.stringify(gaEvents),forbidden,'Initial config, global metadata and events omit sensitive URL/error data');
   const configs=gaEvents.filter(item=>item[0]==='config');
   assert.ok(configs.length>0&&configs.every(item=>item[2].send_page_view===false),'Every config disables automatic initial pageviews');
   assert.ok(configs.every(item=>item[2].page_referrer===''&&item[2].user_id===null),'GA-only launch is anonymous with blank referrer');
   await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/terms';frame.id='analytics-test-frame';document.body.append(frame);});
   await page.frameLocator('#analytics-test-frame').locator('body').waitFor({state:'attached'});
   await page.waitForFunction(()=>document.querySelector('#analytics-test-frame').contentWindow.sofacetAnalytics);
   assert.equal(gaItems('page_view').length,2,'Embedded document must not add a pageview');
   await context.addCookies([{name:'_ga',value:'fixture-cookie',url:origin},{name:'_ga_TEST123',value:'fixture-session',url:origin}]);
   await setConsent(false);
   assert.equal(await page.evaluate(()=>window.sofacetAnalytics.getStatus().enabled),false);
   assert.equal((await context.cookies()).filter(cookie=>/^ph_|^_ga/.test(cookie.name)).length,0,'Revocation clears analytics cookies');
   await page.evaluate(()=>{window.sofacetAnalytics.track('game_finished',{points:9876543});window.sofacetAnalytics.captureError(Error('ignored_after_revoke'));});
   await delay(100);
   assert.ok(!gaItems('game_finished').some(item=>item.points===9876543),'New events stop after revocation');
   assert.doesNotMatch(JSON.stringify(gaEvents),/ignored_after_revoke/);
   await setConsent(true);
   await page.waitForFunction(()=>window.sofacetAnalytics.getStatus().google);
   const regrantStart=gaItems('game_paused').length;
   await page.evaluate(()=>{window.sofacetAnalytics.resetIdentity();window.sofacetAnalytics.track('game_paused');});
   await waitForGa('game_paused');
   assert.equal(gaItems('game_paused').length,regrantStart+1,'Anonymous identity reset keeps current analytics consent');
   report.consentChecksPassed=true;
   for(const path of Object.keys(routeDocuments)){
    const response=await page.request.get(origin+path);
    assert.equal(response.status(),path==='/404'?404:200,path+' is served');
    assert.equal(((await response.text()).match(/src="\/assets\/analytics\.js/g)||[]).length,1,path+' includes one analytics controller');
   }
   await context.addCookies([{name:'sofacet_pinball_player',value:member,url:origin,httpOnly:true,sameSite:'Lax'}]);
   const workflowStart=gaEvents.length;
   if(workflow==='signup'){
    await page.goto(origin+'/notify');
    await page.waitForFunction(()=>window.sofacetAnalytics?.getStatus().google);
    await page.locator('#notify .notify-join a').waitFor({state:'visible'});
    await waitForGa('api_request',properties=>properties.endpoint==='/api/account/session');
    assert.equal(await page.locator('#notify input[type="email"]').count(),0);
    await page.getByRole('button',{name:'Next photograph',exact:true}).click();
    await waitForGa('ui_click',properties=>properties.page_path==='/notify'&&properties.control==='next');
    await page.locator('#notify .notify-join a').click();
    await page.waitForURL('**/join');
    await page.locator('#new-name').fill('Test Member');
    await page.locator('#new-phone').fill('9876543210');
    await page.locator('#new-email').fill('test@example.invalid');
    await page.locator('#create-form input[name="terms"]').check();
    await page.locator('#create-form input[name="updates"]').check();
    await page.locator('#create-form [data-analytics-control="signup_otp_request"]').click();
    await waitForGa('otp_requested',properties=>properties.flow==='signup'&&properties.method==='phone_otp');
    assert.equal(new URL(page.url()).pathname,'/join','Current signup keeps its OTP inline');
    const signupCount=gaItems('sign_up').length;
    await page.locator('#new-otp').fill('000000');
    await page.locator('#create-form button[type="submit"]').click();
    await page.locator('#create-feedback').filter({hasText:'That code doesn’t match'}).waitFor();
    assert.equal(gaItems('sign_up').length,signupCount,'Wrong OTP never counts as signup');
    await waitForGa('api_request',properties=>properties.endpoint==='/api/membership/otp/verify'&&properties.outcome==='failure');
    await page.locator('#new-otp').fill('012345');
    await page.locator('#create-form button[type="submit"]').click();
    await page.waitForURL('**/confirmation');
    await waitForGa('page_view',properties=>properties.page_path==='/confirmation');
    await waitForGa('sign_up',properties=>properties.flow==='signup');
    assert.equal(gaItems('sign_up').length,signupCount+1,'One confirmed signup');
    assert.equal(gaItems('reward_saved').length,0,'Joining without a game is not saved coins');
    await page.goto(origin+'/sign-in');
    await page.locator('#account-screen').waitFor();
    await page.waitForURL('**/my-coins');
    await waitForGa('page_view',properties=>properties.page_path==='/my-coins');
    await page.getByRole('textbox',{name:'Name',exact:true}).fill('Updated Member');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Your details are updated.'}).waitFor();
    await waitForGa('profile_updated',properties=>properties.flow==='account'&&properties.method==='form');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.waitForURL('**/notify');
    await waitForGa('logout',properties=>properties.flow==='account'&&properties.method==='button');
   }else if(workflow==='signin'){
    await page.goto(origin+'/sign-in');
    await waitForGa('page_view',properties=>properties.page_path==='/sign-in');
    await page.locator('#login-phone').fill('9876543210');
    await page.locator('#generate').click();
    await page.locator('#login-feedback').filter({hasText:'WhatsApp'}).waitFor();
    await waitForGa('otp_requested',properties=>properties.flow==='signin');
    const loginCount=gaItems('login').length;
    await page.locator('#login-otp').fill('000000');
    await page.getByRole('button',{name:'SIGN IN',exact:true}).click();
    await page.locator('#login-feedback').filter({hasText:'That code doesn’t match'}).waitFor();
    assert.equal(gaItems('login').length,loginCount,'Wrong OTP never counts as sign-in');
    await page.locator('#login-otp').fill('012345');
    await page.getByRole('button',{name:'SIGN IN',exact:true}).click();
    await page.locator('#account-screen').waitFor();
    await waitForGa('login',properties=>properties.flow==='signin'&&properties.method==='phone_otp');
    assert.equal(gaItems('login').length,loginCount+1,'One confirmed sign-in');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.waitForURL('**/notify');
   }else{
    await page.evaluate(id=>sessionStorage.setItem('sofacet-screen-reward',JSON.stringify({points:3205,rewardValue:320.5,completedAt:Date.now(),gameId:id,status:'completed'})),gameId);
    await page.goto(origin+'/claim');
    await page.locator('[name="fullName"]').fill('Test Member');
    await page.locator('[name="mobile"]').fill('9876543210');
    await page.getByRole('button',{name:'Send OTP',exact:true}).click();
    await page.locator('#final-otp:not([disabled])').waitFor();
    await page.locator('#final-otp').fill('012345');
    await page.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
    const details=page.getByRole('region',{name:'Confirm your details'});
    await details.getByRole('textbox',{name:'Email address'}).fill('test@example.invalid');
    await details.locator('[name="terms"]').check();
    await details.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
    await page.waitForURL('**/coins-saved');
    await page.getByRole('button',{name:'SHARE POINTS',exact:true}).waitFor();
    await waitForGa('reward_saved',properties=>properties.points===3205);
    assert.equal(gaItems('reward_saved').filter(properties=>properties.points===3205).length,1,'One confirmed exact-points save');
    assert.equal(awards.size,1,'One verified game reward was credited');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
    await page.getByRole('button',{name:'SHARE POINTS',exact:true}).click();
    await page.getByRole('button',{name:'Edit message',exact:true}).click();
    await page.getByRole('textbox',{name:'Your share message',exact:true}).fill('Test Member private@example.com OTP 012345');
    await page.getByRole('button',{name:'Save message',exact:true}).click();
    await page.getByRole('button',{name:'Copy points & link',exact:true}).click();
    await waitForGa('share',properties=>properties.method==='clipboard');
    await page.getByRole('button',{name:'Close share panel',exact:true}).click();
    await page.locator('[data-analytics-control="saved_about"]').click();
    await page.waitForURL('**/about');
    await waitForGa('ui_click',properties=>properties.control==='saved_about');
   }
   await page.waitForFunction(()=>window.__gaEvents?.some(item=>item[0]==='event'&&item[1]==='page_view'&&item[2].page_path===location.pathname));
   const paths=gaEvents.slice(workflowStart).filter(item=>item[0]==='event'&&item[1]==='page_view').map(item=>item[2].page_path);
   report.workflowPaths=paths;
   const expected={signup:['/notify','/join','/confirmation','/my-coins'],signin:['/sign-in','/verify','/my-coins','/notify'],claim:['/claim','/coins-saved','/about']}[workflow];
   for(const path of expected)assert.ok(paths.includes(path),'Missing workflow pageview '+path+': '+JSON.stringify(paths));
   assert.ok(paths.every((path,index)=>index===0||path!==paths[index-1]),'No duplicate adjacent pageviews: '+JSON.stringify(paths));
   if(workflow!=='claim')assert.ok(!paths.includes('/coins-saved'),'Non-reward signup/sign-in must not claim a saved-coins screen');
   report.workflowPaths=paths;
   if(workflow==='claim'){
    await page.evaluate(()=>{sessionStorage.setItem('sofacet-game-visited','1');localStorage.setItem('sofacet.controls-practised.v1','done');});
    const readyCount=gaItems('game_ready').length;
    await page.goto(origin+'/game');
    await page.waitForSelector('#stage[data-ready="true"]',{timeout:90000});
    await waitForGa('game_ready');
    assert.equal(gaItems('game_ready').length,readyCount+1,'Standalone game becomes ready once');
    const startedCount=gaItems('game_started').length;
    await page.locator('#start').click();
    await page.waitForFunction(()=>!document.querySelector('#touch-launch').hidden&&!document.querySelector('#touch-launch').disabled);
    await waitForGa('game_started',properties=>properties.online===true&&properties.page_path==='/game');
    assert.equal(gaItems('game_started').length,startedCount+1,'One actual game start');
    const pausedCount=gaItems('game_paused').length,resumedCount=gaItems('game_resumed').length;
    await page.locator('#pause').click();
    await waitForGa('game_paused',properties=>properties.page_path==='/game');
    assert.equal(gaItems('game_paused').length,pausedCount+1);
    await page.locator('#pause-resume').click();
    await waitForGa('game_resumed',properties=>properties.page_path==='/game');
    assert.equal(gaItems('game_resumed').length,resumedCount+1);
    report.gameHooksPassed=true;
    const embeddedStart=gaEvents.length;
    await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
    await page.locator('[data-menu-panel] [data-game-info][href^="/about"]').click();
    await page.waitForURL('**/about');
    const info=page.frameLocator('#game-info-dialog iframe');
    await info.getByRole('button',{name:'Open navigation menu',exact:true}).click();
    await info.locator('[data-menu-panel] a[href^="/privacy"]:not([data-cookie-settings])').click();
    await page.waitForURL('**/privacy');
    await info.getByRole('button',{name:'Open navigation menu',exact:true}).click();
    await info.locator('[data-menu-panel] [data-game-return]').click();
    await page.waitForURL('**/game');
    const deadline=Date.now()+20000;
    while(gaEvents.slice(embeddedStart).filter(item=>item[0]==='event'&&item[1]==='page_view').length<3&&Date.now()<deadline)await delay(25);
    const embeddedPaths=gaEvents.slice(embeddedStart).filter(item=>item[0]==='event'&&item[1]==='page_view').map(item=>item[2].page_path);
    assert.deepEqual(embeddedPaths,['/about','/privacy','/game'],'Embedded navigation delegates each outer screen once');
    report.embeddedPaths=embeddedPaths;
   }
   assert.doesNotMatch(JSON.stringify(gaEvents),forbidden,'Workflow tracking omits entered details, OTP and editable share text');
   assert.ok(!providerRequests.some(url=>/posthog|analytics\.test/.test(url)),'GA-only fixture never activates replay/PostHog');
   assert.deepEqual(failures,[]);
   report.gaEventNames=gaEvents.filter(item=>item[0]==='event').map(item=>item[1]);
   report.providerScriptRequests=providerRequests.length;
   report.passed=true;
   console.log('Analytics '+engine+'/'+workflow+' workflow passed.');
  }catch(error){
   report.failure=error.message;
   report.gaEventNames=gaEvents.filter(item=>item[0]==='event').map(item=>item[1]);
   report.pageViews=gaItems('page_view').map(item=>item.page_path);
   await page.screenshot({path:resolve(output,workflow+'-failure.png'),timeout:5000}).catch(()=>{});
   throw error;
  }finally{
   releaseProvider();
   await context.close();
   report.allBrowsersClosed=true;
   await writeFile(resolve(output,workflow+'.json'),JSON.stringify(report,null,2)+'\n');
  }
 },{returningMember:workflow==='signin'});
 summary.passed=true;
 console.log('Analytics '+engine+' checks passed for '+workflows.join(', ')+'. Google network remains intercepted.');
}finally{
 for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
 Object.assign(process.env,previous);
 await browser.close();summary.allBrowsersClosed=true;
 await writeFile(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
}
