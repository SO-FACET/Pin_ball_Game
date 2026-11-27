import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {brotliCompressSync} from 'node:zlib';
import {staticCacheControl} from '../static-text.mjs';

test('HTTP model compression preserves bytes, progress length, HEAD, ranges and identity clients',async()=>{
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const assets=await mkdtemp(new URL('../assets/compression-test-',import.meta.url));
 const data=await mkdtemp(join(tmpdir(),'sofacet-compression-'));
 const payload=Buffer.from('A model buffer with repeated geometry metadata.\n'.repeat(100));
 const encoded=brotliCompressSync(payload),file=join(assets,'model.glb');
 await writeFile(file,payload);await writeFile(file+'.br',encoded);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit'),url=`http://127.0.0.1:${port}/assets/${basename(assets)}/model.glb`;
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')})]);
  const compressed=await fetch(url,{headers:{'Accept-Encoding':'br, gzip'}});
  assert.equal(compressed.headers.get('content-encoding'),'br');
  assert.equal(compressed.headers.get('content-length'),String(encoded.length));
  assert.equal(compressed.headers.get('x-uncompressed-length'),String(payload.length));
  assert.equal(compressed.headers.get('vary'),'Accept-Encoding');
  assert.deepEqual(Buffer.from(await compressed.arrayBuffer()),payload);
  const head=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':'br'}});
  assert.equal(head.headers.get('content-length'),String(encoded.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(url,{headers:{'Accept-Encoding':'br',Range:'bytes=5-19'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-encoding'),null);assert.equal(range.headers.get('content-range'),`bytes 5-19/${payload.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),payload.subarray(5,20));
  for(const encoding of ['identity','gzip','br;q=0, gzip']){
   const original=await fetch(url,{headers:{'Accept-Encoding':encoding}});
   assert.equal(original.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await original.arrayBuffer()),payload);
  }
  await utimes(file+'.br',new Date(0),new Date(0));
  const stale=await fetch(url,{headers:{'Accept-Encoding':'br'}});
  assert.equal(stale.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await stale.arrayBuffer()),payload);
 }finally{child.kill('SIGTERM');await exited;await rm(assets,{recursive:true,force:true});await rm(data,{recursive:true,force:true});}
});

test('static text compresses negotiated responses while preserving HEAD, ranges and immutable versions',async()=>{
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const assets=await mkdtemp(new URL('../assets/compression-test-',import.meta.url));
 const data=await mkdtemp(join(tmpdir(),'sofacet-text-'));
 const payload=Buffer.from('window.example="Repeated application source";\n'.repeat(100));
 await writeFile(join(assets,'script.js'),payload);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit'),origin=`http://127.0.0.1:${port}`,url=origin+`/assets/${basename(assets)}/script.js?v=abcdef123456`;
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')})]);
  for(const [accept,expected] of [['br, gzip','br'],['br;q=0, gzip','gzip'],['br;q=0.2, gzip;q=1','gzip'],['identity',null]]){
   const response=await fetch(url,{headers:{'Accept-Encoding':accept}});
   assert.equal(response.headers.get('content-encoding'),expected);
   assert.equal(response.headers.get('vary'),'Accept-Encoding');
   assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload);
   const head=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':accept}});
   assert.equal(head.headers.get('content-length'),response.headers.get('content-length'));assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  const range=await fetch(url,{headers:{'Accept-Encoding':'br',Range:'bytes=5-19'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-encoding'),null);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),payload.subarray(5,20));
  const page=await fetch(origin+'/privacy',{headers:{'Accept-Encoding':'br'}});
  assert.equal(page.headers.get('content-encoding'),'br');assert.equal(page.headers.get('cache-control'),'no-cache');assert.match(await page.text(),/sofacet-artwork-cdn/);
  assert.equal(staticCacheControl('assets/sofacet-game-C02RnEet-ph2ac3af20ed.js'),'public, max-age=31536000, immutable');
  assert.equal(staticCacheControl('assets/entrance-video/manifest.json'),'no-cache');
  assert.equal(staticCacheControl('entrance-3d.html',new URLSearchParams('v=abcdef123456')),'no-cache');
  assert.equal(staticCacheControl('assets/entrance-video/manifest.json',new URLSearchParams('v=abcdef123456')),'no-cache');
  assert.equal(staticCacheControl('sounds/example.mp3'),'public, max-age=3600');
 }finally{child.kill('SIGTERM');await exited;await rm(assets,{recursive:true,force:true});await rm(data,{recursive:true,force:true});}
});
