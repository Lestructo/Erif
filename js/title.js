'use strict';

// Title screen and difficulty/debug menu. Loaded after erif.js so it can
// call startBoss/applyDifficultyTier directly, same reasoning as why hub.js
// already loads after erif.js.

// Hard mode is unlocked from the start — it no longer requires a prior
// Normal-tier win.
let selectedDifficulty = 'normal';
// Debug/QA aids — God Mode makes hurt() (battle-core.js) a no-op. Skip to
// Erif is a toggle rather than its own action now: turn it on, then confirm
// NORMAL/HARD like normal — that's what actually launches the game, with
// Skip just changing what confirming lands you in.
let godMode = false;
let skipToErifEnabled = false;
// Skip to ??? goes one step further than Skip to Erif — straight into the
// Hard-only true final fight (the Reckoning) instead of just Erif's own
// fight. Same toggle-then-confirm-NORMAL/HARD convention (see beginBattle,
// battle-core.js, which is what actually detects this and jumps in).
// Enabling it always brings Skip to Erif along too, since reaching the
// Reckoning without also skipping to Erif wouldn't make sense — they're
// really the same shortcut, just one goes further.
let skipToTrueFinalEnabled = false;
// God Mode is locked behind actually beating Hard's true ending
// (save.erifTrueWon) unless the player types "fire" while on the title
// screen, which unlocks it for the rest of the session — see
// checkFireCode below and activateTitleItem/drawTitle's handling of the
// 'god' entry. Skip to ??? shares that same unlock condition (typing "true"
// instead of "fire") — reaching the Reckoning is exactly the same spoiler
// as God Mode already gates on, so there's no reason for a separate,
// earlier bar.
let fireCodeUnlocked = false;
let fireCodeBuffer = '';
function checkFireCode() {
  for (const k of ['f', 'i', 'r', 'e']) {
    if (tap(k)) {
      fireCodeBuffer = (fireCodeBuffer + k).slice(-4);
      if (fireCodeBuffer === 'fire' && !fireCodeUnlocked) { fireCodeUnlocked = true; tone(500, .14, 'sine', .05); }
    }
  }
}
let trueCodeUnlocked = false;
let trueCodeBuffer = '';
function checkTrueCode() {
  for (const k of ['t', 'r', 'u', 'e']) {
    if (tap(k)) {
      trueCodeBuffer = (trueCodeBuffer + k).slice(-4);
      if (trueCodeBuffer === 'true' && !trueCodeUnlocked) { trueCodeUnlocked = true; tone(500, .14, 'sine', .05); }
    }
  }
}
function godModeUnlocked() { return save.erifTrueWon || fireCodeUnlocked; }
function skipToTrueFinalUnlocked() { return save.erifTrueWon || trueCodeUnlocked; }
function toggleGodMode() { godMode = !godMode; tone(godMode ? 260 : 140, .08, 'square', .03); }
function toggleSkipToErif() { skipToErifEnabled = !skipToErifEnabled; tone(skipToErifEnabled ? 260 : 140, .08, 'square', .03); }
function toggleSkipToTrueFinal() {
  skipToTrueFinalEnabled = !skipToTrueFinalEnabled;
  if (skipToTrueFinalEnabled) skipToErifEnabled = true;
  tone(skipToTrueFinalEnabled ? 260 : 140, .08, 'square', .03);
}
// Non-null while Skip to Erif is walking through each lieutenant's perfect-
// clear upgrade choice back to back — holds the names still left to grant a
// pick for. confirmUpgradeChoice (upgrades.js) checks this to chain into the
// next one instead of the normal single-pick hub-return.
let skipToErifQueue = null;
// Pulls the next lieutenant off the queue and shows its upgrade choice —
// skipping straight past any that have nothing left to offer (every type
// already at cap) instead of showing an empty screen. Once the queue is
// empty, actually starts the fight.
function advanceSkipToErifUpgrades() {
  while (skipToErifQueue && skipToErifQueue.length) {
    const next = skipToErifQueue.shift();
    if (availableUpgradeTypes().length) { startUpgradeChoice(next); return; }
  }
  skipToErifQueue = null;
  startBoss('erif');
}
function skipToErif() {
  // Skip to ??? forces Hard regardless of which difficulty button actually
  // confirmed this — the Reckoning is Hard-only, so Normal would just dead-
  // end back at the regular ending with no true final fight to land in.
  applyDifficultyTier(skipToTrueFinalEnabled ? 'hard' : selectedDifficulty);
  // Only queue upgrade offers for lieutenants that genuinely weren't
  // perfected yet BEFORE this skip — `perfected` means "the perfect-clear
  // reward has already been claimed" everywhere else in the game, and
  // Skip to Erif needs to respect that same rule. Without this, using Skip
  // to Erif more than once on the same save (the normal way to repeatedly
  // test the late-game content) re-queued all 8 lieutenants every time,
  // handing out fresh upgrade picks for ones already claimed and letting
  // stacks silently climb well past what real play could ever earn.
  const newlyPerfected = LIEUTENANTS.filter(n => !save.perfected[n]);
  // Marks every lieutenant ward AND perfected so the hub/portal still reads
  // consistently if the player ever backs out of the fight — Erif's own
  // approach/intro logic otherwise assumes all 8 have already been beaten,
  // and a real perfect clear would have closed every door for good too.
  LIEUTENANTS.forEach(n => { save.ward[n] = true; save.perfected[n] = true; });
  room = 'center';
  resetPlayerForRoom(null);
  mode = 'explore';
  skipToErifQueue = newlyPerfected;
  advanceSkipToErifUpgrades();
}

const TITLE_ITEMS = [
  { key: 'normal', label: 'NORMAL', type: 'difficulty' },
  { key: 'hard', label: 'HARD', type: 'difficulty' },
  { key: 'skip', label: 'SKIP TO ERIF', type: 'toggle' },
  { key: 'skipTrue', label: 'SKIP TO ???', type: 'toggle' },
  { key: 'god', label: 'GOD MODE', type: 'toggle' },
  { key: 'reset', label: 'RESET DATA', type: 'action' },
];
let titleMenuIndex = 0;
// RESET DATA is destructive and can't be undone, so confirming it takes two
// presses/clicks: the first just arms it (see drawTitle's label swap below),
// the second actually wipes the save. Stepping away from the row (moving the
// cursor, or a click elsewhere) disarms it again rather than leaving a live
// "one more Space wipes everything" trap sitting on the menu.
let resetArmed = false;

// Shared by both the keyboard confirm (Space) and a direct mouse click (see
// handleTitleMenuClick below) so the two input paths can never drift apart.
function activateTitleItem(item) {
  if (item.key !== 'reset') resetArmed = false;
  if (item.type === 'difficulty') {
    // Skip to ??? always forces Hard (see skipToErif) regardless of which
    // button confirms it — but silently launching Hard content off a
    // NORMAL click read as broken rather than intentional, so NORMAL is
    // just disabled outright while it's on (see drawTitle's greyed-out
    // label) instead of quietly no-oping.
    if (item.key === 'normal' && skipToTrueFinalEnabled) { tone(90, .08, 'square', .02); return; }
    selectedDifficulty = item.key;
    if (skipToErifEnabled) { skipToErif(); return; }
    applyDifficultyTier(selectedDifficulty);
    // A returning player (any lieutenant already warded, meaning this isn't
    // a brand-new save) has already seen the intro cutscene in an earlier
    // session — skip straight to the hub's own current lore beat instead of
    // replaying it every time NORMAL/HARD gets picked from the title screen.
    if (LIEUTENANTS.some(n => save.ward[n])) {
      if (!startErifDialogue(wardCount())) mode = 'explore';
    } else {
      dialogue = { lines: INTRO_CUTSCENE, index: 0, after: 'introDone', context: 'introScene', speaker: '???' };
      mode = 'dialogue';
    }
    tone(300, .15, 'sawtooth', .04);
  } else if (item.key === 'god') {
    if (!godModeUnlocked()) { tone(90, .08, 'square', .02); return; } // still locked — a low buzz, not a toggle
    toggleGodMode();
  } else if (item.key === 'skip') {
    toggleSkipToErif();
  } else if (item.key === 'skipTrue') {
    if (!skipToTrueFinalUnlocked()) { tone(90, .08, 'square', .02); return; } // still locked — a low buzz, not a toggle
    toggleSkipToTrueFinal();
  } else if (item.key === 'reset') {
    if (!resetArmed) { resetArmed = true; tone(160, .1, 'sawtooth', .04); }
    else { resetArmed = false; resetSaveGame(); tone(90, .3, 'sawtooth', .06); }
  }
}

// Ambient atmosphere for the title screen — a slow drift of rising embers
// (shared system, see spawnEmber/updateEmbers/drawEmbers in render.js). Lives
// here rather than inside update()'s generic dispatch since it's purely a
// title-screen flourish.
let titleEmberTimer = 0;
function updateTitleAtmosphere(dt) {
  titleEmberTimer -= dt;
  if (titleEmberTimer <= 0) {
    spawnEmber(rand(40, W - 40), H - rand(0, 50), { speed: [14, 30], life: [1.8, 3.2] });
    titleEmberTimer = rand(.2, .4);
  }
  updateEmbers(dt);
}

// Lets the candle wander around the title screen with WASD, purely for
// fun/atmosphere — a separate position from the real hub `player` (data.js)
// on purpose, so wandering around here doesn't carry over and leave the
// player's actual hub position shifted the next time they start a game.
// Lazily initialized to the candle's normal resting spot so it starts right
// where it's always been drawn.
let titleWanderX = null, titleWanderY = null;
function updateTitleWander(dt) {
  if (titleWanderX === null) { titleWanderX = W / 2; titleWanderY = H / 2 - 2 + TITLE_CANDLE_Y_SHIFT; }
  let dx = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0), dy = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);
  if (dx || dy) {
    const n = Math.hypot(dx, dy); dx /= n; dy /= n;
    titleWanderX += dx * 160 * dt; titleWanderY += dy * 160 * dt;
    // Same quiet rate-limited footstep tick explore mode uses (updateExplore,
    // hub.js) — footstepTimer is a genuine shared global (plain <script>
    // scope, not a module), safe to reuse since title and hub are never both
    // the active mode at once.
    footstepTimer -= dt;
    if (footstepTimer <= 0) { tone(90 + rand(-8, 8), .05, 'square', .005, null, 'sfx'); footstepTimer = .1; }
  } else footstepTimer = 0;
  titleWanderX = clamp(titleWanderX, 24, W - 24); titleWanderY = clamp(titleWanderY, 24, H - 24);
}
function updateTitle(dt) {
  checkFireCode();
  checkTrueCode();
  // Lazy-start, same convention updateExplore (hub.js) uses for its own
  // ambient track — guarded so it doesn't re-trigger every frame once
  // already playing.
  if (musicMode !== 'title') setMusic('title');
  updateTitleAtmosphere(dt);
  updateTitleWander(dt);
  const up = tap('arrowup') || tap('i'), down = tap('arrowdown') || tap('k');
  if (up || down) moveTitleSelection(up ? -1 : 1);
  if (tap(' ')) activateTitleItem(TITLE_ITEMS[titleMenuIndex]);
}
// Shared by the arrow/IJK keys above and the scroll-wheel listener below —
// dir is -1 (up) or 1 (down).
function moveTitleSelection(dir) {
  const prevIndex = titleMenuIndex;
  titleMenuIndex = (titleMenuIndex + dir + TITLE_ITEMS.length) % TITLE_ITEMS.length;
  if (titleMenuIndex !== prevIndex) resetArmed = false;
  // Syncs the moment the cursor lands on NORMAL/HARD, not only once
  // confirmed — otherwise a keyboard-only player arrowing past HARD on
  // the way to GOD MODE/SKIP TO ERIF would never actually set it, since
  // there's no mouse hover to fall back on and confirming HARD directly
  // starts the intro instead of just marking it selected.
  const hovered = TITLE_ITEMS[titleMenuIndex];
  if (hovered.type === 'difficulty') selectedDifficulty = hovered.key;
  tone(220, .04, 'square', .025);
}
// Scroll wheel also moves the selection, same as arrows/IJK — only on the
// title screen, since nothing else in the game has a scrollable list. A
// short cooldown, since a single physical scroll "click" (mouse wheel or
// trackpad) commonly fires several rapid wheel events — without it, one
// scroll notch could jump several menu rows at once instead of moving one
// step at a time like every other input here.
let lastTitleWheelT = 0;
addEventListener('wheel', e => {
  if (mode !== 'title') return;
  const now = performance.now();
  if (now - lastTitleWheelT < 100) return;
  lastTitleWheelT = now;
  moveTitleSelection(e.deltaY > 0 ? 1 : -1);
});

// Separate shifts for the header text (ERIF/UNYIELDING FLAME), the candle +
// its glow, and the menu list below — added a 6th menu row (Skip to ???)
// without any of this, the list was crowding the bottom-of-screen volume
// meters/controls legend with barely any gap left. Three independent shifts
// rather than one shared one so the candle can actually sit centered in the
// gap between the subtitle and the first menu row instead of just following
// whichever of the two it's grouped with.
const TITLE_HEADER_Y_SHIFT = -70;
const TITLE_CANDLE_Y_SHIFT = -27; // centers the candle+glow between UNYIELDING FLAME and NORMAL
const TITLE_MENU_Y_SHIFT = -20;
// Generous fixed-size hit region around each row's centered text — matches
// drawTitle's own y = H/2 + 86 + i*32 + TITLE_MENU_Y_SHIFT layout below.
// Wide enough to comfortably cover the longest label ("GOD MODE — ON/OFF")
// without needing to measure actual rendered text width.
function titleItemRect(i) {
  const y = H / 2 + 86 + i * 32 + TITLE_MENU_Y_SHIFT;
  return { x: W / 2 - 160, y: y - 14, w: 320, h: 28 };
}
// Called from render.js's handleCanvasClick — returns true if the click
// landed on a menu row (and already activated it), same true/false
// dispatch contract handleVolumeMeterClick uses.
function handleTitleMenuClick(mx, my) {
  if (mode !== 'title') return false;
  for (let i = 0; i < TITLE_ITEMS.length; i++) {
    const r = titleItemRect(i);
    if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
    titleMenuIndex = i;
    activateTitleItem(TITLE_ITEMS[i]);
    return true;
  }
  return false;
}

function drawTitle() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // Ties the title into the same background language every other screen
  // already uses (hub rooms, battle arenas) instead of a flat void.
  drawFloorGrid(0, 0, W, H);
  drawEmbers();

  // A soft vignette — darkened corners pull focus toward the candle/title
  // instead of the whole floor grid reading at one flat brightness, same
  // "dungeon torch-lit room" mood as Pixel Dungeon's own screens.
  ctx.save();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * .32, W / 2, H / 2, H * .78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Follows the candle's own wandered position (updateTitleWander) instead
  // of the fixed resting spot, same as the trail/candle themselves below.
  if (titleWanderX === null) { titleWanderX = W / 2; titleWanderY = H / 2 - 2 + TITLE_CANDLE_Y_SHIFT; }
  drawCandleTrail(titleWanderX, titleWanderY, 1.3);
  // Same small glow every candle avatar uses (see drawSoulGlow, render.js) —
  // not a bigger bespoke "ambient" version. Same anchor/scale drawCandle
  // itself uses below.
  drawSoulGlow(titleWanderX, titleWanderY, 1.3);

  // A pulsing engraved frame around "ERIF" instead of a soft glow blob (a
  // filled ellipse at this size just read as a flat solid oval, not light)
  // — a bordered plaque with small corner ticks, same rune-tick language
  // used elsewhere (Hourglass's neck mark, the hub portal's rune-ring).
  const titleT = performance.now() / 1000, headerY = H / 2 - 112 + TITLE_HEADER_Y_SHIFT;
  const titlePulse = .5 + .5 * Math.sin(titleT * 1.1);
  // Measured against the actual rendered text instead of a guessed
  // constant, so it hugs "ERIF" as tightly as padding allows, and centered
  // exactly on the text's own (textBaseline='middle') anchor point — the
  // box used to carry its own separate vertical offset, which is what
  // threw its centering off from the letters.
  ctx.font = '64px "Courier New",monospace';
  const boxW = ctx.measureText('ERIF').width + 14, boxH = 56, boxX = W / 2 - boxW / 2, boxY = headerY - boxH / 2;
  ctx.save();
  // A very faint pulsing fill behind the letters — just enough to read as a
  // little light pooled inside the frame, not a solid panel.
  ctx.globalAlpha = .05 + .03 * titlePulse; ctx.fillStyle = EMBER;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = EMBER; ctx.globalAlpha = .45 + .25 * titlePulse; ctx.lineWidth = 1.5;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  const tick = 10;
  for (const [cx, cy, dx, dy] of [[boxX, boxY, 1, 1], [boxX + boxW, boxY, -1, 1], [boxX, boxY + boxH, 1, -1], [boxX + boxW, boxY + boxH, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy + dy * tick); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * tick, cy); ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = ctx.fillStyle = '#fff';
  text('ERIF', W / 2, H / 2 - 112 + TITLE_HEADER_Y_SHIFT, 64);
  ctx.fillStyle = EMBER;
  // Each character floats independently by a small random amount instead of
  // the subtitle sitting perfectly still (the flanking flame-flourishes
  // this replaced felt like an unrelated bolt-on rather than the text
  // itself being alive).
  {
    const subStr = 'UNYIELDING FLAME', subSize = 22, subY = H / 2 - 54 + TITLE_HEADER_Y_SHIFT;
    ctx.font = `${subSize}px "Courier New",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const charW = ctx.measureText('M').width;
    let cx = W / 2 - (charW * subStr.length) / 2 + charW / 2;
    // Slower, smaller-amplitude, and less chaotically out-of-phase between
    // neighbors than the first pass — that one moved too fast/far and let
    // adjacent characters' jitter overlap into each other's space.
    for (let i = 0; i < subStr.length; i++) {
      const jx = Math.sin(titleT * .4 + i * 1) * .8, jy = Math.sin(titleT * .5 + i * 1.3) * .8;
      ctx.fillText(subStr[i], cx + jx, subY + jy);
      cx += charW;
    }
  }
  ctx.fillStyle = '#fff';

  // A handful of embers spawning off the box's own perimeter and floating
  // away from it, plus a small flickering flame-flourish flanking the
  // subtitle on each side — both the frame and the embers are the same
  // color, so the box itself reads as the thing actually shedding them,
  // not two unrelated red effects sharing a coincidental color.
  ctx.save(); ctx.fillStyle = EMBER;
  for (let i = 0; i < 6; i++) {
    const cycle = (titleT * .22 + i * .37) % 1;
    // Evenly spaced perimeter positions (0-1 fraction around the box),
    // walking top -> right -> bottom -> left.
    const perim = (i / 6 + titleT * .015) % 1;
    const half = (boxW + boxH) * 2, along = perim * half;
    let bx, by;
    if (along < boxW) { bx = boxX + along; by = boxY; }
    else if (along < boxW + boxH) { bx = boxX + boxW; by = boxY + (along - boxW); }
    else if (along < boxW * 2 + boxH) { bx = boxX + boxW - (along - boxW - boxH); by = boxY + boxH; }
    else { bx = boxX; by = boxY + boxH - (along - boxW * 2 - boxH); }
    // Drifts outward away from the box center as it floats and fades.
    const dx = bx - W / 2, dy = by - (boxY + boxH / 2);
    const dlen = Math.max(1, Math.hypot(dx, dy));
    const drift = cycle * 26;
    const ex = bx + (dx / dlen) * drift, ey = by + (dy / dlen) * drift;
    ctx.globalAlpha = (1 - cycle) * .55;
    ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  drawCandle(titleWanderX, titleWanderY, 1.3, 1, false);

  TITLE_ITEMS.forEach((it, i) => {
    const y = H / 2 + 86 + i * 32 + TITLE_MENU_Y_SHIFT;
    const active = titleMenuIndex === i;
    let label = it.label;
    if (it.key === 'god') label = godModeUnlocked() ? `${it.label} — ${godMode ? 'ON' : 'OFF'}` : `${it.label} — LOCKED`;
    else if (it.key === 'skip') label = `${it.label} — ${skipToErifEnabled ? 'ON' : 'OFF'}`;
    else if (it.key === 'skipTrue') label = skipToTrueFinalUnlocked() ? `${it.label} — ${skipToTrueFinalEnabled ? 'ON' : 'OFF'}` : `${it.label} — LOCKED`;
    else if (it.key === 'normal' && skipToTrueFinalEnabled) label = `${it.label} — DISABLED`;
    else if (it.key === 'reset' && resetArmed) label = 'PRESS AGAIN TO ERASE ALL DATA';
    // Greyed out well below the usual unfocused .55 — Skip to ??? forces
    // Hard regardless (see activateTitleItem), so NORMAL can't actually be
    // confirmed while it's on.
    ctx.globalAlpha = (it.key === 'normal' && skipToTrueFinalEnabled) ? .25 : active ? 1 : .55;
    ctx.fillStyle = it.key === 'reset' && resetArmed ? EMBER : '#fff';
    // The cursor used to be baked into the same centered string ("> LABEL"
    // vs "  LABEL") — centering a string with invisible leading characters
    // shifts the visible text off true-center by half their width. Drawing
    // the label on its own and the cursor as a separate glyph keeps the
    // label itself genuinely centered regardless of length — the cursor's
    // own position is measured off the label's actual rendered width (was a
    // fixed offset, which left a big gap in front of shorter labels like
    // "HARD") so it always sits just one small gap to the label's left.
    ctx.font = '18px "Courier New",monospace';
    const labelWidth = ctx.measureText(label).width;
    text(label, W / 2, y, 18, 'center');
    if (active) text('>', W / 2 - labelWidth / 2 - 10, y, 18, 'right');
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
  });

  // Volume has its own always-on meters in the corner now (see
  // drawVolumeMeters in render.js) — no need for a second, title-only one.
  // The arrows/space hint isn't needed either now that the controls legend
  // (also always-on, bottom-left) covers it.
}
