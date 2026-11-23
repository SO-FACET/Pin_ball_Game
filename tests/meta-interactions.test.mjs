import test from 'node:test';
import assert from 'node:assert/strict';
import {installMetaInteractions,trackMetaEvent} from '../shared/meta-events.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('entry buttons and links bridge to the top pixel without form values',()=>{
 const calls=[];let handler;
 const top={sofacetMetaPixel:{track:(...args)=>calls.push(args)}};
 const win={top,location:new URL('https://sofacet.com/join'),document:{addEventListener:(name,fn)=>handler=fn}};
 installMetaInteractions(win);
 const click=element=>handler({target:{closest:()=>element}});
 click({id:'create-tab',tagName:'BUTTON'});click({id:'registered-tab',tagName:'BUTTON'});
 click({tagName:'A',href:'https://sofacet.com/join'});click({tagName:'A',href:'https://elsewhere.test/join'});
 assert.deepEqual(calls,[['JoinCollectiveClick'],['LoginClick'],['JoinCollectiveClick']]);
});
test('repeated submissions while in flight create only one Lead; retry is a separate attempt',async()=>{
 const source=readFileSync(new URL('../collective-source/form-actions.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replaceAll('export function','function');
 const context={useState:value=>[value,()=>{}],useRef:current=>({current})};
 vm.runInNewContext(source+';this.submission=useSubmission()',context);
 let release;const pending=new Promise(r=>release=r);let calls=0,leads=0;
 const handler=async()=>{calls++;await pending};
 const first=context.submission.submit(handler,{},'',()=>leads++);
 await context.submission.submit(handler,{},'',()=>leads++);
 assert.equal(calls,1);assert.equal(leads,1);release();await first;
 await context.submission.submit(async()=>{}, {},'',()=>leads++);assert.equal(leads,2);
 await context.submission.submit(null,{},'',()=>leads++);assert.equal(leads,2);
});
