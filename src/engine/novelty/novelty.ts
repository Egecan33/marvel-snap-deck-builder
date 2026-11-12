/**
 * Deck novelty (spec §13; docs/research/deck-theory-and-creativity.md §4.3). Defined quantities over
 * the synced corpus: they measure distance and unexploredness, not strength (theory §4.8), which is why
 * the rating never includes them and the builder pairs them with the power floor.
 *
 *   Novelty(D)      = 100 x (0.45 ListDistance + 0.25 ConnectedRarity + 0.30 PackageNovelty)
 *   ListDistance    = 1 - o1 / 12, o1 = most cards shared with one corpus list (measured)
 *   ConnectedRarity = (1/12) sum rarity(c) x [c has a strong edge in D, or a tech role]
 *   PackageNovelty  = sum over strong edges of s x U / sum of s (U over clusters, see clusters.ts)
 *
 * The weights and the bands (below 35 meta, 35-59 variant, 60-79 off-meta, 80+ brew) are HEURISTIC
 * (theory §5). With no meta snapshot every list-based term has nothing to compare against: ListDistance
 * is 1 and every card is rare, so the report sets `claimsWithheld` and the number must not be read as
 * evidence of originality. Since the engine review (2026-11-13) such a deck, and any deck with fewer
 * than 12 known cards, gets novelty 0 and band 'unknown' with the reason in `claimsWithheld`: the
 * terms are still reported in `parts`, but no band is claimed.
 */
import type { CardDb, CardEdge, Deck, EngineContext, NearList, NoveltyReport, PairEvidence } from '../types';
import { coplay, corpusOf, NEW_CARD_MS, rarity } from './clusters';

export const NOVELTY_WEIGHTS = { listDistance: 0.45, connectedRarity: 0.25, packageNovelty: 0.3 } as const;
/** Deck size the novelty terms are normalised by (rules §1.1: 12 cards). */
const SIZE = 12;
/** Deck cards listed in `rareCards`: play rate at most 5% (the default play-rate prompt, theory §4.6). Heuristic. */
export const RARE_SHARE = 0.05;
const NEAREST = 3;

export function bandOf(novelty: number): NoveltyReport['band'] {
  if (novelty >= 80) return 'brew';
  if (novelty >= 60) return 'off-meta';
  if (novelty >= 35) return 'variant';
  return 'meta';
}

/** Distinct known card ids of a deck, in deck order. */
export function deckIds(deck: Deck, db: CardDb): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cards = Array.isArray(deck?.cards) ? deck.cards : [];
  for (const dc of cards) {
    const id = dc && typeof dc.defId === 'string' ? dc.defId : '';
    if (!id || seen.has(id) || !db.get(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Strong edges between the given cards. */
export function strongEdgesAmong(db: CardDb, ids: readonly string[]): CardEdge[] {
  const set = new Set(ids);
  const out: CardEdge[] = [];
  for (const id of ids) for (const e of db.edges(id)) if (e.strong && e.a === id && set.has(e.b) && e.b !== id) out.push(e);
  return out;
}

/** Corpus lists sharing the most cards with `ids`: max overlap and up to `n` lists from distinct clusters. */
export function nearestLists(db: CardDb, ids: readonly string[], n = NEAREST): { o1: number; nearest: NearList[] } {
  const meta = db.meta();
  if (!meta.info()) return { o1: 0, nearest: [] };
  const lists = meta.lists();
  const shared = new Map<number, number>();
  for (const id of ids) for (const i of meta.listsWith(id)) shared.set(i, (shared.get(i) ?? 0) + 1);
  const ranked = [...shared].sort((x, y) => y[1] - x[1] || lists[y[0]]!.games - lists[x[0]]!.games || (lists[x[0]]!.key < lists[y[0]]!.key ? -1 : 1));
  const arch = new Map(meta.archetypes().map((a) => [a.id, a.name]));
  const nearest: NearList[] = [];
  const clusters = new Set<number>();
  for (const [i, s] of ranked) {
    if (nearest.length >= n) break;
    const l = lists[i]!;
    if (clusters.has(l.cluster)) continue;
    clusters.add(l.cluster);
    nearest.push({ key: l.key, shared: s, archetype: l.archetypeId === null ? null : arch.get(l.archetypeId) ?? null, games: l.games, cards: [...l.cards] });
  }
  return { o1: ranked[0]?.[1] ?? 0, nearest };
}

/** Is the card connected for ConnectedRarity: a strong edge to another deck card, or a tech role. */
export function isConnected(db: CardDb, id: string, deckSet: ReadonlySet<string>): boolean {
  if ((db.features(id)?.techRoles.length ?? 0) > 0) return true;
  return db.edges(id).some((e) => e.strong && e.a !== e.b && deckSet.has(e.a === id ? e.b : e.a));
}

export function noveltyOf(deck: Deck, ctx: EngineContext): NoveltyReport {
  const db = ctx.db;
  const ids = deckIds(deck, db);
  const corpus = corpusOf(db);
  const deckSet = new Set(ids);

  const { o1, nearest } = nearestLists(db, ids);
  const listDistance = 1 - Math.min(SIZE, o1) / SIZE;

  let raritySum = 0;
  const rareCards: NoveltyReport['rareCards'] = [];
  for (const id of ids) {
    const share = corpus.listShare(id);
    const connected = isConnected(db, id, deckSet);
    if (connected) raritySum += rarity(share);
    const c = db.get(id)!;
    const isNew = c.releaseAt !== null && db.now - c.releaseAt >= 0 && db.now - c.releaseAt <= NEW_CARD_MS;
    if (share <= RARE_SHARE || isNew) rareCards.push({ defId: id, listShare: share, connected, isNew });
  }
  const connectedRarity = Math.min(1, raritySum / Math.max(SIZE, ids.length));

  const pairs: PairEvidence[] = [];
  let num = 0;
  let den = 0;
  for (const e of strongEdgesAmong(db, ids)) {
    const ev = coplay(corpus, [e.a, e.b]);
    const s = Math.max(0, Math.min(1, e.score));
    num += s * ev.unexplored;
    den += s;
    pairs.push({ a: e.a, b: e.b, strength: s, observed: ev.observed, expected: ev.expected, unexplored: ev.unexplored, liftSmoothed: ev.liftSmoothed, warning: ev.warning });
  }
  pairs.sort((x, y) => y.strength * y.unexplored - x.strength * x.unexplored || y.strength - x.strength || (x.a + x.b < y.a + y.b ? -1 : 1));
  const packageNovelty = den > 0 ? num / den : 0;

  const raw = 100 * (NOVELTY_WEIGHTS.listDistance * listDistance + NOVELTY_WEIGHTS.connectedRarity * connectedRarity + NOVELTY_WEIGHTS.packageNovelty * packageNovelty);
  const noLists = !corpus.info || corpus.lists === 0;
  const partial = ids.length < SIZE;
  const unknown = noLists || partial;
  const novelty = unknown ? 0 : Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  const withheld = [
    corpus.withheld,
    partial ? `Novelty is computed for a full deck: ${ids.length} of ${SIZE} known cards, so no novelty band is claimed.` : null,
    noLists ? 'Without known lists novelty is not claimed (shown as 0, band unknown).' : null,
  ].filter((x): x is string => x !== null).join(' ') || null;
  return {
    novelty,
    band: unknown ? 'unknown' : bandOf(novelty),
    parts: { listDistance, connectedRarity, packageNovelty },
    nearest,
    rareCards,
    pairs,
    corpus: corpus.info,
    claimsWithheld: withheld,
  };
}
