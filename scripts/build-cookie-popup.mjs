import {buildBrowserScripts as build} from './source-maps.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const common={absWorkingDir:fileURLToPath(root),bundle:true,target:'es2020',minify:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'}};
const settings=await build({...common,entryPoints:['cookie-source/settings.jsx'],format:'esm',entryNames:'cookie-settings-[hash]',outdir:'assets',metafile:true},{label:'cookie-settings'});
const module='/'+Object.keys(settings.metafile.outputs).find(path=>settings.metafile.outputs[path].entryPoint==='cookie-source/settings.jsx');
await build({...common,entryPoints:['cookie-source/main.jsx'],format:'iife',define:{...common.define,__COOKIE_SETTINGS_MODULE__:JSON.stringify(module)},external:['/assets/*'],outfile:fileURLToPath(new URL('assets/cookie-popup.js',root))},{label:'cookie-popup'});
await writeFile(new URL('assets/cookie-preferences.css',root),await readFile(new URL('cookie-source/style.css',root)));
