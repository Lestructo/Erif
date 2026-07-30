'use strict';

// Erif's fight: Reprise, Convergence, Enraged, Final Convergence,
// and the victory sequence. This file also holds the hub-side dialogue
// system and approach trigger, which is Erif-specific content, not generic
// hub plumbing.

function startErifDialogue(count) {
  if (save.erifDialogueSeen[count]) return false;
  const lines = ERIF_DIALOGUE[count];
  if (!lines || !lines.length) return false; // not written yet — skip gracefully rather than an empty box
  save.erifDialogueSeen[count] = true;
  saveGame();
  const allCollected = count === LIEUTENANTS.length;
  dialogue = { lines, index: 0, after: allCollected ? 'erif' : 'explore', context: 'explore' };
  mode = 'dialogue';
  tone(allCollected ? 62 : 92, .20, 'sawtooth', .035);
  return true;
}
function startErifRetryDialogue() {
  if (!ERIF_RETRY_DIALOGUE.length) return false;
  dialogue = { lines: ERIF_RETRY_DIALOGUE, index: 0, after: 'erif', context: 'explore' };
  mode = 'dialogue';
  tone(52, .24, 'sawtooth', .04);
  return true;
}
function launchErifFromDialogue() {
  save.erifAttempts++;
  startBoss('erif');
}
// Dialogue text types on rather than appearing all at once — revealCount is
// a plain field on the shared `dialogue` object (defaults to 0 when absent,
// same tolerant pattern as dialogue.speaker), advanced each frame while a
// line is mid-reveal (see updateDialogueReveal, called from main.js).
const DIALOGUE_CHARS_PER_SEC = 42;
// How long a fully-typed line lingers before auto-advancing on its own —
// only used by the dialogue that plays as Erif enters the Enraged phase
// (see main.js's update(), gated on dialogue.after === 'erifEnraged'),
// which plays through with no player input at all instead of waiting on
// Space like every other dialogue (including the one leading into the
// fight itself, which is untouched).
const DIALOGUE_AUTO_HOLD = 0.6;
function updateDialogueReveal(dt) {
  if (!dialogue) return;
  const len = dialogue.lines[dialogue.index].length;
  const cur = dialogue.revealCount || 0;
  if (cur >= len) return;
  // dialogue.charsPerSec lets a specific dialogue type faster/slower than
  // the shared default — see startErifEnrageDialogue, which doubles it.
  const next = Math.min(len, cur + (dialogue.charsPerSec || DIALOGUE_CHARS_PER_SEC) * dt);
  // A soft tick every few revealed characters — not literally per character,
  // which would be far too noisy at this reveal rate.
  if (Math.floor(next / 3) > Math.floor(cur / 3)) tone(200 + rand(-15, 15), .025, 'square', .011);
  dialogue.revealCount = next;
}
function advanceDialogue() {
  if (!dialogue) return;
  // First press while a line is still typing just finishes it instantly,
  // rather than skipping straight to the next line — standard convention,
  // and it means an impatient tap never eats a line the player never read.
  const len = dialogue.lines[dialogue.index].length;
  if ((dialogue.revealCount || 0) < len) { dialogue.revealCount = len; return; }
  dialogue.index++;
  dialogue.revealCount = 0;
  if (dialogue.index < dialogue.lines.length) {
    tone(110 + dialogue.index * 18, .035, 'square', .018);
    return;
  }
  const after = dialogue.after;
  dialogue = null;
  if (after === 'erif') launchErifFromDialogue();
  else if (after === 'erifEnraged') beginErifEnraged();
  // startErifDialogue(0) can return false without taking over `mode` itself
  // — e.g. a returning player whose save (now persisted, see data.js's
  // saveGame/loadSaveGame) already has erifDialogueSeen[0] set. Without this
  // fallback, mode was left stuck on 'dialogue' with dialogue now null,
  // which crashed drawDialogue() on the next frame and froze the game.
  else if (after === 'introDone') { if (!startErifDialogue(0)) mode = 'explore'; }
  else if (after === 'erifTrueFinal') beginErifTrueFinal();
  else mode = 'explore';
}

// Hooks called from hub.js — guarded there with typeof checks so hub
// navigation never breaks while this file is still under construction.
function onEnterHub() {
  startErifDialogue(wardCount());
}
function approachErif() {
  if (save.erifAttempts > 0) startErifRetryDialogue();
  else if (!save.erifDialogueSeen[LIEUTENANTS.length]) startErifDialogue(LIEUTENANTS.length);
  // A returning player (see saveGame/loadSaveGame, data.js) can already have
  // erifDialogueSeen[8] persisted as true despite erifAttempts still being
  // 0 — they saw the "all wards collected" line but never actually pressed
  // Space to launch the fight before leaving/refreshing. Without this, both
  // branches above go false and approaching the portal does nothing at all.
  else launchErifFromDialogue();
}

// ---- Phase A: The Reprise ----
// Eight short hard-mode segments revisiting each lieutenant's mechanic, one
// after another, using battle.phase as the segment index (0-7). Later
// phases (Convergence=8, Enraged=9, ...) land in milestones beyond this and
// continue this same numbering — see the phase dispatch at the bottom of
// this file for the exact boundaries, which are computed from
// REPRISE_ORDER.length rather than hardcoded.
const REPRISE_ORDER = ['hourglass', 'executioner', 'mask', 'witness', 'archivist', 'oracle', 'gale', 'verdict'];
const REPRISE_SEGMENT = 7;
// Phase numbers after the Reprise, derived from REPRISE_ORDER.length so they
// can never silently collide with the Reprise segment indices (which run
// 0..REPRISE_ORDER.length-1) the way hand-picked literals would if the
// roster ever changes size again. render.js's phaseNames array (used for the
// on-screen phase label) is built the exact same way, index-for-index.
const PHASE_CONVERGENCE = REPRISE_ORDER.length;
const PHASE_ENRAGED = REPRISE_ORDER.length + 1;
const PHASE_FINAL_CONVERGENCE = REPRISE_ORDER.length + 2;
const PHASE_LAST_WAGER = REPRISE_ORDER.length + 3; // Hard-only true final phase

// Every other Reprise segment is a flat REPRISE_SEGMENT-second window
// regardless of what happens inside it (see updateErif's dispatch below) —
// but a memory-match segment that can get cut off mid-sequence isn't a fair
// test of it. The Archivist's Reprise segment instead runs its own quick-
// match gate, parameterized (lengths/maxRounds/passAt) so it can be tuned
// independently of the standalone trial while sharing the same underlying
// logic via updateArchivistQuickMatch. (The true final phase used to run its
// own longer version of this same gate for its Archivist re-fight; that
// whole re-fight system is gone now — the Hard-only true final phase is a
// two-hands boss fight instead, see beginErifTrueFinal/updateErifHandsFinale.)
// Reprise: a single 5-pattern round — pass instantly if you clear it on the
// first try, capped at 2 attempts either way so even a rough run moves on
// quickly (this is the very start of the fight, meant to move fast).
const REPRISE_ARCHIVIST_LENGTHS = [5];
const REPRISE_ARCHIVIST_MAX_ROUNDS = 2;
const REPRISE_ARCHIVIST_PASS_AT = 1;
function startArchivistQuickRound(roundField, lengths) {
  startEchoRound(true, lengths[battle[roundField] % lengths.length]);
}
function updateArchivistQuickMatch(dt, cfg) {
  const { round, successes, done, lengths, maxRounds, passAt } = cfg;
  // moveSoulWithShield rather than the standalone trial's moveSoulFree —
  // Erif's fight can carry lingering hazards over between phases (see
  // updateCarriedRepriseHazards), so the shield needs to stay controllable
  // here too or a leftover spear/shard from an earlier segment would be
  // unblockable.
  moveSoulWithShield(dt, 220);
  if (!battle.sigils.length) startArchivistQuickRound(round, lengths);

  if (battle.echoPhase === 'reveal') updateEchoReveal(dt, true);
  else if (battle.echoPhase === 'input') updateEchoInput(dt);
  else if (battle.echoPhase === 'resolve') {
    battle.echoResolveTimer -= dt;
    if (battle.echoResolveTimer <= 0) {
      // Unlike the standalone trial, every round here counts against the
      // cap whether it's solved or missed — a miss no longer just retries
      // the same length for free, it spends one of the attempts.
      battle[round]++;
      if (!battle.echoFail) battle[successes]++;
      if (battle[successes] >= passAt || battle[round] >= maxRounds) { battle[done] = true; return; }
      startArchivistQuickRound(round, lengths);
    }
  }

  battle.echoBookTimer -= dt;
  if (battle.echoBookTimer <= 0) { spawnEchoBook(true); battle.echoBookTimer = rand(1.15, 1.7); }
  updateEchoBooks(dt);
  // The same weaving-book-and-trail pressure the standalone trial and
  // Convergence's archivist cue already use — this was missing from both
  // the Reprise segment and the true final re-fight before.
  battle.weavingBookTimer -= dt;
  if (battle.weavingBookTimer <= 0) { spawnWeavingBookBurst(true); battle.weavingBookTimer = rand(5.5, 7.5); }
  updateWeavingBooks(dt); updateTrailSquares(dt);

  if (battle.sigilPulse) { battle.sigilPulse.t -= dt; if (battle.sigilPulse.t <= 0) battle.sigilPulse = null; }
}
function updateRepriseArchivist(dt) {
  updateArchivistQuickMatch(dt, {
    round: 'repriseArchivistRound', successes: 'repriseArchivistSuccesses', done: 'repriseArchivistDone',
    lengths: REPRISE_ARCHIVIST_LENGTHS, maxRounds: REPRISE_ARCHIVIST_MAX_ROUNDS, passAt: REPRISE_ARCHIVIST_PASS_AT,
  });
}

// The Hourglass's Reprise segment runs its own fixed 4-phase-cycle gate
// (fast, slow, fast, slow — starting fast, unlike the standalone trial which
// always opens slow) instead of a flat timer, so the slow/fast flip and the
// orbs it spawns get guaranteed room to actually show up. Runs just once
// each way now (slow, then fast) instead of 4 cycles — the very start of
// the fight is meant to move fast, not linger here.
function updateRepriseHourglass(dt) {
  moveSoulWithShield(dt, 220); // see updateArchivistQuickMatch's note on why Erif's Reprise segments keep the shield live
  if (!battle.sandPhase) { beginSandPhase(true, 'slow'); battle.repriseHourglassCycles = 1; }

  battle.sandTimer -= dt;
  if (battle.sandTimer <= 0) {
    // Checked BEFORE flipping — this lets the 2nd (fast) phase run its own
    // full natural duration before ending, instead of marking done the
    // instant it begins (which would cut it down to ~0 length).
    if (battle.repriseHourglassCycles >= 2) { battle.repriseHourglassDone = true; return; }
    beginSandPhase(true, battle.sandPhase === 'slow' ? 'fast' : 'slow');
    battle.repriseHourglassCycles++;
  }

  battle.sandGrainTimer -= dt;
  if (battle.sandGrainTimer <= 0) { spawnSandGrain(true); battle.sandGrainTimer = .22 / battle.timeScale; }
  updateSandGrains(dt);

  battle.hourglassOrbTimer -= dt;
  if (battle.hourglassOrbTimer <= 0) {
    spawnHourglassOrb(true);
    if (Math.random() < .49) spawnHourglassOrb(true);
    if (Math.random() < .225) spawnHourglassOrb(true);
    battle.hourglassOrbTimer = rand(1.0, 1.44) / battle.timeScale;
  }
  updateHourglassOrbs(dt);
}

// The Oracle's Reprise segment is the true FIRST math phase of the whole
// fight — exactly 2 questions, 4 options then 8, win or lose each one (no
// solve requirement, just a round count, tracked by watching battle.qRound
// change, which only ever happens inside updateLaneLasers once a round's
// full think+laser cycle has resolved, or from the bootstrap call below).
// (Enraged's own later math segments — see updateEnraged — use the normal
// oracleOptionCount() ramp instead of forcing specific counts like this.)
function updateRepriseOracle(dt) {
  moveSoulWithShield(dt, 240); // see updateArchivistQuickMatch's note on why Erif's Reprise segments keep the shield live
  // Keyed off battle.qRound itself (0 for the still-unasked first question,
  // 1 once that resolves and the second is about to generate) rather than
  // repriseOracleRounds below, which only updates AFTER a question's already
  // been generated — this needs to be right *before* that happens, whether
  // that's the bootstrap right here or updateLaneLasers's own internal
  // newQuestion() call once a round resolves.
  battle.qOptionCountOverride = (battle.qRound || 0) === 0 ? 4 : 8;
  if (!battle.q) newQuestion(true);
  battle.qTimer -= dt;
  const roundBefore = battle.qRound;
  updateLaneLasers(dt, true);
  battle.qOptionCountOverride = null;
  if (battle.qRound !== roundBefore) {
    battle.repriseOracleRounds++;
    if (battle.repriseOracleRounds >= 2) { battle.repriseOracleDone = true; return; }
  }

  battle.spawn -= dt;
  if (battle.spawn <= 0) {
    const b = battle.box;
    const x = rand(b.x + 10, b.x + b.w - 10);
    battle.bullets.push({ x, y: b.y - 8, vx: rand(-55, 55) * DIFFICULTY.projectileMult, vy: 275 * DIFFICULTY.projectileMult, r: 5 });
    battle.spawn = .19;
  }
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (circleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20);
}

// Segment transitions within the Reprise no longer despawn in-flight
// hazards (see bumpErifPhase's keepProjectiles, battle-core.js's
// clearHazardsKeepProjectiles) — but each lieutenant's own update function
// only ever runs its OWN hazard-movement loops. Without this, anything left
// over from an earlier segment (a sand grain, a homing flag, a tumbling
// book...) just sat frozen in place forever instead of continuing along its
// path and despawning naturally, since nothing was still moving it. This
// runs every hazard family's movement/collision loop unconditionally,
// skipping only whichever one(s) the *currently active* segment already
// runs itself this frame (to avoid double-updating — moving something twice
// in one frame would make it silently run at double speed).
function updateCarriedRepriseHazards(dt, active) {
  if (active !== 'hourglass') { updateSandGrains(dt); updateHourglassOrbs(dt); }
  if (active !== 'executioner' && active !== 'mask') updateSpearHazards(dt);
  if (active !== 'mask') updateMaskShards(dt);
  if (active !== 'witness') updateShapeHazards(dt);
  // Weaving books/trail squares were added to the Archivist's Reprise
  // segment after this carry-over sweep was already written, and never got
  // added here — leaving them frozen in place once you moved past that
  // segment instead of continuing to move and despawn like everything else.
  if (active !== 'archivist') { updateEchoBooks(dt); updateWeavingBooks(dt); updateTrailSquares(dt); }
  if (active !== 'verdict') updateRingHazards(dt);
  if (active !== 'gale') { updateGaleFlags(dt); updateWindLines(dt); }
  if (active !== 'oracle') {
    for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (circleHit(p, p.r)) hurt(); }
    battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20);
  }
}

// The Witness's Reprise segment passes after 2 full shape-pattern cycles
// (barrage -> seek -> judgment, however that judgment goes) regardless of
// whether the soul was actually in the safe shape each time — reuses
// updateWitness itself rather than reimplementing its state machine, just
// watching from outside for the state transition that only happens when a
// judgment ends and the next pattern starts (judgment -> barrage).
function updateRepriseWitness(dt) {
  const stateBefore = battle.shapeState;
  // moveSoulWithShield explicitly — arrow keys are the shield for the whole
  // Erif fight, never movement (see updateWitness's moveFn param, bosses.js).
  updateWitness(dt, true, moveSoulWithShield);
  if (stateBefore === 'judgment' && battle.shapeState === 'barrage') {
    battle.repriseWitnessRounds++;
    if (battle.repriseWitnessRounds >= 2) battle.repriseWitnessDone = true;
  }
}
function updateReprisePhase(name, dt) {
  if (name === 'hourglass') updateRepriseHourglass(dt);
  else if (name === 'mask') updateMask(dt, true);
  else if (name === 'executioner') updateExecutioner(dt, true);
  else if (name === 'witness') updateRepriseWitness(dt);
  else if (name === 'archivist') updateRepriseArchivist(dt);
  else if (name === 'oracle') updateRepriseOracle(dt);
  else if (name === 'verdict') updateVerdict(dt, true, moveSoulWithShield); // see updateVerdict's moveFn note, bosses.js
  else if (name === 'gale') updateGale(dt, true);
  updateCarriedRepriseHazards(dt, name);
}

// Marks a phase boundary: records when it started (so later phases can time
// themselves relative to their own start, not the fight's absolute clock)
// and clears per-phase hazard state.
// keepProjectiles uses clearHazardsKeepProjectiles() (battle-core.js)
// instead of a full clearHazards() — every mechanic's state still resets
// cleanly, but in-flight hazard entities carry over instead of instantly
// despawning. Only the Reprise's own segment-to-segment transitions pass
// this; every other phase boundary (into Convergence, Enraged, etc.) still
// gets the full reset.
function bumpErifPhase(newPhase, keepProjectiles = false) {
  battle.phase = newPhase;
  battle.phaseStartT = battle.t;
  if (keepProjectiles) clearHazardsKeepProjectiles();
  else clearHazards();
}

// ---- Phase C: Convergence ----
// A rotating ring of 8 sigils, one per lieutenant family. Erif calls one
// at a time; standing inside it clears that family's hazards for a while.
// Reuses layoutSigils()/insideSigil() from hazards.js — the same helpers the
// Archivist uses.
const CONVERGENCE_CUE_TONE = { hourglass: 220, mask: 150, executioner: 165, witness: 125, archivist: 260, oracle: 280, verdict: 300, gale: 195 };
// 25% smaller than layoutSigils' own default (29) — with 8 (or even just a
// handful of remaining, in Final Convergence) laid out around the arena,
// the full-size circles were still crowding into each other a little even
// after switching to arc-length-uniform spacing.
const CONVERGENCE_SIGIL_RADIUS = 22;

function spawnConvergenceMark() {
  battle.marks.push({ x: battle.soul.x, y: battle.soul.y, t: .68 });
  tone(72, .055, 'square', .02);
}
function updateConvergenceMarks(dt) {
  for (const m of battle.marks) {
    m.t -= dt;
    if (m.t <= 0 && !m.fired) {
      m.fired = true;
      battle.blasts.push({ x: m.x, y: m.y, t: .40, maxT: .40 });
      // A fuller kick+tone+noise combo (matching the weight of Erif's other
      // "major hit" moments elsewhere, e.g. handleErifPunch) plus a
      // detonation spark burst — this used to be just the one thin tone and
      // a silent fade/scale-in, easy to miss entirely.
      kick(.045); tone(48, .16, 'sawtooth', .05); noiseHit(.09, .025, 1100);
      spawnSparks(m.x, m.y, 7, { color: EMBER, speed: [90, 200], life: .32 });
    }
  }
  battle.marks = battle.marks.filter(m => !m.fired);
  for (const b of battle.blasts) {
    b.t -= dt;
    // Grows from half size up to full size across its lifetime instead of
    // popping in at full size instantly — the hitbox scales the same way
    // render.js draws it, so it's never hittable past what's actually shown.
    const scale = lerp(.5, 1, clamp(1 - b.t / (b.maxT || .40), 0, 1));
    const vertical = { x: b.x - 7 * scale, y: b.y - 61 * scale, w: 14 * scale, h: 122 * scale };
    const horizontal = { x: b.x - 61 * scale, y: b.y - 7 * scale, w: 122 * scale, h: 14 * scale };
    if (rectHit(vertical) || rectHit(horizontal)) hurt();
  }
  battle.blasts = battle.blasts.filter(b => b.t > 0);
}
function spawnConvergenceAimedBullet() {
  const b = battle.box, s = battle.soul, edge = (Math.random() * 4) | 0;
  let x, y;
  if (edge === 0) { x = rand(b.x, b.x + b.w); y = b.y - 14; }
  else if (edge === 1) { x = b.x + b.w + 14; y = rand(b.y, b.y + b.h); }
  else if (edge === 2) { x = rand(b.x, b.x + b.w); y = b.y + b.h + 14; }
  else { x = b.x - 14; y = rand(b.y, b.y + b.h); }
  const a = Math.atan2(s.y - y, s.x - x) + rand(-.13, .13), speed = 160 * DIFFICULTY.projectileMult;
  battle.aimedBullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4 });
}
function spawnConvergenceSpears(family, hard = false, forcedSide = null, extraDelay = 0) {
  const before = battle.telegraphs.length;
  // Same gapped-bias fix as updateExecutioner (bosses.js) — this is the
  // executioner/mask cue's own spear volley, and since the Reckoning now
  // fires it once per finger-charge (see fireFingerShot, erif.js), a hand
  // carrying either of those wards was throwing a full solid wall on
  // basically every single shot. Spaced barrages are the common case now.
  if (Math.random() < .65) spawnSpearGappedWall(hard, choose([5, 7]), forcedSide, extraDelay);
  else spawnSpearVolley(hard, forcedSide, extraDelay);
  // Occasionally layer a second, adjacent-side needle burst for variety —
  // needles are dodged by position, not a shield read, so stacking one onto
  // the forced-direction volley doesn't demand two simultaneous shield reads.
  if (forcedSide && Math.random() < .45) {
    const adjacent = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
    spawnSpearNeedles(hard, choose(adjacent[forcedSide]));
  }
  for (let i = before; i < battle.telegraphs.length; i++) { battle.telegraphs[i].family = family; battle.telegraphs[i].mirror = family === 'mask'; }
}
// Shared by Convergence and Final Convergence — spawns one family's hazard,
// aimed at or from that family's current sigil position.
function spawnConvergenceCueHazard(cue, target) {
  const box = battle.box, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (cue === 'verdict') {
    // Back to plain, regular rings — one at a time, rotating, always with a
    // gap — matching Verdict's own standalone fight instead of the one-shot
    // tunnel-burst this used to do. See updateFinalConvergence's own
    // finalVerdictRingTimer, which keeps spawning a fresh one of these every
    // ~1.2s for as long as this cue stays active, not just once up front.
    battle.finalVerdictRingA = Math.atan2(target.y - cy, target.x - cx);
    battle.finalVerdictRingTimer = 0;
  } else if (cue === 'executioner' || cue === 'mask') {
    const dx = target.x - cx, dy = target.y - cy;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'up' : 'down');
    // The Mask's whole identity is that its spears might be lying —
    // battle.maskMirrored otherwise only ever gets toggled by updateMask
    // itself, which never runs during Convergence, so this cue was
    // silently resolving as honest steel every time despite still being
    // *tagged* mirror-eligible (see spawnConvergenceSpears). A coin flip
    // here gives it a real chance to actually lie, same as its own fight.
    if (cue === 'mask') battle.maskMirrored = Math.random() < .5;
    spawnConvergenceSpears(cue, false, side, .10);
  } else if (cue === 'hourglass') {
    // Hourglass hasn't used spears since its own fight was redesigned
    // around sand grains + drifting orbs (see updateHourglass, bosses.js) —
    // Convergence's cue was never updated to match and kept routing it
    // through the spear system. Orbs tagged so clearConvergenceCueHazards
    // can despawn exactly this batch once the sigil is captured. Sand
    // grains too — this cue was only ever spawning orbs, never any actual
    // sand, since updateFinalConvergence didn't call updateSandGrains either
    // (fixed there too).
    for (let i = 0; i < 2; i++) {
      spawnHourglassOrb(false);
      battle.hourglassOrbs[battle.hourglassOrbs.length - 1].family = cue;
    }
    for (let i = 0; i < 3; i++) spawnSandGrain(false);
  } else if (cue === 'gale') {
    // Same fix as Hourglass above — the Gale's own fight replaced spears
    // with homing flags + wind-line rows a while back; this cue never
    // followed. A couple of homing flags is the closest single-shot
    // equivalent to what a real gust actually delivers, plus an actual
    // wind-line row (see spawnWindRow, bosses.js) — this cue was only ever
    // spawning flags, never the wind trails, since updateFinalConvergence
    // didn't call updateWindLines either (fixed there too).
    for (let i = 0; i < 2; i++) {
      spawnGaleFlag(false);
      battle.galeFlags[battle.galeFlags.length - 1].family = cue;
    }
    spawnWindRow(false);
  } else if (cue === 'witness') {
    const anchors = [[box.x - 24, box.y + 35], [box.x + box.w + 24, box.y + 70], [box.x + 60, box.y - 24], [box.x + box.w - 60, box.y + box.h + 24]];
    anchors.forEach((a, i) => {
      const tx = lerp(battle.soul.x, target.x, .45) + rand(-35, 35), ty = lerp(battle.soul.y, target.y, .45) + rand(-35, 35);
      const ang = Math.atan2(ty - a[1], tx - a[0]);
      const witnessSpeed = 190 * DIFFICULTY.projectileMult;
      battle.shapes.push({ type: ['circle', 'triangle', 'square'][i % 3], x: a[0], y: a[1], vx: Math.cos(ang) * witnessSpeed, vy: Math.sin(ang) * witnessSpeed, size: 7, spin: rand(-4, 4), a: 0, life: 3.2, family: 'witness' });
    });
  } else if (cue === 'archivist') {
    // The archive scatters its torn pages outward from its own sigil,
    // reusing the shape-hazard primitive rather than a second sigil system.
    for (let i = 0; i < 4; i++) {
      const ang = rand(0, Math.PI * 2), speed = 170 * DIFFICULTY.projectileMult;
      battle.shapes.push({ type: choose(['circle', 'triangle', 'square']), x: target.x, y: target.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, size: 7, spin: rand(-4, 4), a: 0, life: 2.6, family: 'archivist' });
    }
    // Plus the same weaving-book-and-trail pressure the standalone trial
    // now uses (see bosses.js) — a single one is plenty for a one-shot cue.
    spawnWeavingBook(false, cue);
  } else { // oracle
    // Was 1.65s of thin ink-rain — barely noticeable next to every other
    // cue's actual hazard entities (orbs, spears, shapes...), so this reads
    // as "oracle does nothing." Longer and denser now (see the .14s spawn
    // interval in updateFinalConvergence, was .19s) for a real, sustained
    // downpour instead of a handful of stray drops.
    battle.inkTimer = 3.2; battle.inkSpawn = 0;
  }
}
function clearConvergenceCueHazards(cue) {
  if (cue === 'verdict') battle.rings = [];
  else if (cue === 'executioner' || cue === 'mask') {
    battle.telegraphs = battle.telegraphs.filter(t => t.family !== cue);
    battle.spears = battle.spears.filter(p => p.family !== cue);
  } else if (cue === 'hourglass') {
    battle.hourglassOrbs = battle.hourglassOrbs.filter(o => o.family !== cue);
  } else if (cue === 'gale') {
    battle.galeFlags = battle.galeFlags.filter(f => f.family !== cue);
  } else if (cue === 'witness' || cue === 'archivist') {
    battle.shapes = battle.shapes.filter(s => s.family !== cue);
    if (cue === 'archivist') {
      battle.weavingBooks = battle.weavingBooks.filter(w => w.family !== cue);
      battle.trailSquares = battle.trailSquares.filter(t => t.family !== cue);
    }
  } else { // oracle
    battle.bullets = []; battle.inkTimer = 0; battle.inkSpawn = 0; battle.q = null; battle.lasers = [];
  }
}
// Only the not-yet-captured families lay out now — a captured circle
// actually disappears from the ring, same visual language Final Convergence
// already uses, so progress is visible instead of the ring staying a fixed
// 8 forever.
function positionConvergenceSigils() {
  const remaining = REPRISE_ORDER.filter(n => !battle.convergenceCaptured[n]);
  layoutSigils(remaining, battle.convergenceOrbit, battle.box.w * .34, battle.box.h * .31, CONVERGENCE_SIGIL_RADIUS);
}
function startConvergenceCommand() {
  battle.q = null; battle.lasers = [];
  const remaining = REPRISE_ORDER.filter(n => !battle.convergenceCaptured[n]);
  if (!remaining.length) { startErifEnrageDialogue(); return; } // safety net — the capture check below already catches this normally
  if (!battle.convergenceDeck.length) battle.convergenceDeck = shuffleArray(remaining);
  battle.convergenceDeck = battle.convergenceDeck.filter(n => !battle.convergenceCaptured[n]);
  if (!battle.convergenceDeck.length) battle.convergenceDeck = shuffleArray(remaining);
  battle.convergenceCue = battle.convergenceDeck.pop();
  battle.convergenceCueMax = 2.75 * DIFFICULTY.telegraphMult;
  battle.convergenceCueTimer = battle.convergenceCueMax;
  battle.convergenceTouchHold = 0;
  if (Math.random() < .32) battle.convergenceOrbitDir *= -1;
  positionConvergenceSigils();
  const target = battle.sigils.find(s => s.name === battle.convergenceCue);
  spawnConvergenceCueHazard(battle.convergenceCue, target);
  tone(CONVERGENCE_CUE_TONE[battle.convergenceCue], .09, 'triangle', .035);
}
function updateConvergence(dt) {
  moveSoulWithShield(dt, 226);
  battle.convergenceOrbit += dt * battle.convergenceOrbitDir * .68;
  positionConvergenceSigils();

  if (!battle.convergenceCue) {
    battle.convergenceCueWait -= dt;
    if (battle.convergenceCueWait <= 0) startConvergenceCommand();
  } else {
    battle.convergenceCueTimer -= dt;
    const target = battle.sigils.find(s => s.name === battle.convergenceCue);
    if (target && insideSigil(target)) {
      battle.convergenceTouchHold += dt;
      if (battle.convergenceTouchHold >= .28) {
        const cleared = battle.convergenceCue;
        clearConvergenceCueHazards(cleared);
        battle.sigilPulse = { x: target.x, y: target.y, t: .34, name: cleared };
        tone(510, .075, 'sine', .035);
        battle.convergenceCue = null; battle.convergenceCueWait = .34; battle.convergenceTouchHold = 0;
        // Each family only needs to be filled once now — capturing it here
        // retires it from the ring for good instead of it going back into
        // the deck to potentially come up again.
        if (!battle.convergenceCaptured[cleared]) {
          battle.convergenceCaptured[cleared] = true;
          battle.convergenceCaptureCount++;
        }
        if (battle.convergenceCaptureCount >= REPRISE_ORDER.length) { startErifEnrageDialogue(); return; }
      }
    } else battle.convergenceTouchHold = 0;
    if (battle.convergenceCue && battle.convergenceCueTimer <= 0) {
      hurt(); battle.convergenceCue = null; battle.convergenceCueWait = .40; battle.convergenceTouchHold = 0;
    }
  }

  battle.q = null; battle.lasers = []; // defensive: no quiz ever active in Convergence
  if (battle.sigilPulse) { battle.sigilPulse.t -= dt; if (battle.sigilPulse.t <= 0) battle.sigilPulse = null; }

  // Erif's own ambient pressure — the plus-shaped marks/blasts and the
  // small homing "aimed" bullets — keeps running underneath whichever cue
  // is active. These aren't tied to any lieutenant family, so they don't
  // conflict with "the lit sigil's family is the only *lieutenant* attack
  // happening right now"; they're just him, still dangerous between reads.
  battle.spawn -= dt;
  if (battle.spawn <= 0) { spawnConvergenceMark(); battle.spawn = 1.02; }
  battle.aimedBulletTimer -= dt;
  if (battle.aimedBulletTimer <= 0) { spawnConvergenceAimedBullet(); battle.aimedBulletTimer = .48; }
  if (battle.inkTimer > 0) {
    battle.inkTimer -= dt; battle.inkSpawn -= dt;
    if (battle.inkSpawn <= 0) {
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 8, vx: rand(-45, 45) * DIFFICULTY.projectileMult, vy: 235 * DIFFICULTY.projectileMult, r: 5 });
      battle.inkSpawn = .17;
    }
  }

  updateConvergenceMarks(dt);
  for (const p of battle.aimedBullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.aimedBullets = battle.aimedBullets.filter(p => p.x > battle.box.x - 40 && p.x < battle.box.x + battle.box.w + 40 && p.y > battle.box.y - 40 && p.y < battle.box.y + battle.box.h + 40);
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20);
  updateRingHazards(dt); updateSpearHazards(dt, true); updateShapeHazards(dt, true);
  // Hourglass/Gale cues (see spawnConvergenceCueHazard above) spawn real
  // orbs/flags now instead of borrowed spears — these need their own update
  // loops run somewhere, which Convergence never did before since it never
  // used to spawn either kind of hazard.
  updateHourglassOrbs(dt); updateGaleFlags(dt);
  updateWeavingBooks(dt); updateTrailSquares(dt);
}

// ---- Enrage dialogue interstitial (Convergence -> Enraged) ----
function startErifEnrageDialogue() {
  if (!battle || battle.enrageDialogueShown) return;
  battle.enrageDialogueShown = true;
  if (!ERIF_ENRAGE_DIALOGUE.length) { beginErifEnraged(); return; } // safety fallback if ever reached before lore is written
  clearHazards();
  // Triple speed (see updateDialogueReveal's charsPerSec) — this one already
  // plays through automatically with no player input, so there's no reason
  // to make it linger at the normal typing pace.
  dialogue = { lines: ERIF_ENRAGE_DIALOGUE, index: 0, after: 'erifEnraged', context: 'battle', charsPerSec: DIALOGUE_CHARS_PER_SEC * 3 };
  mode = 'dialogue';
  tone(42, .42, 'sawtooth', .065);
}

// ---- Phase D: Enraged ----
// All 8 families run at once: a continuous ring spiral, spear volleys that
// may or may not be honest (the Mask's mirror keeps flipping in the
// background), a shard barrage from anchored hands, and an Oracle-style
// quiz that opens 4 ring passages while it's live. Marks/aimed bullets stay
// on as ambient pressure, same as in Convergence.
function spawnEnragedShard() {
  const h = choose(battle.hands), s = battle.soul;
  const a = Math.atan2(s.y - h.y, s.x - h.x) + rand(-.18, .18), speed = 178 * DIFFICULTY.projectileMult;
  battle.shapes.push({ type: choose(['circle', 'triangle', 'square']), x: h.x, y: h.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 7, spin: rand(-5, 5), a: 0, life: 3.4 });
  h.tx = s.x; h.ty = s.y;
}
// The arena widens AND grows downward once Enraged begins, and stays that
// size through Final Convergence and the true final phase (none of which
// ever reset battle.box) — every family hitting at once has more room to
// spread out in, and the HP row/timer/phase-name below the box (now
// positioned relative to battle.box.y + battle.box.h, see drawBattle) get
// pushed low enough to slide off the bottom of the screen entirely. From
// here on the only HP read the player gets is the candle's own visibly
// shrinking wax — deliberately no numeric readout anymore.
// h=390 puts the box's own bottom edge at y=639 — right at the canvas edge
// (H=640) but still fully on-screen, so the actual playable arena (and
// anything spawning near its bottom) stays visible. The UI row below it
// (HP/timer/phase-name, all positioned relative to this bottom edge — see
// drawBattle) starts at +16 past that, comfortably past 640 and gone.
const ERIF_ENRAGE_BOX = { x: 140, y: 249, w: 680, h: 390 };
const ERIF_ENRAGE_BOX_GROW_TIME = 1.8;
// The foreground focus of Enraged now alternates between math (the Oracle-
// style question+laser mechanic) and memory (an Archivist-style sigil
// sequence) in exactly 5 segments total, each a single round — `value` is
// the answer-option count for a math round (forced via
// battle.qOptionCountOverride, see hazards.js's oracleOptionCount) or the
// symbol-sequence length for a memory round (startEchoRound's
// lengthOverride). New background-hazard spawns (rings/spears/shards/marks
// — see updateEnraged's inMemory gate) hold off during memory segments so
// they can actually be read and played instead of getting buried under the
// same simultaneous chaos math segments lean into; existing hazards already
// in flight still finish out normally either way. The phase ends — straight
// into Final Convergence — once the last segment's round resolves,
// replacing the old flat-duration timer.
const ERIF_ENRAGE_MINIGAME_PLAN = [
  { type: 'math', value: 3 },
  { type: 'memory', value: 2 },
  { type: 'math', value: 4 },
  { type: 'memory', value: 3 },
  { type: 'math', value: 5 },
];
// Every segment here is exactly one round, so this just moves straight to
// the next segment. Returns true the instant the whole plan is complete,
// having already kicked off Final Convergence — callers should bail out for
// the frame when this happens.
function advanceEnrageSegment() {
  battle.enrageSegmentIndex++;
  if (battle.enrageSegmentIndex >= ERIF_ENRAGE_MINIGAME_PLAN.length) { startErifFinalConvergence(); return true; }
  return false;
}
// A single wind gust, ever — reuses the standalone/Reprise Gale's own
// beginGaleGust/launchGaleGust/endGaleGust lifecycle (bosses.js: telegraph,
// then control-inversion + a push while "active", then done), but instead
// of repeating on a cooldown forever, this fires once and never again —
// usedField gets set true right as it ends, so callers can just fire-and-
// forget this every frame. Enraged and Final Convergence each get their own
// usedField/timerField pair so one phase's single gust doesn't consume the
// other's. requireGaleCue (Final Convergence only) ties the gust to the
// Gale's own sigil actually being the active cue instead of firing at a
// random moment regardless of what's happening — Enraged has no such cue
// concept, so it keeps the plain random-delay version.
function updateOneShotGaleGust(dt, hard, usedField, timerField, requireGaleCue = false) {
  if (battle[usedField]) return;
  if (!battle.galeGustPhase) {
    if (requireGaleCue && battle.convergenceCue !== 'gale') { battle[timerField] = null; return; }
    battle[timerField] = (battle[timerField] ?? (requireGaleCue ? rand(.4, 1.4) : rand(12, 22))) - dt;
    if (battle[timerField] <= 0) beginGaleGust(hard);
    return;
  }
  if (battle.galeGustPhase === 'telegraph') {
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) launchGaleGust(hard);
  } else if (battle.galeGustPhase === 'active') {
    const b = battle.box, s = battle.soul;
    s.x = clamp(s.x + battle.windVX * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = clamp(s.y + battle.windVY * dt, b.y + s.r, b.y + b.h - s.r);
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) { endGaleGust(hard); battle[usedField] = true; }
  }
}
function beginErifEnraged() {
  if (!battle) return;
  bumpErifPhase(PHASE_ENRAGED);
  battle.enraged = true;
  battle.boxGrowFrom = { ...battle.box };
  battle.boxGrowTo = { ...ERIF_ENRAGE_BOX };
  battle.boxGrowT = 0;
  battle.soul.x = W / 2; battle.soul.y = 384; battle.soul.vx = 0; battle.soul.vy = 0;
  mode = 'battle';
  tone(38, .55, 'sawtooth', .075);
}
function updateEnraged(dt) {
  if (battle.boxGrowT < ERIF_ENRAGE_BOX_GROW_TIME) {
    battle.boxGrowT = Math.min(ERIF_ENRAGE_BOX_GROW_TIME, battle.boxGrowT + dt);
    const p = 1 - Math.pow(1 - battle.boxGrowT / ERIF_ENRAGE_BOX_GROW_TIME, 3); // ease-out cubic
    const f = battle.boxGrowFrom, t = battle.boxGrowTo;
    battle.box = { x: lerp(f.x, t.x, p), y: lerp(f.y, t.y, p), w: lerp(f.w, t.w, p), h: lerp(f.h, t.h, p) };
  }
  moveSoulWithShield(dt, 218);
  // At most one wind gust for the entire phase — see updateOneShotGaleGust.
  updateOneShotGaleGust(dt, true, 'enrageGaleGustUsed', 'enrageGaleGustTimer');
  if (!battle.enrageInitialized) {
    battle.enrageInitialized = true;
    battle.ringGapA = rand(0, Math.PI * 2); battle.ringArcDirection = choose([-1, 1]);
    battle.enrageRingTimer = .15; battle.enrageVolleyTimer = 1.1; battle.enrageShardTimer = .12; battle.enrageQuestionTimer = 1.8;
    battle.maskMirrorTimer = rand(1.8, 2.8);
    const b = battle.box;
    const anchors = [[b.x - 28, b.y + 45], [b.x + b.w + 28, b.y + 45], [b.x - 28, b.y + b.h - 45], [b.x + b.w + 28, b.y + b.h - 45], [b.x + b.w * .32, b.y - 30], [b.x + b.w * .68, b.y + b.h + 30]];
    battle.hands = anchors.map(a => makeHand(a[0], a[1], b.x + b.w / 2, b.y + b.h / 2));
  }

  battle.maskMirrorTimer -= dt;
  if (battle.maskMirrorTimer <= 0 && battle.telegraphs.length === 0) { flipMaskMirror(); battle.maskMirrorTimer = rand(1.8, 2.8); }

  const enrageSeg = ERIF_ENRAGE_MINIGAME_PLAN[battle.enrageSegmentIndex];

  // These background hazards run continuously regardless of whether the
  // current segment is math or memory — Enraged is meant to stay "all eight
  // brands active" throughout, not go quiet during memory rounds.
  battle.enrageRingTimer -= dt;
  if (battle.enrageRingTimer <= 0) {
    battle.ringGapA += battle.ringArcDirection * .11;
    // battle.q.a.length instead of a fixed 4 — the Oracle's own answer count
    // now grows with rounds solved (see oracleOptionCount in hazards.js), and
    // this ring-passage count needs to track whatever the active quiz
    // actually has, here and in the laser spawn below.
    const answerPassages = battle.q ? battle.q.a.length : 1;
    // Shrink speed halved (was 112) — the chaos phase's ring was closing
    // in noticeably faster than Verdict's own version of the same hazard.
    // Per-gap opening widened (.34 -> .42) — with several answer lanes
    // (gapCount up to 5) plus multiple overlapping rings shrinking at once,
    // the tighter gap made it too easy to get squeezed with nowhere safe to
    // stand; this stays closer to Verdict's own standalone opening size
    // (.36-.52) so it never reads as unfair. Ensure Enraged always leaves
    // at least two passage gaps so the player has multiple lanes to choose.
    const enrageGapCount = Math.max(answerPassages, 2);
    spawnRing(true, battle.ringGapA, 365, battle.ringArcDirection * .04, 56, answerPassages <= 1 ? 1.0 : .42, enrageGapCount);
    battle.enrageRingTimer = 1.63; // +25% (was 1.30) — less ring spam stacking back to back
  }
  battle.enrageVolleyTimer -= dt;
  if (battle.enrageVolleyTimer <= 0) {
    // Small spaced-out bursts (3/5/7 spears clustered near the soul, see
    // spawnSpearNeedles) instead of a full-width wall or the multi-side
    // special patterns — those were covering the whole arena at once on
    // top of everything else Enraged already throws.
    spawnSpearNeedles(true, null, choose([3, 5, 7]));
    battle.enrageVolleyTimer = rand(2.6, 3.6);
  }
  battle.enrageShardTimer -= dt;
  if (battle.enrageShardTimer <= 0) { spawnEnragedShard(); battle.enrageShardTimer = .38; }

  if (!enrageSeg || enrageSeg.type === 'math') {
    if (!battle.q) {
      battle.enrageQuestionTimer -= dt;
      if (battle.enrageQuestionTimer <= 0) {
        // This segment's answer-option count is forced straight off the
        // plan (3/4/5) rather than the usual solved-rounds ramp — see
        // oracleOptionCount, hazards.js.
        battle.qOptionCountOverride = enrageSeg ? enrageSeg.value : null;
        battle.q = generateOracleQuestion(true);
        battle.qOptionCountOverride = null;
        battle.qMax = 3.15; battle.qTimer = battle.qMax; battle.lasers = [];
        tone(335, .10, 'triangle', .035);
      }
    } else if (battle.lasers.length === 0) {
      battle.qTimer -= dt;
      if (battle.qTimer <= 0) {
        const count = battle.q.a.length, lane = battle.box.w / count;
        for (let i = 0; i < count; i++) if (i !== battle.q.ok) battle.lasers.push({ x: battle.box.x + i * lane + 5, y: battle.box.y + 5, w: lane - 10, h: battle.box.h - 10, t: .62 });
        tone(82, .18, 'sawtooth', .055);
      }
    }
    const hadLasers = battle.lasers.length > 0;
    for (const l of battle.lasers) { l.t -= dt; if (rectHit(l)) hurt(); }
    battle.lasers = battle.lasers.filter(l => l.t > 0);
    if (hadLasers && !battle.lasers.length) {
      battle.q = null; battle.enrageQuestionTimer = 1.2;
      if (advanceEnrageSegment()) return;
    }
  } else {
    // Memory segment — same reveal/input/resolve state machine the
    // Archivist's other quick-match gates use (see updateArchivistQuickMatch),
    // inlined here since Enraged counts rounds against its own segment plan
    // instead of a {round, successes, done} cfg object.
    if (!battle.sigils.length) startEchoRound(true, enrageSeg.value);
    if (battle.echoPhase === 'reveal') updateEchoReveal(dt, true);
    else if (battle.echoPhase === 'input') updateEchoInput(dt);
    else if (battle.echoPhase === 'resolve') {
      battle.echoResolveTimer -= dt;
      if (battle.echoResolveTimer <= 0) {
        battle.sigils = []; battle.echoSequence = [];
        if (advanceEnrageSegment()) return;
      }
    }
    if (battle.sigilPulse) { battle.sigilPulse.t -= dt; if (battle.sigilPulse.t <= 0) battle.sigilPulse = null; }
  }

  battle.spawn -= dt;
  if (battle.spawn <= 0) { spawnConvergenceMark(); battle.spawn = 1.95; } // +1s, was .95 — was getting spammed
  updateConvergenceMarks(dt);

  updateRingHazards(dt);
  updateSpearHazards(dt, false, launchMaskSpear);
  updateShapeHazards(dt);
}

// ---- Phase E: Final Convergence ----
// Same sigil-capture idea as Convergence, but capturing a family now removes
// it permanently. Capturing all 6 wins the fight.
function positionFinalSigils() {
  const remaining = REPRISE_ORDER.filter(n => !battle.finalCaptured[n]);
  layoutSigils(remaining, battle.convergenceOrbit, battle.box.w * .34, battle.box.h * .31, CONVERGENCE_SIGIL_RADIUS);
}
function remainingFinalFamilies() { return REPRISE_ORDER.filter(n => !battle.finalCaptured[n]); }
function startErifFinalConvergence() {
  if (!battle || battle.finalConvergence) return;
  bumpErifPhase(PHASE_FINAL_CONVERGENCE);
  battle.finalConvergence = true;
  battle.finalCaptured = { hourglass: false, mask: false, executioner: false, witness: false, archivist: false, oracle: false, verdict: false, gale: false };
  battle.finalCaptureCount = 0;
  battle.convergenceOrbit = 0; battle.convergenceOrbitDir = choose([-1, 1]);
  positionFinalSigils();
  battle.convergenceCueWait = .75;
  battle.aimedBulletTimer = .42; battle.spawn = .65;
  battle.finalTransitionFlash = 1.15;
  battle.soul.x = battle.box.x + battle.box.w / 2; battle.soul.y = battle.box.y + battle.box.h / 2;
  battle.soul.vx = 0; battle.soul.vy = 0;
  tone(34, .62, 'sawtooth', .085);
}
// Capturing a family here now takes real time standing in the circle rather
// than a quick tap — 2s of hold, decaying at FINAL_CONVERGENCE_LEAVE_DECAY
// (not snapping to 0) if the soul steps out, paired with the arena itself
// slowly closing in (see updateFinalConvergence's finalShrinkTimer).
const FINAL_CONVERGENCE_HOLD_TIME = 2;
const FINAL_CONVERGENCE_LEAVE_DECAY = .25;
function startFinalCommand() {
  battle.q = null; battle.lasers = []; battle.inkTimer = 0; battle.inkSpawn = 0;
  const remaining = remainingFinalFamilies();
  if (!remaining.length) { beginErifVictory(); return; }
  if (!battle.convergenceDeck.length) battle.convergenceDeck = shuffleArray(remaining);
  battle.convergenceDeck = battle.convergenceDeck.filter(n => !battle.finalCaptured[n]);
  if (!battle.convergenceDeck.length) battle.convergenceDeck = shuffleArray(remaining);
  battle.convergenceCue = battle.convergenceDeck.pop();
  // +5s over the old 3.15s window — that was sized for a quick tap, not a
  // 5s hold, so it needs real room for travel time plus the full hold.
  battle.convergenceCueMax = (3.15 + 5) * DIFFICULTY.telegraphMult;
  battle.convergenceCueTimer = battle.convergenceCueMax;
  battle.convergenceTouchHold = 0;
  if (Math.random() < .38) battle.convergenceOrbitDir *= -1;
  positionFinalSigils();
  const target = battle.sigils.find(s => s.name === battle.convergenceCue);
  if (!target) return;
  spawnConvergenceCueHazard(battle.convergenceCue, target);
  tone(CONVERGENCE_CUE_TONE[battle.convergenceCue], .11, 'triangle', .04);
}
function updateFinalConvergence(dt) {
  moveSoulWithShield(dt, 224);
  // At most one wind gust for the entire phase, and only while Gale's own
  // sigil is the active cue — see updateOneShotGaleGust.
  updateOneShotGaleGust(dt, true, 'finalGaleGustUsed', 'finalGaleGustTimer', true);
  // Verdict's own cue: a plain rotating ring with a gap, spawned fresh every
  // ~1.2s for as long as its sigil is the active cue — see
  // spawnConvergenceCueHazard's verdict branch, which just arms this timer
  // rather than bursting out a whole batch at once.
  if (battle.convergenceCue === 'verdict') {
    battle.finalVerdictRingTimer -= dt;
    if (battle.finalVerdictRingTimer <= 0) {
      battle.finalVerdictRingA += battle.convergenceOrbitDir * .35;
      spawnRing(true, battle.finalVerdictRingA, 360, battle.convergenceOrbitDir * 1.0, 160, .45, 2);
      battle.finalVerdictRingTimer = 1.2;
    }
  }
  battle.finalTransitionFlash = Math.max(0, battle.finalTransitionFlash - dt);
  // The arena closes in as the fight drags on — 1% off the width (split
  // evenly off both sides) and 1% off the height (taken entirely off the
  // bottom; the top edge, where the header sits, stays put) every second.
  battle.finalShrinkTimer -= dt;
  if (battle.finalShrinkTimer <= 0) {
    battle.finalShrinkTimer += 1;
    const dw = battle.box.w * .01, dh = battle.box.h * .01;
    battle.box.x += dw / 2; battle.box.w -= dw;
    battle.box.h -= dh;
  }
  battle.convergenceOrbit += dt * battle.convergenceOrbitDir * .6;
  positionFinalSigils();

  if (!battle.convergenceCue) {
    battle.convergenceCueWait -= dt;
    if (battle.convergenceCueWait <= 0) startFinalCommand();
  } else {
    battle.convergenceCueTimer -= dt;
    const target = battle.sigils.find(s => s.name === battle.convergenceCue);
    if (target && insideSigil(target)) {
      battle.convergenceTouchHold += dt;
      if (battle.convergenceTouchHold >= FINAL_CONVERGENCE_HOLD_TIME) {
        const captured = battle.convergenceCue;
        // No longer force-clearing that family's active hazards on capture —
        // they now linger and finish out naturally (drift off, expire, etc.)
        // same as everywhere else in the fight, instead of instantly
        // vanishing the moment the circle fills.
        battle.finalCaptured[captured] = true;
        battle.finalCaptureCount++;
        battle.convergenceDeck = battle.convergenceDeck.filter(n => n !== captured);
        battle.sigilPulse = { x: target.x, y: target.y, t: .52, name: captured };
        battle.convergenceCue = null; battle.convergenceCueWait = .48; battle.convergenceTouchHold = 0;
        tone(620 + battle.finalCaptureCount * 80, .12, 'sine', .05);
        if (battle.finalCaptureCount >= REPRISE_ORDER.length) { beginErifVictory(); return; }
      }
    } else {
      // Leaks away instead of snapping to 0 — stepping out to dodge a
      // hazard costs progress, but not all of it.
      battle.convergenceTouchHold = Math.max(0, battle.convergenceTouchHold - dt * FINAL_CONVERGENCE_LEAVE_DECAY);
    }
    if (battle.convergenceCue && battle.convergenceCueTimer <= 0) {
      hurt(); battle.convergenceCue = null; battle.convergenceCueWait = .42; battle.convergenceTouchHold = 0;
    }
  }

  battle.q = null; battle.lasers = [];
  if (battle.sigilPulse) { battle.sigilPulse.t -= dt; if (battle.sigilPulse.t <= 0) battle.sigilPulse = null; }
  battle.spawn -= dt;
  if (battle.spawn <= 0) { spawnConvergenceMark(); battle.spawn = 2.14; } // +1s, was 1.14 — was getting spammed
  battle.aimedBulletTimer -= dt;
  if (battle.aimedBulletTimer <= 0) { spawnConvergenceAimedBullet(); battle.aimedBulletTimer = .56; }
  if (battle.inkTimer > 0) {
    battle.inkTimer -= dt; battle.inkSpawn -= dt;
    if (battle.inkSpawn <= 0) {
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 8, vx: rand(-40, 40) * DIFFICULTY.projectileMult, vy: 225 * DIFFICULTY.projectileMult, r: 5 });
      battle.inkSpawn = .14; // was .19 — denser now that inkTimer itself also runs longer (see spawnConvergenceCueHazard's oracle branch)
    }
  }
  updateConvergenceMarks(dt);
  for (const p of battle.aimedBullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.aimedBullets = battle.aimedBullets.filter(p => p.x > battle.box.x - 40 && p.x < battle.box.x + battle.box.w + 40 && p.y > battle.box.y - 40 && p.y < battle.box.y + battle.box.h + 40);
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20);
  updateRingHazards(dt); updateSpearHazards(dt, true); updateShapeHazards(dt, true);
  // Hourglass/Gale cues now spawn real sand/orbs/flags/wind rows (see
  // spawnConvergenceCueHazard) — need their own update loops run.
  updateSandGrains(dt); updateHourglassOrbs(dt); updateGaleFlags(dt); updateWindLines(dt);
  updateWeavingBooks(dt); updateTrailSquares(dt);
}

// ---- Victory sequence ----
function beginErifVictory() {
  if (!battle || battle.erifVictoryStarted) return;
  clearHazards();
  battle.erifVictoryStarted = true;
  battle.victoryT = 0;
  battle.victoryDialogueIndex = 0;
  battle.victoryRevealCount = 0;
  battle.convergenceCue = null;
  mode = 'erifVictory';
  tone(31, .8, 'sawtooth', .09);
}
function updateErifVictory(dt) {
  if (!battle) return;
  battle.victoryT += dt;
  // The music takes 5s longer to fade out than the white flash itself takes
  // to fade in (see drawErifVictory's t>1.18 / (t-1.18)/5 progress, a 5s
  // visual fade ending at t=6.18) — the theme lingers well into the white
  // "You have outburned the flame." beat instead of cutting out the instant
  // the screen finishes going white, then finishes fading out well before
  // dialogue can start (t=11.63).
  if (battle.victoryT > 1.18) musicFadeMult = 1 - clamp((battle.victoryT - 1.18) / 10, 0, 1);
  if (battle.victoryT >= 11.63) {
    // Types on like every other dialogue in the game instead of appearing
    // all at once — this screen predates the shared dialogue object system
    // and never got the same reveal treatment.
    const idx = Math.min(battle.victoryDialogueIndex, ERIF_FINAL_DIALOGUE.length - 1);
    const len = ERIF_FINAL_DIALOGUE[idx].length, cur = battle.victoryRevealCount || 0;
    if (cur < len) {
      const next = Math.min(len, cur + DIALOGUE_CHARS_PER_SEC * dt);
      // Same soft typing tick updateDialogueReveal uses for every other
      // dialogue in the game — this screen's own reveal never had it.
      if (Math.floor(next / 3) > Math.floor(cur / 3)) tone(200 + rand(-15, 15), .025, 'square', .011);
      battle.victoryRevealCount = next;
    }
    if (tap(' ')) {
      // First press while still typing just finishes the line instantly,
      // same convention advanceDialogue() uses.
      if ((battle.victoryRevealCount || 0) < len) { battle.victoryRevealCount = len; return; }
      battle.victoryDialogueIndex++;
      battle.victoryRevealCount = 0;
      tone(150 + battle.victoryDialogueIndex * 32, .045, 'triangle', .022);
      if (battle.victoryDialogueIndex >= ERIF_FINAL_DIALOGUE.length) {
        // Hard-exclusive — the twist leads into The Reckoning (see
        // beginErifTrueFinal). Normal ends cleanly right here with nothing after.
        if (difficultyTier === 'hard' && !battle.erifHandsStarted) {
          startErifTwist();
        } else {
          save.erifWon = true;
          saveGame();
          stopMusic();
          mode = 'ending';
          messageTimer = 0;
        }
      }
    }
  }
}

// ---- Hard-only: the fake-out twist and "The Reckoning" (phase 10) ----
function startErifTwist() {
  if (!battle) return;
  dialogue = { lines: ERIF_TWIST_DIALOGUE, index: 0, after: 'erifTrueFinal', context: 'battle' };
  mode = 'erifTwist';
  tone(45, .4, 'sawtooth', .06);
}

// ---- "The Reckoning": a two-hands Kirby-style boss fight, fought in waves
// of 2. Each wave, both hands wear one ward apiece, wander the arena firing
// their ward's attack from their own fingertips, and periodically break off
// to chase the player and slam down — that slam is the ONLY window to
// actually damage a hand. Once BOTH of a wave's hands are broken (2 hits
// each), they vanish for good and a real window opens to land a hit on
// Erif's own head — land one and the wave is confirmed, the next 2 (new,
// random) wards come out; let the window run out without landing a hit and
// the same 2 wards regenerate, hands and all, no progress lost but none
// gained either. 4 waves clears all 8 wards, after which the head stays
// permanently exposed to finish off (unchanged end state, straight into the
// existing beginErifTrueVictory/true-ending flow). A hard 100s clock
// white-fades the whole fight out if it runs long. ----
// h trimmed from 580 — unlike Enraged/Final Convergence, this phase keeps
// the HP row/timer/controls legend on-screen (see hideBottomUI, main.js) on
// purpose, so the bottom edge is raised enough to leave that whole strip
// real room below the arena instead of pushing it off-canvas.
const ERIF_HANDS_BOX = { x: 25, y: 30, w: 910, h: 490 };
const ERIF_HANDS_BOX_GROW_TIME = 1.4;
const HAND_WARD_HP = 2, ERIF_HEAD_HP = 6;
const HAND_HIT_RANGE = 100, HEAD_HIT_RANGE = 170;
const HEAD_HIT_COOLDOWN = .35;
// Up from a single-hit-window's old 2.2s — this is now a real "get some
// time to hit the boss" window per the wave design, not a snap reaction
// check, since letting it expire has a real cost (the wave's 2 wards
// regenerate) rather than just quietly closing.
const HEAD_WINDOW_TIME = 4.5;
const ERIF_HEAD_SCALE = .85; // read by render.js's drawErifHeadHUD too
const RECKONING_TIME_LIMIT = 100, RECKONING_FADE_WINDOW = 5;

// Hand movement AI — wander/chase/slam/flee/retract. Numbers are tuned
// (tighter than a looser first pass) so realistic, non-perfect play clears
// all 8 wards with real buffer under the 100s hard cap rather than right up
// against it — see RECKONING_TIME_LIMIT above.
const HAND_DOCK_OFFSET = 110; // either side of Erif's own anchor point
const EQUIP_TIME = .35;
const EMERGE_SPEED = 380, EMERGE_MIN_TIME = .4, EMERGE_MAX_TIME = .9;
const WANDER_SPEED = 95, WANDER_TURN_RATE = 2.0;
const WANDER_REPICK_TIME = [1.3, 2.0];
const SLAM_COOLDOWN = [2.4, 3.6];
const CHASE_SPEED = 260, CHASE_TURN_RATE = 3.0, CHASE_MAX_TIME = 1.1, SLAM_ENGAGE_RANGE = 64;
const SLAM_TELEGRAPH_TIME = .55;
const HAND_VULNERABLE_TIME = 2.0;
const RETRACT_SPEED = 480, RETRACT_MIN_TIME = .35, RETRACT_MAX_TIME = 1.1;

// Fingers — 1 thumb + 3 pointers, fanned around local "forward" (angle 0 =
// hand.facing). Each independently charges (reach eases from reachMin to
// reachMax — the visible "filling up" cue) and fires on its own timer,
// spreading a single ward's attack across 4 origins instead of one wrist.
const HAND_FINGERS = [
  { angle: -1.15, thumb: true, reachMin: 20, reachMax: 32 },
  { angle: -0.32, thumb: false, reachMin: 28, reachMax: 46 },
  { angle: 0, thumb: false, reachMin: 30, reachMax: 50 },
  { angle: 0.32, thumb: false, reachMin: 28, reachMax: 46 },
];
const FINGER_CHARGE_TIME = 1.8;
const FINGER_STAGGER = [0, .45, .9, 1.35]; // initial offsets so all 4 don't fire in lockstep
// oracle/gale/verdict fire a single global effect regardless of which
// finger triggers them (confirmed in spawnConvergenceCueHazard — none of
// the three actually vary with target position), so they're throttled
// separately from the per-finger charge to avoid a hand quadruple-stacking
// the same effect; a finger that rolls one of these on cooldown fires a
// bounce ball instead, so no charge is ever wasted.
const GLOBAL_WARD_COOLDOWN = 2.5;
const BOUNCE_BALL_CHANCE = 0.225; // spawn 25% less often (was .3)
const BOUNCE_BALL_SPEED = 210, BOUNCE_BALL_R = 6.5; // radius reduced by 50% (was 13)

// Erif's own rest/pull anchor — hands dock near this point, and the head's
// own live position (battle.erifHeadX/Y) softly drifts toward a blend of
// this and the hands' centroid (see updateErifHandsFinale). Reads
// battle.box live every frame, same as the old fixed erifHeadPos formula
// did, so it still tracks the box's own grow-in animation for free.
function erifHomeAnchor() {
  const b = battle.box;
  return { x: b.x + b.w * .5, y: b.y + b.h * .40 };
}
function handDockPos(index) {
  const home = erifHomeAnchor();
  return { x: home.x + (index === 0 ? -HAND_DOCK_OFFSET : HAND_DOCK_OFFSET), y: home.y + 90 };
}
function randWanderPoint() {
  const b = battle.box;
  return { x: rand(b.x + 90, b.x + b.w - 90), y: rand(b.y + 80, b.y + b.h - 60) };
}
function clampHandToBox(hand) {
  const b = battle.box;
  hand.x = clamp(hand.x, b.x + 60, b.x + b.w - 60);
  hand.y = clamp(hand.y, b.y + 60, b.y + b.h - 60);
}
// One small shared lerp helper, reused by both 'emerging' and 'retreating'
// instead of two bespoke travel systems — ease-out-cubic, same convention
// the box-grow animation already uses.
function startHandTravel(hand, from, to, speed, minT, maxT) {
  hand.travelFrom = from; hand.travelTo = to;
  hand.travelDur = clamp(dist(from.x, from.y, to.x, to.y) / speed, minT, maxT);
  hand.travelT = 0;
}
function updateHandTravel(hand, dt) {
  hand.travelT = Math.min(hand.travelDur, hand.travelT + dt);
  const p = hand.travelDur > 0 ? 1 - Math.pow(1 - hand.travelT / hand.travelDur, 3) : 1;
  hand.x = lerp(hand.travelFrom.x, hand.travelTo.x, p);
  hand.y = lerp(hand.travelFrom.y, hand.travelTo.y, p);
  return hand.travelT >= hand.travelDur;
}
function pickWanderTarget(hand) {
  hand.wanderTarget = randWanderPoint();
  hand.wanderRepickT = rand(WANDER_REPICK_TIME[0], WANDER_REPICK_TIME[1]);
}
// Homing-steer with a clamped turn rate — same style updateGaleFlags
// already uses for its homing flags — also updates hand.facing, which the
// fingers/forearm render off of.
function steerHandToward(hand, target, speed, turnRate, dt) {
  const desired = Math.atan2(target.y - hand.y, target.x - hand.x);
  const diff = Math.atan2(Math.sin(desired - hand.facing), Math.cos(desired - hand.facing));
  hand.facing += clamp(diff, -turnRate * dt, turnRate * dt);
  hand.x += Math.cos(hand.facing) * speed * dt;
  hand.y += Math.sin(hand.facing) * speed * dt;
  clampHandToBox(hand);
}

// A bare hand shell — actually wearing a ward and joining the fight happens
// in beginHandBout below, called (via beginErifWave) once real wave-start
// logic is ready to run. 'gone' is the same do-nothing terminal state a
// hand ends up in permanently once it's broken and its wave has nothing
// left to hand it — starting there is just a safe placeholder for the
// single frame before beginErifTrueFinal's own beginErifWave() call
// overwrites it.
function makeErifHand(id) {
  const dock = handDockPos(id);
  return {
    id, x: dock.x, y: dock.y, facing: 0,
    ward: null, hp: 0,
    state: 'gone', stateT: 0,
    wanderTarget: { x: dock.x, y: dock.y }, wanderRepickT: 0,
    slamCooldownT: 0,
    slamTargetX: 0, slamTargetY: 0, // frozen at telegraph-start so the slam itself is dodgeable
    globalWardCooldownT: 0,
    travelFrom: null, travelTo: null, travelT: 0, travelDur: 0,
    fingers: HAND_FINGERS.map((cfg, i) => ({ chargeT: FINGER_STAGGER[i], reach: cfg.reachMin })),
  };
}
// Resets a hand in place to start a fresh bout wearing `ward` — the one
// place a hand actually gets assigned a ward, reused for the very first
// wave, every subsequent new wave, and a failed window's ward regen alike.
function beginHandBout(hand, ward) {
  const dock = handDockPos(hand.id);
  hand.x = dock.x; hand.y = dock.y; hand.facing = 0;
  hand.ward = ward; hand.hp = HAND_WARD_HP;
  hand.state = 'equipping'; hand.stateT = EQUIP_TIME;
  hand.wanderTarget = { x: dock.x, y: dock.y }; hand.wanderRepickT = 0;
  hand.slamCooldownT = 0;
  hand.slamTargetX = 0; hand.slamTargetY = 0;
  hand.globalWardCooldownT = 0;
  hand.travelFrom = null; hand.travelTo = null; hand.travelT = 0; hand.travelDur = 0;
  hand.fingers = HAND_FINGERS.map((cfg, i) => ({ chargeT: FINGER_STAGGER[i], reach: cfg.reachMin }));
  tone(CONVERGENCE_CUE_TONE[ward], .12, 'triangle', .04); // same per-family identifying cue every other ward-reload moment uses
}
// Starts a new wave: pops 2 fresh wards off the pool, or — on a failed
// window's regen — reuses the exact same 2 names via `reuseWards` instead
// of touching the pool at all, so a regen genuinely costs nothing but time.
function beginErifWave(reuseWards = null) {
  const wards = reuseWards || [battle.erifWardPool.pop(), battle.erifWardPool.pop()];
  battle.erifWaveWards = wards;
  battle.erifWaveHandsBroken = 0;
  beginHandBout(battle.erifHands[0], wards[0]);
  beginHandBout(battle.erifHands[1], wards[1]);
}

// A 5-note sawtooth phrase — three short descending "ha" notes, one louder
// accented flourish, one low trailing decay — scheduled onto the audio
// clock via tone()'s own `time` param, same convention scheduleMusicStep
// (audio.js) already uses. Fired once at the fight's start and once the
// instant the last ward is destroyed.
function erifLaugh() {
  try {
    const ctx = ensureAudioCtx();
    let t = ctx.currentTime;
    const notes = [[140, .09, .045], [120, .09, .045], [100, .09, .045], [220, .17, .07], [65, .38, .05]];
    for (const [freq, dur, vol] of notes) { tone(freq, dur, 'sawtooth', vol, t); t += dur * .78; }
  } catch {}
}

// ---- Bounce ball: a new, larger universal projectile any finger can fire
// regardless of its hand's ward. No wall-collision precedent exists
// anywhere else in this codebase — reflects off battle.box's own edges,
// breaking after its 2nd bounce instead of continuing indefinitely. ----
function spawnErifBounceBall(x, y, aimX, aimY) {
  const a = Math.atan2(aimY - y, aimX - x) + rand(-.7, .7);
  const speed = BOUNCE_BALL_SPEED * DIFFICULTY.projectileMult;
  battle.erifBounceBalls.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: BOUNCE_BALL_R, bounces: 0 });
  tone(150, .07, 'triangle', .025);
}
function updateErifBounceBalls(dt) {
  const b = battle.box;
  for (const ball of battle.erifBounceBalls) {
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    let bounced = false;
    if (ball.x - ball.r < b.x) { ball.x = b.x + ball.r; ball.vx = Math.abs(ball.vx); bounced = true; }
    else if (ball.x + ball.r > b.x + b.w) { ball.x = b.x + b.w - ball.r; ball.vx = -Math.abs(ball.vx); bounced = true; }
    if (ball.y - ball.r < b.y) { ball.y = b.y + ball.r; ball.vy = Math.abs(ball.vy); bounced = true; }
    else if (ball.y + ball.r > b.y + b.h) { ball.y = b.y + b.h - ball.r; ball.vy = -Math.abs(ball.vy); bounced = true; }
    if (bounced) {
      ball.bounces++;
      spawnSparks(ball.x, ball.y, 5, { color: '#fff', speed: [40, 90], life: .25 });
      tone(300, .05, 'square', .02);
    }
    if (ball.bounces >= 2) {
      ball.dead = true;
      spawnSparks(ball.x, ball.y, 10, { color: EMBER, speed: [80, 160], life: .4 });
      tone(160, .1, 'sawtooth', .04);
    } else if (convergenceCircleHit(ball, ball.r)) hurt();
  }
  battle.erifBounceBalls = battle.erifBounceBalls.filter(b => !b.dead);
}

// A finger's world position — hand.x/y offset along its local angle
// (rotated by hand.facing) by its current charge reach. This IS the
// projectile spawn point, so the "filling up" visual and the actual origin
// are always the same thing.
function fingerTipPos(hand, i) {
  const cfg = HAND_FINGERS[i], f = hand.fingers[i];
  const a = hand.facing + cfg.angle;
  return { x: hand.x + Math.cos(a) * f.reach, y: hand.y + Math.sin(a) * f.reach };
}
// Dispatches a completed finger charge — oracle/gale/verdict route through
// their shared global-cooldown gate (falling back to a bounce ball if it's
// still cooling down); every other ward fires straight from the fingertip
// via the existing spawnConvergenceCueHazard, with an independent chance to
// also toss out a bounce ball from the same tip.
function fireFingerShot(hand, x, y) {
  const ward = hand.ward, s = battle.soul;
  if (ward === 'oracle' || ward === 'gale' || ward === 'verdict') {
    if (hand.globalWardCooldownT <= 0) {
      hand.globalWardCooldownT = GLOBAL_WARD_COOLDOWN;
      if (ward === 'oracle') { battle.inkTimer = 1.7; battle.inkSpawn = 0; }
      else if (ward === 'gale') { beginGaleGust(true); }
      else { spawnRing(true, rand(0, Math.PI * 2), 300, choose([-1, 1]) * .9, 150, .42, 2); }
    } else {
      spawnErifBounceBall(x, y, s.x, s.y);
    }
  } else {
    spawnConvergenceCueHazard(ward, { x, y });
    if (Math.random() < BOUNCE_BALL_CHANCE) spawnErifBounceBall(x, y, s.x, s.y);
  }
}
// Only ticks while a hand is 'wandering' (its only caller) — frozen, not
// reset, otherwise, so a hand returning from a slam bout resumes mid-charge
// rather than bursting.
function updateErifHandFingers(hand, dt) {
  for (let i = 0; i < hand.fingers.length; i++) {
    const cfg = HAND_FINGERS[i], f = hand.fingers[i];
    f.chargeT += dt;
    f.reach = lerp(cfg.reachMin, cfg.reachMax, clamp(f.chargeT / FINGER_CHARGE_TIME, 0, 1));
    if (f.chargeT >= FINGER_CHARGE_TIME) {
      f.chargeT = 0;
      const pos = fingerTipPos(hand, i);
      fireFingerShot(hand, pos.x, pos.y);
    }
  }
}

// The hand state machine:
// equipping -> emerging -> wandering <-> (chasing -> slamTelegraph ->
// vulnerable) -> retreating -> gone.
// Vulnerability is gated entirely behind landing a slam — wandering hands
// (charging/firing fingers) can't be damaged at all. 'gone' is terminal for
// the hand itself — a new bout (same 2 wards on a regen, or 2 fresh ones on
// a confirmed wave) resets BOTH hands back to 'equipping' together via
// beginErifWave, not this per-hand state machine.
function updateErifHand(hand, dt) {
  if (hand.state === 'equipping' || hand.state === 'gone') {
    // Parked states stay formula-driven off the live box/anchor (like the
    // old fixed-position hands did) rather than a stale snapshot, so they
    // never drift out of sync if the box is still animating.
    const dock = handDockPos(hand.id);
    hand.x = dock.x; hand.y = dock.y;
  }
  hand.stateT -= dt;
  if (hand.state === 'equipping') {
    if (hand.stateT <= 0) {
      const target = randWanderPoint();
      startHandTravel(hand, { x: hand.x, y: hand.y }, target, EMERGE_SPEED, EMERGE_MIN_TIME, EMERGE_MAX_TIME);
      hand.wanderTarget = target;
      hand.fingers.forEach((f, i) => { f.chargeT = FINGER_STAGGER[i]; f.reach = HAND_FINGERS[i].reachMin; });
      hand.state = 'emerging';
    }
  } else if (hand.state === 'emerging') {
    if (updateHandTravel(hand, dt)) {
      hand.state = 'wandering';
      hand.slamCooldownT = rand(SLAM_COOLDOWN[0], SLAM_COOLDOWN[1]);
      pickWanderTarget(hand);
    }
  } else if (hand.state === 'wandering') {
    steerHandToward(hand, hand.wanderTarget, WANDER_SPEED, WANDER_TURN_RATE, dt);
    hand.wanderRepickT -= dt;
    if (hand.wanderRepickT <= 0 || dist(hand.x, hand.y, hand.wanderTarget.x, hand.wanderTarget.y) < 20) pickWanderTarget(hand);
    updateErifHandFingers(hand, dt);
    hand.globalWardCooldownT = Math.max(0, hand.globalWardCooldownT - dt);
    hand.slamCooldownT -= dt;
    if (hand.slamCooldownT <= 0) { hand.state = 'chasing'; hand.stateT = CHASE_MAX_TIME; }
  } else if (hand.state === 'chasing') {
    const s = battle.soul;
    steerHandToward(hand, { x: s.x, y: s.y }, CHASE_SPEED, CHASE_TURN_RATE, dt);
    if (hand.stateT <= 0 || dist(hand.x, hand.y, s.x, s.y) < SLAM_ENGAGE_RANGE) {
      // Frozen the instant the telegraph starts, not re-tracked during it —
      // this is what makes the slam itself dodgeable by moving away.
      hand.slamTargetX = s.x; hand.slamTargetY = s.y;
      hand.state = 'slamTelegraph'; hand.stateT = SLAM_TELEGRAPH_TIME;
      tone(130, .12, 'sawtooth', .03);
    }
  } else if (hand.state === 'slamTelegraph') {
    hand.x = lerp(hand.x, hand.slamTargetX, Math.min(1, dt * 3));
    hand.y = lerp(hand.y, hand.slamTargetY, Math.min(1, dt * 3));
    if (hand.stateT <= 0) {
      hand.x = hand.slamTargetX; hand.y = hand.slamTargetY;
      // The slam impact — an expanding, gap-less shockwave ring (see
      // spawnRing's new origin/expand params, hazards.js) is what actually
      // opens the vulnerable window. HP is untouched here.
      // Slam impact: make the expanding shockwave 50% slower and
      // alternate gaps so it's an even "empty >> line >> empty >> line"
      // pattern (two opposite safe gaps). Opening tuned to allow dodge.
      spawnRing(true, 0, 18, 0, 170, 0.8, 2, { x: hand.x, y: hand.y }, true);
      kick(.06); tone(90, .18, 'sawtooth', .05);
      spawnSparks(hand.x, hand.y, 10, { color: EMBER, speed: [90, 220], life: .35 });
      hand.state = 'vulnerable'; hand.stateT = HAND_VULNERABLE_TIME;
    }
  } else if (hand.state === 'vulnerable') {
    // Completely stationary for the whole window, hit or not — it doesn't
    // budge until it's no longer vulnerable (was fear-fleeing after the
    // first hit; removed, it made a hand actively harder to finish off
    // right when it should be a sitting target).
    if (hand.stateT <= 0) {
      hand.state = 'wandering';
      hand.slamCooldownT = rand(SLAM_COOLDOWN[0], SLAM_COOLDOWN[1]);
      pickWanderTarget(hand);
    }
  } else if (hand.state === 'retreating') {
    // A broken hand is gone for the rest of this wave (or the whole fight,
    // if this was the last one) — this is purely the visual travel back
    // toward Erif for a clean exit, not a reload. Whether/when it comes
    // back at all is decided at the wave level (see beginErifWave, called
    // from handleErifPunch once both of a wave's hands are down and the
    // resulting window is either won or times out).
    if (updateHandTravel(hand, dt)) hand.state = 'gone';
  }
  // 'gone' has nothing further to do this frame beyond the position pin above.
}

// Space bar: the player's dedicated attack, usable only within range of a
// currently-vulnerable hand (nearest one wins if both qualify) or, failing
// that, the exposed head. Always pops the boxing-glove punch feedback (see
// battle.punchFlashT/punchDir, now read by render.js's SHIELD drawing, not
// the flame) whether or not it actually lands.
function handleErifPunch() {
  battle.erifAttackHintT = 0; // the on-screen callout has done its job the instant Space is used at all
  const s = battle.soul;
  let target = null, nearestD = Infinity;
  for (const hand of battle.erifHands) {
    if (hand.state !== 'vulnerable') continue;
    const d = dist(s.x, s.y, hand.x, hand.y);
    if (d <= HAND_HIT_RANGE && d < nearestD) { target = hand; nearestD = d; }
  }
  if (!target && battle.erifHeadExposed && battle.erifHeadHitCooldown <= 0) {
    if (dist(s.x, s.y, battle.erifHeadX, battle.erifHeadY) <= HEAD_HIT_RANGE) target = { isHead: true, x: battle.erifHeadX, y: battle.erifHeadY };
  }

  battle.punchDir = target ? Math.atan2(target.y - s.y, target.x - s.x) : (s.vx || s.vy ? Math.atan2(s.vy, s.vx) : battle.punchDir);
  battle.punchFlashT = .18;
  if (!target) { tone(90, .05, 'square', .015); return; }

  if (target.isHead) {
    battle.erifHeadHp--; battle.erifHeadHitsLanded++; battle.erifHeadHitCooldown = HEAD_HIT_COOLDOWN;
    tone(300 + battle.erifHeadHitsLanded * 22, .09, 'sine', .05);
    spawnSparks(target.x, target.y, 6, { color: '#fff', speed: [60, 140], life: .3 });
    // Landing a hit during an active per-wave window (not the permanent,
    // post-8th-wave exposure — that one just keeps taking hits with no wave
    // bookkeeping left to do) confirms this wave: its 2 wards are now
    // permanently destroyed, and the next 2 (fresh, random) come out
    // immediately — "after you deal damage, the boss brings out 2 more
    // hands." If the pool's empty, this WAS the last wave; there's nothing
    // left to bring out, and permanentlyOpen (updateErifHandsFinale) takes
    // over on its own next frame.
    const permanentlyOpen = battle.erifWardsDestroyed >= REPRISE_ORDER.length;
    if (!permanentlyOpen && battle.erifHeadWindowT > 0 && !battle.erifHeadWindowHitUsed) {
      battle.erifHeadWindowHitUsed = true; battle.erifHeadWindowT = 0;
      battle.erifWardsDestroyed += battle.erifWaveWards.length;
      tone(620, .22, 'sine', .05);
      if (battle.erifWardsDestroyed >= REPRISE_ORDER.length && !battle.erifHandsLaughedAtFlurry) {
        battle.erifHandsLaughedAtFlurry = true;
        erifLaugh();
      } else if (battle.erifWardPool.length >= 2) {
        beginErifWave();
      }
    }
    if (battle.erifHeadHp <= 0) { beginErifTrueVictory(); return; }
  } else {
    target.hp--;
    tone(440, .08, 'square', .04);
    spawnSparks(target.x, target.y, 6, { color: EMBER, speed: [70, 150], life: .3 });
    if (target.hp <= 0) {
      kick(.05); tone(160, .18, 'sawtooth', .05); noiseHit(.08, .03, 1400);
      // Gone for good the instant it breaks — no more per-hand retract-and-
      // reload. A short travel back toward Erif for a clean visual exit,
      // then it just waits (invisible — see 'gone', updateErifHand) for
      // this wave to actually resolve one way or the other.
      startHandTravel(target, { x: target.x, y: target.y }, handDockPos(target.id), RETRACT_SPEED, RETRACT_MIN_TIME, RETRACT_MAX_TIME);
      target.state = 'retreating'; target.ward = null;
      battle.erifWaveHandsBroken++;
      if (battle.erifWaveHandsBroken >= battle.erifHands.length) {
        // Both of this wave's hands are down — a real window to hit Erif
        // opens. Letting it run out regenerates these same 2 wards (see the
        // timeout check in updateErifHandsFinale) instead of just quietly
        // closing, so there's a real cost to not following up.
        battle.erifHeadWindowT = HEAD_WINDOW_TIME; battle.erifHeadWindowHitUsed = false;
        tone(520, .16, 'sine', .045);
      }
    }
    // A non-breaking hit intentionally leaves hand.state alone — it just
    // loops back to telegraph/slam for its second hit, same as always.
  }
}

// Ticks every hazard family a ward attack might have fired, unconditionally,
// every frame — modeled on updateCarriedRepriseHazards. `forgiving` hit
// radii (true) match the convention every other Convergence-family phase
// uses. The Gale's one-shot gust (telegraph -> active -> done) is driven
// directly here rather than through updateOneShotGaleGust's random-timer
// wrapper, since this phase triggers it explicitly from fireFingerShot
// instead of waiting on a cooldown.
function updateErifHandHazards(dt) {
  updateRingHazards(dt);
  updateSpearHazards(dt, true);
  updateShapeHazards(dt, true);
  updateSandGrains(dt); updateHourglassOrbs(dt);
  updateGaleFlags(dt); updateWindLines(dt);
  updateWeavingBooks(dt); updateTrailSquares(dt);
  updateErifBounceBalls(dt);
  if (battle.galeGustPhase === 'telegraph') {
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) launchGaleGust(true);
  } else if (battle.galeGustPhase === 'active') {
    const b = battle.box, s = battle.soul;
    s.x = clamp(s.x + battle.windVX * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = clamp(s.y + battle.windVY * dt, b.y + s.r, b.y + b.h - s.r);
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) endGaleGust(true);
  }
  if (battle.inkTimer > 0) {
    battle.inkTimer -= dt; battle.inkSpawn -= dt;
    if (battle.inkSpawn <= 0) {
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 8, vx: rand(-45, 45) * DIFFICULTY.projectileMult, vy: 235 * DIFFICULTY.projectileMult, r: 5 });
      battle.inkSpawn = .17;
    }
  }
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20);
}

function beginErifTrueFinal() {
  if (!battle || battle.erifHandsStarted) return;
  battle.erifHandsStarted = true;
  bumpErifPhase(PHASE_LAST_WAGER);
  battle.erifWardPool = shuffleArray(REPRISE_ORDER);
  battle.erifHands = [makeErifHand(0), makeErifHand(1)];
  battle.erifWardsDestroyed = 0;
  battle.erifHeadHp = ERIF_HEAD_HP; battle.erifHeadMaxHp = ERIF_HEAD_HP;
  battle.erifHeadHitsLanded = 0;
  battle.erifHeadWindowT = 0; battle.erifHeadWindowHitUsed = false;
  battle.erifHeadExposed = false;
  battle.erifHeadHitCooldown = 0;
  battle.erifHandsLaughedAtFlurry = false;
  battle.erifBounceBalls = [];
  battle.erifReckoningFadeT = 0;
  battle.erifAttackHintT = 6; // a prominent one-time "SPACE — ATTACK" callout, cleared early on first use
  battle.punchFlashT = 0; battle.punchDir = 0;
  battle.boxGrowFrom = { ...battle.box };
  battle.boxGrowTo = { ...ERIF_HANDS_BOX };
  battle.boxGrowT = 0;
  battle.soul.x = W / 2; battle.soul.y = ERIF_HANDS_BOX.y + ERIF_HANDS_BOX.h - 100;
  battle.soul.vx = 0; battle.soul.vy = 0;
  const home = erifHomeAnchor();
  battle.erifHeadX = home.x; battle.erifHeadY = home.y;
  beginErifWave(); // pops the first wave's 2 wards and equips both hands
  mode = 'battle';
  setMusic('erifTrue');
  erifLaugh();
  tone(38, .5, 'sawtooth', .07);
}
function updateErifHandsFinale(dt) {
  if (battle.boxGrowT < ERIF_HANDS_BOX_GROW_TIME) {
    battle.boxGrowT = Math.min(ERIF_HANDS_BOX_GROW_TIME, battle.boxGrowT + dt);
    const p = 1 - Math.pow(1 - battle.boxGrowT / ERIF_HANDS_BOX_GROW_TIME, 3); // ease-out cubic
    const f = battle.boxGrowFrom, t = battle.boxGrowTo;
    battle.box = { x: lerp(f.x, t.x, p), y: lerp(f.y, t.y, p), w: lerp(f.w, t.w, p), h: lerp(f.h, t.h, p) };
  }
  moveSoulWithShield(dt, 210);
  battle.punchFlashT = Math.max(0, battle.punchFlashT - dt);
  battle.erifHeadHitCooldown = Math.max(0, battle.erifHeadHitCooldown - dt);

  for (const hand of battle.erifHands) updateErifHand(hand, dt);

  battle.erifAttackHintT = Math.max(0, battle.erifAttackHintT - dt);

  // Head vulnerability: exposed for as long as the current wave's window is
  // open (both its hands are down and no hit has landed yet), permanently
  // open once all 8 wards are confirmed destroyed (unchanged end state).
  // Catches the exact frame a window closes UNUSED — since that's a real
  // regen, not just a quiet miss — and regenerates the same 2 wards rather
  // than losing them (see beginErifWave's reuseWards).
  const windowWasOpen = battle.erifHeadWindowT > 0;
  battle.erifHeadWindowT = Math.max(0, battle.erifHeadWindowT - dt);
  const permanentlyOpen = battle.erifWardsDestroyed >= REPRISE_ORDER.length;
  if (windowWasOpen && battle.erifHeadWindowT <= 0 && !battle.erifHeadWindowHitUsed && !permanentlyOpen) {
    tone(70, .3, 'sawtooth', .05);
    beginErifWave(battle.erifWaveWards);
  }
  battle.erifHeadExposed = permanentlyOpen || (battle.erifHeadWindowT > 0 && !battle.erifHeadWindowHitUsed);

  // Loose head/hand coupling: the head softly drifts toward a blend of its
  // home anchor and the centroid of currently-active (non-gone/equipping)
  // hands — a slow lerp, not a snap-track, so it comfortably trails behind
  // rather than rigidly locking on.
  const home = erifHomeAnchor();
  const active = battle.erifHands.filter(h => h.state !== 'gone' && h.state !== 'equipping');
  const cx = active.length ? active.reduce((sum, h) => sum + h.x, 0) / active.length : home.x;
  const cy = active.length ? active.reduce((sum, h) => sum + h.y, 0) / active.length : home.y;
  const tx = lerp(home.x, cx, .4), ty = lerp(home.y, cy, .4);
  battle.erifHeadX += (tx - battle.erifHeadX) * Math.min(1, dt * .6);
  battle.erifHeadY += (ty - battle.erifHeadY) * Math.min(1, dt * .6);

  if (tap(' ')) handleErifPunch();

  updateErifHandHazards(dt);

  // Hard 100s time limit — the last 5s fade the whole fight to white, and
  // running the clock all the way out is a loss. Unlike hurt(), this always
  // applies, God Mode included — the clock is a hard fight constraint, not
  // ordinary damage, so debug invulnerability doesn't cover it.
  const remaining = RECKONING_TIME_LIMIT - (battle.t - battle.phaseStartT);
  battle.erifReckoningFadeT = remaining > RECKONING_FADE_WINDOW ? 0 : clamp(1 - remaining / RECKONING_FADE_WINDOW, 0, 1);
  if (remaining <= 0) {
    finishBattle(false);
    battle.clearText = 'IT ALL COMES APART.';
  }
}

function beginErifTrueVictory() {
  if (!battle || battle.trueVictoryStarted) return;
  clearHazards();
  battle.trueVictoryStarted = true;
  battle.trueVictoryT = 0;
  battle.trueVictoryDialogueIndex = 0;
  mode = 'erifTrueVictory';
  tone(28, .9, 'sawtooth', .1);
}
function updateErifTrueVictory(dt) {
  if (!battle) return;
  battle.trueVictoryT += dt;
  if (battle.trueVictoryT >= 5.0 && tap(' ')) {
    battle.trueVictoryDialogueIndex++;
    tone(150 + battle.trueVictoryDialogueIndex * 32, .045, 'triangle', .022);
    if (battle.trueVictoryDialogueIndex >= ERIF_TRUE_FINAL_DIALOGUE.length) {
      save.erifWon = true;
      save.erifTrueWon = true;
      saveGame();
      stopMusic();
      mode = 'trueEnding';
      messageTimer = 0;
    }
  }
}

function updateErif(dt) {
  if (battle.phase === PHASE_LAST_WAGER) { updateErifHandsFinale(dt); return; }
  // Enraged's own exit is now driven entirely by ERIF_ENRAGE_MINIGAME_PLAN
  // completing (see advanceEnrageSegment, called from updateEnraged) rather
  // than a flat duration — the full math/memory sequence runs well past the
  // old 26s cap.
  if (!battle.enraged && battle.phase === PHASE_CONVERGENCE && (battle.t - battle.phaseStartT) >= 32) {
    startErifEnrageDialogue();
    return;
  }

  if (battle.phase < REPRISE_ORDER.length) {
    const name = REPRISE_ORDER[battle.phase];
    battle.repriseSegElapsed = (battle.repriseSegElapsed || 0) + dt;
    // Most segments are a flat window regardless of what happens inside —
    // but three can't be fairly cut off mid-something, so those instead
    // advance only once their own solve/cycle requirement is met (see
    // updateRepriseArchivist/updateRepriseOracle/updateRepriseHourglass
    // above). Executioner and Mask get their own shorter fixed window (5s)
    // instead of the default — the whole Reprise is meant to move fast. Gale
    // and Verdict get a flat 10s instead, longer than the default 7s.
    const segmentDone =
      name === 'archivist' ? battle.repriseArchivistDone :
      name === 'oracle' ? battle.repriseOracleDone :
      name === 'hourglass' ? battle.repriseHourglassDone :
      name === 'witness' ? battle.repriseWitnessDone :
      battle.repriseSegElapsed >= (
        name === 'executioner' || name === 'mask' ? 5 :
        name === 'gale' || name === 'verdict' ? 10 :
        REPRISE_SEGMENT
      );
    if (segmentDone) {
      const next = battle.phase + 1;
      battle.repriseSegElapsed = 0;
      if (next >= REPRISE_ORDER.length) {
        // Skips the first Convergence phase entirely — straight from the
        // Reprise into the Enraged dialogue (and from there, Enraged
        // itself), rather than spending time on the sigil-capture-only
        // interlude first. startErifEnrageDialogue() is the exact same
        // trigger Convergence itself used to fire once its own capture
        // condition was met, so this lands in the same place, just sooner.
        battle.soul.vx = 0; battle.soul.vy = 0;
        startErifEnrageDialogue();
      } else {
        bumpErifPhase(next, true); battle.spawn = .15;
        battle.soul.vx = 0; battle.soul.vy = 0;
        tone(130 + next * 30, .12, 'sawtooth', .04);
      }
      return;
    }
    updateReprisePhase(name, dt);
    return;
  }
  if (battle.phase < PHASE_CONVERGENCE) {
    bumpErifPhase(PHASE_CONVERGENCE); battle.soul.vx = 0; battle.soul.vy = 0;
    tone(200, .2, 'sawtooth', .05);
  }
  if (battle.phase === PHASE_CONVERGENCE) { updateConvergence(dt); return; }
  if (battle.phase === PHASE_ENRAGED) { updateEnraged(dt); return; }
  if (battle.phase === PHASE_FINAL_CONVERGENCE) { updateFinalConvergence(dt); return; }
}
