import { describe, expect, it } from 'vitest';
import { createMetaIndex } from '@/engine/carddb';
import { parseDecklist } from '@/engine/io/decklist';
import { generateLines } from '@/engine/lines/lines';
import { detectPlans } from '@/engine/plans/detect';
import type { CardDb, Deck, Line, LineReport } from '@/engine/types';
import { deckNames, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx = { db, owned: null };
const deckOf = (ids: string[], name = 'test'): Deck => ({ id: null, name, format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' });
const reference = (name: string): Deck => deckOf(parseDecklist(deckText(name), db).cards, name);
const linesOf = (deck: Deck, d: CardDb = db): LineReport => generateLines(deck, { db: d, owned: null });
const all = (r: LineReport): Line[] => [...r.turns, ...r.assembly, ...r.sequencing, ...r.locations, ...r.packages, ...r.oneAway, ...r.field, ...r.tech, ...r.risks];
const bare: CardDb = { ...db, meta: () => createMetaIndex(null, [], []) };

const UNRELATED = ['Hawkeye', 'Medusa', 'Starlord', 'Gamora', 'Ironheart', 'MrFantastic', 'Klaw', 'Punisher', 'Spectrum', 'Cyclops', 'Wolfsbane', 'Elektra'];

function expectSane(deck: Deck, r: LineReport): void {
  const ids = new Set(deck.cards.map((c) => c.defId));
  for (const line of all(r)) {
    expect(line.cardIds.length, line.text).toBeGreaterThan(0);
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.reason.length, line.text).toBeGreaterThan(0);
    expect(['measured', 'derived', 'heuristic']).toContain(line.provenance);
    if (line.probability !== null) {
      expect(Number.isNaN(line.probability), line.text).toBe(false);
      expect(line.probability).toBeGreaterThanOrEqual(0);
      expect(line.probability).toBeLessThanOrEqual(1);
    }
    if (line.kind !== 'field' && line.kind !== 'tech') for (const id of line.cardIds) expect(ids.has(id), `${line.kind}: ${id} in "${line.text}"`).toBe(true);
    else for (const id of line.cardIds) expect(db.get(id), id).toBeDefined();
    expect(line.text).not.toMatch(/NaN|undefined|\{/);
  }
}

describe('generateLines on the six reference decks', () => {
  const reports = Object.fromEntries(deckNames().map((n) => [n, linesOf(reference(n))]));

  it('names only cards of the deck (field and tech lines may name others) and sets provenance', () => {
    for (const [name, r] of Object.entries(reports)) {
      expectSane(reference(name), r);
      expect(all(r).length, name).toBeGreaterThan(10);
    }
  });

  it('gives decks of different archetypes almost no shared line texts', () => {
    const names = Object.keys(reports);
    const rows: string[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = new Set(all(reports[names[i]!]!).map((l) => l.text));
        const b = new Set(all(reports[names[j]!]!).map((l) => l.text));
        const shared = [...a].filter((t) => b.has(t)).length / Math.min(a.size, b.size);
        rows.push(`${names[i]} x ${names[j]}: ${(shared * 100).toFixed(1)}%`);
        expect(shared, `${names[i]} x ${names[j]}`).toBeLessThan(0.15);
      }
    }
    console.log(`shared line texts\n${rows.join('\n')}`);
  });

  it('has turn lines for turns 1 to 6 with the probability of a play', () => {
    for (const [name, r] of Object.entries(reports)) {
      expect(r.turns.map((l) => l.text.match(/^Turn (\d)/)?.[1]), name).toEqual(['1', '2', '3', '4', '5', '6']);
      for (const l of r.turns) {
        expect(l.kind).toBe('turn');
        expect(l.probability).not.toBeNull();
        expect(l.provenance).toBe('derived');
      }
    }
    // Patriot's deck has no 1-Cost card: turn 1 has no play and says so.
    expect(reports.patriot!.turns[0]!.probability).toBe(0);
  });

  it('opens the assembly lines with the primary plan odds of detectPlans', () => {
    for (const [name, r] of Object.entries(reports)) {
      const primary = detectPlans(reference(name), ctx).primary!;
      expect(r.assembly[0]!.probability, name).toBeCloseTo(primary.assembly, 10);
      expect(r.assembly[0]!.text).toContain(primary.name);
      expect(r.assembly[0]!.text).toContain(`turn ${primary.keyTurn}`);
    }
  });

  it('names the top archetypes of the fixture meta with their share', () => {
    const top = [...db.meta().archetypes()].sort((a, b) => b.share - a.share).slice(0, 3);
    for (const r of Object.values(reports)) {
      expect(r.field.length).toBeGreaterThanOrEqual(3);
      for (const a of top) expect(r.field.some((l) => l.text.includes(a.name) && l.text.includes(`${(a.share * 100).toFixed(1)}%`)), a.name).toBe(true);
    }
  });

  it('proposes tech cards from outside the deck and what each would replace', () => {
    for (const [name, r] of Object.entries(reports)) {
      const ids = new Set(reference(name).cards.map((c) => c.defId));
      expect(r.tech.length, name).toBeGreaterThan(0);
      for (const l of r.tech) {
        expect(l.cardIds.some((id) => !ids.has(id)), l.text).toBe(true);
        expect(l.cardIds.some((id) => ids.has(id)), l.text).toBe(true);
        expect(l.text).toMatch(/ for /);
      }
    }
  });

  it('is deterministic', () => {
    expect(linesOf(reference('fantomex'))).toEqual(linesOf(reference('fantomex')));
  });
});

describe('assembly, sequencing, packages and risks', () => {
  it('changes the assembly odds when a redundant piece is removed', () => {
    const zombie = reference('zombie');
    const full = linesOf(zombie);
    const primary = detectPlans(zombie, ctx).primary!;
    expect(primary.enablers.length).toBeGreaterThan(1);
    const piece = primary.enablers[primary.enablers.length - 1]!;
    const without = deckOf(zombie.cards.map((c) => c.defId).filter((id) => id !== piece));
    const less = linesOf(without);
    expect(less.assembly[0]!.text).toContain(primary.name);
    expect(less.assembly[0]!.probability!).toBeLessThan(full.assembly[0]!.probability!);
    // The full deck's line for that piece names the substitutes and the lower odds.
    const pieceLine = full.assembly.find((l) => l.cardIds[0] === piece)!;
    expect(pieceLine.probability).toBeCloseTo(less.assembly[0]!.probability!, 10);
    for (const sub of primary.enablers.filter((id) => id !== piece)) expect(pieceLine.cardIds).toContain(sub);
  });

  it('orders an amplifier before its carrier at the same location (Joaquin Torres and Blade)', () => {
    const edge = db.edge('JoaquinTorres', 'Blade')!;
    expect(edge.sameLocation).toBe(true);
    const r = linesOf(deckOf(['JoaquinTorres', 'Blade', ...UNRELATED.slice(0, 10)]));
    const line = r.sequencing.find((l) => l.cardIds.includes('JoaquinTorres') && l.cardIds.includes('Blade'))!;
    expect(line).toBeDefined();
    expect(line.cardIds.slice(0, 2)).toEqual(['JoaquinTorres', 'Blade']);
    expect(line.text).toMatch(/same location/);
    expect(line.provenance).toBe('heuristic');
  });

  it('orders a carrier before an On Reveal repeater (Aurora, then Odin)', () => {
    const r = linesOf(deckOf(['Odin', 'Aurora', ...UNRELATED.slice(0, 10)]));
    const line = r.sequencing.find((l) => l.cardIds.includes('Odin') && l.cardIds.includes('Aurora'))!;
    expect(line).toBeDefined();
    expect(line.cardIds.slice(0, 2)).toEqual(['Aurora', 'Odin']);
  });

  it('reports single-card dependence, complete packages and plans one card away', () => {
    const r = linesOf(deckOf(['TheHunger', 'ZombieBlade', ...UNRELATED.slice(0, 10)]));
    expect(r.risks.some((l) => l.cardIds[0] === 'ZombieBlade' && /alone/.test(l.text))).toBe(true);
    expect(r.packages.some((l) => l.cardIds.includes('TheHunger') && l.cardIds.includes('ZombieBlade'))).toBe(true);

    const oneAway = linesOf(deckOf(['TheHunger', ...UNRELATED.slice(0, 11)]));
    const horde = oneAway.oneAway.find((l) => l.cardIds.includes('TheHunger'))!;
    expect(horde).toBeDefined();
    expect(horde.text).toMatch(/one card away/);
    expect(horde.probability).toBeGreaterThan(0);
  });

  it('names net-negative pairs as risks', () => {
    const r = linesOf(reference('fantomex'));
    const anti = r.risks.filter((l) => /work against each other/.test(l.text));
    expect(anti.length).toBeGreaterThan(0);
    for (const l of anti) expect(db.edge(l.cardIds[0]!, l.cardIds[1]!)!.score).toBeLessThan(0);
  });

  it('says when no plan reaches the threshold', () => {
    const r = linesOf(deckOf(UNRELATED));
    expect(r.risks.some((l) => /No plan/.test(l.text))).toBe(true);
    expectSane(deckOf(UNRELATED), r);
  });
});

describe('thin meta and odd decks', () => {
  it('leaves field and tech empty without meta and still gives the other lines', () => {
    const deck = reference('zombie');
    const r = linesOf(deck, bare);
    expect(r.field).toEqual([]);
    expect(r.tech).toEqual([]);
    expect(r.turns).toHaveLength(6);
    expect(r.assembly.length).toBeGreaterThan(0);
    expectSane(deck, r);
  });

  it('never throws or returns NaN on empty, partial, oversized or unknown-card decks', () => {
    const sixes = db.released().filter((c) => c.cost === 6 && !c.isSkill).slice(0, 12).map((c) => c.defId);
    const zombie = reference('zombie').cards.map((c) => c.defId);
    const decks = [[], zombie.slice(0, 5), sixes, [...zombie, 'Hawkeye'], [...zombie.slice(0, 11), 'NoSuchCard'], ['NoSuchCard'], [...zombie.slice(0, 3), ...zombie.slice(0, 3)]];
    for (const ids of decks) {
      for (const d of [db, bare]) {
        const deck = deckOf(ids);
        const r = linesOf(deck, d);
        expectSane(deck, r);
        for (const l of all(r)) expect(l.cardIds).not.toContain('NoSuchCard');
      }
    }
    expect(all(linesOf(deckOf([])))).toEqual([]);
    expect(linesOf(deckOf(sixes)).turns).toHaveLength(6);
  });
});
