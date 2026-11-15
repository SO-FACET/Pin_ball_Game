import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild-wasm';

const source = await readFile(new URL('../sounds/site-audio.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function audioHarness({ muted = false, policy = false, faq = false, game = false, landing = false, wasPlaying = false, blocked = false, blockedMedia = false, savedPosition, oldPosition } = {}) {
  let now = 0, timerId = 0;
  let audioBlocked = blocked, mediaBlocked = blockedMedia;
  let pauses = 0;
  const timers = new Map(), scheduled = [], cleared = [], contexts = [], gains = [], starts = [], placements = [];
  const preferences = new Map([['sofacet-site-sound', muted ? 'off' : 'on']]);
  const session = new Map(wasPlaying ? [['sofacet-site-sound-active', 'on']] : []);
  if (savedPosition !== undefined) session.set('sofacet-site-music-v3', String(savedPosition));
  if (oldPosition !== undefined) session.set('sofacet-site-music', String(oldPosition));
  const element = () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
  const button = element();
  const navigation = { prepend(node) { placements.push({ parent: 'navigation', node }); } };
  const rewards = { append(node) { placements.push({ parent: 'rewards', node }); } };
  const document = {
    hidden: false, body: { hasAttribute: () => true, classList: { contains: name => policy && name === 'policy-page' },
      append(node) { placements.push({ parent: 'body', node }); } }, addEventListener() {},
    createElement: () => button,
    querySelector: selector => selector === '#site-sound' ? button : selector === '.site-navigation' ? navigation : selector === '#post-game-rewards' && game ? rewards : (selector === '#faq-root' && faq) || (selector === '#score-page-root' && game) || (selector === '#site-loader' && landing) ? {} : null,
  };
  const audioEvents = new Map();
  let music;
  class Audio {
    constructor() { music = this; this.duration = 144.912; this.readyState = 1; this.currentTime = 0; }
    addEventListener(type, callback) { audioEvents.set(type, callback); }
    play() { return mediaBlocked ? Promise.reject(new Error('Media autoplay blocked')) : Promise.resolve(); }
    pause() { pauses++; }
  }
  const node = () => ({ connect(destination) { return destination; }, disconnect() {} });
  class AudioContext {
    state = 'suspended';
    destination = {};
    constructor() { contexts.push(this); }
    get currentTime() { return now / 1000; }
    addEventListener(_, callback) { this.changed = callback; }
    async resume() { if (audioBlocked) throw new Error('Autoplay blocked'); this.state = 'running'; this.changed?.(); }
    async suspend() { this.state = 'suspended'; this.changed?.(); }
    createGain() {
      const gain = { value: 0, changes: [], setTargetAtTime(value, time, seconds) { this.value = value; this.changes.push({value, seconds}); }, setValueAtTime() {}, linearRampToValueAtTime() {} };
      gains.push(gain);
      return { ...node(), gain };
    }
    createMediaElementSource() { return node(); }
    createBufferSource() { return { ...node(), start(...args) { starts.push({ source: this, args }); } }; }
    async decodeAudioData() { return { duration: 1 }; }
  }
  const sandbox = {
    document, Audio, AudioContext, console,
    window: { addEventListener() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) },
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value) },
    performance: { now: () => now },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
    setTimeout(callback, delay) { const id = ++timerId; scheduled.push(delay); timers.set(id, { callback, at: now + delay, delay }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  };
  // Execute the shipped module, including its startup and event wiring, in an isolated browser fixture.
  vm.runInNewContext(source.replace(/^export /gm, '') + '\nglobalThis.sound = siteSound;', sandbox);
  return {
    sound: sandbox.sound, document, contexts, gains, scheduled, cleared, placements, button, session, preferences, music, audioEvents,
    get pauses() { return pauses; },
    get impacts() { return starts.filter(item => !item.source.loop).length; },
    rollingTimers: () => [...timers.values()].filter(timer => timer.delay === 130).length,
    async activate() { sandbox.sound.setActive(true); await flush(); },
    allowPlayback() { audioBlocked = false; mediaBlocked = false; },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = until;
    },
  };
}

test('the trimmed website soundtrack starts at its beginning and remembers only its own position', () => {
  const h = audioHarness({ oldPosition: 180 });
  assert.equal(h.music.src, '/sounds/SO-FACET-landing-audio-from-1m04s.mp3');
  h.audioEvents.get('loadedmetadata')();
  assert.equal(h.music.currentTime, 0);
  h.music.currentTime = 110;
  h.sound.save();
  assert.equal(h.session.get('sofacet-site-music-v3'), '110');
  h.audioEvents.get('ended')();
  assert.equal(h.music.currentTime, 0);

  const next = audioHarness({ savedPosition: 110 });
  next.audioEvents.get('loadedmetadata')();
  assert.equal(next.music.currentTime, 110);
});

test('the landing loader starts the trimmed soundtrack and keeps it playing after reveal', async () => {
  const h = audioHarness({ landing: true });
  await flush();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.music.currentTime, 0);
  assert.equal(h.button.dataset.on, 'true');
  h.sound.setActive(true);
  h.advance(500);
  assert.equal(h.pauses, 0);
});

test('music fades in and continues through cards until the game becomes visible', async () => {
  const h = audioHarness(); await h.activate();
  assert.ok(h.gains[0].changes.some(change => change.value === 1 && change.seconds === .3));
  h.sound.frame(400);
  h.sound.cards();
  h.advance(500);
  assert.equal(h.pauses, 0);
  assert.equal(h.gains[0].value, 1);
  assert.equal(h.gains[2].value, 0);
  h.sound.handoff();
  h.advance(500);
  assert.equal(h.pauses, 1);
});

test('the game result resumes site music with its sound button inside the dialog', async () => {
  const h = audioHarness({ game: true, savedPosition: 110 });
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].parent, 'rewards');
  h.audioEvents.get('loadedmetadata')();
  await h.activate();
  h.sound.handoff(); h.advance(500);
  assert.equal(h.pauses, 1);
  h.sound.setActive(true); await flush();
  assert.equal(h.gains[0].value, 1);
  assert.equal(h.music.currentTime, 110);
  h.sound.setEnabled(false);
  assert.equal(h.preferences.get('sofacet-site-sound'), 'off');
  assert.equal(h.gains[0].value, 0);
});

test('the sound control mounts in navigation or directly on policy and FAQ pages', () => {
  for (const [options, parent] of [[{}, 'navigation'], [{ policy: true }, 'body'], [{ faq: true }, 'body']]) {
    const h = audioHarness(options);
    assert.equal(h.placements.length, 1);
    assert.equal(h.placements[0].parent, parent);
    assert.equal(h.placements[0].node.id, 'site-sound');
  }
});

test('silent scrolling does not create or cancel timers before audio activation', () => {
  const h = audioHarness();
  for (let frame = 241; frame < 900; frame++) h.sound.frame(frame);
  assert.equal(h.contexts.length, 0);
  assert.deepEqual(h.scheduled, []);
  assert.deepEqual(h.cleared, []);
});

test('audible scrolling replaces one rolling timer and stops after 130ms without movement', async () => {
  const h = audioHarness(); await h.activate();
  h.sound.frame(260);
  assert.equal(h.rollingTimers(), 1);
  assert.ok(h.gains[2].value > 0);
  h.advance(80); h.sound.frame(270);
  assert.equal(h.rollingTimers(), 1);
  const scheduled = h.scheduled.length;
  h.sound.frame(270);
  assert.equal(h.scheduled.length, scheduled);
  h.advance(129); assert.ok(h.gains[2].value > 0);
  h.advance(1); assert.equal(h.gains[2].value, 0);
  assert.equal(h.gains[1].value, .1);
});

test('mute and unmute retain frame tracking without stale rolling state or muted timer churn', async () => {
  const h = audioHarness(); await h.activate(); h.sound.frame(300);
  h.sound.toggle();
  assert.equal(h.rollingTimers(), 0);
  assert.equal(h.gains[2].value, 0);
  const scheduled = h.scheduled.length, cleared = h.cleared.length;
  for (let frame = 301; frame <= 600; frame++) h.sound.frame(frame);
  assert.equal(h.scheduled.length, scheduled);
  assert.equal(h.cleared.length, cleared);
  h.sound.toggle(); await flush();
  assert.equal(h.sound.enabled, true);
  assert.equal(h.gains[1].value, .1, 'silent motion must not leave music ducked on unmute');
  h.sound.frame(600); assert.equal(h.rollingTimers(), 0, 'already displayed frame remains deduplicated');
  h.sound.frame(601); assert.equal(h.rollingTimers(), 1);
  h.sound.setActive(false); assert.equal(h.rollingTimers(), 0);
});

test('muted impact crossings are consumed and only a sufficiently deep reversal rearms them', async () => {
  const h = audioHarness({ muted: true }); await h.activate();
  h.sound.frame(2164);
  assert.equal(h.impacts, 0);
  assert.equal(h.contexts.length, 0);
  h.sound.toggle(); await flush();
  h.sound.frame(2165); assert.equal(h.impacts, 0);
  h.sound.frame(2158); h.sound.frame(2164); assert.equal(h.impacts, 0);
  h.sound.frame(2150); h.sound.frame(2164); assert.equal(h.impacts, 1);
  h.sound.frame(2164); h.sound.frame(2165); assert.equal(h.impacts, 1);
  h.sound.handoff(); assert.equal(h.rollingTimers(), 0);
});

test('hidden and inactive frames do not schedule rolling work and visible movement resumes', async () => {
  const h = audioHarness(); await h.activate(); h.sound.frame(300);
  h.document.hidden = true; h.sound.visibility();
  assert.equal(h.rollingTimers(), 0);
  h.advance(500); assert.equal(h.pauses, 0, 'hiding the tab must not stop music');
  assert.equal(h.button.dataset.on, 'true');
  const scheduled = h.scheduled.length;
  h.sound.frame(400); assert.equal(h.scheduled.length, scheduled);
  h.document.hidden = false; h.sound.visibility(); await flush();
  h.sound.frame(401); assert.equal(h.rollingTimers(), 1);
  h.sound.setActive(false);
  const inactiveScheduled = h.scheduled.length;
  h.sound.frame(500); assert.equal(h.scheduled.length, inactiveScheduled);
});

test('a blocked new page retries sound instead of muting the saved choice', async () => {
  for (const blockedBy of [{ blocked: true }, { blockedMedia: true }]) {
    const h = audioHarness({ wasPlaying: true, ...blockedBy });
    assert.equal(h.button.dataset.on, 'false');
    await h.activate();
    assert.equal(h.button.dataset.on, 'false');
    h.sound.toggle();
    assert.equal(h.preferences.get('sofacet-site-sound'), 'on');
    h.allowPlayback(); h.sound.unlock(); await flush();
    assert.equal(h.button.dataset.on, 'true');
    h.sound.save(); assert.equal(h.session.get('sofacet-site-sound-active'), 'on');
    h.sound.toggle();
    assert.equal(h.button.dataset.on, 'false');
    assert.equal(h.preferences.get('sofacet-site-sound'), 'off');
  }
});

test('the game sound control shares the site mute choice', async () => {
  const source = await readFile(new URL('../game-source/src/game-sound.ts', import.meta.url), 'utf8');
  const {code} = await transform(source, {loader:'ts', format:'cjs'});
  const saved = new Map([['sofacet-site-sound','off']]);
  const module = {exports:{}};
  const levels = [];
  class AudioContext {
    destination = {};
    currentTime = 0;
    createGain() { return {gain:{value:0,cancelScheduledValues(){},setTargetAtTime(value){levels.push(value)}},connect(){}}; }
    resume() { return Promise.resolve(); }
  }
  vm.runInNewContext(code, {module,exports:module.exports,AudioContext,console:{warn(){}},fetch:async()=>({ok:false,status:404}),localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}});
  const sound = module.exports.createGameSound();
  assert.equal(sound.muted,true);
  sound.setMuted(false);
  assert.equal(saved.get('sofacet-site-sound'),'on');
  sound.setOutputActive(false);
  assert.equal(levels.at(-1), 0);
  sound.setOutputActive(true);
  assert.equal(levels.at(-1), 1);
  sound.setMuted(true);
  assert.equal(saved.get('sofacet-site-sound'),'off');
});
