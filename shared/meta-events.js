// Only explicit, non-identifying event metadata crosses the same-origin frame boundary.
export function trackMetaEvent(name,properties={},key){
 try{const win=globalThis.window;return (win?.top||win)?.sofacetMetaPixel?.track(name,properties,key)}catch{}
}
export function installMetaInteractions(win){
 if(win.sofacetMetaInteractions)return;
 win.sofacetMetaInteractions=true;
 win.document.addEventListener?.('click',event=>{
  const element=event.target?.closest?.('a[href],button');
  if(!element||element.disabled||element.getAttribute?.('aria-disabled')==='true')return;
  let type=element.id==='create-tab'?'join_collective':element.id==='registered-tab'?'login':null;
  if(element.tagName==='A')try{
   const url=new URL(element.href,win.location.href);
   if(url.origin!==win.location.origin)return;
   if(url.pathname==='/join')type='join_collective';
   else if(url.pathname==='/sign-in')type='login';
  }catch{}
  if(type)try{(win.top||win).sofacetMetaPixel?.track(type==='login'?'LoginClick':'JoinCollectiveClick')}catch{}
 },true);
}
