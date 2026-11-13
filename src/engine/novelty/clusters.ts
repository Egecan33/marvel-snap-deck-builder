/**
 * Corpus counting for novelty and discovery (spec §13; docs/research/deck-theory-and-creativity.md
 * §4.3-§4.4; meta-sources.md §3, §5).
 *
 * Pair evidence is counted over CLUSTERS of near-duplicate lists (lists sharing 11+ cards, computed at
 * meta sync), not over raw lists: 48% of known lists are one card from another (meta §3), so one
 * popular list with twenty variants counts once. N in the formulas is the number of clusters, and the
 * "at least 300" corpus rule of theory §4.4 is applied to that number too. Card play rate p_c for
 * rarity is the share of LISTS playing the card, as theory §4.3 defines it.
 */
import type { CardDb, MetaInfo } from '../types';

/** One-sided 95% normal quantile (theory §4.4: "one-sided 95% Wilson bound"). */
const Z = 1.6448536269514722;
/** Co-play rate that counts as explored (theory §4.4, §5: 1% of lists). Heuristic. */
export const EXPLORED_RATE = 0.01;
/** Corpus size below which "unexplored" claims are withheld (theory §4.4, §5: 300). */
export const MIN_CORPUS = 300;
/** Play-rate floor for rarity (theory §4.3: 0.2%). */
export const RARITY_FLOOR = 0.002;
/** Pseudo-count of the smoothed lift (theory §4.4: 5). */
export const LIFT_PSEUDO = 5;
/** Low-lift warning: smoothed lift below 0.5 with expected co-play at least 5 (theory §4.4). */
export const LOW_LIFT = 0.5;
export const LOW_LIFT_MIN_EXPECTED = 5;
/** Cards released this recently have no meaningful rarity (spec §13: 14 days). */
export const NEW_CARD_MS = 14 * 24 * 3600 * 1000;

/** Upper end of the one-sided 95% Wilson score interval for k successes in n trials; 1 when n is 0. */
export function wilsonUpper(k: number, n: number): number {
  const nn = Number.isFinite(n) ? Math.floor(n) : 0;
  if (nn <= 0) return 1;
  const kk = Math.min(nn, Math.max(0, Number.isFinite(k) ? k : 0));
  const p = kk / nn;
  const z2 = Z * Z;
  const denom = 1 + z2 / nn;
  const centre = p + z2 / (2 * nn);
  const margin = Z * Math.sqrt((p * (1 - p)) / nn + z2 / (4 * nn * nn));
  return Math.min(1, Math.max(0, (centre + margin) / denom));
}

/** Lower end of the one-sided 95% Wilson score interval for k successes in n trials; 0 when n is 0. */
export function wilsonLower(k: number, n: number): number {
  const nn = Number.isFinite(n) ? Math.floor(n) : 0;
  if (nn <= 0) return 0;
  const kk = Math.min(nn, Math.max(0, Number.isFinite(k) ? k : 0));
  const p = kk / nn;
  const z2 = Z * Z;
  const denom = 1 + z2 / nn;
  const centre = p + z2 / (2 * nn);
  const margin = Z * Math.sqrt((p * (1 - p)) / nn + z2 / (4 * nn * nn));
  return Math.min(1, Math.max(0, (centre - margin) / denom));
}

/**
 * Unexplored factor U = 1 - min(1, WilsonUpper95(n_ab, N) / 0.01) (theory §4.4). With nothing observed
 * it is 0.00 at N = 100, 0.11 at 300, 0.73 at 1,000: a thin corpus cannot call anything unexplored.
 */
export function unexplored(observedClusters: number, totalClusters: number): number {
  return 1 - Math.min(1, wilsonUpper(observedClusters, totalClusters) / EXPLORED_RATE);
}

/** rarity(c) = log2(1 / max(p, 0.002)) / log2(1 / 0.002), in [0, 1] (theory §4.3). */
export function rarity(listShare: number): number {
  const p = Math.max(RARITY_FLOOR, Number.isFinite(listShare) ? listShare : 0);
  return Math.max(0, Math.min(1, Math.log2(1 / p) / Math.log2(1 / RARITY_FLOOR)));
}

export interface Corpus {
  info: MetaInfo | null;
  lists: number;
  clusters: number;
  /** Why "unexplored" claims are not made, or null when the corpus is large enough. */
  withheld: string | null;
  listShare(defId: string): number;
  /** Clusters holding the card. */
  cardClusters(defId: string): number;
  /** Clusters holding all of the given cards (pairs and triples). */
  together(ids: readonly string[]): number;
}

const corpusCache = new WeakMap<CardDb, Corpus>();

/** Counting view of the db's meta snapshot, cached per database. Never throws on an empty snapshot. */
export function corpusOf(db: CardDb): Corpus {
  const hit = corpusCache.get(db);
  if (hit) return hit;
  const meta = db.meta();
  const info = meta.info();
  const all = info ? meta.lists() : [];
  const clusterIds = new Set(all.map((l) => l.cluster));
  const clusters = clusterIds.size;
  const lists = all.length;
  const withheld = !info || lists === 0
    ? 'No meta snapshot is synced, so play rates, nearest lists and "unexplored" claims cannot be computed; run the meta sync.'
    : clusters < MIN_CORPUS
      ? `The meta corpus holds ${lists} lists in ${clusters} clusters of near-duplicates; below ${MIN_CORPUS} clusters a pair cannot be called unexplored (Wilson bound).`
      : null;
  const triple = new Map<string, number>();
  const corpus: Corpus = {
    info,
    lists,
    clusters,
    withheld,
    listShare: (id) => (lists ? meta.cardStat(id)?.listShare ?? 0 : 0),
    cardClusters: (id) => (lists ? Math.round((meta.cardStat(id)?.clusterShare ?? 0) * clusters) : 0),
    together: (ids) => {
      if (!lists || ids.length === 0) return 0;
      if (ids.length === 1) return corpus.cardClusters(ids[0]!);
      if (ids.length === 2) return meta.pair(ids[0]!, ids[1]!).clusters;
      const key = [...ids].sort().join('|');
      const cached = triple.get(key);
      if (cached !== undefined) return cached;
      const sets = ids.map((id) => meta.listsWith(id));
      sets.sort((a, b) => a.length - b.length);
      const others = sets.slice(1).map((s) => new Set(s));
      const found = new Set<number>();
      for (const i of sets[0]!) if (others.every((s) => s.has(i))) found.add(all[i]!.cluster);
      triple.set(key, found.size);
      return found.size;
    },
  };
  corpusCache.set(db, corpus);
  return corpus;
}

/** Observed / expected co-play, U and smoothed lift for a card set (clusters; theory §4.4). */
export function coplay(corpus: Corpus, ids: readonly string[]): { observed: number; expected: number; unexplored: number; liftSmoothed: number; warning: string | null } {
  const N = corpus.clusters;
  const observed = corpus.together(ids);
  let expected = 0;
  if (N > 0) {
    expected = N;
    for (const id of ids) expected *= corpus.cardClusters(id) / N;
  }
  const liftSmoothed = (observed + LIFT_PSEUDO) / (expected + LIFT_PSEUDO);
  const warning = liftSmoothed < LOW_LIFT && expected >= LOW_LIFT_MIN_EXPECTED
    ? `Both popular, rarely together: seen in ${observed} of ${N} clusters where popularity predicts about ${expected.toFixed(1)}; there may be a reason.`
    : null;
  return { observed, expected, unexplored: N > 0 ? unexplored(observed, N) : 0, liftSmoothed, warning };
}
