/**
 * Candidate pool of the builder (spec §14 step 1; theory §4.5 step 1, §4.6 prompts): the cards the
 * search may use, after the constraint prompts, ranked by interaction with the locks and themes (plus
 * rarity in brew mode) and cut to the top ~120.
 *
 * Prompt meaning (theory §4.6):
 *  - maxPlayRate: drop cards above this list share (measured); `techExempt` keeps cards with a tech
 *    role. Brew mode only: tuned mode is meant to land near the meta.
 *  - maxShared: at most N cards shared with any known list. Enforced by the search, brew mode only.
 *  - wildcards: k slots filled by gem score. Applied by the search, brew mode only.
 *  - maxSeries: Untapped series code ceiling (data §1.1 mapping: 1 Starter, 2 Series 0, 3 Recruit,
 *    4-8 Series 1-5, 9 Season Pass, 10 Limited-Time Event); a card passes when `series <= maxSeries`.
 *  - avoid: defIds never added (locks are kept even when listed).
 *  - surprise: start from a sampled gem pair instead of the locks.
 * Owned-only comes from `BuildOptions.owned`. Locked cards are always kept in the pool and are exempt
 * from maxPlayRate, maxSeries and avoid (the gates: released, deckable, mode ban, owned still apply).
 */
import { rarity, corpusOf } from '../novelty/clusters';
import { gateFor } from '../rules/validate';
import type { BuildOptions, CardDb, Deck, EngineContext, Prompts } from '../types';

/** Defaults of theory §4.6 / §5 (HEURISTIC). */
export const DEFAULT_PROMPTS: Prompts = {
  maxPlayRate: 0.05,
  techExempt: true,
  maxShared: 4,
  wildcards: 2,
  maxSeries: null,
  avoid: [],
  surprise: false,
};

/** Candidates kept after ranking (theory §4.5: 80 to 120). */
export const POOL_SIZE = 120;

export interface PoolResult {
  /** Allowed cards (locks first), ranked. */
  ids: string[];
  /** Cards removed by each prompt, for "what the filter cost" reports. */
  removed: { prompt: string; count: number }[];
}

/** Is a card allowed by the gates and prompts (ignoring the deck it would join)? */
export function allowed(db: CardDb, id: string, deck: Deck, opts: BuildOptions, ctx: EngineContext): string | null {
  const c = db.get(id);
  if (!c) return 'unknown';
  const empty: Deck = { ...deck, cards: [] };
  const gate = gateFor(c, empty, db, opts.owned ?? ctx.owned);
  if (gate) return gate.code;
  const p = opts.prompts ?? DEFAULT_PROMPTS;
  if (p.avoid?.includes(id)) return 'avoid';
  if (p.maxSeries !== null && p.maxSeries !== undefined && c.series > p.maxSeries) return 'maxSeries';
  if (opts.mode === 'brew' && p.maxPlayRate !== null && p.maxPlayRate !== undefined) {
    const share = corpusOf(db).listShare(id);
    const tech = (db.features(id)?.techRoles.length ?? 0) > 0;
    if (share > p.maxPlayRate && !(p.techExempt && tech)) return 'maxPlayRate';
  }
  return null;
}

/**
 * The ranked candidate pool. Rank (HEURISTIC) = summed positive pair score with the locks (x2) and the
 * theme bonus, plus the card's strong degree in the whole pool / 10 (so cards that connect to many
 * others stay in reach of the search), plus rarity in brew mode or 0.5 x list share in tuned mode.
 * Ties by defId.
 */
export function candidatePool(locks: readonly string[], deck: Deck, opts: BuildOptions, ctx: EngineContext, size = POOL_SIZE): PoolResult {
  const db = ctx.db;
  const corpus = corpusOf(db);
  const lockSet = new Set(locks);
  const removedBy = new Map<string, number>();
  const ranked: { id: string; r: number }[] = [];
  for (const c of db.released()) {
    if (lockSet.has(c.defId)) continue;
    const why = allowed(db, c.defId, deck, opts, ctx);
    if (why) {
      removedBy.set(why, (removedBy.get(why) ?? 0) + 1);
      continue;
    }
    let r = 0;
    let strongDeg = 0;
    for (const e of db.edges(c.defId)) {
      const other = e.a === c.defId ? e.b : e.a;
      if (other === c.defId) continue;
      if (e.strong) strongDeg++;
      if (lockSet.has(other) && e.score > 0) r += 2 * e.score;
    }
    const f = db.features(c.defId);
    for (const t of deck.themes ?? []) {
      const a = f?.axes[t];
      if (a && (a.e >= 0.5 || a.p >= 0.5)) r += 1;
    }
    r += Math.min(4, strongDeg) / 10;
    r += opts.mode === 'brew' ? rarity(corpus.listShare(c.defId)) : 0.5 * corpus.listShare(c.defId);
    ranked.push({ id: c.defId, r });
  }
  ranked.sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1));
  const ids = [...locks, ...ranked.slice(0, Math.max(0, size)).map((x) => x.id)];
  return { ids, removed: [...removedBy].map(([prompt, count]) => ({ prompt, count })).sort((a, b) => (a.prompt < b.prompt ? -1 : 1)) };
}
