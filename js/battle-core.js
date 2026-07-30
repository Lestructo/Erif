'use strict';

// makeBattle/beginBattle/hurt/finishBattle/clearHazards, generalized across
// the 8 mini-bosses and Erif.

function makeBattle(type) {
  // BOSS[type].hp is the *player's* HP for this fight (3 for every
  // lieutenant, 16 for Erif's own fight) — Erif has no depletable boss-health
  // bar of his own, so the Max HP upgrade raising this only ever makes the
  // player tankier, in every fight including Erif's, never Erif himself.
  const hp = BOSS[type].hp + (save.upgrades.hp || 0) * UPGRADE_CATALOG.hp.perStack;
  return {
    type,
    t: 0,
    duration: BOSS[type].duration,
    hp,
    maxHp: hp,
    hurtTimer: 0,
    tookDamage: false,
    soul: { x: W / 2, y: 384, vx: 0, vy: 0, r: 7, onGround: false },
    box: { x: 230, y: 249, w: 500, h: 270 },
    // hazard families — every family exists on every battle object so
    // clearHazards()/rendering never has to special-case which boss it is
    rings: [],
    spears: [],
    telegraphs: [],
    shapes: [],
    hands: [],
    bullets: [],
    lasers: [],
    sigils: [],
    shield: 'up',
    // Hourglass (ring/gap)
    ringGapA: null,
    ringArcDirection: choose([-1, 1]),
    ringArcMode: false,
    ringSwitchTimer: 0,
    // Executioner / Mask (spear + shield)
    lastSpearSide: null,
    needleTimer: .55,
    specialTimer: 2.6, // first "big" pattern is delayed so the player learns the basics first
    lastSpearSpecialDense: false, // see triggerSpearSpecial, bosses.js — blocks two dense/"full" patterns landing back-to-back
    // Witness (shape matching)
    shapeZones: [],
    shapeCue: null,
    shapeState: '',
    shapeTimer: 0,
    seekMax: 0,
    judgmentMax: 0,
    slamTargets: null,
    slamImpacted: false,
    // Erif's Reprise (see updateRepriseWitness, erif.js) — passes after 2
    // full shape-pattern cycles regardless of outcome, independent of the
    // standalone trial (which has no win-condition state of its own to
    // collide with anyway).
    repriseWitnessRounds: 0,
    repriseWitnessDone: false,
    // Oracle (quiz + lane lasers)
    q: null,
    qTimer: 0,
    qMax: 0,
    qRound: 0,
    // See oracleOptionCount, hazards.js — non-null pins the next generated
    // question's answer count instead of deriving it from qRound.
    qOptionCountOverride: null,
    answerSlots: [],
    lastQuestionText: '',
    // Erif's Reprise (see updateRepriseOracle, erif.js) — its own fixed
    // 4-question count, independent of the standalone trial's flat duration.
    repriseOracleRounds: 0,
    repriseOracleDone: false,
    // Archivist (sigil memory sequence) — reuses the sigils[] field above
    sigilPulse: null,
    echoSequence: [],
    echoStep: 0,
    echoPhase: 'reveal',
    echoRevealTimer: 0,
    echoRevealIndex: 0,
    echoTouchHold: 0,
    echoAwaitingExit: false,
    echoResolveTimer: 0,
    // Per-round safety cap (see MEMORY_MATCH_ROUND_TIME, bosses.js) — counts
    // down across reveal+input for every memory-match round everywhere
    // (standalone Archivist, Reprise, True Final, and Enraged's own memory
    // segments), set fresh each round by startEchoRound.
    echoRoundTimer: 0,
    echoRound: 1,
    echoFail: false,
    echoSuccesses: 0,
    // Erif's Reprise (see updateArchivistQuickMatch, erif.js) — its own
    // quick-match gate (up to 4 rounds, passes at 2 solved), independent of
    // echoRound/echoSuccesses above, which stay owned by the standalone
    // Archivist trial.
    repriseSegElapsed: 0,
    repriseArchivistRound: 0,
    repriseArchivistSuccesses: 0,
    repriseArchivistDone: false,
    echoBooks: [],
    echoBookTimer: 1.3,
    echoBookTrail: [],
    // Weaving books (see spawnWeavingBook, bosses.js) — a wavier, faster
    // cousin of the regular tumbling book that drops a trail of small
    // square hazards behind it. Own timer/arrays, separate from echoBooks
    // above so the two kinds can coexist without stepping on each other.
    weavingBooks: [],
    weavingBookTimer: 5,
    trailSquares: [],
    // Shared hit/block particle burst — see spawnSparks/updateSparks in hazards.js
    sparks: [],
    // Hit feedback for ordinary gameplay damage (see hurt() below) — a very
    // short screen-shake + ember edge-flare, read by main.js's draw() and
    // render.js's drawBattle() respectively, decayed here in updateBattle.
    // Deliberately much smaller/shorter than the scripted victory-screen
    // shakes (render.js) so it reads as a flinch, not a cutscene beat.
    hitShakeT: 0,
    hitFlashT: 0,
    // Low-rate ambient ember spawner for the arena floor (see
    // spawnEmber/updateEmbers, render.js) — same shared particle layer the
    // title screen uses.
    emberSpawnTimer: 0,
    // Mask (mirrored deception)
    maskMirrored: false,
    maskMirrorTimer: 0,
    maskTellPhase: 0,
    maskShards: [],
    maskShardTimer: 2.0, // delayed first shard, same "learn the basics first" convention as specialTimer
    // Hourglass (time slow/fast phases — see bosses.js)
    sandPhase: null,
    sandTimer: 0,
    sandMax: 0,
    timeScale: 1,
    sandGrains: [],
    sandGrainTimer: 1.2,
    hourglassOrbs: [],
    // Was 2.5 — the standalone trial had plenty of runway for that first
    // long wait, but Erif's Reprise segment is much shorter and was ending
    // before the first orb ever had a chance to spawn.
    hourglassOrbTimer: .9,
    // Erif's Reprise (see updateRepriseHourglass, erif.js) — its own 4-cycle
    // gate, independent of the standalone trial's flat duration.
    repriseHourglassCycles: 0,
    repriseHourglassDone: false,
    // Gale (wind gusts + control inversion — see bosses.js). controlsInverted
    // is read directly by moveSoulFree/moveSoulWithShield in hazards.js.
    galeWindDir: null,
    galeGustPhase: null,
    galeGustTimer: 0,
    galeGustMax: 0,
    galeGustCooldown: 0,
    controlsInverted: false,
    windVX: 0,
    windVY: 0,
    // Enraged and Final Convergence each get at most one wind gust ever
    // (see updateOneShotGaleGust, erif.js) — these track whether that single
    // gust has already happened, and how long until it triggers if not.
    // Lifetime flags, same convention as enrageDialogueShown/erifHandsStarted
    // — deliberately not reset by clearHazards, since each only ever fires
    // once for the rest of the fight.
    enrageGaleGustUsed: false,
    enrageGaleGustTimer: null,
    finalGaleGustUsed: false,
    finalGaleGustTimer: null,
    galeFlags: [],
    galeFlagTimer: 1.5,
    windLines: [],
    windRowTimer: 2.2,
    // Erif's Convergence / Enraged / Final Convergence (phases 7-9)
    phaseStartT: 0,
    convergenceOrbit: 0,
    convergenceOrbitDir: choose([-1, 1]),
    convergenceCue: null,
    convergenceCueTimer: 0,
    convergenceCueMax: 0,
    convergenceCueWait: .5,
    convergenceTouchHold: 0,
    convergenceDeck: [],
    // Convergence (the first one, before Enraged) now only requires filling
    // each family's circle once — see updateConvergence, erif.js. Only ever
    // used/set during that one phase, so (like finalCaptured below) this
    // doesn't need resetting anywhere else; makeBattle's fresh values here
    // are already correct going in.
    convergenceCaptured: { hourglass: false, mask: false, executioner: false, witness: false, archivist: false, oracle: false, verdict: false, gale: false },
    convergenceCaptureCount: 0,
    marks: [],
    blasts: [],
    aimedBullets: [],
    aimedBulletTimer: .5,
    inkTimer: 0,
    inkSpawn: 0,
    enraged: false,
    enrageDialogueShown: false,
    enrageInitialized: false,
    enrageRingTimer: 0,
    enrageVolleyTimer: 0,
    enrageShardTimer: 0,
    enrageQuestionTimer: 0,
    // Index into ERIF_ENRAGE_MINIGAME_PLAN (erif.js) and how many rounds of
    // the current segment's type have been resolved so far — see
    // updateEnraged's math/memory dispatch.
    enrageSegmentIndex: 0,
    enrageSegmentProgress: 0,
    // The Enraged-entrance box-widening animation (see beginErifEnraged in
    // erif.js) — boxGrowFrom/To are plain {x,y,w,h} snapshots, not read
    // anywhere outside that one animation.
    boxGrowFrom: null,
    boxGrowTo: null,
    boxGrowT: 0,
    finalConvergence: false,
    finalCaptured: { hourglass: false, mask: false, executioner: false, witness: false, archivist: false, oracle: false, verdict: false, gale: false },
    finalCaptureCount: 0,
    finalTransitionFlash: 0,
    // Counts down 1s at a time — see updateFinalConvergence, erif.js, which
    // shaves 1% off the box's width (both sides) and height (bottom edge
    // only, top stays put) each time it fires, closing the arena in as the
    // fight drags on.
    finalShrinkTimer: 1,
    // Verdict's Final Convergence cue — a fresh rotating ring spawned every
    // ~1.2s for as long as verdict is the active cue (see
    // updateFinalConvergence/spawnConvergenceCueHazard, erif.js).
    finalVerdictRingTimer: 0,
    finalVerdictRingA: 0,
    erifVictoryStarted: false,
    victoryT: 0,
    victoryDialogueIndex: 0,
    victoryRevealCount: 0,
    // Hard-only: "The Reckoning" — a two-hands Kirby-style boss fight (see
    // beginErifTrueFinal/updateErifHandsFinale, erif.js). None of these are
    // touched by clearHazards() — same lifetime-flag convention as the
    // fields they replaced. Per-hand shape (wander/chase/slam AI, fingers,
    // travel state) is fully described in makeErifHand, erif.js.
    erifHandsStarted: false,
    erifHands: [], // 2 entities, each running its own wander/chase/slam/retreat/recharge cycle fully independently
    erifWardPool: [], // shuffled remaining ward names, popped one at a time as a hand finishes recharging
    erifWardsDestroyed: 0, // 0-8, just a display counter now — increments 1:1 with erifHeadHp decrementing
    erifHeadHp: 0, erifHeadMaxHp: 0, // starts equal to the ward count — the 8th hand break ends the fight
    erifHeadHitsLanded: 0, // drives the climbing-pitch head-hit tone
    erifHeadX: 0, erifHeadY: 0, // the head's own live, loosely hand-following position
    erifHeadHitFlashT: 0, // brief visual pulse the instant a hand break docks a point off head HP (the only head feedback there is — it's automatic now, not player-targeted)
    erifSlamLockoutT: 0, // shared between both hands — blocks either from starting a new chase-and-slam until it clears
    erifHandsLaughedAtFlurry: false,
    erifBounceBalls: [], // universal wall-bouncing projectiles, any finger can fire one
    erifEyeBalls: [], // permanent wall-bouncing "eyes" — one popped out per head-HP loss, never break, up to 8 by fight's end
    erifReckoningFadeT: 0, // 0-1 white-out progress for the final 5s of the hard time limit
    erifFightFadeT: 0, // same white-out progress, but for the whole fight's own hard 145s cap (see ERIF_FIGHT_TIME_LIMIT, erif.js) — every phase before the Reckoning
    punchFlashT: 0, punchDir: 0, // the boxing-glove shield-punch visual
    trueVictoryStarted: false,
    trueVictoryT: 0,
    trueVictoryDialogueIndex: 0,
    spawn: 0,
    phase: 0,
    intro: BOSS[type].intro || '',
    clearText: '',
    won: false, // set by finishBattle — whether THIS attempt actually won, see closeResult
  };
}

function beginBattle() {
  mode = 'battle';
  battle.t = 0; battle.spawn = 0; battle.phase = 0;
  battle.soul.x = W / 2; battle.soul.y = 384;
  battle.soul.vx = 0; battle.soul.vy = 0;
  // Moved here from startBoss() — the boss's theme used to start playing the
  // instant the intro ("X notices you") screen appeared, before the player
  // had actually pressed Space to begin the fight.
  setMusic(battle.type);
}

function circleHit(o, r = 6) { return dist(battle.soul.x, battle.soul.y, o.x, o.y) < battle.soul.r + r; }
// Convergence-era hazards use the heart's visible center as the vulnerable
// core instead of its full bounding radius — keeps dense simultaneous
// patterns fair instead of feeling bigger than their artwork.
function convergenceCircleHit(o, r = 6) { return dist(battle.soul.x, battle.soul.y, o.x, o.y) < 5.25 + r * .66; }
function rectHit(r) {
  const s = battle.soul;
  return s.x + s.r > r.x && s.x - s.r < r.x + r.w && s.y + s.r > r.y && s.y - s.r < r.y + r.h;
}

function hurt(n = 1) {
  if (godMode) return; // debug invulnerability — see title.js's title-menu toggle
  if (battle.hurtTimer > 0) return;
  battle.hp -= n;
  battle.hurtTimer = .75 + UPGRADE_CATALOG.iframe.perStack * (save.upgrades.iframe || 0);
  battle.tookDamage = true;
  tone(70, .12, 'square', .08);
  // White, not ember — this is wax breaking off the candle, not fire.
  spawnSparks(battle.soul.x, battle.soul.y, 8, { color: '#fff', speed: [90, 180], life: .4 });
  // A small burst of embers sputtering directly off the flame, plus the
  // brief shake/flare read by main.js's draw()/render.js's drawBattle().
  for (let i = 0; i < 4; i++) spawnEmber(battle.soul.x + rand(-6, 6), battle.soul.y + rand(-4, 4), { speed: [30, 70], life: [.4, .8] });
  battle.hitShakeT = .12; battle.hitFlashT = .28;
  if (battle.hp <= 0) { battle.hp = 0; finishBattle(false); }
}

function clearHazards() {
  battle.rings = []; battle.spears = []; battle.telegraphs = []; battle.shapes = []; battle.hands = [];
  battle.bullets = []; battle.lasers = []; battle.sigils = [];
  battle.ringGapA = null; battle.ringArcMode = false; battle.ringArcDirection = choose([-1, 1]); battle.ringSwitchTimer = 0;
  battle.lastSpearSide = null; battle.needleTimer = .55; battle.specialTimer = 2.6; battle.lastSpearSpecialDense = false;
  battle.shapeZones = []; battle.shapeCue = null; battle.shapeState = ''; battle.shapeTimer = 0;
  battle.seekMax = 0; battle.judgmentMax = 0; battle.slamTargets = null; battle.slamImpacted = false;
  battle.repriseWitnessRounds = 0; battle.repriseWitnessDone = false;
  battle.q = null; battle.qTimer = 0; battle.qOptionCountOverride = null; battle.answerSlots = []; battle.lastQuestionText = '';
  battle.repriseOracleRounds = 0; battle.repriseOracleDone = false;
  battle.sigilPulse = null; battle.echoSequence = []; battle.echoStep = 0; battle.echoPhase = 'reveal';
  battle.echoRevealTimer = 0; battle.echoRevealIndex = 0; battle.echoTouchHold = 0;
  battle.echoAwaitingExit = false;
  battle.echoResolveTimer = 0; battle.echoFail = false; battle.echoRoundTimer = 0;
  battle.repriseArchivistRound = 0; battle.repriseArchivistSuccesses = 0; battle.repriseArchivistDone = false;
  battle.echoBooks = []; battle.echoBookTimer = 1.3; battle.echoBookTrail = [];
  battle.weavingBooks = []; battle.weavingBookTimer = 5; battle.trailSquares = [];
  battle.sparks = [];
  battle.maskMirrored = false; battle.maskMirrorTimer = 0; battle.maskTellPhase = 0;
  battle.maskShards = []; battle.maskShardTimer = 2.0;
  battle.sandPhase = null; battle.sandTimer = 0; battle.sandMax = 0; battle.timeScale = 1;
  battle.sandGrains = []; battle.sandGrainTimer = 1.2;
  battle.hourglassOrbs = []; battle.hourglassOrbTimer = .9;
  battle.repriseHourglassCycles = 0; battle.repriseHourglassDone = false;
  battle.galeWindDir = null; battle.galeGustPhase = null; battle.galeGustTimer = 0; battle.galeGustMax = 0;
  battle.galeGustCooldown = 0; battle.controlsInverted = false; battle.windVX = 0; battle.windVY = 0;
  battle.galeFlags = []; battle.galeFlagTimer = 1.5;
  battle.windLines = []; battle.windRowTimer = 2.2;
  // Convergence/Enraged/Final Convergence hazards and per-cue timers reset on
  // every phase boundary; the lifetime flags (enraged, finalConvergence,
  // finalCaptured, erifVictoryStarted) do NOT reset here — those track
  // permanent progress across the rest of the fight, not per-phase hazards.
  battle.convergenceCue = null; battle.convergenceCueTimer = 0; battle.convergenceCueWait = .5; battle.convergenceTouchHold = 0;
  battle.convergenceDeck = []; battle.marks = []; battle.blasts = []; battle.aimedBullets = []; battle.aimedBulletTimer = .5;
  battle.inkTimer = 0; battle.inkSpawn = 0;
  battle.erifBounceBalls = [];
  battle.erifEyeBalls = [];
  battle.enrageRingTimer = 0; battle.enrageVolleyTimer = 0; battle.enrageShardTimer = 0; battle.enrageQuestionTimer = 0;
  battle.enrageSegmentIndex = 0; battle.enrageSegmentProgress = 0;
  battle.boxGrowFrom = null; battle.boxGrowTo = null; battle.boxGrowT = 0;
  battle.finalTransitionFlash = 0; battle.finalShrinkTimer = 1;
  // erifHandsStarted/erifHands/erifWardPool/erifWardsDestroyed/erifHeadHp/
  // trueVictoryStarted are lifetime/progress flags (same convention as
  // finalCaptured above) and stay untouched here — they're managed directly
  // by beginErifTrueFinal/updateErifHandsFinale instead.
}

// A lighter version of clearHazards() for Erif's Reprise segment-to-segment
// transitions specifically — resets every mechanic's STATE (timers,
// sub-phase flags, cadence trackers) exactly like clearHazards() does, but
// leaves in-flight hazard ENTITIES (spears, orbs, shapes, flags, books...)
// alone instead of instantly despawning them, so a projectile that was mid-
// flight when one lieutenant's segment ended keeps existing into the next
// one rather than just vanishing. Convergence's own per-cue despawn (see
// clearConvergenceCueHazards) is intentionally untouched by this — that one
// still fully clears the captured family's hazards, same as before.
function clearHazardsKeepProjectiles() {
  // Sigils aren't a projectile with a path to finish — they're a static
  // landmark that only ever means something inside the Archivist's own
  // segment — so unlike everything else here, these do get cleared, or
  // they'd just sit there as inert clutter for the rest of the Reprise.
  battle.sigils = [];
  battle.ringGapA = null; battle.ringArcMode = false; battle.ringArcDirection = choose([-1, 1]); battle.ringSwitchTimer = 0;
  battle.lastSpearSide = null; battle.needleTimer = .55; battle.specialTimer = 2.6; battle.lastSpearSpecialDense = false;
  battle.shapeZones = []; battle.shapeCue = null; battle.shapeState = ''; battle.shapeTimer = 0;
  battle.seekMax = 0; battle.judgmentMax = 0; battle.slamTargets = null; battle.slamImpacted = false;
  battle.repriseWitnessRounds = 0; battle.repriseWitnessDone = false;
  battle.q = null; battle.qTimer = 0; battle.qOptionCountOverride = null; battle.answerSlots = []; battle.lastQuestionText = '';
  battle.repriseOracleRounds = 0; battle.repriseOracleDone = false;
  battle.sigilPulse = null; battle.echoSequence = []; battle.echoStep = 0; battle.echoPhase = 'reveal';
  battle.echoRevealTimer = 0; battle.echoRevealIndex = 0; battle.echoTouchHold = 0;
  battle.echoAwaitingExit = false;
  battle.echoResolveTimer = 0; battle.echoFail = false; battle.echoRoundTimer = 0;
  battle.repriseArchivistRound = 0; battle.repriseArchivistSuccesses = 0; battle.repriseArchivistDone = false;
  battle.echoBookTimer = 1.3; battle.weavingBookTimer = 5;
  battle.maskMirrored = false; battle.maskMirrorTimer = 0; battle.maskTellPhase = 0;
  battle.maskShardTimer = 2.0;
  battle.sandPhase = null; battle.sandTimer = 0; battle.sandMax = 0; battle.timeScale = 1;
  battle.sandGrainTimer = 1.2;
  battle.hourglassOrbTimer = .9;
  battle.repriseHourglassCycles = 0; battle.repriseHourglassDone = false;
  battle.galeWindDir = null; battle.galeGustPhase = null; battle.galeGustTimer = 0; battle.galeGustMax = 0;
  battle.galeGustCooldown = 0; battle.controlsInverted = false; battle.windVX = 0; battle.windVY = 0;
  battle.galeFlagTimer = 1.5;
  battle.windRowTimer = 2.2;
}

function startBoss(type) {
  if (type !== 'erif') save.attempts[type] = (save.attempts[type] || 0) + 1;
  mode = 'intro';
  battle = makeBattle(type);
  message = `${BOSS[type].display} notices you.`;
  messageSub = battle.intro;
  tone(110, .35, 'sawtooth', .05);
  // Erif's theme is a real embedded MP3, not a procedural track — kicking
  // off its fetch/decode here (while the player is still reading the intro
  // screen, before Space actually starts the fight) instead of waiting for
  // beginBattle's setMusic('erif') call is what was causing the ~1s gap
  // before the music actually started once the fight began.
  if (type === 'erif') { try { ensureErifTheme(); ensureTrueTheme(); } catch {} }
}

// R on a post-loss result screen instantly re-enters the fight, skipping
// the return-to-hub-and-walk-back that Space/closeResult() normally
// requires. Space still leads into Erif's own narrative retry dialogue as
// before (untouched) — this is just a faster opt-in alternative for anyone
// who'd rather skip straight back in, most valuable right after Skip to
// Erif (title.js), where there's no hub walk to return through anyway.
function restartBoss() {
  if (!battle) return;
  const type = battle.type;
  stopMusic();
  if (type === 'erif') save.erifAttempts++; // keeps erifAttempts consistent with the normal retry-dialogue path
  startBoss(type);
}

function finishBattle(survived, manual = false) {
  if (mode !== 'battle') return;
  mode = 'result';
  stopMusic();
  const type = battle.type;
  // Tracks whether THIS attempt actually won, separate from save.erifWon —
  // that flag persists forever once true, so closeResult() checking it
  // directly meant restarting (or losing) a later Erif attempt and pressing
  // Space on the result screen incorrectly jumped straight to the ending,
  // as if the fight you just restarted/lost had been a win.
  battle.won = survived;
  if (!survived) {
    battle.clearText = manual ? 'THE TRIAL WAS RESTARTED.' : 'YOUR FLAME WAS SNUFFED OUT.';
    messageSub = 'Press Space to return.';
    tone(55, .35, 'square', .05);
  } else if (type === 'erif') {
    // Erif's fight has no hitless requirement — survive and complete the
    // objectives. The real win path (milestone 9) calls beginErifVictory()
    // before this duration timeout is ever reached; this branch is the
    // fallback so an unfinished fight still resolves safely, not a crash.
    save.erifWon = true;
    battle.clearText = 'ERIF GUTTERS OUT.';
    messageSub = 'Press Space.';
    tone(440, .5, 'sine', .04);
  } else {
    // Surviving claims the Ward — HP is the real buffer now, not a hitless
    // gate. A hitless run still gets called out as a perfect clear.
    save.ward[type] = true;
    if (!battle.tookDamage) {
      save.perfected[type] = true;
      battle.clearText = `PERFECT. ${BOSS[type].ward} CLAIMED.`;
      tone(660, .5, 'sine', .05);
    } else {
      battle.clearText = `${BOSS[type].display} YIELDS. ${BOSS[type].ward} CLAIMED.`;
      tone(440, .4, 'sine', .045);
    }
    messageSub = 'Press Space to return.';
  }
  saveGame();
}

// Won — the room has nothing left in it (its door closes behind this, see
// drawExplore/updateExplore in hub.js), so return straight to the hub
// instead of leaving the player standing in an empty boss room. Needs
// returnDoorFor(hubDoor) here — the exact same call updateExplore's normal
// return-door crossing already makes — so the player lands next to the hub
// door they'd have walked out through, not on the opposite wall of the hub.
// Shared by closeResult()'s normal win path and confirmUpgradeChoice()
// (js/upgrades.js), which defers this by one screen rather than duplicating it.
function returnToHubAfterWin(type) {
  room = 'center';
  resetPlayerForRoom(returnDoorFor(rooms[type].hubDoor));
  if (typeof onEnterHub === 'function') onEnterHub();
}

function closeResult() {
  if (!battle) return;
  const type = battle.type;
  if (type === 'erif' && battle.won) { mode = 'ending'; messageTimer = 0; battle = null; return; }
  // A perfect (hitless) lieutenant clear offers an upgrade choice before the
  // hub-return, as long as at least one upgrade type is still under its cap
  // (see startUpgradeChoice, js/upgrades.js) — otherwise this falls through
  // to the normal path below, completely unchanged.
  if (type !== 'erif' && save.ward[type] && !battle.tookDamage &&
      typeof availableUpgradeTypes === 'function' && availableUpgradeTypes().length > 0) {
    startUpgradeChoice(type);
    return;
  }
  mode = 'explore';
  if (type === 'erif') { room = 'center'; resetPlayerForRoom(null); }
  else if (save.ward[type]) {
    returnToHubAfterWin(type);
  } else {
    // Lost — still nothing to do in the room itself, but the trial can be
    // retried, so this one still drops the player back at its own door
    // (matching how enterRoom uses it) — not returnDoorFor(hubDoor), which
    // would double-invert and place the player on the wrong side of the
    // room, away from the actual door.
    room = type;
    resetPlayerForRoom(rooms[room].hubDoor);
  }
  battle = null; fade = 1;
}

function updateBattle(dt) {
  if (!battle) return;
  battle.t += dt;
  battle.hurtTimer = Math.max(0, battle.hurtTimer - dt);
  battle.hitShakeT = Math.max(0, battle.hitShakeT - dt);
  battle.hitFlashT = Math.max(0, battle.hitFlashT - dt);
  // The candle's collision radius shrinks with its remaining wax (HP) — a
  // guttering candle is a smaller target, mirroring the shrinking visual.
  battle.soul.r = lerp(4.5, 7, clamp(battle.hp / battle.maxHp, 0, 1));
  updateSparks(dt);
  // A low-rate ambient ember drifting up off the arena floor — same shared
  // particle layer the title screen uses (see spawnEmber/updateEmbers,
  // render.js), just seeded from the current box instead.
  battle.emberSpawnTimer -= dt;
  if (battle.emberSpawnTimer <= 0) {
    spawnEmber(rand(battle.box.x + 10, battle.box.x + battle.box.w - 10), battle.box.y + battle.box.h - rand(0, 20), { speed: [12, 24], life: [1.3, 2.4] });
    battle.emberSpawnTimer = rand(.5, .9);
  }
  updateEmbers(dt);
  if (battle.type === 'hourglass') updateHourglass(dt);
  else if (battle.type === 'executioner') updateExecutioner(dt);
  else if (battle.type === 'witness') updateWitness(dt);
  else if (battle.type === 'oracle') updateOracle(dt);
  else if (battle.type === 'archivist') updateArchivist(dt);
  else if (battle.type === 'mask') updateMask(dt);
  else if (battle.type === 'verdict') updateVerdict(dt);
  else if (battle.type === 'gale') updateGale(dt);
  else if (battle.type === 'erif') updateErif(dt);

  // Phase 10 (Hard's true final phase) is won/lost through its own hp pool,
  // never this generic duration timeout — excluded explicitly so a long
  // twist-phase attempt can never fall through to the ordinary victory text.
  // Erif's own fight is excluded too, for a different reason: it now has its
  // own real hard 145s cap (ERIF_FIGHT_TIME_LIMIT, updateErif in erif.js)
  // that ends in an actual loss, replacing the old soft duration-elapsed
  // auto-win fallback this line still is for every lieutenant.
  if (mode === 'battle' && battle.t >= battle.duration && battle.phase !== PHASE_LAST_WAGER && battle.type !== 'erif') finishBattle(true);
  if (tap('r')) finishBattle(false, true);
}
