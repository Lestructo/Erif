'use strict';

// update()/draw() dispatchers, bootstrap, and the RAF loop. Must be the last
// script tag — everything it calls is defined by files loaded before it.

// Set by drawEnding/drawTrueEnding/drawErifVictory's white-flash phase (see
// render.js) each frame a light background is actually on screen, and read
// back by the always-on overlays (drawVolumeMeters) so they can invert their
// own colors to stay legible instead of always assuming a dark background.
// Reset here at the top of every frame's draw() so a screen that stops being
// light-background doesn't leave it stuck on.
let lightScreenActive = false;

// Esc pauses/resumes from any of the core "playing" modes — deliberately not
// from dialogue/cutscenes/victory sequences, which are scripted and shouldn't
// be interruptible mid-beat. Pausing freezes gameplay updates AND music (see
// update() below skipping updateMusic while paused, and the explicit
// pause()/play() here for Erif's theme specifically — it's a real <audio>
// element that keeps playing in real time regardless of the game loop
// unless told otherwise, unlike the procedural tracks which just stop
// getting new notes scheduled) and offers a way back to the title screen
// without just closing the tab.
const PAUSABLE_MODES = ['explore', 'battle', 'intro', 'result', 'upgradeChoice'];
let prePauseMode = null;
function togglePause() {
  if (mode === 'paused') {
    mode = prePauseMode; prePauseMode = null;
    if (musicMode === 'erif') { try { ensureErifTheme().play().catch(() => {}); } catch {} }
    if (musicMode === 'erifTrue') { try { ensureTrueTheme().play().catch(() => {}); } catch {} }
    tone(180, .05, 'square', .03);
  } else if (PAUSABLE_MODES.includes(mode)) {
    prePauseMode = mode; mode = 'paused';
    if (musicMode === 'erif') { try { ensureErifTheme().pause(); } catch {} }
    if (musicMode === 'erifTrue') { try { ensureTrueTheme().pause(); } catch {} }
    tone(240, .05, 'square', .03);
  }
}
function returnToMainMenuFromPause() {
  stopMusic();
  battle = null;
  mode = 'title';
  prePauseMode = null;
  tone(120, .2, 'sawtooth', .04);
}
function updatePaused(dt) {
  if (tap(' ')) returnToMainMenuFromPause();
}
function drawPauseOverlay() {
  ctx.save();
  ctx.fillStyle = '#000'; ctx.globalAlpha = .72; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  text('PAUSED', W / 2, H / 2 - 40, 32);
  text('ESC — RESUME', W / 2, H / 2 + 20, 16);
  text('SPACE — RETURN TO MAIN MENU', W / 2, H / 2 + 50, 16);
  ctx.restore();
}

function update(dt) {
  if (tap('escape')) {
    // The closing screens used to just tell the player to refresh the tab
    // to play again — Esc now does that in-game instead, the same
    // "stop music, drop the battle, back to title" step the pause menu's
    // own Space option already uses.
    if (mode === 'ending' || mode === 'trueEnding') { returnToMainMenuFromPause(); return; }
    togglePause();
    return;
  }
  if (mode === 'paused') { updatePaused(dt); return; }
  updateMusic(dt);
  if (mode === 'title') updateTitle(dt);
  else if (mode === 'explore') updateExplore(dt);
  else if (mode === 'dialogue') {
    updateDialogueReveal(dt);
    // The dialogue that plays right as Erif enters the Enraged phase plays
    // all the way through on its own — no Space required, no way to skip —
    // instead of waiting on the player like every other dialogue does
    // (including the one leading into the fight itself, which is unchanged).
    if (dialogue && dialogue.after === 'erifEnraged') {
      // battle.t only ever advances inside updateBattle (mode === 'battle'),
      // which this dialogue isn't — without this it'd sit frozen for the
      // whole cutscene, handing the whole-fight timer (ERIF_FIGHT_TIME_LIMIT,
      // erif.js) a free pause it isn't supposed to get.
      if (battle) battle.t += dt;
      const len = dialogue.lines[dialogue.index].length;
      if ((dialogue.revealCount || 0) >= len) {
        dialogue.holdTimer = (dialogue.holdTimer ?? DIALOGUE_AUTO_HOLD) - dt;
        if (dialogue.holdTimer <= 0) { dialogue.holdTimer = null; advanceDialogue(); }
      }
    } else if (tap(' ')) advanceDialogue();
  }
  else if (mode === 'intro' && tap(' ')) beginBattle();
  else if (mode === 'battle') updateBattle(dt);
  else if (mode === 'erifVictory') updateErifVictory(dt);
  else if (mode === 'erifTwist') { updateDialogueReveal(dt); if (tap(' ')) advanceDialogue(); }
  else if (mode === 'erifTrueVictory') updateErifTrueVictory(dt);
  else if (mode === 'result' && battle && !save.ward[battle.type] && tap('r')) restartBoss();
  else if (mode === 'result' && tap(' ')) closeResult();
  else if (mode === 'upgradeChoice') updateUpgradeChoice(dt);
  else if (mode === 'ending') messageTimer += dt;
  else if (mode === 'trueEnding') messageTimer += dt;
  fade = Math.max(0, fade - dt * 2.5);
}

function draw() {
  lightScreenActive = false;
  // While paused, the frozen gameplay screen underneath is still drawn
  // (via whichever mode we paused out of) with the pause overlay on top,
  // rather than replacing it with a blank screen.
  const drawMode = mode === 'paused' ? prePauseMode : mode;
  if (drawMode === 'title') drawTitle();
  else if (drawMode === 'explore') drawExplore();
  else if (drawMode === 'dialogue' || drawMode === 'erifTwist') drawDialogue();
  else if (drawMode === 'battle') {
    // A very short, small-amplitude shake on taking a hit (battle.hitShakeT,
    // set in hurt(), battle-core.js), plus a second source that ramps in
    // right alongside either of Erif's hard-timeout white-outs
    // (battle.erifReckoningFadeT/erifFightFadeT, 0-1 over their last 5s —
    // see updateErifHandsFinale/updateErif, erif.js) so the screen visibly
    // rattles apart as it fades, not just goes quietly white. Both wrap only
    // the arena draw call so the controls legend/volume meters/pause overlay
    // drawn below stay put.
    const hitShake = battle ? (battle.hitShakeT / .12) * 4 : 0;
    const fadeShake = battle ? Math.max(battle.erifReckoningFadeT, battle.erifFightFadeT) * 9 : 0;
    const shakeMag = hitShake + fadeShake;
    if (shakeMag > 0) {
      ctx.save();
      ctx.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
      drawBattle();
      ctx.restore();
    } else drawBattle();
  }
  else if (drawMode === 'intro' || drawMode === 'result') drawOverlay();
  else if (drawMode === 'upgradeChoice') drawUpgradeChoice();
  else if (drawMode === 'erifVictory') drawErifVictory();
  else if (drawMode === 'erifTrueVictory') drawErifTrueVictory();
  else if (drawMode === 'ending') drawEnding();
  else if (drawMode === 'trueEnding') drawTrueEnding();
  else drawBoot();
  if (mode === 'paused') drawPauseOverlay();
  // Used to hide this strip for Enraged/Final Convergence (a deliberate
  // "can't see your HP" disorientation gimmick) — ERIF_ENRAGE_BOX (erif.js)
  // now sits high enough on screen that there's always room for this below
  // it, same as every other phase including the Reckoning, so it's no
  // longer hidden anywhere.
  drawControlsLegend(); drawVolumeMeters();
  if (fade > 0) { ctx.fillStyle = '#fff'; ctx.globalAlpha = fade; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

applyDifficultyTier('normal');

let last = performance.now();
function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  update(dt); draw(); pressed = Object.create(null); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
