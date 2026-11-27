import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLoadTracker} from '../shared/load-performance.js';

const source=readFileSync(new URL('../entrance-source/landing.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll("import('./entrance.mjs')",'window.loadScene()');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({url='https://sofacet.com/',state=null,decode=Promise.resolve(),load}={}){
 let now=100,imports=0,activations=0,scroll,serial=0;const timers=new Map(),redirects=[];
 const attributes=new Set(['data-awaiting-explore']);
 const body={dataset:{phase:'welcome'},hasAttribute:key=>attributes.has(key),setAttribute:key=>attributes.add(key),removeAttribute:key=>attributes.delete(key)};
 const main={inert:false,setAttribute(){},removeAttribute(){}};
 const button=Object.assign(new EventTarget(),{firstChild:{textContent:'Scroll Up to Explore '}}),retry=Object.assign(new EventTarget(),{hidden:true});
 const label={textContent:'Preparing your journey…'},status={hidden:false,querySelector:()=>label};
 const nodes={entrance:main,'scroll-hint':button,'scene-poster':{decode:()=>decode},'journey-retry':retry,'scene-loading-status':status};
 const document=Object.assign(new EventTarget(),{body,hidden:false,documentElement:{dataset:{}},getElementById:id=>nodes[id]});
 const location=new URL(url);location.assign=path=>redirects.push(path);location.reload=()=>redirects.push('reload');
 const activateEntrance=options=>{activations++;scroll=options.scroll;attributes.delete('data-awaiting-explore')};
 const window=Object.assign(new EventTarget(),{document,location,CustomEvent,performance:{now:()=>now},loadScene(){imports++;return load?load({activateEntrance}):Promise.resolve({activateEntrance})},setTimeout(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id)});
 const history={state,replaceState(value){this.state=value}};
 const context={window,document,location,history,performance:window.performance,URLSearchParams,createLoadTracker,requestAnimationFrame:fn=>fn(now),setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,innerHeight:844};
 vm.runInNewContext(source,context);
 return {window,context,main,attributes,redirects,retry,label,button,get imports(){return imports},get activations(){return activations},get scroll(){return scroll},advance:time=>{now=time},idle(){for(const [id,timer]of timers)if(timer.delay===1200){timers.delete(id);timer.callback()}},click:()=>button.dispatchEvent(new Event('click'))};
}

test('the first screen paints and measures its poster before background preparation',async()=>{
 let resolve;const f=fixture({decode:new Promise(yes=>{resolve=yes})});
 assert.equal(f.imports,0);assert.equal(f.main.inert,false);assert.equal(f.attributes.has('data-loading'),false);
 f.advance(1200);resolve();await turn();
 assert.equal(f.imports,0);assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.duration_ms,1200);
 assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.renderer,'poster');
 f.advance(2400);f.idle();await turn();
 assert.equal(f.imports,1);assert.equal(f.activations,0);assert.equal(f.attributes.has('data-awaiting-explore'),true);
 assert.equal(f.window.__sofacetExperienceStart,2400);assert.equal(f.main.inert,false);
});

test('touching a prepared scene activates it once without a blocking logo',async()=>{
 const f=fixture();await turn();f.idle();await turn();f.advance(5000);
 f.window.dispatchEvent(new Event('pointerdown'));f.window.dispatchEvent(new Event('touchstart'));await f.context.startExperience();
 assert.equal(f.imports,1);assert.equal(f.activations,1);assert.equal(f.main.inert,false);
 assert.equal(f.scroll,540,'A tap must advance the movie without a second gesture');
 assert.equal(f.attributes.has('data-loading'),false);assert.equal(f.attributes.has('data-awaiting-explore'),false);
 assert.equal(f.window.__sofacetExperienceStart,100,'Cinematic timing begins with background preparation');
});

test('a gesture during download keeps the opening visible and retains a bounded first scroll',async()=>{
 let finish;const f=fixture({load:module=>new Promise(resolve=>{finish=()=>resolve(module)})});await turn();
 for(const amount of [220,10000]){const event=new Event('wheel');event.deltaY=amount;f.window.dispatchEvent(event)}
 assert.equal(f.imports,1);assert.equal(f.activations,0);assert.equal(f.attributes.has('data-awaiting-explore'),true);
 assert.equal(f.attributes.has('data-interaction-pending'),true);assert.equal(f.main.inert,false);assert.equal(f.attributes.has('data-loading'),false);
 finish();await f.context.startExperience();assert.equal(f.activations,1);assert.equal(f.scroll,844*.8);
 assert.deepEqual(f.redirects,[]);
});

test('the visible scroll hint enters the first scene instead of requiring a separate Explore action',async()=>{
 const f=fixture();await turn();f.click();await f.context.startExperience();assert.equal(f.activations,1);assert.equal(f.scroll,540);
});

test('cookie/navigation controls and unrelated keys do not activate a prepared movie',async()=>{
 const f=fixture();await turn();f.idle();await turn();
 const control=new Event('pointerdown');Object.defineProperty(control,'target',{value:{closest:()=>({})}});f.window.dispatchEvent(control);
 const tab=new Event('keydown');tab.key='Tab';f.window.dispatchEvent(tab);
 f.window.document.documentElement.dataset.cookieSettingsOpen='true';f.window.dispatchEvent(new Event('touchstart'));
 assert.equal(f.activations,0);assert.equal(f.imports,1);
 f.window.document.documentElement.dataset.cookieSettingsOpen='false';f.window.dispatchEvent(new Event('touchstart'));await f.context.startExperience();assert.equal(f.activations,1);
});

test('an early touch cancels only the pending first-screen measurement',async()=>{
 let resolve;const f=fixture({decode:new Promise(yes=>{resolve=yes})});f.window.dispatchEvent(new Event('touchstart'));
 resolve();await f.context.startExperience();await turn();
 assert.deepEqual(f.window.__sofacetLoadMetrics.entries.map(x=>x.properties.load_outcome),['started','cancelled']);assert.equal(f.imports,1);
});

test('explicit comparisons and restored positions retain automatic startup',async()=>{
 for(const options of [{url:'https://sofacet.com/?entrance=1'},{url:'https://sofacet.com/#experience'},{url:'https://sofacet.com/?perf=1'},{state:{sofacetWorldScroll:900}},{state:{sofacetGame:true}}]){
  const f=fixture(options);await turn();assert.equal(f.imports,1);assert.equal(f.window.__sofacetExperienceStart,undefined);assert.equal(f.attributes.has('data-loading'),true);
 }
});

test('a failed poster is measured without disabling navigation',async()=>{
 const f=fixture({decode:Promise.reject(Error('Image unavailable'))});await turn();assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.load_outcome,'failed');assert.equal(f.main.inert,false);
});

test('a cinematic module failure offers retry and never redirects to the game',async()=>{
 const f=fixture({load:()=>Promise.reject(Error('Module unavailable'))});f.click();await f.context.startExperience();
 assert.deepEqual(f.redirects,[]);assert.equal(f.retry.hidden,false);assert.equal(f.attributes.has('data-entrance-error'),true);assert.match(f.label.textContent,/try again/);assert.equal(f.main.inert,false);
 f.retry.dispatchEvent(new Event('click'));assert.deepEqual(f.redirects,['reload']);
 const retried=fixture({state:f.context.history.state});await turn();
 assert.equal(retried.activations,1,'Retry should enter the scene when loading finishes');
 assert.equal(retried.scroll,540);assert.deepEqual(Object.keys(retried.context.history.state),[]);
});

test('swiping over the scroll cue activates the movie instead of treating it as navigation',async()=>{
 const f=fixture();await turn();const swipe=new Event('wheel');swipe.deltaY=120;Object.defineProperty(swipe,'target',{value:{closest:()=>f.button}});
 f.window.dispatchEvent(swipe);await f.context.startExperience();assert.equal(f.activations,1);assert.equal(f.scroll,540);
});
