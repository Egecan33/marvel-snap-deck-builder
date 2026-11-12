/**
 * Improve (spec §14): ordered one-card swaps `{out, in, reason, ratingBefore, ratingAfter, noveltyBefore,
 * noveltyAfter}`, at most 12, never cutting a locked card.
 *  - `stronger` accepts a swap that raises the exact rating.
 *  - `more-original` accepts a swap that raises novelty without lowering the rating by more than one
 *    point and without failing the power floor.
 * Swaps are ranked first by the search evaluator (search.ts, HEURISTIC proxy), then the best few are
 * checked with the exact `rateDeck`, `noveltyOf` and `checkFloor`; only checked swaps are returned.
 */
import { deckIds, noveltyOf } from '../novelty/novelty';
import { edgeLabel, nameOf } from '../rating/deck';
import { rateDeck } from '../rating/rate';
import type { BuildOptions, Deck, EngineContext, SwapProposal } from '../types';
import { checkFloor } from './floor';
import { candidatePool, DEFAULT_PROMPTS } from './pool';
import { createSpace } from './search';

/** Most swaps `improveDeck` returns (spec §14). */
export const MAX_SWAPS = 12;
/** Swaps per call checked exactly (each costs a rating and, for more-original, a floor check). */
const EXACT_CHECKS = 10;
/** Incoming cards considered (top of the candidate pool). */
const IN_POOL = 70;

type Direction = 'stronger' | 'more-original';

/** Replaces each swap's `out` with its `in`, in order; swaps whose `out` is missing are skipped. */
export function applySwaps(deck: Deck, swaps: SwapProposal[]): Deck {
  const cards = (Array.isArray(deck?.cards) ? deck.cards : []).map((c) => ({ ...c }));
  for (const s of swaps ?? []) {
    const i = cards.findIndex((c) => c.defId === s.out);
    if (i < 0 || cards.some((c) => c.defId === s.in)) continue;
    cards[i] = { defId: s.in, locked: false };
  }
  return { ...deck, cards };
}

function reasonFor(ctx: EngineContext, ids: readonly string[], out: string, inn: string, before: { r: number; n: number }, after: { r: number; n: number }): string {
  const db = ctx.db;
  const partners = db.edges(inn)
    .filter((e) => e.a !== e.b && e.score > 0 && ids.includes(e.a === inn ? e.b : e.a) && (e.a === inn ? e.b : e.a) !== out)
    .sort((x, y) => y.score - x.score)
    .slice(0, 2)
    .map((e) => `${nameOf(db, e.a === inn ? e.b : e.a)} (${edgeLabel(e)}, ${e.score.toFixed(2)})`);
  const lost = db.edges(out)
    .filter((e) => e.a !== e.b && e.score >= 0.2 && ids.includes(e.a === out ? e.b : e.a))
    .length;
  return `Cut ${nameOf(db, out)} (${lost} pair${lost === 1 ? '' : 's'} of 0.2+ in the deck) for ${nameOf(db, inn)}`
    + (partners.length ? `, which works with ${partners.join(' and ')} (heuristic network)` : '')
    + `. Rating ${before.r} -> ${after.r}, novelty ${before.n} -> ${after.n}.`;
}

/**
 * Best single swaps for one direction, best first (rating gain for `stronger`, novelty gain for
 * `more-original`), at most `count`, each with a distinct incoming card.
 */
export function suggestSwaps(deck: Deck, ctx: EngineContext, opts: BuildOptions, direction: Direction, count = 5): SwapProposal[] {
  const db = ctx.db;
  const ids = deckIds(deck, db);
  if (ids.length === 0) return [];
  const o: BuildOptions = { mode: opts?.mode === 'tuned' ? 'tuned' : 'brew', seed: opts?.seed ?? 0, owned: opts?.owned ?? ctx.owned, prompts: { ...DEFAULT_PROMPTS, ...(opts?.prompts ?? {}), surprise: false }, count: 1 };
  const c: EngineContext = { db, owned: o.owned };
  const locked = new Set((deck.cards ?? []).filter((x) => x?.locked).map((x) => x.defId));
  const before = { r: rateDeck(deck, c).rating, n: noveltyOf(deck, c).novelty };
  // Candidate pool ranked by interaction with the whole deck; tuned rules unless the deck is a brew.
  const pool = candidatePool(ids, deck, o, c, IN_POOL);
  const space = createSpace(db, pool.ids, { mode: direction === 'more-original' ? 'brew' : 'tuned', fixed: [], c5: [], maxShared: null, wildcards: 0 });
  const idx = ids.map((id) => space.index.get(id)!);
  const baseEv = space.evaluate(idx);
  const baseF = direction === 'stronger' ? space.objective(baseEv) : baseEv.novelty;
  const ranked: { out: string; inn: string; gain: number }[] = [];
  for (let s = 0; s < idx.length; s++) {
    if (locked.has(ids[s]!)) continue;
    for (let j = ids.length; j < space.ids.length; j++) {
      const trial = [...idx];
      trial[s] = j;
      const ev = space.evaluate(trial);
      const F = direction === 'stronger' ? space.objective(ev) : ev.novelty - (space.objective(ev) < space.objective(baseEv) - 3 ? 100 : 0);
      if (F > baseF) ranked.push({ out: ids[s]!, inn: space.ids[j]!, gain: F - baseF });
    }
  }
  ranked.sort((a, b) => b.gain - a.gain || (a.out + a.inn < b.out + b.inn ? -1 : 1));
  const out: SwapProposal[] = [];
  const usedIn = new Set<string>();
  let checks = 0;
  for (const r of ranked) {
    if (out.length >= count || checks >= EXACT_CHECKS) break;
    if (usedIn.has(r.inn)) continue;
    checks++;
    const next = applySwaps(deck, [{ out: r.out, in: r.inn, reason: '', ratingBefore: 0, ratingAfter: 0, noveltyBefore: 0, noveltyAfter: 0 }]);
    const after = { r: rateDeck(next, c).rating, n: noveltyOf(next, c).novelty };
    const ok = direction === 'stronger'
      ? after.r > before.r
      : after.n > before.n && after.r >= before.r - 1 && checkFloor(next, c).passed;
    if (!ok) continue;
    usedIn.add(r.inn);
    out.push({ out: r.out, in: r.inn, reason: reasonFor(c, ids, r.out, r.inn, before, after), ratingBefore: before.r, ratingAfter: after.r, noveltyBefore: before.n, noveltyAfter: after.n });
  }
  out.sort((a, b) => (direction === 'stronger' ? b.ratingAfter - a.ratingAfter : b.noveltyAfter - a.noveltyAfter) || (a.out + a.in < b.out + b.in ? -1 : 1));
  return out;
}

/**
 * Ordered swaps applied one after another, each the best checked swap on the deck so far, until no
 * swap qualifies or `max` (at most 12) is reached. Each proposal's before/after numbers are those of
 * its own step.
 */
export function improveDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, direction: Direction, max = MAX_SWAPS): SwapProposal[] {
  const limit = Math.max(0, Math.min(MAX_SWAPS, Math.floor(max)));
  const out: SwapProposal[] = [];
  let cur = deck;
  const seen = new Set<string>();
  for (let i = 0; i < limit; i++) {
    const s = suggestSwaps(cur, ctx, opts, direction, 1)[0];
    if (!s || seen.has(s.in) || seen.has(s.out)) break;
    seen.add(s.in);
    seen.add(s.out);
    out.push(s);
    cur = applySwaps(cur, [s]);
  }
  return out;
}
