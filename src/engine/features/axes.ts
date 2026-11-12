/**
 * Enabler / payoff axes (spec §8.2, docs/research/mechanics.md §3): 32 axes, each with an enabler
 * pattern ("does it") and a payoff pattern ("rewards it"), ported from the prototype
 * docs/research/analysis/mechanics/axes_edges.py onto the TypeScript parser's clause shape.
 *
 * A side is `text` when it is a reading of the card's own words, `heuristic` when it is a guess from
 * cost or Power (for example "a 6-Cost card wants ramp"). Strengths in `CardFeatures.axes` are 1 for
 * text, 0.5 for heuristic. HEURISTIC: those two numbers, and the axis weights (1-3, from mechanics §3)
 * used by the network, are judgement, not measurement.
 *
 * Deviations from the research table, each found by reading the synced text:
 *  - `skills`: every collectible skill (`isSkill`) is an enabler (mechanics §3 correction note).
 *  - `no_ability`: enablers are cards with empty text that are not skills (7 cards, mechanics §1.2).
 *  - `discard`: a card that only discards itself (Black Cat) is an enabler for discard counters but
 *    not for another card's When Discarded (the guard lives in network/rules.ts).
 *  - end-of-game discards (Dracula) are not discard enablers: nothing triggers after the game.
 */
import type { AxisId, Card, CardFeatures, Clause } from '../types';
import { clauseText, effs, hasTag, hasTrigger, selfMover, tagsOf, isDrawback, movesOthers } from './traits';

export type Role = 'text' | 'heuristic' | null;
export interface CardView { card: Card; clauses: readonly Clause[]; tags: ReadonlySet<string> }

export interface AxisDef {
  id: AxisId;
  label: string;
  /** True when one side of the axis is a heuristic (mechanics §3 "H"). */
  heuristic: boolean;
  /** Template strength 1-3 of mechanics §4.1 (HEURISTIC). */
  weight: number;
  enablerRule: string;
  payoffRule: string;
  enabler: (v: CardView) => Role;
  payoff: (v: CardView) => Role;
}

const T = (b: boolean): Role => (b ? 'text' : null);
const OWNISH = /^(own_(?!player)|all_|both$)/;          // lands on own cards (own or both sides)
const OWN_CARDS = /^own_(?!player)/;

export const view = (card: Card, clauses: readonly Clause[]): CardView => ({ card, clauses, tags: tagsOf(clauses) });

/** Cards created by this card, by zone: where the created card first appears. */
export function createdZones(v: CardView): Set<'hand' | 'deck' | 'board'> {
  const z = new Set<'hand' | 'deck' | 'board'>();
  if (effs(v.clauses, /^gen_hand$/).length || effs(v.clauses, /^copy_card$/, /^own_hand$/).length) z.add('hand');
  if (effs(v.clauses, /^gen_deck$/).length) z.add('deck');
  if (effs(v.clauses, /^gen_board$/, /^(own|both)$/).filter((h) => (h.effect.magnitude ?? 0) >= 0).length || effs(v.clauses, /^copy_card$/, /^own$/).length) z.add('board');
  return z;
}

const discardsOwnHand = (v: CardView): boolean =>
  effs(v.clauses, /^discard$/, /^(own_hand|both)$/).filter((h) => h.clause.trigger !== 'end_of_game').length > 0;

const AXIS_LIST: AxisDef[] = [
  {
    id: 'destroy', label: 'Destroy your own cards', heuristic: false, weight: 3,
    enablerRule: 'destroys own cards (own / all / both targets)',
    payoffRule: 'When Destroyed, after-destroyed triggers, destroyed counts, revives destroyed cards',
    // "Destroy those that can't" (Annihilus) is a fallback, not a way to destroy your cards on purpose.
    enabler: (v) => T(effs(v.clauses, /^destroy$/, OWNISH).some((h) => !h.clause.conditions.includes('fallback'))),
    payoff: (v) => T(hasTrigger(v.clauses, /^(when_destroyed|on_other_destroyed)$/)
      || hasTag(v.tags, /^(cond:have_destroyed|cond:have_discarded_and_destroyed|obj:destroyed)$/)
      || (hasTag(v.tags, /^scale:destroyed_count$/) && !selfContained(v, /^destroy$/))
      || effs(v.clauses, /^resurrect$/, /^own$/).some((h) => /destroyed/.test(h.clause.text))
      || effs(v.clauses, /^power_absorb$/).some((h) => h.effect.selectors.includes('sel:from_destroyed'))),
  },
  {
    id: 'discard', label: 'Discard from your hand', heuristic: false, weight: 3,
    enablerRule: 'discards from own hand (also "each player"), or discards itself',
    payoffRule: 'When Discarded, after-you-discard triggers, discard counts, revives discarded cards',
    enabler: (v) => T(discardsOwnHand(v) || effs(v.clauses, /^discard$/, /^self$/).length > 0),
    payoff: (v) => T(hasTrigger(v.clauses, /^(when_discarded|on_other_discarded)$/)
      || hasTag(v.tags, /^(scale:discard_count|cond:have_discarded|cond:have_discarded_and_destroyed)$/)
      || effs(v.clauses, /^resurrect$/, /^own$/).some((h) => /discarded/.test(h.clause.text))),
  },
  {
    id: 'move', label: 'Move your cards', heuristic: false, weight: 3,
    enablerRule: 'moves own cards, grants Moveable, or moves itself',
    payoffRule: '"When this moves", move counts, "a card moved last turn", reads cards that moved',
    enabler: (v) => T(movesOthers(v.clauses) || selfMover(v.clauses)),
    payoff: (v) => T(hasTrigger(v.clauses, /^on_self_move$/)
      || (hasTrigger(v.clauses, /^on_other_move$/) && !/When an enemy card moves/.test(v.card.text))
      || hasTag(v.tags, /^(scale:moveable_played|cond:moved_recently|sel:moveable_card)$/)
      || (hasTag(v.tags, /^scale:move_count$/) && !selfContained(v, /^move$/))
      || /that moved this turn|that last moved/.test(v.card.text)),
  },
  {
    id: 'bounce', label: 'Return cards to hand', heuristic: true, weight: 2,
    enablerRule: 'returns own other cards to hand',
    payoffRule: '"When this returns", or (HEURISTIC) an On Reveal card costing 2 or less worth replaying',
    enabler: (v) => T(effs(v.clauses, /^bounce$/, OWN_CARDS).length > 0),
    payoff: (v) => (hasTrigger(v.clauses, /^on_self_bounce$/) || (hasTag(v.tags, /^scale:bounce_count$/) && !selfContained(v, /^bounce$/)) ? 'text'
      : hasTrigger(v.clauses, /^on_reveal$/) && v.card.cost <= 2 && !v.card.isSkill && !effs(v.clauses, /^bounce$/, OWN_CARDS).length ? 'heuristic' : null),
  },
  {
    id: 'on_reveal_amp', label: 'Repeat On Reveals', heuristic: false, weight: 2,
    enablerRule: 'repeats or copies On Reveal abilities of other cards',
    payoffRule: 'carrier: a card with an On Reveal',
    enabler: (v) => T(effs(v.clauses, /^repeat_on_reveal$/, /^(?!self$)/).some((h) => !/released before/.test(h.clause.text))
      || effs(v.clauses, /^copy_text$/).some((h) => /has an On Reveal|On Reveal card in your hand|with an On Reveal card|you revealed this turn/.test(h.clause.text))),
    payoff: (v) => T(hasTrigger(v.clauses, /^on_reveal$/) && v.clauses.some((c) => c.trigger === 'on_reveal' && c.effects.length > 0)),
  },
  {
    id: 'on_reveal_count', label: 'Count On Reveals', heuristic: false, weight: 2,
    enablerRule: 'a card with an On Reveal',
    payoffRule: 'counts On Reveal cards or rewards playing them',
    enabler: (v) => T(hasTrigger(v.clauses, /^on_reveal$/)),
    payoff: (v) => T(hasTag(v.tags, /^(scale:on_reveal_count|obj:on_reveal_played|cond:played_on_reveal)$/)
      || /if it has an On Reveal/.test(v.card.text)
      || effs(v.clauses, /^buff$/, OWN_CARDS).some((h) => h.effect.selectors.includes('sel:on_reveal_card'))),
  },
  {
    id: 'ongoing_amp', label: 'Amplify Ongoing', heuristic: false, weight: 2,
    enablerRule: 'repeats or copies own Ongoing effects, buffs own Ongoing cards, counts them',
    payoffRule: 'carrier: an Ongoing card whose effect is not a drawback',
    enabler: (v) => T(effs(v.clauses, /^repeat_ongoing$/, OWN_CARDS).length > 0
      || effs(v.clauses, /^copy_text$/).some((h) => /has an Ongoing/.test(h.clause.text))
      || effs(v.clauses, /^buff$/, OWN_CARDS).some((h) => /Ongoing cards/.test(h.clause.text) || h.effect.selectors.includes('sel:ongoing_card'))
      || hasTag(v.tags, /^scale:own_ongoing_count$/)),
    payoff: (v) => T(v.clauses.some((c) => c.trigger === 'ongoing' && c.effects.some((e) => e.kind !== 'info')) && !isDrawback(v.clauses)),
  },
  {
    id: 'end_of_turn_amp', label: 'Amplify End of Turn', heuristic: false, weight: 2,
    enablerRule: 'repeats End of Turn abilities or buffs End of Turn cards',
    payoffRule: 'carrier: an End of Turn card',
    enabler: (v) => T(effs(v.clauses, /^repeat_eot$/).length > 0
      || effs(v.clauses, /^buff$/, OWN_CARDS).some((h) => /End of Turn cards/.test(h.clause.text) || h.effect.selectors.includes('sel:eot_card'))),
    payoff: (v) => T(hasTrigger(v.clauses, /^end_of_turn$/)),
  },
  {
    id: 'activate_amp', label: 'Amplify Activate', heuristic: false, weight: 2,
    enablerRule: 'activates other cards again, or buffs Activate cards',
    payoffRule: 'carrier: an Activate card',
    enabler: (v) => T(effs(v.clauses, /^repeat_activate$/).length > 0
      || effs(v.clauses, /^buff$/, OWN_CARDS).some((h) => h.effect.selectors.includes('sel:activate_card'))),
    payoff: (v) => T(hasTrigger(v.clauses, /^activate$/)),
  },
  {
    id: 'one_cost', label: '1-Cost cards', heuristic: false, weight: 2,
    enablerRule: 'base cost 1 (not a skill), or creates 1-Cost cards',
    payoffRule: 'own-side sentence naming 1-Cost cards (buff, discount, repeat, condition, bounce)',
    enabler: (v) => T((v.card.cost === 1 && !v.card.isSkill) || /(Add|Create) a (random )?1-Cost/.test(v.card.text)),
    payoff: (v) => T(v.clauses.some((c) => /\b1-Cost|1 and 6-Cost|1, 2, and 3-Cost|cost 1 or less/.test(c.text)
      && !/enemy|ALL|opponent|[Aa]dd a random|Create a|can't be destroyed/.test(c.text))),
  },
  {
    id: 'go_wide', label: 'Fill your side', heuristic: true, weight: 2,
    enablerRule: 'puts extra bodies on your side (tokens, copies, cards from hand or deck)',
    payoffRule: 'full-side conditions, per-card-here counts, a global Ongoing buff',
    enabler: (v) => T(effs(v.clauses, /^gen_board$/, /^(own|both)$/).some((h) => (h.effect.magnitude ?? 0) >= 0 && !/-\d+ Power/.test(h.clause.text))
      || effs(v.clauses, /^copy_card$/, /^own$/).length > 0
      || effs(v.clauses, /^summon$/, /^own$/).length > 0),
    payoff: (v) => T(hasTag(v.tags, /^(cond:own_side_full|cond:both_sides_full|scale:full_locations|scale:own_cards_here|scale:front_row_count|obj:full_front_rows)$/)
      || /^Ongoing: Your other cards have \+/.test(v.card.text) || /fill your side of a location/.test(v.card.text)),
  },
  {
    id: 'hand_size', label: 'Hand size', heuristic: false, weight: 2,
    enablerRule: 'adds cards to your hand, returns cards to hand, extra draws',
    payoffRule: 'scales with or buffs every card in your hand, "if your hand is full"',
    enabler: (v) => T(effs(v.clauses, /^gen_hand$/).length > 0 || effs(v.clauses, /^copy_card$/, /^own_hand$/).length > 0
      || effs(v.clauses, /^bounce$/, OWN_CARDS).length > 0
      || effs(v.clauses, /^draw$/, /^(own_player|both|enemy_deck)$/).some((h) => h.clause.trigger !== 'draw_position' && !/Draw Agatha/.test(h.clause.text))),
    payoff: (v) => T(hasTag(v.tags, /^(scale:own_hand_size|cond:hand_full)$/)
      || effs(v.clauses, /^(buff|power_set|cost_reduce)$/, /^own_hand$/).some((h) => /all cards in your hand|each card in your hand|whole hand|cards in your hand (cost|that)/i.test(h.clause.text))),
  },
  {
    id: 'empower', label: 'Permanent Power gains', heuristic: false, weight: 2,
    enablerRule: 'a non-Ongoing Power increase on your other cards (Empowered)',
    payoffRule: 'When Empowered triggers, reads cards with increased Power',
    enabler: (v) => T(empowerHits(v).length > 0),
    payoff: (v) => T(hasTrigger(v.clauses, /^(on_self_empowered|on_any_empowered)$/)
      || hasTag(v.tags, /^(sel:increased_power|scale:increased_power_count|cond:have_increased_power)$/)
      || /Double Power increases|with increased Power/.test(v.card.text)),
  },
  {
    id: 'cost_reduction', label: 'Cost reduction', heuristic: true, weight: 1,
    enablerRule: 'lowers the cost of your hand or deck (not itself)',
    payoffRule: 'HEURISTIC: a 5-Cost or more card with no self-discount; explicit big-cost counters',
    enabler: (v) => T(effs(v.clauses, /^cost_reduce$/, /^(own_(hand|deck|anywhere|here|drawn_card)|own|both|all_)/).some((h) => h.clause.trigger !== 'static_cost')),
    payoff: (v) => (hasTag(v.tags, /^(scale:big_cost_count|obj:big_cost_in_play)$/) ? 'text'
      : v.card.cost >= 5 && !hasTrigger(v.clauses, /^static_cost$/) ? 'heuristic' : null),
  },
  {
    id: 'energy_ramp', label: 'Extra Energy', heuristic: true, weight: 1,
    enablerRule: 'gives you Energy or Max Energy',
    payoffRule: 'HEURISTIC: a 6-Cost or more card with no self-discount',
    enabler: (v) => T(effs(v.clauses, /^(energy_gain|energy_max)$/, /^own_player$/).some((h) => !/lose/i.test(h.clause.text))),
    payoff: (v) => (v.card.cost >= 6 && !hasTrigger(v.clauses, /^static_cost$/) ? 'heuristic' : null),
  },
  {
    id: 'unspent_energy', label: 'Unspent Energy', heuristic: false, weight: 3,
    enablerRule: 'extra Energy next turn or bonus Energy, or a card that makes you skip a turn',
    payoffRule: 'conditions and scaling on your unspent or bonus Energy',
    enabler: (v) => T(effs(v.clauses, /^energy_gain$/, /^own_player$/).length > 0 || hasTag(v.tags, /^cond:played_last_turn$/)),
    payoff: (v) => T(hasTag(v.tags, /^(cond:own_unspent_energy|scale:unspent_energy|scale:bonus_energy|obj:unspent_energy)$/)),
  },
  {
    id: 'affliction', label: 'Afflict enemies', heuristic: false, weight: 3,
    enablerRule: 'gives enemy cards in play negative Power',
    payoffRule: 'reads afflicted cards, doubles Power reductions',
    enabler: (v) => T(effs(v.clauses, /^afflict$/, /^(enemy_here|enemy_anywhere|all_here|all_anywhere|moved_card|enemy_moved_card)$/).some((h) => !/afflicted/.test(h.clause.text))),
    payoff: (v) => T(hasTag(v.tags, /^(sel:afflicted|scale:afflicted_count|cond:enemy_afflicted_here|obj:afflicted)$/)
      || /Double the Power reductions|afflicted with negative Power have/.test(v.card.text)),
  },
  {
    id: 'self_affliction', label: 'Negative Power on your side', heuristic: false, weight: 3,
    enablerRule: 'afflicts own cards, or has negative base Power and does not switch sides itself',
    payoffRule: 'switches your cards to the enemy side, counts afflicted Power',
    enabler: (v) => T(effs(v.clauses, /^afflict$/, /^(own_here|all_here|all_anywhere)$/).length > 0
      || (v.card.power < 0 && !effs(v.clauses, /^switch_sides$/, /^self$/).length)),
    // Luke Cage's "can't have their Power reduced" was a payoff in the prototype; it is an answer to
    // affliction, not a reward for negative Power on your side (edge audit), so it is not one here.
    payoff: (v) => T(effs(v.clauses, /^switch_sides$/, OWN_CARDS).length > 0 || hasTag(v.tags, /^obj:afflicted$/)),
  },
  {
    id: 'created_cards', label: 'Created cards', heuristic: false, weight: 3,
    enablerRule: 'creates cards (hand, deck or your side of a location)',
    payoffRule: 'own-side sentence about created cards, Rocks',
    enabler: (v) => T(createdZones(v).size > 0),
    payoff: (v) => T(hasTag(v.tags, /^(scale:created_in_play|obj:created_played)$/)
      || v.clauses.some((c) => /\bcreated\b/.test(c.text) && !/enemy|opponent/.test(c.text))
      || /Your Rocks have/.test(v.card.text)),
  },
  {
    id: 'junk_clog', label: 'Clog the enemy', heuristic: false, weight: 2,
    enablerRule: 'puts cards on the enemy side, hand or deck, or pulls enemy cards to this location',
    payoffRule: 'gains Power per enemy card here / in hand / in deck, or needs both sides full',
    enabler: (v) => T(junkZones(v).size > 0),
    payoff: (v) => T((hasTag(v.tags, /^scale:(opp_hand_size|opp_deck_size|enemy_cards_here)$/) && !effs(v.clauses, /^afflict$/, /^self$/).length)
      || hasTag(v.tags, /^cond:both_sides_full$/)),
  },
  {
    id: 'location_control', label: 'Location control', heuristic: true, weight: 1,
    enablerRule: 'locks a location or changes locations',
    payoffRule: 'HEURISTIC bypass: moves, adds cards to other locations, "Nothing can stop you"',
    enabler: (v) => T(effs(v.clauses, /^lockdown$/, /^(both|all_here)$/).length > 0 || effs(v.clauses, /^loc_change$/).length > 0),
    payoff: (v) => (/Nothing can stop you/.test(v.card.text) || movesOthers(v.clauses) || selfMover(v.clauses) ? 'heuristic' : null),
  },
  {
    id: 'merge', label: 'Merge', heuristic: false, weight: 3,
    enablerRule: 'merges cards',
    payoffRule: '"When this merges", gains Power from merging',
    enabler: (v) => T(effs(v.clauses, /^merge$/).length > 0 || /Add SP\/\/dr/.test(v.card.text)),
    payoff: (v) => T(hasTrigger(v.clauses, /^on_self_merge$/)),
  },
  {
    id: 'skills', label: 'Skills', heuristic: false, weight: 2,
    enablerRule: 'is a skill, or adds a skill to your hand',
    payoffRule: '"After you play a skill"',
    enabler: (v) => T(v.card.isSkill || (/\bskill\b/.test(v.card.text) && effs(v.clauses, /^gen_hand$/).length > 0)),
    payoff: (v) => T(/After you play a skill/.test(v.card.text)),
  },
  {
    id: 'deck_top', label: 'Prepare your deck', heuristic: false, weight: 2,
    enablerRule: 'buffs, discounts or sets the cards in your deck (or its top card)',
    payoffRule: 'puts deck cards into play, merges or copies them, reads the top card',
    enabler: (v) => T(!effs(v.clauses, /^deck_replace$/).length
      && effs(v.clauses, /^(buff|cost_reduce|power_set|deck_stack)$/, /^(own_deck|both)$/, /^(on_reveal|activate|game_start)$/).some((h) => h.effect.kind === 'deck_stack' || /deck/.test(h.clause.text))),
    payoff: (v) => T(deckPuller(v) !== null),
  },
  {
    id: 'draw', label: 'Extra draws', heuristic: false, weight: 2,
    enablerRule: 'draws you extra cards',
    payoffRule: '"When you draw" triggers, Quickdraw',
    enabler: (v) => T(effs(v.clauses, /^draw$/, /^(own_player|both|enemy_deck)$/).some((h) => h.clause.trigger !== 'draw_position' && !/Draw Agatha|can't draw/.test(h.clause.text))),
    payoff: (v) => T(hasTrigger(v.clauses, /^(on_draw_any|on_draw_self|quickdraw)$/)),
  },
  {
    id: 'no_ability', label: 'No abilities', heuristic: false, weight: 3,
    enablerRule: 'card with no ability text (not a skill)',
    payoffRule: 'rewards your cards with no abilities',
    enabler: (v) => T(!v.card.hasAbility && !v.card.isSkill),
    payoff: (v) => T(hasTag(v.tags, /^(sel:no_ability|obj:no_ability)$/) || /with no abilities/.test(v.card.text)),
  },
  {
    id: 'power_steal', label: 'Steal Power', heuristic: false, weight: 3,
    enablerRule: 'steals Power',
    payoffRule: 'counts your cards that have stolen Power',
    enabler: (v) => T(effs(v.clauses, /^power_steal$/).length > 0 && !/have stolen Power/.test(v.card.text)),
    payoff: (v) => T(hasTag(v.tags, /^obj:stolen_power$/) || /have stolen Power/.test(v.card.text)),
  },
  {
    id: 'horde', label: 'Zombie Horde', heuristic: false, weight: 3,
    enablerRule: 'Horde +N',
    payoffRule: 'reads the Zombie Horde',
    enabler: (v) => T(effs(v.clauses, /^horde$/).some((h) => (h.effect.magnitude ?? 0) > 0)),
    payoff: (v) => T(/equal to your Zombie Horde|your Zombie Horde steals/.test(v.card.text)),
  },
  {
    id: 'big_power', label: 'Big printed Power', heuristic: false, weight: 2,
    enablerRule: 'base Power 10 or more',
    payoffRule: 'own-side sentence with an "N or more Power" filter (N >= 6)',
    enabler: (v) => T(v.card.power >= 10),
    payoff: (v) => T(bigPowerThreshold(v) !== null),
  },
  {
    id: 'multi_play', label: 'Several cards a turn', heuristic: true, weight: 2,
    enablerRule: 'HEURISTIC: costs 1 or less, returns cards to hand, makes cards cost 0',
    payoffRule: '"After you play a card" without a filter, cards-played counts',
    enabler: (v) => (v.card.cost <= 1 || effs(v.clauses, /^bounce$/, OWN_CARDS).length > 0 || /that cost 0 to your hand|costs 0 this turn/.test(v.card.text) ? 'heuristic' : null),
    payoff: (v) => T((hasTrigger(v.clauses, /^on_own_play$/) && !hasTag(v.tags, /^sel:(cost_|power_|skill)/) && !/next time you play|play a skill|with \d+ or more Power|\d-Cost/.test(v.card.text))
      || hasTag(v.tags, /^scale:cards_played$/) || /played \(exactly\) 2 cards|played 2 or more cards/.test(v.card.text)),
  },
  {
    id: 'alone', label: 'Alone at a location', heuristic: true, weight: 2,
    enablerRule: 'HEURISTIC: clears your own lane (destroys, returns or merges your cards here)',
    payoffRule: '"your only card here", an empty location',
    enabler: (v) => (effs(v.clauses, /^(destroy|bounce|merge)$/, /^own_here$/).length > 0 ? 'heuristic' : null),
    payoff: (v) => T(hasTag(v.tags, /^(cond:alone_here|cond:own_empty_location)$/)),
  },
  {
    id: 'sequencing', label: 'Next / last card played', heuristic: true, weight: 1,
    enablerRule: 'a Power effect on the next or last card you play',
    payoffRule: 'HEURISTIC: base Power 9 or more (best target to double or copy)',
    enabler: (v) => T(effs(v.clauses, /^(buff|power_double|power_absorb|power_set|merge)$/).some((h) => h.effect.target === 'own_next_played'
      || h.effect.selectors.includes('sel:next_played') || h.effect.selectors.includes('sel:last_played'))),
    payoff: (v) => (v.card.power >= 9 ? 'heuristic' : null),
  },
];

/**
 * "+2 Power for each destroyed" right after "Destroy your other cards here" counts the card's own
 * work (Carnage, Friendly Neighborhood Carnage, Toxin, Zombie Captain Marvel): it is not a payoff for
 * other cards doing that. A count "this game" (Death, Hydra Stomper) is a payoff.
 */
function selfContained(v: CardView, kind: RegExp): boolean {
  return effs(v.clauses, kind, /^own_(?!player)/).length > 0 && !/this game|has been/.test(v.card.text);
}

/** Own-card Power increases that make a card Empowered: non-Ongoing buff / double / set on own cards. */
export function empowerHits(v: CardView) {
  return effs(v.clauses, /^(buff|power_double|power_set)$/, OWN_CARDS).filter((h) => h.clause.trigger !== 'ongoing' && h.clause.trigger !== 'on_any_empowered');
}

/** Where this card puts junk for the opponent: 'hand', 'deck', 'board' (here). */
export function junkZones(v: CardView): Set<'hand' | 'deck' | 'board'> {
  const z = new Set<'hand' | 'deck' | 'board'>();
  if (effs(v.clauses, /^(junk_hand|opp_draw)$/).length) z.add('hand');
  if (effs(v.clauses, /^junk_deck$/).length) z.add('deck');
  if (effs(v.clauses, /^junk_board$/).length || effs(v.clauses, /^gen_board$/, /^(both|enemy)$/).length) z.add('board');
  if (effs(v.clauses, /^move$/, /^enemy/).some((h) => /to this location|from here to there/.test(h.clause.text))) z.add('board');
  return z;
}

/** How this card takes cards out of your deck: 'top' when it reads the top card, 'any' otherwise, or null. */
export function deckPuller(v: CardView): 'top' | 'any' | null {
  const t = v.card.text;
  if (/top card of your deck|your deck's top card|deck's top card|top 3 cards of both decks/.test(t) && /Add the top|Copy the text|Banish the top|cost is reduced|Compare/.test(t)) return 'top';
  if (effs(v.clauses, /^(merge|copy_text|banish)$/, /^own_deck$/).length) return /top/.test(t) ? 'top' : 'any';
  if (effs(v.clauses, /^summon$/).some((h) => /from your deck|from your hand or deck|with one from your deck/.test(h.clause.text) && !/flies out|jumps/.test(h.clause.text))) return 'any';
  return null;
}

/** The N of an own-side "N or more Power" filter (N >= 6), or null. */
export function bigPowerThreshold(v: CardView): number | null {
  for (const c of v.clauses) {
    if (/enemy|opponent/.test(c.text) || /^This has/.test(c.text) || /until it gains/.test(c.text)) continue;
    const m = /(1\d|[6-9]) or more Power/.exec(c.text);
    if (m) return Number(m[1]);
  }
  return null;
}

export const AXES: readonly AxisDef[] = AXIS_LIST;
export const AXIS_BY_ID: ReadonlyMap<string, AxisDef> = new Map(AXIS_LIST.map((a) => [a.id, a]));

/** Sparse axis roles of a card: `e` and `p` are 1 for a text reading, 0.5 for a heuristic one. */
export function axesOf(card: Card, clauses: readonly Clause[]): CardFeatures['axes'] {
  const v = view(card, clauses);
  const out: CardFeatures['axes'] = {};
  for (const a of AXIS_LIST) {
    const e = a.enabler(v);
    const p = a.payoff(v);
    if (!e && !p) continue;
    const strength = (r: Role): number => (r === 'text' ? 1 : r === 'heuristic' ? 0.5 : 0);
    out[a.id] = { e: strength(e), p: strength(p), heuristic: e === 'heuristic' || p === 'heuristic' };
  }
  return out;
}
