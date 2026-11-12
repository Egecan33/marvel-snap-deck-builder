import { describe, expect, it } from 'vitest';
import { ALWAYS_AVAILABLE, classOf, createCardDb, createMetaIndex, normalizeName, toCard, type UntappedCardRow } from '@/engine/carddb';
import type { CardEdge, CardFeatures } from '@/engine/types';

const NOW = Date.UTC(2026, 10, 12); // 2026-11-12
const DAY = 86_400_000;

const row = (over: Partial<UntappedCardRow> & { defId: string }): UntappedCardRow => ({
  name: over.defId, cost: 1, power: 1, description: '<i>"flavour"</i>', series: 0, seriesStartTimestamps: [], ...over,
});

const sentinel = row({
  defId: 'Sentinel', cost: 2, power: 3, description: '<b>On Reveal:</b> Add another Sentinel to your hand.',
  series: 1, seriesStartTimestamps: [ALWAYS_AVAILABLE], collectible: true,
});
const hulk = row({ defId: 'Hulk', cost: 6, power: 14, description: '<i>"HULK SMASH!"</i>', series: 1, seriesStartTimestamps: [ALWAYS_AVAILABLE], collectible: true });
const bannerHulk = row({ defId: 'BannerHulk', name: 'Hulk', cost: 6, power: 12 });
const evolvedHulk = row({ defId: 'EvolvedHulk', name: 'Hulk', cost: 6, power: 12, description: '<color=#fad728><b>End of Turn:</b> +2 Power.</color>' });
const elderDragon = row({
  defId: 'ElderDragonOfTheMoon', name: 'Elder Dragon of the Moon', cost: 9, power: 12, description: 'Costs 1 less.',
  attributes: { data: { ReducedCost: 1 } }, series: 0, seriesStartTimestamps: [NOW + 5 * DAY], possibleSeries: 8, collectible: true,
});
const scheduled = row({ defId: 'SirPercyBlackKnight', name: 'Sir Percy', series: 8, seriesStartTimestamps: [NOW + 12 * DAY], collectible: true });
const champion = row({
  defId: 'AnnihilusChampion', name: 'Annihilus Champion', cost: 5, power: 8,
  attributes: { data: { AssignedPower: 0 }, cards: { Card_Token: ['Skill01AnnihilusChampion'], Card_Base: ['Annihilus'] } },
});
const squirrelGirl = row({
  defId: 'SquirrelGirl', name: 'Squirrel Girl', description: '<b>On Reveal:</b> Add a Squirrel to each other location.',
  attributes: { cards: { Card_Token: ['Squirrel'] } }, series: 1, seriesStartTimestamps: [ALWAYS_AVAILABLE], collectible: true,
});
const squirrel = row({ defId: 'Squirrel', description: '<i>"squeak!"</i>' });
const mbaku = row({ defId: 'MBaku', name: "M'Baku", series: 5, seriesStartTimestamps: [ALWAYS_AVAILABLE], collectible: true });
const arana = row({ defId: 'Arana', name: 'Araña', series: 8, seriesStartTimestamps: [NOW - 100 * DAY], collectible: true });
const msMarvel = row({
  defId: 'MsMarvel', name: 'Ms. Marvel', cost: 4, power: 5, series: 7, collectible: true, isSeasonPass: true,
  seriesStartTimestamps: [1699383600000, 1701802800000, 1741028400000],
});
const skill = row({
  defId: 'AdamantiumInfusion', name: 'Adamantium Infusion', cost: 4, power: 0, description: '<b>On Reveal:</b> Banish this.',
  series: 8, seriesStartTimestamps: [1764702000000], collectible: true, isSkill: true, isSeasonPass: true,
});
const dropping = row({ defId: 'Dropper', series: 8, seriesStartTimestamps: [NOW - 200 * DAY, NOW + 30 * DAY], collectible: true });

const ROWS = [sentinel, hulk, bannerHulk, evolvedHulk, elderDragon, scheduled, champion, squirrelGirl, squirrel, mbaku, arana, msMarvel, skill, dropping];

function dbAt(now: number, extra: { features?: CardFeatures[]; edges?: CardEdge[] } = {}) {
  return createCardDb({
    cards: ROWS.map((r) => toCard(r, now)), features: extra.features ?? [], edges: extra.edges ?? [],
    formats: [], plans: [], meta: createMetaIndex(null, [], []), now,
  });
}

describe('classOf', () => {
  it('released = collectible, in a series, first start date reached', () => {
    expect(classOf(sentinel, NOW)).toBe('released');
    expect(classOf(msMarvel, NOW)).toBe('released');
    expect(classOf(skill, NOW)).toBe('released');
  });

  it('a card with a later series drop date stays released', () => {
    expect(classOf(dropping, NOW)).toBe('released');
  });

  it('collectible with series 0 and a future date is upcoming', () => {
    expect(classOf(elderDragon, NOW)).toBe('upcoming');
  });

  it('a mode copy and a summon are tokens', () => {
    expect(classOf(champion, NOW)).toBe('token');
    expect(classOf(squirrel, NOW)).toBe('token');
    expect(classOf(bannerHulk, NOW)).toBe('token');
  });

  it('changes when the clock passes the start date', () => {
    expect(classOf(scheduled, NOW)).toBe('upcoming');
    expect(classOf(scheduled, NOW + 12 * DAY)).toBe('released');
    expect(classOf(arana, NOW - 101 * DAY)).toBe('upcoming');
    expect(classOf(arana, NOW)).toBe('released');
  });

  it('tolerates rows without timestamps or series', () => {
    expect(classOf({ defId: 'X', name: 'X', cost: 0, power: 0, description: '' } as UntappedCardRow, NOW)).toBe('token');
  });
});

describe('toCard', () => {
  it('maps the always-available sentinel date to null', () => {
    expect(toCard(sentinel, NOW).releaseAt).toBeNull();
    expect(toCard(squirrel, NOW).releaseAt).toBeNull();
  });

  it('uses the smallest start timestamp as the release date', () => {
    expect(toCard(msMarvel, NOW).releaseAt).toBe(1699383600000);
    expect(toCard(elderDragon, NOW).releaseAt).toBe(NOW + 5 * DAY);
  });

  it('cleans text and flags no-ability cards', () => {
    const s = toCard(sentinel, NOW);
    expect(s.text).toBe('On Reveal: Add another Sentinel to your hand.');
    expect(s.rawText).toBe(sentinel.description);
    expect(s.hasAbility).toBe(true);
    const h = toCard(hulk, NOW);
    expect(h.text).toBe('');
    expect(h.hasAbility).toBe(false);
  });

  it('carries skill, season pass, series, attributes and tokens', () => {
    const s = toCard(skill, NOW);
    expect(s.isSkill).toBe(true);
    expect(s.isSeasonPass).toBe(true);
    expect(s.series).toBe(8);
    expect(s.seriesLabel).toBe('Series 5');
    expect(toCard(sentinel, NOW).seriesLabel).toBe('Starter');
    expect(toCard(sentinel, NOW).isSkill).toBe(false);
    expect(toCard(squirrel, NOW).seriesLabel).toBe('None');
    expect(toCard(elderDragon, NOW).attributes).toEqual({ ReducedCost: 1 });
    expect(toCard(hulk, NOW).attributes).toEqual({});
    expect(toCard(squirrelGirl, NOW).tokens).toEqual(['Squirrel']);
    expect(toCard(champion, NOW).tokens).toEqual(['Skill01AnnihilusChampion']);
    expect(toCard(hulk, NOW).tokens).toEqual([]);
  });

  it('stamps the class for the given clock', () => {
    expect(toCard(scheduled, NOW).cardClass).toBe('upcoming');
    expect(toCard(scheduled, NOW + 13 * DAY).cardClass).toBe('released');
  });
});

describe('normalizeName', () => {
  it('ignores case, diacritics, apostrophes and punctuation', () => {
    expect(normalizeName('M’Baku')).toBe(normalizeName("m'baku"));
    expect(normalizeName('Araña')).toBe(normalizeName('ARANA'));
    expect(normalizeName('Ms. Marvel')).toBe(normalizeName('ms marvel'));
    expect(normalizeName('  Squirrel   Girl ')).toBe(normalizeName('Squirrel Girl'));
  });
});

describe('createCardDb', () => {
  const db = dbAt(NOW);

  it('gets by defId and lists released cards only', () => {
    expect(db.now).toBe(NOW);
    expect(db.get('Hulk')?.power).toBe(14);
    expect(db.get('Nope')).toBeUndefined();
    expect(db.all()).toHaveLength(ROWS.length);
    const released = db.released().map((c) => c.defId);
    expect(released).toContain('Hulk');
    expect(released).not.toContain('BannerHulk');
    expect(released).not.toContain('ElderDragonOfTheMoon');
    expect(released).not.toContain('Squirrel');
    expect(db.released().every((c) => c.cardClass === 'released')).toBe(true);
  });

  it('byName prefers the released card over same-named tokens', () => {
    expect(db.byName('Hulk')?.defId).toBe('Hulk');
    expect(db.byName('hulk')?.defId).toBe('Hulk');
    expect(db.byName(' HULK ')?.defId).toBe('Hulk');
  });

  it('byName accepts wrong case, curly apostrophes and missing diacritics', () => {
    expect(db.byName('m’baku')?.defId).toBe('MBaku');
    expect(db.byName("M'BAKU")?.defId).toBe('MBaku');
    expect(db.byName('arana')?.defId).toBe('Arana');
    expect(db.byName('ms marvel')?.defId).toBe('MsMarvel');
    expect(db.byName('No Such Card')).toBeUndefined();
    expect(db.byName('')).toBeUndefined();
  });

  it('byName still resolves upcoming cards and tokens when no released card has the name', () => {
    expect(db.byName('Elder Dragon of the Moon')?.defId).toBe('ElderDragonOfTheMoon');
    expect(db.byName('Squirrel')?.defId).toBe('Squirrel');
  });

  it('byName is deterministic among same-class duplicates', () => {
    const tokensOnly = createCardDb({
      cards: [evolvedHulk, bannerHulk].map((r) => toCard(r, NOW)), features: [], edges: [], formats: [], plans: [],
      meta: createMetaIndex(null, [], []), now: NOW,
    });
    expect(tokensOnly.byName('Hulk')?.defId).toBe('BannerHulk');
  });

  it('prefers the released card after its date passes', () => {
    const later = dbAt(NOW + 13 * DAY);
    expect(later.released().map((c) => c.defId)).toContain('SirPercyBlackKnight');
    expect(db.released().map((c) => c.defId)).not.toContain('SirPercyBlackKnight');
  });

  it('has no features or edges until they are supplied', () => {
    expect(db.features('Hulk')).toBeUndefined();
    expect(db.edges('Hulk')).toEqual([]);
    expect(db.edge('Hulk', 'Sentinel')).toBeUndefined();
    expect(db.formats()).toEqual([]);
    expect(db.plans()).toEqual([]);
    expect(db.meta().info()).toBeNull();
  });

  it('indexes supplied features and edges in both directions', () => {
    const f: CardFeatures = {
      defId: 'Hulk', clauses: [], unparsed: [], traits: [], axes: {}, techRoles: [], drawback: false, restriction: null,
      model: { extraSeen: 0, extraEnergy: 0, selfDiscount: 0, deckDilution: 0 }, quality: 50, qualityParts: { stat: 50, text: 0, measured: 0 },
    };
    const e: CardEdge = { a: 'Sentinel', b: 'Hulk', synergy: 1, anti: 0, score: 1, strong: false, sameLocation: false, reasons: [] };
    const full = dbAt(NOW, { features: [f], edges: [e] });
    expect(full.features('Hulk')).toBe(f);
    expect(full.edges('Hulk')).toEqual([e]);
    expect(full.edges('Sentinel')).toEqual([e]);
    expect(full.edge('Hulk', 'Sentinel')).toBe(e);
    expect(full.edge('Sentinel', 'Hulk')).toBe(e);
    expect(full.edges('MBaku')).toEqual([]);
  });
});
