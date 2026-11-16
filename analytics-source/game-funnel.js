export const EARLY_GAME_MS=30000;
const milestones=new Set(['game_load_started','game_ready','game_started','game_play_started','game_finished','score_verified','reward_save_started','reward_save_failed','reward_saved','reward_discarded']);

// An in-memory ordinal is correlated with the provider's existing session, never
// with a game ID, account, phone number or a new persistent identifier.
export function createGameFunnel({emit,gameDuration}){
 let sequence=0,run=null;
 const duration=()=>Math.max(0,Math.floor(gameDuration()||0));
 const context=()=>run?{run_sequence:run.sequence}:{};
 function sample(){
  if(!run||!run.launched||run.engaged||run.ended||duration()<EARLY_GAME_MS)return;
  run.engaged=true;emit('game_engaged',{...context(),duration_ms:duration()});
 }
 function finish(reason){
  if(!run||run.ended)return;
  sample();
  const duration_ms=run.completed?run.duration:run.launched?duration():0;
  const outcome=run.saved?'saved':run.completed?(run.points<10?'completed_ineligible':'completed_unsaved'):!run.launched?'before_play':duration_ms<EARLY_GAME_MS?'quit_early':'quit';
  run.ended=true;
  if(run.started&&!run.completed)emit('game_abandoned',{...context(),stage:run.stage,reason,duration_ms,early:outcome==='quit_early'});
  emit('game_session_outcome',{...context(),outcome,stage:run.stage,reason,duration_ms,points:run.points});
 }
 function event(name,properties={}){
  if(!milestones.has(name))return properties;
  // Requests initiated outside a tracked run remain independent even if a game
  // starts before their response arrives. Zero is never a real run ordinal.
  if(properties.run_sequence===0){const {run_sequence,...independent}=properties;return independent;}
  // A late verification/save response for the previous run must not advance the
  // current run. Its request context was captured before the network operation.
  if(properties.run_sequence!==undefined&&properties.run_sequence!==run?.sequence)return null;
  if(name==='game_load_started'){
   if(run&&!run.ended)return null;
   run={sequence:++sequence,stage:'loading',started:false,launched:false,completed:false,saved:false,engaged:false,ended:false,points:0,duration:0};
  }else if(name==='game_ready'){
   if(!run||run.ended)run={sequence:++sequence,stage:'ready',started:false,launched:false,completed:false,saved:false,engaged:false,ended:false,points:0,duration:0};
   else run.stage='ready';
  }else if(name==='game_started'){
   if(run?.started){finish('restart');run=null;}
   if(!run||run.ended)run={sequence:++sequence,stage:'started',started:false,launched:false,completed:false,saved:false,engaged:false,ended:false,points:0,duration:0};
   run.started=true;run.stage='started';
  }
  if(!run)return properties;
  if(run.ended)return null;
  if(!run.completed&&['reward_save_started','reward_saved','reward_discarded'].includes(name)){
   const {run_sequence,...independent}=properties;return independent;
  }
  if(name==='game_play_started'){
   if(!run.started||run.launched||run.ended)return null;
   run.launched=true;run.stage='playing';
  }else if(name==='game_finished'){
   if(run.completed||run.ended)return null;
   sample();run.completed=true;run.duration=properties.duration_ms??duration();run.points=properties.points??0;run.stage='finished';
  }else if(name==='score_verified'){run.points=properties.points??run.points;run.stage='verified';}
  else if(name==='reward_save_started'){
   if(run.saveStarted)return null;
   run.saveStarted=true;run.stage='saving';
  }
  else if(name==='reward_saved'){
   if(run.saved)return null;
   run.saved=true;run.stage='saved';finish('saved');
  }else if(name==='reward_discarded')finish('discard');
  return {...properties,...context()};
 }
 // Information screens may overlay the live game, so route changes and tab
 // visibility alone never end a run. Only the owner calls finish on departure.
 function reset(){run=null;}
 return {event,sample,finish,context,reset};
}
