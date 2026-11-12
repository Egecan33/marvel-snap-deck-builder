import { describe, expect, it } from 'vitest';
import { createScorer } from '@/engine/scoring/scorer';
import type { Card, Deck } from '@/engine/types';
import { fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx = { db, owned: null };
const deckOf = (ids: string[], d: Partial<Deck> = {}): Deck => ({ id: null, name: 't', format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned', ...d });
const top = [...db.meta().lists()[0]!.cards];
const share = (id: string): number => db.meta().cardStat(id)?.listShare ?? 0;
const q = (id: string): number => db.features(id)?.quality ?? 0;
const strongInto = (id: string, ids: string[]): number => ids.filter((x) => x !== id && db.edge(id, x)?.strong).length;
const anyEdge = (id: string, ids: string[]): boolean => ids.some((x) => x !== id && (db.edge(id, x)?.score ?? 0) !== 0);

describe('gates (spec §11)', () => {
  const s = createScorer(deckOf(top), ctx);
  const gated = (c: Card | undefined, code: string, scorer = s) => {
    const r = scorer.score(c!);
    expect(r.gate?.code).toBe(code);
    expect(r.score).toBe(0);
    expect(r.reasons[0]).toBe(r.gate!.message);
  };

  it('unknown, not deckable, unreleased', () => {
    gated({ ...db.released()[0]!, defId: 'NoSuchCard', name: 'No Such Card' }, 'UNKNOWN_CARD');
    gated(db.all().find((c) => c.cardClass === 'token'), 'NOT_DECKABLE');
    gated(db.all().find((c) => c.cardClass === 'upcoming'), 'UNRELEASED');
  });

  it('already in the deck: a second copy is gated, the first is scored leave-one-out', () => {
    const withDup = createScorer(deckOf([...top, top[0]!]), ctx);
    gated(db.get(top[0]!), 'IN_DECK', withDup);
    expect(s.score(db.get(top[0]!)!).gate).toBeNull();
  });

  it('banned in the mode, not owned', () => {
    gated(db.get('Debrii'), 'MODE_BANNED', createScorer(deckOf(top, { format: 'sanctum-showdown' }), ctx));
    expect(createScorer(deckOf(top), ctx).score(db.get('Debrii')!).gate).toBeNull();
    const owned = Object.fromEntries(top.map((id) => [id, true as const]));
    const out = db.released().find((c) => !owned[c.defId])!;
    gated(out, 'NOT_OWNED', createScorer(deckOf(top), { db, owned }));
  });
});

describe('createScorer', () => {
  it('scores a card with two strong edges into the deck at least 10 above a similar-quality card with none', () => {
    const outside = db.released().filter((c) => !top.includes(c.defId) && !c.isSkill);
    const linked = outside.filter((c) => strongInto(c.defId, top) >= 2 && !top.some((x) => (db.edge(c.defId, x)?.score ?? 0) < 0));
    const loose = outside.filter((c) => !anyEdge(c.defId, top));
    expect(linked.length).toBeGreaterThan(0);
    const s = createScorer(deckOf(top), ctx);
    let pairs = 0;
    for (const a of linked) {
      const b = loose.filter((x) => Math.abs(q(x.defId) - q(a.defId)) <= 3 && x.cost === a.cost)[0];
      if (!b) continue;
      const sa = s.score(a);
      const sb = s.score(b);
      expect(sa.score - sb.score, `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(10);
      expect(sa.partners.filter((p) => p.score >= 0.5).length).toBeGreaterThanOrEqual(2);
      pairs++;
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('lowers the score for an anti-synergy partner and names it', () => {
    const released = db.released().map((c) => c.defId).sort();
    let found = false;
    for (const x of released) {
      const e = db.edges(x).find((ed) => ed.score < 0 && ed.a !== ed.b && db.get(ed.a === x ? ed.b : ed.a)?.cardClass === 'released');
      const z0 = db.edges(x).find((ed) => ed.score >= 0.3 && ed.a !== ed.b && db.get(ed.a === x ? ed.b : ed.a)?.cardClass === 'released');
      if (!e || !z0) continue;
      const y = e.a === x ? e.b : e.a;
      const z = z0.a === x ? z0.b : z0.a;
      const filler = released.filter((id) => id !== x && id !== y && id !== z && !db.edge(x, id)).slice(0, 4);
      const without = createScorer(deckOf([z, ...filler]), ctx).score(db.get(x)!);
      const withY = createScorer(deckOf([z, ...filler, y]), ctx).score(db.get(x)!);
      const synW = withY.parts.find((p) => p.key === 'synergy')!.points;
      const synO = without.parts.find((p) => p.key === 'synergy')!.points;
      expect(synW).toBeLessThan(synO);
      expect(withY.reasons.join(' ')).toContain(db.get(y)!.name);
      expect(withY.reasons.join(' ')).toMatch(/Anti-synergy/);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('scores in-deck cards leave-one-out: equal to scoring against the deck without them', () => {
    const s = createScorer(deckOf(top), ctx);
    for (const id of top.slice(0, 6)) {
      const loo = createScorer(deckOf(top.filter((x) => x !== id)), ctx).score(db.get(id)!);
      expect(s.score(db.get(id)!)).toEqual(loo);
    }
  });

  it('keeps parts summing to the score (within 1), every part within its max, and at least one reason', () => {
    for (const d of [deckOf(top), deckOf(top, { buildMode: 'brew' }), deckOf(top.slice(0, 5)), deckOf([])]) {
      for (const r of createScorer(d, ctx).scoreAll().slice(0, 120)) {
        const sum = r.parts.reduce((s, p) => s + p.points, 0);
        expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(1);
        for (const p of r.parts) {
          expect(p.points).toBeGreaterThanOrEqual(0);
          expect(p.points).toBeLessThanOrEqual(p.max);
        }
        expect(r.reasons.length).toBeGreaterThanOrEqual(1);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('brew mode: a rare card with no strong edge into the deck gets 0 novelty points', () => {
    const s = createScorer(deckOf(top, { buildMode: 'brew' }), ctx);
    const rare = db.released().find((c) => share(c.defId) === 0 && strongInto(c.defId, top) === 0)!;
    const r = s.score(rare);
    expect(r.parts.find((p) => p.key === 'novelty')!.points).toBe(0);
    expect(r.parts.some((p) => p.key === 'meta')).toBe(false);
    const linkedRare = db.released().find((c) => share(c.defId) < 0.02 && !top.includes(c.defId) && strongInto(c.defId, top) > 0);
    if (linkedRare) expect(s.score(linkedRare).parts.find((p) => p.key === 'novelty')!.points).toBeGreaterThan(0);
  });

  it('tuned mode uses the meta part: a card of the nearest lists outscores an unplayed one on it', () => {
    const s = createScorer(deckOf(top.slice(0, 11)), ctx);
    const inList = s.score(db.get(top[11]!)!);
    const unplayed = s.score(db.released().find((c) => share(c.defId) === 0)!);
    const meta = (r: typeof inList) => r.parts.find((p) => p.key === 'meta')!.points;
    expect(meta(inList)).toBeGreaterThan(meta(unplayed));
    expect(meta(inList)).toBeGreaterThan(5);
    expect(inList.reasons.join(' ')).toMatch(/closest meta lists/);
  });

  it('does not throw on an empty, partial or odd deck', () => {
    for (const ids of [[], top.slice(0, 5), ['NotACard', top[0]!], db.released().filter((c) => c.cost === 6).slice(0, 12).map((c) => c.defId)]) {
      const all = createScorer(deckOf(ids), ctx).scoreAll();
      expect(all.length).toBe(db.released().length);
      for (const r of all) expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('scores the released pool in under 400 ms', () => {
    const deck = deckOf(top.slice(0, 10).concat(['Hawkeye']));
    createScorer(deckOf(top.slice(0, 3)), ctx).scoreAll(); // warm module-level caches once
    const t0 = performance.now();
    const all = createScorer(deck, ctx).scoreAll();
    const ms = performance.now() - t0;
    expect(all.length).toBe(db.released().length);
    expect(ms).toBeLessThan(400);
  });
});
