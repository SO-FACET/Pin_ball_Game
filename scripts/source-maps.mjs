import {build as esbuild} from 'esbuild-wasm';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,delimiter,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=fileURLToPath(new URL('../',import.meta.url));
const cliPackage=JSON.parse(readFileSync(new URL('../node_modules/@posthog/cli/package.json',import.meta.url),'utf8'));
// The npm wrapper uses spawnSync to launch this installed native artifact. Run
// it directly so a timeout terminates the actual injector/uploader, not a wrapper
// that can leave the native process and its inherited pipes alive. Missing
// artifacts fail locally; builds never download a CLI binary on demand.
const cli=fileURLToPath(new URL('../node_modules/@posthog/cli/node_modules/.bin_real/'+(process.platform==='win32'?'posthog-cli.exe':'posthog-cli'),import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
// An injector change must also change the cache key of otherwise unchanged chunks.
export const sourceMapRevision='ph'+hash(cliPackage.version+'\0'+readFileSync(fileURLToPath(import.meta.url))).slice(0,10);
const scriptPattern=/\.(?:js|mjs|cjs)$/;
const mapPattern=/\.map$/;
const idPattern=/^\/\/# chunkId=([a-f0-9-]{36})$/m;

function safeName(name){
 if(!name||isAbsolute(name)||name.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('Invalid source-map output path.');
 return name.split(sep).join('/');
}
function parseMap(contents){
 const map=JSON.parse(String(contents));
 if(map.version!==3||typeof map.mappings!=='string'||!Array.isArray(map.sources)||!Array.isArray(map.sourcesContent)||map.sourcesContent.length!==map.sources.length)throw Error('Browser source map is incomplete.');
 if(map.sourceRoot&&(/^(?:[a-z]+:|\/|\\)/i.test(map.sourceRoot)))throw Error('Absolute source-map sourceRoot is not allowed.');
 if(map.sources.some(source=>typeof source!=='string'||/^(?:[a-z]+:|\/|\\)/i.test(source)))throw Error('Browser source map contains an absolute source path.');
 // Some published SDK maps omit their original sources. Preserve that valid v3
 // representation, while requiring complete application sources. Canonicalize
 // vendor paths so a publisher's build-machine layout cannot affect our maps.
 map.sources=map.sources.map(source=>{const parts=source.replaceAll('\\','/').split('/'),index=parts.lastIndexOf('node_modules');return index<0?source:parts.slice(index).join('/')});
 if(map.sourcesContent.some((source,index)=>typeof source!=='string'&&!(source===null&&map.sources[index].startsWith('node_modules/'))))throw Error('Browser source map is missing application source.');
 return map;
}

export function injectionEnvironment(environment,stage){
 // Never inherit credentials, release metadata, Git/CI detection, or dotenv files.
 // CLI0.20 requires credentials even for local injection: these deliberately fake
 // values satisfy parsing. Both API and proxy URLs are loopback-only; no upload runs.
 const env={PATH:dirname(process.execPath)+delimiter+(environment.PATH||''),POSTHOG_HOME:join(stage,'.cli'),POSTHOG_CLI_API_KEY:'phx_offline_source_map_injection',POSTHOG_CLI_PROJECT_ID:'0',POSTHOG_CLI_HOST:'http://127.0.0.1:1',POSTHOG_ANALYTICS_HOST:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'',RUST_LOG:'error'};
 for(const key of ['SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL'])if(environment[key])env[key]=environment[key];
 return env;
}

export function runSourceMapCli(args,{cwd,env,timeout=30000,executable=cli}={}){
 return new Promise((accept,reject)=>{
  const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  let output='',timer,settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else accept()};
  const append=data=>{output=(output+data.toString()).slice(-4000)};
  child.stdout.on('data',append);child.stderr.on('data',append);
  child.once('error',()=>finish(Error('Could not start the installed PostHog source-map CLI. Run npm ci before building.')));
  child.once('close',(code,signal)=>finish(code===0?null:Error('PostHog source-map command failed'+(signal?' ('+signal+')':'')+': '+output)));
  timer=setTimeout(()=>{
   child.kill('SIGKILL');
   child.stdout.destroy();child.stderr.destroy();
   finish(Error('PostHog source-map command timed out.'));
  },timeout);timer.unref();
 });
}

/** Transform in-memory compiler output; maps only ever touch private directories. */
export async function injectSourceMaps(files,{root=repository,label,environment=process.env}={}){
 if(!/^[a-z0-9-]+$/.test(label||''))throw Error('A stable source-map build label is required.');
 root=await realpath(root);
 const entries=files.map(file=>({name:safeName(file.name),contents:Buffer.from(file.contents)}));
 const byName=new Map(entries.map(file=>[file.name,file]));
 if(byName.size!==entries.length)throw Error('Duplicate source-map output path.');
 const scripts=entries.filter(file=>scriptPattern.test(file.name));
 if(!scripts.length)throw Error('Browser build produced no JavaScript to map.');
 for(const file of scripts){
  const map=byName.get(file.name+'.map');if(!map)throw Error('Browser bundle is missing its private source map: '+file.name);
  parseMap(map.contents);
  if(/sourceMappingURL\s*=\s*data:/.test(String(file.contents)))throw Error('Inline browser source maps are forbidden.');
 }
 for(const file of entries.filter(file=>mapPattern.test(file.name)))if(!byName.has(file.name.slice(0,-4)))throw Error('Unpaired browser source map.');
 const stage=await mkdtemp(join(tmpdir(),'sofacet-source-maps-'));
 try{
  for(const file of scripts){
   const destination=join(stage,file.name);await mkdir(dirname(destination),{recursive:true});
   await writeFile(destination,file.contents);await writeFile(destination+'.map',JSON.stringify(parseMap(byName.get(file.name+'.map').contents)));
  }
  await runSourceMapCli(['sourcemap','inject','--release-mode','event','--directory',stage],{cwd:stage,env:injectionEnvironment(environment,stage)});
  const manifest={version:1,cliVersion:cliPackage.version,revision:sourceMapRevision,files:[]};
  const privateDirectory=join(root,'work','source-maps',label);
  await rm(privateDirectory,{recursive:true,force:true});await mkdir(privateDirectory,{recursive:true});
  for(const file of scripts.sort((a,b)=>a.name.localeCompare(b.name))){
   const code=await readFile(join(stage,file.name)),mapBytes=await readFile(join(stage,file.name+'.map'));
   const id=String(code).match(idPattern)?.[1],map=parseMap(mapBytes);
   if(!id||id!==(map.chunk_id||map.chunkId||map.debugId))throw Error('Injected source-map ID does not match its browser bundle.');
   if(/e\._posthogReleaseId=e\._posthogReleaseId\|\||\/\/[#@]\s*sourceMappingURL\s*=/.test(String(code)))throw Error('Browser bundle unexpectedly carries release metadata or a public source-map reference.');
   file.contents=code;
   const destination=join(privateDirectory,file.name);await mkdir(dirname(destination),{recursive:true});
   await writeFile(destination,code);await writeFile(destination+'.map',mapBytes);
   manifest.files.push({file:file.name,chunkId:id,sha256:hash(code),mapSha256:hash(mapBytes)});
  }
  await writeFile(join(privateDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return entries.filter(file=>!mapPattern.test(file.name));
 }finally{await rm(stage,{recursive:true,force:true})}
}

export async function buildBrowserScripts(options,{root=repository,label,environment}={}){
 root=await realpath(root);
 const names={};for(const name of ['entryNames','chunkNames'])if(options[name])names[name]=options[name]+'-'+sourceMapRevision;
 const result=await esbuild({...options,...names,absWorkingDir:root,write:false,sourcemap:'external',sourcesContent:true});
 const files=await injectSourceMaps(result.outputFiles.map(file=>({name:relative(root,file.path),contents:file.contents})),{root,label,environment});
 for(const file of files){const path=resolve(root,file.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.contents)}
 result.outputFiles=files.map(file=>({path:resolve(root,file.name),contents:file.contents,get text(){return this.contents.toString()}}));
 return result;
}

export async function buildBrowserPage(config,{root=repository,label=basename(config.root),environment}={}){
 const {build}=await import('vite');
 const output={...config.build?.rollupOptions?.output};
 for(const key of ['entryFileNames','chunkFileNames'])if(typeof output[key]==='string')output[key]=output[key].replace(/(\.(?:mjs|cjs|js))$/,'-'+sourceMapRevision+'$1');
 const result=await build({...config,build:{...config.build,write:false,sourcemap:'hidden',rollupOptions:{...config.build?.rollupOptions,output}}});
 if(Array.isArray(result)||!result.output)throw Error('Expected one browser bundle output.');
 const files=await injectSourceMaps(result.output.map(file=>({name:file.fileName,contents:file.type==='asset'?file.source:file.code})),{root,label,environment});
 const publicFiles=new Map(files.map(file=>[file.name,file.contents]));
 const publicOutput=result.output.filter(file=>!mapPattern.test(file.fileName)).map(file=>file.type==='asset'
  ?{...file,source:typeof file.source==='string'?publicFiles.get(file.fileName).toString():publicFiles.get(file.fileName)}
  :{...file,code:publicFiles.get(file.fileName).toString()});
 return {...result,output:publicOutput};
}
