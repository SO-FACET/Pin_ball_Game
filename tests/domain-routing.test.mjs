import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function withDomainSite(appOrigin,check){
 const directory=await mkdtemp(join(tmpdir(),'sofacet-domain-test-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:directory,APP_ORIGIN:appOrigin,ARTWORK_CDN_BASE_URL:'',REWARDS_API_KEY:'',REWARDS_ADMIN_SECRET:''},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});
 try{
  const origin=await Promise.race([
   new Promise(resolve=>child.stdout.on('data',()=>{const url=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];if(url)resolve(url)})),
   exited.then(()=>{throw Error('Domain fixture stopped: '+output)}),
   new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Domain fixture startup timed out')),10000);timer.unref()})
  ]);
  const port=new URL(origin).port;
  const request=(host,path='/',{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,...headers}},res=>{
    let body='';res.setEncoding('utf8');res.on('data',data=>{body+=data});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
   });req.on('error',reject);req.end(body);
  });
  await check(request);
 }finally{child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})}
}

test('launch aliases redirect safe requests to the primary domain with the path and query intact',async()=>{
 await withDomainSite('https://sofacet.com',async request=>{
  for(const host of ['www.sofacet.com','shopsofacet.com','WWW.SOFACET.COM:443'])for(const method of ['GET','HEAD']){
   const path='/game?from=score&next=%2Fclaim',response=await request(host,path,{method});
   assert.equal(response.status,308);
   assert.equal(response.headers.location,'https://sofacet.com'+path);
   assert.equal(response.headers['cache-control'],'no-cache');
   assert.equal(response.body,'');
  }
  const encoded=await request('shopsofacet.com','/contact?message=a%20b%26c');
  assert.equal(encoded.headers.location,'https://sofacet.com/contact?message=a%20b%26c');
 });
});

test('the primary domain, Railway health checks and preview URLs never redirect to an alias',async()=>{
 await withDomainSite('https://sofacet.com',async request=>{
  for(const host of ['sofacet.com','facet-pinball-production.up.railway.app','127.0.0.1','www.sofacet.com.evil.test']){
   const page=await request(host,'/game');assert.equal(page.status,200);assert.equal(page.headers.location,undefined);
   const health=await request(host,'/health');assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{status:'ok'});
   const config=await request(host,'/api/media-config');assert.equal(config.status,200);assert.equal(config.headers.location,undefined);
  }
  const forwarded=await request('facet-pinball-production.up.railway.app','/game',{headers:{'X-Forwarded-Host':'www.sofacet.com'}});
  assert.equal(forwarded.status,200,'only the actual request host chooses a launch alias');
 });
});

test('launch redirects stay disabled until the new APP_ORIGIN is active',async()=>{
 for(const appOrigin of ['https://shopsofacet.com',''])await withDomainSite(appOrigin,async request=>{
  for(const host of ['shopsofacet.com','www.sofacet.com']){
   const page=await request(host,'/game');assert.equal(page.status,200);assert.equal(page.headers.location,undefined);
  }
 });
});

test('domain redirects do not broaden POST origins or forward unsafe requests',async()=>{
 await withDomainSite('https://sofacet.com',async request=>{
  for(const origin of ['https://shopsofacet.com','https://www.sofacet.com','https://sofacet.com.evil.test','http://sofacet.com',undefined]){
   const response=await request('shopsofacet.com','/api/first-cuts',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:'{}'});
   assert.equal(response.status,403);assert.equal(response.headers.location,undefined);
  }
  const accepted=await request('sofacet.com','/api/first-cuts',{method:'POST',headers:{Origin:'https://sofacet.com','Content-Type':'application/json'},body:'{}'});
  assert.equal(accepted.status,400,'a canonical-origin request reaches form validation');
  assert.match(JSON.parse(accepted.body).message,/full name/i);
  const unsupported=await request('www.sofacet.com','/game',{method:'DELETE'});
  assert.equal(unsupported.status,405);assert.equal(unsupported.headers.location,undefined);
 });
});
