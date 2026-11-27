import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';

// Only local fixture accounts are used; no real OTPs, accounts or coins are changed.
const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const browser=await require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright')[engine].launch();
try {
 await withRewardsSite(async({origin})=>{
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
   for(const savedPoints of [3200,0]) {
    const nav='';
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    try {
     // Restore a previously saved confirmation; the authenticated API remains
     // authoritative when the balance has since become zero.
     await context.addInitScript(()=>sessionStorage.setItem('sofacet-screen-saved',JSON.stringify({pointsSaved:true,savedPoints:3200,score:3200})));
     await context.route('**/api/account',route=>route.fulfill({json:{savedPoints}}));
     const page=await context.newPage();
     const errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.goto(origin+'/coins-saved'+nav);
     const exit=page.getByRole('button',{name:'Exit to Launching Soon',exact:true}).filter({hasText:'EXIT'});
     await exit.waitFor({state:'visible'});
     const cookies=page.getByRole('button',{name:'Reject optional',exact:true});
     if(await cookies.isVisible())await cookies.click();
     assert.equal(await exit.innerText(),'EXIT');
     if(savedPoints>0) {
      const close=page.locator('.claim-navigation .auth-flow-close');
      await close.waitFor({state:'visible'});
      const font=await close.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),family:getComputedStyle(el).fontFamily}));
      assert.ok(font.size>=24,'PR #68 keeps the close icon large enough');
      assert.match(font.family,/Josefin Sans/,'Close icon uses a font that includes ×');
     }
     await exit.click();
     await page.waitForURL(origin+'/notify'+nav);
     if(savedPoints>0) {
      await page.goto(origin+'/coins-saved');
      await page.locator('.claim-navigation .auth-flow-close').click();
      await page.waitForURL(origin+'/notify');
     }
     assert.deepEqual(errors,[]);
     console.log(`PASS saved exit: ${viewport.width}px, ${savedPoints} coins${nav}`);
    } finally {await context.close();}
   }
  }
  // A confirmation embedded in the game must leave the parent, not trap the
  // launching-soon page inside the registration iframe.
  const context=await browser.newContext({reducedMotion:'reduce'});
  try {
   await context.addInitScript(()=>sessionStorage.setItem('sofacet-screen-saved',JSON.stringify({pointsSaved:true,savedPoints:3200,score:3200})));
   await context.route('**/api/account',route=>route.fulfill({json:{savedPoints:3200}}));
   const page=await context.newPage();await page.goto(origin+'/health');
   await page.setContent('<iframe id="registration-frame" title="Saved coins" style="width:100vw;height:100vh" src="/coins-saved?nav=game"></iframe>');
   const frame=page.frameLocator('iframe');
   const cookies=frame.getByRole('button',{name:'Reject optional',exact:true});
   if(await cookies.isVisible())await cookies.click();
   await frame.getByRole('button',{name:'Exit to Launching Soon',exact:true}).filter({hasText:'EXIT'}).click();
   await page.waitForURL(origin+'/notify?nav=game');
   console.log('PASS saved exit navigates the parent game window');
  } finally {await context.close();}
 });
} finally {await browser.close();}
