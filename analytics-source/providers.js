import {safePath} from './runtime.js';

export function googleProvider(win,config,userId=null){
 const id=config.gaId;
 win['ga-disable-'+id]=false;
 win.dataLayer=win.dataLayer||[];
 const gtag=function(){win.dataLayer.push(arguments)};
 const metadata=value=>{const path=safePath(value||win.location.href,win.location.origin);return {page_location:win.location.origin+path,page_title:path,page_referrer:''}};
 const configure=value=>{
  const page=metadata(value);
  gtag('set',page);
  gtag('config',id,{...page,user_id:userId,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_flags:'SameSite=Lax;Secure'});
 };
 gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 gtag('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 gtag('js',new Date());
 configure();
 let script=win.document.getElementById('sofacet-ga');
 if(!script){script=win.document.createElement('script');script.id='sofacet-ga';script.async=true;script.referrerPolicy='no-referrer';script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);win.document.head.append(script)}
 return {
  track(name,properties){if(name==='page_view')configure(properties.page_path);gtag('event',name,{...properties,...metadata(properties.page_path),send_to:id})},
  identify(value){userId=value;configure()},
  stop(){
   win['ga-disable-'+id]=true;
   // Discard unprocessed commands if the library was blocked or is still loading.
   win.dataLayer.length=0;
   gtag('set',metadata());
   gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
   const domains=['',win.location.hostname,'.'+win.location.hostname];
   const labels=win.location.hostname.split('.');for(let i=1;i<labels.length-1;i++)domains.push('.'+labels.slice(i).join('.'));
   for(const cookie of win.document.cookie.split(';')){
    const name=cookie.split('=')[0].trim();if(!/^_ga(?:_|$)|^_gid$|^_gat/.test(name))continue;
    for(const domain of domains)win.document.cookie=name+'=; Max-Age=0; Path=/'+(domain?'; Domain='+domain:'');
   }
  },
 };
}
