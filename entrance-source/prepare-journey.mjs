// A failed cinematic must release its decoder before trying the lighter native
// HD path. Do not send the visitor to the game for a recoverable media failure.
export async function prepareJourney({create,options={},load=renderer=>renderer.loadVariant('compact'),prepare=()=>{},video=false,nativeOnly=false,onRetry=()=>{},signal}){
 const attempts=video&&!nativeOnly?[{}, {option:'2',forceNative:true}]:[nativeOnly?{option:'2',forceNative:true}:{}];
 for(let index=0;index<attempts.length;index++){
  let renderer,prepared=false,disposed=false;
  const dispose=()=>{if(!disposed&&renderer){disposed=true;renderer.dispose()}};
  try{
   signal?.throwIfAborted();
   renderer=await create({...options,...attempts[index],signal,onError:error=>{if(prepared)options.onError?.(error)}});
   if(signal?.aborted){dispose();signal.throwIfAborted()}
   signal?.addEventListener('abort',dispose,{once:true});
   await load(renderer);
   await prepare(renderer);
   signal?.throwIfAborted();
   prepared=true;
   return renderer;
  }catch(error){
   onRetry(renderer,error);dispose();
   if(error?.name==='AbortError'||index===attempts.length-1)throw error;
  }finally{signal?.removeEventListener('abort',dispose)}
 }
}
