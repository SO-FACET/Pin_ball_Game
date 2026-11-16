import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {SourceMap} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import {buildBrowserScripts,buildBrowserPage,injectSourceMaps,injectionEnvironment,sourceMapRevision,runSourceMapCli} from '../scripts/source-maps.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const original="export function explode() {\n  const reason = 'Source map fixture';\n  throw new Error(reason);\n}\n";
const fixtureEnvironment=sha=>({...process.env,GITHUB_ACTIONS:'true',GITHUB_SHA:sha,GITHUB_REF_NAME:'main',GITHUB_REPOSITORY:'private/repository',GITHUB_SERVER_URL:'https://github.com',VERCEL:'1',POSTHOG_RELEASE_ID:'private-release',POSTHOG_CLI_API_KEY:'phx_PRIVATE_MUST_NOT_APPEAR',POSTHOG_CLI_PROJECT_ID:'999',POSTHOG_CLI_DRY_RUN:'true',POSTHOG_CLI_DOTENV_FILE:'/private/never-read.env'});
const digest=value=>createHash('sha256').update(value).digest('hex');

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'sofacet-map-fixture-'));
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 await writeFile(join(root,'fixture.js'),original);
 await writeFile(join(root,'entry.js'),"import {explode} from './fixture.js';globalThis.throwMapped=explode;globalThis.loadLater=()=>import('./lazy.js');\n");
 await writeFile(join(root,'lazy.js'),"export const answer=42;\n");
 return root;
}
async function manifest(root,label){return JSON.parse(await readFile(join(root,'work/source-maps',label,'manifest.json'),'utf8'))}
async function assertMappedThrow(code,name,map,root){
 const context={};
 if(root){const file=join(root,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,code);await import(pathToFileURL(file).href);context.throwMapped=globalThis.throwMapped;delete globalThis.throwMapped;delete globalThis.loadLater}
 else vm.runInNewContext(code,context,{filename:name});
 let failure;try{context.throwMapped()}catch(error){failure=error}
 assert.equal(failure?.message,'Source map fixture');
 const frame=failure.stack.split('\n').find(line=>line.includes('at ')&&line.includes(name+':'));
 assert.ok(frame,'compiled exception includes its generated location');
 const [,line,column]=/:(\d+):(\d+)\)?$/.exec(frame);
 const location=new SourceMap(map).findEntry(Number(line)-1,Number(column)-1);
 assert.match(location.originalSource,/fixture\.js$/);
 assert.equal(location.originalLine,2,'the minified throw resolves to the original throw line');
 assert.equal(map.sourcesContent[map.sources.findIndex(source=>source.endsWith('fixture.js'))],original);
}

test('offline injector strips credentials, release/CI detection and dotenv configuration',()=>{
 const environment=injectionEnvironment(fixtureEnvironment('fake-sha'),'/private/tmp/stage');
 for(const key of ['GITHUB_ACTIONS','GITHUB_SHA','GITHUB_REPOSITORY','VERCEL','POSTHOG_RELEASE_ID','POSTHOG_CLI_DOTENV_FILE','POSTHOG_CLI_DRY_RUN'])assert.equal(key in environment,false,key);
 assert.equal(environment.POSTHOG_CLI_API_KEY,'phx_offline_source_map_injection');
 assert.equal(environment.POSTHOG_CLI_PROJECT_ID,'0');
 for(const key of ['POSTHOG_CLI_HOST','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY'])assert.equal(environment[key],'http://127.0.0.1:1');
});

test('a hung native CLI process is killed and its command rejects within the timeout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sofacet-cli-timeout-')),pidFile=join(root,'native.pid');
 try{
  const script="require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);";
  const started=Date.now();
  await assert.rejects(runSourceMapCli(['-e',script,pidFile],{cwd:root,env:injectionEnvironment(process.env,root),timeout:400,executable:process.execPath}),/command timed out/);
  assert.ok(Date.now()-started<1800,'the runner settles without waiting for inherited pipes');
  const pid=Number(await readFile(pidFile,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>0);
  let alive=true;
  for(let attempt=0;attempt<50&&alive;attempt++){
   try{process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,10))}catch(error){assert.equal(error.code,'ESRCH');alive=false}
  }
  assert.equal(alive,false,'the actual native child is gone, not just its wrapper');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('a missing installed native CLI fails locally without an npm download fallback',async()=>{
 await assert.rejects(runSourceMapCli(['--version'],{executable:join(tmpdir(),'sofacet-cli-that-does-not-exist'),timeout:1000}),/Could not start the installed PostHog source-map CLI/);
});

test('real esbuild output is deterministic across directories/CI SHAs, private and symbolicates after injection',async()=>{
 const roots=await Promise.all([fixture(),fixture()]);
 try{
  const results=[];
  for(const [index,root] of roots.entries())results.push(await buildBrowserScripts({entryPoints:['entry.js'],bundle:true,format:'iife',minify:true,target:'es2020',outdir:'assets',entryNames:'fixture-[hash]'},{root,label:'fixture-esbuild',environment:fixtureEnvironment(index?'bbbb':'aaaa')}));
  const names=results.map(result=>result.outputFiles.map(file=>basename(file.path)));
  assert.deepEqual(names[0],names[1]);assert.ok(names[0].every(name=>name.includes(sourceMapRevision)&&!name.endsWith('.map')));
  const manifests=await Promise.all(roots.map(root=>manifest(root,'fixture-esbuild')));assert.deepEqual(manifests[0],manifests[1]);
  const first=manifests[0].files[0],codes=await Promise.all(roots.map(root=>readFile(join(root,first.file),'utf8')));assert.equal(codes[0],codes[1]);
  assert.doesNotMatch(codes[0],/PRIVATE_MUST_NOT_APPEAR|private-release|_posthogReleaseId|sourceMappingURL\s*=|sourcesContent/);
  for(const root of roots)await assert.rejects(readFile(join(root,first.file+'.map')),{code:'ENOENT'});
  const code=await readFile(join(roots[0],'work/source-maps/fixture-esbuild',first.file));
  const mapBytes=await readFile(join(roots[0],'work/source-maps/fixture-esbuild',first.file+'.map'));
  assert.equal(digest(code),first.sha256);assert.equal(digest(mapBytes),first.mapSha256);
  const map=JSON.parse(mapBytes);assert.equal(map.chunk_id,first.chunkId);await assertMappedThrow(codes[0],first.file,map);
  const repeated=await injectSourceMaps([{name:first.file,contents:code},{name:first.file+'.map',contents:mapBytes}],{root:roots[0],label:'fixture-esbuild',environment:fixtureEnvironment('cccc')});
  assert.deepEqual(repeated[0].contents,code);assert.deepEqual(await manifest(roots[0],'fixture-esbuild'),manifests[0],'re-injection is byte-idempotent');
 }finally{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})))}
});

test('real Vite8 split chunks keep deterministic names/bytes and resolve the original error',async()=>{
 const roots=await Promise.all([fixture(),fixture()]);
 try{
  const outputs=[];
  for(const [index,root] of roots.entries()){
   const result=await buildBrowserPage({configFile:false,root,publicDir:false,base:'/',logLevel:'silent',build:{modulePreload:false,rollupOptions:{input:join(root,'entry.js'),output:{entryFileNames:'assets/vite-[hash].js',chunkFileNames:'assets/vite-chunk-[hash].js',assetFileNames:'assets/vite-[hash][extname]'}}}},{root,label:'fixture-vite',environment:fixtureEnvironment(index?'ffff':'eeee')});
   outputs.push(result.output);
  }
  const normalized=output=>output.map(file=>({name:file.fileName,code:file.type==='chunk'?file.code:String(file.source)})).sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(normalized(outputs[0]),normalized(outputs[1]));
  assert.ok(outputs[0].filter(file=>file.type==='chunk').length>=2,'dynamic import produces a mapped split chunk');
  assert.ok(outputs[0].every(file=>!file.fileName.endsWith('.map')));
  const manifests=await Promise.all(roots.map(root=>manifest(root,'fixture-vite')));assert.deepEqual(manifests[0],manifests[1]);
  for(const file of manifests[0].files){
   const output=outputs[0].find(chunk=>chunk.fileName===file.file),map=JSON.parse(await readFile(join(roots[0],'work/source-maps/fixture-vite',file.file+'.map'),'utf8'));
   assert.equal(map.chunk_id,file.chunkId);assert.equal(digest(output.code),file.sha256);assert.ok(file.file.includes(sourceMapRevision));
   assert.doesNotMatch(output.code,/PRIVATE_MUST_NOT_APPEAR|private-release|_posthogReleaseId|sourceMappingURL\s*=/);
   if(output.isEntry)await assertMappedThrow(output.code,file.file,map,roots[0]);
  }
 }finally{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})))}
});

test('missing maps, absolute source paths and output traversal fail before public files are written',async()=>{
 const root=await fixture();
 try{
  await assert.rejects(injectSourceMaps([{name:'assets/test.js',contents:'alert(1)'}],{root,label:'invalid'}),/missing its private source map/);
  const map={version:3,mappings:'AAAA',sources:['/private/customer/source.js'],sourcesContent:['private'],names:[]};
  await assert.rejects(injectSourceMaps([{name:'assets/test.js',contents:'alert(1)'},{name:'assets/test.js.map',contents:JSON.stringify(map)}],{root,label:'invalid'}),/absolute source path/);
  await assert.rejects(injectSourceMaps([{name:'../outside.js',contents:'alert(1)'}],{root,label:'invalid'}),/output path/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('actual server denies existing map aliases for GET, HEAD, range and encoded paths',async()=>{
 const data=await mkdtemp(join(tmpdir(),'sofacet-map-http-')),stem='source-map-guard-'+process.pid,aliases=[];
 // These aliases contain an already-public script, never a private source map.
 for(const suffix of ['.map','.map.br','.map.gz']){const path=join(repository,'assets',stem+suffix);await symlink('game-loader.js',path);aliases.push(path)}
 const child=spawn(process.execPath,['server.mjs'],{cwd:repository,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,POSTHOG_ENABLED:'false',ARTWORK_CDN_BASE_URL:''},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='',timer;
 child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 try{
  const origin=await Promise.race([new Promise(accept=>child.stdout.on('data',()=>{const url=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];if(url)accept(url)})),exited.then(()=>{throw Error('Fixture server exited: '+output)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fixture server did not start')),10000);timer.unref()})]);
  assert.equal((await fetch(origin+'/assets/game-loader.js')).status,200);
  for(const suffix of ['.map','.map.br','.map.gz'])for(const options of [{},{method:'HEAD'},{headers:{Range:'bytes=0-20'}}]){
   assert.equal((await fetch(origin+'/assets/'+stem+suffix,options)).status,404);
   assert.equal((await fetch(origin+'/assets/'+stem+suffix.replace('.map','%2emap'),options)).status,404);
  }
  assert.equal((await fetch(origin+'/work/source-maps/fixture/manifest.json')).status,404);
 }finally{clearTimeout(timer);child.kill('SIGTERM');await exited;await Promise.all(aliases.map(path=>rm(path,{force:true})));await rm(data,{recursive:true,force:true})}
});
