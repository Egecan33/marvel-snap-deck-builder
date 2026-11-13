import { gemsFor } from '@/engine/novelty/gems';
import { corpusOf } from '@/engine/novelty/clusters';
import { createScorer } from '@/engine/scoring/scorer';
import type { Card, CardEdge, Deck, EngineContext } from '@/engine/types';
import type { CardDetail, CardFilters, CardPartner, CardsResponse, GemsResponse } from './api-types';
import { cardLookup, cardView, deckKey, engineContext } from './context';
import { HttpError, intParam, isObject } from './http';
import { cacheSlot } from './state';

export const MAX_PAGE_SIZE = 1000;
export const SORTS = ['score', 'cost', 'power', 'name', 'playRate'] as const;
export type Sort = (typeof SORTS)[number];

const numList = (v: unknown, what: string): number[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new HttpError(400, `filters.${what} must be a list of numbers.`);
  return v as number[];
};
const optString = (v: unknown, what: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `filters.${what} must be a string.`);
  return v;
};
const optBool = (v: unknown, what: string): boolean | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `filters.${what} must be true or false.`);
  return v;
};

export function sanitizeFilters(input: unknown): CardFilters {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) throw new HttpError(400, 'filters must be an object.');
  const side = optString(input.side, 'side');
  if (side !== undefined && side !== 'e' && side !== 'p') throw new HttpError(400, "filters.side must be 'e' (enabler) or 'p' (payoff).");
  const maxPlayRate = input.maxPlayRate;
  if (maxPlayRate !== undefined && maxPlayRate !== null && (typeof maxPlayRate !== 'number' || !(maxPlayRate >= 0))) throw new HttpError(400, 'filters.maxPlayRate must be a share from 0 to 1.');
  return {
    cost: numList(input.cost, 'cost'), axis: optString(input.axis, 'axis'), side: side as CardFilters['side'],
    techRole: optString(input.techRole, 'techRole'), series: numList(input.series, 'series'), owned: optBool(input.owned, 'owned'),
    maxPlayRate: typeof maxPlayRate === 'number' ? maxPlayRate : undefined, skills: optBool(input.skills, 'skills'),
  };
}

const playRate = (ctx: EngineContext, id: string): number => ctx.db.meta().cardStat(id)?.listShare ?? 0;

/** Lower case, letters and digits only, for search matching. */
const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');

function matches(c: Card, ctx: EngineContext, q: string, f: CardFilters, owned: Record<string, true> | null): boolean {
  if (q && !fold(`${c.name} ${c.text}`).includes(q)) return false;
  if (f.cost && !f.cost.some((n) => (n >= 7 ? c.cost >= 7 : c.cost === n))) return false;
  if (f.series && !f.series.includes(c.series)) return false;
  if (f.skills === false && c.isSkill) return false;
  if (f.owned === true && !owned?.[c.defId]) return false;
  if (f.owned === false && owned?.[c.defId]) return false;
  if (f.maxPlayRate !== undefined && playRate(ctx, c.defId) > f.maxPlayRate) return false;
  if (f.axis || f.techRole) {
    const feat = ctx.db.features(c.defId);
    if (!feat) return false;
    if (f.techRole && !feat.techRoles.includes(f.techRole)) return false;
    if (f.axis) {
      const a = feat.axes[f.axis];
      if (!a) return false;
      if (f.side === 'e' ? a.e <= 0 : f.side === 'p' ? a.p <= 0 : a.e <= 0 && a.p <= 0) return false;
    }
  }
  return true;
}

/**
 * POST /api/cards: released cards scored against the deck, filtered, sorted, gated cards last
 * (spec §16 card browser). The full scored list is cached per deck, so paging and filter changes
 * do not re-score. `owned` filtering needs the collection, whatever the owned-only setting.
 */
export function queryCards(body: Record<string, unknown>, deck: Deck, ctx: EngineContext): CardsResponse {
  const q = typeof body.q === 'string' ? fold(body.q).trim() : '';
  const filters = sanitizeFilters(body.filters);
  const sort = body.sort ?? 'score';
  if (!SORTS.includes(sort as Sort)) throw new HttpError(400, `sort must be one of ${SORTS.join(', ')}.`);
  const page = intParam(body.page, 0, 0, 100_000);
  const pageSize = intParam(body.pageSize, 60, 1, MAX_PAGE_SIZE);

  const cache = cacheSlot('card-scores', () => new Map<string, ReturnType<ReturnType<typeof createScorer>['scoreAll']>>());
  const key = deckKey(deck, ctx);
  let scored = cache.get(key);
  if (!scored) {
    scored = createScorer(deck, ctx).scoreAll();
    cache.set(key, scored);
    while (cache.size > 8) cache.delete(cache.keys().next().value as string);
  }
  const owned = filters.owned !== undefined ? (ctx.owned ?? engineContext(true).owned) : ctx.owned;
  const db = ctx.db;
  const rows = scored
    .map((s) => ({ s, c: db.get(s.defId)! }))
    .filter(({ c }) => c && matches(c, ctx, q, filters, owned));
  const cmp: Record<Sort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    score: (a, b) => b.s.score - a.s.score,
    cost: (a, b) => a.c.cost - b.c.cost || a.c.power - b.c.power,
    power: (a, b) => b.c.power - a.c.power,
    name: () => 0,
    playRate: (a, b) => playRate(ctx, b.c.defId) - playRate(ctx, a.c.defId),
  };
  rows.sort((a, b) => (a.s.gate ? 1 : 0) - (b.s.gate ? 1 : 0) || cmp[sort as Sort](a, b) || a.c.name.localeCompare(b.c.name, 'en') || (a.c.defId < b.c.defId ? -1 : 1));
  const inDeck = new Set(deck.cards.map((c) => c.defId));
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  return {
    total: rows.length, page, pageSize,
    cards: slice.map(({ s, c }) => {
      const f = db.features(c.defId);
      return { card: cardView(c), score: s, inDeck: inDeck.has(c.defId), playRate: playRate(ctx, c.defId), axes: f?.axes ?? {}, techRoles: f?.techRoles ?? [] };
    }),
  };
}

const PARTNERS = 12;

function partnerOf(ctx: EngineContext, id: string, e: CardEdge): CardPartner {
  const other = e.a === id ? e.b : e.a;
  const c = ctx.db.get(other);
  return { defId: other, card: c ? cardView(c) : null, score: e.score, strong: e.strong, reasons: e.reasons };
}

/** GET /api/card/[id]: the card, its features (clauses as read), top partners and anti-synergies, play rate, and its score in `deck`. */
export function cardDetail(id: string, deck: Deck | null, ctx: EngineContext): CardDetail {
  const card = ctx.db.get(id);
  if (!card) throw new HttpError(404, `No card ${id} in the card database.`);
  const edges = ctx.db.edges(id).filter((e) => e.a !== e.b);
  const partners = edges.filter((e) => e.score > 0).sort((a, b) => b.score - a.score || (a.a + a.b < b.a + b.b ? -1 : 1)).slice(0, PARTNERS).map((e) => partnerOf(ctx, id, e));
  const anti = edges.filter((e) => e.score < 0).sort((a, b) => a.score - b.score).slice(0, 6).map((e) => partnerOf(ctx, id, e));
  return {
    card: cardView(card),
    features: ctx.db.features(id) ?? null,
    partners, anti,
    playRate: ctx.db.meta().cardStat(id) ?? null,
    score: deck ? createScorer(deck, ctx).score(card) : null,
    tokens: Object.values(cardLookup(card.tokens, ctx.db)),
  };
}

/** GET /api/gems: hidden-gem pairs and triples, best first; `q` keeps gems with a card whose name matches. */
export function listGems(q: string, limit: number, ctx: EngineContext): GemsResponse {
  const needle = fold(q).trim();
  const all = gemsFor(ctx.db, needle ? 5000 : limit);
  const picked = (needle ? all.filter((g) => g.cards.some((id) => fold(ctx.db.get(id)?.name ?? id).includes(needle))) : all).slice(0, limit);
  const corpus = corpusOf(ctx.db);
  return {
    gems: picked.map((g) => ({ ...g, cardViews: Object.values(cardLookup(g.cards, ctx.db)) })),
    withheld: corpus.withheld,
    corpus: corpus.info,
    provenance: 'heuristic',
  };
}
