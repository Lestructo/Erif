'use strict';

// The perfect-clear upgrade-choice screen (mode: 'upgradeChoice') — offered
// by closeResult() (js/battle-core.js) in place of the normal hub-return
// whenever a lieutenant trial is cleared hitless and at least one upgrade
// type is still under its cap. See UPGRADE_CATALOG (js/data.js) for the
// actual bonus values and where each is applied; this file only owns the
// choice screen itself and committing a pick to save.upgrades/hpProgress.

function availableUpgradeTypes() {
  return Object.keys(UPGRADE_CATALOG).filter(k => save.upgrades[k] < UPGRADE_CATALOG[k].cap);
}

let upgradeChoiceOptions = [], upgradeChoiceIndex = 0, upgradeChoiceType = null;
// Per-card animated scale (drawUpgradeChoice) — eased toward 1.2 for the
// selected card and 1 for the rest each frame in updateUpgradeChoice, rather
// than snapping instantly, so moving the selection reads as a quick little
// grow/shrink instead of a hard cut.
let upgradeChoiceCardScale = [];

// Shared layout constants — both drawUpgradeChoice and the click hit-test
// (upgradeCardRect below) need the exact same numbers, so they're hoisted
// here rather than redeclared as locals in just the draw function.
const UPGRADE_CARD_W = 211, UPGRADE_CARD_GAP = 50, UPGRADE_CARD_H = 246, UPGRADE_CARD_Y = 190;
function upgradeCardRect(i, n) {
  const totalW = n * UPGRADE_CARD_W + Math.max(0, n - 1) * UPGRADE_CARD_GAP;
  const startX = W / 2 - totalW / 2;
  return { x: startX + i * (UPGRADE_CARD_W + UPGRADE_CARD_GAP), y: UPGRADE_CARD_Y, w: UPGRADE_CARD_W, h: UPGRADE_CARD_H };
}
// Click a card to select it — same effect as arrows/AD/JL, not an instant
// confirm, so a stray click can't lock in an upgrade the way pressing Space
// still deliberately requires. Called from render.js's handleCanvasClick,
// same true/false dispatch contract handleTitleMenuClick/handleVolumeMeterClick use.
function handleUpgradeChoiceClick(mx, my) {
  if (mode !== 'upgradeChoice') return false;
  const n = upgradeChoiceOptions.length;
  for (let i = 0; i < n; i++) {
    const r = upgradeCardRect(i, n);
    if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
    upgradeChoiceIndex = i;
    tone(220, .04, 'square', .025);
    return true;
  }
  return false;
}
// Scroll wheel also moves the selection, same convention as the title
// screen's own wheel listener (moveTitleSelection, title.js) — same 100ms
// cooldown so a single physical scroll notch doesn't skip several cards.
let lastUpgradeChoiceWheelT = 0;
addEventListener('wheel', e => {
  if (mode !== 'upgradeChoice') return;
  const now = performance.now();
  if (now - lastUpgradeChoiceWheelT < 100) return;
  lastUpgradeChoiceWheelT = now;
  const n = upgradeChoiceOptions.length;
  if (n === 0) return;
  upgradeChoiceIndex = (upgradeChoiceIndex + (e.deltaY > 0 ? 1 : -1) + n) % n;
  tone(220, .04, 'square', .025);
});

// Called from closeResult() — `type` is the boss just beaten, kept around so
// confirming a pick can still run the exact same hub-return closeResult()
// would have done for a normal win (see returnToHubAfterWin, battle-core.js).
function startUpgradeChoice(type) {
  upgradeChoiceType = type;
  upgradeChoiceOptions = shuffleArray(availableUpgradeTypes()).slice(0, 3);
  upgradeChoiceIndex = 0;
  upgradeChoiceCardScale = upgradeChoiceOptions.map(() => 1);
  mode = 'upgradeChoice';
}

function confirmUpgradeChoice() {
  const key = upgradeChoiceOptions[upgradeChoiceIndex];
  if (!key) return;
  const cat = UPGRADE_CATALOG[key];
  // HP is the only type that doesn't apply on the spot — it costs 4 picks
  // per realized stack, banked in hpProgress until it reaches costPerStack.
  if (key === 'hp') {
    save.hpProgress++;
    if (save.hpProgress >= cat.costPerStack) { save.hpProgress = 0; save.upgrades.hp++; }
  } else {
    save.upgrades[key]++;
  }
  tone(560, .18, 'sine', .04);
  saveGame();
  // Skip to Erif (title.js) walks through every lieutenant's perfect-clear
  // upgrade choice back to back before actually starting the fight — chain
  // into the next one instead of the normal hub-return.
  if (skipToErifQueue) { advanceSkipToErifUpgrades(); return; }
  // Respec Upgrades (title.js) walks through a whole re-earned batch the
  // same way — `!== null` rather than truthiness so the last pick (which
  // counts respecPicksRemaining down to exactly 0) still routes back
  // through advanceRespecUpgrades to close out the chain, instead of
  // falling into the normal single-pick hub-return below (there's no real
  // boss/hub to return to here — upgradeChoiceType is null for a respec).
  if (respecPicksRemaining !== null) { advanceRespecUpgrades(); return; }
  mode = 'explore';
  returnToHubAfterWin(upgradeChoiceType);
  battle = null; fade = 1;
}

function updateUpgradeChoice(dt) {
  const n = upgradeChoiceOptions.length;
  if (n === 0) { confirmUpgradeChoice(); return; } // defensive — startUpgradeChoice only ever runs with >=1 option
  if (tap('arrowleft') || tap('a') || tap('j')) { upgradeChoiceIndex = (upgradeChoiceIndex - 1 + n) % n; tone(220, .04, 'square', .025); }
  if (tap('arrowright') || tap('d') || tap('l')) { upgradeChoiceIndex = (upgradeChoiceIndex + 1) % n; tone(220, .04, 'square', .025); }
  if (tap(' ')) confirmUpgradeChoice();
  for (let i = 0; i < n; i++) {
    const target = i === upgradeChoiceIndex ? 1.1 : 1;
    upgradeChoiceCardScale[i] = lerp(upgradeChoiceCardScale[i] ?? 1, target, Math.min(1, dt * 14));
  }
}

// Formats a catalog entry's current -> next value for display. Speed still
// shows the bonus delta itself (its true in-fight base varies per
// boss/fight, so the bonus amount is the only universally-accurate number);
// HP/I-Frames/Shield show the real absolute stat since all three have one
// canonical base value everywhere (3 HP for any lieutenant, 1s i-frames,
// 15° shield angle tolerance — see SHIELD_ANGLE_TOLERANCE_BASE, hazards.js).
// Shield's px radius bonus doesn't get its own number here since, unlike the
// angle, it rides on a hitRadius that varies per hazard — the degrees figure
// is the one honest headline number for this upgrade.
function formatUpgradeValue(key, stacks) {
  const cat = UPGRADE_CATALOG[key];
  if (key === 'hp') return `${3 + cat.perStack * stacks} HP`;
  if (key === 'iframe') return `${(1 + cat.perStack * stacks).toFixed(2)}s`;
  if (key === 'shield') {
    const deg = (SHIELD_ANGLE_TOLERANCE_BASE + SHIELD_ANGLE_TOLERANCE_PER_STACK * stacks) * 180 / Math.PI;
    return `${Math.round(deg)}°`;
  }
  const amount = cat.perStack * stacks * (cat.unit === '%' ? 100 : 1);
  return `+${Math.round(amount)}${cat.unit}`;
}

function drawUpgradeChoice() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  text('A FLAWLESS FLAME.', W / 2, 86, 26);
  text('CHOOSE WHAT IT TEACHES YOU.', W / 2, 118, 15, 'center', .7);

  // ~12% smaller than the original 240x280 (was tuned down to 20% smaller,
  // then back up 10% from there) — sized so the hover-grow animation below
  // (upgradeChoiceCardScale) can push a selected card up past its resting
  // size without ever feeling cramped or crowding its neighbors. See
  // UPGRADE_CARD_W etc. above — shared with upgradeCardRect's click hit-test.
  const n = upgradeChoiceOptions.length, cardW = UPGRADE_CARD_W, gap = UPGRADE_CARD_GAP, cardH = UPGRADE_CARD_H;
  const totalW = n * cardW + Math.max(0, n - 1) * gap, startX = W / 2 - totalW / 2, y = UPGRADE_CARD_Y;
  upgradeChoiceOptions.forEach((key, i) => {
    const cat = UPGRADE_CATALOG[key], selected = i === upgradeChoiceIndex;
    // text() always sets its own explicit alpha (and resets to 1 after) —
    // it never inherits an ambient ctx.globalAlpha — so every call below
    // passes `a`-derived values directly rather than relying on a wrapping
    // ctx.save()/globalAlpha the way shape drawing (box()) can.
    const a = selected ? 1 : .55;
    const x = startX + i * (cardW + gap);
    const stacks = key === 'hp' ? save.upgrades.hp : save.upgrades[key];

    // Scale the whole card around its own center — the eased value from
    // updateUpgradeChoice, not a hard snap to 1/1.2, so selecting a
    // neighbor reads as a quick little grow/shrink instead of a jump cut.
    const scale = upgradeChoiceCardScale[i] ?? 1, cx = x + cardW / 2, cy = y + cardH / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);

    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fff';
    box(x, y, cardW, cardH, selected ? 3 : 2);
    ctx.restore();
    text(cat.name, x + cardW / 2, y + 30, 17, 'center', a);

    // Gap after the title opened up (was y+60, only 30px below the name) —
    // the rest of this common block (stats through CLAIMED/desc) is
    // identical across every card, so widening it here benefits all three
    // instead of only the card that happens to need extra room lower down.
    text(formatUpgradeValue(key, stacks), x + cardW / 2, y + 70, 15, 'center', a * .55);
    text('NEXT:', x + cardW / 2, y + 88, 11, 'center', a * .45);
    text(formatUpgradeValue(key, stacks + 1), x + cardW / 2, y + 112, 20, 'center', a);
    text(`${stacks}/${cat.cap} CLAIMED`, x + cardW / 2, y + 146, 11, 'center', a * .45);
    // Word-wrapped rather than a single fixed-y line — some descriptions
    // (shield, HP) run wider than a card at this font size and were getting
    // clipped past the card's edge instead of actually wrapping.
    const descLines = wrapLines(cat.desc, cardW - 24, 11.5);
    const descLineHeight = 13, descStartY = y + 166;
    descLines.forEach((ln, li) => text(ln, x + cardW / 2, descStartY + li * descLineHeight, 11.5, 'center', a * .7));

    // HP-only, pinned near the card's bottom edge instead of stacked right
    // under NEXT's value — keeps it out of the common block above so the
    // other two cards' layout doesn't need to change to make room for it.
    if (key === 'hp') {
      text(`${save.hpProgress}/${cat.costPerStack} TOWARD NEXT POINT`, x + cardW / 2, y + cardH - 34, 11, 'center', a * .5);
    }

    ctx.restore();
  });
}
