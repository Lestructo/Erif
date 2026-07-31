'use strict';

// Generalized door crossing-detection, room transitions, and explore-mode
// update/draw. Replaces the original's hardcoded n/s/e/w checks with a
// data-driven loop over doors[], so adding/moving a door never touches logic.

function roomBounds() { return { l: 70, r: W - 70, t: 55, b: H - 55 }; }

function doorPoint(d, b) {
  if (d.edge === 'n') return { axis: 'y', edgeVal: b.t, crossPos: b.l + (b.r - b.l) * d.along, dir: -1 };
  if (d.edge === 's') return { axis: 'y', edgeVal: b.b, crossPos: b.l + (b.r - b.l) * d.along, dir: 1 };
  if (d.edge === 'w') return { axis: 'x', edgeVal: b.l, crossPos: b.t + (b.b - b.t) * d.along, dir: -1 };
  return { axis: 'x', edgeVal: b.r, crossPos: b.t + (b.b - b.t) * d.along, dir: 1 };
}

function checkDoorCrossing(d, b) {
  const p = doorPoint(d, b);
  const posOnAxis = p.axis === 'y' ? player.y : player.x;
  const posOffAxis = p.axis === 'y' ? player.x : player.y;
  const crossedOut = p.dir < 0 ? posOnAxis < p.edgeVal - 2 : posOnAxis > p.edgeVal + 2;
  return crossedOut && Math.abs(posOffAxis - p.crossPos) < d.gap;
}

// A boss room's single return door mirrors its hub door onto the opposite
// edge at the same offset, so arrival position and the way back always line
// up — moving a hub door in data.js never requires a matching manual edit.
function returnDoorFor(hubDoor) {
  return { id: hubDoor.id + 'Return', edge: opposite[hubDoor.edge], along: hubDoor.along, gap: hubDoor.gap + 15, room: 'center' };
}

function resetPlayerForRoom(doorUsed) {
  if (!doorUsed) { player.x = W / 2; player.y = H / 2 + 125; return; }
  const b = roomBounds();
  const arrival = opposite[doorUsed.edge];
  const perp = (doorUsed.edge === 'n' || doorUsed.edge === 's')
    ? b.l + (b.r - b.l) * doorUsed.along
    : b.t + (b.b - b.t) * doorUsed.along;
  if (arrival === 'n') { player.x = perp; player.y = b.t + 20; }
  else if (arrival === 's') { player.x = perp; player.y = b.b - 20; }
  else if (arrival === 'w') { player.x = b.l + 20; player.y = perp; }
  else { player.x = b.r - 20; player.y = perp; }
}

function enterRoom(next, doorUsed) {
  room = next;
  resetPlayerForRoom(doorUsed);
  fade = 1;
  // A soft door-swing whoosh on an actual crossing — doorUsed is null for
  // the very first room placement at boot, which shouldn't make noise.
  if (doorUsed) noiseHit(.14, .012, 1100, null, 'sfx');
  if (next === 'center' && typeof onEnterHub === 'function') onEnterHub();
}

// Watches wardCount() for increases frame to frame and gives it a chime —
// a ward is actually claimed during a boss fight/result screen (not while
// this file's update loop is even running), so this just catches the change
// on the first explore-mode frame after the player is back, regardless of
// which path got them there. A bigger layered chime once every ward is
// seated (the portal actually waking up) instead of just another ding.
let lastWardCount = null;
// Footstep-tick cadence timer, read/reset from updateExplore's own movement
// branch above.
let footstepTimer = 0;
function updateWardChimeWatch() {
  const count = wardCount();
  if (lastWardCount === null) { lastWardCount = count; return; }
  if (count > lastWardCount) {
    const awakened = count >= LIEUTENANTS.length;
    tone(awakened ? 640 : 480, awakened ? .5 : .22, 'sine', .05);
    if (awakened) noiseHit(.3, .03, 1200, null, 'sfx');
  }
  lastWardCount = count;
}

// The wall clamp normally keeps the player flush against the border
// everywhere (b.l+r..b.r-r) — but that alone would make a doorway
// uncrossable, since checkDoorCrossing needs the player to actually reach a
// couple pixels *past* the edge (posOnAxis < edgeVal-2) before it registers,
// and a flush clamp never lets them get there. So for whichever open door
// (if any) the player is currently lined up with laterally, the bound on
// that one axis is relaxed to let them overshoot past the wall — same
// allowance the door needs to be crossable, just no longer granted
// everywhere along the wall (that was the actual "walk through solid wall"
// bug: the old clamp gave every position that same overshoot, doorway or not).
// The candle's drawn wax body (drawCandle, render.js) extends noticeably
// further below its own anchor point than player.r accounts for (~14px at
// the hub's .9 scale/full "HP", vs. player.r's 8) — clamping the bottom edge
// on player.r alone let the visual wax clip into the floor/wall there, even
// though the logical top/left/right edges (where the flame/body are
// narrower) were already fine on that same margin.
const PLAYER_VISUAL_BOTTOM_MARGIN = 14;
function clampToRoom(b) {
  // Keyed on `perfected`, not `ward` — a door stays walkable until its
  // lieutenant is beaten hitless, not just beaten (see save.perfected, data.js).
  const relevantDoors = room === 'center' ? doors.filter(d => !save.perfected[d.room]) : [returnDoorFor(rooms[room].hubDoor)];
  let minX = b.l + player.r, maxX = b.r - player.r, minY = b.t + player.r, maxY = b.b - PLAYER_VISUAL_BOTTOM_MARGIN;
  for (const d of relevantDoors) {
    const p = doorPoint(d, b);
    const aligned = Math.abs((p.axis === 'y' ? player.x : player.y) - p.crossPos) < d.gap;
    if (!aligned) continue;
    if (p.axis === 'y') { if (p.dir < 0) minY = b.t - player.r; else maxY = b.b + player.r; }
    else { if (p.dir < 0) minX = b.l - player.r; else maxX = b.r + player.r; }
  }
  player.x = clamp(player.x, minX, maxX);
  player.y = clamp(player.y, minY, maxY);
}

function updateExplore(dt) {
  // Lazy-start rather than hooked into every way explore mode can be
  // entered (door crossing, closeResult, the intro-cutscene's dialogue
  // fallback...) — this just catches whichever one happened on the next
  // frame. Guarded so it doesn't re-trigger every frame once already
  // playing; battle music (setMusic in startBoss) naturally overrides it,
  // and it picks back up the same way once back in explore.
  if (musicMode !== 'explore') setMusic('explore');
  updateWardChimeWatch();
  const b = roomBounds();
  // Arrow keys deliberately excluded here — they're reserved for shield
  // control during battle (see moveSoulWithShield, hazards.js) and shouldn't
  // also walk the player around the hub.
  let dx = (keys['d'] || keys['l'] ? 1 : 0) - (keys['a'] || keys['j'] ? 1 : 0);
  let dy = (keys['s'] || keys['k'] ? 1 : 0) - (keys['w'] || keys['i'] ? 1 : 0);
  if (dx || dy) {
    const n = Math.hypot(dx, dy); dx /= n; dy /= n; player.x += dx * player.speed * dt; player.y += dy * player.speed * dt;
    // A quiet, rate-limited footstep tick while actually moving — tripled
    // BPM (was .3s) and 25% quieter (was .012) so a faster cadence doesn't
    // also read as louder.
    footstepTimer -= dt;
    if (footstepTimer <= 0) { tone(90 + rand(-8, 8), .05, 'square', .005, null, 'sfx'); footstepTimer = .1; }
  } else footstepTimer = 0;
  clampToRoom(b);

  if (room === 'center') {
    for (const d of doors) {
      // A door you've beaten but not perfected stays crossable — you can
      // walk back in for another shot at a hitless clear.
      if (!save.perfected[d.room] && checkDoorCrossing(d, b)) { enterRoom(d.room, d); return; }
    }
    if (allWards() && !save.erifWon && dist(player.x, player.y, W / 2, H / 2) < 88 && typeof approachErif === 'function') {
      approachErif();
    }
  } else {
    const hubDoor = rooms[room].hubDoor;
    if (checkDoorCrossing(returnDoorFor(hubDoor), b)) { enterRoom('center', returnDoorFor(hubDoor)); return; }
    const boss = rooms[room].boss;
    // Same reasoning as the door above — approaching the boss again re-fights
    // it as long as it isn't perfected yet, even if already warded.
    if (!save.perfected[boss] && dist(player.x, player.y, W / 2, H / 2) < 82 && typeof startBoss === 'function') {
      startBoss(boss);
    }
  }
}

// state: 'open' (never beaten, or beaten-but-not-perfected — see below,
// still fully crossable either way), 'beaten' (won at least once but not
// hitless — still crossable, just marked with a thin grey line so it reads
// as "done, but you could come back"), or 'closed' (perfected — the thick
// white bar, no longer crossable, matching the original single-state door).
function drawDoor(d, state = 'open') {
  const b = roomBounds();
  const p = doorPoint(d, b);
  // Matches d.gap exactly — that's the actual collision-passable half-width
  // (see checkDoorCrossing/clampToRoom), so the drawn opening never lies
  // about how wide the walkable gap really is. Those two used to disagree
  // (a hardcoded 34 here vs. gap:55/65), which meant a strip of wall right
  // next to the visible doorway looked solid but wasn't — you could walk
  // straight through what still read as wall.
  const halfSpan = d.gap;
  ctx.fillStyle = '#000';
  // An open door is just the cleared gap — no line drawn across it. A thin
  // line straight through the opening (the old behavior) read as a broken
  // seam in the border rather than a doorway, especially next to the full
  // 4px wall stroke.
  if (p.axis === 'y') {
    ctx.clearRect(p.crossPos - halfSpan, p.edgeVal - 8, halfSpan * 2, 18);
    if (state === 'closed') { ctx.strokeStyle = '#fff'; line(p.crossPos - halfSpan, p.edgeVal, p.crossPos + halfSpan, p.edgeVal, 5); }
    else if (state === 'beaten') { ctx.strokeStyle = '#888'; line(p.crossPos - halfSpan, p.edgeVal, p.crossPos + halfSpan, p.edgeVal, 1.5); }
  } else {
    ctx.clearRect(p.edgeVal - 8, p.crossPos - halfSpan, 18, halfSpan * 2);
    if (state === 'closed') { ctx.strokeStyle = '#fff'; line(p.edgeVal, p.crossPos - halfSpan, p.edgeVal, p.crossPos + halfSpan, 5); }
    else if (state === 'beaten') { ctx.strokeStyle = '#888'; line(p.edgeVal, p.crossPos - halfSpan, p.edgeVal, p.crossPos + halfSpan, 1.5); }
  }
}

// The hub-center portal: a dormant ring that brightens and gains a rotating
// inner ring once all 8 Wards are held, surrounded by 8 ward sockets spaced
// 45° apart in the same clockwise order as their actual doors, walking the
// room perimeter (hourglassN, maskN, executionerE, verdictE, witnessS,
// archivistS, galeW, oracleW). Reads directly off save.ward — no separate
// collection state needed.
const PORTAL_WARD_LAYOUT = [
  ['hourglass', -135], ['mask', -90], ['executioner', -45], ['verdict', 0],
  ['witness', 45], ['archivist', 90], ['gale', 135], ['oracle', 180],
];
function drawPortal() {
  const cx = W / 2, cy = H / 2, active = allWards(), t = performance.now() / 1000;

  // Each claimed ward glows warm the moment it's seated, not just once all 8
  // are in — the ring itself only lights up warm once the portal is fully
  // awake.
  const emberGlow = lerpColor(FLAME_FULL_COLOR, EMBER, .3);
  const ringColor = active ? emberGlow : '#fff';

  ctx.save();
  if (active) {
    // A slow ember pulse glow behind the ring — same heat-radiating language
    // Erif's own portrait aura uses, so the portal reads as a real mystic
    // gateway waking up rather than a flat stroked circle.
    const pulse = .5 + .5 * Math.sin(t * 1.6);
    ctx.save(); ctx.globalAlpha = .16 + .14 * pulse; ctx.strokeStyle = emberGlow; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, 68 + pulse * 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = ringColor; ctx.globalAlpha = active ? 1 : .4; ctx.lineWidth = active ? 3 : 2;
  ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.stroke();
  if (active) {
    // An inscribed rune-ring instead of a plain dashed spinner — short
    // radial ticks read as engraved marks rather than a generic loading-
    // spinner dash pattern.
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * .5); ctx.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) { ctx.save(); ctx.rotate(i * Math.PI / 8); line(0, -42, 0, -50, 1.5); ctx.restore(); }
    ctx.restore();
  }
  ctx.restore();

  for (const [name, deg] of PORTAL_WARD_LAYOUT) {
    const a = deg * Math.PI / 180;
    // A small, slow wander around each socket's base position — per-ward
    // phase offsets (from deg) so they don't all drift in lockstep.
    const driftX = Math.sin(t * .4 + deg * .07) * 4, driftY = Math.cos(t * .33 + deg * .05) * 4;
    const wx = cx + Math.cos(a) * 100 + driftX, wy = cy + Math.sin(a) * 100 + driftY;
    const filled = save.ward[name];
    ctx.save(); ctx.translate(wx, wy);
    ctx.strokeStyle = ctx.fillStyle = filled ? emberGlow : '#fff';
    ctx.globalAlpha = filled ? .85 + .15 * Math.sin(t * 3 + deg) : .45;
    ctx.lineWidth = filled ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(10, 0); ctx.lineTo(0, 13); ctx.lineTo(-10, 0); ctx.closePath();
    if (filled) {
      ctx.fill(); ctx.fillStyle = '#000'; text(name[0].toUpperCase(), 0, 1, 12, 'center', 1);
      // A small rune flourish at each point once lit — reads as an engraved
      // rune-stone rather than a bare filled diamond.
      ctx.strokeStyle = emberGlow; ctx.lineWidth = 1; ctx.globalAlpha = .8;
      line(0, -13, 0, -18, 1); line(10, 0, 15, 0, 1); line(0, 13, 0, 18, 1); line(-10, 0, -15, 0, 1);
    } else {
      ctx.stroke(); text(name[0].toUpperCase(), 0, 1, 12, 'center', .45);
    }
    ctx.restore();
  }

  ctx.fillStyle = '#fff';
  if (active) {
    text('THE PORTAL IS OPEN', cx, cy + 150, 15);
    text('APPROACH', cx, cy + 172, 12, 'center', .75);
  } else {
    text('THE PORTAL IS SEALED', cx, cy + 150, 14, 'center', .4);
    text(`${wardCount()}/${LIEUTENANTS.length} WARDS SEATED`, cx, cy + 172, 12, 'center', .35);
  }
}

// Faint drifting embers, purely decorative — deterministic per-index
// wander (no stored state needed) so a room never feels perfectly still and
// empty. Kept very subtle (low alpha, small, slow) on purpose. Warm-tinted
// rather than plain white dust — this is the Ember Hall, not an empty room.
function drawAmbientMotes(b) {
  const t = performance.now() / 1000;
  ctx.save(); ctx.fillStyle = FLAME_FULL_COLOR;
  for (let i = 0; i < 14; i++) {
    const ax = b.l + 30 + (i * 61) % (b.r - b.l - 60);
    const ay = b.t + 30 + (i * 97) % (b.b - b.t - 60);
    const x = ax + Math.sin(t * .25 + i * 1.7) * 22;
    const y = ay + Math.cos(t * .19 + i * 2.3) * 16;
    ctx.globalAlpha = .08 + .08 * (1 + Math.sin(t * .6 + i)) / 2;
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawExplore() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  const b = roomBounds(); drawFloorGrid(b.l, b.t, b.r - b.l, b.b - b.t);
  box(b.l, b.t, b.r - b.l, b.b - b.t, 4);
  drawAmbientMotes(b);

  // A door closes (barred, no longer crossable — see updateExplore) only
  // once its lieutenant is perfected; a boss you've beaten but not
  // perfected gets a thin grey line instead, marking it as "done, but you
  // could still walk back in for the upgrade a hitless clear grants."
  if (room === 'center') {
    for (const d of doors) drawDoor(d, save.perfected[d.room] ? 'closed' : save.ward[d.room] ? 'beaten' : 'open');
  } else drawDoor(returnDoorFor(rooms[room].hubDoor), 'open');

  text(rooms[room].name, W / 2, 25, 17);

  if (room === 'center') {
    drawPortal();
  } else {
    const type = rooms[room].boss;
    // Ghosted only once truly done (perfected) — a beaten-but-not-perfected
    // boss still has a real fight waiting, so its icon stays fully present.
    drawBossIcon(type, W / 2, H / 2, save.perfected[type]);
    if (save.ward[type]) {
      text(BOSS[type].ward, W / 2, H / 2 + 72, 15);
      text('COLLECTED', W / 2, H / 2 + 96, 12);
    } else {
      text('APPROACH', W / 2, H / 2 + 78, 12, 'center', .65);
    }
  }

  drawCandleTrail(player.x, player.y, .9);
  // Same small glow every candle avatar uses (see drawSoulGlow, render.js) —
  // was previously only ever drawn in battle, so the player's own flame
  // read as dark/lightless while just walking around the hub.
  drawSoulGlow(player.x, player.y, .9);
  drawCandle(player.x, player.y, .9, 1, false);
}
