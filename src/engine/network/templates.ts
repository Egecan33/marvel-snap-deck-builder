/**
 * Pair templates of mechanics §4.1 beyond the axes: cost and Power filters, discard selectors, mass
 * effects that also hit your own cards, own-side text removal, protection that blocks your own
 * destroy plan, fillers vs "alone" payoffs, one-card-a-turn, clog that feeds your own penalty.
 *
 * Changes from the prototype, each from reading the texts:
 *  - filter:cost also reads summons from hand or deck ("Add a 3 or 4-Cost card from your hand ...")
 *    and conditions that name a 1-Cost card (Cull Obsidian, Lockheed); it skips protection (Caiera's
 *    "can't be destroyed" is an answer to removal, not a reward), banish, and created or random cards.
 *  - a bounce or an On Reveal repeat filtered by cost needs an On Reveal on the other card.
 *  - anti:filler_vs_space was dropped: it was the weakest rule in the prototype's hand-check (§4.3).
 */
import { costPred, effs, hasTag, hasTrigger, isDrawback, powerPred } from '../features/traits';
import type { Clause } from '../types';
import { discardPicks, quote, type Node, type RawEdge } from './rules';

const NOT_OWN_SIDE = /enemy|opponent|\bALL\b|Nobody|\bANY\b|\bEACH\b|Each player|each player/;
const POSITIVE = new Set(['buff', 'cost_reduce', 'repeat_on_reveal', 'repeat_ongoing', 'bounce', 'draw', 'power_double', 'play_restriction', 'summon']);

function edge(A: Node, B: Node, rule: string, family: string, kind: 'synergy' | 'anti', strength: number, label: string, aText: string | undefined, bText: string | undefined, here = false, heuristic = false): RawEdge {
  return { a: A.card.defId, b: B.card.defId, rule, family, kind, strength, heuristic, here, label, detail: `${quote(A.card, aText)} / ${quote(B.card, bText)}` };
}

/** A sentence that rewards your cards of some cost or Power (not created, random or enemy cards). */
function ownFilterClause(c: Clause): boolean {
  if (NOT_OWN_SIDE.test(c.text)) return false;
  if (/random|Create a|Replace this with \d|Kangs|until it gains|banish/i.test(c.text)) return false;
  if (/Add a/.test(c.text) && !/from your (hand|deck)/.test(c.text)) return false;
  const kinds = new Set(c.effects.map((e) => e.kind));
  if (c.conditions.includes('played_1cost') || c.conditions.includes('have_1cost_here')) return true;
  if (kinds.has('summon') && !/from your hand|from your deck|hand or deck/.test(c.text)) return false;
  if (kinds.has('resurrect') || kinds.has('protect') || kinds.has('discard') || kinds.has('destroy')) return false;
  return [...kinds].some((k) => POSITIVE.has(k));
}

const here = (c: Clause): boolean => c.effects.some((e) => e.target === 'own_here' || e.target === 'all_here') || /\bhere\b/.test(c.text);

/** R2: own-side clauses that name a cost or Power, against B's printed cost or Power. */
function filterEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    for (const c of A.f.clauses) {
      if (!ownFilterClause(c)) continue;
      const kinds = new Set(c.effects.map((e) => e.kind));
      const cp = /this (card )?(has|gains)|^Costs? \d/.test(c.text) ? null : costPred(c.text);
      const pp = /^This has/.test(c.text) ? null : powerPred(c.text);
      if (!cp && !pp) continue;
      const needsOnReveal = kinds.has('repeat_on_reveal') || kinds.has('bounce');
      const needsOngoing = kinds.has('repeat_ongoing');
      const needsOngoingBuff = kinds.has('buff') && /Ongoing cards/.test(c.text);
      for (const B of nodes) {
        if (A === B) continue;
        // Skills are banished once they resolve: nothing can return, repeat or buff them on the board.
        if (B.card.isSkill && ['buff', 'bounce', 'repeat_on_reveal', 'repeat_ongoing', 'power_double'].some((k) => kinds.has(k))) continue;
        if (needsOnReveal && (!hasTrigger(B.v.clauses, /^on_reveal$/) || effs(B.v.clauses, /^deck_replace$/).length)) continue;
        if (needsOngoing && !hasTrigger(B.v.clauses, /^ongoing$/)) continue;
        if (needsOngoingBuff && !hasTrigger(B.v.clauses, /^ongoing$/)) continue;
        if (cp && cp.test(B.card.cost)) {
          out.push(edge(A, B, 'filter:cost', 'cost', 'synergy', cp.strength, `${A.card.name} rewards ${cp.label} cards; ${B.card.name} costs ${B.card.cost}`, c.text, undefined, here(c)));
        }
        if (pp && pp.test(B.card.power) && !B.card.isSkill) {
          out.push(edge(A, B, 'filter:power', 'power', 'synergy', pp.strength, `${A.card.name} rewards ${pp.label} cards; ${B.card.name} has ${B.card.power} Power`, c.text, undefined, here(c)));
        }
      }
    }
  }
}

/** R3: mass destroy / afflict / lockdown with a filter on all cards: feeds When Destroyed, or hits your own. */
function massEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    for (const h of effs(A.f.clauses, /^(destroy|afflict|lockdown)$/, /^(all_here|all_anywhere|both)$/)) {
      const cp = costPred(h.clause.text), pp = powerPred(h.clause.text);
      if (!cp && !pp) continue;
      for (const B of nodes) {
        if (A === B) continue;
        const hit = (cp && cp.test(B.card.cost)) || (pp && pp.test(B.card.power));
        if (!hit) continue;
        if (h.effect.kind === 'destroy' && hasTrigger(B.v.clauses, /^when_destroyed$/)) {
          out.push(edge(A, B, 'mass:destroy_feeds', 'destroy', 'synergy', 2, `${A.card.name} destroys ${B.card.name}, which has a When Destroyed`, h.clause.text, undefined, h.effect.target === 'all_here'));
        } else {
          out.push(edge(A, B, 'mass:hits_own', 'mass:hits_own', 'anti', h.effect.kind === 'destroy' ? 2 : 1, `${A.card.name} also hits your ${B.card.name} (cost ${B.card.cost}, Power ${B.card.power})`, h.clause.text, undefined, h.effect.target === 'all_here'));
        }
      }
    }
  }
}

/** R4-R5: discard selectors, discard vs hand-size payoffs, discards that hit your key cards. */
function discardEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    const hits = effs(A.f.clauses, /^discard$/, /^(own_hand|both)$/).filter((h) => h.clause.trigger !== 'end_of_game');
    if (!hits.length) continue;
    const whole = hits.some((h) => /Discard your hand/.test(h.clause.text));
    for (const h of hits) {
      for (const B of nodes) {
        if (A === B || !hasTrigger(B.v.clauses, /^when_discarded$/)) continue;
        const ok = discardPicks(h.clause, B.card);
        if (ok === true) out.push(edge(A, B, 'discard:selector_hit', 'discard', 'synergy', 2, `${A.card.name}'s discard picks ${B.card.name} (cost ${B.card.cost}, Power ${B.card.power})`, h.clause.text, undefined));
        else if (ok === false) out.push(edge(A, B, 'discard:selector_miss', 'discard:selector_miss', 'anti', 1, `${A.card.name}'s discard will not pick ${B.card.name} while other cards are in hand`, h.clause.text, undefined));
      }
    }
    const aText = hits[0]!.clause.text;
    for (const B of nodes) {
      if (A === B) continue;
      if (hasTag(B.v.tags, /^(scale:own_hand_size|cond:hand_full)$/)) {
        out.push(edge(A, B, 'anti:discard_vs_hand_size', 'anti:discard_vs_hand_size', 'anti', whole ? 2 : 1, `${A.card.name} empties your hand; ${B.card.name} wants a large hand`, aText, undefined));
      }
      if (hasTag(B.v.tags, /^cond:hand_small$/)) {
        out.push(edge(A, B, 'syn:discard_small_hand', 'syn:discard_small_hand', 'synergy', whole ? 2 : 1, `${A.card.name} empties your hand; ${B.card.name} wants 1 or fewer cards in hand`, aText, undefined));
      }
    }
    if (whole || hits.some((h) => h.effect.selectors.includes('sel:highest_cost'))) {
      for (const B of nodes) {
        if (A === B || B.card.cost < 5 || (B.f.axes.discard?.p ?? 0) > 0) continue;
        out.push(edge(A, B, 'anti:discard_hits_key_card', 'anti:discard_hits_key_card', 'anti', 2, `${A.card.name} discards your most expensive cards; ${B.card.name} (cost ${B.card.cost}) has no discard payoff`, aText, undefined));
      }
    }
  }
}

/** R6: own-side text removal and denial of your own keywords. */
function silenceEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    const deny = effs(A.f.clauses, /^deny_on_reveal$/)[0];
    if (deny) {
      for (const B of nodes) {
        if (A !== B && hasTrigger(B.v.clauses, /^on_reveal$/)) {
          out.push(edge(A, B, 'anti:cosmo_own_on_reveal', 'anti:own_denial', 'anti', 1, `${A.card.name} stops On Reveal abilities at its location, your ${B.card.name}'s too`, deny.clause.text, undefined, true));
        }
      }
    }
    for (const h of effs(A.f.clauses, /^silence$/, /^all_here$/)) {
      const key = /Ongoing/.test(h.clause.text) ? 'ongoing' : /End of Turn/.test(h.clause.text) ? 'end_of_turn' : null;
      if (!key) continue;
      for (const B of nodes) {
        if (A === B || !hasTrigger(B.v.clauses, new RegExp(`^${key}$`))) continue;
        if (B.f.drawback) out.push(edge(A, B, 'syn:remove_own_drawback', 'syn:remove_own_drawback', 'synergy', 2, `${A.card.name} removes the ${key.replace(/_/g, ' ')} text of ${B.card.name}, which hurts its owner`, h.clause.text, undefined, true));
        else out.push(edge(A, B, `anti:silences_own_${key}`, 'anti:own_denial', 'anti', 1, `${A.card.name} removes all ${key.replace(/_/g, ' ')} abilities at its location, your ${B.card.name}'s too`, h.clause.text, undefined, true));
      }
    }
    for (const h of effs(A.f.clauses, /^silence$/, /^(own_anywhere|own_deck|own_next_played)$/)) {
      const ongoingOnly = /Ongoing/.test(h.clause.text);
      for (const B of nodes) {
        if (A === B) continue;
        if (B.f.drawback && (!ongoingOnly || hasTrigger(B.v.clauses, /^ongoing$/))) {
          out.push(edge(A, B, 'syn:remove_own_drawback', 'syn:remove_own_drawback', 'synergy', 3, `${A.card.name} removes the text of ${B.card.name}, whose text hurts its owner`, h.clause.text, undefined));
        } else if (ongoingOnly && hasTrigger(B.v.clauses, /^ongoing$/)) {
          out.push(edge(A, B, 'anti:silences_own_ongoing', 'anti:own_denial', 'anti', 2, `${A.card.name} removes the Ongoing abilities in your deck, ${B.card.name}'s too`, h.clause.text, undefined));
        }
      }
    }
  }
}

/** R7: destroy protection against your own destroy plan. */
function protectEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    for (const h of effs(A.f.clauses, /^protect$/, /^(all_here|own_anywhere)$/)) {
      if (!/can't be destroyed/.test(h.clause.text)) continue;
      const cp = costPred(h.clause.text);
      for (const B of nodes) {
        if (A === B || (cp && !cp.test(B.card.cost))) continue;
        if (hasTrigger(B.v.clauses, /^when_destroyed$/)) {
          out.push(edge(A, B, 'anti:protect_blocks_when_destroyed', 'anti:protect', 'anti', cp ? 2 : 1, `${A.card.name} stops ${B.card.name} from being destroyed, so its When Destroyed never fires`, h.clause.text, undefined, !cp));
        } else if (!cp && effs(B.v.clauses, /^destroy$/, /^own_(here|other_locations|anywhere)$/).length) {
          out.push(edge(A, B, 'anti:protect_blocks_destroyer', 'anti:protect', 'anti', 2, `${A.card.name} stops ${B.card.name} from destroying your cards at its location`, h.clause.text, undefined, true));
        }
      }
    }
  }
}

/** R8-R10: fillers vs "alone", one card a turn, clog that turns on your own penalty. */
function boardEdges(nodes: readonly Node[], out: RawEdge[]): void {
  for (const A of nodes) {
    const fills = effs(A.f.clauses, /^(gen_board|copy_card|summon)$/, /^own$/).find((h) => /other location|each location|another location|each other location/.test(h.clause.text));
    if (fills) {
      for (const B of nodes) {
        if (A !== B && hasTag(B.v.tags, /^(cond:alone_here|cond:own_empty_location)$/)) {
          out.push(edge(A, B, 'anti:filler_vs_alone', 'anti:filler_vs_alone', 'anti', 2, `${A.card.name} adds cards to your other locations; ${B.card.name} wants to be alone or an empty location`, fills.clause.text, undefined));
        }
      }
    }
    const oneCard = effs(A.f.clauses, /^lockdown$/, /^own_player$/).find((h) => /1 card a turn/.test(h.clause.text));
    if (oneCard) {
      for (const B of nodes) {
        if (A === B) continue;
        if ((B.f.axes.multi_play?.p ?? 0) > 0) out.push(edge(A, B, 'anti:one_card_a_turn', 'anti:one_card_a_turn', 'anti', 3, `${A.card.name} limits you to 1 card a turn; ${B.card.name} pays off for playing several`, oneCard.clause.text, undefined));
        if (/played \(exactly\) 1 card|played 1 card this turn/.test(B.card.text)) out.push(edge(A, B, 'syn:one_card_a_turn', 'syn:one_card_a_turn', 'synergy', 2, `${A.card.name} limits you to 1 card a turn; ${B.card.name} wants exactly 1 card played`, oneCard.clause.text, undefined));
      }
    }
    const clog = effs(A.f.clauses, /^(junk_board|gen_board|move)$/, /^(enemy|both|enemy_anywhere|enemy_here)$/).find((h) => h.effect.kind !== 'move' || /to this location|from here to there/.test(h.clause.text));
    if (clog) {
      for (const B of nodes) {
        if (A !== B && effs(B.v.clauses, /^afflict$/, /^self$/).length && hasTag(B.v.tags, /^(scale:enemy_cards_here|cond:opp_count_here)$/)) {
          out.push(edge(A, B, 'anti:junk_feeds_penalty', 'anti:junk_feeds_penalty', 'anti', 2, `${A.card.name} adds cards to the enemy side; ${B.card.name} loses Power for enemy cards there`, clog.clause.text, undefined, true));
        }
      }
    }
  }
}

export function templateEdges(nodes: readonly Node[]): RawEdge[] {
  const out: RawEdge[] = [];
  filterEdges(nodes, out);
  massEdges(nodes, out);
  discardEdges(nodes, out);
  silenceEdges(nodes, out);
  protectEdges(nodes, out);
  boardEdges(nodes, out);
  return out;
}

export { isDrawback };
