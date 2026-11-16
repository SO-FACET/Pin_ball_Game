// The same canonical routes are used by events and replay metadata. Queries,
// hashes and customer-specific paths never become analytics navigation data.
const pages=new Set(['/','/video','/entrance-3d','/game','/leaderboard','/reward','/claim','/join','/sign-in','/verify','/coins-saved','/my-coins','/exit','/launch','/notify','/confirmation','/about','/how-coins-work','/contact','/terms','/privacy','/404']);
const publicLabels=new Set([
 'so/facet','sofacet','play','play pinball','play game','start','pause','pause game','resume','resume game','restart','restart game','play again',
 'launch','launch ball','hold to launch','left flipper','right flipper','menu','close','back','next','previous','continue','cancel','done',
 'about','about us','about so/facet','how coins work','how to play','controls','practice','try again','leaderboard','scoreboard','settings',
 'privacy','privacy policy','terms','terms of service','contact','contact us','help','home','join','sign in','sign out','my coins','my so/ coins',
 'sound','mute','unmute','volume','quality','auto','full','high','balanced','low','save','save changes','save my so/ coins',
 'send otp','verify','share','share points','copy points & link','open navigation menu','close navigation menu',
]);
const publicAsset=/^\/(?:assets|vendor|sounds|references|artwork)\/[A-Za-z0-9_./-]+$/;
const publicScript=/^\/(?:assets|vendor|sounds)\/[A-Za-z0-9_./-]+\.(?:js|mjs|wasm)$/;
const topScripts=new Set(['/navigation.js','/frame-placement.js','/viewer.js','/style.css']);
const publicStateAttributes={
 'data-loaded':['true','false'],'data-ready':['true','false'],'data-sofacet-replay-ready':['true'],
 'data-game':['visible','hidden'],'data-loader':['progress'],'data-slot':['0','1','2'],
 'data-state':['error','leaving','loading','ready'],'data-phase':['loading','assembly','journey','buffering','ready'],
 'data-open':['','true','false'],'data-menu-open':['','true','false'],'data-game-loading':['','true','false'],
 'data-loading':['','true','false'],'data-scrolled':['','true','false'],'data-scene-progress':['','true','false'],
};
const styleProperties=/^(?:position|display|visibility|top|right|bottom|left|inset(?:-(?:block|inline)(?:-(?:start|end))?)?|(?:min-|max-)?(?:width|height)|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|opacity|z-index|overflow(?:-[xy])?|transform(?:-origin)?|color|background-color|border(?:-(?:width|style|color|radius))?|font-size|font-weight|line-height|letter-spacing|text-align|flex(?:-grow|-shrink|-basis|-direction|-wrap)?|align-items|justify-content|gap|mask-type|pointer-events|object-fit|object-position)$/;
export function safeInlineStyle(value){
 return String(value).split(';').map(declaration=>{
  const colon=declaration.indexOf(':');if(colon<0)return '';
  const property=declaration.slice(0,colon).trim().toLowerCase();let content=declaration.slice(colon+1).trim();
  if(!(styleProperties.test(property)||/^--(?:travel|scene-(?:top|left|width|height)|game-loader-(?:top|measured-top))$/.test(property))||!content||content.length>200||/["'<>@\\{}]|url\s*\(|expression\s*\(/i.test(content))return '';
  const words=content.replace(/#[a-f0-9]{3,8}\b/gi,'').match(/[a-zA-Z_-]+/g)||[];
  if(words.some(word=>!/^(?:px|em|rem|vh|vw|svh|svw|dvh|dvw|vmin|vmax|deg|rad|turn|calc|min|max|clamp|rgb|rgba|hsl|hsla|translate[XYZ]?|translate3d|scale[XYZ]?|scale3d|rotate[XYZ]?|rotate3d|matrix|matrix3d|absolute|fixed|relative|sticky|static|block|inline|inline-block|flex|inline-flex|grid|none|hidden|visible|auto|scroll|clip|center|left|right|top|bottom|start|end|stretch|normal|bold|bolder|solid|dashed|transparent|currentcolor|black|white|row|column|nowrap|wrap|space-between|space-around|space-evenly|flex-start|flex-end|luminance|alpha|contain|cover|fill|important)$/i.test(word)))return '';
  const colors=[];content=content.replace(/#[a-f0-9]{3,8}\b/gi,color=>{colors.push(color);return '__COLOR'+(colors.length-1)+'__'});
  content=content.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi,number=>{const value=Number(number);return Number.isFinite(value)&&Math.abs(value)<100000?String(Math.round(value*10000)/10000):'0'}).replace(/__COLOR(\d+)__/g,(_,index)=>colors[Number(index)]||'transparent');
  return property+':'+content;
 }).filter(Boolean).join(';');
}
const knownMediaOrigins=new Set(['https://media.sofacet.com']);
const privateAssetPath=path=>/(?:^|\/)(?:avatars?|uploads?|profiles?|private|users?|customers?|accounts?|identity|exports?|attachments?)(?:\/|[-_.])/i.test(path)||/\d{9,}/.test(path)||path.split('/').some(segment=>segment.length>160||/[A-Z][A-Za-z0-9_-]{31,}/.test(segment)&&/[a-z]/.test(segment)&&/\d/.test(segment));
export const privateReplaySelector='.ph-no-capture,[data-analytics-private],input[type="file"],[contenteditable="true"],[contenteditable=""]';

export function isKnownPagePath(value){return pages.has(value)}
export function safePagePath(value,origin){
 try{const url=new URL(value,origin);return pages.has(url.pathname)?url.pathname:'/404'}catch{return '/404'}
}
export function redactText(value){
 return String(value||'').replace(/https?:\/\/[^\s)]+/g,value=>{try{const url=new URL(value);return url.origin+url.pathname.replace(/[a-f0-9-]{32,}/gi,'[id]')}catch{return '[url]'}})
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
  .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*/g,'[token]')
  .replace(/\+?\d[\d ()-]{4,}\d/g,'[number]').slice(0,500);
}
export function safeReplayUrl(value,origin){
 try{
  if(typeof value!=='string'||!value.trim())return '';
  const url=new URL(value,origin),base=new URL(origin).origin;
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return '';
  if(url.origin===base){
   if(pages.has(url.pathname)||publicAsset.test(url.pathname)&&!privateAssetPath(url.pathname)||topScripts.has(url.pathname))return url.origin+url.pathname;
   if(/^\/api\/games\/[a-f0-9-]{36}\/finish$/.test(url.pathname))return url.origin+'/api/games/:id/finish';
   if(/^\/api\/(?:account|membership|player|leaderboard|first-cuts|games\/start)(?:\/[a-z-]+)*$/.test(url.pathname))return url.origin+url.pathname;
   return url.origin+'/404';
  }
  return knownMediaOrigins.has(url.origin)&&publicAsset.test(url.pathname)&&!privateAssetPath(url.pathname)?url.origin+url.pathname:'';
 }catch{return ''}
}
export function safeReplayText(text){
 const value=String(text||''),normalized=value.trim().replace(/\s+/g,' ').toLowerCase();
 return publicLabels.has(normalized)?value:value.replace(/\S/g,'*');
}
export function safeReplayAttribute(name,value,origin){
 const key=String(name).toLowerCase();
 if(publicStateAttributes[key]?.includes(String(value)))return String(value);
 if(['value','placeholder','aria-label','title','alt','name'].includes(key)||key.startsWith('data-'))return '[redacted]';
 if(['href','src','action','poster','xlink:href'].includes(key))return safeReplayUrl(value,origin);
 if(key==='style')return safeInlineStyle(value);
 if(['srcdoc','srcset'].includes(key))return '';
 // Class/id are application structure, but opaque identifiers and contact data
 // embedded in an attribute are masked before rrweb can serialize them.
 if(key==='id'||key==='class')return String(value).split(/\s+/).map(token=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(token)&&!/\d{6,}|[A-Za-z0-9]{24,}/.test(token)?token:'redacted').join(' ');
 if(key==='d'||key==='points')return /^[MmLlHhVvCcSsQqTtAaZz\d.,+\-\seE]+$/.test(value)&&String(value).length<100000?String(value):'';
 return ['type','role','width','height','tabindex','aria-expanded','aria-hidden','aria-modal','aria-pressed','aria-selected','disabled','hidden','open','checked','selected','loading','decoding','rel','target','media','as','crossorigin','viewbox','d','fill','stroke','xmlns','x','y','x1','x2','y1','y2','cx','cy','rx','ry','r','points','transform','preserveaspectratio','maskunits','maskcontentunits','gradientunits','gradienttransform','offset','stop-color','stop-opacity','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','clip-path','mask'].includes(key)?String(value).slice(0,500):'';
}
export function safeReplayRequest(data,origin){
 if(!data||typeof data!=='object')return null;
 const name=safeReplayUrl(data.name||data.url,origin);
 if(!name)return null;
 // This hook also receives URL-only rrweb Meta records. Returning null for
 // those drops the page metadata and makes an otherwise healthy replay blank.
 const clean={name};
 for(const key of ['duration','startTime','endTime','timeOrigin','timestamp','transferSize','encodedBodySize','decodedBodySize']){
  if(typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=0)clean[key]=data[key];
 }
 if(['resource','navigation','paint','measure','mark'].includes(data.entryType))clean.entryType=data.entryType;
 if(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(data.method))clean.method=data.method;
 if(['fetch','xmlhttprequest','script','link','img','image','css','video','audio','navigation','iframe','beacon'].includes(data.initiatorType))clean.initiatorType=data.initiatorType;
 if(Number.isInteger(data.status)&&data.status>=0&&data.status<=599)clean.status=data.status;
 if(data.isInitial===true)clean.isInitial=true;
 return clean;
}
export function safeCanvasRegions(canvas){
 try{
  if(!canvas||canvas.tagName!=='CANVAS'||canvas.closest?.(privateReplaySelector))return null;
  // These canvases contain only the public authored artwork/physics scene.
  // Score/share/account/export or newly introduced canvases remain excluded.
  if(canvas.id==='game'&&canvas.closest?.('#viewport')&&canvas.closest?.('#stage'))return [];
  if(canvas.parentElement?.id==='scene-frame'&&canvas.closest?.('#scene-viewport'))return [];
 }catch{}
 return null;
}
function safeStackLine(line,origin){
 const positions=[];
 const hidden=String(line).replace(/https?:\/\/[^\s)]+/g,value=>{
  const match=/^(.*?)(:\d+:\d+)$/.exec(value);
  if(!match)return '[url]';
  try{
   const url=new URL(match[1]),base=new URL(origin).origin;
   if(url.origin!==base||privateAssetPath(url.pathname)||!(publicScript.test(url.pathname)||topScripts.has(url.pathname)||pages.has(url.pathname)))return '[external]';
   positions.push(url.origin+url.pathname+match[2]);
   return '__STACK_'+(positions.length-1)+'__';
  }catch{return '[url]'}
 });
 return redactText(hidden).replace(/__STACK_(\d+)__/g,(_,index)=>positions[Number(index)]||'[source]');
}
export function sanitizeException(error,origin){
 const name=/^[A-Za-z]+Error$/.test(error?.name||'')?error.name:'Error';
 const safe=new Error(redactText(error?.message||'Unknown client error'));safe.name=name;
 // Preserve technical source coordinates, including large minified columns,
 // while discarding arbitrary Error properties, causes and query strings.
 const frames=String(error?.stack||'').split('\n').slice(1,21).map(line=>safeStackLine(line,origin));
 safe.stack=(name+': '+safe.message+(frames.length?'\n'+frames.join('\n'):'')).slice(0,8000);
 return safe;
}
