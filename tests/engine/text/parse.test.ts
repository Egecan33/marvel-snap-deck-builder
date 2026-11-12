import { describe, expect, it } from 'vitest';
import { EFFECT_KINDS, TARGETS, TRIGGERS, parseCard } from '@/engine/text/parse';
import type { Clause } from '@/engine/types';
import { card, fixtureDb } from '../../helpers/fixture-db';

const effects = (clauses: readonly Clause[]): string[] => clauses.flatMap((c) => c.effects.map((e) => `${c.trigger} ${e.kind} ${e.target}`));

describe('parseCard', () => {
  it('returns no clauses for a card without an ability', () => {
    const hulk = card('Hulk');
    expect(hulk.hasAbility).toBe(false);
    expect(parseCard(hulk)).toEqual({ clauses: [], unparsed: [] });
  });

  it('splits keyword headers, including a header naming two triggers', () => {
    // Zombie Nova: "On Reveal and When Destroyed: Horde +3."
    expect(effects(parseCard(card('ZombieNova')).clauses)).toEqual(['on_reveal horde own', 'when_destroyed horde own']);
    // Electro: "On Reveal: +1 Max Energy. Ongoing: You can only play 1 card a turn."
    expect(effects(parseCard(card('Electro')).clauses)).toEqual(['on_reveal energy_max own_player', 'ongoing lockdown own_player']);
  });

  it('ignores a keyword header quoted inside another ability', () => {
    // Thanos (Fractured Frontier): 'Game Start: Your cards have "Quickdraw: Thanos loads ..." On Reveal: ...'
    expect(parseCard(card('ThanosFracturedFrontier')).clauses.map((c) => c.trigger)).toEqual(['game_start', 'on_reveal']);
  });

  it('splits an Objective into requirement (condition) and reward', () => {
    const [c] = parseCard(card('WolverineHorseman')).clauses;
    expect(c?.trigger).toBe('objective');
    expect(c?.conditions).toContain('obj:self_power');
    expect(c?.effects.map((e) => [e.kind, e.target, e.magnitude])).toEqual([['buff', 'own_anywhere', 4]]);
  });

  it('resolves "it" to where the previous card ended up, across sentences', () => {
    // Mirage: copy into your hand, then "Give it +2 Power": the copy in your hand, not the enemy card.
    expect(effects(parseCard(card('Mirage')).clauses)).toEqual(['on_reveal copy_card own_hand', 'on_reveal buff own_hand']);
    // Valentina: "Add a random 6-Cost card to your hand. Give it -2 Cost and -2 Power."
    expect(effects(parseCard(card('Valentina')).clauses)).toEqual(['on_reveal gen_hand own_hand', 'on_reveal cost_reduce own_hand', 'on_reveal afflict own_hand']);
  });

  it('gives an event trigger its own subject instead of an older antecedent', () => {
    // Rocket and Groot: "Moveable once. After your opponent plays a card here, steal 1 Power from it."
    expect(effects(parseCard(card('RocketAndGroot')).clauses)).toEqual(['moveable grant_moveable self', 'on_opp_play power_steal enemy_played_card']);
    // Man-Spider: "When this merges, double its Power." is this card, not the merged one.
    expect(effects(parseCard(card('ManSpider')).clauses)[1]).toBe('on_self_merge power_double self');
  });

  it('splits "this and X" into two recipients', () => {
    expect(effects(parseCard(card('Tarantula')).clauses)).toEqual(['end_of_turn buff self', 'end_of_turn buff own_hand']);
  });

  it('keeps own, enemy and both sides apart on the same verb', () => {
    expect(effects(parseCard(card('Blade')).clauses)).toEqual(['on_reveal discard own_hand']);
    expect(effects(parseCard(card('BlackBolt')).clauses)).toEqual(['on_reveal discard enemy_hand']);
    expect(effects(parseCard(card('MoonKnight')).clauses)).toEqual(['on_reveal discard both']);
    expect(effects(parseCard(card('Deathlok')).clauses)).toEqual(['on_reveal destroy own_here']);
    expect(effects(parseCard(card('ShangChi')).clauses)).toEqual(['on_reveal destroy enemy_here']);
    expect(effects(parseCard(card('Killmonger')).clauses)).toEqual(['on_reveal destroy all_anywhere']);
  });

  it('reads magnitudes and marks a fully read clause complete', () => {
    const [c] = parseCard(card('KaZar')).clauses;
    expect(c?.effects[0]).toMatchObject({ kind: 'buff', target: 'own_anywhere', magnitude: 1 });
    expect(c?.complete).toBe(true);
    expect(c?.source).toBe('parser');
  });

  it('lists a sentence it cannot read in unparsed', () => {
    // Gwenpool: "Pick a random character in your hand 3 times. Give +2 Power each time." (reviewed override instead)
    expect(parseCard(card('Gwenpool')).unparsed).toEqual(['Pick a random character in your hand 3 times.']);
  });

  it('never throws and only uses the published vocabulary on the whole pool', () => {
    const triggers = new Set<string>(TRIGGERS), kinds = new Set<string>(EFFECT_KINDS), targets = new Set<string>(TARGETS);
    let full = 0;
    const withText = fixtureDb().released().filter((c) => c.hasAbility);
    for (const c of withText) {
      const p = parseCard(c);
      if (p.unparsed.length === 0) full++;
      for (const cl of p.clauses) {
        expect(triggers.has(cl.trigger), `${c.defId} trigger ${cl.trigger}`).toBe(true);
        for (const e of cl.effects) {
          expect(kinds.has(e.kind), `${c.defId} kind ${e.kind}`).toBe(true);
          expect(targets.has(e.target), `${c.defId} target ${e.target}`).toBe(true);
          expect(e.magnitude === null || Number.isFinite(e.magnitude)).toBe(true);
        }
      }
    }
    // Measured 2026-11-13 on the fixture pool: 494 of 504 cards with text fully read (98.0%); the
    // research prototype read 93.5%. The rest are in sync-data/card-overrides.json.
    expect(full / withText.length).toBeGreaterThanOrEqual(0.98);
  });
});
