/**
 * The gel creature's own body constants — vendored from the GOOP lineage
 * (GOOP → FIRE FIGHT → RAVE RAID → here), tuned for SLUGFEST: two
 * man-sized fighters instead of one giant boss.
 *
 * Everything here is in the creature's NATIVE metre scale (1.78 m tall).
 * In SLUGFEST the fighters run at 1:1 — you are exactly as big as you are —
 * so these numbers are also world metres.
 *
 * Bout rules (health, judging, cooldowns) live in src/config.ts — this
 * file is only the body itself.
 */

/** The creature's body plan. */
export const CREATURE = {
  /** Head height when fully formed up into its fighting shape. */
  height: 1.78,
  /** Glob-mode dome: roughly this radius, this tall. */
  globRadius: 0.62,
  globHeight: 0.95,
  /** Smooth-min blend width — how gloopily the blobs fuse (bigger = soupier). */
  blend: 0.19,
  /** Max simultaneous knocked-out lumps in flight/resting on the floor.
   *  The boss ran ZERO (24 dancers, no march budget to spare). A bout is
   *  two bodies in one small ring: lumps are back, and a heavy hit tearing
   *  a fist-sized glob off your opponent — which then crawls home across
   *  the mat — is half the reason to play. */
  maxLumps: 5,
  /** Max simultaneous impact dents (negative blobs carved by punches). */
  maxDents: 4,
  /** Seconds for glob -> boxer form-up (and back down). */
  formTime: 1.35,
};

/** Impact reception — what a hit does to the gel (in native creature space).
 *  These are the BODY's constants (dents, ripples, torn lumps). The judge's
 *  constants (what scores, what it's worth) are PUNCH in src/config.ts. */
export const IMPACT = {
  /** Impact speed (m/s) below this only nudges the surface, no "hit". */
  hitSpeed: 1.3,
  /** Impact speed that knocks a lump clean out of the body. */
  lumpSpeed: 3.1,
  /** Impulse scale from impact velocity into nearby blobs — how hard a hit
   *  physically shoves the gel. Cranked so a hit visibly ripples the body. */
  impulse: 1.5,
  /** Radius around the contact point that feels the hit — wide so the shove
   *  travels out across the surface as a ripple, not just a local poke. */
  splashRadius: 0.72,
  /** Seconds a dent crater lingers before the gel flows back in. */
  dentLife: 0.62,
};

/**
 * The gel moveset — the bot throws these; the telegraph silhouettes ARE
 * the dodge language. Telegraph/recover stretch with difficulty tempo;
 * the strike stays snappy.
 */
export type AttackName =
  | 'jab'
  | 'cross'
  | 'hook'
  | 'uppercut'
  | 'overhand'
  | 'backfist'
  | 'roundhouse'
  | 'spinkick'
  | 'clap';

export interface AttackSpec {
  telegraph: number;
  strike: number;
  recover: number;
  damage: number;
  /** Contact distance from the striking blob to the target at apex. */
  hitRadius: number;
}

export const ATTACKS: Record<AttackName, AttackSpec> = {
  jab: { telegraph: 0.5, strike: 0.13, recover: 0.35, damage: 6, hitRadius: 0.42 },
  cross: { telegraph: 0.74, strike: 0.17, recover: 0.55, damage: 10, hitRadius: 0.45 },
  hook: { telegraph: 0.7, strike: 0.2, recover: 0.5, damage: 12, hitRadius: 0.45 },
  uppercut: { telegraph: 0.74, strike: 0.18, recover: 0.55, damage: 13, hitRadius: 0.45 },
  overhand: { telegraph: 0.88, strike: 0.22, recover: 0.6, damage: 14, hitRadius: 0.48 },
  backfist: { telegraph: 0.9, strike: 0.34, recover: 0.6, damage: 15, hitRadius: 0.5 },
  roundhouse: { telegraph: 0.86, strike: 0.26, recover: 0.65, damage: 14, hitRadius: 0.5 },
  spinkick: { telegraph: 0.98, strike: 0.36, recover: 0.72, damage: 17, hitRadius: 0.55 },
  clap: { telegraph: 1.0, strike: 0.22, recover: 0.62, damage: 16, hitRadius: 0.52 },
};

/** Gel look. Colours are linear-ish hex fed straight into the shader.
 *  (Per-fighter tints override the three body colours — GOOPS.tints.) */
export const GEL_LOOK = {
  /** Shallow (thin-edge) tint — backlit lime. */
  shallowColor: 0x8cff70,
  /** Deep-body tint — dark bottle-green. */
  deepColor: 0x14602f,
  /** Inner nucleus glow — the denser "organ" slime in the middle. */
  nucleusColor: 0x36e05a,
  /** Eye flash colour during an attack telegraph. */
  telegraphColor: 0xffb03a,
  /** Raymarch step cap (the single biggest perf knob on Quest). */
  maxSteps: 22,
  /** Surface wobble amplitude at rest / when agitated. */
  wobble: 0.010,
  wobbleAgitated: 0.044,
};
