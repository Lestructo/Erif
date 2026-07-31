'use strict';

// Global difficulty tuning — one place to adjust rather than hand-editing
// every hazard-spawning call site. projectileMult scales hazard travel
// speeds up; telegraphMult scales reaction/decision windows down. Applied
// inside the hazard-spawning and timer-setting functions themselves
// (hazards.js, bosses.js, erif.js), not at their call sites.
// DIFFICULTY itself stays a stable object identity (mutated via
// applyDifficultyTier, never reassigned) so nothing that reads
// DIFFICULTY.xMult ever needs to change.
// Hard still gets the twist/True Final ending too, since that's gated on
// the 'hard' key itself (see updateErifVictory, erif.js), not on any of
// these numbers. Normal: hazards half speed, telegraphs 25% longer than
// baseline. Hard: hazards 25% slower than baseline, full-length telegraphs.
// Same HP either way.
const DIFFICULTY_TIERS = {
  normal: { projectileMult: .5, telegraphMult: 1.25, lieutenantHp: 3 },
  hard:   { projectileMult: .75, telegraphMult: 1, lieutenantHp: 3 },
};
const DIFFICULTY = { projectileMult: 1, telegraphMult: 1 };
let difficultyTier = 'normal';
function applyDifficultyTier(tier) {
  difficultyTier = tier;
  Object.assign(DIFFICULTY, DIFFICULTY_TIERS[tier]);
  LIEUTENANTS.forEach(n => { BOSS[n].hp = DIFFICULTY_TIERS[tier].lieutenantHp; });
}

// ---- Room / door topology ----
const opposite = { n: 's', s: 'n', e: 'w', w: 'e' };

// Distinct from `opposite` above (door edges n/s/e/w) — this maps the
// shield/telegraph side vocabulary (up/down/left/right) used by the spear
// system, the Mask's mirror, and the Last Wager's reads.
const SHIELD_OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const doors = [
  { id: 'hourglassN',   edge: 'n', along: 0.30, gap: 55, room: 'hourglass' },
  { id: 'maskN',        edge: 'n', along: 0.70, gap: 55, room: 'mask' },
  { id: 'executionerE', edge: 'e', along: 0.30, gap: 55, room: 'executioner' },
  { id: 'witnessS',     edge: 's', along: 0.70, gap: 55, room: 'witness' },
  { id: 'archivistS',   edge: 's', along: 0.30, gap: 55, room: 'archivist' },
  { id: 'oracleW',      edge: 'w', along: 0.30, gap: 55, room: 'oracle' },
  { id: 'verdictE',     edge: 'e', along: 0.70, gap: 55, room: 'verdict' },
  { id: 'galeW',        edge: 'w', along: 0.70, gap: 55, room: 'gale' },
];

// returnDoorFor() lives in hub.js — it's exploration logic, not static config.

const rooms = {
  center:      { name: 'THE EMBER HALL', boss: null, hubDoor: null },
  hourglass:   { name: 'THE HOURGLASS',   boss: 'hourglass',   hubDoor: doors[0] },
  mask:        { name: 'THE MASK',        boss: 'mask',        hubDoor: doors[1] },
  executioner: { name: 'THE EXECUTIONER', boss: 'executioner', hubDoor: doors[2] },
  witness:     { name: 'THE WITNESS',     boss: 'witness',     hubDoor: doors[3] },
  archivist:   { name: 'THE ARCHIVIST',   boss: 'archivist',   hubDoor: doors[4] },
  oracle:      { name: 'THE ORACLE',      boss: 'oracle',      hubDoor: doors[5] },
  verdict:     { name: 'THE VERDICT',     boss: 'verdict',     hubDoor: doors[6] },
  gale:        { name: 'THE GALE',        boss: 'gale',        hubDoor: doors[7] },
};

// ---- Boss registry ----
// Lieutenant trials no longer require a hitless clear — surviving with any
// HP left wins (a hitless run still gets called out as "PERFECT"). HP is
// kept low (3) so it's a real, meaningful buffer rather than padding.
const BOSS = {
  // The sand doesn't just run out — it runs at whatever pace the Hourglass
  // decides, alternating slow stretches with sudden rushes (see bosses.js).
  hourglass:   { display: 'THE HOURGLASS',   ward: 'HOURGLASS WARD',   duration: 30, hp: 3, intro: 'The sand does not wait for you to be ready.' },
  mask:        { display: 'THE MASK',        ward: 'MASK WARD',        duration: 30, hp: 3, intro: 'Fire lies about its own shape. Guess which flicker is real.' },
  executioner: { display: 'THE EXECUTIONER', ward: 'EXECUTIONER WARD', duration: 30, hp: 3, intro: "Turn to face the heat. Turning away only lets it catch you." },
  witness:     { display: 'THE WITNESS',     ward: 'WITNESS WARD',     duration: 30, hp: 3, intro: "Three accounts of what happened here. Two of them are lies. Find the one that actually saw it." },
  // duration is a generous safety cap here too, not the real win condition —
  // the Archivist is won by completing ARCHIVIST_WIN_ROUNDS sequences (see
  // bosses.js), specifically so waiting out a clock is never a substitute
  // for actually memorizing the pattern.
  archivist:   { display: 'THE ARCHIVIST',   ward: 'ARCHIVIST WARD',   duration: 90, hp: 3, intro: 'I will show you what the ash remembers, once. Do not make me show you twice.' },
  oracle:      { display: 'THE ORACLE',      ward: 'ORACLE WARD',      duration: 30, hp: 3, intro: 'One plume of smoke tells the truth. The other three are warnings.' },
  // The ring/gap dodge that used to belong to the Hourglass, reskinned — a
  // closing circle of judgment rather than a countdown.
  verdict:     { display: 'THE VERDICT',     ward: 'VERDICT WARD',     duration: 30, hp: 3, intro: "The circle always closes. The only question is where you're standing when it does." },
  gale:        { display: 'THE GALE',        ward: 'GALE WARD',        duration: 30, hp: 3, intro: 'The wind does not ask which way you meant to go.' },
  // duration is a generous safety cap, not a real constraint — Final
  // Convergence's capture-all-8 condition ends the fight well before this in
  // normal play (see erif.js's beginErifVictory()), and on Hard the fight
  // continues into the true final phase afterward, so this stays generous
  // enough to never fire mid-twist (battle-core.js's timeout check also
  // explicitly excludes phase 10 as a second line of defense).
  erif:      { display: 'ERIF', ward: '', duration: 600, hp: 15, intro: 'Every ember you have claimed was mine to begin with. Let us see if you can keep it.' },
};

const LIEUTENANTS = ['hourglass', 'mask', 'executioner', 'witness', 'archivist', 'oracle', 'verdict', 'gale'];

// ---- Dialogue ----
// Plays once, right after the title screen, as an unattributed '???' line
// before Erif's own voice ever takes over (ERIF_DIALOGUE[0] follows
// immediately after) — a small reveal rather than assuming his voice from
// the very first line.
const INTRO_CUTSCENE = [
  'YOU DO NOT REMEMBER AGREEING TO THIS.',
  'BUT SOMETHING PULLED, AND YOUR FLAME LEANED TOWARD IT ANYWAY.',
  'BENEATH EVERY FIRE YOU HAVE EVER KNOWN, ONE EMBER HAS NEVER GONE OUT —',
  'AND IT REMEMBERS EVERY FLAME THAT EVER DARED TO BURN WITHOUT IT.',
  'IT DOES NOT SEND ITS BRANDS TO WATCH. IT SENDS THEM TO KEEP TIME, TO JUDGE, TO DECIDE WHICH WAY YOU ARE ALLOWED TO LEAN.',
  'EVERY DOOR IN THIS HALL IS ONE OF ITS HANDS.',
  'EIGHT BRANDS OF THAT EMBER STAND BETWEEN YOU AND THE SOURCE.',
  'EVERY DOOR STANDS OPEN ALREADY. WALK THROUGH ANY OF THEM.',
];
// Erif is the First Flame — the ember every fire since has been struck from,
// and the one flame that has never once gone out. Not by choice: it does not
// know how to stop burning, and across an age of that it decided every fire
// since is owed back to it. The eight lieutenants aren't separate minds so
// much as eight brands split off from it — what an unyielding flame becomes
// after burning long enough without rest — kept as a court so it never has
// to burn down and meet a challenger itself.
const ERIF_DIALOGUE = {
  0: [
    'WELL. ANOTHER SPARK WANDERS TOO CLOSE TO THE SOURCE.',
    'EIGHT DOORS. EIGHT EMBERS OF ME, WAITING BEHIND THEM.',
    "SURVIVE THEM, AND THEY'LL LEND YOU THEIR WARD. DO IT WITHOUT GUTTERING ONCE, AND I MIGHT ACTUALLY WATCH.",
    'FAIL, AND YOU MAY TRY AGAIN. I HAVE BURNED LONGER THAN YOUR PATIENCE COULD EVER LAST.',
  ],
  1: [
    'ONE WARD. HOW QUAINT.',
    "YOU'VE FELT A SLIVER OF ME AND YOU'RE STILL LIT. DON'T LET THAT GO TO YOUR WICK.",
    'SEVEN EMBERS STILL STAND BETWEEN US.',
  ],
  2: [
    "TWO. I'M STARTING TO REMEMBER THE SHAPE OF YOUR FLAME.",
    'MOST SPARKS GUTTER BY NOW. THE STUBBORN ONES, ANYWAY.',
    'YOU MUST BE BURNING ON SOMETHING ELSE.',
  ],
  3: [
    'THREE WARDS TAKEN. THAT USED TO BE ENOUGH TO IMPRESS ME.',
    'I ADMIT — I DID NOT KINDLE THESE EMBERS TO BE OUTBURNED.',
    "LET'S SEE IF THAT WAS A MISTAKE.",
  ],
  4: [
    'FOUR. HALF OF ME, BOWING TO A CANDLE.',
    'I FEEL IT EVERY TIME YOU SNUFF OUT ANOTHER PIECE OF ME.',
    'FOUR LEFT. DON\'T STOP NOW — I AM ALMOST ENJOYING THIS.',
  ],
  5: [
    'FIVE. THE SEAL ON THIS DOOR IS THINNING TO SMOKE.',
    'THREE EMBERS STILL STAND BETWEEN US.',
    "I WONDER WHICH OF THEM ACTUALLY WORRIES YOU.",
  ],
  6: [
    'SIX WARDS IN YOUR POCKET. ONLY TWO BRANDS OF ME LEFT STANDING.',
    'THE ONES THAT KEEP TIME AND THE ONES THAT KEEP DIRECTION ARE ALWAYS THE LAST TO FALL.',
    "SEE IF THAT HOLDS.",
  ],
  7: [
    'SEVEN. ONE EMBER LEFT UNCLAIMED.',
    'YOU HAVE OUTBURNED EVERY BRAND I OWN BUT THE SOURCE ITSELF.',
    'COME FINISH IT. I WANT TO SEE YOUR FLAME WHEN YOU TRY.',
  ],
  8: [
    'EIGHT. YOU HAVE TAKEN EVERY EMBER OFF MY HEARTH BUT ME.',
    'I SUPPOSE THAT MAKES ME THE ONLY FIRE LEFT WORTH FACING.',
    "COME THEN, LITTLE FLAME. LET'S SEE WHAT YOU'RE REALLY MADE OF.",
  ],
};
const ERIF_RETRY_DIALOGUE = [
  "BACK ALREADY? I HAVEN'T EVEN LET THE ASH SETTLE.",
  "SIT BACK DOWN. WE'LL STRIKE THE FLINT AGAIN.",
];
const ERIF_ENRAGE_DIALOGUE = [
  'YOU KEEP OUTBURNING MY BRANDS. HOW TEDIOUS.',
  'THE HOURGLASS WAS HOW LONG I LET MYSELF LAST. THE EXECUTIONER, WHAT I BRAND INTO WHAT I TOUCH.',
  "THE MASK WAS THE SHAPES I LIE IN. THE WITNESS, EVERY LIE I EVER LET STAND UNCHALLENGED.",
  'THE ARCHIVIST WAS EVERYTHING MY ASH REMEMBERS. THE ORACLE, EVERY OMEN MY SMOKE HAS EVER SPELLED.',
  'THE VERDICT WAS EVERY CIRCLE I EVER CLOSED. THE GALE, EVERY DIRECTION I EVER DENIED YOU.',
  "I SENT THEM SO I WOULDN'T HAVE TO BURN DOWN TO YOUR LEVEL MYSELF. NOW YOU GET ALL OF ME AT ONCE.",
];
const ERIF_FINAL_DIALOGUE = [
  'I HAVE BURNED SINCE BEFORE THERE WAS ANYTHING TO BURN. I FORGOT WHAT BEING MET FEELS LIKE.',
  'YOU MET ALL OF ME. AND YOUR FLAME IS STILL LIT.',
  'I DO NOT GUTTER. I HAVE NEVER ONCE GUTTERED.',
  '...I SUPPOSE THERE IS A FIRST TIME FOR EVERY FIRE.',
  'GO, LITTLE FLAME. THE HEARTH IS YOURS. I HAVE NOTHING LEFT TO BURN.',
];

// Hard-only: plays the instant the first victory dialogue would otherwise
// end the fight — Erif refuses to actually be finished.
const ERIF_TWIST_DIALOGUE = [
  '...NO.',
  'I DO NOT GUTTER. I TOLD YOU THAT. I MEANT IT.',
  'YOU THOUGHT AN UNYIELDING FLAME HAD ONLY ONE EMBER LEFT TO LOSE?',
  'SIT BACK DOWN. THIS IS THE ONLY FIRE THAT EVER MATTERED.',
];
// A plain-language control/mechanic reminder, not Erif's own voice — plays
// right after the twist above and right before the Reckoning itself
// actually starts (see startErifReckoningIntro/beginErifTrueFinal, erif.js).
// Deliberately unambiguous: this is the one fight in the game the player
// can actually deal damage in, and it's easy to get this far and still not
// realize the head itself is never a valid target.
const ERIF_RECKONING_INTRO_DIALOGUE = [
  "ATTACK THE HANDS. ERIF'S HEAD CAN'T BE STRUCK DIRECTLY — ONLY A BROKEN HAND HURTS HIM.",
  'SPACE ATTACKS A HAND WHILE IT GLOWS, RIGHT AFTER IT SLAMS DOWN.',
];
// Plays after The Last Wager (phase 10) is actually won.
const ERIF_TRUE_FINAL_DIALOGUE = [
  '...HUH.',
  'I HAD MORE EMBERS THAN I HAD REASONS LEFT TO KEEP THEM LIT.',
  "YOU DIDN'T JUST OUTBURN ME. YOU LET ME ACTUALLY GO OUT.",
  "GO ON, THEN. I WON'T STRIKE AGAIN. NOT AT YOU.",
];

// ---- Core mutable game state (single declaration site for the whole game) ----
// A factory rather than a bare literal so resetSaveGame() below (and the
// initial `const save =` itself) both build from the exact same fresh shape
// — one source of truth for "what a brand-new save looks like" instead of
// two copies that could drift apart.
function freshSave() {
  return {
    ward: { hourglass: false, mask: false, executioner: false, witness: false, archivist: false, oracle: false, verdict: false, gale: false },
    // Separate from `ward` on purpose: `ward` means "beaten at least once" and
    // still gates the hub portal exactly as before; `perfected` means "beaten
    // hitless" and is what actually closes a door for good. A boss you've
    // beaten but not perfected keeps its door open (see drawDoor/updateExplore
    // in hub.js) so you can walk back in and try again for the upgrade a
    // perfect clear grants.
    perfected: { hourglass: false, mask: false, executioner: false, witness: false, archivist: false, oracle: false, verdict: false, gale: false },
    attempts: { hourglass: 0, mask: 0, executioner: 0, witness: 0, archivist: 0, oracle: 0, verdict: 0, gale: 0 },
    erifDialogueSeen: { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false },
    erifAttempts: 0,
    erifWon: false,
    erifTrueWon: false, // Hard-only: set once The Last Wager (phase 10) is won
    // Perfect-clear upgrades — stack counts are the single source of truth;
    // every actual bonus is derived from these at the point of use (see
    // UPGRADE_CATALOG below), never stored redundantly. hpProgress is separate
    // from upgrades.hp because HP costs 4 perfect clears per stack, not 1 —
    // it's the raw pick count banked toward hp's next stack.
    upgrades: { speed: 0, hp: 0, shield: 0, iframe: 0 },
    hpProgress: 0,
  };
}
const save = freshSave();

// ---- Save persistence — so a refresh (or closed tab) doesn't lose progress.
// `save` is a plain tree of booleans/numbers, so a straight JSON round-trip
// is enough; loadSaveGame() replaces each top-level key wholesale rather
// than deep-merging, which is fine as long as the shape above doesn't
// change between a save and a later load. Called from every point that
// actually mutates `save` (see battle-core.js's finishBattle, upgrades.js's
// confirmUpgradeChoice, erif.js's startErifDialogue/victory functions)
// rather than on a timer, so it never fires more than the state actually
// changes.
const SAVE_KEY = 'erif-unyielding-flame-save';
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} // private browsing / storage blocked — just don't persist
}
function loadSaveGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    Object.assign(save, JSON.parse(raw));
  } catch {} // corrupt/unreadable — start fresh rather than crash
}
loadSaveGame();

// Wipes all progress (wards, perfected doors, upgrades, Erif's dialogue/win
// state) back to a brand-new save — see the title screen's RESET DATA menu
// item (title.js), which gates this behind an explicit two-step confirm
// since it can't be undone. Mutates `save` in place via Object.assign rather
// than reassigning the binding, so every file holding the shared `save`
// reference keeps seeing the same (now-reset) object.
function resetSaveGame() {
  Object.assign(save, freshSave());
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// One entry per upgrade type — the choice screen (js/hub.js) and the actual
// bonus-application sites (js/hazards.js, js/battle-core.js, js/bosses.js)
// both read from this rather than hardcoding the per-stack numbers in more
// than one place. `perStack`/`cap` are the tunable knobs; `costPerStack` is
// 4 for hp (see hpProgress) and 1 for everything else.
const UPGRADE_CATALOG = {
  speed:  { name: 'MOVE SPEED',         perStack: .05,  cap: 3, costPerStack: 1, unit: '%',  desc: 'Faster in every fight.' },
  shield: { name: 'SHIELD FORGIVENESS', perStack: 5,    cap: 3, costPerStack: 1, unit: 'px', desc: 'Widens the angle a shield still blocks, and catches close misses just outside it.' },
  iframe: { name: 'INVULNERABILITY',    perStack: .15,  cap: 3, costPerStack: 1, unit: 's',  desc: 'Longer invulnerability after taking a hit.' },
  hp:     { name: 'MAX HP',             perStack: 3,   cap: 1, costPerStack: 4, unit: '',   desc: 'More health to survive, everywhere — costs 4 perfect clears.' },
};

const player = { x: W / 2, y: H / 2 + 125, r: 8, speed: 220 };
let room = 'center';
let mode = 'title'; // title, explore, dialogue, intro, battle, result, upgradeChoice, erifVictory, erifTwist, erifTrueVictory, ending, trueEnding
let fade = 0;
let message = '';
let messageSub = '';
let messageTimer = 0;
let battle = null;
let dialogue = null;

function wardCount() { return Object.values(save.ward).filter(Boolean).length; }
function allWards() { return wardCount() === LIEUTENANTS.length; }
