// Preloaded only by server telemetry integration tests. Never make a network
// request; persist the SDK's actual outgoing payload for assertions instead.
import {appendFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

globalThis.fetch=async(input,options={})=>{
 const url=typeof input==='string'?input:input.url;
 if(new URL(url).hostname!=='posthog.test')throw new Error('Unexpected network request in telemetry fixture');
 const headers=new Headers(options.headers),body=headers.get('content-encoding')==='gzip'?gunzipSync(options.body).toString():String(options.body);
 appendFileSync(process.env.POSTHOG_TEST_CAPTURE_FILE,JSON.stringify({url,payload:JSON.parse(body)})+'\n');
 return new Response(JSON.stringify({status:1}),{status:200,headers:{'Content-Type':'application/json'}});
};
