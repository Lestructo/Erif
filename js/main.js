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
    // set in hurt(), battle-core.js) — wraps only the arena draw call so the
    // controls legend/volume meters/pause overlay drawn below stay put.
    if (battle && battle.hitShakeT > 0) {
      const p = battle.hitShakeT / .12;
      ctx.save();
      ctx.translate((Math.random() * 2 - 1) * 4 * p, (Math.random() * 2 - 1) * 4 * p);
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
  // Once Erif's box has grown for the "can't see your HP" gimmick (Enraged
  // and beyond), the always-on legend/meters strip at the bottom is hidden
  // too — leaving it up would give away a fixed reference point right where
  // the arena floor now extends to, defeating the disorientation.
  const hideBottomUI = drawMode === 'battle' && battle && battle.type === 'erif' && battle.phase >= PHASE_ENRAGED;
  if (!hideBottomUI) { drawControlsLegend(); drawVolumeMeters(); }
  if (fade > 0) { ctx.fillStyle = '#fff'; ctx.globalAlpha = fade; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

applyDifficultyTier('normal');

let last = performance.now();
function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  update(dt); draw(); pressed = Object.create(null); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
