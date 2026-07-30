'use strict';

// Generalized hazard primitives shared by every lieutenant and by Erif.
// Each primitive only touches battle.<family>[] arrays and calls hurt() —
// per-boss files decide *when* and *how* to spawn them.

// ---- Sparks (shared hit/block feedback particles) ----
// A tiny reusable burst system — white for a shield block, ember for taking
// damage — used across every mechanic instead of relying on the screen-flash
// alone to sell a hit.
function spawnSparks(x, y, count, opts = {}) {
  const { speed = [60, 140], life = .35, color = '#fff' } = opts;
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(speed[0], speed[1]);
    battle.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, color });
  }
}
function updateSparks(dt) {
  for (const s of battle.sparks) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vx *= (1 - dt * 2.4); s.vy *= (1 - dt * 2.4);
    s.life -= dt;
  }
  battle.sparks = battle.sparks.filter(s => s.life > 0);
}

// ---- Soul movement ----
// i/j/k/l are alternates for the arrow keys throughout (some keyboard
// layouts/setups don't have comfortable arrow access) — never a replacement
// for WASD, which already covers movement on its own.
// Applies the Speed upgrade's multiplier once, here, rather than at each of
// the ~10 call sites that hardcode their own base speed per boss/difficulty
// — every caller's base speed scales the same way automatically.
function upgradedSpeed(speed) {
  return speed * (1 + UPGRADE_CATALOG.speed.perStack * (save.upgrades.speed || 0));
}
function moveSoulFree(dt, speed = 205) {
  speed = upgradedSpeed(speed);
  const s = battle.soul, b = battle.box;
  let dx = (keys['d'] || keys['arrowright'] || keys['l'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] || keys['j'] ? 1 : 0);
  let dy = (keys['s'] || keys['arrowdown'] || keys['k'] ? 1 : 0) - (keys['w'] || keys['arrowup'] || keys['i'] ? 1 : 0);
  // The Gale's wind reverses which way a held direction actually moves you —
  // see battle.controlsInverted, set/cleared in bosses.js's updateGale. Every
  // other boss leaves this false, so this is a no-op everywhere else.
  if (battle.controlsInverted) { dx = -dx; dy = -dy; }
  if (dx || dy) { const n = Math.hypot(dx, dy); dx /= n; dy /= n; s.x += dx * speed * dt; s.y += dy * speed * dt; }
  s.x = clamp(s.x, b.x + s.r, b.x + b.w - s.r);
  s.y = clamp(s.y, b.y + s.r, b.y + b.h - s.r);
}

function moveSoulWithShield(dt, speed = 225) {
  speed = upgradedSpeed(speed);
  const s = battle.soul, b = battle.box;
  let dx = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0), dy = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);
  if (battle.controlsInverted) { dx = -dx; dy = -dy; }
  if (dx || dy) { const n = Math.hypot(dx, dy); s.x += dx / n * speed * dt; s.y += dy / n * speed * dt; }
  s.x = clamp(s.x, b.x + s.r, b.x + b.w - s.r);
  s.y = clamp(s.y, b.y + s.r, b.y + b.h - s.r);
  // Shield-direction keys invert the same way, via SHIELD_OPPOSITE (data.js)
  // rather than a second hand-written mapping.
  const flip = battle.controlsInverted ? SHIELD_OPPOSITE : null;
  if (keys['arrowup'] || keys['i']) battle.shield = flip ? flip['up'] : 'up';
  if (keys['arrowdown'] || keys['k']) battle.shield = flip ? flip['down'] : 'down';
  if (keys['arrowleft'] || keys['j']) battle.shield = flip ? flip['left'] : 'left';
  if (keys['arrowright'] || keys['l']) battle.shield = flip ? flip['right'] : 'right';
}

// The true world angle a hazard approaching from a given side sits at,
// relative to the soul (up = hazard above = negative y = -PI/2, etc.) —
// distinct from render.js's SHIELD_DIR_ANGLE, which is a drawing-rotation
// offset for the shield glyph, not a real angle to compare against.
const SHIELD_FACING_ANGLE = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };
// Shield Forgiveness doesn't just widen the block RADIUS anymore — a
// correctly-aimed shield now also catches a hazard arriving from a bit off
// its exact labeled side, close enough that it visually reads as "that was
// basically blockable," and more so with more stacks. The base tolerance
// (no stacks) is deliberately modest — this forgives near-misses right at
// the boundary between two sides, not a way to ignore facing entirely.
function shieldAngleTolerance() {
  return Math.PI / 10 + (Math.PI / 30) * (save.upgrades.shield || 0);
}
// Every blockable-hazard update loop calls this in place of a bare
// `battle.shield === side` check — same true/false contract, just also true
// when the shield is facing an adjacent side within shieldAngleTolerance()
// of the hazard's actual current angle to the soul.
function shieldFacingBlocks(hazX, hazY, side) {
  if (battle.shield === side) return true;
  const shieldA = SHIELD_FACING_ANGLE[battle.shield];
  if (shieldA === undefined) return false;
  const hitA = Math.atan2(hazY - battle.soul.y, hazX - battle.soul.x);
  const diff = Math.abs(Math.atan2(Math.sin(hitA - shieldA), Math.cos(hitA - shieldA)));
  return diff <= shieldAngleTolerance();
}

// ---- Ring / gap rotating-dodge (Hourglass family) ----
// origin/expand are both defaulted off, so every existing call site is
// untouched — origin lets a ring spawn centered somewhere other than the box
// center (e.g. a slam's impact point, see erif.js's Reckoning), and expand
// flips a ring from the usual shrink-inward dodge into a growing shockwave
// (dr becomes positive; see updateRingHazards' despawn filter below, which
// switches from ">0" to a max-radius cap for that case).
const RING_EXPAND_MAX_R = 900; // comfortably covers the largest arena (Reckoning's 910x580 box)
function spawnRing(hard = false, gapA = null, radius = 360, drift = 0, speed = null, opening = null, gapCount = 1, origin = null, expand = false) {
  const b = battle.box;
  const cx = origin ? origin.x : b.x + b.w / 2, cy = origin ? origin.y : b.y + b.h / 2;
  const gap = opening ?? (hard ? .43 : .58);
  const shrink = (speed ?? (hard ? 170 : 145)) * DIFFICULTY.projectileMult;
  battle.rings.push({ cx, cy, r: radius, dr: expand ? shrink : -shrink, gapA: gapA ?? rand(0, Math.PI * 2), gap, w: 5, drift, gapCount, expand });
}
function ringAngleIsOpen(r, a) {
  const count = Math.max(1, r.gapCount || 1), step = Math.PI * 2 / count;
  for (let i = 0; i < count; i++) {
    const center = r.gapA + i * step;
    const da = Math.atan2(Math.sin(a - center), Math.cos(a - center));
    if (Math.abs(da) <= r.gap) return true;
  }
  return false;
}
function updateRingHazards(dt) {
  for (const r of battle.rings) {
    r.r += r.dr * dt; r.gapA += r.drift * dt;
    const d = dist(battle.soul.x, battle.soul.y, r.cx, r.cy);
    if (Math.abs(d - r.r) < battle.soul.r + r.w) {
      const a = Math.atan2(battle.soul.y - r.cy, battle.soul.x - r.cx);
      if (!ringAngleIsOpen(r, a)) hurt();
    }
  }
  battle.rings = battle.rings.filter(r => r.expand ? r.r < RING_EXPAND_MAX_R : r.r > 0);
}

// ---- Spear wall + 4-way shield (Executioner family; also used by the Mask) ----
function spawnSpear(hard = false, delay = null, forcedSide = null, fixedPos = null) {
  const b = battle.box, s = battle.soul;
  const side = forcedSide || choose(['up', 'down', 'left', 'right']);
  const pad = 22;
  let x, y;
  if (side === 'up' || side === 'down') {
    x = fixedPos ?? clamp(s.x + rand(-55, 55), b.x + pad, b.x + b.w - pad);
    y = side === 'up' ? b.y : b.y + b.h;
  } else {
    x = side === 'left' ? b.x : b.x + b.w;
    y = fixedPos ?? clamp(s.y + rand(-55, 55), b.y + pad, b.y + b.h - pad);
  }
  const warnT = delay ?? ((hard ? .32 : .52) * DIFFICULTY.telegraphMult);
  // maxT is the starting countdown, kept alongside the live t so render.js
  // can show a shrinking line (full length down to nothing right as it
  // fires) instead of a fixed-length line that just blinks — with several
  // telegraphs queued at once, a static line gives no sense of which one is
  // about to land first.
  battle.telegraphs.push({ side, x, y, t: warnT, maxT: warnT, hard });
}
// spacingMult widens the gap between spears in the wall without touching
// anything else about it — the Mask's own volley call passes 2 here so its
// "large burst" packs half as many spears as the Executioner's (see
// updateMask, bosses.js), while every other caller (including the shared
// Pincer/Sweep special patterns) keeps the original solid-wall density.
function spawnSpearVolley(hard = false, forcedSide = null, extraDelay = 0, spacingMult = 1) {
  const b = battle.box;
  const choices = ['up', 'down', 'left', 'right'].filter(x => x !== battle.lastSpearSide);
  const side = forcedSide || choose(choices);
  battle.lastSpearSide = side;
  const spacing = (hard ? 24 : 27) * spacingMult;
  const warning = (hard ? .34 : .54) * DIFFICULTY.telegraphMult + extraDelay;
  if (side === 'up' || side === 'down') {
    for (let x = b.x + 12; x <= b.x + b.w - 12; x += spacing) spawnSpear(hard, warning, side, x);
  } else {
    for (let y = b.y + 12; y <= b.y + b.h - 12; y += spacing) spawnSpear(hard, warning, side, y);
  }
  tone(145, .06, 'sawtooth', .027);
}
function launchSpear(t) {
  const b = battle.box, speed = (t.hard ? 470 : 390) * DIFFICULTY.projectileMult;
  let x = t.x, y = t.y, vx = 0, vy = 0;
  if (t.side === 'up') { y = b.y - 18; vy = speed; }
  if (t.side === 'down') { y = b.y + b.h + 18; vy = -speed; }
  if (t.side === 'left') { x = b.x - 18; vx = speed; }
  if (t.side === 'right') { x = b.x + b.w + 18; vx = -speed; }
  battle.spears.push({ x, y, vx, vy, side: t.side, r: 8, family: t.family, kind: 'spear' });
  tone(260, .025, 'square', .018);
}
// countOverride lets a caller pick the exact burst size (e.g. Erif's
// Enraged phase alternating 3/5/7 — see updateEnraged) instead of the
// standard difficulty-based 5/7. Offsets are generated evenly spaced around
// center rather than off a hardcoded array, so they still land exactly on
// the old 5/7 arrangements while also supporting any other count cleanly.
function spawnSpearNeedles(hard = false, forcedSide = null, countOverride = null) {
  const b = battle.box, s = battle.soul;
  const side = forcedSide || choose(['up', 'down', 'left', 'right'].filter(x => x !== battle.lastSpearSide));
  const count = countOverride ?? (hard ? 7 : 5);
  const step = hard ? 20 : 24;
  const half = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const off = (i - half) * step;
    const pos = (side === 'up' || side === 'down')
      ? clamp(s.x + off + rand(-5, 5), b.x + 16, b.x + b.w - 16)
      : clamp(s.y + off + rand(-5, 5), b.y + 16, b.y + b.h - 16);
    spawnSpear(hard, (hard ? .30 : .46) * DIFFICULTY.telegraphMult, side, pos);
  }
  tone(215, .045, 'square', .02);
}
function updateSpearHazards(dt, forgiving = false, launchFn = launchSpear) {
  const s = battle.soul, b = battle.box;
  // A telegraph explicitly tagged .mirror always resolves through the Mask's
  // launch function, regardless of the caller's default — this lets
  // Convergence run honest Executioner spears and lying Mask spears side by
  // side in the same battle.telegraphs array.
  for (const t of battle.telegraphs) { t.t -= dt; if (t.t <= 0 && !t.fired) { t.fired = true; (t.mirror ? launchMaskSpear : launchFn)(t); } }
  battle.telegraphs = battle.telegraphs.filter(t => !t.fired);
  for (const p of battle.spears) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    const hitRadius = forgiving ? 5.25 + p.r * .72 : s.r + p.r + 2;
    const d = dist(p.x, p.y, s.x, s.y);
    // Shield Forgiveness widens both the BLOCK radius and (via
    // shieldFacingBlocks) the angle a correctly-aimed shield still catches a
    // hazard within — taking damage while facing the wrong way entirely
    // never gets any easier, only a roughly-correct block does.
    if (shieldFacingBlocks(p.x, p.y, p.side)) {
      const blockRadius = hitRadius + UPGRADE_CATALOG.shield.perStack * (save.upgrades.shield || 0);
      // Spark count lightly scaled by the hazard's own radius — a heavier
      // projectile reads as a punchier block than a slight one.
      if (d < blockRadius) { p.dead = true; tone(520, .04, 'square', .023); spawnSparks(p.x, p.y, Math.round(4 + p.r * .3), { color: EMBER, speed: [50, 110], life: .3 }); }
    } else if (d < hitRadius) { p.dead = true; hurt(); }
  }
  battle.spears = battle.spears.filter(p => !p.dead && p.x > b.x - 50 && p.x < b.x + b.w + 50 && p.y > b.y - 50 && p.y < b.y + b.h + 50);
}

// ---- Spear pattern variety (layered on top of the base volley/needles,
// shared by the Executioner, the Mask, and Erif's Reprise/Convergence/
// Enraged segments — anything that calls updateSpearHazards) ----

// Needles from two opposite sides at once. Needles are dodged by position,
// not by reading a shield side, so two at once is a fair spatial squeeze
// rather than an impossible two-direction shield read.
function spawnSpearCrossNeedles(hard = false) {
  const sideA = choose(['up', 'down', 'left', 'right']);
  spawnSpearNeedles(hard, sideA);
  spawnSpearNeedles(hard, SHIELD_OPPOSITE[sideA]);
}
// Two volleys from adjacent (not opposite) sides, staggered just enough that
// the shield read for the first has to flip before the second lands.
function spawnSpearPincer(hard = false) {
  const adjacent = [['up', 'left'], ['up', 'right'], ['down', 'left'], ['down', 'right']];
  const [sideA, sideB] = choose(adjacent);
  const stagger = hard ? .3 : .42;
  spawnSpearVolley(hard, sideA, 0);
  spawnSpearVolley(hard, sideB, stagger);
}
// A full pinwheel — all 4 sides in a shuffled order, staggered — the room
// closing in from every direction in sequence. The biggest single pattern,
// meant to show up rarely.
function spawnSpearSweep(hard = false) {
  const sides = shuffleArray(['up', 'down', 'left', 'right']);
  const stagger = hard ? .32 : .44;
  sides.forEach((side, i) => spawnSpearVolley(hard, side, i * stagger));
}
// A wall of just `count` spears, spread into roughly even slots across the
// full width/height with some jitter inside each slot — unlike the regular
// volley (which always packs the whole wall solid), a small count leaves
// real gaps. With few enough spears, a well-positioned player can dodge by
// standing in a gap instead of shielding at all — the shield is still the
// safe answer, but it stops being the *only* one.
function spawnSpearGappedWall(hard = false, count = 3, forcedSide = null, extraDelay = 0) {
  const b = battle.box;
  const choices = ['up', 'down', 'left', 'right'].filter(x => x !== battle.lastSpearSide);
  const side = forcedSide || choose(choices);
  battle.lastSpearSide = side;
  const warning = (hard ? .34 : .54) * DIFFICULTY.telegraphMult + extraDelay;
  const axisLen = (side === 'up' || side === 'down') ? b.w : b.h, margin = 16, usable = axisLen - margin * 2;
  for (let i = 0; i < count; i++) {
    const pos = margin + (usable / count) * (i + rand(.15, .85));
    const coord = (side === 'up' || side === 'down') ? b.x + pos : b.y + pos;
    spawnSpear(hard, warning, side, coord);
  }
  tone(145, .06, 'sawtooth', .027);
}
function spawnSpearBurst3(hard = false) { spawnSpearGappedWall(hard, 3); }
function spawnSpearBurst5(hard = false) { spawnSpearGappedWall(hard, hard ? 6 : 5); }
function spawnSpearBurst7(hard = false) { spawnSpearGappedWall(hard, hard ? 8 : 7); }
// Two gapped walls from opposite sides at once — still positionally
// dodgeable even doubled up, since each wall already leaves real gaps on
// its own; finding one spot safe from both is a spatial puzzle, not a
// shield-timing one, so it's fine for this to land right on top of the
// regular volley/needle cadence the way the single-sided bursts are.
function spawnSpearGappedCross(hard = false) {
  const sideA = choose(['up', 'down', 'left', 'right']), count = hard ? 4 : 3;
  spawnSpearGappedWall(hard, count, sideA);
  spawnSpearGappedWall(hard, count, SHIELD_OPPOSITE[sideA]);
}
// A gapped wall, then a second from an adjacent side shortly after — the
// same "stand in the safe gap" logic, just walking the safe spot from one
// side's gap into the next side's gap.
function spawnSpearGappedPincer(hard = false) {
  const adjacent = [['up', 'left'], ['up', 'right'], ['down', 'left'], ['down', 'right']];
  const [sideA, sideB] = choose(adjacent), count = hard ? 4 : 3;
  spawnSpearGappedWall(hard, count, sideA, 0);
  spawnSpearGappedWall(hard, count, sideB, .3);
}

// ---- Safe-shape matching + homing hands (Witness family) ----
function insideShape(s, z) {
  const dx = s.x - z.x, dy = s.y - z.y, q = z.size;
  if (z.type === 'circle') return dx * dx + dy * dy <= q * q;
  if (z.type === 'square') return Math.abs(dx) <= q * .82 && Math.abs(dy) <= q * .82;
  const ax = z.x, ay = z.y - q, bx = z.x - q * .95, by = z.y + q * .82, cx = z.x + q * .95, cy = z.y + q * .82;
  const sign = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d1 = sign(s.x, s.y, ax, ay, bx, by), d2 = sign(s.x, s.y, bx, by, cx, cy), d3 = sign(s.x, s.y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function makeHand(x, y, tx, ty) { return { x, y, tx, ty, pulse: rand(0, 6.28) }; }
function updateShapeHazards(dt, forgiving = false) {
  for (const q of battle.shapes) {
    q.x += q.vx * dt; q.y += q.vy * dt; q.a = (q.a || 0) + (q.spin || 0) * dt; q.life -= dt;
    const hitRadius = forgiving ? 5.25 + q.size * .55 : battle.soul.r + q.size * .8;
    if (dist(q.x, q.y, battle.soul.x, battle.soul.y) < hitRadius) { q.dead = true; hurt(); }
  }
  battle.shapes = battle.shapes.filter(q => !q.dead && q.life > 0 &&
    q.x > battle.box.x - 90 && q.x < battle.box.x + battle.box.w + 90 &&
    q.y > battle.box.y - 90 && q.y < battle.box.y + battle.box.h + 90);
}

// ---- Quiz + answer-lane lasers (Oracle family) ----
// Starts at 4 options and gains one more every single round solved
// (battle.qRound holds the count of already-completed rounds at generation
// time — newQuestion only increments it after building the question),
// capped so the lanes never shrink into an unreadable/impossible sliver on
// a long fight.
function oracleOptionCount() {
  // Lets a caller pin the exact option count for one question instead of
  // deriving it from the solved-rounds ramp — set/cleared right around a
  // single generateOracleQuestion call (see Erif's Enraged phase, erif.js,
  // which pins each math round's difficulty straight off its minigame plan).
  if (battle.qOptionCountOverride != null) return battle.qOptionCountOverride;
  return Math.min(8, 4 + (battle.qRound || 0));
}
function nextAnswerLane() {
  if (!battle.answerSlots.length) battle.answerSlots = shuffleArray(Array.from({ length: oracleOptionCount() }, (_, i) => i));
  return battle.answerSlots.pop();
}
function placeAnswer(prompt, correct, wrongAnswers) {
  const count = oracleOptionCount();
  const correctText = String(correct);
  const wrong = shuffleArray([...new Set(wrongAnswers.map(String).filter(v => v !== correctText))]);
  const numeric = Number(correct);
  const fallbackOffsets = shuffleArray([-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6, -6, 8, -8]);
  while (wrong.length < count - 1) {
    const candidate = Number.isFinite(numeric) ? String(numeric + (fallbackOffsets.pop() ?? wrong.length + 1)) : `NONE ${wrong.length + 1}`;
    if (candidate !== correctText && !wrong.includes(candidate)) wrong.push(candidate);
  }
  const ok = nextAnswerLane();
  const answers = new Array(count), distractors = wrong.slice(0, count - 1);
  answers[ok] = correctText;
  let d = 0;
  for (let i = 0; i < count; i++) if (i !== ok) answers[i] = distractors[d++];
  return { q: prompt, a: answers, ok };
}
function numberQuestion(prompt, correct, candidates = []) {
  return placeAnswer(prompt, correct, [...candidates, correct + 1, correct - 1, correct + 2, correct - 2, correct + 3, correct - 3]);
}
function generateOracleQuestion(hard = false) {
  const max = hard ? 28 : 18;
  let result = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const kind = (Math.random() * (hard ? 12 : 11)) | 0;
    if (kind === 0) {
      const a = 2 + ((Math.random() * max) | 0), b = 2 + ((Math.random() * max) | 0);
      result = numberQuestion(`${a} + ${b}`, a + b, [a + b + 5, a + b - 4, a + b + 2]);
    } else if (kind === 1) {
      const b = 2 + ((Math.random() * max) | 0), answer = 2 + ((Math.random() * max) | 0), a = b + answer;
      result = numberQuestion(`${a} − ${b}`, answer, [answer + 4, answer - 2, answer + 1]);
    } else if (kind === 2) {
      const a = 2 + ((Math.random() * (hard ? 11 : 8)) | 0), b = 2 + ((Math.random() * (hard ? 10 : 7)) | 0), answer = a * b;
      result = numberQuestion(`${a} × ${b}`, answer, [answer + a, answer - b, answer + 2]);
    } else if (kind === 3) {
      const answer = 3 + ((Math.random() * (hard ? 22 : 14)) | 0);
      result = numberQuestion(`Half of ${answer * 2}`, answer, [answer * 2, answer - 2, answer + 3]);
    } else if (kind === 4) {
      const answer = 3 + ((Math.random() * (hard ? 16 : 11)) | 0), d = 1 + ((Math.random() * (hard ? 6 : 4)) | 0), start = 1 + ((Math.random() * 8) | 0);
      result = numberQuestion(`${start}, ${start + d}, ${start + d * 2}, ?`, start + d * 3, [start + d * 4, start + d * 2 + 1, start + d * 3 - 2]);
    } else if (kind === 5) {
      const ratio = choose([2, 3]), start = 1 + ((Math.random() * (hard ? 4 : 3)) | 0), answer = start * ratio * ratio * ratio;
      result = numberQuestion(`${start}, ${start * ratio}, ${start * ratio * ratio}, ?`, answer, [answer / ratio, answer + ratio, answer - ratio]);
    } else if (kind === 6) {
      const answer = 2 + ((Math.random() * max) | 0), add = 3 + ((Math.random() * max) | 0), total = answer + add;
      result = numberQuestion(`${add} + ? = ${total}`, answer, [add, total - answer + 2, answer - 3]);
    } else if (kind === 7) {
      // Generates exactly as many distinct candidates as the current option
      // count needs, not a fixed 4 — placeAnswer's generic fallback fill
      // (correct answer +/- a random offset) has no idea this question needs
      // every distractor to stay BELOW the max, so once oracleOptionCount()
      // grew past 4 it was padding the lane with fallback numbers that could
      // exceed the labeled "greatest" value (e.g. a reported case where 26
      // showed up as a wrong answer under a "20 is greatest" prompt).
      const optionCount = oracleOptionCount();
      const values = [];
      while (values.length < optionCount) {
        const n = 2 + ((Math.random() * (hard ? 70 : 40)) | 0);
        if (!values.includes(n)) values.push(n);
      }
      const answer = Math.max(...values);
      result = placeAnswer('Which number is greatest?', answer, values.filter(v => v !== answer));
    } else if (kind === 8) {
      // Same fix as kind 7 — generate enough opposite-parity distractors for
      // the actual option count up front, so placeAnswer's fallback (which
      // doesn't know or care about parity) never has to invent extras.
      const optionCount = oracleOptionCount();
      const askEven = Math.random() < .5;
      const answer = (2 + ((Math.random() * 18) | 0)) * 2 + (askEven ? 0 : 1);
      const oppositeVals = [];
      while (oppositeVals.length < optionCount - 1) {
        const n = (2 + ((Math.random() * 22) | 0)) * 2 + (askEven ? 1 : 0);
        if (!oppositeVals.includes(n)) oppositeVals.push(n);
      }
      result = placeAnswer(askEven ? 'Which number is even?' : 'Which number is odd?', answer, oppositeVals);
    } else if (kind === 9) {
      const shapesList = [['triangle', 3], ['square', 4], ['pentagon', 5], ['hexagon', 6], ['octagon', 8]];
      const [name, sides] = choose(shapesList);
      result = numberQuestion(`Sides on a ${name}?`, sides, [sides + 1, sides - 1, sides + 2]);
    } else if (kind === 10) {
      // Negative-result subtraction — a genuinely different trap than the
      // rest of the bank, since "just subtract the smaller from the
      // bigger" (the instinctive shortcut) lands exactly on Math.abs(answer),
      // included below as its own wrong answer.
      const a = 2 + ((Math.random() * max) | 0), b = a + 2 + ((Math.random() * max) | 0), answer = a - b;
      result = numberQuestion(`${a} − ${b}`, answer, [Math.abs(answer), answer + 4, answer - 3]);
    } else {
      const n = 2 + ((Math.random() * 10) | 0), answer = n * n;
      result = numberQuestion(`${n}²`, answer, [n * 2, answer + n, answer - n]);
    }
    if (result.q !== battle.lastQuestionText) break;
  }
  battle.lastQuestionText = result.q;
  return result;
}
function newQuestion(hard = false) {
  battle.q = generateOracleQuestion(hard);
  battle.qMax = (hard ? 2.65 : 3.35) * DIFFICULTY.telegraphMult;
  battle.qTimer = battle.qMax;
  battle.qRound = (battle.qRound || 0) + 1;
  battle.lasers = [];
}
function updateLaneLasers(dt, hard = false) {
  const b = battle.box;
  if (battle.qTimer <= 0 && battle.lasers.length === 0) {
    const count = battle.q.a.length, lane = b.w / count;
    for (let i = 0; i < count; i++) if (i !== battle.q.ok) battle.lasers.push({ x: b.x + i * lane + 4, y: b.y + 4, w: lane - 8, h: b.h - 8, t: .85 });
    battle.qTimer = .85;
    tone(90, .18, 'sawtooth', .05);
  } else if (battle.lasers.length) {
    for (const l of battle.lasers) { l.t -= dt; if (rectHit(l)) hurt(); }
    if (battle.qTimer <= 0) { battle.q = null; battle.lasers = []; newQuestion(hard); }
  }
}

// ---- Sigil layout + touch-hold (Archivist family; also Erif's Convergence
// phases reuse these exact two functions) ----
// Evenly spaced by actual arc length around the ellipse, not by raw angle.
// Angle-uniform spacing bunches points up near the ends of the long axis on
// a squashed ellipse (rx notably bigger than ry, as this one is) and leaves
// gaps near top/bottom — this walks the ellipse's own perimeter instead, so
// 8 points end up an equal physical distance apart no matter how eccentric
// the ellipse is. `orbit` is treated as an arc-fraction offset (radians /
// 2π) rather than a raw angle, so it still animates as smooth continuous
// motion along the perimeter — if anything a more even one, since equal
// arc-fraction steps now mean equal apparent speed everywhere on the ring.
const ELLIPSE_ARC_SAMPLES = 180;
function ellipseArcAngleTable(rx, ry) {
  const samples = [];
  let total = 0, px = rx, py = 0;
  samples.push({ a: 0, cum: 0 });
  for (let i = 1; i <= ELLIPSE_ARC_SAMPLES; i++) {
    const a = (i / ELLIPSE_ARC_SAMPLES) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    total += Math.hypot(x - px, y - py);
    samples.push({ a, cum: total });
    px = x; py = y;
  }
  return { samples, total };
}
function angleAtArcFraction(table, frac) {
  const target = ((frac % 1) + 1) % 1 * table.total;
  const s = table.samples;
  for (let i = 1; i < s.length; i++) {
    if (s[i].cum >= target) {
      const span = s[i].cum - s[i - 1].cum;
      const t = span > 0 ? (target - s[i - 1].cum) / span : 0;
      return s[i - 1].a + (s[i].a - s[i - 1].a) * t;
    }
  }
  return s[s.length - 1].a;
}
function layoutSigils(names, orbit = 0, radiusX = null, radiusY = null, sigilRadius = 29) {
  const b = battle.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const rx = radiusX ?? b.w * .34, ry = radiusY ?? b.h * .31;
  const table = ellipseArcAngleTable(rx, ry);
  const orbitFrac = orbit / (Math.PI * 2);
  const points = names.map((name, i) => {
    const a = angleAtArcFraction(table, i / names.length + orbitFrac) - Math.PI / 2;
    return { name, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
  const sameShape = battle.sigils.length === points.length && battle.sigils.every((s, i) => s.name === points[i].name);
  if (!sameShape) battle.sigils = points.map(p => ({ name: p.name, x: p.x, y: p.y, r: sigilRadius }));
  else battle.sigils.forEach((s, i) => { s.x = points[i].x; s.y = points[i].y; });
}
function insideSigil(sig) {
  return dist(battle.soul.x, battle.soul.y, sig.x, sig.y) < battle.soul.r + sig.r - 4;
}
