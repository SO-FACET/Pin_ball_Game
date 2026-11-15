import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Exercise the real game module's lifecycle handler while physics is pending.
// This is a functional browser check, not a physical-phone performance claim.
const require=createRequire(import.meta.url);
const {chromium,webkit,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'chromium';
const origin=process.env.SOFACET_GAME_URL||'http://127.0.0.1:8879';
const output=resolve(process.env.SOFACET_GAME_STARTUP_OUTPUT||'work/game-startup');
await mkdir(output,{recursive:true});
const browser=await({chromium,webkit}[engine]).launch({...engine==='chromium'?{args:['--enable-gpu']}:{} });
const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:670},reducedMotion:'reduce'});
const report={engine,origin,errors:[],passed:false};
let releasePhysics;
const physicsGate=new Promise(resolve=>{releasePhysics=resolve});
try{
 await context.addInitScript(()=>{
  localStorage.setItem('sofacet.controls-practised.v1','done');
  sessionStorage.setItem('sofacet-game-visited','1');
  window.__gameStartupLifecycle=[];
  window.addEventListener('pageshow',event=>window.__gameStartupLifecycle.push({trusted:event.isTrusted,persisted:event.persisted,ready:document.querySelector('#stage')?.dataset.ready==='true'}));
 });
 await context.route(/\/assets\/collider-entities\.json(?:\?|$)/,async route=>{
  report.collisionRequest=route.request().url();
  await physicsGate;
  await route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 const collision=page.waitForRequest(request=>/\/assets\/collider-entities\.json(?:\?|$)/.test(request.url()),{timeout:60000});
 await page.goto(new URL('/game',origin).href,{waitUntil:'domcontentloaded',timeout:60000});
 await collision;
 assert.equal(await page.locator('#stage[data-ready="true"]').count(),0,'Physics must remain pending during the lifecycle event');
 // Dispatch a synthetic browser lifecycle event while the real collision fetch
 // keeps physics uninitialized. No app handler or game state is mocked.
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false})));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 report.pendingPageshow=await page.evaluate(()=>window.__gameStartupLifecycle.find(event=>!event.trusted&&!event.persisted));
 assert.equal(report.pendingPageshow.ready,false,'The synthetic pageshow must occur before game readiness');
 assert.deepEqual(report.errors,[],'pageshow before physics is initialized must not throw');
 releasePhysics();
 await page.waitForSelector('#stage[data-ready="true"]',{timeout:60000});
 const reject=page.getByRole('button',{name:/^(Essential only|Reject optional)$/});
 if(await reject.isVisible())await reject.click();
 await page.locator('#start').click();
 await page.waitForFunction(()=>!document.querySelector('#touch-launch').hidden&&!document.querySelector('#touch-launch').disabled);
 await page.locator('#pause').click();
 assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Resume game');
 await page.evaluate(()=>{
  document.querySelector('#pause').setAttribute('aria-label','Stale restored control');
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
 });
 assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Resume game','A ready game must refresh paused controls after a persisted pageshow');
 await page.locator('#pause').click();
 assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Pause game');
 report.lifecycle=await page.evaluate(()=>window.__gameStartupLifecycle);
 assert.ok(report.lifecycle.some(event=>event.persisted&&event.ready),'The ready restore path must still run');
 assert.deepEqual(report.errors,[]);
 report.passed=true;
}catch(error){report.failure=error.message;throw error;}
finally{
 releasePhysics();
 await context.close();await browser.close();
 report.allBrowsersClosed=true;
 await writeFile(resolve(output,`${engine}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
