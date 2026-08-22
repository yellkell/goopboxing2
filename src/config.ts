/**
 * SLUGFEST — the whole game's tuning sheet.
 *
 * One law carried over from the lineage (GOOP → FIRE FIGHT → RAVE RAID):
 * every number a designer will ever want to touch lives HERE or in
 * goop/goopConfig.ts (the creature's own body constants). Systems read
 * constants; they never invent them.
 */

export const GAME_TITLE = 'SLUGFEST';

/* ─────────────────────────────── THE BOUT ────────────────────────────────
 * Arcade boxing, not a sim: short rounds, honest health, one KO ends it.
 */
export const FIGHT = {
  /** Rounds per bout (clock-decided rounds score on damage dealt). */
  rounds: 3,
  /** Round length in seconds. 90 s in VR is a real workout. */
  roundSeconds: 90,
  /** Corner rest between rounds — both goops slump into globs and breathe. */
  restSeconds: 12,
  /** Health per fighter. Persists through a bout; see recovery below. */
  health: 100,
  /** Health regained in the corner between rounds (capped at full). */
  restRecovery: 35,
  /** The ten count. A fighter KO'd (health 0) is a puddle; at 10 it's over.
   *  (Nobody gets up in v1 — the count is drama, not a saving throw.) */
  koCount: 10,
  /** Seconds per count. */
  koCountSeconds: 1.0,
  /** Countdown before each round (3‥1 then the bell). */
  countInSeconds: 3,
  /** Post-result linger before the podium card offers a rematch. */
  resultLingerSeconds: 4,
};

/* ─────────────────────────────── THE PUNCH ───────────────────────────────
 * Player-thrown punches. The creature-side reception constants (dents,
 * lumps, ripples) live in goop/goopConfig.ts — this block is the JUDGE:
 * what a swing must be to score, and what it's worth when it does.
 *
 * The anti-flail stack, in order:
 *   1. speed gate  — below hitSpeed it's a poke (shove, no score);
 *   2. cooldown    — a hand can't score twice inside `cooldown`;
 *   3. the re-arm  — after a scoring hit, that hand must RETRACT clear of
 *                    the surface (rearmDist) before it may score again, so
 *                    resting a fist inside the other goop ticks nothing.
 *
 * TUNED FOR A LONG FIGHT: a bout should be won over dozens of exchanges,
 * not three lucky swings. A max-strength head shot takes ~7; a typical
 * clean body hit ~3–4; a blocked hit is chip damage. 100 health ≈ 15–30
 * connections depending on quality — rounds usually go to the cards.
 */
export const PUNCH = {
  /** m/s at contact for a scoring hit (measured at the GEL fist — the
   *  extended one). Below it: a poke (still wobbles). */
  hitSpeed: 1.7,
  /** m/s treated as a full-strength hit (damage scale saturates here).
   *  Extended fists move faster than hands — the ceiling sits higher. */
  maxSpeed: 7,
  /** Seconds a hand is cold after scoring. */
  cooldown: 0.34,
  /** How far (m, along the field) a fist must pull back out to re-arm. */
  rearmDist: 0.14,
  /** Damage = base + strength × scale (strength 0..1 from speed). */
  dmgBase: 2.2,
  dmgScale: 3.0,
  /** Head shots (contact within headRadius of the victim's head) hit harder. */
  headMul: 1.4,
  headRadius: 0.45,
  /** A blocked hit lands only this fraction — a good guard is nearly free. */
  blockMul: 0.12,
  /** The block: a defending GEL GLOVE within this of the contact point (or
   *  of the line into the head) turns a hit into a block. Judged by the
   *  DEFENDER — only your own headset knows where your gloves truly are. */
  blockRadius: 0.44,
  /** Ring out of the well: how deep (m) into the surface still counts as
   *  the contact crossing (the field test threshold). */
  contactDepth: 0.06,
};

/* ─────────────────────────────── THE REACH ───────────────────────────────
 * Underdogs-style ranged punching. Your gel fist IS your hand while it
 * guards (1:1 inside `start` of your shoulder — blocks land where your
 * real gloves are), and AMPLIFIES as you extend: a committed full-arm
 * punch throws the gel fist well past your knuckles, the arm ropes out
 * after it, and fast swings lunge further still. Deterministic from the
 * tracked pose alone, and applied identically to the remote fighter's
 * wire pose — both bodies get the same arms, so the fight stays fair.
 */
export const REACH = {
  /** Arm extension (m from shoulder) where amplification starts. Inside
   *  this the mapping is exactly 1:1 — your guard is your guard. */
  start: 0.26,
  /** Extension treated as a full-arm commit (gain saturates here). */
  full: 0.62,
  /** Fist distance multiplier at full extension. */
  maxGain: 2.1,
  /** Extra metres per (m/s of hand speed) at full extension — the lunge. */
  lunge: 0.05,
  /** Hard cap on the gel fist's distance from the shoulder (m, world). */
  maxWorld: 1.55,
};

/* ─────────────────────────────── THE RING ────────────────────────────────
 * AR: your real room is the venue and your real floor is the mat (y = 0
 * always). The DEFAULT ring is a square around the two spawns; each side
 * is then draggable to your actual walls (arena/ringLayout.ts) and the
 * layout persists per headset. spawnBack is PROTOCOL, not decoration —
 * both clients must agree on it (the 2-seat mirror is built from it), so
 * moving your ropes never moves your opponent.
 */
export const RING = {
  /** Default mat half-width — the starting ring is a square 2× this. */
  half: 2.1,
  /** Corner post height and the three rope heights. */
  postHeight: 1.42,
  ropeHeights: [0.52, 0.9, 1.28],
  /** Each fighter's spawn distance from ring centre (PROTOCOL — see above). */
  spawnBack: 1.35,
  /** Ring-adjust clamps: sides can't cross closer than these (m)… */
  minWidth: 1.7,
  minDepth: 2.2,
  /** …or run further out than this from your spawn (m). */
  maxSide: 4.6,
  /** Soft warning when a fighter's HEAD leaves the ring (visual pulse). */
  boundsWarn: 1.9,
  /** The scoreboard: mounted in the air ABOVE the far side of your ring,
   *  set this far BACK beyond the ropes (m) at this height — an arena
   *  jumbotron over the opponent's shoulder, not a plate on the rope
   *  line. It follows the side when you drag the ring to your wall. */
  boardSetback: 1.0,
  boardHeight: 2.5,
};

/* ─────────────────────────────── THE FRAME ───────────────────────────────
 * Quest's frame is bought per pixel, and the raymarch pays per pixel
 * twice over. These are the wholesale knobs (the retail ones are the
 * quality scales in THE GOOPS and GEL_LOOK.maxSteps).
 */
export const PERF = {
  /** WebXR framebuffer scale (1 = native). 0.8 ≈ 64% of the pixels —
   *  soft but honest, and the raymarch pays per pixel. Applied before
   *  the session starts. */
  renderScale: 0.8,
  /** Fixed foveated rendering 0..1 (1 = strongest edge coarsening). */
  foveation: 1,
  /** Ask the session for this refresh rate (Hz). A device defaulting to
   *  90 spends 25% more frame budget than 72 buys back in feel. */
  targetFrameRate: 72,
};

/* ─────────────────────────────── THE SCREENS ─────────────────────────────
 * Two live render-to-texture surfaces, both cheap by construction (small
 * targets, skipped frames, only alive on the screens that need them):
 *  - THE JUMBOTRON: a broadcast-angle view of the match, mounted above
 *    the NEAR side of your ring (opposite the scoreboard).
 *  - THE MIRROR: a selfie panel beside the foyer menu showing YOUR goop
 *    in full — head included (the mirror renders the full pack the
 *    first-person view masks).
 */
export const SCREENS = {
  jumbotron: {
    /** Screen width (m); 16:9. */
    width: 2.3,
    /** Render target size. */
    resX: 448,
    resY: 252,
    /** Capture every Nth frame. */
    everyN: 3,
    /** Mount: back beyond the NEAR ropes, up high (mirrors the board). */
    setback: 1.0,
    height: 2.5,
  },
  mirror: {
    /** Panel size (m); portrait. */
    width: 0.72,
    height: 1.14,
    resX: 320,
    resY: 500,
    everyN: 2,
    /** Camera distance from your body (m) and its vertical FOV — framed
     *  for the WHOLE goop, head dome to puddle skirt. */
    camDist: 2.6,
    fov: 58,
  },
};

/* ─────────────────────────────── THE GOOPS ───────────────────────────────
 * Both fighters run the vendored gel sim in its NATIVE man-size internally
 * and wear a parent scale on top: your eyes stay the creature's eyes (the
 * head rides your headset), so the extra size goes into BULK — a broad,
 * heavy, thick-limbed slab of gel with stumpy legs, not a giant you look
 * up at. All world↔local conversions account for the scale in one place
 * (GelCreature).
 */
export const GOOPS = {
  /** Parent scale on both fighters. Bulk, reach, presence. */
  scale: 1.4,
  /** Raymarch step budget scales (1 = full). Two creatures share a frame:
   *  the one you inhabit runs leaner — most of it is behind your eyes. */
  foeQuality: 0.8,
  selfQuality: 0.55,
  /** Sim clock for fighters (1 = real time). */
  timeScale: 1,
  /** Corner tint decks. Index 0 is the classic green; pickable pre-bout. */
  tints: [
    { name: 'SLIME', shallow: 0x8cff70, deep: 0x14602f, nucleus: 0x36e05a, splat: 0x54d664 },
    { name: 'BUBBLEGUM', shallow: 0xff8ce0, deep: 0x571049, nucleus: 0xe036c8, splat: 0xe054c8 },
    { name: 'TOXIN', shallow: 0x7ff0ff, deep: 0x0e4d5c, nucleus: 0x2fd0e0, splat: 0x54cde0 },
    { name: 'MAGMA', shallow: 0xffd27a, deep: 0x5c300e, nucleus: 0xe0862f, splat: 0xe09a54 },
  ],
};

/** A tint deck row (see GOOPS.tints). */
export interface GoopTint {
  name: string;
  shallow: number;
  deep: number;
  nucleus: number;
  splat: number;
}

/* ─────────────────────────────── THE BOT ─────────────────────────────────
 * Practice mode's house goop — the vendored fighting-style AI given a
 * body. Difficulty stretches its telegraphs and thins its damage, never
 * its readability.
 */
export const BOT = {
  levels: [
    { name: 'SPAR', tempo: 1.65, rest: 1.7, damageMul: 0.55, hp: 80, moveMul: 0.8 },
    { name: 'CONTENDER', tempo: 1.25, rest: 1.15, damageMul: 0.8, hp: 100, moveMul: 1 },
    { name: 'CHAMP', tempo: 0.95, rest: 0.75, damageMul: 1.0, hp: 120, moveMul: 1.2 },
  ],
  /** How far from the player the bot likes to stand (m), scaled per style.
   *  Sized for the big bodies + amplified reach: fights happen at range. */
  holdDistance: 2.0,
  pressDistance: 1.3,
  strikeDistance: 2.15,
};

/* ─────────────────────────────── THE WIRE ────────────────────────────────
 * Poses stream in each sender's LOCAL frame; the 2-seat ring transform
 * (game/ring.ts) maps them across. Events are reliable and rare.
 */
export const NET = {
  /** Pose stream rate (Hz). */
  poseHz: 15,
  /** Authoritative self-state (health, ko) broadcast rate (Hz). */
  stateHz: 4,
  /** A remote pose older than this (ms) freezes the puppet mid-guard. */
  poseStaleMs: 1200,
  /** Room codes are four digits — shoutable across a room. */
  codeLength: 4,
};

/* ─────────────────────────────── THE MUSIC ───────────────────────────────
 * The generative techno set (audio/techno.ts). Intensity follows the
 * fight: act 0 in the foyer, up with the rounds, everything-on when
 * either fighter is under 25 health.
 */
export const MUSIC = {
  bpm: 126,
  /** Health fraction below which the set goes to the last act. */
  desperationAct: 0.25,
};

/* ─────────────────────────────── THE UI ──────────────────────────────────
 * Quiet near-black glass, white hairlines, ONE accent. Ours is the gel's
 * own backlit lime.
 */
export const UI_ACCENT = {
  accent: '#8cff70',
  accentDim: 'rgba(140,255,112,0.55)',
  accentFaint: 'rgba(140,255,112,0.10)',
  onAccent: '#07230d',
  ctaTop: '#a9ff8a',
  ctaBottom: '#4ade63',
};

/** Names offered on the foyer panel (edit yours before hosting). */
export const FIGHTER_NAMES = [
  'GLOB', 'OOZE', 'SPLAT', 'WOBBLE', 'SLUDGE', 'JELLY', 'DRIP', 'BLORP',
];
