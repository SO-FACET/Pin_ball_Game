import React,{useEffect,useId,useRef,useState} from 'react';
import {request} from '../membership-source/src/api.js';
import {visibleEntries} from '../game-source/src/leaderboard.ts';
import './leaderboard-dialog.css';

const number=new Intl.NumberFormat('en-IN');

export default function LeaderboardDialog({dialogRef,onClose}){
 const titleId=useId();
 const [board,setBoard]=useState(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');

 useEffect(()=>{
  let active=true;
  setLoading(true);
  setError('');
  request('/api/leaderboard')
   .then(data=>{
    if(active){
     setBoard(data);
     setLoading(false);
    }
   })
   .catch(err=>{
    if(active){
     setError(err.message||'Unable to load the leaderboard.');
     setLoading(false);
    }
   });
  return()=>{active=false;};
 },[]);

 function close(){
  dialogRef.current?.close();
  onClose?.();
 }

 const selected=board?.entries?visibleEntries(board.entries,board.me):[];

 return <dialog className="account-leaderboard-dialog" ref={dialogRef} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();close();}}>
  <div className="account-leaderboard-header">
   <h2 id={titleId}>LEADERBOARD</h2>
   <button className="account-leaderboard-close" type="button" aria-label="Close leaderboard" onClick={close}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
     <path d="m5 5 14 14M19 5 5 19"/>
    </svg>
   </button>
  </div>
  {loading&&<div className="account-leaderboard-loading">Loading rankings…</div>}
  {error&&<div className="account-leaderboard-error" role="alert">{error}</div>}
  {!loading&&!error&&(
   <div className="account-leaderboard-table-wrap">
    <table className="account-leaderboard-table">
     <thead>
      <tr>
       <th scope="col">Rank</th>
       <th scope="col">Name</th>
       <th scope="col">Score</th>
      </tr>
     </thead>
     <tbody>
      {selected.map((entry,idx)=>(
       <tr key={idx} className={entry.is_you?'current-player':''}>
        <td className="rank-cell">{entry.rank===null?'—':`#${entry.rank}`}</td>
        <td className="name-cell">
         {entry.display_name}
         {entry.is_you&&entry.display_name!=='You'&&<span className="you-pill">You</span>}
        </td>
        <td className="score-cell">{number.format(entry.points)}</td>
       </tr>
      ))}
      {!selected.length&&(
       <tr>
        <td colSpan={3} className="empty-cell">No players on the leaderboard yet.</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>
  )}
  <div className="account-leaderboard-actions">
   <button className="primary" type="button" onClick={close}>Close</button>
  </div>
 </dialog>;
}
