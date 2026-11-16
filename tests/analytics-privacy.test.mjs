import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReplayUrl,safeReplayText,safeReplayAttribute,safeReplayRequest,safeCanvasRegions,sanitizeException,safeInlineStyle} from '../analytics-source/privacy.js';

const origin='https://sofacet.com';
test('replay Meta remains usable while URLs and network entries drop sensitive content',()=>{
 const meta=safeReplayRequest({name:origin+'/game?email=private@example.com#token'},origin);
 assert.deepEqual(meta,{name:origin+'/game'});
 assert.equal(safeReplayUrl('javascript:alert(1)',origin),'');
 assert.equal(safeReplayUrl('https://private.example/customer',origin),'');
 const network=safeReplayRequest({name:origin+'/api/account/session?token=secret',method:'GET',status:200,duration:12,requestHeaders:{Authorization:'secret'},responseBody:{name:'Private Member'},body:'private'},origin);
 assert.deepEqual(network,{name:origin+'/api/account/session',duration:12,method:'GET',status:200});
 assert.equal(safeReplayRequest({body:'private'},origin),null);
 for(const path of ['/assets/avatar/9876543210.png','/assets/uploads/customer-photo.png','/assets/private/profile.png','/assets/user/eyJhbGciOiJIUzI1NiJ9_secret1234567890123456789.png'])assert.doesNotMatch(safeReplayUrl(path,origin),/9876543210|customer-photo|profile\.png|eyJhb/);
 assert.equal(safeReplayUrl('/assets/sofacet-share-20261114-v2.jpg',origin),origin+'/assets/sofacet-share-20261114-v2.jpg');
});
test('public layout state, numeric placement and authored asset styles survive masking',()=>{
 assert.equal(safeReplayAttribute('data-ready','false',origin),'false');
 assert.equal(safeReplayAttribute('data-game','visible',origin),'visible');
 assert.equal(safeReplayAttribute('href','/style.css?v=public',origin),origin+'/style.css');
 assert.equal(safeReplayUrl('https://media.sofacet.com/artwork/collective/flower.webp?v=public',origin),'https://media.sofacet.com/artwork/collective/flower.webp');
 assert.equal(safeInlineStyle('position:fixed;top:12px;transform:scaleX(0.123456);opacity:.5'),'position:fixed;top:12px;transform:scaleX(0.1235);opacity:0.5');
 assert.equal(safeInlineStyle('background:url(https://private.test/?secret);content:"Private Member";--customer:919876543210'),'');
});
test('replay shows only fixed public labels and masks inputs, private attributes and unknown canvas pixels',()=>{
 assert.equal(safeReplayText('Play pinball'),'Play pinball');
 assert.equal(safeReplayText('Private Member'),'******* ******');
 assert.equal(safeReplayAttribute('value','012345',origin),'[redacted]');
 assert.equal(safeReplayAttribute('data-name','Private Member',origin),'[redacted]');
 const canvas={tagName:'CANVAS',id:'game',closest:selector=>selector==='#viewport'||selector==='#stage'};
 assert.deepEqual(safeCanvasRegions(canvas),[]);
 assert.equal(safeCanvasRegions({...canvas,id:'customer-avatar'}),null);
 assert.equal(safeCanvasRegions({...canvas,closest:()=>true}),null);
});
test('sanitized exceptions preserve large first-party source coordinates without custom data or query strings',()=>{
 const error=Object.assign(new TypeError('Invalid token for private@example.com OTP 012345'),{cause:{name:'Private Member'}});
 error.stack='TypeError: private@example.com\n    at load ('+origin+'/assets/game-ABC123.js?token=secret:7:328765)\n    at https://external.test/private?email=private@example.com:1:123456';
 const safe=sanitizeException(error,origin);
 assert.match(safe.stack,/game-ABC123\.js:7:328765/);
 assert.doesNotMatch(JSON.stringify({message:safe.message,stack:safe.stack,...safe}),/private@example|012345|token=secret|Private Member|external\.test/);
 assert.equal(safe.cause,undefined);assert.equal(safe.name,'TypeError');
});
