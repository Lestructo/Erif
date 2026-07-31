'use strict';

// Boss portraits, battle/dialogue/overlay/victory/ending screens. Built out
// starting at milestone 3 (first boss portrait) and milestone 9 (victory).

function line(x1, y1, x2, y2, w = 2) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
// Every framed rectangle in the game (battle arena, hub rooms, dialogue
// boxes, upgrade cards) routes through here, so a small upgrade to this one
// function uplifts all of them for free: ember corner-accent brackets (the
// same "corner rivet" detail language already used on the Hourglass portrait)
// plus a faint inward glow, on top of the plain stroked rect. Both read off
// the CURRENT ctx.globalAlpha (rather than setting an absolute one) so they
// correctly inherit a caller's own dimming — upgrades.js's unselected-card
// alpha wrap, in particular, relies on box() inheriting ambient alpha rather
// than fighting it.
function box(x, y, w, h, lw = 3) {
  ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h);
  const baseAlpha = ctx.globalAlpha, cornerLen = Math.min(14, w * .12, h * .12);
  ctx.save();
  ctx.strokeStyle = EMBER; ctx.lineWidth = lw * .7; ctx.globalAlpha = baseAlpha * .5;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * cornerLen); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * cornerLen, cy);
    ctx.stroke();
  }
  ctx.strokeStyle = FLAME_FULL_COLOR; ctx.lineWidth = lw * 2; ctx.globalAlpha = baseAlpha * .05;
  ctx.strokeRect(x + lw, y + lw, w - lw * 2, h - lw * 2);
  ctx.restore();
}

// Sparse floor-grid texture — subtle structural depth behind the flat black
// fill (hub rooms and the battle arena both call this), rather than an empty
// void. Deliberately NOT a clean connected grid — each seam is chopped into
// short, irregular segments with gaps and per-segment alpha/width jitter, so
// it reads as fractured metal plating rather than graph paper. Deterministic
// per-position (a tiny seeded LCG, not Math.random() per frame) so the break
// pattern is stable frame to frame instead of flickering.
function drawFloorGrid(x, y, w, h) {
  const cell = 40, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
  ctx.save();
  ctx.strokeStyle = FLAME_FULL_COLOR;
  const drawBrokenSeam = (fixed, from, to, vertical) => {
    let pos = from;
    while (pos < to) {
      const segLen = 5 + rnd() * 11, gapLen = 5 + rnd() * 13;
      const segTo = Math.min(to, pos + segLen);
      // ~1 in 4 segments is just missing entirely — real gaps in the
      // plating, not merely faint ones.
      if (rnd() > .25) {
        ctx.globalAlpha = .0132 + rnd() * .022; // 10% more visible than the original .012-.032 range
        const lw = .4 + rnd() * 1.3;
        if (vertical) line(fixed, pos, fixed, segTo, lw); else line(pos, fixed, segTo, fixed, lw);
      }
      pos += segLen + gapLen;
    }
  };
  for (let i = 1; i < cols; i++) drawBrokenSeam(x + i * cell, y, y + h, true);
  for (let j = 1; j < rows; j++) drawBrokenSeam(y + j * cell, x, x + w, false);
  // A handful of ember-lit intersections, pulsing like the existing ambient
  // motes elsewhere — ties into that visual language instead of a new one.
  const t = performance.now() / 1000;
  for (let i = 1; i < cols; i++) {
    for (let j = 1; j < rows; j++) {
      if (((i * 7 + j * 13) % 14) !== 0) continue;
      ctx.globalAlpha = .03 + .03 * (1 + Math.sin(t * .5 + i + j)) / 2;
      ctx.beginPath(); ctx.arc(x + i * cell, y + j * cell, 1, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// Maps a shield direction onto the rotation that carries an arc drawn
// "facing up" (centered on angle -PI/2) around to that side instead.
const SHIELD_DIR_ANGLE = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

// Shortest-path angle interpolation (never spins the long way around).
function angleLerp(from, to, tt) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + diff * tt;
}
// Eases the shield's rendered rotation toward its new side instead of
// snapping instantly, whenever battle.shield changes direction.
const SHIELD_TURN_TIME = .12;
let shieldAngleFrom = 0, shieldAngleTo = 0, shieldChangeT = 0, shieldLastDir = null;

// The Witness's homing-hand hazard: a fist with a forearm trailing behind it,
// pointed along `rot`. Shared by its two roles — aiming at a zone during
// barrage/seek, and swinging straight down to smack a wrong zone during
// judgment (see the judgment block in drawBattle).
function drawFistHand(hx, hy, rot = 0, armLen = 38) {
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(rot); ctx.lineWidth = 2;
  ctx.strokeRect(-10, -11, 22, 22); line(12, 0, armLen, 0, 5);
  for (let f = -2; f <= 2; f++) line(5, -10 + f * 5, 17, -10 + f * 5, 2);
  ctx.restore();
}

function text(t, x, y, size = 20, align = 'center', alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px "Courier New",monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
  ctx.globalAlpha = 1;
}

// Greedy word-wrap against a pixel width, for anything (dialogue) whose
// content length isn't guaranteed to fit on one line.
function wrapLines(str, maxWidth, size) {
  ctx.font = `${size}px "Courier New",monospace`;
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(test).width > maxWidth) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Skeleton-only boot screen, proving the file split renders before any real
// game screens exist. Kept as a fallback for modes with no screen yet.
function drawBoot() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  text('ERIF', W / 2, H / 2 - 30, 46);
  ctx.fillStyle = EMBER;
  text('UNYIELDING FLAME', W / 2, H / 2 + 20, 20);
  ctx.fillStyle = '#fff';
  text('UNDER CONSTRUCTION', W / 2, H / 2 + 80, 13, 'center', .6);
}

// Hand-built vector line-art portraits, one per lieutenant plus Erif.
// eyesLeft: only meaningful for type==='erif' — caps how many of the two
// HP-tied orbit rings' eyes (8 total, see below) actually get drawn, so the
// live Reckoning head HUD (drawErifHeadHUD) can visibly pop them out one by
// one as battle.erifHeadHp drops. Every other caller (header, hub, victory,
// title) leaves this null and gets the full, untouched icon.
// beamPhase (null | 'telegraph' | 'active') only ever gets a real value from
// drawErifHeadHUD's own call, mirroring battle.erifBeamPhase — every other
// call site (title screen, victory screens, Final Convergence backdrop,
// etc.) leaves it at the default null, so this only ever changes the mouth's
// look during the Reckoning's own beam sequence, nowhere else.
function drawBossIcon(type, x, y, ghost = false, scale = 1, eyesLeft = null, beamPhase = null) {
  const now = performance.now() / 1000;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.globalAlpha = ghost ? .35 : 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const eye = (ex, ey, rx, ry, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(2, rx * .28), Math.max(2, ry * .72), 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  const hand = (hx, hy, rot = 0, scale = 1) => {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(rot); ctx.scale(scale, scale);
    ctx.strokeRect(-6, -8, 12, 16); line(6, -6, 16, -12, 2); line(6, -2, 18, -5, 2); line(6, 2, 18, 2, 2); line(6, 6, 16, 9, 2);
    ctx.restore();
  };
  // A second "eye" language, for shaking up the roster — every boss so far
  // reuses the same almond/lidded eye() above, which reads as repetitive
  // across enough portraits. A faceted, crystalline gem instead of an
  // organic eye: a cut-diamond outline with internal facet lines and a
  // small bright core, reading as a watching jewel rather than an eyeball.
  // Can sit alongside eye() on the same portrait or replace it outright.
  const gemEye = (ex, ey, r, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * .7, -r * .3); ctx.lineTo(r * .7, r * .3); ctx.lineTo(0, r); ctx.lineTo(-r * .7, r * .3); ctx.lineTo(-r * .7, -r * .3);
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = .6;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r * .7, -r * .3); ctx.lineTo(r * .7, r * .3); ctx.moveTo(r * .7, -r * .3); ctx.lineTo(-r * .7, r * .3); ctx.stroke();
    // The bright core drifts a little within the facets, like a watching
    // pupil, instead of sitting dead-center and static — desynced per eye via
    // `ex` (each gemEye call uses a different x) so the three don't move in
    // lockstep.
    const coreX = Math.sin(now * .6 + ex) * r * .22, coreY = Math.cos(now * .5 + ex * 1.3) * r * .18;
    ctx.beginPath(); ctx.arc(coreX, coreY, r * .28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // A faceless glowing slit instead of an eye at all — no lid, no pupil,
  // just a thin ember line that pulses like a coal.
  const emberSlitEye = (ex, ey, w, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.strokeStyle = EMBER; ctx.lineWidth = 2; ctx.globalAlpha *= .55 + .35 * Math.sin(now * 2 + ex);
    line(-w, 0, -2, 0, 2); line(2, 0, w, 0, 2);
    ctx.restore();
  };
  // An eye sewn shut — the almond outline stays, but an X of stitches
  // stands in for the pupil, instead of anything actually looking back.
  const stitchedEye = (ex, ey, rx, ry, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    line(-rx * .55, -ry * .55, rx * .55, ry * .55, 1); line(-rx * .55, ry * .55, rx * .55, -ry * .55, 1);
    ctx.restore();
  };
  // A small drifting flame-mote instead of an eye — a teardrop of fire, no
  // lid or pupil at all.
  const flameMote = (ex, ey, s = 1) => {
    ctx.save(); ctx.translate(ex, ey); ctx.scale(s, s); ctx.fillStyle = EMBER;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.quadraticCurveTo(4, -1, 2, 4); ctx.quadraticCurveTo(0, 7, -2, 4); ctx.quadraticCurveTo(-4, -1, 0, -7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
  };
  // A watching eye built like a sight/compass instead of an organic one —
  // fits anything mechanical or pivot-fixed far better than a lidded almond.
  const crosshairEye = (ex, ey, r, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    line(-r, 0, r, 0, 1); line(0, -r, 0, r, 1);
    ctx.beginPath(); ctx.arc(0, 0, r * .25, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // An eye already split by a crack instead of a smooth pupil — fits
  // anything whose whole identity is fracturing/shattering.
  const crackedEye = (ex, ey, rx, ry, rot = 0) => {
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-rx * .6, -ry * .5); ctx.lineTo(-rx * .1, 0); ctx.lineTo(rx * .3, -ry * .3); ctx.lineTo(rx * .6, ry * .5); ctx.stroke();
    ctx.restore();
  };
  // A little clock face instead of an eye — a bare circle with one sweeping
  // hand and a center pin. `handAngle` is the hand's own live angle, not a
  // static tilt, so a caller can spin it over time.
  const clockEye = (ex, ey, r, handAngle = 0) => {
    ctx.save(); ctx.translate(ex, ey);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.rotate(handAngle); line(0, 0, 0, -r * .8, 1); ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, r * .15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // Two generic decorative symbols, not tied to any one boss — droppable
  // onto any portrait as an extra detail, independent of eyes entirely.
  // A small inscribed rune — a tiny radiating tick cluster.
  const runeMark = (mx, my, r = 6, rot = 0) => {
    ctx.save(); ctx.translate(mx, my); ctx.rotate(rot); ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2 + Math.PI / 4); line(0, 0, 0, -r, 1); ctx.restore(); }
    ctx.restore();
  };
  // A small stamped sigil/wax-seal medallion.
  const sigilMark = (mx, my, r = 8) => {
    ctx.save(); ctx.translate(mx, my); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    line(-r * .5, -r * .4, r * .5, r * .4, 1); line(-r * .5, r * .4, r * .5, -r * .4, 1);
    ctx.restore();
  };

  if (type === 'hourglass') {
    ctx.save(); ctx.rotate(now * .10);
    for (let r = 30; r <= 58; r += 14) {
      ctx.setLineDash([Math.max(8, r * .3), 9]); ctx.lineWidth = r === 58 ? 2 : 1;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-24, -42); ctx.lineTo(24, -42); ctx.lineTo(4, -4); ctx.lineTo(24, 42);
    ctx.lineTo(-24, 42); ctx.lineTo(-4, -4); ctx.closePath();
    ctx.lineWidth = 2; ctx.stroke();
    line(-24, -42, 24, -42, 3); line(-24, 42, 24, 42, 3);
    // Corner rivets and neck braces — small fixed detail the eye can land
    // on, instead of the bowtie reading as two flat, empty triangles.
    ctx.globalAlpha = (ghost ? .35 : 1) * .7;
    for (const [cx2, cy2] of [[-20, -38], [20, -38], [-20, 38], [20, 38]]) { ctx.beginPath(); ctx.arc(cx2, cy2, 2, 0, Math.PI * 2); ctx.fill(); }
    line(-4, -4, -10, -12, 1); line(4, -4, 10, 4, 1);
    // A small ember rune mark right at the neck — same radial tick-mark
    // language Verdict/Oracle's own halos use, just enough to read as
    // inscribed/mystic rather than purely mechanical.
    ctx.save(); ctx.translate(-4, -4); ctx.strokeStyle = EMBER;
    ctx.globalAlpha = (ghost ? .35 : 1) * (.5 + .3 * Math.sin(now * 2));
    for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2 + Math.PI / 4); line(0, 0, 0, -6, 1); ctx.restore(); }
    ctx.restore();
    ctx.globalAlpha = ghost ? .35 : 1;
    // Little clock faces instead of gem-eyes — ticking hands fit "the sand
    // does not wait for you" far better than a jeweled facet does.
    clockEye(0, -18, 6, now * 1.2); clockEye(0, 18, 6, -now * 1.2 + Math.PI);
    // Falling embers, not sand — this is how long Erif lets itself last,
    // grain by grain.
    const sandT = (now * 1.3) % 1;
    ctx.fillStyle = EMBER;
    for (let i = 0; i < 4; i++) {
      const st = (sandT + i * .25) % 1;
      ctx.globalAlpha = (ghost ? .35 : 1) * (1 - st * .6);
      ctx.beginPath(); ctx.arc(0, -2 + st * 38, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = ghost ? .35 : 1;
  } else if (type === 'executioner') {
    // Alternating long/short blades instead of 8 identical rays — the
    // uniform ring was what made it read as a plain cartoon sun rather than
    // a bladed halo.
    ctx.save(); ctx.rotate(now * .08);
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 4);
      const tip = i % 2 === 0 ? -66 : -56;
      line(0, -34, 0, tip, 2); line(0, tip, -5, tip + 9, 1); line(0, tip, 5, tip + 9, 1);
      ctx.restore();
    }
    ctx.restore();
    // Robe peak raised into a real cowl point (-39 -> -58) so the hood
    // actually frames a face instead of the eyes sitting on a bare collar.
    ctx.beginPath(); ctx.moveTo(-24, 46); ctx.lineTo(-17, -20); ctx.lineTo(0, -58); ctx.lineTo(17, -20); ctx.lineTo(24, 46); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-15, -20); ctx.lineTo(0, -50); ctx.lineTo(15, -20); ctx.lineTo(10, -5); ctx.lineTo(-10, -5); ctx.closePath(); ctx.stroke();
    // A faceless pair of glowing ember slits instead of an eye() — reads as
    // a hooded, faceless executioner rather than anyone looking back.
    emberSlitEye(0, -24, 11);
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * 29, 13); ctx.rotate(side * -.12);
      line(0, -32, 0, 30, 4); line(0, -32, side * 11, -19, 2); line(0, 30, side * -7, 20, 2);
      ctx.restore();
    }
    // Horizontal plate seams instead of diagonal cloth-hatch — armor
    // banding, not fabric, and one less place reusing the same texture
    // language every robed boss already shares.
    for (let y = -2; y < 40; y += 9) line(-16 + y * .1, y, 16 - y * .1, y, 1);
  } else if (type === 'witness') {
    ctx.save(); ctx.rotate(now * .22);
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * Math.PI * 2 / 3);
      ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(-10, -40); ctx.lineTo(10, -40); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -70, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    // A hooded tribunal robe, not a bare circle — the plain arc gave it no
    // silhouette to speak of. Narrows to a neck around y=-20 before widening
    // into the hem, the same waist-taper every other robed lieutenant uses,
    // so it reads as a figure rather than a ball.
    ctx.beginPath();
    ctx.moveTo(-30, 44); ctx.quadraticCurveTo(-20, 6, -13, -20);
    ctx.quadraticCurveTo(0, -32, 13, -20);
    ctx.quadraticCurveTo(20, 6, 30, 44);
    ctx.closePath(); ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = (ghost ? .35 : 1) * .5;
    for (let y = -8; y <= 32; y += 11) { line(-22, y, -3, y - 3, 1); line(3, y - 3, 22, y, 1); }
    ctx.globalAlpha = ghost ? .35 : 1;
    // Eyes sewn shut instead of an eye() pair — fits "find the one that
    // actually saw it" far better than an eye that's actually watching.
    stitchedEye(-10, -12, 8, 5, -.25); stitchedEye(10, -12, 8, 5, .25);
    const handR = 60;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + now * .1; hand(Math.cos(a) * handR, Math.sin(a) * handR, a + Math.PI, i % 2 ? .8 : .66); }
    for (const [sx, sy, kind] of [[-20, 20, 0], [20, 20, 1], [0, -28, 2]]) {
      ctx.save(); ctx.translate(sx, sy); ctx.lineWidth = 1;
      if (kind === 0) { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke(); }
      else if (kind === 1) ctx.strokeRect(-5, -5, 10, 10);
      else { ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-6, 5); ctx.lineTo(6, 5); ctx.closePath(); ctx.stroke(); }
      ctx.restore();
    }
  } else if (type === 'oracle') {
    // Orbiting NUMBERED orbs, not plain tick marks — a direct callback to
    // the quiz's own numeric answer lanes (generateOracleQuestion/
    // newQuestion, hazards.js), same "portrait wears its own mechanic" move
    // Verdict's rings and Witness's badges already use.
    ctx.save(); ctx.rotate(now * .18);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.save(); ctx.rotate(a); ctx.translate(0, -78); ctx.rotate(-(now * .18 + a));
      ctx.globalAlpha = ghost ? .35 : .8; ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      text(`${i + 1}`, 0, 1, 11, 'center', ghost ? .35 : .85);
      ctx.restore();
    }
    ctx.restore();
    // A straight A-line taper (shoulders to hem), not a pointed-top rounded
    // bulge — the previous curve-heavy shape read as a literal eggplant
    // (narrow stem-like top, round bulging middle, flat bottom). A rounded
    // shoulder/collar line instead of a point, straight sides down to a
    // slightly flared hem, same "figure, not a blob" goal without the
    // vegetable silhouette.
    ctx.beginPath();
    ctx.moveTo(-20, -28); ctx.lineTo(-26, 48); ctx.lineTo(26, 48); ctx.lineTo(20, -28);
    ctx.quadraticCurveTo(0, -42, -20, -28);
    ctx.closePath(); ctx.stroke();
    // Robe hem stitching — same cross-hatch fabric texture Witness's own
    // robe uses, plain fabric rather than a flat, empty triangle.
    ctx.globalAlpha = (ghost ? .35 : 1) * .5;
    for (let y = 0; y <= 40; y += 10) { line(-25 + y * .12, y, -6 + y * .12, y - 4, 1); line(6 - y * .12, y - 4, 25 - y * .12, y, 1); }
    ctx.globalAlpha = ghost ? .35 : 1;
    // A chest amulet/collar, pulled down off the shoulder line (was -24,
    // crowding right up against the peak above it and reading as clipping)
    // — sits clearly on the chest now instead of jammed into the neck.
    // Nudged up a touch (-12 -> -17) so it isn't touching the scrying orb
    // just below it.
    ctx.beginPath(); ctx.arc(0, -17, 11, 0, Math.PI * 2); ctx.stroke();
    line(-10, -17, 10, -17, 3);
    // A third eye built as a farsight/compass-sight instead of an almond —
    // "the real eye among watchers," glowing brighter/blinking slower than
    // the flame-motes drifting below it. Raised (-46 -> -54) for real
    // clearance above the now-taller shoulder peak instead of crowding it.
    ctx.save(); ctx.globalAlpha = (ghost ? .35 : 1) * (.7 + .3 * Math.sin(now * .8));
    crosshairEye(0, -54, 6);
    ctx.restore();
    // Drifting flame-motes instead of orbiting eyes — small fires circling
    // the seer rather than more almond eyes. Tighter vertical range and
    // shifted down a touch (39 -> 30, +6) so the ring clears both the
    // shoulder peak and the third eye above it at every point in its
    // rotation, instead of drifting through them.
    for (let i = 0; i < 4; i++) { const a = now * .35 + i * Math.PI / 2; flameMote(Math.cos(a) * 53, 6 + Math.sin(a) * 30, .9); }
    // A glowing scrying orb instead of a flat rectangle tablet — an actual
    // mystic instrument rather than a blank slate.
    ctx.save(); ctx.translate(0, 14);
    const orbPulse = .5 + .5 * Math.sin(now * 3);
    ctx.globalAlpha = (ghost ? .35 : 1) * .3; ctx.fillStyle = EMBER;
    ctx.beginPath(); ctx.arc(0, 0, 20 + orbPulse * 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = ghost ? .35 : 1; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = (ghost ? .35 : 1) * .6;
    ctx.beginPath(); ctx.arc(-4, -5, 6, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
  } else if (type === 'archivist') {
    ctx.beginPath();
    ctx.moveTo(0, -46); ctx.lineTo(-46, -30); ctx.lineTo(-46, 38); ctx.lineTo(0, 50); ctx.lineTo(46, 38); ctx.lineTo(46, -30);
    ctx.closePath(); ctx.stroke();
    line(0, -46, 0, 50, 2);
    for (let y = -18; y <= 30; y += 12) { line(-36, y, -8, y - 4, 1); line(8, y - 4, 36, y, 1); }
    // A watching, tracking eye built like a farsight instead of an almond —
    // "what the ash remembers" is being cross-referenced, not just observed.
    crosshairEye(0, -6, 9);
    // A thin illuminated-manuscript sunburst around the centered eye,
    // instead of it floating bare on the page.
    ctx.save(); ctx.translate(0, -6); ctx.globalAlpha = (ghost ? .35 : 1) * .5; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * Math.PI / 4); line(0, -13, 0, -19, 1); ctx.restore(); }
    ctx.restore();
    // A wax seal medallion below the eye — an ancient, sealed tome.
    ctx.save(); ctx.globalAlpha = ghost ? .35 : .8;
    sigilMark(0, 16, 8);
    ctx.restore();
    // Orbiting memory-match glyphs — the exact same 5 shapes the Archivist's
    // own memory-match minigame uses (ECHO_SYMBOLS, bosses.js), replacing
    // the old plain orbiting eyes with a direct callback to its own
    // mechanic, same move as Verdict's rings/Oracle's numbered orbs.
    for (let i = 0; i < 5; i++) {
      const a = now * .25 + i * Math.PI * 2 / 5, ox = Math.cos(a) * 90, oy = Math.sin(a) * 68;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(a * 1.3 + now * .8); ctx.lineWidth = 1.3;
      const name = ECHO_SYMBOLS[i % ECHO_SYMBOLS.length];
      if (name === 'circle') { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke(); }
      else if (name === 'square') ctx.strokeRect(-5, -5, 10, 10);
      else if (name === 'triangle') { ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-6, 5); ctx.lineTo(6, 5); ctx.closePath(); ctx.stroke(); }
      else if (name === 'diamond') { ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.stroke(); }
      else { line(-5, -5, 5, 5, 1.3); line(-5, 5, 5, -5, 1.3); }
      ctx.restore();
    }
    // Orbiting tumbling pages — matches the book hazard from its own fight,
    // one ring further out than the eyes so they read as a distinct layer.
    for (let i = 0; i < 3; i++) {
      const a = -now * .3 + i * Math.PI * 2 / 3, ox = Math.cos(a) * 123, oy = Math.sin(a) * 90;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(a * 1.4 + now * 1.5); ctx.lineWidth = 1;
      ctx.strokeRect(-6, -8, 12, 16); line(0, -8, 0, 8, .5);
      ctx.restore();
    }
  } else if (type === 'mask') {
    // A slow tilt/sway, like it's studying you, plus both eyes drift
    // independently — the original design left this one nearly static.
    ctx.save(); ctx.rotate(Math.sin(now * .35) * .07);
    const bob = Math.sin(now * .5) * 2;

    // A ghostly mirrored duplicate drifting in and out of alignment — the
    // duality/mirror theme made visible on the portrait, not just in the
    // spear coloring during its own fight.
    ctx.save(); ctx.globalAlpha = (ghost ? .35 : 1) * .25; ctx.translate(Math.sin(now * .4) * 12, 0); ctx.scale(-1, 1);
    ctx.beginPath(); ctx.moveTo(0, -56 + bob); ctx.quadraticCurveTo(-44, -40 + bob, -40, bob); ctx.quadraticCurveTo(-40, 44 + bob, 0, 58 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -56 + bob); ctx.quadraticCurveTo(44, -40 + bob, 40, bob); ctx.quadraticCurveTo(40, 44 + bob, 0, 58 + bob); ctx.stroke();
    // A fuller phantom double — the ghost used to just trace the outer
    // silhouette; mirroring the eyes too makes it read as an actual second
    // face phasing through, not just an outline.
    ctx.beginPath(); ctx.ellipse(-18, -10 + bob, 8, 5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(18, -10 + bob, 8, 4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // Two thin counter-rotating rings — solid and dashed — reinforcing the
    // "two faces" theme without tiling the whole portrait in duplicate eyes.
    for (let i = 0; i < 2; i++) {
      ctx.save(); ctx.rotate((i ? -1 : 1) * now * .3 + i * Math.PI); ctx.lineWidth = 1.2;
      ctx.globalAlpha = (ghost ? .35 : 1) * .45;
      if (i) ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.ellipse(0, bob, 62 - i * 10, 66 - i * 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // A wide flat brow tapering to a single angular chin point, not a
    // rounded waist-pinched vase — the previous shape read as a smooth
    // gourd/blob rather than an actual mask silhouette. Widest across the
    // brow/cheek band (where the eyes sit), narrowing to one sharp point at
    // the chin — the classic ritual-mask outline.
    ctx.beginPath();
    ctx.moveTo(-40, -30 + bob);
    ctx.quadraticCurveTo(-44, -46 + bob, -20, -52 + bob);
    ctx.quadraticCurveTo(0, -56 + bob, 20, -52 + bob);
    ctx.quadraticCurveTo(44, -46 + bob, 40, -30 + bob);
    ctx.quadraticCurveTo(46, -4 + bob, 30, 20 + bob);
    ctx.quadraticCurveTo(22, 44 + bob, 0, 58 + bob);
    ctx.quadraticCurveTo(-22, 44 + bob, -30, 20 + bob);
    ctx.quadraticCurveTo(-46, -4 + bob, -40, -30 + bob);
    ctx.closePath(); ctx.stroke();
    line(0, -56 + bob, 0, 58 + bob, 2);
    // Cracked eyes instead of plain eye() — the face is already fractured
    // (see the crack lines below), so the eyes should already read as split
    // too, not smoothly intact.
    crackedEye(-18, -10 + bob, 8, 5, Math.sin(now * .8 + 2) * .25);
    ctx.beginPath(); ctx.moveTo(-28, 20 + bob); ctx.quadraticCurveTo(-18, 28 + bob, -8, 20 + bob); ctx.stroke();
    crackedEye(18, -10 + bob, 8, 4, Math.sin(now * .6) * .3);
    ctx.beginPath(); ctx.moveTo(8, 26 + bob); ctx.quadraticCurveTo(18, 16 + bob, 28, 26 + bob); ctx.stroke();
    for (let i = 0; i < 3; i++) { const yy = -32 + bob + i * 24; line(-3 + (i % 2 ? -2 : 2), yy, 3 + (i % 2 ? 2 : -2), yy + 10, 1); }
    // Ember-tinted fracture cracks across the face — its whole fight hazard
    // is a shattering shard, so the mask itself should already look
    // cracked, not just throw cracked pieces.
    const crackPulse = .5 + .5 * Math.sin(now * 1.4);
    ctx.save(); ctx.strokeStyle = EMBER; ctx.lineWidth = 1; ctx.globalAlpha = (ghost ? .35 : 1) * (.4 + .3 * crackPulse);
    ctx.beginPath(); ctx.moveTo(-6, -40 + bob); ctx.lineTo(2, -20 + bob); ctx.lineTo(-10, -4 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, -30 + bob); ctx.lineTo(24, -10 + bob); ctx.lineTo(16, 8 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-20, 10 + bob); ctx.lineTo(-10, 30 + bob); ctx.lineTo(-18, 46 + bob); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff';
    // Orbiting shard debris — the exact shape its own projectile uses (see
    // battle.spears' isShard rendering further down), tumbling around the
    // portrait, same "wears its own hazard" move Archivist's pages/Verdict's
    // rings/Oracle's numbered orbs all use.
    for (let i = 0; i < 3; i++) {
      const a = now * .22 + i * Math.PI * 2 / 3, ox = Math.cos(a) * 84, oy = Math.sin(a) * 60 + bob;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(a * 1.6 + now * 2);
      ctx.globalAlpha = ghost ? .35 : .8; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-1, -4); ctx.lineTo(6, 0); ctx.lineTo(-1, 4); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  } else if (type === 'verdict') {
    // A tribunal silhouette wearing the hazard itself as a halo — each ring
    // has a real open arc that slowly rotates, echoing the shrinking
    // ring/gap dodge directly instead of abstracting it into a plain dashed
    // circle (which read as a generic target reticle, not a judgment).
    // A round body (an oval, not a pointed-hood/flat-hem shield outline) —
    // the previous straight-bottomed hexagon read as a crest/shield rather
    // than a being, and clashed with its own perfectly circular ring halo.
    ctx.beginPath(); ctx.ellipse(0, 2, 46, 54, 0, 0, Math.PI * 2); ctx.stroke();
    line(0, -52, 0, 56, 1);
    ctx.globalAlpha = (ghost ? .35 : 1) * .45;
    for (let y = -2; y <= 44; y += 11) { line(-34 + y * .05, y, -14, y - 4, 1); line(14, y - 4, 34 - y * .05, y, 1); }
    ctx.globalAlpha = ghost ? .35 : 1;

    // Grown from 2 rings to 4 — not just more copies of the same ring, each
    // one is visually distinct (gap width, spin direction/speed, radius),
    // and the outer two are tilted crossing ellipses rather than flat
    // circles (same trick Erif's own orbit rings use), so this reads as
    // "wheels within wheels" — a genuinely grander judgment halo instead of
    // a bigger number of identical circles.
    const VERDICT_RINGS = [
      { rr: 68, gap: .55, dir: 1, speed: .18, tilt: 0, squash: 1, alpha: .85, width: 2 },
      { rr: 88, gap: .55, dir: -1, speed: .18, tilt: 0, squash: 1, alpha: .55, width: 1.5 },
      { rr: 106, gap: .32, dir: 1, speed: .12, tilt: Math.PI / 7, squash: .62, alpha: .5, width: 1.4 },
      { rr: 106, gap: .32, dir: -1, speed: .12, tilt: -Math.PI / 7, squash: .62, alpha: .5, width: 1.4 },
    ];
    for (const r of VERDICT_RINGS) {
      const spin = r.dir * now * r.speed;
      ctx.save(); ctx.rotate(r.tilt); ctx.lineWidth = r.width; ctx.globalAlpha = (ghost ? .35 : 1) * r.alpha;
      ctx.beginPath(); ctx.ellipse(0, 0, r.rr, r.rr * r.squash, 0, spin + r.gap, spin + Math.PI * 2 - r.gap); ctx.stroke();
      ctx.restore();
    }

    // Three faceted gem-eyes instead of the same almond eye() every other
    // boss already uses — a crystalline "eye of judgment" fits a tribunal
    // wearing a ring-halo of gaps far better than an organic eye would, and
    // shakes up the roster's repeated eye language. A smaller central gem
    // flanked by two temple gems, echoing the same many-eyes composition
    // Oracle/Archivist/Erif all use, just in a different material.
    gemEye(0, -28, 10);
    gemEye(-17, -20, 7, -.3); gemEye(17, -20, 7, .3);
    // A struck gavel-mark stands in for a mouth.
    line(-14, 22, 14, 22, 2.5); line(0, 8, 0, 22, 2.5);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2 - now * .07);
      line(0, -92, 0, -102, 2);
      ctx.restore();
    }
  } else if (type === 'gale') {
    // A robed wind-wraith, not a bare weathervane instrument — the compass
    // cross and rotating arrow below (a genuinely good, mechanically-
    // grounded idea, kept exactly as before) now belong to a figure wearing
    // them at chest height rather than being its entire physical form. The
    // eye stays fixed at the pivot, watching, while the arrow (and the wind
    // it trails) turns around it.
    const spin = now * .3;

    // Hood-to-shoulder taper on each side, left open rather than closed into
    // a solid hem — the lower robe dissolves into streaming wind-ribbons
    // instead of ever holding a fixed shape, in place of the old rigid post
    // and flared base.
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -56); ctx.quadraticCurveTo(-26, -44, -24, -18); ctx.quadraticCurveTo(-22, 0, -30, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -56); ctx.quadraticCurveTo(26, -44, 24, -18); ctx.quadraticCurveTo(22, 0, 30, 14); ctx.stroke();
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const bx = -30 + i * 20, sway = Math.sin(now * .8 + i * 1.3) * 6;
      ctx.beginPath();
      ctx.moveTo(bx * .77, 14);
      ctx.quadraticCurveTo(bx + sway, 40, bx * .5 + sway * 1.4, 64);
      ctx.stroke();
    }
    // A small curling wind-wisp up in the hood instead of a second eye — the
    // filled ember flame-mote read as a blood drop here, so this is an
    // unfilled curl of moving air instead, which also just fits Gale far
    // better than fire does. Stays subtly on the move while the fixed
    // pivot-eye below stays perfectly still.
    ctx.save(); ctx.translate(Math.sin(now * .5) * 4, -40); ctx.rotate(now * .6);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.quadraticCurveTo(0, -5, 4, -1); ctx.quadraticCurveTo(6, 3, 2, 4); ctx.stroke();
    ctx.restore();

    // Compass cross — four short fixed arms at N/E/S/W, each tipped with a
    // small ball, mounted a little below the arrow's own pivot.
    ctx.save(); ctx.translate(0, 20);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2);
      line(0, 0, 0, -20, 1.5);
      ctx.beginPath(); ctx.arc(0, -23, 2.6, 0, Math.PI * 2); i % 2 === 0 ? ctx.fill() : ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // A compass-sight eye, fixed at the arrow's own pivot point — the one
    // thing that doesn't turn while everything else does, built like the
    // instrument it watches over instead of an organic eye.
    crosshairEye(0, -12, 9);

    // The arrow itself, slowly and endlessly rotating around that same
    // pivot, hunting for a wind that never quite settles.
    ctx.save(); ctx.translate(0, -12); ctx.rotate(spin);
    line(-40, 0, 28, 0, 2.5);
    ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(26, -9); ctx.lineTo(26, 9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-26, -11); ctx.lineTo(-26, 11); ctx.closePath(); ctx.stroke();
    ctx.restore();
  } else if (type === 'erif') {
    // A menacing flame demon, not a mopey mask — backswept horns instead of
    // a crown, low angry brows, narrowed ember-glowing eyes throughout
    // (including the outer aura), and an open fanged snarl instead of the
    // old neutral/frowning mouth. "Structured chaos" is kept for the outer
    // rings — nested, with eyes only at symmetric cardinal points rather
    // than tiled everywhere — so even his chaos keeps a chessboard-like
    // order, fitting a demon lord of wits rather than a raw eldritch mass.
    const rot = now * .16, rot2 = -now * .11, ga = ghost ? .35 : 1;

    // Great feathered wings, biblical in scale — drawn first (and thus
    // furthest back — the body/aura/mouth all layer on top of the roots,
    // reading as wings unfurling from behind him rather than pasted in
    // front). A small ember eye glows at each feather tip, tying the "wings
    // covered in eyes" seraphim/ophanim imagery directly into his own
    // many-eyes motif rather than being a bare bolt-on.
    ctx.save(); ctx.lineWidth = 1.8;
    const WING_TIP_X = [40, 95, 145, 185], WING_TIP_Y = [-50, -85, -100, -95];
    for (const side of [-1, 1]) {
      ctx.save(); ctx.globalAlpha = ga * .85;
      const rootX = side * 16, rootY = 8;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      for (let i = 0; i < WING_TIP_X.length; i++) {
        const tx = side * WING_TIP_X[i], ty = WING_TIP_Y[i];
        ctx.quadraticCurveTo(side * WING_TIP_X[i] * .55, (rootY + ty) * .4, tx, ty);
      }
      // Scalloped trailing edge back to the root — reads as a row of
      // individual feathers rather than one solid membrane.
      for (let i = WING_TIP_X.length - 1; i >= 0; i--) {
        ctx.quadraticCurveTo(side * WING_TIP_X[i] * .8, WING_TIP_Y[i] + 10, side * WING_TIP_X[i] * .62, WING_TIP_Y[i] + 26);
      }
      ctx.closePath(); ctx.stroke();
      // Feather separator lines, root to (just short of) each tip.
      for (let i = 0; i < WING_TIP_X.length; i++) {
        ctx.save(); ctx.globalAlpha = ga * .5;
        line(rootX, rootY, side * WING_TIP_X[i], WING_TIP_Y[i] + 14, 1);
        ctx.restore();
      }
      ctx.fillStyle = EMBER;
      for (let i = 0; i < WING_TIP_X.length; i++) {
        ctx.save(); ctx.globalAlpha = ga * (.55 + .3 * Math.sin(now * 2 + i + side));
        ctx.beginPath(); ctx.arc(side * WING_TIP_X[i] * .85, WING_TIP_Y[i] + 8, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    ctx.restore();

    // A slow ember pulse behind everything else, hotter and wider than a
    // lieutenant's — he IS the source flame, so the heat radiating off him
    // should be felt, not just implied.
    const pulse = .5 + .5 * Math.sin(now * 1.6);
    ctx.save(); ctx.globalAlpha = ga * (.16 + .14 * pulse); ctx.strokeStyle = EMBER; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 4, 122 + pulse * 10, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff';

    // Two curved backswept horns, ember-lit at the tips, with a few small
    // jagged spikes between them so the headdress still reads as full
    // rather than just two horns stuck on a bald head.
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(side * 22, -52);
      ctx.quadraticCurveTo(side * 58, -78, side * 50, -108);
      ctx.quadraticCurveTo(side * 44, -88, side * 30, -60);
      ctx.closePath();
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = ga * (.6 + .35 * Math.sin(now * 3 + side)); ctx.fillStyle = EMBER;
      ctx.beginPath(); ctx.arc(side * 50, -108, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.restore();
    }
    for (let i = 0; i < 3; i++) {
      const bx = -14 + i * 14, tipY = -72 - (i === 1 ? 8 : 0);
      ctx.beginPath(); ctx.moveTo(bx - 6, -52); ctx.lineTo(bx, tipY); ctx.lineTo(bx + 6, -52); ctx.stroke();
    }

    // Two sparse nested rings, four burning eyes apiece at cardinal/ordinal
    // points — an aura of watching embers, not just decorative dashes. Three
    // crossing orbits (tilted at different fixed angles, each still slowly
    // spinning) instead of two flat concentric ones — a more direct nod to
    // the previous game's many-ringed "World" boss than the sparser 2-ring
    // version was, blended with Erif's own identity rather than replacing
    // it: the face/horns/crown stay exactly what he is, the orbits are just
    // a wilder halo around that core now.
    const ORBIT_TILTS = [0, Math.PI / 3, -Math.PI / 3];
    for (let ring = 0; ring < 3; ring++) {
      const rr = 68 + ring * 14, a0 = (ring % 2 ? -1 : 1) * now * (.14 + ring * .03);
      ctx.save(); ctx.rotate(ORBIT_TILTS[ring]);
      ctx.setLineDash([10, 8]); ctx.lineWidth = 1.5; ctx.globalAlpha = ga * .8;
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * .68, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = EMBER;
      for (let i = 0; i < 4; i++) {
        // Only the inner two rings (8 eyes total) are tied to eyesLeft — the
        // outer ring stays a fixed decorative flourish regardless of HP, so
        // the icon never goes fully eyeless while the fight's still going.
        const flatIndex = ring * 4 + i;
        if (eyesLeft !== null && ring < 2 && flatIndex >= eyesLeft) continue;
        const a = a0 + i * Math.PI / 2 + (ring ? Math.PI / 4 : 0);
        eye(Math.cos(a) * rr, Math.sin(a) * rr * .68, 4.5, 2.6, a);
      }
      ctx.fillStyle = '#fff';
      ctx.restore();
    }

    // Core body — a plain circle now instead of the old tapered jaw shape,
    // cracks kept (still glowing ember, fire leaking out) but the eyebrows
    // are gone and the old single pair of eyes is replaced below.
    ctx.beginPath(); ctx.arc(0, 4, 56, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.stroke();
    // Cracked all over now, not just two seams near the top — reads as
    // actually breaking apart rather than just having one old wound.
    ctx.save(); ctx.globalAlpha = ga * (.5 + .3 * pulse); ctx.strokeStyle = EMBER; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-14, 6); ctx.lineTo(-6, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(16, 4); ctx.lineTo(10, 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-30, -20); ctx.lineTo(-40, -2); ctx.lineTo(-32, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, -18); ctx.lineTo(42, 0); ctx.lineTo(34, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-20, 20); ctx.lineTo(-30, 36); ctx.lineTo(-18, 48); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, 18); ctx.lineTo(32, 34); ctx.lineTo(20, 46); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, 44); ctx.lineTo(6, 54); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff';

    // Eight eyes on his face now — the exact almond/heavy-lid/slit-pupil
    // shape the intro cutscene's watching eyes use (see drawIntroScene),
    // just smaller and arranged in a ring that spins continuously instead
    // of drifting slowly around the whole screen. Each eye keeps that same
    // small independent sway rather than pointing radially outward, so they
    // read as the same watching eyes, not just another orbiting-eye ring
    // like the ones further out.
    // Moved up (was centered lower, y=-2) to leave real room for a much
    // bigger mouth below instead of crowding it.
    const faceSpin = now * .5;
    for (let i = 0; i < 8; i++) {
      // The obvious, prominent eyes — this is what actually reads as "his
      // eyes" at a glance, unlike the small ember dots further out on the
      // orbit rings, so this is the loop that has to respect eyesLeft.
      if (eyesLeft !== null && i >= eyesLeft) continue;
      const a = faceSpin + i * Math.PI / 4;
      const ex = Math.cos(a) * 34, ey = -18 + Math.sin(a) * 17;
      const wob = Math.sin(now * .3 + i * 3) * .15;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(wob);
      ctx.globalAlpha = ga * .9; ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = .9;
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.quadraticCurveTo(-2.2, -3.3, 0, -3);
      ctx.quadraticCurveTo(2.2, -3.3, 5, 0);
      ctx.quadraticCurveTo(2.2, 2.5, 0, 2.8);
      ctx.quadraticCurveTo(-2.2, 2.5, -5, 0);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.4, -.6); ctx.quadraticCurveTo(0, -3.9, 4.4, -.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -2.3); ctx.quadraticCurveTo(.7, 0, 0, 2.3); ctx.quadraticCurveTo(-.7, 0, 0, -2.3);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = ga * .8;
      ctx.beginPath(); ctx.arc(-.8, -.8, .45, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = ga;
    // A much bigger, wider-open maw — was a thin close-lipped crescent,
    // now a real gaping mouth with two interlocking rows of fangs instead
    // of one shallow zigzag. Moved up a touch, and the outer curve pulled in
    // (control point 78 -> 70) — a quadratic curve's actual on-curve depth
    // is only halfway to its control point, not the control point itself,
    // so the teeth below were previously placed well past where the curve
    // actually reaches at their x-position, sticking out past the outline
    // instead of sitting inside it framed by it.
    // A slow jaw open/close — scales the whole mouth (curves and both fang
    // rows together) vertically around the fixed top lip line (y=18) rather
    // than recomputing every point, so it reads as one breathing motion
    // instead of the teeth resizing independently of the mouth outline.
    // Held fully open (no breathing) instead while the mouth laser is
    // telegraphing/active (beamPhase, only ever set by drawErifHeadHUD's own
    // call during the Reckoning) — reads as locked/straining rather than
    // idly panting right as it's about to (or is actively) firing.
    ctx.save();
    ctx.translate(0, 18); ctx.scale(1, beamPhase ? 1 : lerp(.4, 1, (Math.sin(now * .4) + 1) / 2)); ctx.translate(0, -18);
    ctx.beginPath();
    ctx.moveTo(-27, 18);
    ctx.quadraticCurveTo(0, 70, 27, 18);
    ctx.quadraticCurveTo(0, 30, -27, 18);
    ctx.closePath();
    if (beamPhase === 'telegraph') {
      // Same pulse formula as drawErifBeam's own telegraph rendering, so the
      // mouth and the warning wedge visibly pulse in lockstep.
      const pulse = .4 + .4 * Math.abs(Math.sin(performance.now() / 90));
      ctx.fillStyle = EMBER; ctx.globalAlpha = ga * pulse; ctx.fill(); ctx.globalAlpha = ga;
    } else if (beamPhase === 'active') {
      // Same soft-glow-behind-bright-core language drawErifBeam's own active
      // rendering uses — reads as the literal source of the beam drawn
      // radiating outward from roughly this same point.
      ctx.fillStyle = EMBER; ctx.globalAlpha = ga * .6; ctx.fill(); ctx.globalAlpha = ga;
      ctx.fillStyle = '#fff'; ctx.globalAlpha = ga * .85;
      ctx.beginPath(); ctx.ellipse(0, 26, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = ga; ctx.fillStyle = '#000';
    } else {
      ctx.fillStyle = '#000'; ctx.fill();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke();
    // Upper fangs hang from the inner (roof) curve.
    ctx.beginPath();
    for (let x = -21; x <= 21; x += 10.5) { ctx.moveTo(x - 4, 23); ctx.lineTo(x, 33); ctx.lineTo(x + 4, 23); }
    ctx.stroke();
    // Lower fangs rise from the outer (floor) curve, offset so they interlock with the uppers.
    ctx.beginPath();
    for (let x = -15.75; x <= 15.75; x += 10.5) { ctx.moveTo(x - 4, 37); ctx.lineTo(x, 27); ctx.lineTo(x + 4, 37); }
    ctx.stroke();
    ctx.restore();
    // Left over as '#000' from the mouth fill above — without resetting it,
    // the lettered emblem circles below (text() never sets fillStyle itself)
    // rendered their letters in black, invisible against the black background.
    ctx.fillStyle = '#fff';

    // Eight lettered lieutenant emblems, enlarged — matches the ward-socket
    // glyphs. Tied to eyesLeft same as the face eyes above, so the live
    // Reckoning HUD (drawErifHeadHUD) loses one of these too each time a
    // hand actually breaks.
    const names = typeof REPRISE_ORDER !== 'undefined' ? REPRISE_ORDER : [];
    for (let i = 0; i < names.length; i++) {
      if (eyesLeft !== null && i >= eyesLeft) continue;
      const a = rot * 1.3 + i * Math.PI / (names.length / 2), ox = Math.cos(a) * 104, oy = Math.sin(a) * 78;
      ctx.save(); ctx.lineWidth = 1.5; ctx.globalAlpha = ga * .85;
      ctx.beginPath(); ctx.arc(ox, oy, 12, 0, Math.PI * 2); ctx.stroke();
      if (names[i]) text(names[i][0].toUpperCase(), ox, oy + 1, 13, 'center', ga * .85);
      ctx.restore();
    }

    // Faint reaching lines outward — he could close the distance if he wanted to.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + rot2;
      ctx.save(); ctx.globalAlpha = ga * .3;
      line(Math.cos(a) * 116, Math.sin(a) * 82, Math.cos(a) * 142, Math.sin(a) * 100, 1.5);
      ctx.restore();
    }
  } else {
    // Placeholder for lieutenants/Erif not yet built.
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.stroke();
    eye(0, 0, 14, 8);
  }
  ctx.restore();
}

// The one place this game mixes in real hue instead of monochrome+ember —
// the flame itself, as a continuous HP readout. Full health reads warm
// yellow, fading toward ember red as HP drops to nothing; a blue overlay
// during the post-hit invulnerability window (battle.hurtTimer > 0) is a
// distinct, unambiguous "you can't be hit right now" signal.
const FLAME_FULL_COLOR = '#ffd23f';
const FLAME_INVULN_COLOR = '#57c7ff';
function lerpColor(hex1, hex2, t) {
  const c1 = parseInt(hex1.slice(1), 16), c2 = parseInt(hex2.slice(1), 16);
  const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t));
  const g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t));
  const b = Math.round(lerp(c1 & 255, c2 & 255, t));
  return `rgb(${r},${g},${b})`;
}

// How far drawFlame's own effective center shifts down as it shrinks toward
// the fixed base point it's anchored to (see drawFlame's own comment) — a
// shared helper so anything else anchored near the flame (drawSoulGlow's own
// call site) can follow the exact same downward drift instead of staying
// pinned to where the flame's center sits at full HP.
function flameShrinkDrop(baseScale, hpFrac) {
  const scale = baseScale * lerp(.6, 1, clamp(hpFrac, 0, 1));
  return 9 * (baseScale - scale);
}
// Feeds drawFlame's own wobble a "warped" time instead of real wall-clock
// time — a persistent accumulator that advances by real elapsed time times
// a per-cycle random speed (0.75x-1.25x), re-rolled every time the fast
// wobble term (frequency 9) completes a full cycle. Accumulating instead of
// resetting the phase each cycle keeps both sine terms perfectly continuous
// — only the RATE changes at each cycle boundary, never a visible jump.
let flameWobbleLastT = null, flameWobbleAccum = 0, flameWobbleMult = 1, flameWobbleNextBoundary = (Math.PI * 2) / 9;
function flameWobbleWarpedT(t) {
  if (flameWobbleLastT === null) flameWobbleLastT = t;
  flameWobbleAccum += Math.max(0, t - flameWobbleLastT) * flameWobbleMult;
  flameWobbleLastT = t;
  if (flameWobbleAccum >= flameWobbleNextBoundary) {
    flameWobbleMult = rand(.75, 1.25);
    flameWobbleNextBoundary += (Math.PI * 2) / 9;
  }
  return flameWobbleAccum;
}
// The player's avatar in both exploration and battle — a small guttering
// flame ("a fragile spark of wit") rather than the source game's heart.
function drawFlame(x, y, scale = 1, hpFrac = 1, invuln = false) {
  // Shrinks up to 40% as HP drops toward 1 (the core highlight shrinks
  // right along with it, since it's drawn using this same already-shrunk
  // scale) — the flame itself should gutter down, not just fade color, as
  // it burns low. Anchored so the BASE stays put and only the tip pulls
  // down/in as it shrinks, instead of shrinking symmetrically around (x,y)
  // — that used to lift the whole flame's base up off the wick, floating.
  const baseScale = scale;
  const baseDrop = flameShrinkDrop(baseScale, hpFrac);
  scale = baseScale * lerp(.6, 1, clamp(hpFrac, 0, 1));
  ctx.save(); ctx.translate(x, y + baseDrop);
  const t = performance.now() / 1000;
  const wt = flameWobbleWarpedT(t);
  const wobble = (Math.sin(wt * 9) * 1.4 + Math.sin(wt * 3.3) * .6) * scale;
  const tipY = -13 * scale;
  ctx.fillStyle = invuln ? FLAME_INVULN_COLOR : lerpColor(FLAME_FULL_COLOR, EMBER, 1 - clamp(hpFrac, 0, 1));
  ctx.beginPath();
  ctx.moveTo(0, 9 * scale);
  ctx.bezierCurveTo(-8 * scale, 4 * scale, -7 * scale, -5 * scale, wobble, tipY);
  ctx.bezierCurveTo(7 * scale, -5 * scale, 8 * scale, 4 * scale, 0, 9 * scale);
  ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 5 * scale);
  ctx.bezierCurveTo(-3 * scale, 1 * scale, -3 * scale, -3 * scale, wobble * .6, -7 * scale);
  ctx.bezierCurveTo(3 * scale, -3 * scale, 3 * scale, 1 * scale, 0, 5 * scale);
  ctx.stroke();
  // A brighter core, stretched up toward the tip — using a warm pale gold
  // instead of stark white, so it reads as heat rather than a flat white
  // patch, and tall enough to actually fill the flame's own silhouette
  // instead of leaving a bare gap above it.
  ctx.globalAlpha = .4; ctx.fillStyle = '#fff6c2';
  ctx.beginPath(); ctx.ellipse(wobble * .3, -1 * scale, 3 * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// The full avatar: a candle beneath the flame. The wax pillar's height is
// driven by hpFrac (current HP / max HP) so the candle visibly burns down as
// the player takes hits — battle-core.js shrinks the actual collision radius
// in lockstep, so "less candle left" also reads as "smaller, harder to hit."
// The flame itself is always drawn at the same (x,y) as drawFlame's own
// callers used to, so the collision point never moves — only the wax beneath
// it grows or shrinks.
// The player's own small, subtle flame-glow — the SAME small glow
// everywhere the candle avatar appears (title screen, intro cutscene, hub
// exploration, battle) rather than a separate, much bigger "ambient" version
// on the non-gameplay screens; a quiet sense of the flame casting a little
// light of its own, not a centerpiece competing with everything else on
// screen. Slightly elliptical (taller than wide) and centered a couple px
// above the candle's own anchor, matching drawFlame's actual shape/center —
// a true circle centered on the candle's base wouldn't actually match it.
// `dimMult` (0-1) additionally shrinks/dims it further on top of `scale` —
// only battle's own HP-based guttering ever passes anything but 1.
function drawSoulGlow(x, y, scale = 1, dimMult = 1) {
  const t = performance.now() / 1000;
  // The base rate (.7) is one full pulse every ~9s (2π/.7). A slow secondary
  // oscillator (~57s cycle) drifts the actual rate between 1x and 1.4x that
  // — so it's sometimes up to 40% quicker (as fast as a ~6.4s cycle) — for a
  // less mechanically-constant, more organic flicker instead of one fixed
  // tempo forever.
  const pulseSpeedMult = 1 + .4 * (.5 + .5 * Math.sin(t * .11));
  const pulse = .5 + .5 * Math.sin(t * .7 * pulseSpeedMult);
  const mult = scale * dimMult * .81; // another 10% off on top of the earlier size cut
  const outerR = (18 + pulse * 3) * mult, innerR = (9 + pulse * 2) * mult;
  ctx.save();
  // Another 10% off across the board, on top of the earlier cuts.
  ctx.globalAlpha = (.0373248 + .017915904 * pulse) * dimMult; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.ellipse(x, y - 2 * scale, outerR, outerR * 1.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = (.05971968 + .02985984 * pulse) * dimMult; ctx.fillStyle = FLAME_FULL_COLOR;
  ctx.beginPath(); ctx.ellipse(x, y - 2 * scale, innerR, innerR * 1.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawCandle(x, y, scale = 1, hpFrac = 1, invuln = false) {
  // Kept deliberately small — the wax is set dressing, not the hitbox. The
  // collision circle (see battle-core's updateBattle) stays centered on this
  // same (x,y) anchor with radius 4.5-7, matching the flame/wick above the
  // wax — the same "vulnerable core, not the full sprite" convention already
  // used for Convergence hits (see convergenceCircleHit). A smaller candle
  // keeps that circle reading as proportionate to what's drawn instead of
  // looking like it's floating inside an oversized body.
  const frac = clamp(hpFrac, 0, 1);
  const wickY = 4 * scale, bodyH = lerp(4, 11, frac) * scale, baseY = wickY + bodyH, bodyW = 8 * scale;

  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = .5;
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + 1.5 * scale, wickY);
  ctx.lineTo(-bodyW / 2, wickY + 3 * scale);
  ctx.lineTo(-bodyW / 2, baseY);
  ctx.lineTo(bodyW / 2, baseY);
  ctx.lineTo(bodyW / 2, wickY + 3 * scale);
  ctx.lineTo(bodyW / 2 - 1.5 * scale, wickY);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  if (bodyH > 5 * scale) {
    // A highlight/shadow pair instead of one flat grey seam down the middle
    // — reads as a rounded wax cylinder catching light on one side and
    // falling into shadow on the other, instead of a single smudged line.
    // Highlight on the right (same side as the drip) and shadow on the
    // left — the drip reads better sitting in the "lit" side than fighting
    // the shadow line for the same space.
    ctx.save();
    ctx.strokeStyle = '#000'; ctx.globalAlpha = .35;
    line(-bodyW / 2 + 1.6 * scale, wickY + 3 * scale, -bodyW / 2 + 1.6 * scale, baseY - 1.5 * scale, .9);
    ctx.strokeStyle = '#fff'; ctx.globalAlpha = .4;
    line(bodyW / 2 - 1.6 * scale, wickY + 3 * scale, bodyW / 2 - 1.6 * scale, baseY - 1.5 * scale, .9);
    // A faint pooled-wax rim right at the base — smaller and fainter than
    // before, just a hint rather than a distinct ring.
    ctx.globalAlpha = .15; ctx.lineWidth = .5;
    ctx.beginPath(); ctx.ellipse(0, baseY - .4 * scale, bodyW / 2 - 1.4 * scale, .5 * scale, 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }
  // The drip disappears entirely below 1/3 HP — not enough wax left for a
  // visible drip to make sense, and it sidesteps a real bug: at very low
  // bodyH, the drip's fixed vertical offset could place it above the
  // remaining wax entirely, reading as disconnected/floating.
  if (frac > 1 / 3) {
    // A small wax drip on the opposite side, up toward the top and nudged
    // left of the edge — the wax is melting unevenly, not a perfectly
    // uniform pillar. Open at the top (no stroke closing it off there)
    // instead of a fully-closed shape — same convention artists use for a
    // drip still attached to a surface: fill() closes the gap implicitly
    // for solid color, but stroke() only traces the two curves actually
    // drawn, leaving the top open rather than capped with a seam.
    const dripY = wickY + 3 * scale + bodyH * .5 - 5.5 * scale, dripX = bodyW / 2 - 2.1 * scale;
    // Shrinks up to 50% as the candle itself shrinks toward that same 1/3
    // HP threshold — a smaller candle should drip smaller drops, not the
    // same size regardless, right up until it disappears entirely. Anchored
    // at (dripX, dripY), its own attachment point, so it shrinks toward
    // where it clings to the wax rather than drifting off it.
    const dripScale = lerp(.5, 1, clamp((frac - 1 / 3) / (1 - 1 / 3), 0, 1));
    const dripGap = .4 * scale * dripScale;
    ctx.beginPath();
    ctx.moveTo(dripX + dripGap, dripY);
    ctx.quadraticCurveTo(dripX + 1.5 * scale * dripScale, dripY + 2.25 * scale * dripScale, dripX, dripY + 3.75 * scale * dripScale);
    ctx.quadraticCurveTo(dripX - 1.5 * scale * dripScale, dripY + 2.25 * scale * dripScale, dripX - dripGap, dripY);
    ctx.fill(); ctx.lineWidth = .5; ctx.stroke(); ctx.lineWidth = 1;
  }
  // A slight bend instead of a perfectly straight vertical wick — reads as
  // hand-lit/organic rather than a ruler-drawn line.
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, wickY); ctx.lineTo(.6 * scale, wickY - 1.5 * scale); ctx.lineTo(-.3 * scale, wickY - 3 * scale);
  ctx.stroke();
  ctx.restore();

  // Smaller than the raw scale, to match the candle body beneath it. Another
  // 10% off on top of that (see battle.soul.r, battle-core.js, shrunk the
  // same 10% to match).
  drawFlame(x, y, scale * .585 * .9, hpFrac, invuln);
}

// A faint trail of wax dabs left behind as the candle moves — one shared
// buffer works fine since only one avatar (hub player or battle soul) ever
// renders in a given frame. A large jump between calls (room transition,
// fight start) clears the buffer instead of connecting across it, so a
// teleport never draws a false streak across the screen.
// Anchored at the candle's actual base (bottom of the wax), not (x,y) itself
// — that's the flame's anchor, near the top — using the same wickY/bodyH
// math as drawCandle so the trail visually drags from the wax, not the fire.
let candleTrail = [];
// Tracked separately from candleTrail itself — the buffer empties out on its
// own once every dot has faded, and using its last *entry* as "have we
// spawned before" meant standing still would look empty for a moment, read
// as "never spawned," and spawn a fresh dot anyway — repeating forever
// while stationary. This persists across that emptying so it doesn't happen.
let candleTrailLastPos = null;
const CANDLE_TRAIL_LIFE = 380;
function drawCandleTrail(x, y, scale, hpFrac = 1) {
  const baseY = (4 + lerp(4, 11, clamp(hpFrac, 0, 1))) * scale;
  const bx = x, by = y + baseY;
  const now = performance.now();
  if (!candleTrailLastPos) {
    candleTrail.push({ x: bx, y: by, t: now, scale, rot: rand(0, Math.PI * 2) });
    candleTrailLastPos = { x: bx, y: by };
  } else {
    const d = dist(bx, by, candleTrailLastPos.x, candleTrailLastPos.y);
    if (d > 260) { candleTrail.length = 0; candleTrailLastPos = { x: bx, y: by }; } // a teleport, not a walk
    else if (d > 6) { candleTrail.push({ x: bx, y: by, t: now, scale, rot: rand(0, Math.PI * 2) }); candleTrailLastPos = { x: bx, y: by }; }
  }
  candleTrail = candleTrail.filter(p => now - p.t < CANDLE_TRAIL_LIFE);
  ctx.save(); ctx.fillStyle = '#fff';
  for (const p of candleTrail) {
    const ageFrac = (now - p.t) / CANDLE_TRAIL_LIFE;
    ctx.globalAlpha = (1 - ageFrac) * .5;
    // 3.75 (was 2.5, itself already 25% bigger than the original fixed 2) —
    // another 50% on top — shrinking to nothing right as it finishes fading,
    // instead of staying a constant size the whole time and just blinking
    // out at the end. Each dab keeps its own fixed random rotation (set once
    // at creation, see the push() calls above) instead of every square
    // sitting perfectly axis-aligned.
    const s = lerp(3.75, 0, ageFrac) * p.scale;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.restore();
}

// A shared, lightweight rising-ember particle layer — one module-level
// array reused across contexts (title screen, battle-arena floor, a burst
// off the flame on taking a hit) rather than three separate systems, same
// "single shared array, only one context ever actually drawing" convention
// candleTrail above already relies on. Each ember drifts upward with a
// gentle horizontal sway and fades in, then out, over its short lifetime —
// deliberately sparse/low-alpha to match drawAmbientMotes' (hub.js) existing
// ambient-particle density rather than reading as a fire-effect spectacle.
let embers = [];
function spawnEmber(x, y, opts = {}) {
  const { speed = [10, 26], size = [1, 2.6], life = [1.1, 2.2] } = opts;
  const lifeVal = rand(life[0], life[1]);
  embers.push({
    x, baseX: x, y,
    vy: -rand(speed[0], speed[1]),
    swayAmp: rand(4, 11), swaySpeed: rand(.6, 1.6), swayPhase: rand(0, Math.PI * 2),
    r: rand(size[0], size[1]),
    life: lifeVal, maxLife: lifeVal,
  });
}
function updateEmbers(dt) {
  const t = performance.now() / 1000;
  for (const e of embers) {
    e.y += e.vy * dt;
    e.x = e.baseX + Math.sin(t * e.swaySpeed + e.swayPhase) * e.swayAmp;
    e.life -= dt;
  }
  embers = embers.filter(e => e.life > 0);
}
function drawEmbers() {
  ctx.save();
  for (const e of embers) {
    const elapsed = 1 - clamp(e.life / e.maxLife, 0, 1);
    // Quick fade in (first 15% of life), hold, quick fade out (last 40%) —
    // avoids a hard pop-in/pop-out at either end.
    const a = elapsed < .15 ? elapsed / .15 : (elapsed > .6 ? clamp((1 - elapsed) / .4, 0, 1) : 1);
    ctx.globalAlpha = a * .22; ctx.fillStyle = EMBER;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.2, 0, Math.PI * 2); ctx.fill(); // soft halo
    ctx.globalAlpha = a * .7; ctx.fillStyle = FLAME_FULL_COLOR;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * .55, 0, Math.PI * 2); ctx.fill(); // bright core
  }
  ctx.restore();
}

// During Erif's Reprise, battle.type is always 'erif' — this resolves
// which lieutenant mechanic is *currently* driving the fight, so per-mechanic
// HUD (shield glyph, quiz lanes, help text) still shows correctly. Outside
// Erif's fight, it's just battle.type unchanged.
function activeMechanic() {
  if (battle.type === 'erif' && typeof REPRISE_ORDER !== 'undefined' && battle.phase < REPRISE_ORDER.length) {
    return REPRISE_ORDER[battle.phase];
  }
  return battle.type;
}

// Status/tooltip lines (the "what's happening right now" readout for
// whichever mechanic is active) all share this one y so there's a real,
// consistent gap under the boss name above them, and a consistent gap above
// the arena box below them — battle.box.y is set 14px lower than it used to
// be (see battle-core.js/erif.js) specifically to make room for this.
const STATUS_Y = 224;
// Every standalone fight's box (and Erif's own Reprise/Convergence phases)
// sits at the same fixed y=249, so a flat 224 (25px above it) always lined
// up. Enraged/Final Convergence use a much taller box that grows upward
// from a fixed bottom edge instead (see ERIF_ENRAGE_BOX, erif.js), so its
// own top edge moves — the flat 224 fell inside that box instead of above
// it, landing right on top of whatever sigil/hazard was near the top
// (this is what read as "the tip is bugged in the middle of the screen").
// Tracks the box's own current top edge for any Erif battle instead (still
// exactly 224 for the standard-box phases, since 249-25=224), clamped so it
// can't creep above y=20 even once the box's own top runs off-canvas.
function statusY() {
  if (battle && battle.type === 'erif') return Math.max(20, battle.box.y - 25);
  return STATUS_Y;
}

// The Reckoning (Hard-only true final phase, see erif.js) — a forearm +
// palm + 4 fingers (1 thumb, 3 pointers, see HAND_FINGERS), oriented along
// hand.facing. State-driven look: not drawn at all once 'gone' (broken for
// the rest of this wave, or the whole fight — it's meant to actually
// disappear), dim/fading out while retreating there, dim/fading in while
// equipping, normal while wandering/emerging (fingers visibly charging — a
// small ember tip glows in once a finger is past 70% charged, the same
// fingertip a shot actually fires from), a faint ember "hunting" ring while
// chasing/telegraphing a slam, a solid fist + pulsing ember ring (tinted
// ember instead of white once it's already taken one hit) while actually
// vulnerable.
function drawErifHand(hand) {
  if (hand.state === 'gone') return;
  const vulnerable = hand.state === 'vulnerable';
  // "damaged" (was "fleeing") — the hand used to actually run once it'd
  // taken one hit, but it now holds completely still for the whole window
  // regardless; this is just an ember tint marking "already hurt, one more
  // hit breaks it."
  const damaged = vulnerable && hand.hp < HAND_WARD_HP;
  const chasing = hand.state === 'chasing' || hand.state === 'slamTelegraph';
  const equipProgress = hand.state === 'equipping' ? 1 - clamp(hand.stateT / EQUIP_TIME, 0, 1) : 1;
  const parked = hand.state === 'retreating' || hand.state === 'recharging';
  const alpha = parked ? .3 : lerp(.35, 1, equipProgress);

  // The slam's warning ring lives at the frozen impact point, not on the
  // hand itself — it needs to read clearly even while the hand is still
  // closing the last bit of distance to hover over it.
  if (hand.state === 'slamTelegraph') {
    const pct = 1 - clamp(hand.stateT / SLAM_TELEGRAPH_TIME, 0, 1);
    ctx.save();
    ctx.globalAlpha = .25 + .5 * pct; ctx.strokeStyle = EMBER; ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(hand.slamTargetX, hand.slamTargetY, 20 + pct * 60, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(hand.x, hand.y); ctx.rotate(hand.facing);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = damaged ? EMBER : '#fff';
  ctx.lineWidth = 2;
  line(-8, 0, -34, 0, 6); // forearm, trailing behind facing

  for (let i = 0; i < HAND_FINGERS.length; i++) {
    const cfg = HAND_FINGERS[i], f = hand.fingers[i];
    // A small knuckle gap instead of starting every finger line at the
    // literal center — 4 lines converging exactly where the ward letter
    // renders was cluttering it. Purely cosmetic: fingerTipPos (erif.js)
    // computes the actual firing origin the same way regardless.
    const kx = Math.cos(cfg.angle) * 9, ky = Math.sin(cfg.angle) * 9;
    const fx = Math.cos(cfg.angle) * f.reach, fy = Math.sin(cfg.angle) * f.reach;
    ctx.strokeStyle = damaged ? EMBER : '#fff';
    line(kx, ky, fx, fy, cfg.thumb ? 5 : 4);
    const chargePct = clamp(f.chargeT / FINGER_CHARGE_TIME, 0, 1);
    if (hand.state === 'wandering' && chargePct > .7) {
      ctx.save(); ctx.globalAlpha = alpha * (chargePct - .7) / .3; ctx.fillStyle = EMBER;
      ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); // palm
  if (vulnerable) { ctx.fillStyle = damaged ? EMBER : '#fff'; ctx.fill(); }
  ctx.stroke();
  ctx.restore();

  if (vulnerable) {
    const pulse = .55 + .45 * Math.abs(Math.sin(performance.now() / 150));
    ctx.save(); ctx.globalAlpha = pulse; ctx.strokeStyle = EMBER; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (chasing) {
    ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = EMBER; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, 27, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (hand.state === 'recharging') {
    // A filling progress arc at the dock so "how much longer" reads at a
    // glance instead of the hand just sitting there dim for 5 flat seconds.
    const pct = 1 - clamp(hand.stateT / HAND_RECHARGE_TIME, 0, 1);
    ctx.save(); ctx.globalAlpha = .55; ctx.strokeStyle = EMBER; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, 26, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  if (hand.ward) {
    // text() never sets its own fillStyle — without an explicit one here it
    // was inheriting whatever was last set, which reads as plain white most
    // of the time. When the palm is filled solid white (vulnerable, not
    // damaged) that silently rendered the letter white-on-white and made it
    // unreadable exactly when identifying the ward matters most. Saved/
    // restored (wasn't before) since this can set black — left unrestored,
    // that leaked into every later same-frame text() call that doesn't set
    // its own fillStyle (the fight timer among them), rendering it invisible
    // right as a hand went vulnerable, i.e. right after every slam.
    ctx.save();
    ctx.fillStyle = (vulnerable && !damaged) ? '#000' : '#fff';
    text(hand.ward[0].toUpperCase(), hand.x, hand.y + 1, 16, 'center', alpha * (vulnerable ? .85 : 1));
    ctx.restore();
    const pipW = 12, gap = 3, total = HAND_WARD_HP * (pipW + gap) - gap, startX = hand.x - total / 2;
    for (let i = 0; i < HAND_WARD_HP; i++) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.strokeRect(startX + i * (pipW + gap), hand.y - 42, pipW, 10);
      if (i < hand.hp) ctx.fillRect(startX + i * (pipW + gap) + 2, hand.y - 40, pipW - 4, 6);
      ctx.restore();
    }
  }
}

// Erif's actual head — reuses the same drawBossIcon('erif', ...) portrait as
// the header everywhere else, always drawn fully opaque (ghost=false, see
// the note below on why the old ghost dimming can't be used for a partial
// alpha) at a much bigger scale so it reads as a real presence throughout
// the fight rather than a faint background icon. It's never a player
// target anymore — HP only ever drops automatically when a hand breaks
// (see handleErifPunch, erif.js) — so the only feedback it needs is a
// brief white flash right on the moment of that automatic hit
// (battle.erifHeadHitFlashT) plus its own visible HP pip row.
function drawErifHeadHUD() {
  const hx = battle.erifHeadX, hy = battle.erifHeadY;
  if (battle.erifHeadHitFlashT > 0) {
    const p = clamp(battle.erifHeadHitFlashT / .3, 0, 1);
    ctx.save(); ctx.globalAlpha = p; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hx, hy, (70 + (1 - p) * 20) * (ERIF_HEAD_SCALE / .5), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // drawBossIcon sets its own globalAlpha internally off the `ghost` flag
  // (ghost ? .35 : 1), overriding anything set before calling it — so
  // getting a baseline alpha here means passing ghost=false outright rather
  // than trying to wrap the call in an outer alpha, which drawBossIcon would
  // just stomp. Full opacity reads as "part of the fight" even more
  // directly than a partial dim would have.
  drawBossIcon('erif', hx, hy, false, ERIF_HEAD_SCALE, battle.erifHeadHp, battle.erifBeamPhase);

  // Pulled closer to the head (132 -> 85) and framed in EMBER — nothing
  // previously marked this specifically as ERIF'S OWN hp (as opposed to,
  // say, a hand's own ward-hp pips just above it), so at a glance it read as
  // just another anonymous pip row rather than clearly his.
  const pipW = 13, gap = 3, total = battle.erifHeadMaxHp * (pipW + gap) - gap, startX = hx - total / 2, pipY = hy + 40 + 110 * ERIF_HEAD_SCALE;
  ctx.save(); ctx.strokeStyle = EMBER; ctx.lineWidth = 1.5;
  ctx.strokeRect(startX - 5, pipY - 5, total + 10, 22);
  ctx.restore();
  for (let i = 0; i < battle.erifHeadMaxHp; i++) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(startX + i * (pipW + gap), pipY, pipW, 12);
    if (i < battle.erifHeadHp) ctx.fillRect(startX + i * (pipW + gap) + 2, pipY + 2, pipW - 4, 8);
    ctx.restore();
  }
}

// The Reckoning's universal wall-bounce projectile (see spawnErifBounceBall/
// updateErifBounceBalls, erif.js) — a bigger glow+core than a regular
// bullet so its larger hitbox reads as a real threat, ember-outlined so it
// stays visually distinct from the plain white bullets/ink-rain.
function drawErifBounceBall(ball) {
  ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = EMBER; ctx.lineWidth = 1.5; ctx.stroke();
}

// The Reckoning's rarer gem-shard variant (see spawnErifGemShard/
// updateErifGemShards, erif.js) — same faceted judgment-gem shape as
// drawBossIcon's own gemEye (Verdict/Hourglass), just as a standalone
// function since gemEye is scoped inside drawBossIcon. Same glow language
// as the bounce ball above so it still reads as one of Erif's own
// projectiles, just visibly heavier/more angular.
function drawErifGemShard(shard) {
  const r = shard.r * 1.7, spin = performance.now() / 1000 * shard.spin;
  ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.arc(shard.x, shard.y, r * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(shard.x, shard.y); ctx.rotate(spin);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r * .7, -r * .3); ctx.lineTo(r * .7, r * .3); ctx.lineTo(0, r); ctx.lineTo(-r * .7, r * .3); ctx.lineTo(-r * .7, -r * .3);
  ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = EMBER; ctx.lineWidth = .6;
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r * .7, -r * .3); ctx.lineTo(r * .7, r * .3); ctx.moveTo(r * .7, -r * .3); ctx.lineTo(-r * .7, r * .3); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, 0, r * .28, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// One of Erif's own eyes (see spawnErifEyeBall/updateErifEyeBalls, erif.js) —
// same glow+ember-outline language as the bounce ball above, just bigger,
// with a small dark pupil so it reads as an eye rather than a plain ball.
function drawErifEyeBall(eye) {
  ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.arc(eye.x, eye.y, eye.r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(eye.x, eye.y, eye.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = EMBER; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(eye.x, eye.y, eye.r * .4, 0, Math.PI * 2); ctx.fill();
}

// Erif's mouth laser (see battle.erifBeamPhase/erifBeamAngle, erif.js) — a
// rotating wedge of danger from the mouth's own local offset out to
// ERIF_BEAM_REACH, one full rotation and then it stops. During 'telegraph'
// this is just an outlined, pulsing, non-damaging indicator locked to the
// angle it's about to fire at (see updateErifHandHazards for the state
// machine) — real warning before it actually goes live. Once 'active' it's
// the solid version: same soft-glow-behind-bright-core language as the eye/
// bounce balls above, just stretched into an arc instead of a circle — a
// wide, dim EMBER wedge for the glow, a narrower brighter white core wedge
// on top so it still reads clearly against the glow at any distance.
function drawErifBeam() {
  const ox = battle.erifHeadX, oy = battle.erifHeadY + ERIF_BEAM_MOUTH_OFFSET_Y * ERIF_HEAD_SCALE;
  if (battle.erifBeamPhase === 'telegraph') {
    const pulse = .4 + .4 * Math.abs(Math.sin(performance.now() / 90));
    ctx.save(); ctx.globalAlpha = pulse; ctx.strokeStyle = EMBER; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, ERIF_BEAM_REACH, battle.erifBeamAngle - ERIF_BEAM_HALF_WIDTH, battle.erifBeamAngle + ERIF_BEAM_HALF_WIDTH);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save(); ctx.globalAlpha = .3; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, ERIF_BEAM_REACH, battle.erifBeamAngle - ERIF_BEAM_HALF_WIDTH, battle.erifBeamAngle + ERIF_BEAM_HALF_WIDTH);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .65; ctx.fillStyle = '#fff';
  const coreHalf = ERIF_BEAM_HALF_WIDTH * .4;
  ctx.beginPath(); ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, ERIF_BEAM_REACH, battle.erifBeamAngle - coreHalf, battle.erifBeamAngle + coreHalf);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Purely atmospheric — no hitbox, no gameplay interaction — for Final
// Convergence specifically: Erif himself drifts slowly in the background,
// and a pair of his own hands idly float in the margins outside the box,
// left and right. Underlines that the Reckoning is coming without adding
// any real difficulty here — and without reading as an active threat, so
// they just drift rather than reaching for or gripping anything.
// Reuses the Reckoning's own hand visual language (forearm + the same
// 1-thumb/3-pointer fanned spread, see drawErifHand/HAND_FINGERS in erif.js)
// rather than an unrelated shape — meant to read as literally the same
// hands the player will fight later, not just something hand-shaped. Half
// the size of an earlier "gripping the frame" version of this that didn't
// read well.
const FLOATING_HAND_SCALE = 1.05;
function drawErifFloatingHand(px, py, facing) {
  ctx.save();
  ctx.translate(px, py); ctx.rotate(facing); ctx.scale(FLOATING_HAND_SCALE, FLOATING_HAND_SCALE);
  ctx.globalAlpha = .4; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  line(-8, 0, -34, 0, 6); // forearm
  for (let i = 0; i < HAND_FINGERS.length; i++) {
    const cfg = HAND_FINGERS[i];
    const kx = Math.cos(cfg.angle) * 9, ky = Math.sin(cfg.angle) * 9;
    const reach = (cfg.reachMin + cfg.reachMax) / 2; // relaxed, half-open — not reaching for anything
    line(kx, ky, Math.cos(cfg.angle) * reach, Math.sin(cfg.angle) * reach, cfg.thumb ? 5 : 4);
  }
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawFinalConvergenceErifPresence() {
  const t = battle.t;
  const driftT = t * .12;
  drawBossIcon('erif', W / 2 + Math.sin(driftT) * 260, 300 + Math.cos(driftT * .7) * 90, true, .85);
  // Each hand wanders within its own side's margin outside the box (the box
  // spans x=140 to 820 here — see ERIF_ENRAGE_BOX, erif.js — leaving a
  // 140px-wide strip on either side), never crossing into it. Drift speed
  // 25% faster than the original pass (.17/.13/.15/.11 -> .2125/.1625/
  // .1875/.1375), plus a slow continuous rotation on top of the existing
  // wobble instead of just easing back and forth in place.
  drawErifFloatingHand(70 + Math.sin(t * .2125) * 45, H / 2 + Math.sin(t * .1625) * 240, Math.sin(t * .1125) * .5 + t * .05);
  drawErifFloatingHand(W - 70 + Math.sin(t * .1875 + 2) * 45, H / 2 + Math.sin(t * .1375 + 3) * 240, Math.PI + Math.sin(t * .125 + 1) * .5 - t * .04);
}
function drawBattle() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  const b = battle.box; drawFloorGrid(b.x, b.y, b.w, b.h);
  drawEmbers(); // background layer — behind every hazard/boss/candle drawn below
  // Erif's own twist/Reckoning-intro dialogues (mode === 'erifTwist', both
  // of them — see startErifTwist/startErifReckoningIntro, erif.js) run
  // entirely on top of drawBattle without battle.phase ever advancing off
  // PHASE_FINAL_CONVERGENCE until the Reckoning itself actually begins (see
  // beginErifTrueFinal) — so without this flag, several stale Final-
  // Convergence-only visuals (the floating hands/drifting Erif backdrop,
  // the HP row, the fight timer, the phase name, the capture-count title)
  // all kept showing/rendering whatever they last were the instant Final
  // Convergence ended, instead of disappearing until the real fight starts.
  const hideErifTwistHud = battle.type === 'erif' && mode === 'erifTwist';
  if (battle.type === 'erif' && battle.phase === PHASE_FINAL_CONVERGENCE && !hideErifTwistHud) drawFinalConvergenceErifPresence();
  // Enraged onward (Enraged, Final Convergence, the Reckoning) all skip the
  // header — the arena is tall enough from Enraged on (see ERIF_ENRAGE_BOX,
  // erif.js) that there isn't room for both it and the box, and Erif's own
  // name/portrait were already shown plenty by that point in the fight.
  if (!(battle.type === 'erif' && battle.phase >= PHASE_ENRAGED)) {
    // Scaled down further and nudged up — some portraits (Erif's orbiting
    // emblem ring, the Verdict's rotating halo) reach far enough down at full
    // size that even the previous .82 scale still collided with the name text
    // right below it.
    drawBossIcon(battle.type, W / 2, 98, false, .68);
    text(BOSS[battle.type].display, W / 2, 200, 25);
  }
  box(b.x, b.y, b.w, b.h, 4);

  for (const r of battle.rings) {
    // Left unclipped, deliberately — the shrinking ring itself is the
    // Hourglass's advance telegraph. Seeing the gap's angle while the ring
    // is still huge and far outside the box is the whole point; clipping it
    // to the box would hide that until it's nearly too late to react.
    const count = Math.max(1, r.gapCount || 1), step = Math.PI * 2 / count;
    // A soft ember glow riding just behind the actual line — a wider, dimmer
    // second stroke — so the shrinking arc reads as hot metal in motion
    // instead of a flat vector line.
    ctx.save(); ctx.strokeStyle = EMBER; ctx.globalAlpha = .22; ctx.lineWidth = r.w + 5;
    for (let i = 0; i < count; i++) {
      const start = r.gapA + i * step + r.gap, end = r.gapA + (i + 1) * step - r.gap;
      ctx.beginPath(); ctx.arc(r.cx, r.cy, r.r, start, end); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = r.w;
    for (let i = 0; i < count; i++) {
      const start = r.gapA + i * step + r.gap, end = r.gapA + (i + 1) * step - r.gap;
      ctx.beginPath(); ctx.arc(r.cx, r.cy, r.r, start, end); ctx.stroke();
      // Occasional embers flaking off the arc as it shrinks — sparse, so it
      // reads as texture rather than a second hazard to track.
      if (Math.random() < .012) {
        const a = rand(start, end);
        spawnEmber(r.cx + Math.cos(a) * r.r, r.cy + Math.sin(a) * r.r, { speed: [4, 14], life: [.5, 1] });
      }
    }
  }

  if (battle.galeGustPhase) {
    // Left unclipped, same reasoning as the ring above — the wind's source
    // direction needs to read before it's already on top of you, not once
    // it's crossed into the box.
    const dir = battle.galeWindDir, active = battle.galeGustPhase === 'active';
    const pct = clamp(battle.galeGustTimer / (battle.galeGustMax || 1), 0, 1);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    // A big, low-opacity arrow centered in the arena instead of a small one
    // anchored just outside the box edge — that one could clip into the
    // header text above the box (or anything below it) depending on which
    // side the wind came from. This one sits entirely inside the box,
    // behind every hazard drawn after it, so it's always readable no
    // matter what else is on screen.
    const angle = dir === 'up' ? -Math.PI / 2 : dir === 'down' ? Math.PI / 2 : dir === 'left' ? Math.PI : 0;
    const size = Math.min(b.w, b.h) * (active ? .5 : .34 + .12 * (1 - pct));
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.globalAlpha = active ? .24 : .12 + .08 * Math.abs(Math.sin(performance.now() / 200));
    ctx.fillStyle = active ? EMBER : '#fff';
    ctx.beginPath();
    ctx.moveTo(size * .55, 0);
    ctx.lineTo(size * .15, -size * .32);
    ctx.lineTo(size * .15, -size * .12);
    ctx.lineTo(-size * .55, -size * .12);
    ctx.lineTo(-size * .55, size * .12);
    ctx.lineTo(size * .15, size * .12);
    ctx.lineTo(size * .15, size * .32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // A shrinking duration bar across the top of the box while the gust is
    // actively pushing/inverting — the arrow alone only says which way the
    // wind is blowing, not how much longer it'll last.
    if (active) {
      ctx.save();
      ctx.globalAlpha = .85; ctx.fillStyle = EMBER;
      ctx.fillRect(b.x, b.y - 9, b.w * pct, 4);
      ctx.strokeStyle = '#fff'; ctx.globalAlpha = .3; ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y - 9, b.w, 4);
      ctx.restore();
    }
  }

  // Everything below is clipped to a padded region around the box, not the
  // box itself — a straight clip-to-the-box made hazards pop seamlessly
  // into view right as they crossed the edge, which reads fine when
  // standing near the middle but leaves almost no reaction time when
  // you're already close to that edge yourself. PAD gives a real, visible
  // lead-in (the fastest spears cover it in ~0.3s, everything slower gets
  // more) instead of either extreme — not clipped so tight hazards seem to
  // teleport in, not left fully unclipped so far-off spawn points render in
  // empty space with no frame of reference. Lifted again before the
  // Witness's hands/shape zones/sigils/etc., which are meant to stay
  // visible even where they extend past the box on purpose.
  const PAD = 140;
  ctx.save();
  ctx.beginPath(); ctx.rect(b.x - PAD, b.y - PAD, b.w + PAD * 2, b.h + PAD * 2); ctx.clip();

  for (const t of battle.telegraphs) {
    // A Mask telegraph tints ember and grows a faint duplicate line while its
    // mirror is active — this (plus the same tint on the launched shard) is
    // now the only mirror tell; the old corner glyph was redundant with it
    // and got removed. maskMirrored can't flip while a telegraph is pending
    // (see updateMask), so this reads as stable/honest for the telegraph's
    // whole lifetime.
    // Enraged (see updateEnraged, erif.js) routes every spear through
    // launchMaskSpear regardless of family — "the Mask's mirror keeps
    // flipping in the background" for the whole phase, not just spears
    // tagged family 'mask' — so the color tell has to cover all of them
    // there too. Without this, Enraged telegraphs that actually resolved as
    // a lie were still always rendered white (honest), since none of them
    // carry family === 'mask'. Same gap during Erif's own Reprise mask
    // segment — updateMask there is called with battle.type still 'erif',
    // not 'mask', so the (!t.family && battle.type==='mask') case never
    // matched and mirrored telegraphs (though correctly mirrored once
    // launched — see launchMaskSpear) rendered honest white right up until
    // they fired.
    const isMask = t.family === 'mask' || (!t.family && battle.type === 'mask') ||
      (battle.type === 'erif' && (battle.phase === PHASE_ENRAGED || REPRISE_ORDER[battle.phase] === 'mask'));
    const lying = isMask && battle.maskMirrored;
    // The line shrinks from full length down to nothing right as it fires,
    // instead of staying a fixed length and just blinking — with several
    // telegraphs queued at once, a static line gives no sense of which one
    // is about to land first, but a shrinking one reads as a countdown.
    const pct = clamp(t.t / (t.maxT || 1), 0, 1), len = 42 * pct, lieLen = 30 * pct;
    ctx.save(); ctx.globalAlpha = .35 + .45 * Math.abs(Math.sin(performance.now() / 55)); ctx.lineWidth = 2;
    ctx.strokeStyle = lying ? EMBER : '#fff'; ctx.fillStyle = lying ? EMBER : '#fff';
    if (t.side === 'up' || t.side === 'down') {
      const edgeY = t.side === 'up' ? b.y : b.y + b.h, tipY = t.side === 'up' ? b.y + len : b.y + b.h - len;
      line(t.x, edgeY, t.x, tipY, 2);
      if (lying) { ctx.globalAlpha *= .5; line(t.x + 6, edgeY, t.x + 6, t.side === 'up' ? b.y + lieLen : b.y + b.h - lieLen, 1.5); ctx.globalAlpha = .35 + .45 * Math.abs(Math.sin(performance.now() / 55)); }
    } else {
      const edgeX = t.side === 'left' ? b.x : b.x + b.w, tipX = t.side === 'left' ? b.x + len : b.x + b.w - len;
      line(edgeX, t.y, tipX, t.y, 2);
      if (lying) { ctx.globalAlpha *= .5; line(edgeX, t.y + 6, t.side === 'left' ? b.x + lieLen : b.x + b.w - lieLen, t.y + 6, 1.5); ctx.globalAlpha = .35 + .45 * Math.abs(Math.sin(performance.now() / 55)); }
    }
    ctx.restore();
  }
  for (const p of battle.spears) {
    // Executioner spears are honest steel: a heavy shaft with a hilt.
    // Mask shards are fractured crystal, doubled to suggest a reflection —
    // ember-tinted when the one that actually landed was a mirrored lie.
    const isShard = p.kind === 'shard';
    const ang = Math.atan2(p.vy, p.vx), speed = Math.hypot(p.vx, p.vy);
    const trailLen = clamp(speed * .045, 14, 34);
    ctx.save(); ctx.globalAlpha = .3; ctx.strokeStyle = isShard ? EMBER : '#fff';
    line(p.x, p.y, p.x - Math.cos(ang) * trailLen, p.y - Math.sin(ang) * trailLen, isShard ? 2 : 3);
    ctx.restore();

    const shrinkS = hazardShrinkScale(p.ageExpireT, p.ageShrinkWindow);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.scale(shrinkS, shrinkS);
    if (isShard) {
      ctx.strokeStyle = p.lying ? EMBER : '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-2, -6); ctx.lineTo(9, 0); ctx.lineTo(-2, 6); ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = .55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-4, -3); ctx.lineTo(2, 0); ctx.lineTo(-4, 3); ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = '#fff';
      line(-13, 0, 13, 0, 3); line(13, 0, 5, -6, 2); line(13, 0, 5, 6, 2);
      line(-13, -4, -13, 4, 2);
    }
    ctx.restore();
  }
  for (const w of battle.maskShards) {
    // A drifting fragment of the mask, distinct from a launched spear shard —
    // hollow diamond core with a slow-pulsing outer ring, unblockable by the
    // shield (see updateMaskShards, bosses.js), so it reads purely as a dodge.
    const shrinkS = hazardShrinkScale(w.ageExpireT, w.ageShrinkWindow);
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.wobble); ctx.scale(shrinkS, shrinkS);
    ctx.globalAlpha = .85; ctx.strokeStyle = EMBER; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = .3 + .15 * Math.sin(performance.now() / 160);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  for (const g of battle.sandGrains) {
    // A single falling grain of sand — dodged by position, not the shield,
    // so it's deliberately plain: a small ember with a faint trail above it
    // showing where it fell from, nothing to read beyond "don't stand here."
    const shrinkS = hazardShrinkScale(g.ageExpireT, g.ageShrinkWindow);
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(shrinkS, shrinkS); ctx.globalAlpha = .9; ctx.fillStyle = EMBER;
    ctx.beginPath(); ctx.arc(0, 0, g.r * .55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = EMBER;
    // 3 jittered strands instead of one static line — a heavier "falling
    // sand" look. Jitter is derived from the grain's own (constant, since it
    // falls straight down) x/r rather than a per-frame random, so it doesn't
    // flicker while the grain is in flight.
    const seed = (g.x * 7 + g.r * 13) % 5;
    for (let k = 0; k < 3; k++) {
      const off = (((seed + k * 1.7) % 3) - 1) * 1.6;
      ctx.globalAlpha = .28 - k * .08;
      line(off, -g.r * 2.4, off, -g.r * .6, 1);
    }
    ctx.restore();
  }
  for (const o of battle.hourglassOrbs) {
    // A small hourglass, tumbling as it drifts — two facing triangles pinched
    // at a narrow neck, matching the boss's own icon rather than reading as
    // a generic shard or grain.
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.spin);
    // Shape was authored at r=11 with these hardcoded coordinates — it never
    // actually got bigger through every later size increase to o.r itself
    // (only the hitbox did). Scaling by the orb's real current radius here
    // is what makes it visually match.
    const hgScale = o.r / 11 * hazardShrinkScale(o.ageExpireT, o.ageShrinkWindow);
    ctx.scale(hgScale, hgScale);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(1.5, 0); ctx.lineTo(8, 9);
    ctx.lineTo(-8, 9); ctx.lineTo(-1.5, 0); ctx.closePath();
    ctx.stroke();
    line(-8, -9, 8, -9, 2); line(-8, 9, 8, 9, 2);
    ctx.globalAlpha = .5; ctx.fillStyle = EMBER;
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const f of battle.galeFlags) {
    // A pennant on a short pole, oriented along its current heading — the
    // Gale's own projectile now that spears are gone. It curves as it
    // homes, so this is drawn fresh off its live velocity every frame
    // rather than a fixed spawn-time angle.
    const ang = Math.atan2(f.vy, f.vx), shrinkS = hazardShrinkScale(f.ageExpireT, f.ageShrinkWindow);
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang); ctx.scale(shrinkS, shrinkS);
    ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
    line(9, 0, -9, 0, 1.5);
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-3, -8); ctx.lineTo(-3, 2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  for (const w of battle.windLines) {
    if (!w.fired) {
      // Countdown telegraph, anchored right at the box edge — same
      // shrinking-line convention as every other telegraph in the game.
      const pct = clamp(w.t / (w.maxT || 1), 0, 1), len = 30 * pct;
      let ex, ey, nx, ny;
      if (w.dir === 'up') { ex = b.x + w.pos; ey = b.y; nx = 0; ny = -1; }
      else if (w.dir === 'down') { ex = b.x + w.pos; ey = b.y + b.h; nx = 0; ny = 1; }
      else if (w.dir === 'left') { ex = b.x; ey = b.y + w.pos; nx = -1; ny = 0; }
      else { ex = b.x + b.w; ey = b.y + w.pos; nx = 1; ny = 0; }
      ctx.save(); ctx.globalAlpha = .4 + .4 * Math.abs(Math.sin(performance.now() / 55)); ctx.strokeStyle = '#fff';
      line(ex, ey, ex + nx * len, ey + ny * len, 2);
      ctx.restore();
    } else {
      // A real curving trail, not a straight streak — sampled at several
      // earlier points along the same wave (windLineXY's travelOverride)
      // so the S-shape it actually swept through is visible, the way a
      // gust bends a line of blown debris rather than firing it dead straight.
      // Shrinks toward its own leading point (not the box origin) over its
      // last-50%-of-lifetime window, same as every other capped hazard —
      // translate to the head first and draw the rest of the trail relative
      // to it so ctx.scale collapses the whole streak inward on itself
      // instead of sliding it toward the box's (0,0).
      const head = windLineXY(w, b), shrinkS = hazardShrinkScale(w.ageExpireT, w.ageShrinkWindow);
      ctx.save(); ctx.translate(head.x, head.y); ctx.scale(shrinkS, shrinkS);
      ctx.globalAlpha = .8; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 42; k += 7) {
        const p = windLineXY(w, b, Math.max(0, w.travel - k));
        if (k === 0) ctx.moveTo(0, 0); else ctx.lineTo(p.x - head.x, p.y - head.y);
      }
      ctx.globalAlpha = .8; ctx.stroke();
      ctx.restore();
    }
  }
  for (const p of battle.echoBookTrail) {
    ctx.save(); ctx.globalAlpha = clamp(p.t / 2, 0, 1) * .5; ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.restore();
  }
  for (const w of battle.echoBooks) {
    // A loose book, tumbling as it flies — matches the Archivist rather than
    // a generic ink blot, and the tumble makes its motion read clearly.
    const rot = Math.atan2(w.vy, w.vx) + w.wobble * w.spin * .3, shrinkS = hazardShrinkScale(w.ageExpireT, w.ageShrinkWindow);
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(rot); ctx.scale(shrinkS, shrinkS);
    // Regular tumbling book: make it larger (2x)
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.fillRect(-9, -12, 18, 24); ctx.strokeRect(-9, -12, 18, 24);
    ctx.globalAlpha = .7;
    for (let px = -6; px <= 6; px += 4) line(px, -9, px, 9, 1);
    ctx.globalAlpha = 1;
    line(0, -12, 0, 12, 3); // spine
    ctx.restore();
  }
  for (const t of battle.trailSquares) {
    // The weaving book's actual hazard — unlike the regular book's harmless
    // dust (echoBookTrail above), these are real hitboxes, so they get
    // ember outlines instead of soft white dust to read as dangerous.
    const p = clamp(t.t / 1.8, 0, 1);
    ctx.save(); ctx.globalAlpha = .3 + .5 * p; ctx.strokeStyle = EMBER; ctx.lineWidth = 1.5;
    ctx.strokeRect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
    ctx.restore();
  }
  for (const w of battle.weavingBooks) {
    // Ember-tinted (vs. the regular book's plain white) and drawn with a
    // faint curving trail sampled back along its own weave, so the motion
    // that's dropping the trail squares actually reads as a weave rather
    // than a random tumble.
    ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = EMBER;
    ctx.beginPath();
    for (let k = 0; k <= 36; k += 6) {
      const p = weavingBookXY({ ...w, travel: Math.max(0, w.travel - k) });
      if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
    const shrinkS = hazardShrinkScale(w.ageExpireT, w.ageShrinkWindow);
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot); ctx.scale(shrinkS, shrinkS);
    // Weaving book (ember/red) — keep original (smaller) size
    ctx.fillStyle = EMBER; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.fillRect(-4.5, -6, 9, 12); ctx.strokeRect(-4.5, -6, 9, 12);
    ctx.globalAlpha = .7; ctx.strokeStyle = '#000';
    for (let px = -3; px <= 3; px += 2) line(px, -4.5, px, 4.5, .5);
    ctx.globalAlpha = 1;
    line(0, -6, 0, 6, 1.5); // spine
    ctx.restore();
  }
  for (const p of [...battle.bullets, ...battle.aimedBullets]) {
    const speed = Math.hypot(p.vx, p.vy), ang = Math.atan2(p.vy, p.vx);
    const shrinkS = hazardShrinkScale(p.ageExpireT, p.ageShrinkWindow);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(shrinkS, shrinkS);
    ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = '#fff';
    line(0, 0, -Math.cos(ang) * clamp(speed * .035, 8, 24), -Math.sin(ang) * clamp(speed * .035, 8, 24), 2);
    ctx.restore();
    // A soft ember glow halo behind the bright core — was a flat filled
    // circle, reads as a hot spark now instead of a plain dot.
    ctx.save(); ctx.globalAlpha = .3; ctx.fillStyle = EMBER;
    ctx.beginPath(); ctx.arc(0, 0, p.r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const ball of battle.erifBounceBalls) drawErifBounceBall(ball);
  for (const shard of battle.erifGemShards) drawErifGemShard(shard);
  for (const eye of battle.erifEyeBalls) drawErifEyeBall(eye);
  if (battle.erifBeamPhase) drawErifBeam();
  for (const m of battle.marks) {
    const pct = clamp(m.t / .68, 0, 1);
    ctx.save(); ctx.globalAlpha = .45 + .5 * (1 - pct); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, 18 + 24 * pct, 0, Math.PI * 2); ctx.stroke();
    line(m.x - 15, m.y, m.x + 15, m.y, 2); line(m.x, m.y - 15, m.x, m.y + 15, 2);
    ctx.restore();
  }
  for (const bl of battle.blasts) {
    // Grows from half size up to full size across its life instead of
    // popping in at full size instantly — matches the hitbox scale computed
    // in updateConvergenceMarks (erif.js).
    const scale = lerp(.5, 1, clamp(1 - bl.t / (bl.maxT || .40), 0, 1));
    ctx.save(); ctx.globalAlpha = clamp(bl.t / .18, 0, 1);
    ctx.fillRect(bl.x - 10 * scale, bl.y - 64 * scale, 20 * scale, 128 * scale);
    ctx.fillRect(bl.x - 64 * scale, bl.y - 10 * scale, 128 * scale, 20 * scale);
    ctx.restore();
  }

  for (const q of battle.shapes) {
    const speed = Math.hypot(q.vx, q.vy), ang = Math.atan2(q.vy, q.vx);
    ctx.save(); ctx.globalAlpha = .3; ctx.strokeStyle = '#fff';
    line(q.x, q.y, q.x - Math.cos(ang) * clamp(speed * .03, 6, 18), q.y - Math.sin(ang) * clamp(speed * .03, 6, 18), 1.5);
    ctx.restore();
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a || 0); ctx.lineWidth = 2;
    if (q.type === 'circle') { ctx.beginPath(); ctx.arc(0, 0, q.size, 0, Math.PI * 2); ctx.stroke(); }
    else if (q.type === 'square') ctx.strokeRect(-q.size, -q.size, q.size * 2, q.size * 2);
    else { ctx.beginPath(); ctx.moveTo(0, -q.size); ctx.lineTo(-q.size, q.size); ctx.lineTo(q.size, q.size); ctx.closePath(); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore(); // ends the box-clip opened above the telegraphs loop

  if (battle.type === 'erif' && battle.phase === PHASE_LAST_WAGER) {
    drawErifHeadHUD();
    for (const hand of battle.erifHands) drawErifHand(hand);
  }

  if (battle.shapeZones.length) {
    for (const z of battle.shapeZones) {
      const safe = z.type === battle.shapeCue, strike = battle.shapeState === 'judgment' && !safe;
      // The safe shape steadily fills in with white over the "seek" window
      // instead of flashing — empty (outline only) right when the window
      // opens, solidly full exactly when time runs out, so "how much longer
      // do I have" reads directly off how much of the shape is filled.
      let fillProgress = 0;
      if (safe && battle.shapeState === 'seek') {
        const pct = clamp(battle.shapeTimer / (battle.seekMax || 1), 0, 1);
        fillProgress = 1 - pct;
      }
      ctx.save();
      ctx.globalAlpha = strike ? .82 : (safe ? .9 : .38);
      ctx.lineWidth = safe ? 4 : 2;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = strike ? EMBER : '#fff'; // wrong shapes fill red during judgment instead of white
      const drawShape = () => {
        if (z.type === 'circle') { ctx.beginPath(); ctx.arc(z.x, z.y, z.size, 0, Math.PI * 2); }
        else if (z.type === 'square') { ctx.beginPath(); ctx.rect(z.x - z.size * .82, z.y - z.size * .82, z.size * 1.64, z.size * 1.64); }
        else { ctx.beginPath(); ctx.moveTo(z.x, z.y - z.size); ctx.lineTo(z.x - z.size * .95, z.y + z.size * .82); ctx.lineTo(z.x + z.size * .95, z.y + z.size * .82); ctx.closePath(); }
      };
      drawShape();
      if (strike) { ctx.fill(); ctx.stroke(); } else ctx.stroke();
      if (fillProgress > 0) { drawShape(); ctx.globalAlpha = fillProgress; ctx.fill(); }
      ctx.restore();
    }
  }
  // The roaming barrage/seek hands are no longer drawn — battle.hands still
  // exists and still anchors where shards spawn from (see spawnShapeShard),
  // just off-screen past the box's edge now that hazard rendering is
  // clipped to the box, so shards simply emerge from the frame rather than
  // visibly flying out from a fist hovering past the border.
  if (battle.shapeState === 'judgment' && battle.slamTargets) {
    const drop = clamp((1 - battle.shapeTimer / (battle.judgmentMax || 1)) / .55, 0, 1);
    for (const t of battle.slamTargets) {
      const hy = lerp(t.y - 78, t.y - 6, drop);
      drawFistHand(t.x, hy, Math.PI / 2, 30);
    }
  }
  if (battle.shapeZones.length) {
    const cueVerb = battle.shapeState === 'barrage' ? 'SURVIVE' : battle.shapeState === 'seek' ? 'ENTER' : 'JUDGMENT';
    text(`${cueVerb}: ${battle.shapeCue.toUpperCase()}`, W / 2, statusY(), 20, 'center', .95);
  }

  for (const l of battle.lasers) { ctx.save(); ctx.globalAlpha = .75 + .2 * Math.sin(performance.now() / 35); ctx.fillRect(l.x, l.y, l.w, l.h); ctx.restore(); }
  if (battle.q) { // battle.q is only ever set by Oracle-family code (standalone, Reprise, or Enraged)
    // Lane count tracks battle.q.a.length directly (see oracleOptionCount in
    // hazards.js — it grows by 1 every 2 rounds solved) rather than a fixed
    // 4, so the lasers and this rendering never fall out of sync with
    // however many options the current question actually has.
    const count = battle.q.a.length, lane = b.w / count;
    const fontSize = Math.max(11, 18 - (count - 4) * 1.5);
    text(battle.q.q, W / 2, statusY(), 22);
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = .45; line(b.x + i * lane, b.y, b.x + i * lane, b.y + b.h, 1); ctx.globalAlpha = 1;
      text(battle.q.a[i], b.x + lane * (i + .5), b.y + 30, fontSize);
    }
    const pct = clamp(battle.qTimer / (battle.qMax || 3.25), 0, 1);
    ctx.fillRect(b.x, b.y - 10, b.w * pct, 3);
  }

  if (battle.sigils.length) {
    // The Archivist's input phase deliberately does NOT highlight which sigil
    // comes next — it's a memory match, so the player has to recall the
    // sequence from the reveal phase rather than just follow a lit symbol.
    // Convergence's cue is a different mechanic (go where you're told, not a
    // memory test) so that one still lights up.
    const isConvergencePhase = battle.type === 'erif' && (battle.phase === PHASE_CONVERGENCE || battle.phase === PHASE_FINAL_CONVERGENCE);
    for (const sig of battle.sigils) {
      const isNext = isConvergencePhase && battle.convergenceCue === sig.name;
      ctx.save(); ctx.translate(sig.x, sig.y); ctx.lineWidth = isNext ? 4 : 2; ctx.globalAlpha = isNext ? 1 : .55;
      ctx.beginPath(); ctx.arc(0, 0, sig.r, 0, Math.PI * 2); ctx.stroke();
      // A filling ember ring around the currently-lit sigil while the soul
      // is standing inside it — the actual "how long you need to stand
      // here" readout (the touch-hold requirement), separate from the
      // status bar above the box, which times out how long you have left
      // to REACH it, not how long you have to stay.
      if (isNext && battle.convergenceTouchHold > 0) {
        const holdNeeded = battle.phase === PHASE_FINAL_CONVERGENCE ? FINAL_CONVERGENCE_HOLD_TIME : .28;
        const holdPct = clamp(battle.convergenceTouchHold / holdNeeded, 0, 1);
        ctx.save(); ctx.strokeStyle = EMBER; ctx.globalAlpha = 1; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, sig.r + 7, -Math.PI / 2, -Math.PI / 2 + holdPct * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = 1.5;
      if (sig.name === 'circle') { ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke(); }
      else if (sig.name === 'square') ctx.strokeRect(-7, -7, 14, 14);
      else if (sig.name === 'triangle') { ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-8, 7); ctx.lineTo(8, 7); ctx.closePath(); ctx.stroke(); }
      else if (sig.name === 'diamond') { ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 0); ctx.lineTo(0, 9); ctx.lineTo(-9, 0); ctx.closePath(); ctx.stroke(); }
      else if (sig.name === 'north') text('N', 0, 1, 15, 'center', isNext ? 1 : .55);
      else if (sig.name === 'southwest') text('SW', 0, 1, 13, 'center', isNext ? 1 : .55);
      else if (sig.name === 'southeast') text('SE', 0, 1, 13, 'center', isNext ? 1 : .55);
      else if (typeof REPRISE_ORDER !== 'undefined' && REPRISE_ORDER.includes(sig.name)) text(sig.name[0].toUpperCase(), 0, 1, 18, 'center', isNext ? 1 : .55);
      else { line(-7, -7, 7, 7, 2); line(-7, 7, 7, -7, 2); }
      ctx.restore();
      if (typeof REPRISE_ORDER !== 'undefined' && REPRISE_ORDER.includes(sig.name)) {
        text(sig.name.toUpperCase(), sig.x, sig.y + sig.r + 13, 10, 'center', isNext ? 1 : .45);
      }
    }
  }
  if (battle.sigilPulse) {
    // maxT falls back to .34 for the Convergence-family capture pulses,
    // which don't set it explicitly — the memory-match ones (bosses.js) do,
    // since their actual duration no longer matches that old default.
    const p = battle.sigilPulse, pct = clamp(p.t / (p.maxT || .34), 0, 1);
    ctx.save(); ctx.globalAlpha = pct; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, 34 + (1 - pct) * 30, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (battle.echoSequence.length) {
    const label = battle.echoPhase === 'reveal' ? 'WATCH THE ARCHIVE'
      : battle.echoPhase === 'input' ? `REPEAT: STEP ${battle.echoStep + 1}/${battle.echoSequence.length}`
      : (battle.echoFail ? 'THE PAGE TEARS' : 'PATTERN HELD');
    text(label, W / 2, statusY(), 18, 'center', .9);
    // The per-round safety-cap readout (see MEMORY_MATCH_ROUND_TIME,
    // bosses.js) — same top-of-arena bar convention as the Oracle's own
    // question timer above, so it drains only while the round can actually
    // still time out (not during the brief resolve/result beat).
    if (battle.echoPhase === 'reveal' || battle.echoPhase === 'input') {
      const pct = clamp(battle.echoRoundTimer / MEMORY_MATCH_ROUND_TIME, 0, 1);
      ctx.fillRect(b.x, b.y - 10, b.w * pct, 3);
    }
  }

  if (battle.sandPhase) {
    // The Hourglass's sand meter — cool while time drags, ember while it
    // rushes, always telling you how much of the current phase is left so
    // the next flip is a read, not a surprise.
    const pct = clamp(battle.sandTimer / (battle.sandMax || 1), 0, 1);
    const fast = battle.sandPhase === 'fast';
    ctx.save(); ctx.fillStyle = fast ? EMBER : '#57c7ff';
    text(fast ? 'THE SAND RUSHES' : 'THE SAND SLOWS', W / 2, statusY(), 15, 'center', .85);
    ctx.globalAlpha = .8;
    ctx.fillRect(b.x, b.y - 10, b.w * pct, 3);
    ctx.restore();
  }

  if (battle.type === 'erif' && (battle.phase === PHASE_CONVERGENCE || battle.phase === PHASE_FINAL_CONVERGENCE) && !hideErifTwistHud) {
    if (battle.convergenceCue) {
      text(`${battle.phase === PHASE_FINAL_CONVERGENCE ? 'BREAK' : 'HOLD'}: ${battle.convergenceCue.toUpperCase()}`, W / 2, statusY(), 20);
      const pct = clamp(battle.convergenceCueTimer / battle.convergenceCueMax, 0, 1);
      ctx.fillRect(b.x, b.y - 10, b.w * pct, 3);
    } else {
      // Convergence now has a real capture count too (fill each circle once
      // — see updateConvergence, erif.js), so it gets the same progress
      // readout Final Convergence already shows instead of a static line.
      const count = battle.phase === PHASE_FINAL_CONVERGENCE ? battle.finalCaptureCount : battle.convergenceCaptureCount;
      text(`${count}/${REPRISE_ORDER.length} LIEUTENANTS OUTBURNED`, W / 2, statusY(), 15, 'center', .72);
    }
  } else if (battle.type === 'erif' && battle.phase === PHASE_ENRAGED) {
    // Nothing drawn here while a quiz or memory round is actually up — those
    // render their own text at this exact same STATUS_Y a bit further down
    // (see the `if (battle.q)` and `if (battle.echoSequence.length)` blocks
    // below), so showing "ALL EIGHT BRANDS..." here at the same time would
    // just overlay text on top of text.
    if (!battle.q && !battle.echoSequence.length) text('ALL EIGHT BRANDS ARE ACTIVE', W / 2, statusY(), 15, 'center', .72);
  }

  const mech = activeMechanic();
  // battle.type === 'erif' alone (not gated to phase >= PHASE_CONVERGENCE
  // like before) — moveSoulWithShield now runs for every single phase of the
  // Erif fight, Reprise included (see erif.js), so the glyph needs to be
  // visible the whole time too, not just from Convergence onward. Without
  // this, hourglass/witness/archivist/oracle/verdict's Reprise segments had
  // a fully functional shield that just never rendered.
  const shieldPhase = mech === 'executioner' || mech === 'mask' || mech === 'gale' || battle.type === 'erif';
  if (shieldPhase) {
    // A wavy semicircle *line*, not a filled shape — sized to match the
    // soul's actual hitbox radius (battle.soul.r) so it never visually
    // implies a bigger protected area than what's real, which is also what
    // lets it sit close to the candle without reading as a solid blob.
    // Colored exactly like the candle's own flame (see drawFlame) — same
    // yellow-to-ember HP gradient, same blue flash while invulnerable.
    // The rotation eases toward the new side over SHIELD_TURN_TIME instead
    // of snapping, via the shieldAngleFrom/To/ChangeT state below.
    const s = battle.soul, dir = battle.shield, t = performance.now() / 1000;
    const hpFrac = clamp(battle.hp / battle.maxHp, 0, 1);
    const color = battle.hurtTimer > 0 ? FLAME_INVULN_COLOR : lerpColor(FLAME_FULL_COLOR, EMBER, 1 - hpFrac);
    const pulse = .8 + .2 * Math.sin(t * 6);
    // Offset from the player pushed out 10% (the shield's own radius r,
    // still matched to the hitbox, is untouched).
    const r = battle.soul.r + 1, cy = -(r + 3) * 1.1;
    const targetAngle = SHIELD_DIR_ANGLE[dir] || 0;
    if (shieldLastDir === null) { shieldAngleFrom = shieldAngleTo = targetAngle; shieldChangeT = t; shieldLastDir = dir; }
    else if (dir !== shieldLastDir) { shieldAngleFrom = shieldAngleTo; shieldAngleTo = targetAngle; shieldChangeT = t; shieldLastDir = dir; }
    const turnProgress = clamp((t - shieldChangeT) / SHIELD_TURN_TIME, 0, 1);
    const turnEased = 1 - Math.pow(1 - turnProgress, 3);
    const renderAngle = angleLerp(shieldAngleFrom, shieldAngleTo, turnEased);
    // The Reckoning's boxing-glove punch feedback (see battle.punchFlashT,
    // set by handleErifPunch, erif.js) lives on the shield, not the flame —
    // it pops/grows in place along whatever direction the shield is already
    // facing (renderAngle), rather than reorienting the shield toward the
    // punch target — a punch should match your current guard, not spin it
    // toward whatever you're hitting. shieldAngleFrom/To/ChangeT/LastDir
    // (the real block-direction state) are untouched either way.
    const punchP = battle.punchFlashT > 0 ? clamp(battle.punchFlashT / .18, 0, 1) : 0;
    const punchScale = 1 + .35 * punchP;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(renderAngle); ctx.scale(punchScale, punchScale);
    ctx.globalAlpha = pulse; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI + (i / steps) * Math.PI;
      const rr = r + Math.sin(a * 5 + t * 10) * .8;
      const px = Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  for (const s of battle.sparks) {
    const p = clamp(s.life / s.maxLife, 0, 1);
    ctx.save();
    if (s.blocky) {
      // Same blocky-square language drawCandleTrail uses, shrinking as it
      // fades.
      ctx.globalAlpha = p; ctx.fillStyle = s.color;
      const sz = s.size * p;
      ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
    } else {
      ctx.globalAlpha = p; ctx.strokeStyle = s.color;
      line(s.x, s.y, s.x - s.vx * .03, s.y - s.vy * .03, 2 * p + .5);
    }
    ctx.restore();
  }
  drawCandleTrail(battle.soul.x, battle.soul.y, 1, battle.hp / battle.maxHp);
  // Shrinks/dims up to 40% as HP drops toward 1 — the glow reads as the
  // flame's own light, so it should gutter as the flame burns down, same
  // spirit as drawCandle's own shrinking wax. Also nudged down by the exact
  // same amount the flame's own center drifts as it shrinks toward its
  // fixed base (flameShrinkDrop) — without this the glow stayed pinned to
  // where the flame sat at full HP instead of following it down.
  const hpFrac = clamp(battle.hp / battle.maxHp, 0, 1);
  const soulFlameBaseScale = .585 * .9; // matches drawCandle's own drawFlame(x, y, scale*.585*.9, ...) call at scale=1
  drawSoulGlow(battle.soul.x, battle.soul.y + flameShrinkDrop(soulFlameBaseScale, hpFrac), 1, lerp(.6, 1, hpFrac));
  drawCandle(battle.soul.x, battle.soul.y, 1, battle.hp / battle.maxHp, battle.hurtTimer > 0);
  // HP and the time-left readout sit just inside the arena's edges now,
  // rather than all the way out at the screen edges — same information, less
  // distance for the eye to travel to check it mid-fight.
  // Positioned relative to the box's own bottom edge (b.y + b.h) rather than
  // fixed canvas coordinates — for every fight but Erif's own that's a
  // no-op (the box is always the same size), but once Enraged widens AND
  // deepens his arena (see ERIF_ENRAGE_BOX, erif.js), this whole row
  // naturally slides down and off the bottom of the screen along with it.
  // From Enraged on, the candle's own shrinking wax is the only HP tell
  // left — deliberately no numeric readout once it's gone.
  const uiY = b.y + b.h;
  // hideErifTwistHud (see its own declaration up top) keeps this — and the
  // timer/phase-name/capture-count title further down — from showing a
  // stale Final Convergence snapshot during the twist/Reckoning-intro
  // dialogues.
  if (!hideErifTwistHud) {
    text('HP', 250, uiY + 46, 15, 'left');
    for (let i = 0; i < battle.maxHp; i++) { ctx.strokeRect(285 + i * 22, uiY + 39, 16, 16); if (i < battle.hp) ctx.fillRect(288 + i * 22, uiY + 42, 10, 10); }
  }
  if (battle.type === 'archivist') {
    // The Archivist no longer has a meaningful countdown — its duration is
    // just a generous safety cap now (see startEchoRound's win condition in
    // bosses.js), same convention as Erif's own duration. Showing round
    // progress instead is the number that's actually true to watch.
    text(`ROUND ${Math.min(battle.echoRound, ARCHIVIST_WIN_ROUNDS)}/${ARCHIVIST_WIN_ROUNDS}`, 705, uiY + 47, 15);
  } else if (battle.type !== 'erif') {
    // Erif's own duration is the same kind of generous safety cap as the
    // Archivist's (see BOSS.erif in data.js) — his fight is won through its
    // actual milestones, never by outlasting a clock, so a ticking countdown
    // here would just be misleading. His phase name below is the readout
    // that's actually true to watch, same reasoning as the Archivist's round
    // counter above.
    const left = Math.max(0, Math.ceil(battle.duration - battle.t));
    // Enlarged 50% (12->18... now 18->27) and boxed — this is the real win
    // condition for every lieutenant trial (survive until it hits 0), so it
    // needs to actually read clearly at a glance, not just be legible.
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(685, uiY + 31, 40, 32);
    text(`${left}`, 705, uiY + 47, 27);
  } else if (battle.type === 'erif' && battle.phase === PHASE_LAST_WAGER) {
    // The Reckoning is the one Erif phase with a real, hard clock (see
    // RECKONING_TIME_LIMIT, erif.js) — running it out is an actual loss, so
    // unlike every other Erif phase this gets a real ticking number instead
    // of '???'.
    const left = Math.max(0, Math.ceil(RECKONING_TIME_LIMIT - (battle.t - battle.phaseStartT)));
    // Smaller than the lieutenant timer's 27 — this one can run into 3
    // digits (100 and up), which clipped out of the box's sides at that size.
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(685, uiY + 31, 40, 32);
    text(`${left}`, 705, uiY + 47, 20);
  } else if (battle.type === 'erif' && !hideErifTwistHud) {
    // The whole fight (every phase before the Reckoning) now has its own
    // real hard cap too (see ERIF_FIGHT_TIME_LIMIT, erif.js) — same ticking
    // number as the Reckoning's own box above, just counting down from the
    // fight's own start (battle.t) instead of the phase's.
    const left = Math.max(0, Math.ceil(ERIF_FIGHT_TIME_LIMIT - battle.t));
    // Same smaller size as the Reckoning's own box above — this one starts
    // at ERIF_FIGHT_TIME_LIMIT (140), so it's 3 digits from the very start
    // of the fight.
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(685, uiY + 31, 40, 32);
    text(`${left}`, 705, uiY + 47, 20);
  }
  if (battle.type === 'erif' && battle.phase >= REPRISE_ORDER.length && !hideErifTwistHud) {
    // Only the phases past the Reprise get a name here now — during the
    // Reprise itself this used to show each lieutenant's own name (e.g.
    // "THE ARCHIVIST"), which is something the player already knows by the
    // final boss and doesn't need spelled out again. The later phases
    // (Convergence, Enraged, ...) aren't a repeat of anything, so those
    // still earn the label.
    const phaseNames = ['THE CONVERGENCE', 'ERIF UNBOUND', 'THE LAST CONVERGENCE', 'THE RECKONING'];
    text(phaseNames[battle.phase - REPRISE_ORDER.length] || 'ERIF', W / 2, uiY + 16, 14);
  }

  if (battle.finalTransitionFlash > 0) {
    ctx.fillStyle = '#fff'; ctx.globalAlpha = clamp(battle.finalTransitionFlash / 1.15, 0, 1) * .32;
    ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }

  // Brief ember edge-flare on taking a hit (see battle.hitFlashT, set in
  // hurt(), battle-core.js) — confined to the screen edges via a radial
  // gradient (transparent center, ember edges) rather than a flat full-
  // screen fill like finalTransitionFlash above, so it reads as a flinch
  // around the frame instead of a scripted whiteout. 255,59,32 is EMBER's
  // own hex (#ff3b20) spelled out as rgb, since gradient color stops need a
  // real alpha channel per-stop rather than a single ctx.globalAlpha.
  if (battle.hitFlashT > 0) {
    const p = clamp(battle.hitFlashT / .28, 0, 1);
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .32, W / 2, H / 2, H * .64);
    g.addColorStop(0, 'rgba(255,59,32,0)');
    g.addColorStop(1, `rgba(255,59,32,${.38 * p})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (battle.type === 'erif' && battle.phase === PHASE_LAST_WAGER) drawErifTensionVisualizer();

  // No opaque screen fade for Erif's hard time limits (battle.erifReckoningFadeT/
  // erifFightFadeT, erif.js — the Reckoning's own 135s cap and the whole
  // fight's 140s cap, mutually exclusive in practice) — deliberately, so the
  // player can keep reading the arena right up to the very end. Instead: an
  // escalating screen shake (main.js's draw()) plus this soft red tint,
  // capped well under full opacity (.4 max) so the arena stays readable
  // throughout — "everything's about to give out," not "the screen is gone."
  const fightFade = Math.max(battle.erifReckoningFadeT, battle.erifFightFadeT);
  if (fightFade > 0) {
    ctx.save(); ctx.fillStyle = '#f00'; ctx.globalAlpha = fightFade * .4;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
// Fills the bottom strip left-to-right as much as it can, in two clusters
// that share the screen with the HP row/timer/controls legend/volume meters
// (excludeLo/excludeHi below) instead of being confined to the arena box's
// own narrow side margins — the box's geometry doesn't actually matter here
// at all, since this whole strip sits below the box's own bottom edge (uiY)
// regardless of x. 0 height until half of the Reckoning's own hard timer has
// elapsed (battle.erifReckoningVisualizerGrowth, erif.js), growing to full
// height by 75% elapsed (25% remaining), building tension well ahead of the
// last-5s shake/tint above. Only ever drawn during the Reckoning itself (see
// the call site's battle.phase === PHASE_LAST_WAGER gate) — not the rest of
// the Erif fight. Both sides draw the SAME levels array — a real single
// spectrum split unevenly across two separate clusters read as broken/
// lopsided, not like a deliberate design, so this duplicates it instead of
// each side getting its own half.
// Bar heights come from getVisualizerLevels (audio.js) — real frequency data
// off a shared analyser every sound in the game passes through, not a faked
// wobble, so this actually reacts to whatever's currently playing.
function drawErifTensionVisualizer() {
  const growth = battle.erifReckoningVisualizerGrowth || 0;
  if (growth <= 0) return;
  const b = battle.box, uiY = b.y + b.h;
  const maxH = (H - uiY) * .96;
  const barCount = 22, gap = 2, pad = 6;
  // HP row (285 + maxHp*22, see drawBattle) is the only one of these with a
  // variable width — the timer box (685-725) and volume-meter panel
  // (VOL_METER.rightEdge=750, ~108 wide plus its own left-of-label margin)
  // are always fixed, so their bounds are just folded in as flat numbers.
  const excludeLo = 232, excludeHi = Math.max(285 + (battle.maxHp || 0) * 22 + 6, 760);
  const levels = getVisualizerLevels(barCount);
  const drawSide = (x0, x1) => {
    const avail = x1 - x0;
    if (avail < 6) return; // still too tight to draw anything meaningful
    const barW = Math.max(1, (avail - gap * (barCount - 1)) / barCount);
    for (let i = 0; i < barCount; i++) {
      // A small idle floor (.08) so the cluster still reads as "there" and
      // gently alive through quiet passages, rather than flattening to
      // nothing between notes.
      const h = Math.max(2, maxH * growth * Math.max(.08, levels[i]));
      ctx.fillRect(x0 + i * (barW + gap), H - h, barW, h);
    }
  };
  ctx.save(); ctx.globalAlpha = .45 + .3 * growth; ctx.fillStyle = EMBER;
  drawSide(pad, excludeLo);
  drawSide(excludeHi, W - pad);
  ctx.restore();
}

// The intro cutscene's own scene — not the hub, which the player hasn't
// actually arrived at yet narratively. A flame alone in the dark, joined
// gradually by distant watching eyes as the lore escalates (one per line,
// echoing "six minds" from INTRO_CUTSCENE). State is tracked module-locally
// (not on the shared `dialogue` object, which every other dialogue also
// uses) purely to time each line's own fade-in independent of real-world
// wall-clock drift.
let introSceneIndex = -1, introSceneLineT = 0;
function drawIntroScene() {
  if (dialogue.index !== introSceneIndex) { introSceneIndex = dialogue.index; introSceneLineT = performance.now(); }
  const lineElapsed = (performance.now() - introSceneLineT) / 1000;
  const t = performance.now() / 1000, idx = dialogue.index;

  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // The same candle avatar as everywhere else — the cutscene's "you" should
  // look like the "you" the player will actually be controlling next.
  const flameAlpha = idx === 0 ? clamp(lineElapsed / 1.3, 0, 1) : 1;
  // Same small glow every candle avatar uses (see drawSoulGlow) — fades in
  // alongside the flame itself instead of popping in at full strength
  // immediately.
  drawSoulGlow(W / 2, H / 2 + 70, 1.5, flameAlpha);
  ctx.save(); ctx.globalAlpha = flameAlpha;
  drawCandle(W / 2, H / 2 + 70, 1.5, 1, false);
  ctx.restore();

  // idx is the currently-showing line's 0-based index, so idx+1 is how many
  // lines have actually been revealed so far — using idx alone meant the
  // 8th (last) line only ever showed 7 eyes, never the full 8.
  const eyeCount = Math.min(idx + 1, 8);
  for (let i = 0; i < eyeCount; i++) {
    const justRevealed = i === eyeCount - 1 ? clamp(lineElapsed / .8, 0, 1) : 1;
    const a = (i / 8) * Math.PI * 2 + t * .04;
    const r = 210 + Math.sin(t * .55 + i) * 8;
    const ex = W / 2 + Math.cos(a) * r, ey = H / 2 - 95 + Math.sin(a) * r * .48;
    const blink = .5 + .5 * Math.sin(t * 1.3 + i * 2.1);
    const rot = Math.sin(t * .2 + i * 3) * .15;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(rot);
    ctx.globalAlpha = justRevealed * (.3 + .35 * blink);
    ctx.strokeStyle = ctx.fillStyle = '#fff';

    // A faint halo, like it's catching what little light there is.
    ctx.save(); ctx.globalAlpha *= .25; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // Almond-shaped rather than a plain ellipse, with a heavy lid arc above —
    // these are narrowed in scrutiny, not wide-eyed.
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.quadraticCurveTo(-4, -6, 0, -5.5);
    ctx.quadraticCurveTo(4, -6, 9, 0);
    ctx.quadraticCurveTo(4, 4.5, 0, 5);
    ctx.quadraticCurveTo(-4, 4.5, -9, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -1); ctx.quadraticCurveTo(0, -7, 8, -1); ctx.stroke();

    // A vertical slit pupil rather than round — reads as far less human.
    ctx.beginPath();
    ctx.moveTo(0, -4.2); ctx.quadraticCurveTo(1.3, 0, 0, 4.2); ctx.quadraticCurveTo(-1.3, 0, 0, -4.2);
    ctx.closePath(); ctx.fill();

    // A small glint, off-center — the one bit of life in it.
    ctx.globalAlpha = justRevealed * .8;
    ctx.beginPath(); ctx.arc(-1.5, -1.5, .8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }


  // A slow vignette fade-in at the very start sells "coming into awareness,"
  // matching the opening line.
  if (idx === 0) {
    const fadeIn = 1 - clamp(lineElapsed / 1.5, 0, 1);
    if (fadeIn > 0) { ctx.fillStyle = '#000'; ctx.globalAlpha = fadeIn; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
}

function drawDialogue() {
  if (dialogue.context === 'battle') drawBattle();
  else if (dialogue.context === 'introScene') drawIntroScene();
  else drawExplore();

  // The dialogue that plays right as Erif enters the Enraged phase (see
  // main.js's update(), which plays this through automatically), the twist
  // dialogue right before the Reckoning ("...NO."), and the plain-language
  // control reminder chained right after that twist all get a dedicated
  // presentation — a box matching the arena frame itself (battle.box hasn't
  // widened for Enraged's own version yet at this point — that only happens
  // once beginErifEnraged runs, after this dialogue finishes), covering it
  // completely instead of the small fixed bottom-strip box used everywhere
  // else. The dialogue leading INTO the fight itself (after==='erif') stays
  // that normal small kind — unchanged.
  if (dialogue.after === 'erifEnraged' || dialogue.after === 'erifReckoningIntro' || dialogue.after === 'erifTrueFinal') {
    const b = battle.box, x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#fff'; box(x, y, w, h, 4); ctx.fillStyle = '#fff';
    text(dialogue.speaker || 'ERIF', x + 20, y + 26, 16, 'left');
    if (dialogue.after === 'erifEnraged') {
      const textX = x + 20, textTop = y + 46, textBottom = y + h - 12, textW = w - 40;
      // Every revealed line's wrapped rows, built up front so the total
      // height is known — small enough font that the whole transcript should
      // fit without scrolling in practice, but this still scrolls to keep the
      // newest (currently-typing) content in view if it ever doesn't.
      const lineHeight = 15, paraGap = 6;
      const paragraphs = [];
      for (let i = 0; i <= dialogue.index; i++) {
        const full = dialogue.lines[i];
        const shown = i === dialogue.index ? full.slice(0, Math.floor(dialogue.revealCount || 0)) : full;
        paragraphs.push(wrapLines(shown, textW, 11));
      }
      const totalH = paragraphs.reduce((sum, p) => sum + p.length * lineHeight, 0) + (paragraphs.length - 1) * paraGap;
      const areaH = textBottom - textTop;
      let cy = textTop + Math.min(0, areaH - totalH);
      // Clipped to the whole box, not just the text sub-region — text() anchors
      // each line at its vertical CENTER, so clipping tightly to textTop cut
      // the top half of the very first line off instead of leaving it alone.
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      paragraphs.forEach(p => { p.forEach(ln => { text(ln, textX, cy, 11, 'left'); cy += lineHeight; }); cy += paraGap; });
      ctx.restore();
      return;
    }
    // erifReckoningIntro (the twist, "...NO.") and erifTrueFinal (the
    // plain-language control reminder right after it) — same big
    // arena-sized frame as Enraged's own dialogue above, but manual/
    // player-advanced one line at a time (SPACE prompt + N/total counter)
    // instead of an auto-playing accumulating transcript — neither is
    // driven by main.js's erifEnraged auto-hold special-case, so both wait
    // on the player exactly like the small dialogue box everywhere else does.
    const textX = x + 20, textW = w - 40;
    const fullLine = dialogue.lines[dialogue.index];
    const fullWrapped = wrapLines(fullLine, textW, 20);
    const shownWrapped = wrapLines(fullLine.slice(0, Math.floor(dialogue.revealCount || 0)), textW, 20);
    const lineHeight = 27, startY = y + h / 2 - (fullWrapped.length - 1) * (lineHeight / 2);
    shownWrapped.forEach((ln, i) => text(ln, textX, startY + i * lineHeight, 20, 'left'));
    text(`${dialogue.index + 1}/${dialogue.lines.length}`, x + w - 20, y + 26, 12, 'right', .55);
    text('SPACE', x + w - 20, y + h - 22, 14, 'right', .72 + Math.sin(performance.now() / 170) * .25);
    return;
  }

  // x/w give a 12px gap to the room border on both sides (82-70, 890-878);
  // y is raised so the bottom gap to the room border matches that same 12px
  // (585-573=12) instead of sitting noticeably tighter than the sides.
  const x = 82, y = 433, w = 796, h = 140;
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#fff'; box(x, y, w, h, 4); ctx.fillStyle = '#fff';
  text(dialogue.speaker || 'ERIF', x + 24, y + 25, 16, 'left');
  // Text types on rather than appearing all at once (see updateDialogueReveal
  // in erif.js). Vertical centering is computed from the FULL line's wrap
  // layout, not the partially-revealed one, so the text block doesn't shift
  // position as it grows in — only from the fully-revealed substring's own
  // wrap, which can legitimately differ line-by-line as words are still typing.
  const fullLine = dialogue.lines[dialogue.index];
  const fullWrapped = wrapLines(fullLine, w - 48, 18);
  const shownWrapped = wrapLines(fullLine.slice(0, Math.floor(dialogue.revealCount || 0)), w - 48, 18);
  const lineHeight = 24, startY = y + 76 - (fullWrapped.length - 1) * (lineHeight / 2);
  shownWrapped.forEach((ln, i) => text(ln, x + 24, startY + i * lineHeight, 18, 'left'));
  text(`${dialogue.index + 1}/${dialogue.lines.length}`, x + w - 24, y + 25, 12, 'right', .55);
  text('SPACE', x + w - 24, y + h - 22, 14, 'right', .72 + Math.sin(performance.now() / 170) * .25);
}

function drawErifVictory() {
  const t = battle?.victoryT || 0;
  // Fade start (1.18) + fade duration (5s, see updateErifVictory's matching
  // musicFadeMult ramp, erif.js) — the screen finishes going white exactly
  // when the music finishes fading to silent.
  const FADE_END = 6.18;
  if (t < FADE_END) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    const intensity = 4 + Math.pow(clamp(t / 2.2, 0, 1), 2) * 28;
    const sx = Math.sin(t * 71) * intensity, sy = Math.cos(t * 59) * intensity * .55;
    drawBossIcon('erif', W / 2 + sx, H / 2 - 25 + sy, false);
    text('ERIF CANNOT HOLD HIS FLAME', W / 2, 535, 15, 'center', clamp(t / .8, 0, 1));
    if (t > 1.18) {
      const p = clamp((t - 1.18) / 5, 0, 1), radius = 20 + p * 760;
      ctx.fillStyle = '#fff'; ctx.globalAlpha = p; ctx.beginPath(); ctx.arc(W / 2, H / 2 - 20, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      // Lets drawVolumeMeters cross-fade its own dark panel down in step
      // with this expanding circle, rather than staying a solid dark box
      // clashing against an already-mostly-white screen until the fade
      // fully completes (see lightScreenAmount, main.js).
      lightScreenAmount = p;
    }
  } else if (t < 11.63) {
    lightScreenAmount = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    const a = clamp((t - FADE_END) / .75, 0, 1);
    text('You have outburned the flame.', W / 2, H / 2, 38, 'center', a);
  } else {
    // Stays on the same white screen the middle beat above faded into,
    // instead of cutting back to black for the closing dialogue — a clean,
    // silent transition into the ending rather than one more scene change
    // (see updateErifVictory's musicFadeMult tie-in, which has the theme
    // already faded to nothing well before dialogue ever starts).
    lightScreenAmount = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const idx = Math.min(battle.victoryDialogueIndex, ERIF_FINAL_DIALOGUE.length - 1);
    // drawBossIcon always strokes in white, so it needs a dark backdrop of
    // its own to stay visible now that the page around it is white.
    ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(W / 2 - 145, 55, 290, 245);
    drawBossIcon('erif', W / 2, 175, idx >= 2);
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    text('You have outburned the flame.', W / 2, 330, 25, 'center', .85);
    const x = 82, y = 408, w = 796, h = 166;
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#fff'; box(x, y, w, h, 4); ctx.fillStyle = '#fff';
    text('ERIF — GUTTERED', x + 24, y + 25, 15, 'left', Math.max(.22, 1 - idx * .2));
    // Word-wrapped rather than a single fixed-y line — some of these run
    // long enough to overflow straight past the box's right edge otherwise.
    // Only the revealed portion (see updateErifVictory's victoryRevealCount)
    // renders — types on like every other dialogue instead of appearing
    // all at once.
    const shownVictoryLine = ERIF_FINAL_DIALOGUE[idx].slice(0, Math.floor(battle.victoryRevealCount || 0));
    wrapLines(shownVictoryLine, w - 48, 17).forEach((ln, li) =>
      text(ln, x + 24, y + 79 + li * 22, 17, 'left', Math.max(.28, 1 - idx * .16)));
    text(`${idx + 1}/${ERIF_FINAL_DIALOGUE.length}`, x + w - 24, y + 25, 12, 'right', .5);
    text('SPACE', x + w - 24, y + h - 22, 14, 'right', .72 + Math.sin(performance.now() / 170) * .25);
  }
}

function drawEnding() {
  lightScreenAmount = 1;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  const t = messageTimer;
  text('ERIF', W / 2, 210, 50, 'center', clamp(t / 1.2, 0, 1));
  text('UNYIELDING FLAME', W / 2, 262, 20, 'center', clamp((t - .3) / 1.2, 0, 1));
  text('YOU HAVE OUTBURNED THE FLAME.', W / 2, 370, 22, 'center', clamp((t - 1) / 1.2, 0, 1));
  text('ESC — RETURN TO MAIN MENU', W / 2, 470, 14, 'center', .65);
}

// Hard-only true ending — shaped like drawErifVictory/drawEnding but kept
// as separate functions so the Normal-tier cinematic stays completely
// untouched (and provably regression-free) by this addition.
function drawErifTrueVictory() {
  const t = battle?.trueVictoryT || 0;
  // Same fade-to-white + escalating shake treatment as drawErifVictory
  // above, timed proportionally onto this screen's own shorter 5s pre-
  // dialogue window (was a much smaller fixed 10px shake and no white fade
  // at all — stayed black straight into the dialogue phase).
  const FADE_END = 5.0;
  if (t < FADE_END) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    const intensity = 4 + Math.pow(clamp(t / 2.2, 0, 1), 2) * 28;
    const sx = Math.sin(t * 61) * intensity, sy = Math.cos(t * 53) * intensity * .6;
    // eyesLeft=0 — every ward is broken by the time this cinematic plays, so
    // his eyes and the lettered ward ring are already stripped here too, not
    // just once the dialogue phase's bare circle kicks in below.
    drawBossIcon('erif', W / 2 + sx, H / 2 - 25 + sy, false, 1, 0);
    ctx.fillStyle = t > 1.5 ? EMBER : '#fff';
    text('THERE WAS NO EMBER LEFT TO HIDE BEHIND.', W / 2, 535, 16, 'center', clamp((t - .5) / 1.2, 0, 1));
    ctx.fillStyle = '#fff';
    if (t > .95) {
      const p = clamp((t - .95) / (FADE_END - .95), 0, 1), radius = 20 + p * 760;
      ctx.fillStyle = '#fff'; ctx.globalAlpha = p; ctx.beginPath(); ctx.arc(W / 2, H / 2 - 20, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      // See drawErifVictory's own matching note — same expanding-circle
      // fade, same need for the volume meters to lighten in step with it.
      lightScreenAmount = p;
    }
  } else {
    lightScreenAmount = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    const idx = Math.min(battle.trueVictoryDialogueIndex, ERIF_TRUE_FINAL_DIALOGUE.length - 1);
    // No backdrop box, no horns/eyes/mouth/emblem ring — by the time this
    // dialogue is up he's been truly, fully defeated (every ward broken),
    // so there's nothing left of him to draw but a bare outline. A stroked
    // circle needs no dark backdrop to read against the white page the way
    // drawBossIcon's white-stroked portrait did.
    ctx.save(); ctx.globalAlpha = idx >= 2 ? .35 : 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, 175, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    text('You let the last ember go out.', W / 2, 330, 25, 'center', .85);
    const x = 82, y = 408, w = 796, h = 140;
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#fff'; box(x, y, w, h, 4); ctx.fillStyle = '#fff';
    text('ERIF — TRULY GUTTERED', x + 24, y + 25, 15, 'left', Math.max(.22, 1 - idx * .2));
    wrapLines(ERIF_TRUE_FINAL_DIALOGUE[idx], w - 48, 17).forEach((ln, li) =>
      text(ln, x + 24, y + 79 + li * 22, 17, 'left', Math.max(.28, 1 - idx * .16)));
    text(`${idx + 1}/${ERIF_TRUE_FINAL_DIALOGUE.length}`, x + w - 24, y + 25, 12, 'right', .5);
    text('SPACE', x + w - 24, y + h - 22, 14, 'right', .72 + Math.sin(performance.now() / 170) * .25);
  }
}

function drawTrueEnding() {
  lightScreenAmount = 1;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  const t = messageTimer;
  text('ERIF', W / 2, 210, 50, 'center', clamp(t / 1.2, 0, 1));
  text('UNYIELDING FLAME', W / 2, 262, 20, 'center', clamp((t - .3) / 1.2, 0, 1));
  text('THE SOURCE HAS NOTHING LEFT TO BURN.', W / 2, 370, 20, 'center', clamp((t - 1) / 1.2, 0, 1));
  text('ESC — RETURN TO MAIN MENU', W / 2, 470, 14, 'center', .65);
}

function drawOverlay() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  const type = battle?.type || 'erif';
  // Scaled down and given more room to the name below it — at full size
  // (the default scale, used here previously) Erif's own orbiting rings and
  // emblems reach far enough down to collide with the name text, same issue
  // drawBattle's own header already had to work around.
  drawBossIcon(type, W / 2, 150, false, .85);
  text(BOSS[type].display, W / 2, 285, 34);
  if (mode === 'intro') {
    text(message, W / 2, 345, 19); text(messageSub, W / 2, 382, 15, 'center', .75);
    text('PRESS SPACE', W / 2, 485, 17, 'center', .8 + Math.sin(performance.now() / 180) * .2);
  } else if (mode === 'result') {
    text(battle.clearText, W / 2, 350, 20); text(messageSub, W / 2, 395, 15, 'center', .75);
    // Only shown (and only actually wired, see main.js's update()) when this
    // boss hasn't been warded yet — R doesn't do anything on a win screen,
    // so it'd be misleading to advertise it there.
    if (!save.ward[battle.type]) text('Press R to restart.', W / 2, 420, 15, 'center', .75);
  }
}

// ---- Persistent UI: the two volume meters (music/SFX) and the controls
// legend. Drawn on top of every screen (see main.js's draw()), not gated by
// mode, since all of it is meant to always be there rather than something a
// player has to hunt for or remember. The volume meters are the game's only
// clickable elements — click detection routes through here too (see
// handleCanvasClick, invoked from utils.js's click listener).
// Right edge fixed near the arena box's own right edge (730) rather than
// the screen corner — mirrors how HP sits just inside the box's left edge,
// and keeps it in the same neighborhood as the HP/timer row instead of off
// in the corner on its own. SFX sits on the bottom row (closest to the
// corner), music stacked directly above it.
const VOL_METER = { count: 10, blockW: 9, blockH: 11, gap: 2, rightEdge: 750, marginBottom: 3, rowGap: 3 };
const VOL_ROWS = [
  { key: 'sfx', label: 'SFX' },
  { key: 'music', label: 'MUS' },
];
function volMeterRect(row) {
  const w = VOL_METER.count * VOL_METER.blockW + (VOL_METER.count - 1) * VOL_METER.gap;
  const y = H - VOL_METER.marginBottom - VOL_METER.blockH - row * (VOL_METER.blockH + VOL_METER.rowGap);
  return { x: VOL_METER.rightEdge - w, y, w, h: VOL_METER.blockH };
}
function drawVolumeMeters() {
  ctx.save();
  const top = volMeterRect(1), bottom = volMeterRect(0);
  // text() never touches fillStyle itself, so without an explicit color
  // here this always-on overlay used to inherit whatever the previous
  // screen's draw call left behind — invisible (white boxes on a white
  // background) or just the wrong color on light-background screens (the
  // ending, Erif's victory flash). lightScreenAmount (set by those screens'
  // own draw functions, see main.js/drawEnding etc.) cross-fades this to
  // dark ink with no backing panel there, instead of forcing the same dark
  // panel + white ink a black-background screen needs everywhere. A
  // continuous 0-1 amount rather than a plain on/off flag specifically for
  // drawErifVictory/drawErifTrueVictory's own gradual expanding-circle
  // fade — without it this stayed a solid dark panel right up until that
  // fade fully completed, clashing against an already-mostly-white screen.
  const v = Math.round(255 * (1 - lightScreenAmount)), fg = `rgb(${v},${v},${v})`;
  if (lightScreenAmount < 1) {
    ctx.fillStyle = `rgba(0,0,0,${.6 * (1 - lightScreenAmount)})`;
    ctx.fillRect(top.x - 46, top.y - 4, (bottom.x + bottom.w) - (top.x - 46) + 6, (bottom.y + bottom.h) - (top.y - 4) + 4);
  }
  ctx.fillStyle = fg;
  VOL_ROWS.forEach((info, row) => {
    const r = volMeterRect(row);
    const vol = info.key === 'music' ? musicVolume : sfxVolume;
    const filledCount = Math.round(vol * VOL_METER.count);
    text(info.label, r.x - 9, r.y + VOL_METER.blockH / 2 + 1, 9, 'right', .55);
    for (let i = 0; i < VOL_METER.count; i++) {
      const bx = r.x + i * (VOL_METER.blockW + VOL_METER.gap), filled = i < filledCount;
      ctx.strokeStyle = ctx.fillStyle = fg;
      ctx.globalAlpha = filled ? 1 : .35;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx, r.y, VOL_METER.blockW, VOL_METER.blockH);
      if (filled) ctx.fillRect(bx + 2, r.y + 2, VOL_METER.blockW - 4, VOL_METER.blockH - 4);
    }
  });
  ctx.restore();
}
// Returns true if the click landed on either meter (and already applied
// it) — lets handleCanvasClick stay a one-line dispatcher as more clickable
// UI (if any) gets added later.
function handleVolumeMeterClick(mx, my) {
  const pad = 6;
  for (let row = 0; row < VOL_ROWS.length; row++) {
    const r = volMeterRect(row);
    if (mx < r.x - pad || mx > r.x + r.w + pad || my < r.y - pad || my > r.y + r.h + pad) continue;
    const v = clamp(Math.round(clamp((mx - r.x) / r.w, 0, 1) * VOL_METER.count) / VOL_METER.count, 0, 1);
    if (VOL_ROWS[row].key === 'music') musicVolume = v; else sfxVolume = v;
    tone(260, .04, 'sine', .05);
    return true;
  }
  return false;
}
function handleCanvasClick(mx, my) {
  if (typeof handleTitleMenuClick === 'function' && handleTitleMenuClick(mx, my)) return;
  handleVolumeMeterClick(mx, my);
}

// A short, always-the-same legend — deliberately not context-sensitive
// (doesn't change per mechanic) so it's something a player can learn once
// rather than a moving target.
function drawControlsLegend() {
  // x matches HP's own left position (250) — same neighborhood as the
  // HP/timer row instead of pinned to the screen corner.
  const x = 250, y2 = H - 8, y1 = y2 - 13;
  // Same light-background cross-fade as drawVolumeMeters (see
  // lightScreenAmount, main.js) — otherwise unreadable white-on-white during
  // the ending/victory-flash screens, or a jarring instant flip mid-fade.
  const lv = Math.round(255 * (1 - lightScreenAmount));
  ctx.save(); ctx.fillStyle = `rgb(${lv},${lv},${lv})`;
  text('WASD — MOVE     ARROWS/IJKL — SHIELD', x, y1, 10.5, 'left', .55);
  // The Reckoning repurposes Space as a real attack button (see
  // handleErifPunch, erif.js) instead of its usual confirm/advance role —
  // the legend swaps its label to match, now that this phase actually keeps
  // the legend on-screen (see hideBottomUI, main.js).
  const spaceLabel = (battle && battle.type === 'erif' && battle.phase === PHASE_LAST_WAGER) ? 'SPACE — ATTACK' : 'SPACE — CONFIRM';
  text(`${spaceLabel}     R — RESTART TRIAL     ESC — PAUSE`, x, y2, 10.5, 'left', .55);
  ctx.restore();
}
