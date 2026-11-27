import {brotliCompress,gzip,constants} from 'node:zlib';
import {promisify} from 'node:util';

const br=promisify(brotliCompress),gz=promisify(gzip);
export const textAsset=path=>/\.(?:html|js|mjs|css|json|svg|txt|xml)$/.test(path);
export function staticCacheControl(path,parameters){
 if(/\.(?:html|json)$/.test(path))return 'no-cache';
 if(/-ph[a-f0-9]{10}\.js$|^assets\/sofacet-.+-[\w-]{8}\.css$|[a-f0-9]{12,64}\.(?:webp|png|jpg|svg)$/.test(path)||/^(?:[\w-]*-)?[a-f0-9]{8,64}$/.test(parameters?.get('v')||''))return 'public, max-age=31536000, immutable';
 return /^(?:assets|sounds|vendor)\//.test(path)&&!path.endsWith('.json')?'public, max-age=3600':'no-cache';
}
function encoding(header){
 const quality=new Map(String(header||'').toLowerCase().split(',').map(item=>{
  const [name,...options]=item.trim().split(';');
  const q=options.find(value=>value.trim().startsWith('q='));
  return [name,q?Math.max(0,Math.min(1,Number(q.trim().slice(2))||0)):1];
 }));
 const q=name=>quality.get(name)??quality.get('*')??0;
 return q('br')>0&&q('br')>=q('gzip')?'br':q('gzip')>0?'gzip':null;
}
// Cache only compressed representations, with a fixed per-process memory budget.
export function createStaticTextSender({budget=8*1024*1024}={}){
 const cache=new Map();let bytes=0;
 return async function send(request,response,{body,status=200,type,cacheControl='no-cache',key}){
  const input=Buffer.isBuffer(body)?body:Buffer.from(body);
  const format=input.length>=512?encoding(request.headers['accept-encoding']):null;
  let output=input;
  if(format){
   const cacheKey=key&&key+':'+format;
   if(cacheKey&&cache.has(cacheKey)){output=cache.get(cacheKey);cache.delete(cacheKey);cache.set(cacheKey,output)}
   else{
    output=await (format==='br'?br(input,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):gz(input));
    if(cacheKey&&output.length<=budget){
     while(bytes+output.length>budget&&cache.size){const first=cache.keys().next().value;bytes-=cache.get(first).length;cache.delete(first)}
     // Concurrent first requests can finish for the same representation.
     if(cache.has(cacheKey))bytes-=cache.get(cacheKey).length;
     cache.set(cacheKey,output);bytes+=output.length;
    }
   }
  }
  response.writeHead(status,{'Content-Type':type,'Content-Length':output.length,'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff',Vary:'Accept-Encoding',...(format?{'Content-Encoding':format}:{})});
  response.end(request.method==='HEAD'?undefined:output);
 };
}
