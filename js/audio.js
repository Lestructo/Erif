'use strict';

// Procedural Web Audio engine — every theme is generated from oscillators
// and noise buffers, with one exception: Erif's own theme (see
// ensureErifTheme below) is a real embedded track, carried over from the
// original source game rather than synthesized.

let audioCtx;
function ensureAudioCtx() {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// `time`, when given, schedules the sound into the future on the Web Audio
// clock (ctx.currentTime-based) instead of firing immediately — this is what
// the music scheduler uses to stay seamless (see updateMusic below). One-shot
// gameplay SFX omit it and just play "now" as before.
// `category` picks which of the two independent volume sliders applies —
// 'music' for anything from the music scheduler, 'sfx' (the default) for
// everything else, so a player can turn the soundtrack down without losing
// hit/block feedback, or vice versa.
function tone(freq = 220, dur = .06, type = 'square', vol = .04, time = null, category = 'sfx') {
  try {
    const ctx = ensureAudioCtx();
    const t = time ?? ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const g0 = Math.max(vol * (category === 'music' ? musicVolume : sfxVolume), .0001);
    // A short attack instead of an instant jump to g0 — stepping straight to
    // full gain on an oscillator that can start at any point in its own
    // waveform is the classic cause of an audible click/pop, and it's most
    // noticeable exactly where the music is quietest (the explore ambience,
    // which re-triggers a tone every step even for a held note).
    const attack = Math.min(.008, dur * .3);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + attack);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur);
  } catch {}
}

function kick(vol = .055, time = null, category = 'music') {
  try {
    const ctx = ensureAudioCtx();
    const t = time ?? ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(42, t + .085);
    const g0 = Math.max(vol * (category === 'music' ? musicVolume : sfxVolume), .0001);
    g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(.0001, t + .1);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .105);
  } catch {}
}

function noiseHit(dur = .045, vol = .018, high = 1800, time = null, category = 'music') {
  try {
    const ctx = ensureAudioCtx();
    const t = time ?? ctx.currentTime;
    const len = Math.max(1, (ctx.sampleRate * dur) | 0), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; filter.type = 'highpass'; filter.frequency.value = high;
    g.gain.value = vol * (category === 'music' ? musicVolume : sfxVolume);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination); src.start(t);
  } catch {}
}

// Per-theme configs: {bpm, wave, root, notes[32], kick pattern string, snare pattern string}.
// Fully synthesized originals — no sampled or copied melody anywhere. Each
// track is a steady groove built from a short riff played twice, then a
// second riff (its "answer") played twice — a real repeating hook instead of
// scattered wide melodic leaps — over a clean, standard kick/snare backbone
// (snare on beats 2 and 4 throughout, kick pattern varies for character).
// Tempos sit in a groove/bop range rather than speedcore territory. Archivist
// stays the slowest and most atmospheric, in the "Vinelands" style.
const MUSIC = {
  // A steady, rapid tick underlies this one — a clock, not a groove — to
  // match the Hourglass's new slow/fast time-scaling mechanic.
  hourglass: {
    bpm: 118, wave: 'triangle', root: 82,
    notes: [0, 2, 5, 2, 0, 2, 5, 2, 7, 9, 12, 9, 7, 9, 12, 9, -2, 0, 3, 0, -2, 0, 3, 0, 5, 7, 10, 7, 5, 7, 10, 7],
    kick: '10101010101010101010101010101010', snare: '00001000000010000000100000001000',
  },
  // The Verdict inherits the old Hourglass track wholesale — its ring/gap
  // mechanic (and the mood that was written for it) moved here unchanged.
  verdict: {
    bpm: 128, wave: 'square', root: 88,
    notes: [0, 3, 5, 7, 5, 3, 0, -2, 0, 3, 5, 7, 5, 3, 0, -2, 5, 8, 10, 12, 10, 7, 5, 2, 5, 8, 10, 12, 10, 7, 5, 2],
    kick: '10001000100010001000100010001000', snare: '00001000000010000000100000001000',
  },
  // A gusting, clustered kick pattern (two hits then a rest) rather than a
  // steady pulse — matches the Gale's wind gusts landing in bursts.
  gale: {
    bpm: 140, wave: 'sawtooth', root: 92,
    notes: [0, 5, 8, 5, 3, 5, 8, 5, 2, 7, 10, 7, 5, 7, 10, 7, -3, 2, 5, 2, 0, 2, 5, 2, 5, 10, 13, 10, 8, 10, 13, 10],
    kick: '10110000101100001011000010110000', snare: '00001000000010000000100000001000',
  },
  mask: {
    bpm: 136, wave: 'sawtooth', root: 77,
    notes: [0, 1, 7, 6, 3, 4, 10, 9, 0, 1, 7, 6, 3, 4, 10, 9, -2, -1, 5, 4, 1, 2, 8, 7, -2, -1, 5, 4, 1, 2, 8, 7],
    kick: '10000010100000101000001010000010', snare: '00001000000010000000100000001000',
  },
  executioner: {
    bpm: 122, wave: 'square', root: 70,
    notes: [0, 0, 7, 7, 3, 3, -2, -2, 0, 0, 7, 7, 3, 3, -2, -2, 5, 5, 12, 12, 8, 8, 3, 3, 5, 5, 12, 12, 8, 8, 3, 3],
    kick: '10100000101000101010000010100010', snare: '00001000000010000000100000001000',
  },
  witness: {
    bpm: 142, wave: 'triangle', root: 98,
    notes: [0, 7, 3, 10, 7, 3, 0, -2, 0, 7, 3, 10, 7, 3, 0, -2, 5, 12, 8, 15, 12, 8, 5, 3, 5, 12, 8, 15, 12, 8, 5, 3],
    kick: '10010010100100001001001010010000', snare: '00001000000010000000100000001000',
  },
  archivist: {
    // The "Vinelands"-style track: slow, melodic, arpeggiated, sparse drums —
    // a wandering retro-RPG atmosphere rather than a boss-rush pulse.
    bpm: 100, wave: 'triangle', root: 110,
    notes: [0, 4, 7, 11, 7, 4, 0, -5, 0, 4, 7, 11, 7, 4, 0, -5, 2, 5, 9, 12, 9, 5, 2, -3, 2, 5, 9, 12, 9, 5, 2, -3],
    kick: '10000000001000001000000000100000', snare: '00001000000010000000100000001000',
  },
  oracle: {
    bpm: 132, wave: 'sawtooth', root: 93,
    notes: [0, 3, 6, 7, 6, 3, 0, -2, 0, 3, 6, 7, 6, 3, 0, -2, 5, 8, 11, 12, 11, 8, 5, 3, 5, 8, 11, 12, 11, 8, 5, 3],
    kick: '10001000001010001000100000101000', snare: '00001000000010000000100000001000',
  },
  // erif intentionally has no procedural entry — it uses the real embedded
  // track (see ensureErifTheme below) instead of a synthesized theme, the
  // one deliberate exception to the "everything is generated" rule up top.
  // The hub and every side room — quiet exploration, not a fight. No
  // kick/snare at all (both patterns empty), slow, and each "note" holds for
  // 8 steps instead of changing every beat, so it reads as a soft ember-glow
  // drone rather than a melody. scheduleMusicStep's usual bass-pulse/pad
  // layers still apply and are most of what actually carries this one.
  explore: {
    bpm: 62, wave: 'sine', root: 98, volMult: .34,
    notes: [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, -2, -2, -2, -2, -2, -2, -2, -2, 5, 5, 5, 5, 5, 5, 5, 5],
    kick: '00000000000000000000000000000000', snare: '00000000000000000000000000000000',
  },
};

let musicMode = null, musicStep = 0, nextNoteTime = 0;
// Extra volume multiplier applied only to Erif's theme, on top of the
// musicVolume slider — driven by updateErifVictory (erif.js) to fade the
// track out in lockstep with the victory screen's white flash. Reset to 1
// whenever the theme (re)starts (see setMusic below) so a later fight never
// inherits a previous victory's faded-out volume.
let musicFadeMult = 1;
// How far ahead (in seconds) notes get queued onto the Web Audio timeline.
// This is the fix for the old per-frame "fire it live" scheduling, which
// stuttered on the downbeat whenever a busy frame (heavy draw call, GC pause)
// delayed the moment tone()/kick() actually ran. Scheduling ahead on the
// audio clock (ctx.currentTime) means playback timing no longer depends on
// the game loop's frame timing at all — the browser's audio thread handles
// the exact sample-accurate playback regardless of any main-thread jitter,
// *as long as* the next scheduling pass (driven by the render loop) happens
// before a queued note's start time arrives. Widened from .15 to .35 — a
// frame hitch bigger than the old window (a heavy GC pause, a busy tab)
// could let a note fall behind and get scheduled essentially "late" instead
// of on the beat, which is exactly the occasional audible slip that was
// reported. This trades a little slider responsiveness (a musicVolume
// change can take up to this long to reach already-queued notes) for a much
// bigger cushion against that.
const SCHEDULE_AHEAD = .35;

// Erif's theme is a real embedded track (pulled from the original source
// game's build), not a procedural one like every other theme — see the
// missing 'erif' entry in MUSIC above. Lazily constructed since `Audio`
// isn't available in every environment this file gets loaded in.
let erifThemeAudio = null;
function ensureErifTheme() {
  if (!erifThemeAudio) {
    try { erifThemeAudio = new Audio('assets/erif-theme.mp3'); erifThemeAudio.loop = true; erifThemeAudio.preload = 'auto'; }
    catch { erifThemeAudio = { play: () => Promise.resolve(), pause() {}, volume: 0, currentTime: 0, paused: true }; }
  }
  return erifThemeAudio;
}

// The Reckoning's own dedicated track (Hard-only true final phase) — same
// real-embedded-MP3 pattern as ensureErifTheme above, just a second track so
// the two can't collide.
let trueThemeAudio = null;
function ensureTrueTheme() {
  if (!trueThemeAudio) {
    try { trueThemeAudio = new Audio('assets/erif-true-theme.mp3'); trueThemeAudio.loop = true; trueThemeAudio.preload = 'auto'; }
    catch { trueThemeAudio = { play: () => Promise.resolve(), pause() {}, volume: 0, currentTime: 0, paused: true }; }
  }
  return trueThemeAudio;
}

function setMusic(name) {
  if (musicMode === 'erif' && name !== 'erif') { try { ensureErifTheme().pause(); } catch {} }
  if (musicMode === 'erifTrue' && name !== 'erifTrue') { try { ensureTrueTheme().pause(); } catch {} }
  musicMode = name; musicStep = 0; nextNoteTime = 0;
  if (name === 'erif') {
    musicFadeMult = 1;
    try {
      const a = ensureErifTheme();
      // Cut to a fifth of musicVolume (was half, then a quarter — still too
      // loud each time) — this is a real mastered MP3, while every other
      // track is a synthesized
      // oscillator scaled down by tiny gain constants (see tone()/kick()
      // above), so at the same slider position this one was playing back
      // noticeably louder than any of the procedural themes.
      // Starts .75s in rather than at 0 — the mastered track opens with a
      // stretch of near-silence, which is what actually read as playback
      // lag (preloading it earlier, see startBoss in battle-core.js, didn't
      // touch this since the file itself was already loaded in time).
      a.volume = musicVolume * .20; a.currentTime = .75;
      a.play().catch(() => {}); // autoplay policies can reject this; harmless if so
    } catch {}
  } else if (name === 'erifTrue') {
    musicFadeMult = 1;
    try {
      const a = ensureTrueTheme();
      a.volume = musicVolume * .20; a.currentTime = 0;
      a.play().catch(() => {});
    } catch {}
  }
}
function stopMusic() {
  if (musicMode === 'erif') { try { ensureErifTheme().pause(); } catch {} }
  if (musicMode === 'erifTrue') { try { ensureTrueTheme().pause(); } catch {} }
  musicMode = null; nextNoteTime = 0;
}
function scheduleMusicStep(song, t) {
  const i = musicStep % 32, section = Math.floor(musicStep / 32) % 4;
  const transpose = [0, 5, -2, 7][section];
  const semitone = song.notes[i] + transpose;
  const note = song.root * Math.pow(2, semitone / 12);
  const baseStep = 60 / song.bpm / 4;
  const breath = (i === 15 || i === 31) ? 1.4 : 1;
  const step = baseStep * breath;
  // Overall level per track, on top of the heavy/normal split below — only
  // 'explore' sets this (well under 1), so every boss theme's volume is
  // completely unchanged.
  const vm = song.volMult ?? 1;

  // Kick and snare only fire on their authored pattern hits — no automatic
  // filler noise on every step — so the groove stays a clean, steady pulse
  // instead of a constant hihat wash.
  if (song.kick[i] === '1') kick((song.heavy ? .062 : .05) * vm, t);
  if (song.snare[i] === '1') noiseHit(.07, .026 * vm, 900, t);

  tone(note, step * 1.7, song.wave, (song.heavy ? .015 : .0115) * vm, t, 'music');
  // A steady root-octave bass pulse under every downbeat is what actually
  // carries a groove — kept simple on purpose, no extra harmonic clutter.
  if (i % 8 === 0) tone(note / 2, step * 3.2, 'square', .011 * vm, t, 'music');
  // A soft sustained pad under each 16-step half-phrase, for a bit of air.
  if (i === 0 || i === 16) tone(song.root * Math.pow(2, (transpose + 12) / 12), step * 7, 'sine', .0045 * vm, t, 'music');

  return step;
}
function updateMusic() {
  if (!musicMode) return;
  if (musicMode === 'erif') {
    // Real <audio> element, not the procedural scheduler — just keep its
    // volume live so the music slider still applies while it plays.
    try { ensureErifTheme().volume = musicVolume * .20 * musicFadeMult; } catch {}
    return;
  }
  if (musicMode === 'erifTrue') {
    try { ensureTrueTheme().volume = musicVolume * .20 * musicFadeMult; } catch {}
    return;
  }
  const song = MUSIC[musicMode];
  if (!song) return; // no theme authored yet — silent, not broken
  const ctx = ensureAudioCtx();
  if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime; // first run / resume after stop
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const step = scheduleMusicStep(song, nextNoteTime);
    nextNoteTime += step;
    musicStep++;
  }
}
