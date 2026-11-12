import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attributeMismatches, coverage, type ParsedEntry } from '@/engine/text/coverage';
import { applyOverrides, loadOverrides } from '@/engine/text/overrides';
import { parseCard } from '@/engine/text/parse';
import { card, fixtureDb } from '../../helpers/fixture-db';

const overrides = loadOverrides(JSON.parse(readFileSync(fileURLToPath(new URL('../../../sync-data/card-overrides.json', import.meta.url)), 'utf8')));

describe('attribute cross-check', () => {
  it('agrees when the parsed magnitude equals the structured attribute', () => {
    // Blue Marvel: "Ongoing: Your other cards have +1 Power." with AddedPower 1
    const c = card('BlueMarvel');
    expect(c.attributes.AddedPower).toBe(1);
    expect(attributeMismatches(c, parseCard(c).clauses)).toEqual([]);
  });

  it('reports an attribute the text does not carry', () => {
    // Kingpin: "When an enemy card moves here, afflict it with -2 Power." but the source writes AddedPower 2
    const c = card('Kingpin');
    expect(attributeMismatches(c, parseCard(c).clauses)).toEqual(['AddedPower=2 but parsed no buff/horde/loc_power']);
  });

  it('reports a magnitude that disagrees, and tokens no parsed effect creates', () => {
    const zabu = card('Zabu'); // "Give each 4-Cost card in your deck -1 Cost." ReducedCost 1
    expect(attributeMismatches({ ...zabu, attributes: { ...zabu.attributes, ReducedCost: 2 } }, parseCard(zabu).clauses)).toEqual(['ReducedCost=2 but parsed cost_reduce 1']);
    const korg = card('Korg'); // "Shuffle a Rock into your opponent's deck." Card_Token Rock
    expect(attributeMismatches(korg, parseCard(korg).clauses)).toEqual([]);
    expect(attributeMismatches(korg, [])).toEqual(['creates Rock (Card_Token) but no effect that adds a card was parsed']);
  });
});

describe('coverage of the fixture pool', () => {
  const db = fixtureDb();
  const released = db.released();
  const parsedById: Record<string, ParsedEntry> = {};
  for (const c of released) parsedById[c.defId] = applyOverrides(c, parseCard(c), overrides);

  it('every released card has a clause with an effect, or no ability, or a reviewed override', () => {
    const r = coverage(released, parsedById);
    expect(r.noClause).toEqual([]);
    for (const c of released) {
      const ok = !c.hasAbility || parsedById[c.defId]!.clauses.some((cl) => cl.effects.length > 0) || Object.prototype.hasOwnProperty.call(overrides, c.defId);
      expect(ok, c.defId).toBe(true);
    }
  });

  it('after overrides no sentence is left unread and no override is stale', () => {
    const r = coverage(released, parsedById);
    expect(r.unparsed).toEqual([]);
    expect(r.staleOverrides).toEqual([]);
    // Measured 2026-11-13: 8 attribute disagreements, each listed for review (e.g. Kingpin, Web Sling).
    expect(r.attributeMismatch.length).toBeLessThanOrEqual(8);
  });

  it('reports cards with no clause, unread sentences and stale overrides', () => {
    const gwen = card('Gwenpool');
    const stale = applyOverrides({ ...gwen, text: gwen.text + ' ' }, parseCard(gwen), overrides);
    const r = coverage([card('Hulk'), gwen, card('Blade')], { Gwenpool: stale, Blade: { clauses: [], unparsed: [] } });
    expect(r.staleOverrides).toEqual(['Gwenpool']);
    expect(r.unparsed).toEqual([{ defId: 'Gwenpool', text: 'Pick a random character in your hand 3 times.' }]);
    expect(r.noClause).toEqual(['Blade']);
  });
});
