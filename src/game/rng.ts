/**
 * Deterministic randomness — vendored from RAVE RAID unchanged.
 *
 * SLUGFEST's wire never carries anything derivable: the techno set and any
 * seeded flourish (bot style deals, corner confetti) come off the bout
 * seed identically on both headsets.
 */

/** mulberry32 — tiny, fast, good enough for choreography. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix extra lanes into a seed (round index, hand, …) without collisions. */
export function mix(seed: number, ...lanes: number[]): number {
  let h = seed >>> 0;
  for (const lane of lanes) {
    h = Math.imul(h ^ (lane + 0x9e3779b9), 2654435761) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** One deterministic uniform in [0,1) for a (seed, …lanes) key. */
export function roll(seed: number, ...lanes: number[]): number {
  return mulberry32(mix(seed, ...lanes))();
}

/** A fresh random bout seed (host-side only — the guest receives it). */
export function freshSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
