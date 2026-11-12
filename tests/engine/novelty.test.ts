import { describe, expect, it } from 'vitest';
import { createMetaIndex } from '@/engine/carddb';
import { corpusOf, NEW_CARD_MS, unexplored, wilsonUpper } from '@/engine/novelty/clusters';
import { gemsFor, gemsNear, TRIPLE_DISCOUNT } from '@/engine/novelty/gems';
import { noveltyOf } from '@/engine/novelty/novelty';
import type { CardDb, Deck } from '@/engine/types';
import { fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx = { db, owned: null };
const deckOf = (ids: string[], d: Partial<Deck> = {}): Deck => ({ id: null, name: 't', format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'brew', ...d });
const lists = db.meta().lists();
const top = lists[0]!;
const share = (id: string): number => db.meta().cardStat(id)?.listShare ?? 0;
const unplayed = db.released().map((c) => c.defId).filter((id) => share(id) === 0).sort();

describe('Wilson bound and unexplored factor (theory §4.4)', () => {
  it('reproduces 0.11 at 300 clusters and 0.73 at 1,000 with nothing observed', () => {
    expect(wilsonUpper(0, 300)).toBeCloseTo(0.0089, 3);
    expect(unexplored(0, 300)).toBeCloseTo(0.11, 1);
    expect(Math.abs(unexplored(0, 300) - 0.11)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(unexplored(0, 1000) - 0.73)).toBeLessThanOrEqual(0.02);
    expect(unexplored(0, 100)).toBe(0);
    expect(unexplored(0, 3000)).toBeGreaterThan(0.89);
  });

  it('is bounded and never NaN', () => {
    for (const [k, n] of [[0, 0], [5, 3], [-1, 10], [Number.NaN, 10], [3, Number.NaN]] as const) {
      const w = wilsonUpper(k, n);
      expect(Number.isNaN(w)).toBe(false);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
    expect(unexplored(10, 300)).toBe(0);
  });
});

describe('noveltyOf', () => {
  it('scores an exact copy of a fixture list under 15, band meta, with that list nearest', () => {
    const r = noveltyOf(deckOf([...top.cards]), ctx);
    expect(r.novelty).toBeLessThan(15);
    expect(r.band).toBe('meta');
    expect(r.nearest[0]!.key).toBe(top.key);
    expect(r.nearest[0]!.shared).toBe(12);
    expect(r.parts.listDistance).toBe(0);
    expect(r.corpus?.lists).toBe(300);
  });

  it('calls the list with two swaps a meta copy or variant and names the original with 10 shared', () => {
    const swapped = [...top.cards.slice(2), unplayed[0]!, unplayed[1]!];
    const r = noveltyOf(deckOf(swapped), ctx);
    expect(['meta', 'variant']).toContain(r.band);
    expect(r.nearest[0]!.key).toBe(top.key);
    expect(r.nearest[0]!.shared).toBe(10);
    expect(r.nearest.length).toBeLessThanOrEqual(3);
  });

  it('gives a pile of rare unconnected cards connectedRarity 0', () => {
    const pile: string[] = [];
    for (const id of unplayed) {
      if (pile.length === 12) break;
      if ((db.features(id)?.techRoles.length ?? 0) > 0) continue;
      if (pile.some((p) => db.edge(p, id)?.strong)) continue;
      pile.push(id);
    }
    expect(pile).toHaveLength(12);
    const r = noveltyOf(deckOf(pile), ctx);
    expect(r.parts.connectedRarity).toBe(0);
    expect(r.parts.packageNovelty).toBe(0);
    expect(r.rareCards).toHaveLength(12);
    expect(r.rareCards.every((c) => !c.connected && c.listShare === 0)).toBe(true);
    expect(r.pairs).toEqual([]);
  });

  it('flags cards released within 14 days of db.now as new', () => {
    const fresh = db.released().filter((c) => c.releaseAt !== null && db.now - c.releaseAt >= 0 && db.now - c.releaseAt <= NEW_CARD_MS);
    expect(fresh.length).toBeGreaterThan(0);
    const old = unplayed.filter((id) => { const c = db.get(id)!; return c.releaseAt === null || db.now - c.releaseAt > NEW_CARD_MS; })[0]!;
    const r = noveltyOf(deckOf([fresh[0]!.defId, old]), ctx);
    expect(r.rareCards.find((c) => c.defId === fresh[0]!.defId)?.isNew).toBe(true);
    expect(r.rareCards.find((c) => c.defId === old)?.isNew).toBe(false);
  });

  it('counts pair evidence in clusters, not raw lists', () => {
    const corpus = corpusOf(db);
    expect(corpus.clusters).toBe(new Set(lists.map((l) => l.cluster)).size);
    let differ = 0;
    for (const l of lists.slice(0, 60)) {
      const r = noveltyOf(deckOf([...l.cards]), ctx);
      for (const p of r.pairs) {
        const stat = db.meta().pair(p.a, p.b);
        expect(p.observed).toBe(stat.clusters);
        if (stat.lists > stat.clusters) differ++;
        expect(p.expected).toBeCloseTo((corpus.cardClusters(p.a) * corpus.cardClusters(p.b)) / corpus.clusters, 6);
      }
    }
    expect(differ).toBeGreaterThan(0);
  });

  it('withholds unexplored claims on the 208-cluster fixture and without meta, never throwing', () => {
    expect(noveltyOf(deckOf([...top.cards]), ctx).claimsWithheld).toMatch(/clusters/);
    const bare: CardDb = { ...db, meta: () => createMetaIndex(null, [], []) };
    for (const ids of [[], [...top.cards], unplayed.slice(0, 5)]) {
      const r = noveltyOf(deckOf(ids), { db: bare, owned: null });
      expect(r.claimsWithheld).toMatch(/No meta snapshot/);
      expect(r.corpus).toBeNull();
      expect(r.nearest).toEqual([]);
      expect(Number.isNaN(r.novelty)).toBe(false);
      for (const p of r.pairs) expect(p.unexplored).toBe(0);
    }
  });

  it('handles empty, partial and odd decks', () => {
    const empty = noveltyOf(deckOf([]), ctx);
    expect(empty.novelty).toBeGreaterThanOrEqual(0);
    expect(empty.parts.packageNovelty).toBe(0);
    const odd = noveltyOf(deckOf(['NotACard', top.cards[0]!, top.cards[0]!]), ctx);
    expect(Number.isFinite(odd.novelty)).toBe(true);
    const sixes = db.released().filter((c) => c.cost === 6).slice(0, 12).map((c) => c.defId);
    expect(Number.isFinite(noveltyOf(deckOf(sixes), ctx).novelty)).toBe(true);
  });
});

describe('gems', () => {
  const gems = gemsFor(db, 100000);

  it('covers every strong edge of released cards, best first, with triples discounted', () => {
    const pairs = gems.filter((g) => g.cards.length === 2);
    const released = new Set(db.released().map((c) => c.defId));
    let strong = 0;
    for (const id of released) for (const e of db.edges(id)) if (e.strong && e.a === id && e.a !== e.b && released.has(e.b)) strong++;
    expect(pairs).toHaveLength(strong);
    for (let i = 1; i < gems.length; i++) expect(gems[i - 1]!.gem).toBeGreaterThanOrEqual(gems[i]!.gem);
    const triples = gems.filter((g) => g.cards.length === 3);
    expect(triples.length).toBeGreaterThan(0);
    for (const t of triples.slice(0, 50)) {
      expect(t.reason).toContain(`x${TRIPLE_DISCOUNT}`);
      const [a, b, c] = t.cards as [string, string, string];
      expect(Math.min(db.edge(a, b)?.score ?? 0, db.edge(a, c)?.score ?? 0, db.edge(b, c)?.score ?? 0)).toBeCloseTo(t.strength, 6);
    }
    for (const g of gems.slice(0, 20)) {
      expect(g.reason).toContain(db.get(g.cards[0]!)!.name);
      expect(Number.isFinite(g.gem)).toBe(true);
    }
  });

  it('is 0 for every gem on a corpus too thin to call anything unexplored', () => {
    expect(corpusOf(db).clusters).toBeLessThan(300);
    expect(gems.every((g) => g.unexplored === 0 && g.gem === 0)).toBe(true);
  });

  it('gemsNear lists gems the deck completes with one addable card', () => {
    const deck = deckOf([...top.cards]);
    const near = gemsNear(deck, ctx, 20);
    expect(near.length).toBeGreaterThan(0);
    for (const g of near) {
      const missing = g.cards.filter((c) => !top.cards.includes(c));
      expect(missing).toHaveLength(1);
      expect(db.get(missing[0]!)!.cardClass).toBe('released');
    }
    expect(gemsNear(deckOf([]), ctx)).toEqual([]);
  });
});
