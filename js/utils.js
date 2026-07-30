'use strict';

// Canvas bootstrap — shared by every later file via top-level scope.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
// Logical game-coordinate space — every position in this codebase assumes a
// 960x640 canvas. The CSS sizes the canvas element fluidly to fill the
// viewport (see style.css); this keeps the *drawing* buffer matched to the
// element's actual on-screen size and device pixel ratio for crisp
// rendering at any size, via a transform that maps 960x640 logical units
// onto however many physical pixels the canvas currently occupies.
const W = 960, H = 640;
function fitCanvasToDisplay() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.max(1, Math.round(rect.width * dpr));
  const pixelH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  ctx.setTransform(pixelW / W, 0, 0, pixelH / H, 0, 0);
  ctx.imageSmoothingEnabled = true;
}
fitCanvasToDisplay();
addEventListener('resize', fitCanvasToDisplay);

// The one sparingly-used accent color (danger cues, Erif, the Wager, the
// Mask's "lie" tell) — mirrors css/style.css's --ember variable.
const EMBER = '#ff3b20';

// Input state.
const keys = Object.create(null);
let pressed = Object.create(null);
// Separate output levels (0-1) for music vs. one-shot sound effects, each
// applied as its own gain multiplier in audio.js — see tone()/kick()/
// noiseHit()'s `category` argument. Adjustable via the two always-on meters
// in the corner (see drawVolumeMeters in render.js); both default to half
// volume rather than a blunt mute toggle.
let musicVolume = .5, sfxVolume = .5;

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!keys[k]) pressed[k] = true;
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// The volume meter is the only clickable thing in the game — everything
// else is keyboard-only — so this converts a raw page click straight into
// logical 960x640 game coordinates and hands it to whichever click target
// wants it. handleCanvasClick is defined later (render.js) but that's fine:
// this listener only ever fires from a real click, always after every
// script has finished loading, same as every other cross-file forward
// reference in this codebase.
addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  const my = (e.clientY - rect.top) * (H / rect.height);
  if (typeof handleCanvasClick === 'function') handleCanvasClick(mx, my);
});

function tap(k) { return !!pressed[k]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function rand(a, b) { return a + Math.random() * (b - a); }
function choose(a) { return a[(Math.random() * a.length) | 0]; }
function shuffleArray(a) {
  const copy = [...a];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
