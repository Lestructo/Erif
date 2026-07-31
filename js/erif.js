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
// How long the Enraged-entry dialogue (see startErifEnrageDialogue) takes to
// play at its own base pace with zero stretch — the floor on how long that
// interstitial can ever take, since it never speeds up past this and never
// skips. Computed once here (instead of inline in startErifEnrageDialogue)
// so REPRISE_TARGET_DURATION below can also read it — the Reprise needs to
// land its own completion this many seconds *before* the dialogue's actual
// target end point, not exactly on it, or the dialogue's own unavoidable
// floor duration would always push Enraged's real start past that target.
const ERIF_ENRAGE_DIALOGUE_NATURAL_DURATION = ERIF_ENRAGE_DIALOGUE.reduce(
  (sum, line) => sum + line.length / (DIALOGUE_CHARS_PER_SEC * 3) + DIALOGUE_AUTO_HOLD, 0);
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
  else if (after === 'erifReckoningIntro') startErifReckoningIntro();
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
// REPRISE_TARGET_DURATION (how long the whole Reprise should take) is
// defined down near ERIF_FIGHT_TIME_LIMIT, since it's derived from that
// constant plus the Enraged dialogue's own natural floor duration — see it
// there for the full explanation.
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
// orbs it spawns get guaranteed room to actually show up. Runs fast, slow,
// then done (was fast, slow, fast) — 2 cycles starting fast, the trailing
// 3rd (fast) cycle cut off.
function updateRepriseHourglass(dt) {
  moveSoulWithShield(dt, 220); // see updateArchivistQuickMatch's note on why Erif's Reprise segments keep the shield live
  if (!battle.sandPhase) { beginSandPhase(true, 'fast'); battle.repriseHourglassCycles = 1; }

  battle.sandTimer -= dt;
  if (battle.sandTimer <= 0) {
    // Checked BEFORE flipping — this lets the 2nd (slow) phase run its own
    // full natural duration before ending, instead of marking done the
    // instant it begins (which would cut it down to ~0 length).
    if (battle.repriseHourglassCycles >= 2) { battle.repriseHourglassDone = true; return; }
    beginSandPhase(true, battle.sandPhase === 'slow' ? 'fast' : 'slow');
    battle.repriseHourglassCycles++;
  }

  battle.sandGrainTimer -= dt;
  if (battle.sandGrainTimer <= 0) { spawnSandGrain(true); battle.sandGrainTimer = .22 / 1.1 / battle.timeScale; } // 10% more often, matching updateHourglass (bosses.js)
  updateSandGrains(dt);

  battle.hourglassOrbTimer -= dt;
  if (battle.hourglassOrbTimer <= 0) {
    spawnHourglassOrb(true);
    if (Math.random() < .49) spawnHourglassOrb(true);
    if (Math.random() < .225) spawnHourglassOrb(true);
    battle.hourglassOrbTimer = rand(1.0, 1.44) / battle.timeScale;
    // Same fast-phase halving as the standalone fight's updateHourglass —
    // see bosses.js.
    if (battle.sandPhase === 'fast') battle.hourglassOrbTimer *= 2;
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
    battle.bullets.push({ x, y: b.y - 9.6, vx: rand(-55, 55) * DIFFICULTY.projectileMult, vy: 275 * DIFFICULTY.projectileMult, r: 5, ...hazardAgeFields(3) });
    battle.spawn = .19;
  }
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (circleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
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
    // Same bullets, same 2.18 as Reprise-Oracle's own spawn above — this is
    // just the carry-over tick for when a later segment is active.
    battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
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
  // 20% further out (14 -> 16.8) — no telegraph before it's live.
  let x, y;
  if (edge === 0) { x = rand(b.x, b.x + b.w); y = b.y - 16.8; }
  else if (edge === 1) { x = b.x + b.w + 16.8; y = rand(b.y, b.y + b.h); }
  else if (edge === 2) { x = rand(b.x, b.x + b.w); y = b.y + b.h + 16.8; }
  else { x = b.x - 16.8; y = rand(b.y, b.y + b.h); }
  const a = Math.atan2(s.y - y, s.x - x) + rand(-.13, .13), speed = 160 * DIFFICULTY.projectileMult;
  battle.aimedBullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4, ...hazardAgeFields(10) });
}
// thin — a flat 25% spear-count cut, Reckoning-only (see fireFingerShot's
// executioner cue below) and executioner-only (mask shares this same
// function but already has its own separate reduction, the .5 chance around
// this call skipping it entirely — stacking this on top of that would double
// -nerf mask specifically, which was never asked for).
function spawnConvergenceSpears(family, hard = false, forcedSide = null, extraDelay = 0, thin = false) {
  const before = battle.telegraphs.length;
  // Same gapped-bias fix as updateExecutioner (bosses.js) — this is the
  // executioner/mask cue's own spear volley, and since the Reckoning now
  // fires it once per finger-charge (see fireFingerShot, erif.js), a hand
  // carrying either of those wards was throwing a full solid wall on
  // basically every single shot. Spaced barrages are the common case now.
  if (Math.random() < .65) spawnSpearGappedWall(hard, choose(thin ? [4, 5] : [5, 7]), forcedSide, extraDelay);
  else spawnSpearVolley(hard, forcedSide, extraDelay, thin ? 1.25 : 1);
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
function spawnConvergenceCueHazard(cue, target, reckoning = false) {
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
    if (cue === 'mask') {
      battle.maskMirrored = Math.random() < .5;
      // Half as many spear volleys as before for mask specifically — a
      // missed roll just skips this trigger's spears entirely (still costs
      // the finger charge as normal), executioner's own rate is untouched.
      // The mask's OTHER hazard, its drifting shards (spawnMaskShard,
      // bosses.js), never actually fired through this ward dispatch at
      // all — added below so mask isn't just spears/"arrows" here.
      if (Math.random() < .5) spawnConvergenceSpears(cue, false, side, .10);
      // 75% chance, not guaranteed — a flat 25% cut to how many of these
      // actually spawn per trigger.
      if (Math.random() < .75) spawnMaskShard(false, cue);
    } else {
      // thin=reckoning — the 25% spear-count cut only applies to the
      // Reckoning's own executioner ward, not Convergence/Final Convergence.
      spawnConvergenceSpears(cue, false, side, .10, reckoning);
    }
  } else if (cue === 'hourglass') {
    // Hourglass hasn't used spears since its own fight was redesigned
    // around sand grains + drifting orbs (see updateHourglass, bosses.js) —
    // Convergence's cue was never updated to match and kept routing it
    // through the spear system. Orbs tagged so clearConvergenceCueHazards
    // can despawn exactly this batch once the sigil is captured. Sand
    // grains too — this cue was only ever spawning orbs, never any actual
    // sand, since updateFinalConvergence didn't call updateSandGrains either
    // (fixed there too).
    // Half the orbs in the Reckoning specifically (1, not 2) — with two
    // hands independently cycling through wards over a much longer fight,
    // this cue firing repeatedly piled up orbs faster than they realistically
    // clear (their own natural lifetime is a ~20s forced-outward drift, see
    // updateHourglassOrbs — not a bug, just a high spawn rate against that).
    // Convergence/Final Convergence (reckoning=false) are unaffected.
    for (let i = 0; i < (reckoning ? 1 : 2); i++) {
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
    // didn't call updateWindLines either (fixed there too). Bumped 2 -> 3
    // (+50%) since they were barely showing up against everything else.
    for (let i = 0; i < 3; i++) {
      spawnGaleFlag(false);
      battle.galeFlags[battle.galeFlags.length - 1].family = cue;
    }
    spawnWindRow(false);
  } else if (cue === 'witness') {
    // 20% further out (24 -> 28.8) — no telegraph before it's live.
    const anchors = [[box.x - 28.8, box.y + 35], [box.x + box.w + 28.8, box.y + 70], [box.x + 60, box.y - 28.8], [box.x + box.w - 60, box.y + box.h + 28.8]];
    anchors.forEach((a, i) => {
      const tx = lerp(battle.soul.x, target.x, .45) + rand(-35, 35), ty = lerp(battle.soul.y, target.y, .45) + rand(-35, 35);
      const ang = Math.atan2(ty - a[1], tx - a[0]);
      const witnessSpeed = 190 * DIFFICULTY.projectileMult;
      // 3.2, then 9, were both still sized off hard-tier speed only — at
      // Normal tier (DIFFICULTY.projectileMult=.5, half hard's .75) this same
      // cue also fires in Final Convergence's smaller 680x390 box, where 9s
      // at 190*.5=95px/s only covers 855px against that box+margin's own
      // ~1032px diagonal, still expiring mid-flight before the position
      // despawn ever gets a chance. 13s clears every box/tier combo in play,
      // Reckoning included.
      battle.shapes.push({ type: ['circle', 'triangle', 'square'][i % 3], x: a[0], y: a[1], vx: Math.cos(ang) * witnessSpeed, vy: Math.sin(ang) * witnessSpeed, size: 7, spin: rand(-4, 4), a: 0, life: 13, family: 'witness' });
    });
  } else if (cue === 'archivist') {
    // The archive scatters its torn pages outward from its own sigil,
    // reusing the shape-hazard primitive rather than a second sigil system.
    for (let i = 0; i < 4; i++) {
      const ang = rand(0, Math.PI * 2), speed = 170 * DIFFICULTY.projectileMult;
      // Same fix as the witness cue just above — even 10s was only checked
      // against hard-tier speed; at Normal (170*.5=85px/s) it covers 850px
      // against Final Convergence's own ~1032px box+margin diagonal, still
      // dying early. 14s clears every box/tier combo, Reckoning included.
      battle.shapes.push({ type: choose(['circle', 'triangle', 'square']), x: target.x, y: target.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, size: 7, spin: rand(-4, 4), a: 0, life: 14, family: 'archivist' });
    }
    // Plus the same weaving-book-and-trail pressure the standalone trial
    // now uses (see bosses.js). Used to always spawn a (red) weaving book
    // and never a (white) echo book, so this cue only ever showed red —
    // halved the weaving-book chance and added a smaller independent chance
    // of a regular echo book too, so both actually show up. White-book odds
    // bumped .25 -> .3125 (+25%), still too rare otherwise.
    if (Math.random() < .5) spawnWeavingBook(false, cue);
    if (Math.random() < .3125) spawnEchoBook(false, cue);
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
    if (cue === 'mask') battle.maskShards = battle.maskShards.filter(w => w.family !== cue);
  } else if (cue === 'hourglass') {
    battle.hourglassOrbs = battle.hourglassOrbs.filter(o => o.family !== cue);
  } else if (cue === 'gale') {
    battle.galeFlags = battle.galeFlags.filter(f => f.family !== cue);
  } else if (cue === 'witness' || cue === 'archivist') {
    battle.shapes = battle.shapes.filter(s => s.family !== cue);
    if (cue === 'archivist') {
      battle.weavingBooks = battle.weavingBooks.filter(w => w.family !== cue);
      battle.trailSquares = battle.trailSquares.filter(t => t.family !== cue);
      battle.echoBooks = battle.echoBooks.filter(w => w.family !== cue);
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
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 9.6, vx: rand(-45, 45) * DIFFICULTY.projectileMult, vy: 235 * DIFFICULTY.projectileMult, r: 5, ...hazardAgeFields(3) });
      battle.inkSpawn = .17;
    }
  }

  updateConvergenceMarks(dt);
  for (const p of battle.aimedBullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.aimedBullets = battle.aimedBullets.filter(p => !hazardExpired(p.ageExpireT) && p.x > battle.box.x - 40 && p.x < battle.box.x + battle.box.w + 40 && p.y > battle.box.y - 40 && p.y < battle.box.y + battle.box.h + 40);
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
  updateRingHazards(dt); updateSpearHazards(dt, true); updateShapeHazards(dt, true);
  // Hourglass/Gale cues (see spawnConvergenceCueHazard above) spawn real
  // orbs/flags/wind rows now instead of borrowed spears — these need their
  // own update loops run somewhere, which Convergence never did before since
  // it never used to spawn any of these. updateWindLines specifically was
  // still missing even after the others were added — the gale cue's own
  // wind-line row spawned once and then just sat there motionless. Same bug,
  // same fix, for the archivist cue's echo books (spawnEchoBook) and the
  // mask cue's drifting shards (spawnMaskShard) — spawning them without ever
  // calling their own update function left them frozen in place, reading as
  // broken rather than tumbling/drifting in.
  updateHourglassOrbs(dt); updateGaleFlags(dt); updateWindLines(dt);
  updateEchoBooks(dt); updateWeavingBooks(dt); updateTrailSquares(dt);
  updateMaskShards(dt);
}

// ---- Enrage dialogue interstitial (Convergence -> Enraged) ----
function startErifEnrageDialogue() {
  if (!battle || battle.enrageDialogueShown) return;
  battle.enrageDialogueShown = true;
  if (!ERIF_ENRAGE_DIALOGUE.length) { beginErifEnraged(); return; } // safety fallback if ever reached before lore is written
  clearHazards();
  // Base pace is triple speed (see updateDialogueReveal's charsPerSec) —
  // this dialogue already plays through automatically with no player
  // input, so there's no reason to make it linger at the normal typing
  // pace by default. But it also keeps battle.t advancing the whole time
  // now (see main.js), so its own length affects exactly when the
  // Enraged theme actually starts — slowed down OR sped up from that base
  // pace as needed so it finishes (not just begins) right as the whole-
  // fight timer (ERIF_FIGHT_TIME_LIMIT) hits 75s remaining, lining the
  // music up to a consistent moment instead of wherever the player happened
  // to finish Convergence. REPRISE_TARGET_DURATION already aims the Reprise
  // to land early enough that this never needs to speed up in the typical
  // case — this is the last-resort correction for whatever residual drift
  // still gets through (a slightly-off Verdict catch-up, frame-timing
  // slop...), floored at 2x the base pace (never faster) so a genuinely bad
  // overshoot reads as brisk rather than an unreadable flash of text.
  const baseCps = DIALOGUE_CHARS_PER_SEC * 3;
  const targetDuration = Math.max(0, (ERIF_FIGHT_TIME_LIMIT - 75) - battle.t);
  const slowFactor = Math.max(.5, targetDuration / ERIF_ENRAGE_DIALOGUE_NATURAL_DURATION);
  dialogue = {
    lines: ERIF_ENRAGE_DIALOGUE, index: 0, after: 'erifEnraged', context: 'battle',
    charsPerSec: baseCps / slowFactor, holdTime: DIALOGUE_AUTO_HOLD * slowFactor,
  };
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
  // 3.4, then 7, were both only checked against hard-tier speed — Enraged
  // isn't tier-gated, so Normal tier reaches it too, and at 178*.5=89px/s a
  // life of 7 only covers 623px against the widened 680x390 box
  // (ERIF_ENRAGE_BOX) + margin's own ~1032px diagonal, well short. 14s clears
  // it at both tiers.
  battle.shapes.push({ type: choose(['circle', 'triangle', 'square']), x: h.x, y: h.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 7, spin: rand(-5, 5), a: 0, life: 14 });
  h.tx = s.x; h.ty = s.y;
}
// The arena widens once Enraged begins, and stays that size through Final
// Convergence and the true final phase (none of which ever reset
// battle.box) — every family hitting at once has more room to spread out
// in. Anchored to the exact same BOTTOM edge every other fight's standard
// box already sits at (230,249,500,270 — see battle-core.js — bottom =
// 249+270 = 519) rather than sharing that box's own y and just growing
// downward from it: growing downward pushed this box's bottom edge to 639,
// one pixel off the canvas floor (H=640), leaving no room for the
// HP/timer/phase-name row or the controls legend/volume meters below it —
// they all rendered off-screen. Growing upward and outward instead (this
// box's own y = 519 - h, x/w symmetric around the same x=480 center the
// standard box already uses) keeps that bottom edge fixed in place, so
// everything below the box lines up exactly like it does for every other
// fight, no matter how tall this one gets — it's fine (expected, even) for
// the top of this box to run out of room and head off-canvas as it grows;
// the bottom staying put is what actually matters here. The header (boss
// icon/name normally drawn above the box) is suppressed for every phase
// from here on (see drawBattle, render.js) since there isn't room for both
// it and a box this tall.
const ERIF_ENRAGE_BOX_H = 390;
const ERIF_ENRAGE_BOX = { x: 140, y: 519 - ERIF_ENRAGE_BOX_H, w: 680, h: ERIF_ENRAGE_BOX_H };
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
// Enraged targets handing off to Final Convergence with this many seconds
// left on the *whole fight's* clock (ERIF_FIGHT_TIME_LIMIT) — framed the
// same way the Convergence->Enraged dialogue sync already is (remaining
// time against the fight clock, not a self-contained elapsed-since-phase-
// start figure). A fixed internal-duration target (what this used to be)
// let any drift from an earlier phase — a dialogue that overshot, a rough
// Archivist retry — silently eat into how long Enraged itself then actually
// had left, with nothing correcting for it; this stays correct regardless
// of exactly when Enraged's own start turns out to land. See
// beginErifEnraged, which computes battle.enrageBudget off this the instant
// the phase actually begins, and battle.enrageMemoryCap/
// battle.enrageMathBurstCap, scaled off that same real budget rather than
// fixed numbers sized for some assumed-typical case.
const ENTER_FINAL_CONVERGENCE_REMAINING = 44;
// Floor on battle.enrageBudget itself, for the degenerate case where Enraged
// somehow already begins at or past the target (an upstream phase running
// very late) — keeps the schedule below from collapsing to zero/negative
// checkpoints across the board.
const ENRAGE_MIN_BUDGET = 15;
// Cumulative "fraction of the budget expected to have elapsed by the end of
// this segment" schedule, one per ERIF_ENRAGE_MINIGAME_PLAN entry — hand-
// split so memory's own two rounds carry most of the budget on their own
// natural pace, with math kept to short bursts around them. Multiplied by
// battle.enrageBudget (not a fixed total) when sizing a math question, so it
// scales with whatever Enraged's real available time actually turns out to
// be. Each question's catch-up is scoped to just the gap up to its own
// checkpoint rather than the whole remaining budget in one shot, so an
// early burst never has to swallow everything at once — except the last
// question, whose checkpoint equals the full budget, left uncapped (see
// battle.enrageMathBurstCap) so it still guarantees a precise final landing
// regardless of how everything before it actually played out.
const ERIF_ENRAGE_CHECKPOINT_FRACTIONS = [.09, .37, .48, .84, 1];
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
    // Enraged's own delay cut way down (was rand(12,22)) — that could leave
    // the phase's one gust (and its gust-synced wind row) not showing up
    // until very late, or not being seen at all if the segment plan wrapped
    // up first.
    battle[timerField] = (battle[timerField] ?? (requireGaleCue ? rand(.4, 1.4) : rand(3, 6))) - dt;
    if (battle[timerField] <= 0) beginGaleGust(hard);
    return;
  }
  if (battle.galeGustPhase === 'telegraph') {
    // Enraged's one-shot gust had no wind-line row at all (unlike the
    // standalone/Reprise fight and Final Convergence's own gale cue, which
    // already spawns one separately) — requireGaleCue excludes Final
    // Convergence here so it doesn't end up with two. Synced (see
    // tickGaleWindRowSync, bosses.js) so the row's sweep lands while
    // controlsInverted is true instead of trailing in afterward.
    if (!requireGaleCue) tickGaleWindRowSync(hard);
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) launchGaleGust(hard);
  } else if (battle.galeGustPhase === 'active') {
    const b = battle.box, s = battle.soul;
    s.x = clamp(s.x + battle.windVX * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = clamp(s.y + battle.windVY * dt, b.y + s.r, b.y + b.h - soulVisualBottomMargin());
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
  // Computed once, right here, off whatever battle.t actually is the
  // instant Enraged begins — see ENTER_FINAL_CONVERGENCE_REMAINING above.
  // enrageMemoryCap/enrageMathBurstCap are scaled off this same real budget
  // (roughly matching each's own share of ERIF_ENRAGE_CHECKPOINT_FRACTIONS)
  // rather than fixed numbers, so a budget that ends up smaller or bigger
  // than typical doesn't leave either one sized for the wrong total.
  battle.enrageBudget = Math.max(ENRAGE_MIN_BUDGET, (ERIF_FIGHT_TIME_LIMIT - ENTER_FINAL_CONVERGENCE_REMAINING) - battle.t);
  battle.enrageMemoryCap = clamp(battle.enrageBudget * .4, 8, 20);
  battle.enrageMathBurstCap = clamp(battle.enrageBudget * .3, 5, 12);
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
    battle.enrageRingTimer = .15; battle.enrageVolleyTimer = 1.1; battle.enrageShardTimer = .12; battle.enrageQuestionTimer = 1.0; // was 1.8 — trimmed as part of aiming the whole phase back toward ~50s
    battle.maskMirrorTimer = rand(1.8, 2.8);
    // Anchored off the box's own final grown size (battle.boxGrowTo, always
    // ERIF_ENRAGE_BOX by the time this runs — see beginErifEnraged), not the
    // live battle.box — this whole block only runs once, on Enraged's very
    // first frame, while battle.box is still mid-grow (barely nudged off its
    // much smaller pre-Enraged size). Anchoring off that snapshot left
    // several hands sitting well inside the fully-grown arena once the
    // animation caught up, spawning their shards from inside the frame
    // instead of outside it.
    const b = battle.boxGrowTo;
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
    // Explicit per-tier px/s (25 normal / 40 hard) instead of a single base
    // speed run through DIFFICULTY.projectileMult — that ratio (.5/.75, i.e.
    // 2:3) doesn't land on these particular numbers (5:8), so the desired
    // absolute speed is pre-divided by projectileMult here, letting
    // spawnRing's own multiplication cancel back out to exactly 25/40.
    // Per-gap opening widened (.34 -> .42 -> .5) — with
    // several answer lanes (gapCount up to 5) plus multiple overlapping rings
    // shrinking at once, the tighter gap made it too easy to get squeezed
    // with nowhere safe to stand; this stays closer to Verdict's own
    // standalone opening size (.36-.52) so it never reads as unfair. Ensure
    // Enraged always leaves at least two passage gaps so the player has
    // multiple lanes to choose.
    const enrageGapCount = Math.max(answerPassages, 2);
    const enrageRingSpeed = (difficultyTier === 'normal' ? 25 : 40) / DIFFICULTY.projectileMult;
    spawnRing(true, battle.ringGapA, 365, battle.ringArcDirection * .04, enrageRingSpeed, answerPassages <= 1 ? 1.0 : .5, enrageGapCount);
    battle.enrageRingTimer = 2.5;
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
        // Catch-up scoped to just this question's own checkpoint (see
        // ERIF_ENRAGE_CHECKPOINT_FRACTIONS) rather than the whole remaining
        // budget — capped at battle.enrageMathBurstCap for every question
        // except the last, whose checkpoint equals the full
        // battle.enrageBudget and is left uncapped so it still guarantees a
        // precise final landing regardless of how everything before it
        // actually played out.
        const isLastMath = battle.enrageSegmentIndex === ERIF_ENRAGE_MINIGAME_PLAN.length - 1;
        const checkpoint = ERIF_ENRAGE_CHECKPOINT_FRACTIONS[battle.enrageSegmentIndex] * battle.enrageBudget;
        const rawQMax = checkpoint - (battle.t - battle.phaseStartT) - .6; // -.6 leaves room for this question's own laser tail + gap after
        battle.qMax = isLastMath ? Math.max(3.15, rawQMax) : clamp(rawQMax, 3.15, battle.enrageMathBurstCap);
        battle.qTimer = battle.qMax; battle.lasers = [];
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
      battle.q = null; battle.enrageQuestionTimer = .6; // was 1.2 — trimmed as part of aiming the whole phase back toward ~50s
      if (advanceEnrageSegment()) return;
    }
  } else {
    // Memory segment — same reveal/input/resolve state machine the
    // Archivist's other quick-match gates use (see updateArchivistQuickMatch),
    // inlined here since Enraged counts rounds against its own segment plan
    // instead of a {round, successes, done} cfg object.
    if (!battle.sigils.length) startEchoRound(true, enrageSeg.value, battle.enrageMemoryCap);
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
  // Enraged's gale gust (see updateOneShotGaleGust above) spawns real flags
  // and a wind-line row, but this function never actually ticked either
  // one's own per-frame update — they'd spawn once and then just sit there
  // completely motionless for the rest of the phase, reading as "frozen."
  updateGaleFlags(dt);
  updateWindLines(dt);
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
const FINAL_CONVERGENCE_HOLD_TIME = 1.5;
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
  // ~1.5s for as long as its sigil is the active cue — see
  // spawnConvergenceCueHazard's verdict branch, which just arms this timer
  // rather than bursting out a whole batch at once.
  if (battle.convergenceCue === 'verdict') {
    battle.finalVerdictRingTimer -= dt;
    if (battle.finalVerdictRingTimer <= 0) {
      battle.finalVerdictRingA += battle.convergenceOrbitDir * .35;
      spawnRing(true, battle.finalVerdictRingA, 360, battle.convergenceOrbitDir * 1.0, 160, .45, 2);
      battle.finalVerdictRingTimer = 1.5;
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
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 9.6, vx: rand(-40, 40) * DIFFICULTY.projectileMult, vy: 225 * DIFFICULTY.projectileMult, r: 5, ...hazardAgeFields(5) });
      battle.inkSpawn = .14; // was .19 — denser now that inkTimer itself also runs longer (see spawnConvergenceCueHazard's oracle branch)
    }
  }
  updateConvergenceMarks(dt);
  for (const p of battle.aimedBullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.aimedBullets = battle.aimedBullets.filter(p => !hazardExpired(p.ageExpireT) && p.x > battle.box.x - 40 && p.x < battle.box.x + battle.box.w + 40 && p.y > battle.box.y - 40 && p.y < battle.box.y + battle.box.h + 40);
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
  updateRingHazards(dt); updateSpearHazards(dt, true); updateShapeHazards(dt, true);
  // Hourglass/Gale cues now spawn real sand/orbs/flags/wind rows (see
  // spawnConvergenceCueHazard) — need their own update loops run. Same for
  // the archivist cue's echo books (spawnEchoBook) and the mask cue's
  // drifting shards (spawnMaskShard) — without their own update calls they
  // spawn in and just sit there frozen, never tumbling/drifting.
  updateSandGrains(dt); updateHourglassOrbs(dt); updateGaleFlags(dt); updateWindLines(dt);
  updateEchoBooks(dt); updateWeavingBooks(dt); updateTrailSquares(dt);
  updateMaskShards(dt);
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
  // Winning in the whole-fight timer's own last 5s (see ERIF_FIGHT_TIME_LIMIT,
  // updateErif) leaves musicFadeMult already partway faded and
  // erifFightFadeT already partway to a full black-out — without resetting
  // both here, this victory's own white fade-in would pick up from wherever
  // that left off instead of a clean, full-volume start, reading as the
  // music briefly fighting itself and the screen flickering from black
  // toward white right as the win lands.
  musicFadeMult = 1;
  battle.erifFightFadeT = 0;
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
  dialogue = { lines: ERIF_TWIST_DIALOGUE, index: 0, after: 'erifReckoningIntro', context: 'battle' };
  mode = 'erifTwist';
  tone(45, .4, 'sawtooth', .06);
}
// A short, plainly-worded control reminder chained in right after the twist
// dialogue and right before the fight itself actually starts (see
// advanceDialogue's after==='erifReckoningIntro' branch and this dialogue's
// own after==='erifTrueFinal') — same big arena-sized manual dialogue box,
// just attributed to a neutral label instead of Erif's own voice so it
// reads as a genuine tutorial beat, not more taunting.
function startErifReckoningIntro() {
  if (!battle) return;
  dialogue = { lines: ERIF_RECKONING_INTRO_DIALOGUE, index: 0, after: 'erifTrueFinal', context: 'battle', speaker: 'THE RECKONING' };
  mode = 'erifTwist';
  tone(220, .12, 'sine', .03);
}

// ---- "The Reckoning": a two-hands Kirby-style boss fight. Each hand wears
// one of the 8 lieutenant wards, wanders the arena firing that ward's
// attack from its own fingertips, and periodically breaks off to chase the
// player and slam down — that slam is the ONLY window to actually damage a
// hand. Breaking a hand (2 hits) is the ENTIRE win condition now: Erif's
// own head HP drops by 1 automatically the instant a hand breaks — there is
// no separate player-driven head attack anymore. A broken hand retreats,
// recharges for a few seconds, then comes back wearing a new random ward
// and resumes on its own; each hand's cycle runs fully independently of the
// other. Erif's head HP equals the ward count (8), so the fight ends the
// instant the 8th hand ever breaks, straight into the existing
// beginErifTrueVictory/true-ending flow. A hard 135s clock black-fades the
// whole fight out (a loss) if it runs long. ----
// h trimmed from 580 — unlike Enraged/Final Convergence, this phase keeps
// the HP row/timer/controls legend on-screen (see hideBottomUI, main.js) on
// purpose, so the bottom edge is raised enough to leave that whole strip
// real room below the arena instead of pushing it off-canvas.
const ERIF_HANDS_BOX = { x: 25, y: 30, w: 910, h: 490 };
const ERIF_HANDS_BOX_GROW_TIME = 1.4;
const HAND_WARD_HP = 2, ERIF_HEAD_HP = REPRISE_ORDER.length; // one point of head HP per ward, so the 8th break ends it exactly
const HAND_HIT_RANGE = 100;
// A brief per-hand invulnerability right after any hit lands — without it,
// two Space presses landed close enough together (a fast player, or just
// luck) could land both of a ward's 2 hits back to back, breaking it
// "instantly" with no real read on the second hit at all.
const HAND_HIT_COOLDOWN = .4;
// How long a broken hand sits fully out of play before it's eligible to
// come back with a new ward — the actual re-equip still queues behind
// EQUIP_TIME/EMERGE_* below on top of this, same as it always has.
const HAND_RECHARGE_TIME = 5;
// A little flavor detour: instead of rejoining the fight the instant it
// finishes recharging, a broken hand has a 40% chance to wander down to the
// volume meters (see VOL_METER/volMeterRect, render.js) and crank the music
// slider to max first, "helping" before it gets back to the fight — never
// happens if the music's already maxed, since there'd be nothing to turn
// up. See startErifVolumeTrip and the 'volumeTripDown'/'volumeTripPress'/
// 'volumeTripUp' states in updateErifHand.
const ERIF_VOLUME_TRIP_CHANCE = .55;
const ERIF_VOLUME_TRIP_PRESS_TIME = 1.1; // how long the finger lingers on the bar before heading back
// Own min/max travel-time bounds rather than reusing EMERGE_*/RETRACT_TIME —
// those are tuned for the short emerge-from-dock/retreat-to-dock hops, but
// the volume meters sit in a fixed screen corner that can be far from
// wherever the hand currently is (especially in the Reckoning's own big
// arena), so a wide-enough cap here keeps the travel speed looking
// consistent regardless of distance instead of being squeezed into a too-
// short window and reading as an unnaturally fast dash.
const ERIF_VOLUME_TRIP_MIN_TIME = .6, ERIF_VOLUME_TRIP_MAX_TIME = 3.5;
const ERIF_HEAD_SCALE = .85; // read by render.js's drawErifHeadHUD too
const RECKONING_TIME_LIMIT = 135, RECKONING_FADE_WINDOW = 5;

// Erif's own mouth laser — a 2nd-phase mechanic, silent until 4 of the 8
// wards are broken (see handleErifPunch's trigger), then fires on every
// break from there on, alternating direction each time, but skipped
// entirely if one is already telegraphing/rotating (battle.erifBeamPhase
// truthy) — a player aggressive enough to break a ward during that danger
// window is rewarded with no second beam stacking on top of them, rather
// than punished for it.
// A 3s telegraph (an outlined, non-damaging indicator locked to the exact
// angle it'll fire at) gives real warning before it goes live and starts
// rotating — see updateErifHandHazards for the 'telegraph'/'active' state
// machine and drawErifBeam, render.js, for both visuals.
const ERIF_BEAM_TELEGRAPH_TIME = 3;
const ERIF_BEAM_ROT_PERIOD = 10; // seconds for one full rotation, then it stops completely (not permanent)
const ERIF_BEAM_ROT_SPEED = (Math.PI * 2) / ERIF_BEAM_ROT_PERIOD;
const ERIF_BEAM_HALF_WIDTH = .16; // radians — a wedge, so it visually widens with distance rather than covering the whole arena near the origin
const ERIF_BEAM_REACH = 1000; // comfortably covers every corner of ERIF_HANDS_BOX (910x490) from any point near the head's home anchor
const ERIF_BEAM_MOUTH_OFFSET_Y = 28; // local-space y (pre-scale) of the mouth's opening — see drawBossIcon's 'erif' branch, render.js

// Hand movement AI — wander/chase/slam/retreat/recharge. Numbers are tuned
// so realistic, non-perfect play clears all 8 wards with real buffer under
// the 135s hard cap rather than right up against it — see
// RECKONING_TIME_LIMIT above.
const HAND_DOCK_OFFSET = 150; // either side of Erif's own anchor point — clear of the portrait's reaching-line fringe (~121px out at ERIF_HEAD_SCALE), not overlapping it
const EQUIP_TIME = .35;
const EMERGE_SPEED = 380, EMERGE_MIN_TIME = .4, EMERGE_MAX_TIME = .9;
const WANDER_SPEED = 95, WANDER_TURN_RATE = 2.0;
const WANDER_REPICK_TIME = [1.3, 2.0];
const SLAM_COOLDOWN = [4, 8];
const CHASE_SPEED = 260, CHASE_TURN_RATE = 3.0, CHASE_MAX_TIME = 1.1, SLAM_ENGAGE_RANGE = 64;
const SLAM_TELEGRAPH_TIME = .55;
const HAND_VULNERABLE_TIME = 2.0;
const RETRACT_SPEED = 480, RETRACT_TURN_RATE = 6, RETRACT_SLOW_RADIUS = 140;
// Shared across both hands (battle.erifSlamLockoutT) — set the instant
// either hand COMMITS to a chase (not at impact), so the other can't start
// its own chase-and-slam until this clears. Setting it this early, rather
// than at impact, is what actually guarantees the gap: a hand's own
// chase-to-impact wind-up (CHASE_MAX_TIME + SLAM_TELEGRAPH_TIME) happens
// entirely inside this lockout window, so the earliest the other hand can
// begin chasing is SLAM_STAGGER_TIME after this hand started — which puts
// its own impact at least SLAM_STAGGER_TIME after this hand's impact too.
const SLAM_STAGGER_TIME = 6;

// Fingers — 1 thumb + 3 pointers, fanned around local "forward" (angle 0 =
// hand.facing). Each independently charges (reach eases from reachMin to
// reachMax — the visible "filling up" cue) and fires on its own timer,
// spreading a single ward's attack across 4 origins instead of one wrist.
const HAND_FINGERS = [
  // reachMax bumped 32 -> 40 (reachMin nudged along with it, 20 -> 24) — at
  // the old 32 it only cleared the hand's own 30px body circle by 2px, so
  // whatever it fired often still visually clipped under the hand right at
  // the moment of release instead of clearly emerging from the fingertip.
  { angle: -1.15, thumb: true, reachMin: 24, reachMax: 40 },
  { angle: -0.32, thumb: false, reachMin: 28, reachMax: 46 },
  { angle: 0, thumb: false, reachMin: 30, reachMax: 50 },
  { angle: 0.32, thumb: false, reachMin: 28, reachMax: 46 },
];
// Charge time up 1.8 -> 2.4 -> 3.2 (each step another flat 25% slower
// firing rate) and stagger scaled up to match both times, keeping the same
// 0/25/50/75%-of-charge offsets. The second bump is to compensate for the
// Reckoning itself running longer now (135s, was 100) with more layered on
// top of it (the mouth laser) — fewer finger-fired attacks overall so the
// extra time reads as more fight, not more simultaneous clutter.
const FINGER_CHARGE_TIME = 4.0;
const FINGER_STAGGER = [0, 1.0, 2.0, 3.0];
// oracle/gale/verdict fire a single global effect regardless of which
// finger triggers them (confirmed in spawnConvergenceCueHazard — none of
// the three actually vary with target position), so they're throttled
// separately from the per-finger charge to avoid a hand quadruple-stacking
// the same effect; a finger that rolls one of these on cooldown fires a
// bounce ball instead, so no charge is ever wasted.
const GLOBAL_WARD_COOLDOWN = 2.5;
// Gale-only extra throttle on top of the shared cooldown above (see
// fireFingerShot) — was 50% more than GLOBAL_WARD_COOLDOWN (gale's own gust
// was chaining almost back-to-back off the shared 2.5s alone), bumped
// another 50% on top of that (x1.5 -> x2.25) since it was still coming too
// often, then bumped again (x2.25 -> x3, 7.5s) for the same reason.
const GALE_COOLDOWN = GLOBAL_WARD_COOLDOWN * 3;
const BOUNCE_BALL_CHANCE = 0.225;
const BOUNCE_BALL_SPEED = 210, BOUNCE_BALL_R = 6.5;
// A rarer, heavier finger-shot variant — visually a faceted judgment gem
// (see gemEye/drawErifGemShard, render.js) instead of a plain bounce ball:
// 25% larger, originally 25% slower (then another 25% off that, .75 -> .5625)
// and originally a 15% chance (then another 25% off that, .15 -> .1125) —
// never bounces off the arena walls (dead straight instead), and shatters —
// breaks and disappears — the instant it actually lands a hit, rather than
// surviving to keep going like the bounce ball does.
const ERIF_GEM_SHARD_CHANCE = 0.1125;
const ERIF_GEM_SHARD_SPEED = BOUNCE_BALL_SPEED * .5625, ERIF_GEM_SHARD_R = BOUNCE_BALL_R * 1.25;
// An "eye" pops out and joins the fight permanently each time a hand break
// docks a point off Erif's head HP (see handleErifPunch) — up to 8 over the
// fight, one per ward. Same wall-bounce physics as the bounce ball above,
// just larger and slower, and — unlike the bounce ball — it never breaks on
// a bounce, so the arena gets permanently more dangerous as the fight goes on.
const EYE_BALL_SPEED = BOUNCE_BALL_SPEED * .5, EYE_BALL_R = BOUNCE_BALL_R * 1.5;

// Erif's own rest/pull anchor — hands dock near this point, and the head's
// own live position (battle.erifHeadX/Y) softly drifts toward a blend of
// this and the hands' centroid (see updateErifHandsFinale). Reads
// battle.box live every frame, same as the old fixed erifHeadPos formula
// did, so it still tracks the box's own grow-in animation for free.
function erifHomeAnchor() {
  const b = battle.box;
  // Pulled up further still (.40 -> .24 -> .14) — sitting any closer to
  // box-center kept the big head portrait (see drawErifHeadHUD) crowding
  // toward the gale gust's arena-centered wind arrow (drawBattle,
  // render.js), which reads there specifically because it's centered in
  // the box. This high leaves real clearance below for both the arrow and
  // the hands' own wandering room. Nudged back down 10% (.14 -> .154) — a
  // small correction, not a reversal of the above; still comfortably clear
  // of the wind arrow.
  return { x: b.x + b.w * .5, y: b.y + b.h * .154 };
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
// Where the hand's own palm needs to sit (and which way it needs to face)
// so its pointer finger (HAND_FINGERS[2] — the straight-ahead one, angle 0)
// lands exactly on the music slider's 10th/rightmost bar once fully
// extended, facing straight down (Math.PI/2, screen y grows downward).
// Palm sits reachMax above the bar so the fingertip — not the palm — is
// what actually touches it.
function erifVolumeTripTarget() {
  const mr = volMeterRect(1); // row 1 = the music row (see VOL_ROWS, render.js)
  const barX = mr.x + (VOL_METER.count - 1) * (VOL_METER.blockW + VOL_METER.gap) + VOL_METER.blockW / 2;
  const barY = mr.y + VOL_METER.blockH / 2;
  return { x: barX, y: barY - HAND_FINGERS[2].reachMax, facing: Math.PI / 2 };
}
// See ERIF_VOLUME_TRIP_CHANCE's own comment — called from the 'recharging'
// branch below instead of re-equipping immediately.
function startErifVolumeTrip(hand) {
  const target = erifVolumeTripTarget();
  startHandTravel(hand, { x: hand.x, y: hand.y }, { x: target.x, y: target.y }, EMERGE_SPEED, ERIF_VOLUME_TRIP_MIN_TIME, ERIF_VOLUME_TRIP_MAX_TIME);
  hand.volumeTripFacing = target.facing;
  // Retracted here rather than left at whatever mid-charge point the hand
  // happened to break at — 'volumeTripPress' only ever extends the pointer
  // finger (index 2) back out, so the others need a clean starting point.
  hand.fingers.forEach((f, i) => { f.chargeT = FINGER_STAGGER[i]; f.reach = HAND_FINGERS[i].reachMin; });
  hand.state = 'volumeTripDown';
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
// Same idea as steerHandToward, plus an "arrival" speed taper as the hand
// nears a STATIC point (the dock) — used by 'retreating'/'volumeTripUp'
// instead of the plain version above. Without the taper, a fast hand with a
// speed/turnRate ratio bigger than the arrival radius physically can't turn
// tightly enough to close the last stretch — it overshoots, curves back
// around, overshoots again, and orbits the dock forever instead of ever
// landing on it. Slowing down on approach shrinks the turning radius right
// along with the remaining distance, so it actually converges. Returns the
// live distance to target so the caller can do its own arrival check.
function steerHandToArrival(hand, target, maxSpeed, turnRate, dt, slowRadius) {
  const d = dist(hand.x, hand.y, target.x, target.y);
  const speed = maxSpeed * clamp(d / slowRadius, .12, 1);
  steerHandToward(hand, target, speed, turnRate, dt);
  return d;
}

// A bare hand shell — actually wearing a ward and joining the fight happens
// in beginHandBout below. 'gone' is the same do-nothing terminal state a
// hand ends up in permanently if it's ever broken with nothing left in the
// ward pool to hand it (defensive only — with ERIF_HEAD_HP equal to the
// ward count, the fight ends on the 8th break before this can normally
// happen at all) — starting there is just a safe placeholder for the
// single frame before beginErifTrueFinal's own beginHandBout() calls
// overwrite it.
function makeErifHand(id) {
  const dock = handDockPos(id);
  return {
    id, x: dock.x, y: dock.y, facing: 0,
    ward: null, hp: 0,
    state: 'gone', stateT: 0,
    hitCooldownT: 0, // brief per-hand invulnerability right after any hit lands
    wanderTarget: { x: dock.x, y: dock.y }, wanderRepickT: 0,
    slamCooldownT: 0,
    slamTargetX: 0, slamTargetY: 0, // frozen at telegraph-start so the slam itself is dodgeable
    globalWardCooldownT: 0,
    galeCooldownT: 0, // extra throttle on top of globalWardCooldownT, gale only — see fireFingerShot
    travelFrom: null, travelTo: null, travelT: 0, travelDur: 0,
    fingers: HAND_FINGERS.map((cfg, i) => ({ chargeT: FINGER_STAGGER[i], reach: cfg.reachMin })),
    volumeTripFacing: 0, // target facing for the 'volumeTripDown' travel — see startErifVolumeTrip
    volumeTripPressed: false, // guards musicVolume actually getting set to 1 exactly once per trip
  };
}
// Resets a hand in place to start a fresh bout wearing `ward` — the one
// place a hand actually gets assigned a ward, reused for the very first
// bout and every recharge-cycle re-equip alike. Each hand calls this fully
// independently of the other now — there's no pairing/wave bookkeeping.
function beginHandBout(hand, ward) {
  const dock = handDockPos(hand.id);
  hand.x = dock.x; hand.y = dock.y; hand.facing = 0;
  hand.ward = ward; hand.hp = HAND_WARD_HP;
  hand.state = 'equipping'; hand.stateT = EQUIP_TIME;
  hand.hitCooldownT = 0;
  hand.wanderTarget = { x: dock.x, y: dock.y }; hand.wanderRepickT = 0;
  hand.slamCooldownT = 0;
  hand.slamTargetX = 0; hand.slamTargetY = 0;
  hand.globalWardCooldownT = 0;
  hand.galeCooldownT = 0;
  hand.travelFrom = null; hand.travelTo = null; hand.travelT = 0; hand.travelDur = 0;
  hand.fingers = HAND_FINGERS.map((cfg, i) => ({ chargeT: FINGER_STAGGER[i], reach: cfg.reachMin }));
  tone(CONVERGENCE_CUE_TONE[ward], .12, 'triangle', .04); // same per-family identifying cue every other ward-reload moment uses
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
    // No Normal-mode linger cap here — the Reckoning (the only place bounce
    // balls ever spawn) is Hard-only, so the cap could never actually fire.
    if (ball.bounces >= 2) {
      ball.dead = true;
      spawnSparks(ball.x, ball.y, 10, { color: EMBER, speed: [80, 160], life: .4 });
      tone(160, .1, 'sawtooth', .04);
    } else if (convergenceCircleHit(ball, ball.r)) hurt();
  }
  battle.erifBounceBalls = battle.erifBounceBalls.filter(b => !b.dead);
}

// ---- Gem shard: the rarer, heavier finger-shot variant above. Travels
// dead straight (no wall-bounce) and shatters on the very first thing it
// hits instead of surviving to keep going. ----
function spawnErifGemShard(x, y, aimX, aimY) {
  const a = Math.atan2(aimY - y, aimX - x) + rand(-.7, .7);
  const speed = ERIF_GEM_SHARD_SPEED * DIFFICULTY.projectileMult;
  battle.erifGemShards.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: ERIF_GEM_SHARD_R, spin: rand(-2, 2), ...hazardAgeFields(8) });
  tone(340, .07, 'triangle', .025);
}
function updateErifGemShards(dt) {
  const b = battle.box;
  for (const s of battle.erifGemShards) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (convergenceCircleHit(s, s.r)) {
      s.dead = true; hurt();
      spawnSparks(s.x, s.y, 9, { color: '#fff', speed: [70, 150], life: .35 });
      tone(200, .08, 'sawtooth', .03);
    }
  }
  battle.erifGemShards = battle.erifGemShards.filter(s => !s.dead && !hazardExpired(s.ageExpireT) &&
    s.x > b.x - 40 && s.x < b.x + b.w + 40 && s.y > b.y - 40 && s.y < b.y + b.h + 40);
}

// One of Erif's own eyes, popped out at the moment a hand break docks a
// point off his head HP — spawns from the head's live position in a random
// direction and bounces off battle.box's edges forever (no break-after-2nd-
// bounce like the regular bounce ball above), permanently escalating the
// arena's danger as more wards fall.
function spawnErifEyeBall() {
  const a = rand(0, Math.PI * 2);
  battle.erifEyeBalls.push({ x: battle.erifHeadX, y: battle.erifHeadY, vx: Math.cos(a) * EYE_BALL_SPEED, vy: Math.sin(a) * EYE_BALL_SPEED, r: EYE_BALL_R });
  tone(220, .16, 'triangle', .035);
}
function updateErifEyeBalls(dt) {
  const b = battle.box;
  for (const eye of battle.erifEyeBalls) {
    eye.x += eye.vx * dt; eye.y += eye.vy * dt;
    let bounced = false;
    if (eye.x - eye.r < b.x) { eye.x = b.x + eye.r; eye.vx = Math.abs(eye.vx); bounced = true; }
    else if (eye.x + eye.r > b.x + b.w) { eye.x = b.x + b.w - eye.r; eye.vx = -Math.abs(eye.vx); bounced = true; }
    if (eye.y - eye.r < b.y) { eye.y = b.y + eye.r; eye.vy = Math.abs(eye.vy); bounced = true; }
    else if (eye.y + eye.r > b.y + b.h) { eye.y = b.y + b.h - eye.r; eye.vy = -Math.abs(eye.vy); bounced = true; }
    if (bounced) { spawnSparks(eye.x, eye.y, 5, { color: '#fff', speed: [40, 90], life: .25 }); tone(260, .05, 'square', .018); }
    if (convergenceCircleHit(eye, eye.r)) hurt();
  }
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
    // Gale gets an extra throttle (galeCooldownT) on top of the shared
    // globalWardCooldownT — the gust's own telegraph+active duration
    // (~2.3s) was close enough to the shared 2.5s cooldown that a new one
    // could start almost the instant the last ended, reading as spammed,
    // without oracle/verdict having the same complaint. GALE_COOLDOWN (7.5s,
    // see its own comment) is the real effective gap for gale now.
    if (hand.globalWardCooldownT <= 0 && (ward !== 'gale' || hand.galeCooldownT <= 0)) {
      hand.globalWardCooldownT = GLOBAL_WARD_COOLDOWN;
      if (ward === 'oracle') { battle.inkTimer = 1.7; battle.inkSpawn = 0; }
      else if (ward === 'gale') { beginGaleGust(true); hand.galeCooldownT = GALE_COOLDOWN; }
      else {
        // Was a single hardcoded plain ring (2 gaps) regardless of anything
        // else — completely bypassed updateVerdict's own equal-odds
        // plain/close-burst/spaced-burst dispatch, so the Reckoning's verdict
        // ward never actually showed the two burst variations at all, no
        // matter what was tuned on the standalone trial's side. Same equal
        // 1/3 odds as updateVerdict now, reusing its actual spawn functions.
        // Centered on the player's own current position (not passed at all
        // on the standalone trial's side, where box-center is the intended
        // "close in from the fixed middle" mechanic) — the Reckoning's box
        // is nearly 5x the area of that trial's own, so a box-centered ring
        // could spawn its danger-boundary crossing right on top of a player
        // standing off in a corner, with zero warning.
        const origin = { x: s.x, y: s.y };
        const roll = Math.random();
        if (roll < 1 / 3) spawnVerdictRing(true, origin);
        else if (roll < 2 / 3) spawnVerdictCloseBurst(true, origin);
        else spawnVerdictSpacedBurst(true, origin);
      }
    } else if (Math.random() < ERIF_GEM_SHARD_CHANCE) {
      spawnErifGemShard(x, y, s.x, s.y);
    } else {
      spawnErifBounceBall(x, y, s.x, s.y);
    }
  } else {
    spawnConvergenceCueHazard(ward, { x, y }, true);
    if (Math.random() < ERIF_GEM_SHARD_CHANCE) spawnErifGemShard(x, y, s.x, s.y);
    else if (Math.random() < BOUNCE_BALL_CHANCE) spawnErifBounceBall(x, y, s.x, s.y);
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
// vulnerable) -> retreating -> recharging -> equipping | gone.
// Vulnerability is gated entirely behind landing a slam — wandering hands
// (charging/firing fingers) can't be damaged at all. Breaking a hand (see
// handleErifPunch) automatically docks a point off Erif's own head HP —
// there's no separate player-driven head attack anymore — then the hand
// runs its own retreat/recharge/re-equip cycle fully independently of the
// other hand.
function updateErifHand(hand, dt) {
  if (hand.state === 'equipping' || hand.state === 'gone' || hand.state === 'recharging') {
    // Parked states stay formula-driven off the live box/anchor (like the
    // old fixed-position hands did) rather than a stale snapshot, so they
    // never drift out of sync if the box is still animating.
    const dock = handDockPos(hand.id);
    hand.x = dock.x; hand.y = dock.y;
    if (hand.state === 'recharging') {
      // A gentle idle drift while parked recharging — this used to sit
      // perfectly still for the full HAND_RECHARGE_TIME, which read as
      // frozen/broken next to a boss whose every other state is constantly
      // moving. Phase-offset per hand (hand.id) so the two don't bob in
      // lockstep, small enough that it still reads as "resting near Erif"
      // rather than wandering off.
      const t = battle.t + hand.id * 1.7;
      hand.x += Math.sin(t * 1.3) * 14;
      hand.y += Math.cos(t * 0.9) * 10;
      hand.facing = Math.sin(t * 0.6) * .15;
    }
  }
  hand.hitCooldownT = Math.max(0, hand.hitCooldownT - dt);
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
    hand.galeCooldownT = Math.max(0, hand.galeCooldownT - dt);
    hand.slamCooldownT -= dt;
    // Also gated on the shared slam lockout (battle.erifSlamLockoutT) — a
    // hand whose own cooldown is ready just waits here, still
    // wandering/firing normally, until the other hand's own chase window has
    // cleared. The lockout is (re-)armed the instant this hand commits below
    // — see SLAM_STAGGER_TIME's comment for why that timing is what actually
    // guarantees the gap between the two hands' impacts.
    if (hand.slamCooldownT <= 0 && battle.erifSlamLockoutT <= 0) {
      hand.state = 'chasing'; hand.stateT = CHASE_MAX_TIME;
      battle.erifSlamLockoutT = SLAM_STAGGER_TIME;
    }
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
      // The slam impact — an expanding shockwave ring (see spawnRing's
      // origin/expand params, hazards.js) is what actually opens the
      // vulnerable window. HP is untouched here. Dashed with gaps all the
      // way around (10 openings) rather than 2 big ones, and 25% slower, so
      // it reads as a real dodgeable ring instead of a near-solid wall.
      spawnRing(true, 0, 18, 0, 127.5, 0.16, 10, { x: hand.x, y: hand.y }, true);
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
    // Continuously re-targets the LIVE dock position every frame (which
    // itself follows the boss's own drifting head anchor — see
    // erifHomeAnchor/handDockPos) instead of a one-time snapshot taken the
    // instant the retreat began. The head keeps drifting for the whole
    // fight, so a frozen target used to leave the hand visibly popping
    // into alignment only once it hit 'recharging' below and got pinned to
    // the (by-then different) live dock — this way it tracks smoothly.
    const dock = handDockPos(hand.id);
    const d = steerHandToArrival(hand, dock, RETRACT_SPEED, RETRACT_TURN_RATE, dt, RETRACT_SLOW_RADIUS);
    if (d < 16) { hand.state = 'recharging'; hand.stateT = HAND_RECHARGE_TIME; }
  } else if (hand.state === 'recharging') {
    if (hand.stateT <= 0) {
      // Draws a fresh ward and rejoins on its own — fully independent of
      // whatever the other hand is doing. Defensive fallback to 'gone' if
      // the pool's ever actually empty (shouldn't happen in practice, since
      // ERIF_HEAD_HP equals the ward count and the fight ends on the 8th
      // break, before an 9th recharge could ever complete).
      if (battle.erifWardPool.length) {
        // See ERIF_VOLUME_TRIP_CHANCE's own comment — a chance to detour
        // down to the volume meters before actually rejoining, skipped
        // entirely once the music's already at max. Also gated off the
        // first 2 wards broken (battle.erifWardsDestroyed) — the earliest
        // this can ever trigger is the 3rd hand to recharge, not the very
        // first one, so it doesn't show up right at the start of the fight.
        if (battle.erifWardsDestroyed >= 3 && musicVolume < 1 && Math.random() < ERIF_VOLUME_TRIP_CHANCE) startErifVolumeTrip(hand);
        else beginHandBout(hand, battle.erifWardPool.pop());
      } else hand.state = 'gone';
    }
  } else if (hand.state === 'volumeTripDown') {
    // Turns to face the bar over the course of the travel rather than
    // snapping instantly, same easing feel as the rest of this state
    // machine's own transitions.
    const da = Math.atan2(Math.sin(hand.volumeTripFacing - hand.facing), Math.cos(hand.volumeTripFacing - hand.facing));
    hand.facing += da * Math.min(1, dt * 3);
    if (updateHandTravel(hand, dt)) {
      hand.facing = hand.volumeTripFacing;
      hand.state = 'volumeTripPress'; hand.stateT = ERIF_VOLUME_TRIP_PRESS_TIME;
      hand.volumeTripPressed = false;
    }
  } else if (hand.state === 'volumeTripPress') {
    // Only the pointer finger (index 2, the straight-ahead one) extends —
    // the others stay retracted, reading as a single deliberate press
    // rather than the usual all-fingers wandering fan.
    const pct = 1 - clamp(hand.stateT / ERIF_VOLUME_TRIP_PRESS_TIME, 0, 1);
    hand.fingers[2].reach = lerp(HAND_FINGERS[2].reachMin, HAND_FINGERS[2].reachMax, clamp(pct / .4, 0, 1));
    if (!hand.volumeTripPressed && pct >= .4) {
      hand.volumeTripPressed = true;
      musicVolume = 1;
      tone(260, .04, 'sine', .05); // same cue the volume meter's own click uses
    }
    if (hand.stateT <= 0) {
      hand.fingers[2].reach = HAND_FINGERS[2].reachMin;
      hand.state = 'volumeTripUp';
    }
  } else if (hand.state === 'volumeTripUp') {
    // Same live-dock tracking as 'retreating' above, for the same reason —
    // the trip back from the volume meters can take up to
    // ERIF_VOLUME_TRIP_MAX_TIME, plenty of time for the head to drift.
    const dock = handDockPos(hand.id);
    const d = steerHandToArrival(hand, dock, RETRACT_SPEED, RETRACT_TURN_RATE, dt, RETRACT_SLOW_RADIUS);
    if (d < 16) {
      if (battle.erifWardPool.length) beginHandBout(hand, battle.erifWardPool.pop());
      else hand.state = 'gone';
    }
  }
  // 'gone' has nothing further to do this frame beyond the position pin above.
}

// Space bar: the player's dedicated attack, usable only within range of a
// currently-vulnerable hand (nearest one wins if both qualify) that isn't
// still on its own post-hit cooldown. There's no head target anymore —
// Erif's head takes damage automatically the instant a hand breaks (see
// below). Always pops the boxing-glove punch feedback (see
// battle.punchFlashT/punchDir, read by render.js's SHIELD drawing, not the
// flame) whether or not it actually lands.
function handleErifPunch() {
  const s = battle.soul;
  let target = null, nearestD = Infinity;
  for (const hand of battle.erifHands) {
    if (hand.state !== 'vulnerable' || hand.hitCooldownT > 0) continue;
    const d = dist(s.x, s.y, hand.x, hand.y);
    if (d <= HAND_HIT_RANGE && d < nearestD) { target = hand; nearestD = d; }
  }

  battle.punchDir = target ? Math.atan2(target.y - s.y, target.x - s.x) : (s.vx || s.vy ? Math.atan2(s.vy, s.vx) : battle.punchDir);
  battle.punchFlashT = .18;
  if (!target) { tone(90, .05, 'square', .015); return; }

  target.hp--;
  target.hitCooldownT = HAND_HIT_COOLDOWN; // can't be hit again for a beat, even on the same still-vulnerable hand
  tone(440, .08, 'square', .04);
  spawnSparks(target.x, target.y, 6, { color: EMBER, speed: [70, 150], life: .3 });
  if (target.hp <= 0) {
    kick(.05); tone(160, .18, 'sawtooth', .05); noiseHit(.08, .03, 1400);
    // Breaking a hand automatically docks a point off Erif's own head HP —
    // there's no separate player-driven head attack to land anymore.
    battle.erifHeadHp--; battle.erifHeadHitsLanded++; battle.erifWardsDestroyed++;
    battle.erifHeadHitFlashT = .3; // a brief flash on the head itself, the only feedback this automatic damage gets
    tone(300 + battle.erifHeadHitsLanded * 22, .1, 'sine', .05);
    spawnSparks(battle.erifHeadX, battle.erifHeadY, 8, { color: '#fff', speed: [60, 160], life: .35 });
    spawnErifEyeBall(); // one of Erif's own eyes pops out and joins the fight permanently, one per ward lost
    // The mouth laser is a 2nd-phase mechanic — silent through the first 4
    // ward breaks, then every break from the 4th onward attempts to fire
    // one, skipped only if one isn't already telegraphing/rotating
    // (erifBeamPhase truthy), rewarding a break landed during that danger
    // window rather than stacking a second beam on top of it.
    if (!battle.erifBeamPhase && battle.erifWardsDestroyed >= 4) {
      battle.erifBeamDir *= -1; // alternates every real beam (see its init, battle-core.js — starts counter-clockwise)
      battle.erifBeamPhase = 'telegraph';
      battle.erifBeamTimer = ERIF_BEAM_TELEGRAPH_TIME;
      // Locked in now rather than re-aimed when it actually goes live —
      // gives the player a fixed point to plan a dodge around for the whole
      // telegraph, not a moving target.
      const s = battle.soul;
      const ox = battle.erifHeadX, oy = battle.erifHeadY + ERIF_BEAM_MOUTH_OFFSET_Y * ERIF_HEAD_SCALE;
      battle.erifBeamAngle = Math.atan2(s.y - oy, s.x - ox);
      tone(200, .12, 'triangle', .03);
    }
    if (battle.erifHeadHp <= 0) {
      if (!battle.erifHandsLaughedAtFlurry) { battle.erifHandsLaughedAtFlurry = true; erifLaugh(); }
      beginErifTrueVictory();
      return;
    }
    // A hand already 'recharging' has first claim on the next ward it pops
    // (see the 'recharging' branch in updateErifHand) — if it's the only one
    // left in the pool, that claim already spoken for means there's really
    // nothing left for THIS hand, even though the pool array itself hasn't
    // shrunk yet. Without this check, this hand would sit through a whole
    // pointless HAND_RECHARGE_TIME wait only to land on 'gone' anyway once
    // the other hand actually takes the last ward first.
    const otherHand = battle.erifHands.find(h => h !== target);
    const otherClaim = otherHand && otherHand.state === 'recharging' ? 1 : 0;
    if (battle.erifWardPool.length > otherClaim) {
      // Retreats, recharges for HAND_RECHARGE_TIME, then re-equips a new
      // random ward and rejoins on its own — see the 'retreating'/
      // 'recharging' branches in updateErifHand.
      target.state = 'retreating'; target.ward = null;
    } else {
      // Nothing left in the pool to recharge it with — no point sending it
      // through a whole retreat-and-recharge cycle just to land on 'gone'
      // anyway. Destroy it outright, right here, with its own real feedback
      // beat instead of quietly idling off to the dock first.
      target.state = 'gone'; target.ward = null;
      kick(.07); tone(70, .3, 'sawtooth', .06); noiseHit(.14, .04, 900);
      spawnSparks(target.x, target.y, 14, { color: EMBER, speed: [90, 220], life: .45 });
    }
  } else {
    // A non-breaking hit closes the window immediately instead of leaving it
    // vulnerable for the rest of HAND_VULNERABLE_TIME — one slam, one hit,
    // full stop. Without this the player could land both of a ward's hits
    // inside the same window (wait out hitCooldownT, hit again) instead of
    // earning the second hit off a whole new chase-and-slam.
    target.state = 'wandering';
    target.slamCooldownT = rand(SLAM_COOLDOWN[0], SLAM_COOLDOWN[1]);
    pickWanderTarget(target);
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
  // The verdict ward's spaced-burst variation (spawnVerdictSpacedBurst,
  // bosses.js) fires its 2nd ring off this pending timer, normally ticked by
  // updateVerdict's own loop — the Reckoning never runs that loop at all
  // (fireFingerShot's verdict branch calls the spawn functions directly), so
  // without this the 2nd ring just never showed up here.
  if (battle.verdictSpacedBurstPending) {
    battle.verdictSpacedBurstTimer -= dt;
    if (battle.verdictSpacedBurstTimer <= 0) {
      battle.verdictSpacedBurstPending = false;
      const speed = VERDICT_RING_SPEED.hard;
      spawnRing(true, rand(0, Math.PI * 2), 360, 0, speed, VERDICT_SPACED_BURST_GAP, 4, battle.verdictSpacedBurstOrigin);
      tone(200, .05, 'sine', .03);
    }
  }
  updateSpearHazards(dt, true);
  updateShapeHazards(dt, true);
  updateSandGrains(dt); updateHourglassOrbs(dt);
  updateGaleFlags(dt); updateWindLines(dt);
  // Same missing-update bug as Convergence/Final Convergence had for the
  // archivist cue's echo books and the mask cue's drifting shards —
  // spawning them without ever calling their own update function left them
  // frozen in place, never actually tumbling/drifting in.
  updateEchoBooks(dt); updateWeavingBooks(dt); updateTrailSquares(dt);
  updateMaskShards(dt);
  updateErifBounceBalls(dt);
  updateErifGemShards(dt);
  updateErifEyeBalls(dt);
  if (battle.galeGustPhase === 'telegraph') {
    // The Reckoning's gale-ward finger attack only ever fired a gust — no
    // wind-line row like every other gale context has. Added, synced (see
    // tickGaleWindRowSync, bosses.js) so the row's sweep lands while
    // controlsInverted is true instead of trailing in afterward.
    tickGaleWindRowSync(true);
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) launchGaleGust(true);
  } else if (battle.galeGustPhase === 'active') {
    const b = battle.box, s = battle.soul;
    s.x = clamp(s.x + battle.windVX * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = clamp(s.y + battle.windVY * dt, b.y + s.r, b.y + b.h - soulVisualBottomMargin());
    battle.galeGustTimer -= dt;
    if (battle.galeGustTimer <= 0) endGaleGust(true);
  }
  if (battle.inkTimer > 0) {
    battle.inkTimer -= dt; battle.inkSpawn -= dt;
    if (battle.inkSpawn <= 0) {
      battle.bullets.push({ x: rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), y: battle.box.y - 9.6, vx: rand(-45, 45) * DIFFICULTY.projectileMult, vy: 235 * DIFFICULTY.projectileMult, r: 5, ...hazardAgeFields(5) });
      battle.inkSpawn = .17;
    }
  }
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (convergenceCircleHit(p, p.r)) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
  if (battle.erifBeamPhase === 'telegraph') {
    battle.erifBeamTimer -= dt;
    if (battle.erifBeamTimer <= 0) {
      battle.erifBeamPhase = 'active';
      battle.erifBeamTimer = 0; // reused below to track rotation progress against ERIF_BEAM_ROT_PERIOD
      kick(.08); tone(50, .4, 'sawtooth', .07); noiseHit(.16, .05, 700);
      spawnSparks(battle.erifHeadX, battle.erifHeadY, 12, { color: EMBER, speed: [100, 240], life: .45 });
    }
  } else if (battle.erifBeamPhase === 'active') {
    battle.erifBeamTimer += dt;
    if (battle.erifBeamTimer >= ERIF_BEAM_ROT_PERIOD) {
      battle.erifBeamPhase = null; // exactly one full rotation, then it stops completely — not permanent
    } else {
      battle.erifBeamAngle += battle.erifBeamDir * ERIF_BEAM_ROT_SPEED * dt;
      const ox = battle.erifHeadX, oy = battle.erifHeadY + ERIF_BEAM_MOUTH_OFFSET_Y * ERIF_HEAD_SCALE;
      const s = battle.soul;
      // Same shortest-signed-angle-difference trick as ringAngleIsOpen
      // (hazards.js) — atan2(sin(Δ), cos(Δ)) avoids the ±π wraparound bug a
      // plain subtraction would have, applied here to a danger arc instead
      // of a ring's safe arc.
      const a = Math.atan2(s.y - oy, s.x - ox);
      const da = Math.atan2(Math.sin(a - battle.erifBeamAngle), Math.cos(a - battle.erifBeamAngle));
      if (Math.abs(da) <= ERIF_BEAM_HALF_WIDTH && dist(s.x, s.y, ox, oy) <= ERIF_BEAM_REACH) hurt();
      // A rapid, quiet, repeating low tone rather than one sustained note —
      // this codebase's tone() is a discrete one-shot, so a fast loop of them
      // is what stands in for a continuous laser hum.
      battle.erifBeamToneTimer -= dt;
      if (battle.erifBeamToneTimer <= 0) { tone(65, .11, 'sawtooth', .022); battle.erifBeamToneTimer = .12; }
    }
  }
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
  battle.erifHeadHitFlashT = 0;
  battle.erifSlamLockoutT = 0;
  battle.erifHandsLaughedAtFlurry = false;
  battle.erifBounceBalls = [];
  battle.erifGemShards = [];
  battle.erifEyeBalls = [];
  battle.erifReckoningFadeT = 0;
  battle.punchFlashT = 0; battle.punchDir = 0;
  battle.boxGrowFrom = { ...battle.box };
  battle.boxGrowTo = { ...ERIF_HANDS_BOX };
  battle.boxGrowT = 0;
  battle.soul.x = W / 2; battle.soul.y = ERIF_HANDS_BOX.y + ERIF_HANDS_BOX.h - 100;
  battle.soul.vx = 0; battle.soul.vy = 0;
  const home = erifHomeAnchor();
  battle.erifHeadX = home.x; battle.erifHeadY = home.y;
  // Each hand starts its own bout independently — no pairing/wave bookkeeping.
  beginHandBout(battle.erifHands[0], battle.erifWardPool.pop());
  beginHandBout(battle.erifHands[1], battle.erifWardPool.pop());
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
  battle.erifHeadHitFlashT = Math.max(0, battle.erifHeadHitFlashT - dt);
  battle.erifSlamLockoutT = Math.max(0, battle.erifSlamLockoutT - dt);

  for (const hand of battle.erifHands) updateErifHand(hand, dt);

  // Loose head/hand coupling: the head softly drifts toward a blend of its
  // home anchor and the centroid of currently-active (non-gone/equipping/
  // recharging) hands — a slow lerp, not a snap-track, so it comfortably
  // trails behind rather than rigidly locking on. Recharging hands are
  // excluded same as equipping/gone ones — they're parked at their own dock
  // point (see updateErifHand), not really "in the fight" yet, so counting
  // one toward this centroid dragged the head off its own home anchor and
  // right on top of that parked hand instead of leaving it sitting clearly
  // off to the side.
  const home = erifHomeAnchor();
  const active = battle.erifHands.filter(h => h.state !== 'gone' && h.state !== 'equipping' && h.state !== 'recharging');
  const cx = active.length ? active.reduce((sum, h) => sum + h.x, 0) / active.length : home.x;
  const cy = active.length ? active.reduce((sum, h) => sum + h.y, 0) / active.length : home.y;
  const tx = lerp(home.x, cx, .4), ty = lerp(home.y, cy, .4);
  battle.erifHeadX += (tx - battle.erifHeadX) * Math.min(1, dt * .6);
  battle.erifHeadY += (ty - battle.erifHeadY) * Math.min(1, dt * .6);

  if (tap(' ')) handleErifPunch();

  updateErifHandHazards(dt);

  // Hard 135s time limit — the last 5s shake the screen harder and harder
  // (see battle.erifReckoningFadeT, read by main.js's draw()), and running
  // the clock all the way out is a loss. Unlike hurt(), this always applies,
  // God Mode included — the clock is a hard fight constraint, not ordinary
  // damage, so debug invulnerability doesn't cover it. Deliberately no
  // screen fade and no music fade here anymore — the player should be able
  // to keep reading the arena and hearing the theme at full volume right up
  // to the very end, with the shake alone carrying "it's about to end."
  const remaining = RECKONING_TIME_LIMIT - (battle.t - battle.phaseStartT);
  battle.erifReckoningFadeT = remaining > RECKONING_FADE_WINDOW ? 0 : clamp(1 - remaining / RECKONING_FADE_WINDOW, 0, 1);
  // Same tension-visualizer growth as updateErif's own, just measured
  // against the Reckoning's own timer instead of the whole fight's.
  battle.erifReckoningVisualizerGrowth = clamp(((battle.t - battle.phaseStartT) / RECKONING_TIME_LIMIT - .5) / .25, 0, 1);
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
  // Same reset as beginErifVictory, for the same reason — winning in the
  // Reckoning's own hard 135s timer's last 5s (see RECKONING_TIME_LIMIT,
  // updateErifHandsFinale) leaves musicFadeMult/erifReckoningFadeT already
  // partway faded, which would otherwise carry straight into this victory's
  // own fade-in instead of starting clean.
  musicFadeMult = 1;
  battle.erifReckoningFadeT = 0;
  mode = 'erifTrueVictory';
  tone(28, .9, 'sawtooth', .1);
}
function updateErifTrueVictory(dt) {
  if (!battle) return;
  battle.trueVictoryT += dt;
  // Fades the Reckoning theme out under the white-flash/shake beat instead of
  // letting it play on at full volume through the whole cinematic — same
  // musicFadeMult tie-in updateErifVictory uses for the normal ending, just
  // timed to this phase's own shorter FADE_END (see drawErifTrueVictory,
  // render.js): starts with the white-out at t>.95, silent well before the
  // dialogue phase begins at t=5.
  if (battle.trueVictoryT > .95) musicFadeMult = 1 - clamp((battle.trueVictoryT - .95) / 3.5, 0, 1);
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

// A hard cap on the whole Erif fight (every phase up through Enraged/the
// twist — the Reckoning has its own separate, later cap, see
// RECKONING_TIME_LIMIT), same white-fade/shake/music-fade/loss treatment as
// that one. Replaces the old soft battle.duration auto-win fallback (see
// updateBattle, battle-core.js) with a real hard loss for Erif specifically.
const ERIF_FIGHT_TIME_LIMIT = 140, ERIF_FIGHT_FADE_WINDOW = 5; // 5s shorter than it used to be, to line up the end-of-fight music cue
// How long the whole Reprise (all 8 segments) should take, landing its
// completion (see REPRISE_ORDER's own advance logic below) this many
// seconds after fight start. Deliberately ERIF_FIGHT_TIME_LIMIT minus BOTH
// the Enraged dialogue's 75s-remaining sync target AND that dialogue's own
// natural floor duration — not just the 75s point itself — so that in the
// typical case the dialogue doesn't have to stretch OR speed up at all; its
// own charsPerSec/holdTime adjustment (see startErifEnrageDialogue) is only
// meant as the last-resort correction for whatever residual drift still
// gets through, not the primary mechanism. Every Reprise segment is either
// a flat fixed window or bounded by its own internal round timeout except
// the Archivist (a genuine pass/retry quick-match, see
// updateRepriseArchivist) — its variance is what actually drifts the
// Reprise's total off this target, and Verdict (always the last segment) is
// the one lever that corrects for it, see its own
// battle.repriseVerdictDuration catch-up below.
const REPRISE_TARGET_DURATION = (ERIF_FIGHT_TIME_LIMIT - 75) - ERIF_ENRAGE_DIALOGUE_NATURAL_DURATION;
function updateErif(dt) {
  if (battle.phase === PHASE_LAST_WAGER) { updateErifHandsFinale(dt); return; }
  const fightRemaining = ERIF_FIGHT_TIME_LIMIT - battle.t;
  // No screen/music fade in the last 5s (see updateErifHandsFinale's own
  // matching note) — battle.erifFightFadeT still drives an escalating shake
  // instead (main.js's draw()).
  battle.erifFightFadeT = fightRemaining > ERIF_FIGHT_FADE_WINDOW ? 0 : clamp(1 - fightRemaining / ERIF_FIGHT_FADE_WINDOW, 0, 1);
  if (fightRemaining <= 0) {
    finishBattle(false);
    battle.clearText = 'THE HOUR RAN OUT.';
    return;
  }
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
    // above). Executioner and Mask get their own shorter fixed window
    // (4.5s) instead of the default — the whole Reprise is meant to move
    // fast. Gale gets its own longer window (7s). Verdict's own window is
    // computed dynamically (battle.repriseVerdictDuration, set the instant
    // this segment begins below) rather than a flat number — see
    // REPRISE_TARGET_DURATION.
    const segmentDone =
      name === 'archivist' ? battle.repriseArchivistDone :
      name === 'oracle' ? battle.repriseOracleDone :
      name === 'hourglass' ? battle.repriseHourglassDone :
      name === 'witness' ? battle.repriseWitnessDone :
      battle.repriseSegElapsed >= (
        name === 'executioner' || name === 'mask' ? 4.25 :
        name === 'gale' ? 7 :
        name === 'verdict' ? (battle.repriseVerdictDuration ?? 10) :
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
        // Verdict (always the last Reprise segment) is the one elastic
        // lever left to land the whole Reprise at REPRISE_TARGET_DURATION —
        // every other segment is either a flat fixed window or bounded by
        // its own internal round timeout, so by the time Verdict begins,
        // whatever drift built up (mainly the Archivist's own variable
        // pass/retry time) is already fully known and gets corrected here
        // in one place instead of nowhere. Clamped so it can never collapse
        // below enough room to show its own normal/burst split (see
        // verdictPhaseProgress, bosses.js, which reads this same duration
        // for its cycle length) or balloon absurdly on an unusually fast
        // clear.
        if (REPRISE_ORDER[next] === 'verdict') {
          battle.repriseVerdictDuration = clamp(REPRISE_TARGET_DURATION - battle.t, 6, 20);
        }
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
