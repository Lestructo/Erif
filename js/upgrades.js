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

// Called from closeResult() — `type` is the boss just beaten, kept around so
// confirming a pick can still run the exact same hub-return closeResult()
// would have done for a normal win (see returnToHubAfterWin, battle-core.js).
function startUpgradeChoice(type) {
  upgradeChoiceType = type;
  upgradeChoiceOptions = shuffleArray(availableUpgradeTypes()).slice(0, 3);
  upgradeChoiceIndex = 0;
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
  mode = 'explore';
  returnToHubAfterWin(upgradeChoiceType);
  battle = null; fade = 1;
}

function updateUpgradeChoice(dt) {
  const n = upgradeChoiceOptions.length;
  if (n === 0) { confirmUpgradeChoice(); return; } // defensive — startUpgradeChoice only ever runs with >=1 option
  if (tap('arrowleft') || tap('a') || tap('j')) upgradeChoiceIndex = (upgradeChoiceIndex - 1 + n) % n;
  if (tap('arrowright') || tap('d') || tap('l')) upgradeChoiceIndex = (upgradeChoiceIndex + 1) % n;
  if (tap(' ')) confirmUpgradeChoice();
}

// Formats a catalog entry's current -> next value for display. Speed/Shield
// show the bonus delta itself (their true in-fight base varies per
// boss/hazard, so the bonus amount is the only universally-accurate
// number); HP/I-Frames show the real absolute stat since both have one
// canonical base value everywhere (3 HP for any lieutenant, .75s i-frames).
function formatUpgradeValue(key, stacks) {
  const cat = UPGRADE_CATALOG[key];
  if (key === 'hp') return `${3 + cat.perStack * stacks} HP`;
  if (key === 'iframe') return `${(.75 + cat.perStack * stacks).toFixed(2)}s`;
  const amount = cat.perStack * stacks * (cat.unit === '%' ? 100 : 1);
  return `+${Math.round(amount)}${cat.unit}`;
}

function drawUpgradeChoice() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  text('A FLAWLESS FLAME.', W / 2, 86, 26);
  text('CHOOSE WHAT IT TEACHES YOU.', W / 2, 118, 15, 'center', .7);

  const n = upgradeChoiceOptions.length, cardW = 240, gap = 24, cardH = 280;
  const totalW = n * cardW + Math.max(0, n - 1) * gap, startX = W / 2 - totalW / 2, y = 190;
  upgradeChoiceOptions.forEach((key, i) => {
    const cat = UPGRADE_CATALOG[key], selected = i === upgradeChoiceIndex;
    // text() always sets its own explicit alpha (and resets to 1 after) —
    // it never inherits an ambient ctx.globalAlpha — so every call below
    // passes `a`-derived values directly rather than relying on a wrapping
    // ctx.save()/globalAlpha the way shape drawing (box()) can.
    const a = selected ? 1 : .55;
    const x = startX + i * (cardW + gap);
    const stacks = key === 'hp' ? save.upgrades.hp : save.upgrades[key];
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fff';
    box(x, y, cardW, cardH, selected ? 3 : 2);
    ctx.restore();
    text(cat.name, x + cardW / 2, y + 34, 15, 'center', a);

    text(formatUpgradeValue(key, stacks), x + cardW / 2, y + 76, 13, 'center', a * .55);
    text('NEXT:', x + cardW / 2, y + 98, 10, 'center', a * .45);
    text(formatUpgradeValue(key, stacks + 1), x + cardW / 2, y + 122, 18, 'center', a);

    if (key === 'hp') {
      text(`${save.hpProgress}/${cat.costPerStack} TOWARD NEXT POINT`, x + cardW / 2, y + 150, 10, 'center', a * .5);
    }
    text(`${stacks}/${cat.cap} CLAIMED`, x + cardW / 2, y + cardH - 46, 10, 'center', a * .45);
    // Word-wrapped rather than a single fixed-y line — some descriptions
    // (shield, HP) run wider than a card at this font size and were getting
    // clipped past the card's edge instead of actually wrapping.
    const descLines = wrapLines(cat.desc, cardW - 24, 10.5);
    const descLineHeight = 13, descStartY = y + cardH - 22 - (descLines.length - 1) * (descLineHeight / 2);
    descLines.forEach((ln, li) => text(ln, x + cardW / 2, descStartY + li * descLineHeight, 10.5, 'center', a * .7));
  });

  // Sits well above drawControlsLegend's own always-on row (y1=H-21) — this
  // screen's card-select input isn't covered by that generic legend, but
  // the two shouldn't crowd each other.
  text('ARROWS/AD/JL — SELECT     SPACE — CONFIRM', W / 2, H - 58, 11, 'center', .5);
}
