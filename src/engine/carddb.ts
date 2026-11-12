import { cleanText, textFixFor, type TextFix } from './text/clean';
import type {
  Card, CardClass, CardDb, CardEdge, CardFeatures, FormatDef, MetaArchetype, MetaCardStat, MetaIndex, MetaInfo, MetaList,
  MetaPairStat, PlanDef,
} from './types';

/** A row of Untapped's cards.json (docs/research/data-sources.md §1.1). Only `defId` is certain. */
export interface UntappedCardRow {
  defId: string;
  name: string;
  cost: number;
  power: number;
  description: string;
  series?: number;
  seriesStartTimestamps?: number[];
  collectible?: boolean;
  isSeasonPass?: boolean;
  isSkill?: boolean;
  possibleSeries?: number;
  attributes?: { data?: Record<string, unknown>; cards?: Record<string, string[]>; locations?: unknown };
  [key: string]: unknown;
}

/** `seriesStartTimestamps` value the data uses for "always available" (0001-01-01). */
export const ALWAYS_AVAILABLE = -62135596800000;

/**
 * Untapped's `series` number in words. In code because the source ships the number only; the
 * mapping was measured by joining every row against DotGG's CardSeriesDefId (data §1.1).
 */
const SERIES_LABELS: Record<number, string> = {
  0: 'None', 1: 'Starter', 2: 'Collection Level 1-14', 3: 'Recruit', 4: 'Series 1', 5: 'Series 2', 6: 'Series 3',
  7: 'Series 4', 8: 'Series 5', 9: 'Season Pass', 10: 'Limited Time Event',
};
export const seriesLabel = (series: number): string => SERIES_LABELS[series] ?? `Series code ${series}`;

const startTimes = (row: UntappedCardRow): number[] =>
  Array.isArray(row.seriesStartTimestamps) ? row.seriesStartTimestamps.filter((t) => typeof t === 'number' && Number.isFinite(t)) : [];

/**
 * Class of a row at time `now` (data §1.1). It depends on the clock, so it is recomputed at
 * every load and never stored as a list.
 *   released: collectible, in a series, and the first series start date has been reached
 *   upcoming: not released, and some start date is in the future
 *   token:    everything else (summons, mode copies, augments, tutorial and test cards)
 */
export function classOf(row: UntappedCardRow, now: number): CardClass {
  const times = startTimes(row);
  if (row.collectible === true && (row.series ?? 0) > 0 && times.length > 0 && Math.min(...times) <= now) return 'released';
  if (times.some((t) => t > now)) return 'upcoming';
  return 'token';
}

/**
 * Source row to Card. `fixes` are the reviewed texts of sync-data/card-text-fixes.json; one applies
 * only while the row's description still equals the text it was reviewed against.
 */
export function toCard(row: UntappedCardRow, now: number, fixes?: Readonly<Record<string, TextFix>>): Card {
  const times = startTimes(row);
  const first = times.length > 0 ? Math.min(...times) : null;
  const text = textFixFor(row.defId, row.description, fixes) ?? cleanText(row.description);
  const attributes: Record<string, number> = {};
  for (const [key, value] of Object.entries(row.attributes?.data ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) attributes[key] = value;
  }
  const tokens = row.attributes?.cards?.Card_Token;
  const series = typeof row.series === 'number' ? row.series : 0;
  return {
    defId: row.defId,
    name: typeof row.name === 'string' && row.name ? row.name : row.defId,
    cost: Number.isFinite(row.cost) ? row.cost : 0,
    power: Number.isFinite(row.power) ? row.power : 0,
    text,
    rawText: row.description ?? '',
    hasAbility: text !== '',
    isSkill: row.isSkill === true,
    isSeasonPass: row.isSeasonPass === true,
    series,
    seriesLabel: seriesLabel(series),
    releaseAt: first === null || first === ALWAYS_AVAILABLE ? null : first,
    cardClass: classOf(row, now),
    tokens: Array.isArray(tokens) ? tokens.filter((t) => typeof t === 'string') : [],
    attributes,
  };
}

/** Lookup key for a display name: lower case, no diacritics, letters and digits only. */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const CLASS_RANK: Record<CardClass, number> = { released: 0, upcoming: 1, token: 2 };
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface CardDbInput {
  cards: readonly Card[];
  features: readonly CardFeatures[];
  edges: readonly CardEdge[];
  formats: readonly FormatDef[];
  plans: readonly PlanDef[];
  meta: MetaIndex;
  now: number;
}

/** In-memory card database. Pure: `cards` already carry the class computed for `now`. */
export function createCardDb(input: CardDbInput): CardDb {
  const all = [...input.cards].sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
  const byId = new Map<string, Card>();
  for (const c of all) if (!byId.has(c.defId)) byId.set(c.defId, c);
  const released = all.filter((c) => c.cardClass === 'released');

  // Display names are not unique: mode copies and tokens reuse the names of released cards
  // (plan Review focus 1). The released card wins, then an upcoming one, then the lowest defId.
  const byName = new Map<string, Card>();
  const better = (a: Card, b: Card): boolean =>
    CLASS_RANK[a.cardClass] !== CLASS_RANK[b.cardClass] ? CLASS_RANK[a.cardClass] < CLASS_RANK[b.cardClass] : a.defId < b.defId;
  for (const c of all) {
    const key = normalizeName(c.name);
    if (!key) continue;
    const held = byName.get(key);
    if (!held || better(c, held)) byName.set(key, c);
  }

  const features = new Map<string, CardFeatures>();
  for (const f of input.features) features.set(f.defId, f);

  const edgesOf = new Map<string, CardEdge[]>();
  const edgeByPair = new Map<string, CardEdge>();
  for (const e of input.edges) {
    edgeByPair.set(pairKey(e.a, e.b), e);
    for (const id of e.a === e.b ? [e.a] : [e.a, e.b]) {
      const list = edgesOf.get(id);
      if (list) list.push(e);
      else edgesOf.set(id, [e]);
    }
  }

  const formats = [...input.formats];
  const plans = [...input.plans];
  const NO_EDGES: readonly CardEdge[] = [];

  return {
    now: input.now,
    get: (defId) => byId.get(defId),
    byName: (name) => (typeof name === 'string' ? byName.get(normalizeName(name)) : undefined),
    released: () => released,
    all: () => all,
    features: (defId) => features.get(defId),
    edges: (defId) => edgesOf.get(defId) ?? NO_EDGES,
    edge: (a, b) => edgeByPair.get(pairKey(a, b)),
    formats: () => formats,
    plans: () => plans,
    meta: () => input.meta,
  };
}

/**
 * Near-duplicate clusters (meta §5): lists that share at least 11 cards are joined, transitively
 * (union-find). Returns one cluster id per list, numbered from 0 in order of first appearance.
 * Two 12-card lists share 11 cards exactly when they have an 11-card subset in common, so each
 * list is hashed under its subsets instead of comparing every pair of lists.
 */
export function clusterLists(lists: readonly { cards: readonly string[] }[]): number[] {
  const parent = lists.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const seen = new Map<string, number>();
  const visit = (key: string, i: number): void => {
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else union(first, i);
  };
  lists.forEach((list, i) => {
    const cards = [...new Set(list.cards)].sort();
    if (cards.length < 11) return;                       // cannot share 11 cards with anything
    if (cards.length === 11) return visit(cards.join('|'), i);
    if (cards.length > 12) return visit(`=${cards.join('|')}`, i); // not a deck; only joins its exact copies
    for (let skip = 0; skip < cards.length; skip++) visit(cards.filter((_, k) => k !== skip).join('|'), i);
  });

  const ids = new Map<number, number>();
  return lists.map((_, i) => {
    const root = find(i);
    let id = ids.get(root);
    if (id === undefined) {
      id = ids.size;
      ids.set(root, id);
    }
    return id;
  });
}

/** Games a card needs behind it before a win-rate delta is reported (meta §5, heuristic floor). */
export const MIN_GAMES_FOR_WIN_DELTA = 200;

const NO_PAIR: MetaPairStat = Object.freeze({ lists: 0, clusters: 0 });

/**
 * Index over one meta snapshot. Card stats, pair counts and `listsWith` are derived from the
 * lists; nothing is fetched. Win rate is only ever exposed as a delta against the snapshot's own
 * pooled win rate (meta §3 bias note 2).
 */
export function createMetaIndex(info: MetaInfo | null, lists: readonly MetaList[], archetypes: readonly MetaArchetype[]): MetaIndex {
  const all = [...lists];
  const archs = [...archetypes];
  const withCard = new Map<string, number[]>();
  all.forEach((list, i) => {
    for (const card of new Set(list.cards)) {
      const at = withCard.get(card);
      if (at) at.push(i);
      else withCard.set(card, [i]);
    }
  });

  const clusterCount = new Set(all.map((l) => l.cluster)).size;
  const totalGames = all.reduce((s, l) => s + l.games, 0);
  const totalWins = all.reduce((s, l) => s + l.wins, 0);
  const baseline = info && Number.isFinite(info.baselineWinRate) ? info.baselineWinRate : totalGames > 0 ? totalWins / totalGames : 0;

  const stats = new Map<string, MetaCardStat>();
  for (const [card, at] of withCard) {
    let games = 0;
    let wins = 0;
    const clusters = new Set<number>();
    for (const i of at) {
      games += all[i].games;
      wins += all[i].wins;
      clusters.add(all[i].cluster);
    }
    stats.set(card, {
      lists: at.length,
      listShare: at.length / all.length,
      clusterShare: clusterCount > 0 ? clusters.size / clusterCount : 0,
      games,
      winDelta: games >= MIN_GAMES_FOR_WIN_DELTA ? wins / games - baseline : null,
    });
  }

  // Pair counts are built on first use: about 35,000 distinct pairs for a 4,800-list snapshot.
  let pairs: Map<string, { lists: number; clusters: Set<number> }> | null = null;
  const buildPairs = () => {
    const map = new Map<string, { lists: number; clusters: Set<number> }>();
    for (const list of all) {
      const cards = [...new Set(list.cards)].sort();
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const key = `${cards[i]}|${cards[j]}`;
          const hit = map.get(key);
          if (hit) {
            hit.lists += 1;
            hit.clusters.add(list.cluster);
          } else {
            map.set(key, { lists: 1, clusters: new Set([list.cluster]) });
          }
        }
      }
    }
    return map;
  };

  const NO_LISTS: readonly number[] = [];
  return {
    info: () => info,
    lists: () => all,
    listsWith: (defId) => withCard.get(defId) ?? NO_LISTS,
    cardStat: (defId) => stats.get(defId),
    pair: (a, b) => {
      if (a === b) return NO_PAIR;
      pairs ??= buildPairs();
      const hit = pairs.get(pairKey(a, b));
      return hit ? { lists: hit.lists, clusters: hit.clusters.size } : NO_PAIR;
    },
    archetypes: () => archs,
  };
}
