import {buildBrowserScripts as build} from './source-maps.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const common={absWorkingDir:root,bundle:true,target:'es2020',minify:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'}};
const result=await build({...common,entryPoints:{google:'analytics-source/providers.js',posthog:'analytics-source/posthog.js'},
 format:'esm',entryNames:'analytics-[name]-[hash]',outdir:'assets',metafile:true},{label:'analytics-providers'});
const output=entry=>'/'+Object.keys(result.metafile.outputs).find(name=>result.metafile.outputs[name].entryPoint===entry);
await build({...common,entryPoints:['analytics-source/main.js'],format:'iife',outfile:'assets/analytics.js',external:['/assets/*'],
 define:{...common.define,__ANALYTICS_GOOGLE_MODULE__:JSON.stringify(output('analytics-source/providers.js')),
 __ANALYTICS_POSTHOG_MODULE__:JSON.stringify(output('analytics-source/posthog.js'))}},{label:'analytics-runtime'});
