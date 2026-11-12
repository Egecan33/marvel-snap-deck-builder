/**
 * Tech roles (spec §8.2; docs/research/deck-theory-and-creativity.md §3 and mechanics.md §3 `_tech`):
 * what a card answers in the opponent's deck. Read from the card's parsed clauses, never from a list
 * of card names, because tech texts change with balance patches (theory §3, last paragraph).
 */
import type { Card, Clause, TechRole } from '../types';
import { effs } from './traits';

export interface TechRoleDef { id: TechRole; label: string; answers: string }

export const TECH_ROLES: readonly TechRoleDef[] = [
  { id: 'ongoing-removal', label: 'Ongoing removal', answers: 'Ongoing stacking (Ongoing removal or theft)' },
  { id: 'text-removal', label: 'Text removal', answers: 'any text-dependent enemy card' },
  { id: 'on-reveal-denial', label: 'On Reveal denial', answers: 'On Reveal chains' },
  { id: 'power-reset', label: 'Power reset', answers: 'buffs and scaling on a body' },
  { id: 'cost-lock', label: 'Cost lock', answers: 'cost reduction, discounted finishers' },
  { id: 'add-lock', label: 'Add lock', answers: 'cards added by effects (summons, copies, tokens)' },
  { id: 'reduction-immunity', label: 'Reduction immunity', answers: 'affliction and Power theft' },
  { id: 'big-card-removal', label: 'Big-card removal', answers: 'one huge card' },
  { id: 'sweeper', label: 'Sweeper', answers: 'swarms of small cards' },
  { id: 'destroy-lock', label: 'Destroy lock', answers: 'destroy plans and enemy removal' },
  { id: 'hand-attack', label: 'Hand attack', answers: 'expensive finishers and key cards in hand' },
  { id: 'deck-attack', label: 'Deck attack', answers: 'cards still in the deck' },
  { id: 'created-tax', label: 'Created-card tax', answers: 'created cards' },
  { id: 'displacement', label: 'Displacement', answers: 'lane commitment on the last turn' },
  { id: 'lockdown', label: 'Lockdown', answers: 'plays into a location' },
  { id: 'protection', label: 'Protection', answers: 'removal of your own cards' },
];

/** Tech roles of a card, in TECH_ROLES order. */
export function techRolesOf(card: Pick<Card, 'text'>, clauses: readonly Clause[]): TechRole[] {
  const roles = new Set<TechRole>();
  const enemyOrAll = /^(enemy|all_)/;
  if (effs(clauses, /^(silence|steal_text)$/, enemyOrAll).some((h) => /Ongoing/.test(h.clause.text) || /Ongoing card/.test(card.text))
    || effs(clauses, /^repeat_ongoing$/, /^enemy/).length) roles.add('ongoing-removal');
  if (effs(clauses, /^(silence|steal_text)$/, /^enemy_(here|anywhere|played_card)$/).some((h) => !/Ongoing/.test(h.clause.text) && !/Ongoing card/.test(card.text))) roles.add('text-removal');
  if (effs(clauses, /^deny_on_reveal$/).length) roles.add('on-reveal-denial');
  if (effs(clauses, /^power_set$/, /^(all_|enemy_(here|anywhere))/).length) roles.add('power-reset');
  if (effs(clauses, /^cost_other$/, /^enemy/).some((h) => /can't be reduced/.test(h.clause.text))) roles.add('cost-lock');
  if (effs(clauses, /^lockdown$/).some((h) => /can't be added to locations/.test(h.clause.text))) roles.add('add-lock');
  if (effs(clauses, /^protect$/, /^(own_(?!player)|all_)/).some((h) => /can't have their Power reduced/.test(h.clause.text))) roles.add('reduction-immunity');
  if (effs(clauses, /^destroy$/, /^enemy/).some((h) => h.effect.selectors.includes('sel:power_ge'))
    || effs(clauses, /^afflict$/, /^enemy/).some((h) => h.effect.selectors.includes('sel:highest_power') && (h.effect.magnitude ?? 0) >= 5)) roles.add('big-card-removal');
  if (effs(clauses, /^destroy$/, /^all_/).length) roles.add('sweeper');
  if (effs(clauses, /^protect$/, /^(own_(?!player)|all_)/).some((h) => /can't be destroyed/.test(h.clause.text))) roles.add('destroy-lock');
  if (effs(clauses, /^(cost_increase|silence|discard|afflict|power_steal|steal_text|copy_text)$/, /^enemy_hand$/).length) roles.add('hand-attack');
  if (effs(clauses, /^(cost_increase|banish|power_steal|draw)$/, /^enemy_deck$/).length) roles.add('deck-attack');
  if (effs(clauses, /^(cost_increase|destroy)$/, /^enemy/).some((h) => /created/.test(h.clause.text))) roles.add('created-tax');
  if (effs(clauses, /^move$/, /^enemy/).length) roles.add('displacement');
  if (effs(clauses, /^lockdown$/, /^(both|all_here|enemy)/).some((h) => !/can't be added to locations/.test(h.clause.text))) roles.add('lockdown');
  if (effs(clauses, /^protect$/).length) roles.add('protection');
  return TECH_ROLES.map((r) => r.id).filter((id) => roles.has(id));
}
