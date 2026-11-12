/**
 * Draw maths (spec §9; docs/research/deck-theory-and-creativity.md §1.2). Exact hypergeometric
 * probabilities from the confirmed rules: 12-card deck, 3-card opening hand, one draw at the start of
 * every turn including turn 1, so `3 + turn` cards seen by the time you play on that turn.
 *
 * `extra` is the number of additional cards seen (draws, deck-to-board pulls); `deckSize` replaces 12
 * when the deck holds shuffled-in cards (theory §1.2, "Draw, tutor and thinning"). All functions clamp
 * their inputs, return a number in [0, 1] and never NaN.
 */

export const DECK_SIZE = 12;
export const OPENING_HAND = 3;

/** Cards seen by the time you play on `turn`: 3 + turn (+ extra). Not capped by the deck size. */
export function cardsSeen(turn: number, extra = 0): number {
  return Math.max(0, OPENING_HAND + Math.max(0, Math.floor(turn)) + Math.max(0, Math.floor(extra)));
}

/** Binomial coefficient; 0 outside the triangle. Exact for the small numbers used here. */
export function choose(n: number, k: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(k) || k < 0 || n < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= kk; i++) r = (r * (n - kk + i)) / i;
  return Math.round(r);
}

function setup(turn: number, extra: number, deckSize: number): { N: number; n: number; total: number } | null {
  const N = Math.max(0, Math.floor(deckSize));
  if (N === 0) return null;
  const n = Math.min(N, cardsSeen(turn, extra));
  return { N, n, total: choose(N, n) };
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const count = (k: number, N: number): number => Math.min(N, Math.max(0, Math.floor(k)));

/** P(at least one of `k` given cards has been seen by `turn`): 1 - C(N-k, n) / C(N, n). */
export function pAtLeastOne(k: number, turn: number, extra = 0, deckSize = DECK_SIZE): number {
  const s = setup(turn, extra, deckSize);
  if (!s) return 0;
  const kk = count(k, s.N);
  if (kk === 0) return 0;
  return clamp01(1 - choose(s.N - kk, s.n) / s.total);
}

/** P(all `k` given cards have been seen by `turn`): C(N-k, n-k) / C(N, n). All of none is 1. */
export function pAll(k: number, turn: number, extra = 0, deckSize = DECK_SIZE): number {
  const s = setup(turn, extra, deckSize);
  if (!s) return 0;
  const kk = Math.max(0, Math.floor(k));
  if (kk === 0) return 1;
  if (kk > s.N) return 0;
  return clamp01(choose(s.N - kk, s.n - kk) / s.total);
}

/**
 * P(at least one of `a` cards and at least one of `b` other cards seen by `turn`), the two groups
 * disjoint: 1 - C(N-a,n)/C(N,n) - C(N-b,n)/C(N,n) + C(N-a-b,n)/C(N,n).
 */
export function pOneOfEach(a: number, b: number, turn: number, extra = 0, deckSize = DECK_SIZE): number {
  const s = setup(turn, extra, deckSize);
  if (!s) return 0;
  const aa = count(a, s.N);
  const bb = Math.min(count(b, s.N), s.N - aa);
  if (aa === 0 || bb === 0) return 0;
  const { N, n, total } = s;
  return clamp01(1 - choose(N - aa, n) / total - choose(N - bb, n) / total + choose(N - aa - bb, n) / total);
}
