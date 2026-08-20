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
  restRecovery: 30,
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
 */
export const PUNCH = {
  /** m/s at contact for a scoring hit. Below it: a poke (still wobbles). */
  hitSpeed: 1.6,
  /** m/s treated as a full-strength hit (damage scale saturates here). */
  maxSpeed: 5.5,
  /** Seconds a hand is cold after scoring. */
  cooldown: 0.28,
  /** How far (m, along the field) a fist must pull back out to re-arm. */
  rearmDist: 0.12,
  /** Damage = base + strength × scale (strength 0..1 from speed). */
  dmgBase: 6,
  dmgScale: 9,
  /** Head shots (contact within headRadius of the HEAD blob) hit harder. */
  headMul: 1.4,
  headRadius: 0.34,
  /** A blocked hit still lands this fraction of its damage. */
  blockMul: 0.25,
  /** The block: a defending glove within this of the contact point (or of
   *  the line into the head) turns a hit into a block. Judged by the
   *  DEFENDER — only your own headset knows where your gloves truly are. */
  blockRadius: 0.3,
  /** Ring out of the well: how deep (m) into the surface still counts as
   *  the contact crossing (the field test threshold). */
  contactDepth: 0.06,
};

/* ─────────────────────────────── THE RING ────────────────────────────────
 * Your real floor is the canvas (y = 0 always). The ring is sized so two
 * roomscale players overlap the middle: each spawns `spawnBack` metres
 * from the centre, facing it.
 */
export const RING = {
  /** Mat half-width — the ring is a square 2× this on a side. */
  half: 2.1,
  /** Corner post height and the three rope heights. */
  postHeight: 1.42,
  ropeHeights: [0.52, 0.9, 1.28],
  /** Apron skirt drop below the mat trim. */
  apron: 0.24,
  /** Each fighter's spawn distance from ring centre. */
  spawnBack: 1.15,
  /** Overhead light truss height. */
  trussHeight: 3.4,
  /** Soft warning when a fighter's HEAD leaves the mat (visual pulse). */
  boundsWarn: 1.9,
};

/* ─────────────────────────────── THE GOOPS ───────────────────────────────
 * Both fighters run the vendored gel sim MAN-SIZED (1.78 m native) — no
 * parent scaling tricks needed here: you are exactly as big as you are.
 * `embodyScale` maps your calibrated height onto the creature's.
 */
export const GOOPS = {
  /** Raymarch step budget scales (1 = full). Two creatures share a frame:
   *  the one you inhabit runs leaner — most of it is behind your eyes. */
  foeQuality: 1,
  selfQuality: 0.7,
  /** Sim clock for fighters (1 = real time — these are people-sized). */
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
  /** How far from the player the bot likes to stand (m), scaled per style. */
  holdDistance: 1.35,
  pressDistance: 0.95,
  strikeDistance: 1.5,
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
