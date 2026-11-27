import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaticLandingCopy} from '../entrance-source/static-copy.mjs';

test('readable chapter copy follows forward and reverse video frames without the animation framework',()=>{
 const sections=[[0,240],[240,900],[900,1400],[1400,2200]].map(([from,until])=>({dataset:{from,until},style:{},setAttribute(name,value){this[name]=value}}));
 const copy=createStaticLandingCopy({querySelectorAll:()=>sections});
 assert.equal(sections[0]['aria-hidden'],'false');
 copy(1000);assert.equal(sections[0]['aria-hidden'],'false','The welcome remains until scrolling starts');
 copy.setScrolled(500);assert.equal(sections[2]['aria-hidden'],'false');assert.equal(sections[0]['aria-hidden'],'true');
 copy(600);assert.equal(sections[1]['aria-hidden'],'false');assert.equal(sections[2]['aria-hidden'],'true');
 copy.setScrolled(0);assert.equal(sections[0]['aria-hidden'],'false');assert.equal(sections[1].style.visibility,'hidden');
});
