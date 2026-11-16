import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {uploadSourceMaps} from '../scripts/upload-source-maps.mjs';

const environment={POSTHOG_CLI_HOST:'https://posthog.test',POSTHOG_CLI_PROJECT_ID:'0',POSTHOG_CLI_API_KEY:'phx_test_upload_never_sent'};
const chunkId='12345678-1234-5678-9abc-123456789abc';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const code='console.log("verified");\n//# chunkId='+chunkId+'\n';
const mapBytes=JSON.stringify({version:3,chunk_id:chunkId,sources:['fixture.js'],sourcesContent:['console.log("verified");'],names:[],mappings:'AAAA'});

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'sofacet-upload-fixture-')),directory=join(root,'work/source-maps/fixture'),file='assets/verified.js';
 const manifest={version:1,files:[{file,chunkId,sha256:hash(code),mapSha256:hash(mapBytes)}]};
 await mkdir(dirname(join(directory,file)),{recursive:true});await mkdir(join(root,'assets'),{recursive:true});
 await writeFile(join(root,file),code);await writeFile(join(directory,file),code);await writeFile(join(directory,file+'.map'),mapBytes);
 await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));
 return {root,directory,file,manifest};
}
async function filesBelow(directory){
 const files=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())files.push(...(await filesBelow(path)).map(file=>entry.name+'/'+file));else files.push(entry.name)}
 return files.sort();
}

test('upload selects a private snapshot of only validated pairs and never changes deployed/build bytes',async()=>{
 const f=await fixture();let staged;
 try{
  const extraId='aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa';
  await writeFile(join(f.directory,'extra.js'),code.replace('verified','unverified private source').replace(chunkId,extraId));await writeFile(join(f.directory,'extra.js.map'),mapBytes.replace(chunkId,extraId));
  let calls=0;
  await uploadSourceMaps({root:f.root,environment,log(){},runCli:async(args,options)=>{
   calls++;assert.deepEqual(args.slice(0,4),['sourcemap','upload','--release-mode','event']);
   assert.equal(args[4],'--directory');staged=args[5];assert.notEqual(staged,f.directory);
   assert.deepEqual(await filesBelow(staged),[f.file,f.file+'.map']);
   assert.equal(await readFile(join(staged,f.file),'utf8'),code);assert.equal(await readFile(join(staged,f.file+'.map'),'utf8'),mapBytes);
   assert.equal(options.env.POSTHOG_CLI_DRY_RUN,'false');assert.equal(options.timeout,120000);
   // Changes to an original directory after selection cannot broaden the scan.
   await writeFile(join(f.directory,'late.js'),'unverified later source');await writeFile(join(f.directory,'late.js.map'),mapBytes);
   assert.deepEqual(await filesBelow(staged),[f.file,f.file+'.map']);
  }});
  assert.equal(calls,1);await assert.rejects(readFile(join(staged,f.file)),{code:'ENOENT'});
  assert.equal(await readFile(join(f.root,f.file),'utf8'),code);assert.equal(await readFile(join(f.directory,f.file),'utf8'),code);assert.equal(await readFile(join(f.directory,f.file+'.map'),'utf8'),mapBytes);
  assert.deepEqual(JSON.parse(await readFile(join(f.directory,'manifest.json'),'utf8')),f.manifest);
 }finally{await rm(f.root,{recursive:true,force:true})}
});

test('all builds are verified before the first CLI upload, including public bytes and matching IDs',async()=>{
 for(const kind of ['private-code','private-map','public-code','chunk-id']){
  const f=await fixture();let calls=0;
  try{
   if(kind==='private-code')await writeFile(join(f.directory,f.file),code+'changed');
   if(kind==='private-map')await writeFile(join(f.directory,f.file+'.map'),mapBytes+' ');
   if(kind==='public-code')await writeFile(join(f.root,f.file),code+'changed');
   if(kind==='chunk-id'){
    const changedMap=mapBytes.replace(chunkId,'aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa');
    await writeFile(join(f.directory,f.file+'.map'),changedMap);f.manifest.files[0].mapSha256=hash(changedMap);await writeFile(join(f.directory,'manifest.json'),JSON.stringify(f.manifest));
   }
   await assert.rejects(uploadSourceMaps({root:f.root,environment,log(){},runCli:async()=>{calls++}}),/artifacts changed|Public bundle differs|IDs do not match/);
   assert.equal(calls,0,kind);
  }finally{await rm(f.root,{recursive:true,force:true})}
 }
 const f=await fixture();let calls=0;
 try{
  const later=join(f.root,'work/source-maps/zz-invalid');await mkdir(later);await writeFile(join(later,'manifest.json'),'{"version":1,"files":[]}');
  await assert.rejects(uploadSourceMaps({root:f.root,environment,log(){},runCli:async()=>{calls++}}),/Invalid private source-map manifest/);
  assert.equal(calls,0,'a bad later manifest cannot cause a partially uploaded build');
 }finally{await rm(f.root,{recursive:true,force:true})}
});

test('upload rejects traversal/duplicate selection and always cleans a failed upload snapshot',async()=>{
 for(const file of ['../outside.js','/outside.js','assets/../outside.js','assets\\outside.js','assets/verified.txt']){
  const f=await fixture();
  try{
   f.manifest.files[0].file=file;await writeFile(join(f.directory,'manifest.json'),JSON.stringify(f.manifest));
   await assert.rejects(uploadSourceMaps({root:f.root,environment,runCli:async()=>assert.fail('must not upload')}),/Invalid private source-map path/);
  }finally{await rm(f.root,{recursive:true,force:true})}
 }
 const f=await fixture();let staged;
 try{
  await assert.rejects(uploadSourceMaps({root:f.root,environment,log(){},runCli:async args=>{staged=args[5];throw Error('Local transport failed')}}),/Local transport failed/);
  await assert.rejects(readFile(join(staged,f.file)),{code:'ENOENT'});
  assert.equal(await readFile(join(f.root,f.file),'utf8'),code);
  f.manifest.files.push({...f.manifest.files[0]});await writeFile(join(f.directory,'manifest.json'),JSON.stringify(f.manifest));
  await assert.rejects(uploadSourceMaps({root:f.root,environment,runCli:async()=>assert.fail('must not upload')}),/Invalid private source-map path/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
