import { describe, expect, it } from 'vitest';
import { energyModel, energySignature } from '@/engine/maths/energy';
import { cardsSeen, pAll, pAtLeastOne, pOneOfEach } from '@/engine/maths/hypergeo';
import { mulberry32 } from '@/engine/maths/rng';
import type { Card, CardDb, Deck } from '@/engine/types';
import { fixtureDb } from '../helpers/fixture-db';

// Exact values: docs/research/deck-theory-and-creativity.md §1.2 (table and script table A5).
describe('draw maths (theory §1.2)', () => {
  it('counts cards seen as 3 + turn (+ extra)', () => {
    expect(cardsSeen(1)).toBe(4);
    expect(cardsSeen(6)).toBe(9);
    expect(cardsSeen(6, 2)).toBe(11);
  });

  it('reproduces the turn-6 table', () => {
    expect(pAtLeastOne(1, 6)).toBeCloseTo(0.75, 4);
    expect(pAll(2, 6)).toBeCloseTo(0.5455, 4);
    expect(pAll(3, 6)).toBeCloseTo(0.3818, 4);
    expect(pOneOfEach(2, 2, 6)).toBeCloseTo(0.9091, 4);
    expect(pAtLeastOne(2, 1)).toBeCloseTo(0.5758, 4);
  });

  it('reproduces the other table rows', () => {
    expect(pAtLeastOne(3, 1)).toBeCloseTo(0.745, 3);
    expect(pAtLeastOne(4, 2)).toBeCloseTo(0.929, 3);
    expect(pOneOfEach(1, 2, 6)).toBeCloseTo(0.709, 3);
    expect(pOneOfEach(2, 3, 4)).toBeCloseTo(0.804, 3);
    expect(pOneOfEach(3, 3, 1)).toBeCloseTo(0.521, 3);
    expect(pAll(2, 7)).toBeCloseTo(0.682, 3);
  });

  it('reproduces one extra card seen by turn 6 (table A5)', () => {
    expect(pAtLeastOne(1, 6, 1)).toBeCloseTo(0.8333, 4);
    expect(pAll(2, 6, 1)).toBeCloseTo(0.6818, 4);
    expect(pAll(3, 6, 1)).toBeCloseTo(0.5455, 4);
    expect(pAll(3, 6, 3)).toBeCloseTo(1, 6);
  });

  it('stays in [0, 1] and never returns NaN for odd input', () => {
    const odd = [
      pAtLeastOne(0, 6), pAtLeastOne(13, 6), pAtLeastOne(-1, 3), pAtLeastOne(2, 6, 0, 0), pAtLeastOne(2, 6, 0, 5),
      pAll(0, 6), pAll(12, 6), pAll(20, 6), pAll(2, 0), pOneOfEach(0, 3, 6), pOneOfEach(8, 8, 6), pOneOfEach(2, 2, 6, 0, 3),
      pOneOfEach(2, 2, 6, 10, 12), pAtLeastOne(1, 6, 0, 20),
    ];
    for (const v of odd) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(pAtLeastOne(0, 6)).toBe(0);
    expect(pAll(0, 6)).toBe(1);
    expect(pOneOfEach(0, 3, 6)).toBe(0);
    expect(pAtLeastOne(1, 6, 0, 20)).toBeCloseTo(9 / 20, 6);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a seed and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

/** A database of vanilla cards (no features) for curve tests: one card per entry of `costs`. */
function curveDb(curve: number[]): { db: CardDb; deck: Deck } {
  const cards: Card[] = [];
  curve.forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      cards.push({
        defId: `C${i + 1}_${k}`, name: `Cost ${i + 1} #${k}`, cost: i + 1, power: i + 1, text: '', rawText: '', hasAbility: false,
        isSkill: false, isSeasonPass: false, series: 1, seriesLabel: 'Series 1', releaseAt: null, cardClass: 'released', tokens: [], attributes: {},
      });
    }
  });
  const byId = new Map(cards.map((c) => [c.defId, c]));
  const db = {
    now: 0, get: (id: string) => byId.get(id), byName: () => undefined, released: () => cards, all: () => cards,
    features: () => undefined, edges: () => [], edge: () => undefined, formats: () => [], plans: () => [],
    meta: () => ({ info: () => null, lists: () => [], listsWith: () => [], cardStat: () => undefined, pair: () => ({ lists: 0, clusters: 0 }), archetypes: () => [] }),
  } as CardDb;
  const deck: Deck = { id: null, name: 'curve', format: 'ranked', cards: cards.map((c) => ({ defId: c.defId, locked: false })), themes: [], buildMode: 'tuned' };
  return { db, deck };
}

// Values: theory §1.3 (greedy policy, printed costs only, 20,000 games). Tolerance ±0.15 per the plan.
describe('energy model (theory §1.3)', () => {
  const cases: [number[], number, number[]][] = [
    [[2, 4, 3, 2, 1, 0], 20.28, [0.427, 0.037, 0]],
    [[0, 0, 2, 3, 4, 3], 17.21, [1, 1, 0.23]],
    [[6, 6, 0, 0, 0, 0], 13.5, [0.03, 0, 0]],
  ];
  for (const [curve, spent, noPlay] of cases) {
    it(`curve ${curve.join(',')} spends about ${spent} of 21`, () => {
      const { db, deck } = curveDb(curve);
      const r = energyModel(deck, db, 7, 4000);
      expect(Math.abs(r.expectedSpent - spent)).toBeLessThanOrEqual(0.15);
      for (let t = 1; t <= 3; t++) expect(Math.abs(r.pNoPlay[t]! - noPlay[t - 1]!)).toBeLessThanOrEqual(0.03);
      expect(r.curve.slice(1, 7)).toEqual(curve);
      expect(r.pNoPlay).toHaveLength(7);
      expect(r.likelyPlays).toHaveLength(7);
    });
  }

  it('is deterministic for a seed and names deck cards as likely plays', () => {
    const { db, deck } = curveDb([2, 4, 3, 2, 1, 0]);
    const a = energyModel(deck, db, 11, 1000);
    const b = energyModel({ ...deck, cards: [...deck.cards].reverse() }, db, 11, 1000);
    expect(b).toEqual(a);
    expect(a.avgCost).toBeCloseTo(32 / 12, 6);
    const ids = new Set(deck.cards.map((c) => c.defId));
    for (let t = 1; t <= 6; t++) for (const id of a.likelyPlays[t]!) expect(ids.has(id)).toBe(true);
    expect(a.likelyPlays[1]!.every((id) => db.get(id)!.cost === 1)).toBe(true);
  });

  it('returns zeros for an empty deck without throwing', () => {
    const { db } = curveDb([]);
    const r = energyModel({ id: null, name: '', format: 'ranked', cards: [], themes: [], buildMode: 'tuned' }, db);
    expect(r.expectedSpent).toBe(0);
    expect(r.avgCost).toBe(0);
    expect(r.curve).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    for (let t = 1; t <= 6; t++) expect(r.pNoPlay[t]).toBe(1);
  });

  it('handles partial and odd decks: 5 cards, twelve 6-drops, unknown cards', () => {
    const db = fixtureDb();
    const six = db.released().filter((c) => c.cost === 6 && !c.isSkill).slice(0, 12);
    const deckOf = (ids: string[]): Deck => ({ id: null, name: '', format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' });
    const sixes = energyModel(deckOf(six.map((c) => c.defId)), db, 3, 500);
    expect(sixes.pNoPlay[5]).toBe(1);
    expect(sixes.curve[6]).toBe(12);
    const partial = energyModel(deckOf(six.slice(0, 2).map((c) => c.defId).concat(['NoSuchCard'])), db, 3, 500);
    for (const v of [partial.expectedSpent, partial.avgCost, ...partial.pNoPlay]) expect(Number.isNaN(v)).toBe(false);
    expect(partial.curve.reduce((s, n) => s + n, 0)).toBe(2);
  });

  it('caches by cost signature', () => {
    const { db, deck } = curveDb([2, 4, 3, 2, 1, 0]);
    const other = curveDb([2, 4, 3, 2, 1, 0]);
    expect(energySignature(deck, db)).toBe(energySignature(other.deck, other.db));
    expect(energySignature(deck, db)).not.toBe(energySignature(curveDb([2, 4, 3, 2, 0, 1]).deck, curveDb([2, 4, 3, 2, 0, 1]).db));
  });
});
