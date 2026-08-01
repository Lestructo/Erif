'use strict';

// The 8 lieutenant update/draw functions (Hourglass, Mask, Executioner,
// Witness, Archivist, Oracle, Verdict, Gale).

// ---- THE HOURGLASS — Time. Slow/fast phases scale the hazards' pace,
// not the player's. A visible sand meter (drawn in render.js off sandTimer/
// sandMax) always telegraphs the next flip. ----
function beginSandPhase(hard, phase) {
  battle.sandPhase = phase;
  battle.timeScale = phase === 'fast' ? (hard ? 2.5 : 2) : (hard ? .25 : .5);
  battle.sandMax = phase === 'fast' ? (hard ? 5 : 3) : (hard ? 3 : 2);
  battle.sandTimer = battle.sandMax;
  tone(phase === 'fast' ? 260 : 140, .16, 'triangle', .035);
}
// A single grain, falling straight down from the top of the box — dodged by
// position, not the shield, so it's a different kind of pressure than the
// volley/needle baseline below. Its fall speed bakes in the current
// timeScale at spawn time, same convention as spawnSpear baking in `hard`.
function spawnSandGrain(hard = false) {
  const b = battle.box;
  const x = rand(b.x + 14, b.x + b.w - 14);
  const speed = (hard ? 130 : 105) * battle.timeScale * DIFFICULTY.projectileMult;
  // Varies up to 3x the original fixed size (6) — bigger grains read as
  // heavier/slower-feeling even though their fall speed is unchanged, purely
  // a size read. During the slow phase specifically, grains are always at
  // least 3x bigger on top of that — slow enough to actually be worth
  // making a bigger, more deliberate telegraph out of.
  const slowMult = battle.sandPhase === 'slow' ? 3 : 1;
  // 20% further out (12 -> 14.4) — no telegraph before it's live.
  battle.sandGrains.push({ x, y: b.y - 14.4, vy: speed, r: rand(6, 18) * slowMult, ...hazardAgeFields(15) });
  tone(320, .04, 'square', .015);
}
function updateSandGrains(dt) {
  const b = battle.box, s = battle.soul;
  for (const g of battle.sandGrains) {
    g.y += g.vy * dt;
    if (dist(g.x, g.y, s.x, s.y) < s.r + hazardHitRadius(g) - 2) { g.dead = true; hurt(); }
    // A brief dust puff right as a grain lands at the arena floor (not the
    // player) — a miss used to just silently vanish a little further down.
    else if (!g.puffed && g.y >= b.y + b.h) { g.puffed = true; spawnSparks(g.x, b.y + b.h, 3, { color: EMBER, speed: [20, 50], life: .25 }); noiseHit(.05, .006, 2600, null, 'sfx'); }
  }
  // naturalNormalSeconds sized off the SLOW sand phase specifically (its own
  // deliberately slow-motion, bigger-telegraph grains — see spawnSandGrain's
  // slowMult comment), not the fast phase — a value tuned to the fast
  // phase's much shorter natural fall time would cut the slow phase's
  // intentional drama short instead of just decluttering the fast phase.
  battle.sandGrains = battle.sandGrains.filter(g => !g.dead && g.y < b.y + b.h + 40 && !hazardExpired(g.ageExpireT));
}
// A small hourglass, cast loose and drifting on its own wandering path — no
// wall of origin to read, no straight line to anticipate, just something to
// track and stay clear of. No shield involved (the Hourglass doesn't carry
// one anymore — see updateHourglass), so this is pure position dodging, same
// as the sand grains above. Its base speed is NOT pre-multiplied by
// timeScale (unlike a sand grain's fall speed, which bakes in the phase at
// spawn) — see updateHourglassOrbs, which applies the *current* timeScale
// live every frame instead, so every orb already in flight actually speeds
// up or slows down the instant the phase flips, not just new ones.
function spawnHourglassOrb(hard = false) {
  const b = battle.box, edge = (Math.random() * 4) | 0;
  // 20% further out (24 -> 28.8) — no telegraph before it's live.
  let x, y;
  if (edge === 0) { x = rand(b.x + 20, b.x + b.w - 20); y = b.y - 28.8; }
  else if (edge === 1) { x = b.x + b.w + 28.8; y = rand(b.y + 20, b.y + b.h - 20); }
  else if (edge === 2) { x = rand(b.x + 20, b.x + b.w - 20); y = b.y + b.h + 28.8; }
  else { x = b.x - 28.8; y = rand(b.y + 20, b.y + b.h - 20); }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const heading = Math.atan2(cy - y, cx - x) + rand(-.6, .6);
  const speed = (hard ? 44 : 34) * DIFFICULTY.projectileMult;
  // Base r dropped again (18.5 -> 15). During the slow phase specifically,
  // orbs are still 50% bigger — same "make the slow phase read as a bigger,
  // more deliberate telegraph" idea spawnSandGrain's own slowMult already
  // uses, just off the new smaller base.
  const slowMult = battle.sandPhase === 'slow' ? 1.5 : 1;
  battle.hourglassOrbs.push({ x, y, r: 15 * slowMult, heading, turnRate: rand(-1.1, 1.1), speed, spin: rand(0, Math.PI * 2), age: 0, ...hazardAgeFields(20) });
  tone(180, .1, 'triangle', .02);
}
function updateHourglassOrbs(dt) {
  const s = battle.soul, b = battle.box, ts = battle.timeScale || 1;
  // Orbs actually have to complete a real journey to the middle to matter —
  // the slow phase's own full timeScale (as low as .25) made that trip take
  // far longer than the slow phase itself lasts, so an orb spawned right at
  // the edge just sat there barely creeping for its whole time in play,
  // reading as stuck/vanished rather than drifting in. Floored here,
  // specifically for orb movement (spin/age below still use the raw ts), so
  // the slow phase still visibly reads as slower without freezing them.
  const moveTs = Math.max(ts, .55);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (const o of battle.hourglassOrbs) {
    o.spin += dt * 1.6 * ts;
    o.age = (o.age || 0) + dt * ts;
    // Tracks total time alive from spawn, unlike o.age above (which resets
    // the moment it passes center) — the hard 20s cutoff below needs to fire
    // off the orb's real lifetime, not the post-center ramp's own clock.
    o.totalAge = (o.totalAge || 0) + dt * ts;
    // turnRate itself random-walks (clamped) so the heading keeps gently
    // curving instead of settling into a straight line — reads as
    // "floating" rather than "launched."
    o.turnRate = clamp(o.turnRate + rand(-.8, .8) * dt, -1.4, 1.4);
    o.heading += o.turnRate * dt;
    const distToCenter = dist(o.x, o.y, cx, cy);
    // Sometimes the random wobble (or a slow approach) leaves an orb
    // loitering near the middle far longer than intended — 20s in, force it
    // straight to full outward pull regardless of whether it's technically
    // passed center yet, so nothing lingers indefinitely.
    const forceOut = o.totalAge >= 20;
    if (!o.passedCenter && !forceOut) {
      // Before it's actually swung through the middle of the arena, gently
      // correct the heading back toward center (on top of the turnRate
      // wobble) so the wander is guaranteed to actually carry it near the
      // middle rather than potentially curving away early. Once it gets
      // there, age resets so the outward-drift ramp below always gets its
      // full ~7s runway starting from that pass, not from spawn.
      const towardA = Math.atan2(cy - o.y, cx - o.x);
      const towardDiff = Math.atan2(Math.sin(towardA - o.heading), Math.cos(towardA - o.heading));
      o.heading += towardDiff * .6 * dt;
      if (distToCenter < 70) { o.passedCenter = true; o.age = 0; }
    } else {
      // Normally the outward pull ramps up (0 at the center pass, full
      // strength by ~7s after); once forced by the 20s cutoff it's pinned to
      // full strength immediately instead of still easing in.
      const outwardA = Math.atan2(o.y - cy, o.x - cx);
      const outwardDiff = Math.atan2(Math.sin(outwardA - o.heading), Math.cos(outwardA - o.heading));
      const outwardPull = forceOut ? 1.1 : clamp(o.age / 7, 0, 1) * 1.1;
      o.heading += outwardDiff * outwardPull * dt;
    }
    o.x += Math.cos(o.heading) * o.speed * moveTs * dt;
    o.y += Math.sin(o.heading) * o.speed * moveTs * dt;
    if (dist(o.x, o.y, s.x, s.y) < s.r + hazardHitRadius(o) - 2) { o.dead = true; hurt(); }
  }
  // 20 matches the existing totalAge>=20 forceOut threshold above (already
  // this hazard's own "nothing should linger forever" ceiling) — Normal
  // gets the usual 25% cut off that (15s), Hard is untouched.
  battle.hourglassOrbs = battle.hourglassOrbs.filter(o => !o.dead && !hazardExpired(o.ageExpireT) &&
    o.x > b.x - 60 && o.x < b.x + b.w + 60 && o.y > b.y - 60 && o.y < b.y + b.h + 60);
}
// No spears, no shield — the Hourglass leans entirely on position dodging
// now (moveSoulFree), so its identity is purely "sand grains + drifting
// orbs, paced by the slow/fast phase," not another shield-read boss. Both
// hazards' cadence scales inversely with timeScale on top of running much
// more often than before, to actually fill the room the spears left behind.
function updateHourglass(dt, hard = false) {
  moveSoulFree(dt, hard ? 220 : 200);
  // Starts fast now (was slow) — the alternation below still just flips
  // slow/fast each time, so this makes the opening sequence read fast, slow,
  // fast, slow... instead of slow, fast, slow, fast...
  if (!battle.sandPhase) beginSandPhase(hard, 'fast');

  battle.sandTimer -= dt;
  if (battle.sandTimer <= 0) beginSandPhase(hard, battle.sandPhase === 'slow' ? 'fast' : 'slow');

  battle.sandGrainTimer -= dt;
  if (battle.sandGrainTimer <= 0) { spawnSandGrain(hard); battle.sandGrainTimer = (hard ? .22 : .3) / 1.1 / battle.timeScale; } // 10% more often
  updateSandGrains(dt);

  battle.hourglassOrbTimer -= dt;
  if (battle.hourglassOrbTimer <= 0) {
    spawnHourglassOrb(hard);
    // A second (and, on hard, sometimes a third) orb spawns alongside the
    // first — chances (and the base interval below) both cut by 25% from
    // where they were, to bring the overall spawn volume down to match the
    // bigger orbs above.
    if (Math.random() < (hard ? .49 : .3)) spawnHourglassOrb(hard);
    if (hard && Math.random() < .225) spawnHourglassOrb(hard);
    battle.hourglassOrbTimer = (hard ? rand(1.0, 1.44) : rand(1.31, 1.81)) / battle.timeScale;
    // Fast phase's own high timeScale already made this interval short (more
    // orbs); doubling it back out here halves the overall spawn volume
    // specifically during fast, without touching the slow phase's cadence.
    if (battle.sandPhase === 'fast') battle.hourglassOrbTimer *= 2;
  }
  updateHourglassOrbs(dt);
}

// ---- THE VERDICT — Judgment. Ring/gap rotating-dodge (the mechanic that
// used to belong to the Hourglass, reskinned — see the plan notes on why: a
// closing ring reads as a verdict/encirclement, not a countdown). ----
// Hard's cycle was keyed off battle.t directly — the whole fight's own
// continuous clock. That's fine for the standalone trial (battle.t starts
// at 0 there anyway), but Erif's Reprise segment starts at whatever
// battle.t happens to be once every earlier segment has run, i.e. a
// essentially random point in the 7s cycle — so the Verdict segment could
// begin already 5-6s into a cycle, run "normal" rings for only 1-2s, then
// abruptly flip to the burst phase, reading as a broken quick-cut rather
// than a real first phase. battle.phaseStartT (set fresh the instant this
// segment begins — see bumpErifPhase) offsets it back to 0 there; it's
// always 0 itself for the standalone trial, so battle.t - phaseStartT is
// just battle.t again there, unchanged.
// The cycle length itself also now matches whatever this Verdict instance's
// own total run actually is: 7s for the standalone trial (unchanged), but
// Erif's Reprise segment reads its own dynamically-computed window
// (battle.repriseVerdictDuration, set the instant the segment begins — see
// erif.js's REPRISE_TARGET_DURATION catch-up) instead of a flat number, so
// that segment's own length can vary run to run to land the whole Reprise on
// target. At a mismatched fixed cycle, a longer segment would run
// normal -> burst -> normal again for a stray tail before getting cut off,
// instead of one clean normal-then-burst split. Matching the cycle to
// whatever the segment's real length actually is keeps that one clean
// transition, halfway through, every time regardless of how long it runs.
function verdictPhaseProgress(hard = false) {
  if (!hard) return battle.t / battle.duration;
  const cycle = battle.type === 'erif' ? (battle.repriseVerdictDuration ?? 10) : 7;
  return ((battle.t - battle.phaseStartT) % cycle) / cycle;
}
// The Reckoning's own ward (js/erif.js ~1655-1657) calls spawnVerdictRing/
// CloseBurst/SpacedBurst directly, always passing a real `origin` point —
// updateVerdict's own calls (normal/hard/reprise fight alike) never pass
// one. That presence/absence is used below as the switch between "the
// regular Verdict fight" (original tuning) and "the Reckoning's ward"
// (today's own tuning, kept as-is per its own design) — battle.type alone
// can't tell those apart, since Reprise and the Reckoning are both
// battle.type 'erif'.
const VERDICT_RING_SPEED = { hard: 138.75, normal: 108.75 }; // Reckoning-only
function spawnVerdictRing(hard = false, origin = null) {
  // Align with whatever ring is already innermost/most recent (which could
  // be a leftover rotating/burst ring right after that phase just ended,
  // not just another normal ring) instead of rolling a fully independent
  // random gap — same reasoning as beginVerdictSpiral's own alignment below,
  // just for the reverse direction: without it, the first normal ring after
  // a burst period could easily land with no shared safe window against
  // whatever burst ring is still mid-flight.
  const lastRing = battle.rings[battle.rings.length - 1];
  const gapA = lastRing ? lastRing.gapA : rand(0, Math.PI * 2);
  const opening = hard ? .36 : .52;
  // Doubling the opening on this one ring (a previous attempt at this fix)
  // didn't actually address the real problem and made the transition worse:
  // normal rings drift at a fixed 1.2/.85 rad/s, while leftover burst rings
  // drift much slower (~.05/.035 rad/s) — so even with the gap aligned at
  // the moment of this spawn, the two immediately race apart again within a
  // fraction of a second, opening a *second*, unrelated gap. With enough
  // rings alive at once that can leave no angle safe against all of them
  // simultaneously — which reads as "impossible to dodge," regardless of
  // how wide any single ring's own opening is. Matching this ring's drift
  // to the leftover ring's actual current drift (instead of the normal
  // fixed rate) keeps the two moving in lockstep instead of diverging.
  // Randomized per ring now (was a fixed 1.2/.85 for every single one) —
  // with every ring spinning its gap at exactly the same rate, the whole
  // wall of rings behaved like one smooth, predictable rotating tunnel.
  // Varying both speed and direction ring-to-ring means each one actually
  // has to be read on its own, not just followed once.
  let drift = (hard ? 1.2 : .85) * rand(.6, 1.5) * choose([-1, 1]);
  if (battle.verdictJustExitedBurst) {
    if (lastRing) drift = lastRing.drift;
    battle.verdictJustExitedBurst = false;
  }
  const speed = origin ? (hard ? VERDICT_RING_SPEED.hard : VERDICT_RING_SPEED.normal) : (hard ? 185 : 145);
  spawnRing(hard, gapA, 360, drift, speed, opening, 1, origin);
  tone(180, .03, 'sine', .025);
}
// Reckoning-only from here down (spawnVerdictCloseBurst/spawnVerdictSpacedBurst)
// — updateVerdict itself never calls either; both exist solely for the
// Reckoning's own ward (js/erif.js ~1655-1657), which always passes an
// `origin`. "Close" means bunched together in time (all 3 spawned in the
// same instant), not spatially close — a generous 8-way gap count each, but
// landing at independent angles so only the *overlap* of their (much
// narrower, since 8 gaps means 8 walls too) wall segments is the real hazard.
const VERDICT_CLOSE_BURST_GAP = .28; // per-gap half-width at 8 gaps
// Staggered starting radii (336/360/384) rather than all 3 at a flat 360 —
// same speed + same radius meant all 3 rings stayed perfectly concentric
// for their entire lifetime, reading as just one ring with a busier gap
// pattern instead of an actual burst of three. Small enough offsets that
// they still read as one tight cluster ("close"), just now visibly three
// distinct rings closing in together instead of one merged circle.
const VERDICT_CLOSE_BURST_RADII = [336, 360, 384];
function spawnVerdictCloseBurst(hard = false, origin = null) {
  const speed = hard ? VERDICT_RING_SPEED.hard : VERDICT_RING_SPEED.normal;
  for (const r of VERDICT_CLOSE_BURST_RADII) {
    spawnRing(hard, rand(0, Math.PI * 2), r, 0, speed, VERDICT_CLOSE_BURST_GAP, 8, origin);
  }
  tone(200, .05, 'sine', .03);
}
// "Spaced" — 2 rings, 4-way gap count each (fewer, wider gaps than the
// close burst's 8), the 2nd fired a beat after the 1st instead of together,
// so this reads as a distinct one-two rather than a single simultaneous
// wall.
const VERDICT_SPACED_BURST_GAP = .42; // per-gap half-width at 4 gaps — matches the plain ring's own opening closely
const VERDICT_SPACED_BURST_DELAY = .55;
function spawnVerdictSpacedBurst(hard = false, origin = null) {
  const speed = hard ? VERDICT_RING_SPEED.hard : VERDICT_RING_SPEED.normal;
  spawnRing(hard, rand(0, Math.PI * 2), 360, 0, speed, VERDICT_SPACED_BURST_GAP, 4, origin);
  battle.verdictSpacedBurstPending = true;
  battle.verdictSpacedBurstTimer = VERDICT_SPACED_BURST_DELAY;
  // Snapshotted now (not re-read at fire time) so the 2nd ring lands at the
  // same conceptual origin as the 1st — a "spaced" pair offset in time, not
  // in space.
  battle.verdictSpacedBurstOrigin = origin;
  tone(200, .05, 'sine', .03);
}
function beginVerdictSpiral(hard = false) {
  battle.ringArcMode = true;
  // Carrying leftover regular rings into the burst phase (rather than force-
  // clearing) turned out to make things worse, not better: the burst phase
  // spawns a fresh ring every .085-.16s (spawnVerdictContinuousRing), so
  // within a couple seconds ~15-20 of them are alive at once, densely
  // packed. That's fine on its own — they all share the same slowly-rotating
  // gapA, forming one continuous spiral corridor — but a leftover regular
  // ring drifts at a completely different, much faster fixed rate, so it
  // immediately races out of alignment and closes off whatever gap the
  // dense spiral still has, with nowhere left safe against both at once.
  // Back to a hard clear here; the gap angle itself still carries over
  // (grabbed before clearing) so the spiral at least starts where the last
  // regular ring's own gap was.
  const lastRegular = battle.rings[battle.rings.length - 1];
  battle.ringGapA = lastRegular ? lastRegular.gapA : rand(0, Math.PI * 2);
  battle.rings = [];
  battle.ringArcDirection = choose([-1, 1]);
  battle.ringSwitchTimer = hard ? rand(2.2, 3.2) : rand(3.2, 4.6);
  // The very first burst ring used to spawn alone at a much closer radius
  // (180, pulled in from the usual full 360) to avoid a dead "waiting" gap
  // right at the transition — but that just moved the gap a beat later: one
  // near ring popped in, shrank away fast, and then every ring after it was
  // back to spawning all the way out at 360 with nothing in between. Now
  // spawnVerdictContinuousRing itself ramps the first RING_ENTRY_RAMP_COUNT
  // rings' spawn radius from that same close-in 180 up to the full 360 (see
  // battle.ringArcRingCount below), so the spiral corridor actually fills in
  // smoothly instead of jumping from one lone near ring straight to far ones.
  battle.ringArcRingCount = 0;
  spawnVerdictContinuousRing(hard);
  battle.spawn = hard ? .10 : .13; // this phase's normal opening cadence (phase=0), so the next ring lands on schedule
  tone(hard ? 235 : 210, .10, 'triangle', .035);
}
const RING_ENTRY_RAMP_COUNT = 6; // how many burst rings it takes to ramp from the close-in entry radius up to the usual full one
function spawnVerdictContinuousRing(hard = false) {
  const phase = clamp((verdictPhaseProgress(hard) - .5) / .5, 0, 1);
  if (battle.ringGapA == null) battle.ringGapA = rand(0, Math.PI * 2);
  const step = lerp(hard ? .125 : .11, hard ? .16 : .145, phase);
  battle.ringGapA += battle.ringArcDirection * step;
  const tinyWobble = Math.sin(battle.t * (hard ? 2.3 : 1.8)) * .012;
  const rampT = clamp((battle.ringArcRingCount || 0) / RING_ENTRY_RAMP_COUNT, 0, 1);
  const startRadius = lerp(180, 360, rampT);
  battle.ringArcRingCount = (battle.ringArcRingCount || 0) + 1;
  spawnRing(hard, battle.ringGapA + tinyWobble, startRadius, battle.ringArcDirection * (hard ? .05 : .04), hard ? 205 : 188, hard ? .37 : .44);
}
// moveFn lets a caller swap in moveSoulWithShield instead of the standalone
// trial's own moveSoulFree — Erif's Reprise segment (see erif.js) needs the
// shield controllable here too, since arrow keys should only ever be the
// shield during the whole Erif fight, never movement.
function updateVerdict(dt, hard = false, moveFn = moveSoulFree) {
  moveFn(dt, hard ? 225 : 210);
  const rotating = verdictPhaseProgress(hard) >= .5;

  if (rotating && !battle.ringArcMode) beginVerdictSpiral(hard);
  // Reset the instant rotating ends, not left stale — verdictPhaseProgress's
  // modulo cycle can flip back and forth more than once within a single
  // fight (or even a single Reprise segment, depending on where its own
  // start lands in the cycle), and without this, only the very first entry
  // into rotating mode ever got beginVerdictSpiral's gap-alignment fix —
  // every later re-entry silently skipped it, back to an unaligned random
  // gap.
  if (!rotating) {
    // Catches the exact frame rotating flips off — consumed once by the
    // very next spawnVerdictRing call to widen that one transition ring's
    // opening (see spawnVerdictRing).
    if (battle.ringArcMode) battle.verdictJustExitedBurst = true;
    battle.ringArcMode = false;
  }
  if (rotating) {
    battle.ringSwitchTimer -= dt;
    if (battle.ringSwitchTimer <= 0) {
      battle.ringArcDirection *= -1;
      const drift = hard ? .05 : .035;
      for (const r of battle.rings) r.drift = battle.ringArcDirection * drift;
      battle.ringSwitchTimer = hard ? rand(2.1, 3.1) : rand(3.0, 4.4);
      tone(255, .07, 'triangle', .028);
    }
  }

  battle.spawn -= dt;
  if (battle.spawn <= 0) {
    if (!rotating) { spawnVerdictRing(hard); battle.spawn = hard ? .62 : .85; }
    else {
      spawnVerdictContinuousRing(hard);
      const phase = clamp((verdictPhaseProgress(hard) - .5) / .5, 0, 1);
      battle.spawn = lerp(hard ? .10 : .13, hard ? .085 : .11, phase);
    }
  }

  updateRingHazards(dt);
}

// ---- THE GALE — Command. Wind reverses which way your flame leans. No
// spears — its own projectile is a slow, gently-homing flag, shield-blocked
// from whichever side it's currently arriving from (recomputed live off its
// curving velocity, not fixed at spawn) rather than a launched wall. A gust
// still inverts your controls and physically pushes you. ----
const GALE_WIND_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// Which shield direction blocks something currently moving this way — you
// shield the side it's arriving FROM, the opposite of its direction of
// travel (same convention spawnSpear's `side` already uses).
function velocityToSide(vx, vy) {
  if (Math.abs(vx) > Math.abs(vy)) return vx > 0 ? 'left' : 'right';
  return vy > 0 ? 'up' : 'down';
}
// A pennant, cast out on the wind and slowly curving toward wherever the
// player currently is — a gentle steer (capped turn rate), not a lock-on, so
// it's a curve to read and cut across rather than an inescapable homing
// missile. Always launched from the current wind's source edge, same as the
// old spear baseline, so reading the wind still tells you where it's coming
// from.
function spawnGaleFlag(hard = false) {
  const b = battle.box, dir = battle.galeWindDir || choose(['up', 'down', 'left', 'right']);
  // 20% further out (26 -> 31.2) — more read time before it's live, no
  // in-box telegraph like this one has.
  let x, y;
  if (dir === 'up') { x = rand(b.x + 20, b.x + b.w - 20); y = b.y - 31.2; }
  else if (dir === 'down') { x = rand(b.x + 20, b.x + b.w - 20); y = b.y + b.h + 31.2; }
  else if (dir === 'left') { x = b.x - 31.2; y = rand(b.y + 20, b.y + b.h - 20); }
  else { x = b.x + b.w + 31.2; y = rand(b.y + 20, b.y + b.h - 20); }
  const speed = (hard ? 76 : 58) * DIFFICULTY.projectileMult;
  const a = Math.atan2(battle.soul.y - y, battle.soul.x - x);
  // r bumped 9 -> 11 — the drawn pole (a straight line from -9 to +9 along
  // the heading, see the flag-drawing loop in render.js) reaches a full 9px
  // from center on its own, but updateGaleFlags' hitRadius subtracts 2 off
  // this r, so the actual hit boundary (was 7) undershot the pole's real
  // visual reach — the stick could visibly poke past the hit radius before
  // it registered.
  battle.galeFlags.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, speed, r: 11, wave: rand(0, Math.PI * 2), ...hazardAgeFields(20) });
  tone(230, .09, 'triangle', .025);
}
function updateGaleFlags(dt) {
  const s = battle.soul, b = battle.box;
  for (const f of battle.galeFlags) {
    f.wave += dt * 3;
    const targetA = Math.atan2(s.y - f.y, s.x - f.x), curA = Math.atan2(f.vy, f.vx);
    const diff = Math.atan2(Math.sin(targetA - curA), Math.cos(targetA - curA));
    const newA = curA + clamp(diff, -1.6 * dt, 1.6 * dt);
    f.vx = Math.cos(newA) * f.speed; f.vy = Math.sin(newA) * f.speed;
    f.x += f.vx * dt + Math.cos(f.wave) * 14 * dt;
    f.y += f.vy * dt + Math.sin(f.wave) * 14 * dt;
    const side = velocityToSide(f.vx, f.vy);
    const hitRadius = s.r + hazardHitRadius(f) - 2, d = dist(f.x, f.y, s.x, s.y);
    if (shieldFacingBlocks(f.x, f.y, side)) {
      const blockRadius = hitRadius + UPGRADE_CATALOG.shield.perStack * (save.upgrades.shield || 0);
      if (d < blockRadius) { f.dead = true; tone(480, .05, 'square', .022); spawnSparks(f.x, f.y, Math.round(4 + f.r * .3), { color: EMBER, speed: [40, 90], life: .3 }); }
    } else if (d < hitRadius) { f.dead = true; hurt(); }
  }
  // 28 is a generous ceiling (homing + a curving wave means there's no
  // closed-form travel time) sized off Enraged's own bigger 680-wide box, so
  // it stays safely above any realistic crossing time in the smaller
  // standard box too.
  battle.galeFlags = battle.galeFlags.filter(f => !f.dead && !hazardExpired(f.ageExpireT) &&
    f.x > b.x - 70 && f.x < b.x + b.w + 70 && f.y > b.y - 70 && f.y < b.y + b.h + 70);
}
// Rows of wind lines sweeping in together from the current wind's source
// edge — a distinct second pressure alongside the homing flags, closer to
// the old spear-wall shape (find the gap or shield the row) but reskinned
// as streaks of wind rather than launched steel. Each carries its own
// countdown before actually crossing the box, same shrinking-telegraph
// convention as everything else in this game.
// allowExtra: rolls a chance to queue 1-3 bonus SMALL waves (1-3 lines each,
// vs. a regular wave's 4-7) from a different side, each arriving further
// spaced out from the last (see updateWindLines, which ticks the queue) —
// centralized here so every caller (the standalone/Reprise fight's own
// cadence, Convergence/Final Convergence's one-shot cue, Enraged's and the
// Reckoning's one-shot gusts) gets the same chance for free, rather than
// needing each call site to remember to roll it separately. Extras spawn
// with allowExtra=false so one bonus wave can't itself chain into more, and
// a new roll only happens once any previous batch has fully finished (queue
// back at 0) — without that guard, a fresh main-cadence roll landing
// mid-batch could effectively stack past 3.
// small: this row is a small wave (1-3 lines) instead of a regular one (4-7)
// — set true for extras, left false for the regular cadence.
function spawnWindRow(hard = false, dirOverride = null, allowExtra = true, small = false) {
  // A hard global floor: no two wind-row spawns, from ANY source (main
  // cadence, a queued extra, a gust-synced one-shot), can land within 1s of
  // each other — without this, an extra's own spacing could still coincide
  // with an unrelated fresh spawn and dump two full rows on the player at
  // once.
  if (battle.t - (battle.windRowLastSpawnT ?? -999) < 1) return;
  battle.windRowLastSpawnT = battle.t;
  const b = battle.box, dir = dirOverride || battle.galeWindDir || choose(['up', 'down', 'left', 'right']);
  const axisLen = (dir === 'up' || dir === 'down') ? b.w : b.h;
  // Varies row to row now (was a fixed 5, or 6 on hard) — a regular wave is
  // 4/5/6 normally, 5/6/7 on hard, so it isn't always the same width to read
  // at a glance; a small wave is always just 1/2/3.
  const count = small ? choose([1, 2, 3]) : choose(hard ? [5, 6, 7] : [4, 5, 6]);
  const spacing = axisLen / (count + 1);
  // 25% slower (300/245 -> 225/183.75).
  const speed = (hard ? 300 : 245) * .75 * DIFFICULTY.projectileMult;
  const warnT = (hard ? .5 : .75) * DIFFICULTY.telegraphMult;
  for (let i = 1; i <= count; i++) {
    battle.windLines.push({
      dir, pos: spacing * i, t: warnT, maxT: warnT, fired: false, travel: 0, speed, ageExpireT: Infinity, ageShrinkWindow: 0,
      // A wave, not a straight spear reskin — each line weaves side to side
      // as it crosses, with its own phase/amplitude so a whole row doesn't
      // wiggle in perfect unison.
      wavePhase: rand(0, Math.PI * 2), waveAmp: rand(10, 17),
    });
  }
  tone(210, .08, 'sine', .025);
  // Chance raised well up (was .4/.3) so the "different side" pressure
  // reliably shows up rather than being a coin flip that could just never
  // land in a short window. On its own that made a new batch re-roll again
  // almost immediately every time the last one finished, reading as a
  // constant stream instead of an occasional 1-3-row burst — so a real
  // batch-to-batch cooldown (windRowExtraCooldown, set once a batch fully
  // drains — see updateWindLines) is what actually caps how often a new
  // batch can start at all; this chance and the 1s global floor only govern
  // whether one starts once that cooldown's clear.
  if (allowExtra && battle.windRowExtraQueue <= 0 && battle.windRowExtraCooldown <= 0 && Math.random() < (hard ? .8 : .7)) {
    battle.windRowExtraHard = hard;
    battle.windRowExtraDir = dir;
    battle.windRowExtraQueue = Math.floor(rand(1, 4));
    battle.windRowExtraTimer = rand(1, 1.5);
  }
}
// travelOverride lets the renderer sample earlier points along the same
// wave (see render.js) to draw a real curving trail instead of a straight
// segment behind the current position.
function windLineXY(w, b, travelOverride) {
  const travel = travelOverride ?? w.travel;
  const wig = Math.sin(travel * .05 + w.wavePhase) * w.waveAmp;
  // 20% further out (20 -> 24) — same reasoning as the other edge-spawns.
  if (w.dir === 'up') return { x: b.x + w.pos + wig, y: b.y - 24 + travel };
  if (w.dir === 'down') return { x: b.x + w.pos + wig, y: b.y + b.h + 24 - travel };
  if (w.dir === 'left') return { x: b.x - 24 + travel, y: b.y + w.pos + wig };
  return { x: b.x + b.w + 24 - travel, y: b.y + w.pos + wig };
}
function updateWindLines(dt) {
  const b = battle.box, s = battle.soul;
  // Ticks any bonus rows queued up by spawnWindRow's own chance roll — lives
  // here (not in updateGale) so it's active in every context that ever
  // calls spawnWindRow, not just the standalone/Reprise fight's own loop.
  battle.windRowExtraCooldown = Math.max(0, battle.windRowExtraCooldown - dt);
  if (battle.windRowExtraQueue > 0) {
    battle.windRowExtraTimer -= dt;
    if (battle.windRowExtraTimer <= 0) {
      const otherDirs = ['up', 'down', 'left', 'right'].filter(d => d !== battle.windRowExtraDir);
      const before = battle.windRowLastSpawnT;
      spawnWindRow(battle.windRowExtraHard, choose(otherDirs), false, true); // small wave (1-3), different side
      if (battle.windRowLastSpawnT !== before) {
        // Actually spawned.
        battle.windRowExtraQueue--;
        battle.windRowExtraTimer = rand(3, 4.5);
        // The batch just fully finished — lock out a new roll for a while
        // so the next one reads as its own distinct burst later, not an
        // immediate back-to-back restart.
        if (battle.windRowExtraQueue <= 0) battle.windRowExtraCooldown = rand(6, 10);
      } else {
        // Blocked by spawnWindRow's own 1s global floor (an unrelated main-
        // cadence row landed too recently) — without this branch, the queue
        // still decremented here regardless, silently burning through the
        // whole 1-3 batch without ever actually spawning any of it. Retry
        // shortly instead of losing it.
        battle.windRowExtraTimer = 1.1;
      }
    }
  }
  for (const w of battle.windLines) {
    if (!w.fired) {
      w.t -= dt;
      if (w.t > 0) continue;
      w.fired = true; Object.assign(w, hazardAgeFields(10)); // falls through so it also gets a position + hit-test this same frame
    }
    w.travel += w.speed * dt;
    const p = windLineXY(w, b);
    w.x = p.x; w.y = p.y;
    const hitRadius = s.r + 7;
    // Checked along the whole visible trail now, not just the current
    // leading tip — render.js draws this as a real curving streak sampled
    // back to travel-42 (see its own k=0..42 step-7 loop), but collision was
    // only ever testing the single point at travel-0, so standing anywhere
    // along the rest of the visible line was completely safe.
    let d = Infinity, hx = p.x, hy = p.y;
    for (let k = 0; k <= 42; k += 7) {
      const tp = windLineXY(w, b, Math.max(0, w.travel - k));
      const td = dist(tp.x, tp.y, s.x, s.y);
      if (td < d) { d = td; hx = tp.x; hy = tp.y; }
    }
    if (shieldFacingBlocks(hx, hy, w.dir)) {
      const blockRadius = hitRadius + UPGRADE_CATALOG.shield.perStack * (save.upgrades.shield || 0);
      if (d < blockRadius) { w.dead = true; tone(480, .05, 'square', .022); spawnSparks(hx, hy, 4, { color: EMBER, speed: [40, 90], life: .25 }); }
    } else if (d < hitRadius) { w.dead = true; hurt(); }
  }
  // 10 sized off the biggest arena a wind row can appear in (the Reckoning's
  // 910-wide box), measured from when it actually fires (the pre-fire
  // telegraph wait isn't a lingering-clutter concern, only the post-fire
  // travel is).
  battle.windLines = battle.windLines.filter(w => !w.dead &&
    (!w.fired || (!hazardExpired(w.ageExpireT) && w.x > b.x - 90 && w.x < b.x + b.w + 90 && w.y > b.y - 90 && w.y < b.y + b.h + 90)));
}
function beginGaleGust(hard) {
  battle.galeWindDir = choose(['up', 'down', 'left', 'right']);
  battle.galeGustPhase = 'telegraph';
  const warnT = (hard ? 1.0 : 1.3) * DIFFICULTY.telegraphMult;
  battle.galeGustTimer = warnT; battle.galeGustMax = warnT;
  battle.galeGustWindRowSynced = false;
  tone(200, .12, 'sine', .03);
}
// Spawns a gust-tied wind row partway through the telegraph rather than at
// launch, timed so the row's OWN warning telegraph finishes right as the
// gust actually goes active — the row's sweep then lands while
// controlsInverted is true instead of trailing in after the fact, so the
// wind pressures the player exactly when they're already fighting inverted
// controls. Fires once per gust (galeGustWindRowSynced, reset in
// beginGaleGust above).
function tickGaleWindRowSync(hard) {
  if (battle.galeGustPhase !== 'telegraph' || battle.galeGustWindRowSynced) return;
  const windRowWarnT = (hard ? .5 : .75) * DIFFICULTY.telegraphMult;
  if (battle.galeGustTimer <= windRowWarnT) { spawnWindRow(hard); battle.galeGustWindRowSynced = true; }
}
function launchGaleGust(hard) {
  battle.galeGustPhase = 'active';
  // Cut 20% (1.6/1.3 -> 1.28/1.04) — this is also how long controlsInverted
  // stays true, and it's the one shared function every gust everywhere
  // (standalone, Reprise, Enraged, Final Convergence, the Reckoning)
  // funnels through, so the cut applies uniformly everywhere.
  const dur = (hard ? 1.6 : 1.3) * .8;
  battle.galeGustTimer = dur; battle.galeGustMax = dur;
  battle.controlsInverted = true;
  // Push halved (was hard?165:130) — the control inversion alone is
  // punishing enough; stacking a strong involuntary shove on top of it left
  // almost no way to fight back toward where you meant to go.
  const push = (hard ? 82.5 : 65) * DIFFICULTY.projectileMult, vec = GALE_WIND_VEC[battle.galeWindDir];
  battle.windVX = vec[0] * push; battle.windVY = vec[1] * push;
  // The gust itself carries a burst of flags in on landing — the same
  // "the wind actually delivers something" beat the old spear volley had.
  spawnGaleFlag(hard);
  if (hard) spawnGaleFlag(hard);
  tone(120, .22, 'sawtooth', .045);
}
function endGaleGust(hard) {
  battle.galeGustPhase = null;
  battle.controlsInverted = false;
  battle.windVX = 0; battle.windVY = 0;
  battle.galeGustCooldown = hard ? rand(1.5, 2.5) : rand(2.5, 4);
}
function updateGale(dt, hard = false) {
  moveSoulWithShield(dt, hard ? 205 : 190);
  if (!battle.galeWindDir) beginGaleGust(hard); // first call also picks the initial wind direction

  if (battle.galeGustPhase === 'active') {
    const b = battle.box, s = battle.soul;
    s.x = clamp(s.x + battle.windVX * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = clamp(s.y + battle.windVY * dt, b.y + s.r, b.y + b.h - soulVisualBottomMargin());
  }

  if (!battle.galeGustPhase) {
    battle.galeGustCooldown -= dt;
    if (battle.galeGustCooldown <= 0) beginGaleGust(hard);
  } else {
    battle.galeGustTimer -= dt;
    if (battle.galeGustPhase === 'telegraph' && battle.galeGustTimer <= 0) launchGaleGust(hard);
    else if (battle.galeGustPhase === 'active' && battle.galeGustTimer <= 0) endGaleGust(hard);
  }

  battle.galeFlagTimer -= dt;
  if (battle.galeFlagTimer <= 0) {
    spawnGaleFlag(hard);
    if (hard && Math.random() < .3) spawnGaleFlag(hard);
    battle.galeFlagTimer = hard ? rand(1.5, 2.1) : rand(1.9, 2.6);
    // Same anti-stacking guard used elsewhere this session — keeps a wind
    // row from also landing right on top of a flag spawn.
    battle.windRowTimer = Math.max(battle.windRowTimer, .5);
  }
  updateGaleFlags(dt);

  battle.windRowTimer -= dt;
  if (battle.windRowTimer <= 0) {
    spawnWindRow(hard);
    battle.windRowTimer = hard ? rand(2.6, 3.4) : rand(3.2, 4.2);
    battle.galeFlagTimer = Math.max(battle.galeFlagTimer, .5);
  }
  updateWindLines(dt);
}

// A rotating cast of the bigger, less basic spear patterns (see hazards.js),
// layered on top of the boss's regular volley/needle cadence on their own
// timer — shared by the Executioner and the Mask below. Split into two
// groups: the gapped ones are dodged by finding the safe gap in the wall
// (no shield read needed), so they're fine landing right on top of the
// regular cadence even doubled up; the dense ones demand an actual shield
// read across the whole box, so triggerSpearSpecial gives those a little
// breathing room from the regular volley/needle timers instead of letting
// everything pile up into an unreadable wall at once.
const SPEAR_GAPPED_PATTERNS = [spawnSpearBurst3, spawnSpearBurst5, spawnSpearBurst7, spawnSpearGappedCross, spawnSpearGappedPincer];
const SPEAR_DENSE_PATTERNS = [spawnSpearCrossNeedles, spawnSpearPincer, spawnSpearSweep];
const SPEAR_SPECIAL_PATTERNS = [...SPEAR_GAPPED_PATTERNS, ...SPEAR_DENSE_PATTERNS];
// Weighted toward the gapped (spaced 3/5/7) patterns — they're the fairer,
// find-the-gap reads — and never twice in a row: a dense pick (the tightly
// clustered cross-needles, or the "every side at once" sweep) always forces
// a gapped one next, so two of the heaviest patterns can no longer land
// back-to-back the way an unweighted random pick occasionally allowed.
const SPEAR_SPECIAL_GAPPED_CHANCE = .72;
function triggerSpearSpecial(hard) {
  const useGapped = battle.lastSpearSpecialDense || Math.random() < SPEAR_SPECIAL_GAPPED_CHANCE;
  const pattern = choose(useGapped ? SPEAR_GAPPED_PATTERNS : SPEAR_DENSE_PATTERNS);
  pattern(hard);
  battle.lastSpearSpecialDense = SPEAR_DENSE_PATTERNS.includes(pattern);
  if (battle.lastSpearSpecialDense) {
    battle.spawn = Math.max(battle.spawn, hard ? .9 : 1.1);
    battle.needleTimer = Math.max(battle.needleTimer, hard ? .7 : .9);
  }
}

// ---- THE EXECUTIONER — Force. Shield-direction + spear walls. ----
function updateExecutioner(dt, hard = false) {
  moveSoulWithShield(dt, hard ? 210 : 190);
  battle.spawn -= dt;
  battle.needleTimer -= dt;
  battle.specialTimer -= dt;
  if (battle.spawn <= 0) {
    const first = choose(['up', 'down', 'left', 'right']);
    // Spaced barrages (find-the-gap, no shield read needed) are now the
    // common case for this base cadence too, not just the special layer
    // below — a full solid wall was firing on literally every cycle before,
    // which is what actually read as "overwhelmed by full rows," regardless
    // of how gap-biased triggerSpearSpecial already was. Decided once and
    // applied to both the first wall and (on hard) the second, so a cycle
    // reads as one consistent barrage instead of an odd solid+gapped mix.
    const useGapped = Math.random() < .65;
    if (useGapped) spawnSpearGappedWall(hard, choose([5, 7]), first);
    else spawnSpearVolley(hard, first);
    if (hard && Math.random() < .42) {
      const next = choose(['up', 'down', 'left', 'right'].filter(x => x !== first));
      if (useGapped) spawnSpearGappedWall(hard, choose([5, 7]), next, .58);
      else spawnSpearVolley(hard, next, .58);
    }
    // Widened from 1.85/2.3 — the full-wall volley (and the tightly-packed
    // needle burst below) were crowding out the spaced 3/5/7 gapped patterns
    // that specialTimer hands out; see triggerSpearSpecial's gapped-bias too.
    battle.spawn = (hard ? 2.5 : 3.1) / 1.2; // 20% more spears
    // The actual fix for "everything lands at once": each cadence is fine on
    // its own, but two independent timers can drift into phase and briefly
    // pile a volley and a needle burst right on top of each other. A minimum
    // gap after either fires keeps the other from following immediately.
    battle.needleTimer = Math.max(battle.needleTimer, .5);
  }
  if (battle.needleTimer <= 0) {
    spawnSpearNeedles(hard);
    battle.needleTimer = (hard ? 1.6 : 2.0) / 1.2; // widened from 1.15/1.42, then 20% more spears on top
    battle.spawn = Math.max(battle.spawn, .5);
  }
  if (battle.specialTimer <= 0) {
    triggerSpearSpecial(hard);
    battle.specialTimer = (hard ? rand(1.9, 2.6) : rand(2.3, 3.1)) / 1.2; // tightened so the spaced patterns show up more often, then 20% more spears on top
  }
  updateSpearHazards(dt);
}

// ---- THE WITNESS — Testimony. Safe-shape matching amid a barrage. ----
function startShapePattern(hard = false) {
  const b = battle.box, types = shuffleArray(['circle', 'triangle', 'square']);
  // Widened slightly (.27/.73 -> .24/.76) — a little more horizontal
  // breathing room between the three zones, for both the standalone fight
  // and Erif's Reprise segment alike.
  const spots = [
    { x: b.x + b.w * .24, y: b.y + b.h * .65 },
    { x: b.x + b.w * .50, y: b.y + b.h * .36 },
    { x: b.x + b.w * .76, y: b.y + b.h * .65 },
  ];
  const oldCue = battle.shapeCue;
  // Shrunk from the original 58/69 — at that size, adjacent zones (spaced
  // ~115px apart) could overlap by as much as 15px. Erif's fight specifically
  // gets these 25% bigger (still comfortably under the overlap threshold
  // even with the wider spacing above) — everywhere else unchanged.
  const erifBoost = battle.type === 'erif' ? 1.25 : 1;
  battle.shapeZones = types.map((type, i) => ({ type, x: spots[i].x, y: spots[i].y, size: (hard ? 40 : 46) * erifBoost }));
  battle.shapeCue = choose(types.filter(t => t !== oldCue));
  battle.shapeState = 'barrage';
  // Erif's Reprise segment isn't on a flat timer like most others — it runs
  // until 2 full barrage/seek/judgment cycles complete (see
  // updateRepriseWitness), so there's no single duration constant to bump.
  // +.75s to the barrage phase here, twice over across those 2 cycles, adds
  // 1.5s to the segment overall instead. Standalone fight unaffected.
  battle.shapeTimer = (hard ? 1.35 : 1.62) + (battle.type === 'erif' ? .75 : 0);
  battle.spawn = hard ? .12 : .16;

  const unsafe = battle.shapeZones.filter(z => z.type !== battle.shapeCue);
  // Hand anchors pushed 20% further out too (38/28/32/30/25 -> 45.6/33.6/
  // 38.4/36/30) — shards are thrown from these, so more distance out here
  // is more travel time (and read time) before one actually reaches you.
  const anchors = [
    [b.x + 45.6, b.y - 33.6], [b.x + b.w * .37, b.y - 38.4], [b.x + b.w * .63, b.y - 38.4], [b.x + b.w - 45.6, b.y - 33.6],
    [b.x - 36, b.y + b.h * .52], [b.x + b.w + 36, b.y + b.h * .52],
  ];
  if (hard) { anchors.push([b.x - 30, b.y + b.h * .82], [b.x + b.w + 30, b.y + b.h * .82]); }

  if (!battle.hands.length) {
    battle.hands = anchors.map((a, i) => { const z = unsafe[i % unsafe.length]; return makeHand(a[0], a[1], z.x, z.y); });
  } else {
    battle.hands.forEach((h, i) => { const z = unsafe[i % unsafe.length]; h.tx = z.x; h.ty = z.y; });
  }
  tone(180, .12, 'triangle', .03);
}
function spawnShapeShard(hard = false, seek = false) {
  const hand = choose(battle.hands);
  const unsafe = battle.shapeZones.filter(z => z.type !== battle.shapeCue);
  let tx, ty;
  if (seek) {
    const target = choose(unsafe);
    tx = target.x + rand(-target.size * .45, target.size * .45);
    ty = target.y + rand(-target.size * .45, target.size * .45);
  } else if (Math.random() < .58) {
    tx = battle.soul.x + rand(-35, 35);
    ty = battle.soul.y + rand(-35, 35);
  } else {
    const target = choose(unsafe);
    tx = target.x; ty = target.y;
  }
  const a = Math.atan2(ty - hand.y, tx - hand.x) + rand(hard ? -.14 : -.20, hard ? .14 : .20);
  const speed = (hard ? (seek ? 205 : 235) : (seek ? 155 : 185)) * DIFFICULTY.projectileMult;
  // life was 2.6/3.0 — far too short against this box's real diagonal
  // (500x270 arena + the ±90 despawn margin, ~815px corner-to-corner) at
  // Normal-tier speed (DIFFICULTY.projectileMult=.5): the standalone trial's
  // own slowest case (hard=false, seek, 155*.5=77.5px/s) only covered ~230px
  // in 3.0s, and Reprise's (hard=true, seek, 205*.5=102.5px/s) only ~267px in
  // 2.6s — both dying to the timer long before reaching the wall, reading as
  // "vanishing early." Resized so each branch's own worst case clears the
  // full diagonal with room to spare.
  battle.shapes.push({ type: choose(['circle', 'triangle', 'square']), x: hand.x, y: hand.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: hard ? 8 : 7, spin: rand(-4, 4), a: 0, life: hard ? 10 : 13 });
}
// moveFn lets a caller swap in moveSoulWithShield instead of the standalone
// trial's own moveSoulFree — see updateVerdict's note above; Erif's Reprise
// (updateRepriseWitness, erif.js) needs the same treatment.
function updateWitness(dt, hard = false, moveFn = moveSoulFree) {
  moveFn(dt, hard ? 240 : 225);
  if (!battle.shapeState) startShapePattern(hard);
  battle.shapeTimer -= dt;
  battle.spawn -= dt;

  if (battle.shapeState === 'barrage') {
    if (battle.spawn <= 0) { spawnShapeShard(hard, false); battle.spawn = hard ? .12 : .16; }
    if (battle.shapeTimer <= 0) {
      battle.shapeState = 'seek';
      battle.shapeTimer = hard ? 1.32 : 1.72;
      battle.seekMax = battle.shapeTimer; // lets render.js ramp the safe-shape flash speed as this counts down
      battle.spawn = hard ? .22 : .28;
      tone(330, .09, 'triangle', .025);
    }
  } else if (battle.shapeState === 'seek') {
    if (battle.spawn <= 0) { spawnShapeShard(hard, true); battle.spawn = hard ? .22 : .28; }
    if (battle.shapeTimer <= 0) {
      const safe = battle.shapeZones.find(z => z.type === battle.shapeCue);
      if (!insideShape(battle.soul, safe)) hurt();
      battle.shapeState = 'judgment'; battle.shapeTimer = (hard ? .46 : .58) * DIFFICULTY.telegraphMult;
      // Snapshot the 2 wrong zones for the judgment slam animation (render.js)
      // — a fixed target list so the swinging hands don't jitter if shapeZones
      // ever gets touched mid-animation.
      battle.judgmentMax = battle.shapeTimer;
      battle.slamTargets = battle.shapeZones.filter(z => z.type !== battle.shapeCue).map(z => ({ x: z.x, y: z.y }));
      battle.slamImpacted = false;
      tone(72, .18, 'sawtooth', .055);
    }
  } else if (battle.shapeState === 'judgment') {
    // The slam hands "land" partway through the window (see render.js's drop
    // easing — same .55 fraction) — spark burst + thump right at contact.
    if (!battle.slamImpacted && 1 - battle.shapeTimer / battle.judgmentMax >= .55) {
      battle.slamImpacted = true;
      for (const t of battle.slamTargets) spawnSparks(t.x, t.y, 6, { speed: [70, 150], life: .3 });
      tone(60, .12, 'square', .05);
    }
    if (battle.shapeTimer <= 0) startShapePattern(hard);
  }

  updateShapeHazards(dt);
}

// ---- THE ORACLE — Judgment. Riddle quiz + answer-lane lasers. ----
function updateOracle(dt, hard = false) {
  moveSoulFree(dt, hard ? 240 : 220);
  if (!battle.q) newQuestion(hard);
  battle.qTimer -= dt;
  updateLaneLasers(dt, hard);

  battle.spawn -= dt;
  if (battle.spawn <= 0) {
    const b = battle.box;
    const x = rand(b.x + 10, b.x + b.w - 10);
    // 20% further out (8 -> 9.6) — no telegraph before it's live.
    battle.bullets.push({ x, y: b.y - 9.6, vx: (hard ? rand(-55, 55) : rand(-18, 18)) * DIFFICULTY.projectileMult, vy: (hard ? 275 : 215) * DIFFICULTY.projectileMult, r: 5, ...hazardAgeFields(3) });
    battle.spawn = hard ? .1583 : .2583; // 20% more often (was .19/.31)
  }
  for (const p of battle.bullets) { p.x += p.vx * dt; p.y += p.vy * dt; if (circleHit(p, hazardHitRadius(p))) hurt(); }
  battle.bullets = battle.bullets.filter(p => p.y < battle.box.y + battle.box.h + 20 && !hazardExpired(p.ageExpireT));
}

// ---- THE ARCHIVIST — Memory. Simon-Says sigil sequence. ----
// Reuses layoutSigils/insideSigil from hazards.js — the same helpers Erif's
// Convergence phases lean on later.
const ECHO_SYMBOLS = ['circle', 'square', 'triangle', 'diamond', 'cross'];
// layoutSigils' own default sigil radius (29) was too tight a touch target —
// standing what visually looked like right on top of a circle sometimes
// still didn't register. Bumped out to 30, which insideSigil's
// soul.r + sig.r - 4 check reads directly as a wider tolerance margin.
const ECHO_SIGIL_RADIUS = 30;
// The trial is won by actually completing this many sequences, not by
// surviving a clock — see updateArchivist's resolve handling. BOSS.archivist's
// `duration` is just a generous safety cap now, same convention as Erif's.
const ARCHIVIST_WIN_ROUNDS = 5;
// Every memory-match round everywhere (standalone Archivist, Erif's Reprise/
// True Final quick-match gate, Enraged's own memory segments) is capped at
// this many seconds from the moment it starts (reveal included) — without
// it a round that's never actually finished (see failEchoRound below) could
// otherwise sit open forever. Running out counts exactly like a wrong touch:
// it fails the round and costs a hit. Back down to 10 (was bumped to 12
// earlier) — the shorter starting sequence below means it isn't needed.
const MEMORY_MATCH_ROUND_TIME = 10;

// lengthOverride lets a caller pin the exact sequence length instead of
// deriving it from battle.echoRound — used by Erif's Reprise segment (see
// updateRepriseArchivist, erif.js), which runs its own fixed 4-then-6 pair
// rather than the standalone trial's ever-climbing progression.
// roundTimeOverride lets a caller give this one round a bigger safety cap
// than MEMORY_MATCH_ROUND_TIME's shared default — used by Enraged's own
// memory segments (see battle.enrageMemoryCap, erif.js) so a careful,
// slower-but-successful player there naturally supplies more of Enraged's
// own pacing budget itself, rather than that slack always landing on the
// math bursts around it. Every other caller is unaffected.
function startEchoRound(hard = false, lengthOverride = null, roundTimeOverride = null) {
  // Always the full 5-symbol set now, matching Erif's own Reprise segment
  // (which always runs startEchoRound with hard=true regardless of the
  // actual difficulty tier) — one more option than Normal used to get here.
  const pool = ECHO_SYMBOLS;
  layoutSigils(pool, 0, battle.box.w * .36, battle.box.h * .30, ECHO_SIGIL_RADIUS);
  const names = battle.sigils.map(s => s.name);
  // Normal's starting length dropped 3 -> 2 (hard's stays at 4), and the
  // round-5 cap dropped 6 -> 5 — Normal now ramps 2,3,4,5,5 instead of
  // topping out a step higher than the round it's actually reached on.
  const length = lengthOverride ?? Math.min((hard ? 4 : 2) + battle.echoRound - 1, hard ? 8 : 5);
  battle.echoSequence = Array.from({ length }, () => choose(names));
  battle.echoStep = 0;
  battle.echoPhase = 'reveal';
  battle.echoRevealTimer = .3;
  battle.echoRevealIndex = 0;
  battle.echoTouchHold = 0;
  battle.echoAwaitingExit = false;
  battle.echoRoundTimer = roundTimeOverride ?? MEMORY_MATCH_ROUND_TIME;
}
function updateEchoReveal(dt, hard) {
  if (updateEchoRoundTimeout(dt)) return;
  battle.echoRevealTimer -= dt;
  if (battle.echoRevealTimer > 0) return;
  if (battle.echoRevealIndex < battle.echoSequence.length) {
    const name = battle.echoSequence[battle.echoRevealIndex];
    const sig = battle.sigils.find(s => s.name === name);
    battle.sigilPulse = { x: sig.x, y: sig.y, t: .59, maxT: .59, name };
    tone(300 + ECHO_SYMBOLS.indexOf(name) * 70, .12, 'triangle', .035);
    battle.echoRevealIndex++;
    battle.echoRevealTimer = hard ? .40 : .52;
  } else {
    battle.echoPhase = 'input';
    battle.echoStep = 0;
    battle.echoTouchHold = 0;
  }
}
function failEchoRound() {
  hurt();
  battle.echoPhase = 'resolve'; battle.echoResolveTimer = .6; battle.echoFail = true;
  tone(80, .2, 'sawtooth', .05);
}
// Shared by updateEchoReveal/updateEchoInput — ticks the per-round safety
// cap and fails the round the instant it runs out. Returns true when it just
// fired, so the caller can bail out of its own frame's logic immediately
// rather than also acting on a phase updateEchoReveal moved into.
function updateEchoRoundTimeout(dt) {
  battle.echoRoundTimer -= dt;
  if (battle.echoRoundTimer <= 0) { failEchoRound(); return true; }
  return false;
}
function updateEchoInput(dt) {
  if (updateEchoRoundTimeout(dt)) return;
  const expected = battle.echoSequence[battle.echoStep];
  const insideAny = battle.sigils.some(s => insideSigil(s));

  // After a correct touch, `expected` immediately advances to the next
  // symbol — but the player is still physically standing in the sigil they
  // just correctly touched, which no longer matches. Without this grace
  // window, that lingering overlap was read as a wrong touch on the very
  // next frame, failing rounds instantly after the first correct step.
  if (battle.echoAwaitingExit) {
    if (!insideAny) battle.echoAwaitingExit = false;
  } else {
    let touchedWrong = false, touchedRight = false;
    for (const sig of battle.sigils) {
      if (insideSigil(sig)) { if (sig.name === expected) touchedRight = true; else touchedWrong = true; }
    }
    if (touchedWrong) { failEchoRound(); return; }
    if (touchedRight) {
      // Registers the instant you're inside the right sigil — no hold delay,
      // same as a wrong touch already failed instantly. Was a .16s hold
      // before landing; that asymmetry (wrong = instant, right = delayed)
      // made a fast correct touch feel like it hadn't registered.
      const sig = battle.sigils.find(s => s.name === expected);
      battle.sigilPulse = { x: sig.x, y: sig.y, t: .55, maxT: .55, name: expected };
      tone(520 + battle.echoStep * 40, .09, 'sine', .035);
      battle.echoStep++;
      if (battle.echoStep >= battle.echoSequence.length) {
        battle.echoPhase = 'resolve'; battle.echoResolveTimer = .6; battle.echoFail = false;
        battle.echoSuccesses++;
        tone(700, .18, 'sine', .04);
      } else {
        battle.echoAwaitingExit = true;
      }
    }
  }
}

// A slow tumbling book, flung loose from the archive — the one hazard that
// runs continuously throughout the whole memory trial (reveal, input, and
// resolve alike), so standing still and disengaging from the sigils is never
// actually safe. There's no round timeout anymore (see updateEchoInput
// above — a round only ever ends by finishing the sequence or touching the
// wrong sigil), so this is what keeps "just wait it out" from being viable.
// Optional `family` tag, same convention as spawnWeavingBook — lets
// Convergence's archivist cue despawn its own batch on capture (see
// clearConvergenceCueHazards, erif.js).
function spawnEchoBook(hard = false, family = null) {
  const b = battle.box, edge = (Math.random() * 4) | 0;
  // 20% further out (16 -> 19.2) — no telegraph before it's live.
  let x, y, tx, ty;
  if (edge === 0) { x = rand(b.x, b.x + b.w); y = b.y - 19.2; tx = rand(b.x, b.x + b.w); ty = b.y + b.h + 19.2; }
  else if (edge === 1) { x = b.x + b.w + 19.2; y = rand(b.y, b.y + b.h); tx = b.x - 19.2; ty = rand(b.y, b.y + b.h); }
  else if (edge === 2) { x = rand(b.x, b.x + b.w); y = b.y + b.h + 19.2; tx = rand(b.x, b.x + b.w); ty = b.y - 19.2; }
  else { x = b.x - 19.2; y = rand(b.y, b.y + b.h); tx = b.x + b.w + 19.2; ty = rand(b.y, b.y + b.h); }
  const speed = (hard ? 68 : 52) * DIFFICULTY.projectileMult;
  const a = Math.atan2(ty - y, tx - x);
  battle.echoBooks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 6, wobble: rand(0, Math.PI * 2), spin: rand(-3, 3), trailT: 0, family, ...hazardAgeFields(20) });
  tone(160, .12, 'sine', .02);
}
function updateEchoBooks(dt) {
  for (const w of battle.echoBooks) {
    w.wobble += dt * 2;
    w.x += w.vx * dt; w.y += (w.vy + Math.sin(w.wobble) * 10) * dt;
    // A dropped page every so often — small squares that drift loose and
    // fade over 2s, left behind as the book tumbles through.
    w.trailT -= dt;
    if (w.trailT <= 0) {
      battle.echoBookTrail.push({ x: w.x, y: w.y, t: 2, vx: rand(-6, 6), vy: rand(-6, 6) });
      w.trailT = .07;
    }
    if (dist(w.x, w.y, battle.soul.x, battle.soul.y) < battle.soul.r + hazardHitRadius(w) - 3) { w.dead = true; hurt(); }
  }
  battle.echoBooks = battle.echoBooks.filter(w => !w.dead && !hazardExpired(w.ageExpireT) &&
    w.x > battle.box.x - 40 && w.x < battle.box.x + battle.box.w + 40 &&
    w.y > battle.box.y - 40 && w.y < battle.box.y + battle.box.h + 40);
  for (const p of battle.echoBookTrail) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  battle.echoBookTrail = battle.echoBookTrail.filter(p => p.t > 0);
}

// A wavier, faster cousin of the tumbling book above — weaves side to side
// as it crosses (the same sine-offset idea the Gale's wind lines use) and
// drops a trail of small square hazards behind it as it goes, instead of
// harmless dust. No shield involved, same as everything else in this fight
// — pure position dodging, just now with a second kind of thing to track.
// Optional `family` tag lets Convergence's archivist cue despawn its own
// batch on capture (see clearConvergenceCueHazards, erif.js) the same way
// spears/shapes already do.
function spawnWeavingBook(hard = false, family = null) {
  const b = battle.box, edge = (Math.random() * 4) | 0;
  // 20% further out (16 -> 19.2) — no telegraph before it's live.
  let ox, oy, tx, ty;
  if (edge === 0) { ox = rand(b.x, b.x + b.w); oy = b.y - 19.2; tx = rand(b.x, b.x + b.w); ty = b.y + b.h + 19.2; }
  else if (edge === 1) { ox = b.x + b.w + 19.2; oy = rand(b.y, b.y + b.h); tx = b.x - 19.2; ty = rand(b.y, b.y + b.h); }
  else if (edge === 2) { ox = rand(b.x, b.x + b.w); oy = b.y + b.h + 19.2; tx = rand(b.x, b.x + b.w); ty = b.y - 19.2; }
  else { ox = b.x - 19.2; oy = rand(b.y, b.y + b.h); tx = b.x + b.w + 19.2; ty = rand(b.y, b.y + b.h); }
  const speed = (hard ? 78 : 62) * DIFFICULTY.projectileMult;
  const dirA = Math.atan2(ty - oy, tx - ox);
  battle.weavingBooks.push({
    ox, oy, dirA, speed, travel: 0, r: 5.5,
    wavePhase: rand(0, Math.PI * 2), waveAmp: rand(26, 40),
    spin: rand(-3, 3), rot: 0, trailT: 0, family, ...hazardAgeFields(20),
  });
  tone(170, .1, 'sine', .024);
}
function weavingBookXY(w) {
  const wig = Math.sin(w.travel * .045 + w.wavePhase) * w.waveAmp;
  const perpA = w.dirA + Math.PI / 2;
  return { x: w.ox + Math.cos(w.dirA) * w.travel + Math.cos(perpA) * wig, y: w.oy + Math.sin(w.dirA) * w.travel + Math.sin(perpA) * wig };
}
function updateWeavingBooks(dt) {
  const s = battle.soul, b = battle.box;
  for (const w of battle.weavingBooks) {
    w.travel += w.speed * dt;
    w.rot += w.spin * dt;
    const p = weavingBookXY(w);
    w.x = p.x; w.y = p.y;
    // A trail square every so often — unlike the regular book's harmless
    // dust, these actually linger and have to be dodged too.
    w.trailT -= dt;
    if (w.trailT <= 0) {
      battle.trailSquares.push({ x: p.x, y: p.y, t: 1.8, size: 10, harmless:true, family: w.family });
      w.trailT = .16;
    }
    if (dist(p.x, p.y, s.x, s.y) < s.r + hazardHitRadius(w) - 3) { w.dead = true; hurt(); }
  }
  // Tightened to 20 (was 32, sized off Enraged's own bigger 680x390 box —
  // this hazard also appears there and via Convergence's archivist cue, not
  // just the standalone fight's default box) for more decluttering; the
  // gradual shrink over its last 50% means it fades rather than pops even in
  // that bigger arena if it's cut a little short of a full natural crossing.
  battle.weavingBooks = battle.weavingBooks.filter(w => !w.dead && !hazardExpired(w.ageExpireT) &&
    w.x > b.x - 90 && w.x < b.x + b.w + 90 && w.y > b.y - 90 && w.y < b.y + b.h + 90);
}
function updateTrailSquares(dt) {
  const s = battle.soul;
  for (const t of battle.trailSquares) {
    t.t -= dt;
    if (!t.dead && !t.harmless && dist(t.x, t.y, s.x, s.y) < s.r + t.size * .75) { t.dead = true; hurt(); }
  }
  battle.trailSquares = battle.trailSquares.filter(t => !t.dead && t.t > 0);
}
// 1-3 at once — kept low specifically because there's no way to shield
// these away, only dodge them.
function spawnWeavingBookBurst(hard = false, family = null) {
  const count = 1 + ((Math.random() * 3) | 0);
  for (let i = 0; i < count; i++) spawnWeavingBook(hard, family);
}

function updateArchivist(dt, hard = false) {
  moveSoulFree(dt, hard ? 220 : 200);
  if (!battle.sigils.length) startEchoRound(hard);

  if (battle.echoPhase === 'reveal') updateEchoReveal(dt, hard);
  else if (battle.echoPhase === 'input') updateEchoInput(dt);
  else if (battle.echoPhase === 'resolve') {
    battle.echoResolveTimer -= dt;
    if (battle.echoResolveTimer <= 0) {
      // Win the instant enough sequences have actually been completed —
      // failed rounds don't count, only real successes (see echoSuccesses++
      // above). This is the trial's real win condition now; the generic
      // duration timeout is just a safety net, same as Erif's own fight.
      if (battle.echoSuccesses >= ARCHIVIST_WIN_ROUNDS) { finishBattle(true); return; }
      // A failed round retries at the same length instead of advancing —
      // echoRound (which sets the next sequence's length in startEchoRound)
      // only climbs on an actual success, so a miss doesn't also make the
      // retry harder.
      if (!battle.echoFail) battle.echoRound++;
      startEchoRound(hard);
    }
  }

  battle.echoBookTimer -= dt;
  if (battle.echoBookTimer <= 0) {
    // Spawn rate ramps up across rounds (1 at round 1 → ARCHIVIST_WIN_ROUNDS
    // at the last one) so the continuous book pressure grows alongside the
    // sequence length, instead of staying flat while only the sigils get harder.
    const ramp = Math.min(battle.echoRound - 1, ARCHIVIST_WIN_ROUNDS - 1) / (ARCHIVIST_WIN_ROUNDS - 1);
    spawnEchoBook(hard);
    if (hard && Math.random() < .3 + ramp * .3) spawnEchoBook(hard); // a second book, more often as rounds climb, on hard
    const mult = 1 - ramp * .45;
    battle.echoBookTimer = hard ? rand(1.15 * mult, 1.7 * mult) : rand(1.6 * mult, 2.35 * mult);
  }
  updateEchoBooks(dt);

  // A little extra pressure on top of the sigils/regular books — the
  // memory-match itself was otherwise the only thing actually demanding
  // attention, with nothing making the room itself dangerous to stand in.
  battle.weavingBookTimer -= dt;
  if (battle.weavingBookTimer <= 0) {
    spawnWeavingBookBurst(hard);
    battle.weavingBookTimer = hard ? rand(5.5, 7.5) : rand(6.5, 9);
  }
  updateWeavingBooks(dt);
  updateTrailSquares(dt);

  if (battle.sigilPulse) { battle.sigilPulse.t -= dt; if (battle.sigilPulse.t <= 0) battle.sigilPulse = null; }
}

// ---- THE MASK — Deception. Mirrored shield-direction. ----
// Reuses spawnSpearVolley/spawnSpearNeedles/updateSpearHazards from
// hazards.js; only the launch step differs (the true safe side may be
// inverted from what's telegraphed).
function flipMaskMirror() {
  battle.maskMirrored = !battle.maskMirrored;
  battle.maskTellPhase = 1;
  tone(battle.maskMirrored ? 90 : 140, .18, 'sawtooth', .04);
}
function launchMaskSpear(t, silent = false) {
  const b = battle.box, speed = (t.hard ? 470 : 390) * DIFFICULTY.projectileMult;
  let x = t.x, y = t.y, vx = 0, vy = 0;
  if (t.side === 'up') { y = b.y - 18; vy = speed; }
  if (t.side === 'down') { y = b.y + b.h + 18; vy = -speed; }
  if (t.side === 'left') { x = b.x - 18; vx = speed; }
  if (t.side === 'right') { x = b.x + b.w + 18; vx = -speed; }
  // The projectile's trajectory stays honest to the displayed telegraph —
  // only which shield direction counts as "safe" gets inverted. (Must use
  // SHIELD_OPPOSITE here, not `opposite` — that one maps door edges n/s/e/w,
  // not up/down/left/right, and would silently make every mirrored spear
  // unblockable.)
  const trueSide = battle.maskMirrored ? SHIELD_OPPOSITE[t.side] : t.side;
  battle.spears.push({ x, y, vx, vy, side: trueSide, r: 8, family: t.family, kind: 'shard', lying: battle.maskMirrored, ...hazardAgeFields(5.0) });
  // silent — see launchSpear/updateSpearHazards (hazards.js) for why.
  if (!silent) tone(260, .025, 'square', .018);
}
// A slow drifting shard of the mask itself, floating in from a box edge
// toward the center rather than launching like a spear — no wall, no sudden
// telegraph line, just something to notice, track, and dodge by the time it
// closes in. Unblockable by the shield (unlike a launched spear/spear-shard,
// this one never had a wall to telegraph which side it'd land on, so it's
// meant to be read and moved around, not faced down) — runs on its own
// independent timer alongside the spear cadence, giving Mask a second,
// quieter kind of pressure instead of leaning entirely on spear volume for
// difficulty.
// Optional `family` tag, same convention as spawnWeavingBook/spawnEchoBook —
// lets Convergence's mask cue despawn its own batch on capture (see
// clearConvergenceCueHazards, erif.js).
function spawnMaskShard(hard = false, family = null) {
  const b = battle.box, edge = (Math.random() * 4) | 0;
  // 20% further out (24 -> 28.8) — no telegraph before it's live.
  let x, y;
  if (edge === 0) { x = rand(b.x + 20, b.x + b.w - 20); y = b.y - 28.8; }
  else if (edge === 1) { x = b.x + b.w + 28.8; y = rand(b.y + 20, b.y + b.h - 20); }
  else if (edge === 2) { x = rand(b.x + 20, b.x + b.w - 20); y = b.y + b.h + 28.8; }
  else { x = b.x - 28.8; y = rand(b.y + 20, b.y + b.h - 20); }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const a = Math.atan2(cy - y, cx - x);
  const speed = (hard ? 48 : 38) * DIFFICULTY.projectileMult;
  battle.maskShards.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 10, wobble: rand(0, Math.PI * 2), family, ...hazardAgeFields(20) });
  tone(210, .1, 'triangle', .02);
}
function updateMaskShards(dt) {
  const s = battle.soul, b = battle.box;
  for (const w of battle.maskShards) {
    w.wobble += dt * 2.6;
    w.x += w.vx * dt + Math.cos(w.wobble) * 9 * dt;
    w.y += w.vy * dt + Math.sin(w.wobble) * 9 * dt;
    const hitRadius = s.r + hazardHitRadius(w) - 2, d = dist(w.x, w.y, s.x, s.y);
    if (d < hitRadius) { w.dead = true; hurt(); }
  }
  // 20 still comfortably covers a straight edge-through-center-and-out-the-
  // far-side path, even in Enraged's bigger box.
  battle.maskShards = battle.maskShards.filter(w => !w.dead && !hazardExpired(w.ageExpireT) &&
    w.x > b.x - 60 && w.x < b.x + b.w + 60 && w.y > b.y - 60 && w.y < b.y + b.h + 60);
}
function updateMask(dt, hard = false) {
  moveSoulWithShield(dt, hard ? 215 : 195);

  battle.maskMirrorTimer -= dt;
  if (battle.maskMirrorTimer <= 0 && battle.telegraphs.length === 0) {
    flipMaskMirror();
    battle.maskMirrorTimer = hard ? rand(2.4, 3.6) : rand(3.2, 5.0);
  }
  battle.maskTellPhase = Math.max(0, battle.maskTellPhase - dt * 2.2);

  // Cadence pulled back hard from the shared Executioner numbers — half as
  // many spear bursts overall (spawn/needle/special intervals all doubled
  // from where they started), and the regular volley itself now spawns at
  // half density on top of that (spacingMult 2 below), so the Mask's steel
  // is lighter across the board. The budget that used to go to spears
  // instead goes to the shard hazard, whose own timer is a third of what it
  // was — floating projectiles are now this fight's primary pressure.
  battle.spawn -= dt;
  battle.needleTimer -= dt;
  battle.specialTimer -= dt;
  if (battle.spawn <= 0) {
    spawnSpearVolley(hard, null, 0, 2);
    battle.spawn = hard ? 4.5 : 5.6;
    // Same anti-stacking guard as the Executioner — keeps a needle burst
    // from also landing right on top of a volley that just fired.
    battle.needleTimer = Math.max(battle.needleTimer, .5);
  }
  if (battle.needleTimer <= 0) {
    spawnSpearNeedles(hard);
    battle.needleTimer = hard ? 3.0 : 3.7;
    battle.spawn = Math.max(battle.spawn, .5);
  }
  if (battle.specialTimer <= 0) {
    triggerSpearSpecial(hard);
    battle.specialTimer = hard ? rand(4.4, 5.4) : rand(5.2, 6.4);
  }

  battle.maskShardTimer -= dt;
  if (battle.maskShardTimer <= 0) {
    spawnMaskShard(hard);
    battle.maskShardTimer = hard ? rand(.87, 1.13) : rand(1.13, 1.47);
  }
  updateMaskShards(dt);

  updateSpearHazards(dt, false, launchMaskSpear);
}
