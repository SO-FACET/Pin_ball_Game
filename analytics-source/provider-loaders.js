// Check the consent generation after the module resolves, before a provider can
// append a remote tag or initialize an SDK.
export function providerLoaders(win,{
 importGoogle=()=>import(__ANALYTICS_GOOGLE_MODULE__),
 importPosthog=()=>import(__ANALYTICS_POSTHOG_MODULE__),
}={}){
 return {
  async loadGoogle(config,userId,isCurrent){
   const module=await importGoogle();
   return isCurrent()?module.googleProvider(win,config,userId):null;
  },
  async loadPosthog(config,allowed,userId,isCurrent){
   const module=await importPosthog();
   return isCurrent()?module.posthogProvider(config,allowed,userId):null;
  },
 };
}
