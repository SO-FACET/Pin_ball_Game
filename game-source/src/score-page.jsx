import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {formatPoints,rewardMoney,resultHeadline} from './player-copy';
import PageShell from '../../collective-source/PageShell.jsx';
import {RewardArtwork,RewardMesh} from '../../collective-source/artwork/RewardArtwork.jsx';
import initialize from '../../collective-source/scenes/rewards.js';
import {Arrow,Replay} from '../../collective-source/icons.jsx';
import './reward-integration.css';

export function ScorePage(props) {
 const {result, isMember = false, onSave, onReplay, onLeaderboard, onMaybeLater, showPopup = false} = props;
 const low = result.points < 10;
 const showSavePopup = !low && !isMember && showPopup;

 return <PageShell scene="rewards" initialize={initialize} title="SO/ FACET — Pinball">
  <RewardMesh/><RewardArtwork/>
  <main className="page text-layer" inert={showSavePopup?true:undefined}><section className="reward" aria-label="Your unlocked reward">
   <div className="brand">SO/ UNLOCKED</div>
   <div className="headline-pair">
    <div className="headline-left"><h1 id="rewards-heading" tabIndex={-1}>{low?resultHeadline(result.points):<><span>Here’s</span><span>What’s Yours!</span></>}</h1></div>
    <div className="headline-right"><div className="amount-line" id="rewards-score"><strong className="amount" id="rewards-points" style={formatPoints(result.points).length>6?{fontSize:'clamp(48px,7vw,108px)'}:undefined}>{formatPoints(result.points)}</strong><span className="coins">SO/ COINS</span></div>
    {low?<p className="conversion" id="rewards-low-copy">Play again. 1,000 SO/ COINS = ₹100 off <span className="wordmark">SO/ FACET</span> diamond jewellery.</p>:<p className="conversion" id="rewards-value-line">That's <strong id="rewards-value">{rewardMoney(result.points)} off</strong> <span className="wordmark">SO/ FACET</span> diamond jewellery.</p>}
    </div>
   </div>
   <hr className="rule"/>
   {!low&&<p className="notice" id="rewards-expiry">Unsaved SO/ COINS disappear when you leave this page.</p>}
   <div className="buttons">
    {!low&&<button className="btn" id="rewards-register" type="button" data-analytics-control="save_score" onClick={onSave} style={{display:'none'}} aria-hidden="true" tabIndex={-1}><span>SAVE MY SO/ COINS</span><Arrow/></button>}
    {!low && !isMember && (
     <button
      id="rewards-reopen-save"
      className="save-coins-reopen-btn"
      type="button"
      data-analytics-control="reopen_save_coins"
      style={showSavePopup ? {display:'none'} : undefined}
      onClick={onSave}
     >
      <span className="coin-sparkle">✦</span>
      <span>SAVE YOUR SO/ COINS</span>
      <span className="coin-sparkle">✦</span>
     </button>
    )}
    <button className="btn" id="rewards-retry" type="button" data-analytics-control="play_again" onClick={onReplay}>PLAY AGAIN <Replay/></button>
   </div>
   <button className="leaderboard" id="rewards-leaderboard" type="button" data-analytics-control="open_leaderboard" onClick={onLeaderboard}>See full leaderboard →</button>
  </section></main>

  {showSavePopup && (
   <div className="save-coins-popup-backdrop" id="save-coins-modal" role="presentation">
    <div className="save-coins-popup-card" role="dialog" aria-modal="true" aria-labelledby="save-coins-heading" aria-describedby="save-coins-desc">
     <div className="save-coins-corner corner-tl" aria-hidden="true"></div>
     <div className="save-coins-corner corner-br" aria-hidden="true"></div>
     <h2 id="save-coins-heading" className="save-coins-heading">
      Save Your <span className="save-coins-accent">SO/ COINS</span>!
     </h2>
     <p id="save-coins-desc" className="save-coins-desc">
      Don't lose your progress! Log in or create an account to save your SO/ COINS and access them whenever you return.
     </p>
     <div className="save-coins-actions">
      <button
       id="save-coins-login"
       className="save-coins-btn primary"
       type="button"
       onClick={onSave}
      >
       Login / Sign Up
      </button>
      <button
       id="save-coins-later"
       className="save-coins-btn secondary"
       type="button"
       onClick={onMaybeLater}
      >
       Maybe Later
      </button>
     </div>
    </div>
   </div>
  )}
 </PageShell>;
}
export function mountScorePage(container,actions){
 const root=createRoot(container);
 return {render(result,isMember=false,showPopup=false){flushSync(()=>root.render(<ScorePage result={result} isMember={isMember} showPopup={showPopup} {...actions}/>));},clear(){root.render(null);}};
}
