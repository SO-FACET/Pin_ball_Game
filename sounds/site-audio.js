export const CHESS_HIT_FRAME = 2164;
const MUSIC_START = 0;
const musicPositionKey = 'sofacet-site-music-v3';
const gamePage = !!document.querySelector('#score-page-root');

export function createSiteSound() {
  let context, master, musicGain, rollingGain, rolling, hit;
  let loading, stopTimer, duckTimer, pauseTimer, requested = false, playGeneration = 0;
  let enabled = true, unlocked = false, playing = false, started = false, active = !document.body?.hasAttribute('data-loading') || !!document.querySelector('#site-loader'), moving = false, lastFrame = 240, lastMove = 0;
  const music = new Audio();
  music.preload = 'none';
  music.src = '/sounds/SO-FACET-landing-audio-from-1m04s.mp3';
  let musicPosition = MUSIC_START;
  try {
    enabled = localStorage.getItem('sofacet-site-sound') !== 'off';
    started = sessionStorage.getItem('sofacet-site-sound-active') === 'on';
    const saved = Number(sessionStorage.getItem(musicPositionKey));
    if (Number.isFinite(saved) && saved >= MUSIC_START) musicPosition = saved;
  } catch {}
  music.addEventListener('loadedmetadata', () => { music.currentTime = musicPosition < music.duration ? musicPosition : MUSIC_START; });
  music.addEventListener('ended', () => { music.currentTime = MUSIC_START; if (audible()) playMusic(); });
  const audible = () => enabled && unlocked && active && !document.hidden;
  const fade = (node, value, seconds = .08) => node.gain.setTargetAtTime(value, context.currentTime, seconds);
  const musicLevel = () => fade(musicGain, duckTimer ? .045 : moving ? .065 : .1, .18);
  const paint = () => {
    const button = document.querySelector('#site-sound');
    if (!button) return;
    const on = enabled && unlocked && playing && active;
    const previous = button.dataset.on;
    if (previous === String(on)) return;
    button.dataset.on = String(on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    button.title = on ? 'Mute sound' : 'Enable sound';
    if (previous !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const label of button.querySelectorAll('.sound-state')) {
        const entering = label.dataset.state === String(on);
        label.querySelectorAll('.sound-char').forEach((letter, index) => {
          letter.getAnimations().forEach(animation => animation.cancel());
          const animation = letter.animate([
            { transform: `translateY(${entering ? 110 : 0}%)`, opacity: entering ? 0 : 1 },
            { transform: `translateY(${entering ? 0 : -110}%)`, opacity: entering ? 1 : 0 },
          ], { duration: 360, delay: index * 18, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });
          animation.onfinish = () => animation.cancel();
        });
      }
    }
  };
  function setup() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    musicGain = context.createGain(); musicGain.gain.value = .1;
    context.createMediaElementSource(music).connect(musicGain).connect(master);
    rollingGain = context.createGain(); rollingGain.gain.value = 0; rollingGain.connect(master);
    context.addEventListener('statechange', () => { unlocked = context.state === 'running'; paint(); });
  }
  function playMusic() {
    const generation = ++playGeneration;
    void music.play().then(() => {
      if (generation !== playGeneration) { if (!audible()) music.pause(); return; }
      playing = true; started = true; paint();
    }).catch(() => { if (generation === playGeneration) { playing = false; paint(); } });
  }
  function pauseMusic() { ++playGeneration; music.pause(); playing = false; paint(); }
  function loadEffects() {
    if (!loading) loading = Promise.all(['sofacet-ball-roll.wav', 'sofacet-queen-impact.mp3'].map(async file => {
      const response = await fetch('/sounds/' + file);
      if (!response.ok) throw new Error('Could not load ' + file);
      return context.decodeAudioData(await response.arrayBuffer());
    })).then(([buffer, impact]) => {
      rolling = context.createBufferSource(); rolling.buffer = buffer; rolling.loop = true;
      rolling.loopStart = .12; rolling.loopEnd = buffer.duration;
      rolling.connect(rollingGain); rolling.start(); hit = impact;
    }).catch(error => { loading = undefined; console.warn('Website sound unavailable', error); });
    return loading;
  }
  function update() {
    if (!context) return;
    clearTimeout(pauseTimer);
    if (audible()) { fade(master, 1, .3); musicLevel(); playMusic(); }
    else {
      moving = false; clearTimeout(stopTimer); fade(rollingGain, 0, .04);
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      pauseMusic(); void context.suspend();
    }
    paint();
  }
  function unlock() {
    requested = true;
    if (!enabled || !active || document.hidden) return;
    setup();
    void context.resume().then(() => { unlocked = context.state === 'running'; update(); }).catch(() => {});
    // Keep play() in the gesture handler for Safari's media activation rule.
    playMusic();
    void loadEffects();
  }
  function stopRolling() {
    moving = false;
    clearTimeout(stopTimer);
    if (context) { fade(rollingGain, 0, .045); musicLevel(); }
  }
  function impact() {
    if (!audible() || !hit) return;
    const source = context.createBufferSource(), gain = context.createGain();
    const now = context.currentTime, duration = Math.min(.45, hit.duration);
    source.buffer = hit; gain.gain.setValueAtTime(.1, now);
    gain.gain.setValueAtTime(.1, now + Math.max(0, duration - .18));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain).connect(master); source.start(now, 0, duration);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    fade(musicGain, .045, .025); clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { duckTimer = undefined; musicLevel(); }, 450);
  }
  let hitArmed = true;
  return {
    paint,
    unlock,
    toggle() { this.setEnabled(!(enabled && unlocked && playing && active)); },
    setEnabled(value) {
      enabled = value;
      if (!enabled) started = false;
      try { localStorage.setItem('sofacet-site-sound', enabled ? 'on' : 'off'); } catch {}
      if (enabled) unlock(); else update();
      paint();
    },
    setActive(value) { if (active === value) return; active = value; if (active && enabled && requested) unlock(); else update(); },
    cards() { stopRolling(); },
    handoff() {
      if (!active) return;
      active = false;
      moving = false;
      clearTimeout(stopTimer); clearTimeout(duckTimer); clearTimeout(pauseTimer);
      duckTimer = undefined;
      if (!context) return;
      fade(rollingGain, 0, .025); fade(musicGain, 0, .035);
      // Keep the impact's short reverb audible across the visual transition.
      pauseTimer = setTimeout(() => {
        if (!active) { pauseMusic(); fade(master, 0, .025); void context.suspend(); }
      }, 500);
    },
    frame(frame) {
      if (frame === lastFrame) return;
      const previous = lastFrame, now = performance.now(); lastFrame = frame;
      if (frame < CHESS_HIT_FRAME - 12) hitArmed = true;
      if (previous < CHESS_HIT_FRAME && frame >= CHESS_HIT_FRAME && hitArmed) { hitArmed = false; impact(); }
      moving = false;
      if (context && audible() && !document.hidden) {
        clearTimeout(stopTimer);
        moving = frame < CHESS_HIT_FRAME && previous < CHESS_HIT_FRAME;
        const speed = Math.abs(frame - previous) / Math.max(1, (now - lastMove) * .06);
        fade(rollingGain, moving ? .7 * Math.min(.2, .09 + speed * .06) : 0, .035);
        if (!duckTimer) musicLevel();
        stopTimer = setTimeout(stopRolling, 130);
      }
      lastMove = now;
    },
    visibility() { stopRolling(); if (document.hidden) update(); else if (enabled && context) unlock(); },
    save() { try { if (music.readyState && music.currentTime >= MUSIC_START) sessionStorage.setItem(musicPositionKey, String(music.currentTime)); sessionStorage.setItem('sofacet-site-sound-active', enabled && started ? 'on' : 'off'); } catch {} },
    get enabled() { return enabled && unlocked; },
  };
}

export const siteSound = createSiteSound();
const button = document.createElement('button');
button.id = 'site-sound'; button.type = 'button'; button.className = 'site-sound';
button.dataset.on = 'false';
button.setAttribute('aria-label', 'Sound off'); button.setAttribute('aria-pressed', 'false'); button.title = 'Enable sound';
button.innerHTML = '<span class="sound-text" aria-hidden="true">' + ['OFF', 'ON'].map(state =>
  `<span class="sound-state" data-state="${state === 'ON'}">${Array.from('Sound ' + state.toLowerCase()).map(letter => `<span class="sound-char">${letter}</span>`).join('')}</span>`
).join('') + '</span><svg class="sound-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4Z"/><path class="sound-on-icon" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off-icon" d="m16 9 5 6m0-6-5 6"/></svg><span class="sound-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
if (gamePage) document.querySelector('#post-game-rewards').append(button);
else {
  if (document.body.classList.contains('policy-page') || document.querySelector('#faq-root')) document.body.append(button);
  else (document.querySelector('.site-navigation') || document.querySelector('.info-page header') || document.body).prepend(button);
}
button.addEventListener('click', () => siteSound.toggle());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
  if (event.matches) button.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
});
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, event => {
  if (event.target.closest?.('#site-sound') || event.metaKey || event.ctrlKey || event.altKey) return;
  siteSound.unlock();
}, { passive: true });
document.addEventListener('visibilitychange', () => siteSound.visibility());
window.addEventListener('storage', event => { if (event.key === 'sofacet-site-sound') siteSound.setEnabled(event.newValue !== 'off'); });
window.addEventListener('pagehide', () => { siteSound.save(); siteSound.setActive(false); });
window.addEventListener('pageshow', () => { if (!gamePage) siteSound.setActive((!document.body.hasAttribute('data-loading') || !!document.querySelector('#site-loader')) && document.body.dataset.game !== 'visible'); });
// Keep the displayed choice stable while a new page waits for browser audio activation.
siteSound.paint();
siteSound.unlock();
