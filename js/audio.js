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

// A single shared analyser that every sound in the game passes through on
// its way to the speakers (see the `.connect` calls in tone/kick/noiseHit
// below, and the <audio>-element wiring in ensureErifTheme/ensureTrueTheme)
// — real frequency data off whatever's actually playing, for the Reckoning's
// tension visualizer (drawErifTensionVisualizer, render.js) to read every
// frame via getVisualizerLevels, rather than a faked sine wobble.
let visualizerAnalyser = null, visualizerData = null;
function ensureVisualizerAnalyser() {
  const ctx = ensureAudioCtx();
  if (!visualizerAnalyser) {
    visualizerAnalyser = ctx.createAnalyser();
    // 512 (was 128) — 256 real frequency bins instead of 64, enough
    // resolution to bucket into a genuine log scale below instead of
    // several neighboring bars just repeating the same value.
    visualizerAnalyser.fftSize = 512;
    // .65 (was .78) — snappier response to actual note attacks/kicks now
    // that there's enough real resolution for that detail to be worth
    // showing, instead of blurring it into a slow average.
    visualizerAnalyser.smoothingTimeConstant = .65;
    // Tuned well below the Web Audio defaults (-100/-30 dB) — every sound in
    // this game is a tiny-gain synthesized oscillator (see tone/kick/
    // noiseHit's own vol constants, all well under .1 linear), nowhere near
    // a mastered track's loudness. The default range left almost everything
    // pinned near the silent end; this window actually spans this game's
    // real quiet-to-loud range.
    visualizerAnalyser.minDecibels = -75;
    visualizerAnalyser.maxDecibels = -25;
    visualizerAnalyser.connect(ctx.destination);
    visualizerData = new Float32Array(visualizerAnalyser.frequencyBinCount);
  }
  return visualizerAnalyser;
}
// Buckets the analyser's frequency bins into `count` levels (0-1 each) for a
// bar-per-bucket display, using a REAL logarithmic frequency scale (bin
// boundary ~ bins^(i/count)) rather than the earlier squared-fraction
// approximation — nearly all of this game's music sits in the low bins
// (bass pulse + mid-range melody, see scheduleMusicStep), so a linear split
// left every bar past the first one or two looking permanently dead.
// getFloatFrequencyData (real dB float values) instead of the 8-bit-
// quantized byte version, read against minDecibels/maxDecibels above once
// those are actually tuned to this game's own quiet output — noticeably
// finer, more accurate detail than the clamped byte data gave.
function getVisualizerLevels(count) {
  if (!visualizerAnalyser) return new Array(count).fill(0);
  visualizerAnalyser.getFloatFrequencyData(visualizerData);
  const bins = visualizerData.length;
  const minDb = visualizerAnalyser.minDecibels, maxDb = visualizerAnalyser.maxDecibels;
  const levels = new Array(count);
  for (let i = 0; i < count; i++) {
    const lo = Math.max(1, Math.floor(Math.pow(bins, i / count)));
    const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (i + 1) / count)));
    let sum = 0, n = 0;
    for (let j = lo; j < Math.min(hi, bins); j++) { sum += visualizerData[j]; n++; }
    const db = n ? sum / n : minDb;
    levels[i] = clamp((db - minDb) / (maxDb - minDb), 0, 1);
  }
  return levels;
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
    o.connect(g); g.connect(ensureVisualizerAnalyser());
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
    o.connect(g); g.connect(ensureVisualizerAnalyser()); o.start(t); o.stop(t + .105);
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
    src.connect(filter); filter.connect(g); g.connect(ensureVisualizerAnalyser()); src.start(t);
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
  // The main menu never had any music at all before — even quieter/slower
  // than explore's own already-sparse drone (lower bpm, lower volMult, no
  // kick/snare same as explore, so no percussive transients to pop at this
  // volume), so it sits well under everything else without drawing
  // attention to itself.
  // bassWave: 'sine' instead of the default 'square' — a softer downbeat
  // pulse, less pop-prone at this volume. Uneven block lengths (12/8/12
  // instead of explore's flat 8/8/8/8) and different note values/contour so
  // this doesn't just read as explore's own theme turned down.
  title: {
    bpm: 46, wave: 'sine', root: 88, volMult: .2662, bassWave: 'sine', // volMult +10% twice now
    notes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, -2, -2, -2, -2, -2, -2, -2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
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
// Seeks a just-loaded track to its real silent-intro-skipping start point
// and, muted, actually plays a moment right there before pausing again —
// setting .currentTime alone only tells the browser where to seek; it
// doesn't guarantee real decoded audio is buffered and ready to go the
// instant something calls .play() for real later. This forces that decode
// to happen well ahead of time instead of setMusic('erif'/'erifTrue') eating
// it live, which is what read as the track not starting instantly.
function warmSeekPoint(audio, seekTime) {
  try {
    audio.currentTime = seekTime;
    audio.muted = true;
    audio.play().then(() => {
      setTimeout(() => { try { audio.pause(); audio.currentTime = seekTime; audio.muted = false; } catch {} }, 150);
    }).catch(() => {});
  } catch {}
}
// Logs WHY a real-embedded track failed to load/decode instead of the
// silent nothing this used to be — a ~3.5MB MP3 fetch can fail in ways a
// synthesized tone (zero network dependency) never would, and that used to
// be undiagnosable: setMusic('erif')'s own a.play().catch(()=>{}) swallows
// the rejection too, so a player with a broken theme would see and hear
// absolutely nothing pointing at why. e.target.error is a MediaError with a
// numeric .code (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED) — the
// actual browser-diagnosed reason, not a guess.
function logAudioLoadError(label, e) {
  const err = e.target && e.target.error;
  console.error(`[audio] ${label} failed to load`, err ? `code ${err.code}: ${err.message || '(no message)'}` : e);
}
// Builds a real embedded-MP3 <audio> track. Used to also route it through
// the shared Web Audio graph (createMediaElementSource -> visualizerAnalyser
// -> ctx.destination) so the Reckoning's tension visualizer could react to
// it — dropped entirely, not just wrapped in a try/catch, after a real case
// where that routing left a track completely and silently dead: every
// oscillator-based sound in the game (sharing this exact same AudioContext)
// played fine, only these MP3 tracks didn't, with zero thrown exception to
// catch and zero console error — createMediaElementSource had (per spec)
// already claimed the element's audio output entirely, exclusively into a
// graph that, for whatever environment-specific reason, just wasn't
// producing sound. There's no recovering from that once it's connected, so
// the fix is to never make that connection for these two tracks at all —
// they now play through their own plain default output, same as any
// ordinary <audio> tag, with zero Web Audio involvement. The Reckoning's
// visualizer still reacts to every other concurrent sound (hits, procedural
// cues) sharing the real analyser — just not this track's own melody.
function buildThemeAudio(src, label) {
  const audio = new Audio(src);
  audio.loop = true; audio.preload = 'auto';
  audio.addEventListener('error', e => logAudioLoadError(label, e));
  return audio;
}
let erifThemeAudio = null;
function ensureErifTheme() {
  if (!erifThemeAudio) {
    try {
      erifThemeAudio = buildThemeAudio('assets/erif-theme.mp3', 'erif-theme');
      erifThemeAudio.addEventListener('loadedmetadata', () => warmSeekPoint(erifThemeAudio, .75));
    }
    catch (err) { console.error('[audio] erif-theme setup failed', err); erifThemeAudio = { play: () => Promise.resolve(), pause() {}, volume: 0, currentTime: 0, paused: true }; }
  }
  return erifThemeAudio;
}

// The Reckoning's own dedicated track (Hard-only true final phase) — same
// real-embedded-MP3 pattern as ensureErifTheme above, just a second track so
// the two can't collide.
let trueThemeAudio = null;
function ensureTrueTheme() {
  if (!trueThemeAudio) {
    try {
      trueThemeAudio = buildThemeAudio('assets/erif-true-theme.mp3', 'erif-true-theme');
      // Seeking a compressed MP3 mid-stream can stall for a moment while the
      // browser locates/decodes that point — pre-seek (and pre-warm, see
      // warmSeekPoint above) here, way ahead of the actual fight, so the real
      // setMusic('erifTrue') call (fired the instant the player presses space
      // to start the Reckoning) doesn't eat that latency and can play()
      // instantly instead of appearing to wait on the arena box's grow
      // animation.
      trueThemeAudio.addEventListener('loadedmetadata', () => warmSeekPoint(trueThemeAudio, 2.5));
    }
    catch (err) { console.error('[audio] erif-true-theme setup failed', err); trueThemeAudio = { play: () => Promise.resolve(), pause() {}, volume: 0, currentTime: 0, paused: true }; }
  }
  return trueThemeAudio;
}

// Plays a real-embedded track only after the shared AudioContext has
// actually finished resuming, instead of firing play() immediately and
// racing resumeAudioContextOnGesture's (utils.js) own async .resume() call.
// That race is exactly what silently killed Erif's theme on some
// machines/timings: procedural tone()/kick() calls get retried dozens of
// times a second by the normal music scheduler, so a failed attempt while
// the context is still mid-resume just gets silently replaced by the next
// one a moment later — but this is a ONE-SHOT .play() call with no retry,
// so losing that single race meant the track just never started, with
// nothing to recover it afterward.
function playThemeWhenReady(audio, label) {
  const ac = ensureAudioCtx();
  // Logs unconditionally (not just on failure) — every prior diagnostic
  // pass only logged errors, and in the one case that actually mattered,
  // NOTHING logged at all (no error, no confirmed success either), leaving
  // no way to tell whether resume()/play() ever even ran, hung forever, or
  // quietly "succeeded" while still producing no audible sound. This makes
  // every step of the attempt visible regardless of outcome.
  console.log(`[audio] ${label}: starting — ctx.state=${ac.state}, readyState=${audio.readyState}, networkState=${audio.networkState}, volume=${audio.volume}, muted=${audio.muted}`);
  (ac.state === 'running' ? Promise.resolve() : ac.resume().catch(err => console.error(`[audio] ${label}: resume() rejected`, err)))
    .then(() => {
      console.log(`[audio] ${label}: post-resume ctx.state=${ac.state} — calling play()`);
      return audio.play();
    })
    .then(() => console.log(`[audio] ${label}: play() resolved — paused=${audio.paused}, currentTime=${audio.currentTime}, volume=${audio.volume}`))
    .catch(err => console.error(`[audio] ${label} play() rejected`, err));
}
function setMusic(name) {
  if (musicMode === 'erif' && name !== 'erif') { try { ensureErifTheme().pause(); } catch {} }
  if (musicMode === 'erifTrue' && name !== 'erifTrue') { try { ensureTrueTheme().pause(); } catch {} }
  musicMode = name; musicStep = 0; nextNoteTime = 0;
  if (name === 'erif') {
    musicFadeMult = 1;
    try {
      const a = ensureErifTheme();
      // Cut to .15x musicVolume (was half, then a quarter, then a fifth —
      // still too loud each time) — this is a real mastered MP3, while every
      // other track is a synthesized oscillator scaled down by tiny gain
      // constants (see tone()/kick() above), so at the same slider position
      // this one was playing back noticeably louder than any of the
      // procedural themes.
      // Starts .75s in rather than at 0 — the mastered track opens with a
      // stretch of near-silence, which is what actually read as playback
      // lag (preloading it earlier, see startBoss in battle-core.js, didn't
      // touch this since the file itself was already loaded in time).
      a.volume = musicVolume * .15; a.currentTime = .75;
      playThemeWhenReady(a, 'erif-theme');
    } catch (err) { console.error('[audio] setMusic(erif) threw before play() was even attempted', err); }
  } else if (name === 'erifTrue') {
    musicFadeMult = 1;
    try {
      const a = ensureTrueTheme();
      // A longer silent lead-in than ensureErifTheme's own track above (2.5s
      // vs .75s, nudged up from 2s — still not quite past the silent intro)
      // — a different mastered MP3, opens with more near-silence before the
      // track actually starts, which read as playback lag.
      a.volume = musicVolume * .15; a.currentTime = 2.5;
      playThemeWhenReady(a, 'erif-true-theme');
    } catch (err) { console.error('[audio] setMusic(erifTrue) threw before play() was even attempted', err); }
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
  // bassWave lets a quiet track (title) swap the default square (sharper,
  // more "pop"-prone attack character) for something softer instead.
  if (i % 8 === 0) tone(note / 2, step * 3.2, song.bassWave ?? 'square', .011 * vm, t, 'music');
  // A soft sustained pad under each 16-step half-phrase, for a bit of air.
  if (i === 0 || i === 16) tone(song.root * Math.pow(2, (transpose + 12) / 12), step * 7, 'sine', .0045 * vm, t, 'music');

  return step;
}
function updateMusic() {
  if (!musicMode) return;
  if (musicMode === 'erif') {
    // Real <audio> element, not the procedural scheduler — just keep its
    // volume live so the music slider still applies while it plays.
    try { ensureErifTheme().volume = musicVolume * .15 * musicFadeMult; } catch {}
    return;
  }
  if (musicMode === 'erifTrue') {
    try { ensureTrueTheme().volume = musicVolume * .15 * musicFadeMult; } catch {}
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
