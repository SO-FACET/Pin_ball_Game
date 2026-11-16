import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,mkdtemp,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runSourceMapCli} from './source-maps.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const idPattern=/^\/\/# chunkId=([a-f0-9-]{36})$/m;

export async function uploadSourceMaps({root=repository,environment=process.env,runCli=runSourceMapCli,log=console.log}={}){
 for(const key of ['POSTHOG_CLI_HOST','POSTHOG_CLI_PROJECT_ID','POSTHOG_CLI_API_KEY'])if(!environment[key]?.trim())throw Error(key+' is required to upload private source maps.');
 const host=new URL(environment.POSTHOG_CLI_HOST);
 if(host.protocol!=='https:'||host.pathname!=='/'||host.username||host.password||host.search||host.hash)throw Error('Source-map upload host must be an HTTPS origin.');
 root=await realpath(root);
 const directory=resolve(root,'work/source-maps');
 const builds=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
 if(!builds.length)throw Error('No private source-map builds exist. Run npm run build first.');
 const stage=await mkdtemp(join(tmpdir(),'sofacet-map-upload-'));
 try{
  const uploads=[];
  // Validate and snapshot every pair before the first upload. The CLI receives
  // fresh directories containing only those exact bytes, never an original
  // build directory where additional unverified pairs might have appeared.
  for(const build of builds){
   if(!/^[a-z0-9-]+$/.test(build))throw Error('Invalid private source-map build label.');
   const manifest=JSON.parse(await readFile(join(directory,build,'manifest.json'),'utf8'));
   if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Invalid private source-map manifest.');
   const selected=new Set();
   for(const file of manifest.files){
    if(typeof file?.file!=='string'||isAbsolute(file.file)||file.file.includes(':')||file.file.includes('\\')||file.file.split('/').some(part=>!part||part==='.'||part==='..')||!/\.(?:js|mjs|cjs)$/.test(file.file)||selected.has(file.file))throw Error('Invalid private source-map path.');
    selected.add(file.file);
    const path=join(directory,build,file.file);
    const [code,mapBytes,publicCode]=await Promise.all([readFile(path),readFile(path+'.map'),readFile(resolve(root,file.file))]);
    if(hash(code)!==file.sha256||hash(mapBytes)!==file.mapSha256)throw Error('Private source-map artifacts changed after the verified build.');
    if(hash(publicCode)!==file.sha256)throw Error('Public bundle differs from its private source map. Rebuild before uploading.');
    const id=String(code).match(idPattern)?.[1],map=JSON.parse(mapBytes);
    if(!id||id!==file.chunkId||id!==(map.chunk_id||map.chunkId||map.debugId))throw Error('Private source-map IDs do not match the verified browser bundle.');
    const destination=join(stage,build,file.file);await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,code);await writeFile(destination+'.map',mapBytes);
   }
   uploads.push({build,count:manifest.files.length,directory:join(stage,build)});
  }
  for(const upload of uploads){
   // Upload never processes or deletes files: the deployed bytes stay identical.
   await runCli(['sourcemap','upload','--release-mode','event','--directory',upload.directory],{cwd:root,env:{...environment,CI:'1',POSTHOG_CLI_DRY_RUN:'false'},timeout:120000});
   log('Uploaded private source maps: '+upload.build+' ('+upload.count+' chunks)');
  }
 }finally{await rm(stage,{recursive:true,force:true})}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await uploadSourceMaps();
