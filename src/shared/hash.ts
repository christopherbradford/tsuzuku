/**
 * TSUZUKU — deterministic randomness for everyone.
 *
 * The ONLY module allowed to touch `Math.random` (in `randomSeed`, used once
 * at onboarding to mint `profile.seed`). Everything else derives an `Rng`
 * from `hashSeed(profile.seed, …)` so every draw is reproducible.
 */

export type Rng = () => number;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over UTF-16 code units (equals the reference vectors for ASCII). */
export function fnv1a32(s: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
/** Alias of `fnv1a32`. */
export const hashString = fnv1a32;

/** MurmurHash3 finalizer: spreads low-entropy inputs over all 32 bits. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** xmur3 seed generator: each call yields the next 32-bit seed derived from `s`. */
export function xmur3(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** uint32 seed from any mix of strings and numbers; order-sensitive. */
export function hashSeed(...parts: (string | number)[]): number {
  return fmix32(fnv1a32(parts.map(String).join('\u001f')));
}

/** mulberry32: fast 32-bit PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `mulberry32(hashSeed(...parts))`. */
export function rngFor(...parts: (string | number)[]): Rng {
  return mulberry32(hashSeed(...parts));
}

/** Uniform element; throws on an empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError('pick: empty array');
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Fisher–Yates on a copy; the input is never mutated. */
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

/** `n` distinct elements (or all, if fewer) in random order. */
export function sample<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  return shuffle(rng, arr).slice(0, Math.max(0, Math.min(n, arr.length)));
}

/** Integer in [min, max], both inclusive. */
export function range(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Float in [min, max). */
export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Bernoulli trial. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Normal deviate (Box–Muller). */
export function gauss(rng: Rng, mean = 0, sd = 1): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Index drawn proportionally to `weights` (non-negative); throws if they sum to 0. */
export function weighted(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) throw new RangeError('weighted: weights sum to 0');
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i] as number);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * A fresh, non-deterministic 32-hex-char seed for a new profile. Uses
 * `crypto.getRandomValues` when present and `Math.random` otherwise — the
 * one sanctioned `Math.random` call in the codebase.
 */
export function randomSeed(): string {
  const words = new Uint32Array(4);
  const c = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(words);
  } else {
    for (let i = 0; i < words.length; i++) words[i] = Math.floor(Math.random() * 4294967296) >>> 0;
  }
  return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
}
