import { describe, expect, it } from 'vitest';
import { AXES, axesOf } from '@/engine/features/axes';
import { computeFeatures, computeNetwork, modelOf } from '@/engine/features/compute';
import { poolStatsOf, qualityOf } from '@/engine/features/quality';
import { TECH_ROLES, techRolesOf } from '@/engine/features/tech';
import { traitsOf } from '@/engine/features/traits';
import { applyOverrides } from '@/engine/text/overrides';
import { parseCard } from '@/engine/text/parse';
import type { Card } from '@/engine/types';
import { card, fixtureDb, fixtureOverrides } from '../helpers/fixture-db';

const clausesOf = (c: Card) => applyOverrides(c, parseCard(c), fixtureOverrides()).clauses;
const axes = (id: string) => axesOf(card(id), clausesOf(card(id)));
const tech = (id: string) => techRolesOf(card(id), clausesOf(card(id)));

/**
 * One known enabler and one known payoff per axis, from the examples of docs/research/mechanics.md §3
 * (or, where that list named a card whose synced text no longer fits, another card whose text was read).
 * The text each choice rests on is quoted, and the first test checks it against the synced fixture.
 */
const AXIS_CASES: [axis: string, enabler: string, enablerText: string, payoff: string, payoffText: string][] = [
  ['destroy', 'Carnage', 'Destroy your other cards here', 'Deadpool', 'When Destroyed: Return this to your hand'],
  ['discard', 'Blade', 'Discard the rightmost card from your hand', 'Apocalypse', 'When Discarded: Put this back'],
  ['move', 'DoctorStrange', 'Move your highest-Power card(s) to this location', 'HumanTorch', 'When this moves, double its Power'],
  ['bounce', 'Beast', 'Return your other cards here to your hand', 'KittyPryde', 'When this returns to your hand, +1 Power'],
  ['on_reveal_amp', 'Odin', 'Repeat the On Reveal abilities of your other cards here', 'Agent13', 'On Reveal: Add a random card to your hand'],
  ['on_reveal_count', 'Agent13', 'On Reveal:', 'Gorr', '+2 Power for EACH On Reveal card in play'],
  ['ongoing_amp', 'Onslaught', 'Your other Ongoing effects here apply an additional time', 'KaZar', 'Ongoing: Your 1-Cost cards have +1 Power'],
  ['end_of_turn_amp', 'Fantasticar', 'Give your End of Turn cards +2 Power', 'Sunspot', 'End of Turn: Gain +1 Power for each unspent Energy'],
  ['activate_amp', 'Jocasta', 'Immediately Activate your other cards here', 'Bullseye', 'Activate: Discard all cards'],
  ['one_cost', 'MistyKnight', '', 'KaZar', 'Your 1-Cost cards have +1 Power'],
  ['go_wide', 'SquirrelGirl', 'Add a 1-Power Squirrel to each other location', 'AntMan', 'If your side of this location is full, +4 Power'],
  ['hand_size', 'Agent13', 'Add a random card to your hand', 'DevilDinosaur', '+2 Power for each card in your hand'],
  ['empower', 'Forge', 'Give the next card you play +2 Power', 'SebastianShaw', 'When this is Empowered'],
  ['cost_reduction', 'Sera', 'Cards in your hand cost 1 less', 'Hulk', ''],
  ['energy_ramp', 'Electro', '+1 Max Energy', 'Hulk', ''],
  ['unspent_energy', 'Psylocke', 'Next turn, you get +1 Energy', 'Sunspot', 'for each unspent Energy'],
  ['affliction', 'SpiderWoman', 'Afflict all enemy cards here with -1 Power', 'Ajax', 'afflicted with negative Power'],
  ['self_affliction', 'Yellowjacket', 'Afflict your other cards here with -1 Power', 'Annihilus', 'Your cards with Power below 0 switch sides'],
  ['created_cards', 'Agent13', 'Add a random card to your hand', 'Mockingbird', 'Costs 1 less for each of your created cards in play'],
  ['junk_clog', 'Korg', "Shuffle a Rock into your opponent's deck", 'Darkhawk', "+2 Power for each card in your opponent's deck"],
  ['location_control', 'Storm', 'Flood this location', 'Nightcrawler', 'Moveable once'],
  ['merge', 'Hulkbuster', 'Merge this into one of your cards here', 'ManSpider', 'When this merges, double its Power'],
  ['skills', 'FastballSpecial', 'On Reveal:', 'NicholasScratch', 'After you play a skill, +1 Power'],
  ['deck_top', 'AmericaChavez', 'Give the top card of your deck +3 Power', 'Jubilee', 'Add the top card of your deck to this location'],
  ['draw', 'Crystal', 'Each player draws a card', 'JubileeSilverSurfer', 'When you draw a card'],
  ['no_ability', 'Hulk', '', 'Patriot', 'Your cards with no abilities have +2 Power'],
  ['power_steal', 'Laufey', 'Steal 1 Power from each other card here', 'VampireDeaconFrost', '3 of your cards have stolen Power'],
  ['horde', 'TheHunger', 'Horde +3', 'ZombieGiantMan', 'gains Power equal to your Zombie Horde'],
  ['big_power', 'Hulk', '', 'Surtur', 'After you play a card with 10 or more Power'],
  ['multi_play', 'Agent13', '', 'Bishop', 'After you play a card, this gains +1 Power'],
  ['alone', 'Deathlok', 'Destroy your other cards here', 'Namor', '+5 Power if this is your only card here'],
  ['sequencing', 'Shuri', 'double its Power', 'Hulk', ''],
];

describe('axes', () => {
  it('lists the 32 axes of mechanics §3, the broad ones flagged heuristic', () => {
    expect(AXES).toHaveLength(32);
    expect(new Set(AXES.map((a) => a.id)).size).toBe(32);
    for (const id of ['bounce', 'cost_reduction', 'energy_ramp', 'sequencing', 'multi_play', 'location_control', 'go_wide', 'alone']) {
      expect(AXES.find((a) => a.id === id)?.heuristic, id).toBe(true);
    }
    expect(AXES.find((a) => a.id === 'destroy')?.heuristic).toBe(false);
  });

  it('the example texts are the synced texts', () => {
    expect(AXIS_CASES.map((c) => c[0]).sort()).toEqual(AXES.map((a) => a.id).sort());
    for (const [, en, enText, pa, paText] of AXIS_CASES) {
      expect(card(en).text, en).toContain(enText);
      expect(card(pa).text, pa).toContain(paText);
    }
    expect(card('Hulk').text).toBe('');
    expect(card('FastballSpecial').isSkill).toBe(true);
  });

  it.each(AXIS_CASES)('%s: %s enables, %s pays off', (axis, enabler, _e, payoff) => {
    expect(axes(enabler)[axis]?.e ?? 0, `${enabler} enabler`).toBeGreaterThan(0);
    expect(axes(payoff)[axis]?.p ?? 0, `${payoff} payoff`).toBeGreaterThan(0);
  });

  it('marks heuristic readings at half strength and text readings at full', () => {
    expect(axes('Hulk').energy_ramp).toEqual({ e: 0, p: 0.5, heuristic: true });
    expect(axes('Carnage').destroy).toMatchObject({ e: 1, heuristic: false });
  });

  it('keeps own-side and enemy-side apart (Review focus 2)', () => {
    // Shang-Chi destroys an enemy card: no own-destroy axis. Killmonger destroys ALL 1-Cost cards: it does.
    expect(axes('ShangChi').destroy).toBeUndefined();
    expect(axes('Killmonger').destroy?.e).toBe(1);
    // Black Bolt discards from the opponent's hand: not a discard enabler for you.
    expect(axes('BlackBolt').discard).toBeUndefined();
    // Carnage counts what it destroys itself: not a payoff for other destroyers.
    expect(axes('Carnage').destroy?.p).toBe(0);
  });
});

describe('tech roles (theory §3)', () => {
  const CASES: [string, string, string][] = [
    ['ShadowKing', 'Reset all cards here to their original Power', 'power-reset'],
    ['MobiusMMobius', "Your opponent's Costs can't be reduced", 'cost-lock'],
    ['Stardust', "Cards can't be added to locations except by playing or moving them", 'add-lock'],
    ['LukeCage', "can't have their Power reduced", 'reduction-immunity'],
    ['Cosmo', "On Reveal abilities won't happen here", 'on-reveal-denial'],
    ['ShangChi', 'Destroy an enemy card here that has 10 or more Power', 'big-card-removal'],
    ['Enchantress', 'Remove the abilities from all Ongoing cards here', 'ongoing-removal'],
    ['Rogue', 'Steal the text from an enemy Ongoing card here', 'ongoing-removal'],
    ['Echo', 'After your opponent plays an Ongoing card here, remove its abilities', 'ongoing-removal'],
    ['SuperSkrull', 'Has the Ongoing effects of all enemy cards', 'ongoing-removal'],
    ['Killmonger', 'Destroy ALL 1-Cost cards', 'sweeper'],
    ['Armor', "Cards here can't be destroyed", 'destroy-lock'],
    ['RedGuardian', 'remove its text', 'text-removal'],
    ['CosmicGhostRider', 'Remove the text from front-row enemy cards here', 'text-removal'],
    ['DeafeningChord', 'Remove the text of a 3-Cost or lower enemy character here', 'text-removal'],
    ['Alioth', 'Remove the text from all unrevealed enemy characters here', 'text-removal'],
    ['Iceman', "Give a card in your opponent's hand +1 Cost", 'hand-attack'],
    ['Leech', "Remove the text from 6-Cost or more cards in your opponent's hand", 'hand-attack'],
    ['BlackBolt', "Discard the card that costs the least from your opponent's hand", 'hand-attack'],
    ['Gorgon', "Your opponent's created cards cost 1 more", 'created-tax'],
    ['Juggernaut', 'Move away all enemy cards played here this turn', 'displacement'],
    ['Magneto', 'Move all enemy 3 and 4-Cost cards to this location', 'displacement'],
    ['ProfessorX', 'Moving is the only way to add or remove a character from here', 'lockdown'],
  ];

  it.each(CASES)('%s gets its role', (id, text, role) => {
    expect(card(id).text).toContain(text);
    expect(tech(id)).toContain(role);
  });

  it('every role id is in TECH_ROLES, with a label and what it answers', () => {
    const ids = new Set(TECH_ROLES.map((r) => r.id));
    for (const [, , role] of CASES) expect(ids.has(role)).toBe(true);
    for (const r of TECH_ROLES) expect(r.label && r.answers).toBeTruthy();
    expect(tech('Hulk')).toEqual([]);
    expect(tech('Odin')).toEqual([]);
  });
});

describe('flags, traits and model', () => {
  it('flags drawback cards and leaves others alone', () => {
    // mechanics §3 drawback list, texts checked: each hurts its own side.
    for (const [id, text] of [
      ['TyphoidMary', 'Your other cards here have -2 Power'], ['RedSkull', 'Enemy cards here have +2 Power'],
      ['Electro', 'You can only play 1 card a turn'], ['Destroyer', 'Destroy your cards at other locations'],
      ['Maximus', 'Your opponent draws 2 cards'],
    ]) {
      expect(card(id).text).toContain(text);
      expect(computeFeatures(card(id), fixtureOverrides(), poolStatsOf(fixtureDb().released()), undefined).drawback, id).toBe(true);
    }
    for (const id of ['Hulk', 'Odin', 'Carnage', 'KaZar', 'Wong']) {
      expect(fixtureDb().features(id)?.drawback, id).toBe(false);
    }
  });

  it('states play restrictions in words', () => {
    for (const [id, text] of [
      ['Crossbones', 'You can only play this at locations where you are winning'], ['CullObsidian', 'You can only play this where you have a 1-Cost card'],
      ['Giganto', 'You can only play this at the left location'], ['Ikari', 'You can only play this where an enemy is afflicted'],
      ['Infinaut', "If you played a card last turn, you can't play this"],
    ]) {
      expect(fixtureDb().features(id)?.restriction, id).toContain(text);
    }
    for (const id of ['Hulk', 'Odin', 'Carnage', 'Electro', 'Wong']) expect(fixtureDb().features(id)?.restriction, id).toBeNull();
  });

  it('derives flat traits from clauses', () => {
    const t = traitsOf(card('Carnage'), clausesOf(card('Carnage')));
    expect(t).toEqual(expect.arrayContaining(['on_reveal', 'destroy_own', 'buff_self', 'scale:destroyed_count']));
    expect(traitsOf(card('Hulk'), [])).toEqual(['no_ability']);
    expect(traitsOf(card('Zabu'), clausesOf(card('Zabu')))).toContain('cost_reduce_deck');
  });

  it('models extra cards seen, Energy, self-discount and deck dilution from magnitudes', () => {
    expect(modelOf(clausesOf(card('Crystal'))).extraSeen).toBe(1);
    expect(modelOf(clausesOf(card('Electro'))).extraEnergy).toBe(1);
    expect(modelOf(clausesOf(card('Havok'))).extraEnergy).toBe(-1);
    expect(modelOf(clausesOf(card('Skaar'))).selfDiscount).toBe(2);
    expect(modelOf(clausesOf(card('Arishem')))).toMatchObject({ deckDilution: 12, extraEnergy: 1 });
    expect(modelOf(clausesOf(card('Thanos'))).deckDilution).toBe(6);
    expect(modelOf([])).toEqual({ extraSeen: 0, extraEnergy: 0, selfDiscount: 0, deckDilution: 0 });
  });
});

describe('quality (heuristic, spec §8.4)', () => {
  const pool = poolStatsOf(fixtureDb().released());

  it('reads the pool mean Power per cost from the synced pool', () => {
    // theory §1.5 measured 2.15 / 2.75 / 3.69 / 5.46 / 6.42 / 8.59 for costs 1-6 on the same 500 characters.
    expect(pool.cards).toBe(500);
    expect(pool.meanPower[1]).toBeCloseTo(2.15, 1);
    expect(pool.meanPower[6]).toBeCloseTo(8.59, 1);
  });

  it('ranks a no-ability card above the pool mean over one below it', () => {
    const hulk = card('Hulk');
    const weak: Card = { ...hulk, defId: 'WeakHulk', power: 5 };
    const above = qualityOf(hulk, [], pool, undefined);
    const below = qualityOf(weak, [], pool, undefined);
    expect(above.quality).toBeGreaterThan(below.quality);
    expect(above.parts.stat).toBeGreaterThan(0);
    expect(below.parts.stat).toBeLessThan(0);
    expect(above.parts.text).toBe(0);
  });

  it('is in 0-100 and never NaN for the whole pool, with and without meta', () => {
    const db = fixtureDb();
    for (const c of db.released()) {
      const f = db.features(c.defId)!;
      expect(Number.isFinite(f.quality), c.defId).toBe(true);
      expect(f.quality).toBeGreaterThanOrEqual(0);
      expect(f.quality).toBeLessThanOrEqual(100);
      const bare = qualityOf(c, f.clauses, pool, undefined);
      expect(Number.isFinite(bare.quality)).toBe(true);
      expect(bare.parts.measured).toBe(0);
    }
  });

  it('keeps the measured part within +/-10 and zero without a win-rate delta', () => {
    const hulk = card('Hulk');
    const stat = (winDelta: number | null, games = 100000, lists = 10) => ({ lists, listShare: 0.1, clusterShare: 0.1, games, winDelta });
    expect(qualityOf(hulk, [], pool, stat(0.5)).parts.measured).toBe(10);
    expect(qualityOf(hulk, [], pool, stat(-0.5)).parts.measured).toBe(-10);
    expect(qualityOf(hulk, [], pool, stat(null)).parts.measured).toBe(0);
    // Shrinkage: 300 games over 30 lists is worth little against a prior of 50 games per list.
    expect(Math.abs(qualityOf(hulk, [], pool, stat(0.05, 300, 30)).parts.measured)).toBeLessThan(1);
  });

  it('survives an empty pool', () => {
    const empty = poolStatsOf([]);
    expect(qualityOf(card('Hulk'), [], empty, undefined).quality).toBeGreaterThanOrEqual(0);
    expect(computeNetwork({ cards: [], meta: null, overrides: {} })).toEqual({ features: [], edges: [] });
  });
});

describe('fixture database', () => {
  it('carries features for released and upcoming cards, not tokens', () => {
    const db = fixtureDb();
    for (const c of db.released()) expect(db.features(c.defId), c.defId).toBeDefined();
    const token = db.all().find((c) => c.cardClass === 'token');
    expect(token && db.features(token.defId)).toBeUndefined();
    expect(db.features('Hulk')?.axes.no_ability?.e).toBe(1);
  });
});
