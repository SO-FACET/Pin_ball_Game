// This facade is safe before analytics loads, in Node tests, and when consent is off.
function api(){try{return globalThis.window?.top?.sofacetAnalytics}catch{return globalThis.window?.sofacetAnalytics}}
export function track(name,properties={}){try{api()?.track(name,properties)}catch{}}
export function gameContext(){try{return api()?.getGameContext?.()||{}}catch{return {}}}
export function apiStarted(path,body){
 const context={run_sequence:gameContext().run_sequence??0,save_requested:path==='/api/membership/rewards'||path==='/api/membership'&&typeof body?.gameId==='string'};
 if(context.save_requested)track('reward_save_started',{run_sequence:context.run_sequence,method:'form'});
 return context;
}
let pendingGameActivity,gameActivityHost;
function publishGameActivity(){
 try{
  const analytics=api();
  if(typeof analytics?.setGameActivity!=='function')return;
  analytics.setGameActivity(pendingGameActivity);
  gameActivityHost?.removeEventListener?.('sofacet:analytics-ready',publishGameActivity);
  gameActivityHost=undefined;
 }catch{}
}
// Keep only the current boolean if the outer runtime has not installed yet.
// Consent and duration clocks remain owned by that runtime.
export function setGameActivity(active){
 if(typeof active!=='boolean')return;
 pendingGameActivity=active;
 try{
  if(!gameActivityHost){
   gameActivityHost=globalThis.window?.top||globalThis.window;
   gameActivityHost?.addEventListener?.('sofacet:analytics-ready',publishGameActivity);
  }
 }catch{}
 publishGameActivity();
}
export function captureError(error,context={}){try{api()?.captureError(error,context)}catch{}}
export function refreshAnalyticsIdentity(){try{void api()?.refreshIdentity()}catch{}}
function resetAnalyticsIdentity(){try{api()?.resetIdentity()}catch{}}
function clearAnalyticsIdentity(){try{const analytics=api();if(typeof analytics?.clearIdentity==='function')analytics.clearIdentity();else analytics?.resetIdentity()}catch{}}

const sessionEndpoints=new Set(['/api/account','/api/account/session','/api/account/details','/api/account/signout','/api/account/delete','/api/membership','/api/membership/rewards']);
const savedReward=result=>result?.pointsSaved===true&&Number.isSafeInteger(result.savedPoints)&&result.savedPoints>=0;

export function apiOutcome(path,status,result,duration,context={}){
 const endpoint=path.replace(/\/games\/[^/]+\/finish$/, '/games/:id/finish');
 const sent=result?.success===true&&typeof result.challengeId==='string'&&result.challengeId.length>0&&Number.isFinite(result.expiresIn)&&result.expiresIn>0;
 const registered=result?.success===true&&result?.player?.member===true&&Number.isSafeInteger(result.savedPoints)&&result.savedPoints>=0;
 const event={
  '/api/account/otp/request':['otp_requested','phone_otp','signin',sent],
  '/api/membership/otp/request':['otp_requested','phone_otp','signup',sent],
  '/api/account/otp/verify':['login','phone_otp','signin',result?.verified===true],
  '/api/membership/otp/verify':['otp_verified','phone_otp','signup',result?.verified===true&&typeof result.verificationToken==='string'&&result.verificationToken.length>0],
  '/api/membership':['sign_up','phone_otp','signup',registered],
  '/api/account/details':['profile_updated','form','account',result?.success===true],
  '/api/account/signout':['logout','button','account',result?.success===true],
  '/api/account/delete':['account_deleted','button','account',result?.success===true],
  '/api/first-cuts':['first_cuts_registered','form','signup',result?.success===true],
 }[endpoint];
 const confirmed=status>=200&&status<300&&!!result&&typeof result==='object'&&!Array.isArray(result)&&
  (event?event[3]:endpoint==='/api/membership/rewards'?result.success===true&&savedReward(result):endpoint==='/api/account/session'?typeof result.signedIn==='boolean':result.success!==false&&result.verified!==false);
 track('api_request',{endpoint,status,duration_ms:Math.round(duration),outcome:confirmed?'success':'failure'});
 if(!confirmed){if(context.save_requested||endpoint==='/api/membership/rewards')track('reward_save_failed',{...context,status});return;}
 if(event)track(event[0],{method:event[1],flow:event[2]});
 if(savedReward(result))track('reward_saved',{...context,points:result.savedPoints});
 if(event?.[0]==='login'||event?.[0]==='sign_up'||endpoint==='/api/account'||endpoint==='/api/player'||endpoint==='/api/account/session'&&result.signedIn)refreshAnalyticsIdentity();
 if(event?.[0]==='logout'||event?.[0]==='account_deleted')resetAnalyticsIdentity();
 else if(endpoint==='/api/account/session'&&!result.signedIn)clearAnalyticsIdentity();
}
export function apiFailure(path,error,duration,context={}){
 if(error?.name==='AbortError')return;
 const endpoint=path.replace(/\/games\/[^/]+\/finish$/, '/games/:id/finish');
 if(sessionEndpoints.has(endpoint)&&(error?.status===401||['invalid_token','rewards_verification_required'].includes(error?.code)))resetAnalyticsIdentity();
 track('api_request',{endpoint,status:error?.status||0,duration_ms:Math.round(duration),outcome:'failure'});
 if(context.save_requested||endpoint==='/api/membership/rewards')track('reward_save_failed',{...context,status:error?.status||0});
 captureError(new Error('API request failed'),{source:'api',endpoint,status:error?.status||0});
}
