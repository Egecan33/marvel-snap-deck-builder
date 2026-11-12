import { describe, expect, it } from 'vitest';
import { createMetaIndex } from '@/engine/carddb';
import { AXIS_BY_ID } from '@/engine/features/axes';
import { TECH_ROLES } from '@/engine/features/tech';
import { parseDecklist } from '@/engine/io/decklist';
import { pAtLeastOne, pOneOfEach } from '@/engine/maths/hypergeo';
import { atomsOf, checkPlans, detectPlans, drawAdjust, foldInfo, PLAN_THRESHOLD } from '@/engine/plans/detect';
import type { CardDb, Deck, PlanReport } from '@/engine/types';
import { deckNames, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx = { db, owned: null };
const deckOf = (ids: string[], name = 'test'): Deck => ({ id: null, name, format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' });
const reference = (name: string): Deck => deckOf(parseDecklist(deckText(name), db).cards, name);
const plansOf = (deck: Deck, d: CardDb = db): PlanReport => detectPlans(deck, { db: d, owned: null });

// Twelve self-contained cards (own buffs, location buffs, one vanilla): no family of plans.json.
const UNRELATED = ['Hawkeye', 'Medusa', 'Starlord', 'Gamora', 'Ironheart', 'MrFantastic', 'Klaw', 'Punisher', 'Spectrum', 'Cyclops', 'Wolfsbane', 'Elektra'];

describe('sync-data/plans.json', () => {
  const plans = db.plans();

  it('holds the 18 families of theory §2, plus unspent-energy (engine review), and is well-formed', () => {
    // unspent-energy was added after the engine review (2026-11-13) from the mechanics §4 axis of the same name:
    // without it Sunspot and Bruce Banner were "built around" inside Move decks that did not use them.
    expect(plans).toHaveLength(19);
    expect(plans.filter((p) => p.id !== 'unspent-energy')).toHaveLength(18);
    expect(checkPlans(plans, TECH_ROLES.map((r) => r.id))).toEqual([]);
  });

  it('uses trait ids that traitsOf emits and axis ids that exist', () => {
    const emitted = new Set<string>();
    for (const c of db.released()) for (const t of db.features(c.defId)?.traits ?? []) emitted.add(t);
    for (const p of plans) {
      for (const a of atomsOf(p)) {
        if (a.startsWith('axis:')) expect(AXIS_BY_ID.has(a.slice(5).split('.')[0]!), `${p.id} ${a}`).toBe(true);
        else if (!/^(role|cost|power|creates):/.test(a)) expect(emitted.has(a), `${p.id} ${a}`).toBe(true);
      }
    }
  });
});

describe('detectPlans on the six reference decks', () => {
  const reports = Object.fromEntries(deckNames().map((n) => [n, plansOf(reference(n))]));

  it('gives every deck a primary plan built from its own cards', () => {
    for (const [name, r] of Object.entries(reports)) {
      expect(r.primary, name).not.toBeNull();
      const ids = new Set(reference(name).cards.map((c) => c.defId));
      for (const id of [...r.primary!.enablers, ...r.primary!.payoffs]) expect(ids.has(id), `${name} ${id}`).toBe(true);
      expect(r.primary!.assembly).toBeGreaterThanOrEqual(PLAN_THRESHOLD);
      expect(r.primary!.takesLocations).not.toMatch(/\{(enablers|payoffs)\}/);
      for (const id of r.primary!.payoffs) expect(r.primary!.takesLocations).toContain(db.get(id)!.name);
    }
  });

  it('finds at least four different primary plans, the expected one per archetype', () => {
    const primaries = Object.fromEntries(Object.entries(reports).map(([n, r]) => [n, r.primary?.planId]));
    expect(new Set(Object.values(primaries)).size).toBeGreaterThanOrEqual(4);
    expect(primaries).toMatchObject({ zombie: 'horde', fantomex: 'destroy', magneto: 'put-into-play', patriot: 'no-ability' });
  });

  it('computes assembly as pOneOfEach of the counts found by the key turn', () => {
    for (const [name, r] of Object.entries(reports)) {
      for (const m of r.all) {
        const { extra, deckSize } = drawAdjust(reference(name), db, m.keyTurn);
        const expected = m.enablers.length === 0
          ? pAtLeastOne(m.payoffs.length, m.keyTurn, extra, deckSize)
          : m.payoffs.length === 0 ? pAtLeastOne(m.enablers.length, m.keyTurn, extra, deckSize)
            : pOneOfEach(m.enablers.length, m.payoffs.length, m.keyTurn, extra, deckSize);
        expect(m.assembly, `${name} ${m.planId}`).toBeCloseTo(expected, 10);
        expect(m.strength).toBeCloseTo(m.assembly * db.plans().find((p) => p.id === m.planId)!.payoffWeight, 10);
      }
    }
    const z = reports.zombie!.primary!;
    expect(z.assembly).toBeCloseTo(pOneOfEach(z.enablers.length, z.payoffs.length, 6), 10);
  });

  it('keeps enablers and payoffs disjoint and lists the rest as off-plan', () => {
    for (const [name, r] of Object.entries(reports)) {
      for (const m of r.all) expect(m.enablers.filter((id) => m.payoffs.includes(id)), name).toEqual([]);
      const on = new Set([r.primary, r.secondary].flatMap((m) => (m ? [...m.enablers, ...m.payoffs] : [])));
      expect([...on, ...r.offPlan].sort()).toEqual([...new Set(reference(name).cards.map((c) => c.defId))].sort());
    }
  });
});

describe('single-card dependence, folds, and odd decks', () => {
  it('reports the payoff when a plan rests on one enabler and one payoff', () => {
    const r = plansOf(deckOf(['TheHunger', 'ZombieBlade', ...UNRELATED.slice(0, 10)]));
    const horde = r.all.find((m) => m.planId === 'horde')!;
    expect(horde.enablers).toEqual(['TheHunger']);
    expect(horde.payoffs).toEqual(['ZombieBlade']);
    expect(horde.singleCardDependence).toBe('ZombieBlade');
    expect(horde.assembly).toBeCloseTo(pOneOfEach(1, 1, 6), 10);
    expect(horde.assembly).toBeLessThan(0.75);
    expect(plansOf(reference('zombie')).primary!.singleCardDependence).toBeNull();
  });

  it('takes fold field shares from meta lists, and null without meta', () => {
    const r = plansOf(reference('zombie'));
    const reset = r.primary!.foldsTo.find((f) => f.role === 'power-reset')!;
    expect(reset.cards).toContain('ShadowKing');
    const holders = db.released().filter((c) => db.features(c.defId)?.techRoles.includes('power-reset')).map((c) => c.defId);
    const covered = new Set(holders.flatMap((id) => [...db.meta().listsWith(id)]));
    expect(reset.fieldShare).toBeCloseTo(covered.size / db.meta().lists().length, 10);
    expect(reset.fieldShare!).toBeGreaterThan(db.meta().cardStat('ShadowKing')!.listShare - 1e-9);

    const bare: CardDb = { ...db, meta: () => createMetaIndex(null, [], []) };
    expect(foldInfo(bare, 'power-reset').fieldShare).toBeNull();
    for (const f of plansOf(reference('zombie'), bare).primary!.foldsTo) expect(f.fieldShare).toBeNull();
  });

  it('finds no plan in twelve unrelated cards', () => {
    const r = plansOf(deckOf(UNRELATED));
    expect(r.primary).toBeNull();
    expect(r.secondary).toBeNull();
    expect(r.offPlan).toHaveLength(12);
  });

  it('never throws or returns NaN on empty, partial, oversized or unknown-card decks', () => {
    const sixes = db.released().filter((c) => c.cost === 6 && !c.isSkill).slice(0, 12).map((c) => c.defId);
    const zombie = reference('zombie').cards.map((c) => c.defId);
    const decks = [[], zombie.slice(0, 5), sixes, [...zombie, 'Hawkeye'], [...zombie.slice(0, 11), 'NoSuchCard'], ['NoSuchCard']];
    for (const ids of decks) {
      const r = plansOf(deckOf(ids));
      for (const m of r.all) {
        expect(Number.isNaN(m.assembly) || Number.isNaN(m.strength)).toBe(false);
        expect(m.assembly).toBeGreaterThanOrEqual(0);
        expect(m.assembly).toBeLessThanOrEqual(1);
      }
      expect(r.offPlan).not.toContain('NoSuchCard');
    }
    expect(plansOf(deckOf([])).primary).toBeNull();
  });
});
