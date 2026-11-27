import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLoadTracker} from '../shared/load-performance.js';

const source=readFileSync(new URL('../entrance-source/landing.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function').replace("import('./entrance.mjs')",'window.loadScene()');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({url='https://sofacet.com/',state=null,decode=Promise.resolve(),load=()=>Promise.resolve()}={}){
 let now=100,imports=0;const timers=new Map(),redirects=[];
 const attributes=new Set(['data-awaiting-explore']);
 const body={dataset:{phase:'welcome'},setAttribute:key=>attributes.add(key),removeAttribute:key=>attributes.delete(key)};
 const main={inert:false,setAttribute(){}};
 const button=Object.assign(new EventTarget(),{firstChild:{textContent:'Explore '}});
 const nodes={entrance:main,'scroll-hint':button,'scene-poster':{decode:()=>decode}};
 const document=Object.assign(new EventTarget(),{body,hidden:false,getElementById:id=>nodes[id]});
 const location=new URL(url);location.assign=path=>redirects.push(path);
 const window=Object.assign(new EventTarget(),{document,location,CustomEvent,performance:{now:()=>now},loadScene(){imports++;return load()},setTimeout(callback){const id=timers.size+1;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id)});
 const context={window,document,location,history:{state},performance:window.performance,URLSearchParams,createLoadTracker,requestAnimationFrame:fn=>fn(now)};
 vm.runInNewContext(source,context);
 return {window,context,main,attributes,redirects,get imports(){return imports},advance:time=>{now=time},click:()=>button.dispatchEvent(new Event('click'))};
}

test('the first screen measures real image readiness without importing a cinematic or a game',async()=>{
 let resolve;const f=fixture({decode:new Promise(yes=>{resolve=yes})});
 assert.equal(f.imports,0);assert.equal(f.main.inert,false);assert.equal(f.attributes.has('data-loading'),false);
 assert.deepEqual(f.window.__sofacetLoadMetrics.entries.map(x=>x.properties.load_outcome),['started']);
 f.advance(1200);resolve();await turn();
 assert.equal(f.imports,0);
 assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.duration_ms,1200);
 assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.renderer,'poster');
});

test('Explore starts the cinematic once and its timer includes the dynamic import',async()=>{
 const f=fixture();await turn();f.advance(5000);f.click();f.click();await f.context.startExperience();
 assert.equal(f.imports,1);assert.equal(f.window.__sofacetExperienceStart,5000);
 assert.equal(f.main.inert,true);assert.equal(f.attributes.has('data-loading'),true);assert.equal(f.attributes.has('data-awaiting-explore'),false);
 f.advance(5300);const timer=createLoadTracker(f.window,{stage:'cinematic',startAt:f.window.__sofacetExperienceStart});
 f.advance(8000);timer.finish();assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.duration_ms,3000);
});

test('explicit comparisons and restored story/game positions retain automatic startup',async()=>{
 for(const options of [{url:'https://sofacet.com/?entrance=1'},{url:'https://sofacet.com/#experience'},{url:'https://sofacet.com/?perf=1'},{state:{sofacetWorldScroll:900}},{state:{sofacetGame:true}}]){
  const f=fixture(options);await turn();assert.equal(f.imports,1);assert.equal(f.window.__sofacetExperienceStart,undefined);
 }
});

test('a failed initial poster reports an asset failure while navigation stays available',async()=>{
 const f=fixture({decode:Promise.reject(Error('Image unavailable'))});await turn();
 assert.equal(f.window.__sofacetLoadMetrics.entries.at(-1).properties.load_outcome,'failed');assert.equal(f.main.inert,false);assert.equal(f.imports,0);
});

test('an unavailable cinematic module recovers through the existing standalone game route',async()=>{
 const f=fixture({load:()=>Promise.reject(Error('Module unavailable'))});f.click();await f.context.startExperience();assert.deepEqual(f.redirects,['/game']);
});
