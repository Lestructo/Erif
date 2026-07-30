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
// God Mode is locked behind actually beating Hard's true ending
// (save.erifTrueWon) unless the player types "fire" while on the title
// screen, which unlocks it for the rest of the session — see
// checkFireCode below and activateTitleItem/drawTitle's handling of the
// 'god' entry.
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
function godModeUnlocked() { return save.erifTrueWon || fireCodeUnlocked; }
function toggleGodMode() { godMode = !godMode; tone(godMode ? 260 : 140, .08, 'square', .03); }
function toggleSkipToErif() { skipToErifEnabled = !skipToErifEnabled; tone(skipToErifEnabled ? 260 : 140, .08, 'square', .03); }
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
  applyDifficultyTier(selectedDifficulty);
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

function updateTitle(dt) {
  checkFireCode();
  updateTitleAtmosphere(dt);
  const up = tap('arrowup') || tap('i'), down = tap('arrowdown') || tap('k');
  if (up || down) {
    const prevIndex = titleMenuIndex;
    titleMenuIndex = (titleMenuIndex + (up ? -1 : 1) + TITLE_ITEMS.length) % TITLE_ITEMS.length;
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
  if (tap(' ')) activateTitleItem(TITLE_ITEMS[titleMenuIndex]);
}

// Generous fixed-size hit region around each row's centered text — matches
// drawTitle's own y = H/2 + 86 + i*32 layout below. Wide enough to comfortably
// cover the longest label ("GOD MODE — ON/OFF") without needing to measure
// actual rendered text width.
function titleItemRect(i) {
  const y = H / 2 + 86 + i * 32;
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

  // A slow-pulsing, very-low-alpha glow behind the candle — gives it a sense
  // of actually casting light into the dark rather than floating in a void.
  // Two flat low-alpha circles rather than a true radial gradient, matching
  // how every other "glow" in the game (e.g. Erif's own portrait aura) is
  // built from plain concentric shapes, not canvas gradients.
  const glowT = performance.now() / 1000, pulse = .5 + .5 * Math.sin(glowT * .7);
  ctx.save();
  ctx.globalAlpha = .04 + .03 * pulse; ctx.fillStyle = EMBER;
  ctx.beginPath(); ctx.arc(W / 2, H / 2 - 2, 130 + pulse * 18, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = .07 + .05 * pulse; ctx.fillStyle = FLAME_FULL_COLOR;
  ctx.beginPath(); ctx.arc(W / 2, H / 2 - 2, 60 + pulse * 8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = ctx.fillStyle = '#fff';
  text('ERIF', W / 2, H / 2 - 112, 64);
  ctx.fillStyle = EMBER;
  text('UNYIELDING FLAME', W / 2, H / 2 - 54, 22);
  ctx.fillStyle = '#fff';

  drawCandle(W / 2, H / 2 - 2, 1.3, 1, false);

  TITLE_ITEMS.forEach((it, i) => {
    const y = H / 2 + 86 + i * 32;
    const active = titleMenuIndex === i;
    let label = it.label;
    if (it.key === 'god') label = godModeUnlocked() ? `${it.label} — ${godMode ? 'ON' : 'OFF'}` : `${it.label} — LOCKED`;
    else if (it.key === 'skip') label = `${it.label} — ${skipToErifEnabled ? 'ON' : 'OFF'}`;
    else if (it.key === 'reset' && resetArmed) label = 'PRESS AGAIN TO ERASE ALL DATA';
    ctx.globalAlpha = active ? 1 : .55;
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
