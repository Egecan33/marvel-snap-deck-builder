/**
 * Axis rules (spec §8.3, mechanics §4.1 "axis:*"): an enabler of an axis and a payoff of the same axis
 * make a synergy edge, subject to guards that check the two texts actually meet (zone, filter, subject).
 * The guards come from the prototype's hand-checks (mechanics §4.3) and from this build's edge audit
 * (tests/fixtures/edge-audit.json).
 */
import { AXES, createdZones, deckPuller, bigPowerThreshold, empowerHits, junkZones, view, type CardView, type Role } from '../features/axes';
import { costPred, effs, hasTag, hasTrigger, movesOthers, powerPred } from '../features/traits';
import type { Card, CardFeatures, Clause } from '../types';

/** One rule firing from card A to card B, before fan-out weighting. */
export interface RawEdge {
  a: string; b: string;
  rule: string;
  /** Rules in one family describe the same interaction; a pair counts a family once (its best rule). */
  family: string;
  kind: 'synergy' | 'anti';
  strength: number;
  heuristic: boolean;
  /** The interaction only works when both cards share a location ("here"). */
  here: boolean;
  label: string;
  detail: string;
}

export interface Node { card: Card; f: CardFeatures; v: CardView }

export const node = (card: Card, f: CardFeatures): Node => ({ card, f, v: view(card, f.clauses) });

/** `Name: "text"` with the clause that matters, or the card's stat line when it has no text. */
export function quote(card: Card, text?: string): string {
  const t = (text ?? card.text).trim();
  return t ? `${card.name}: "${t}"` : `${card.name} (${card.cost}/${card.power}, no ability)`;
}

/**
 * The broad axes of spec §8.3 that may not create a strong edge by themselves. Every heuristic side
 * (a cost or Power guess) is capped the same way.
 */
export const BROAD_AXES: ReadonlySet<string> = new Set(['bounce', 'cost_reduction', 'energy_ramp', 'sequencing', 'multi_play', 'location_control', 'go_wide', 'alone']);

const FAMILY: Record<string, string> = { one_cost: 'cost', big_power: 'power', discard: 'discard', destroy: 'destroy' };

/** First clause of A whose effect makes it an enabler on this axis (for quoting and filters). */
function enablerClause(axis: string, v: CardView): Clause | undefined {
  const pick = (kind: RegExp, target?: RegExp): Clause | undefined => effs(v.clauses, kind, target)[0]?.clause;
  switch (axis) {
    case 'destroy': return pick(/^destroy$/, /^(own_(?!player)|all_|both$)/);
    case 'discard': return pick(/^discard$/);
    case 'move': return pick(/^(move|grant_moveable)$/);
    case 'bounce': return pick(/^bounce$/);
    case 'on_reveal_amp': return pick(/^(repeat_on_reveal|copy_text)$/);
    case 'ongoing_amp': return pick(/^(repeat_ongoing|copy_text|buff)$/);
    case 'end_of_turn_amp': return pick(/^(repeat_eot|buff)$/);
    case 'activate_amp': return pick(/^(repeat_activate|buff)$/);
    case 'empower': return empowerHits(v)[0]?.clause;
    case 'cost_reduction': return pick(/^cost_reduce$/);
    case 'energy_ramp': case 'unspent_energy': return pick(/^(energy_gain|energy_max)$/);
    case 'affliction': case 'self_affliction': return pick(/^afflict$/);
    case 'created_cards': return pick(/^(gen_hand|gen_deck|gen_board|copy_card)$/);
    case 'junk_clog': return pick(/^(junk_board|junk_hand|junk_deck|opp_draw|gen_board|move)$/);
    case 'merge': return pick(/^merge$/);
    case 'deck_top': return pick(/^(buff|cost_reduce|power_set|deck_stack)$/, /^(own_deck|both)$/);
    case 'draw': return pick(/^draw$/);
    case 'power_steal': return pick(/^power_steal$/);
    case 'horde': return pick(/^horde$/);
    case 'sequencing': return pick(/^(power_double|power_set|merge)$/);
    case 'alone': return pick(/^(destroy|bounce|merge)$/, /^own_here$/);
    case 'location_control': return pick(/^(lockdown|loc_change)$/);
    default: return undefined;
  }
}

/** Discard selector judgement: does A's discard pick B? null when the selector says nothing. */
export function discardPicks(clause: Clause, b: Card): boolean | null {
  const sel = new Set(clause.effects.flatMap((e) => (e.kind === 'discard' ? e.selectors : [])));
  if (/Discard your hand/.test(clause.text)) return true;
  if (sel.has('sel:when_discarded_card')) return true;
  if (sel.has('sel:highest_cost')) return b.cost >= 5;
  if (sel.has('sel:lowest_cost')) return b.cost <= 2;
  if (sel.has('sel:lowest_power')) return b.power <= 2;
  if (sel.has('sel:odd_cost')) return b.cost % 2 === 1;
  if (sel.has('sel:even_cost')) return b.cost % 2 === 0;
  const cp = costPred(clause.text);
  if (cp) return cp.test(b.cost);
  return null;
}

const ownHandDiscards = (v: CardView) => effs(v.clauses, /^discard$/, /^(own_hand|both)$/).filter((h) => h.clause.trigger !== 'end_of_game');

/** Guards per axis: the enabler and payoff must actually meet (prototype pair_ok plus this build's fixes). */
function pairOk(axis: string, A: Node, B: Node): boolean {
  const a = A.v, b = B.v;
  switch (axis) {
    case 'move': {
      // "for each Moveable card you've played" (Spider Sense) counts cards that are Moveable themselves, not cards that make others Moveable.
      if (hasTag(b.tags, /^scale:moveable_played$/) && !hasTrigger(a.clauses, /^moveable$/)) return false;
      const counts = hasTag(b.tags, /^(scale:move_count|scale:moveable_played|cond:moved_recently)$/) || hasTrigger(b.clauses, /^on_other_move$/)
        || /that moved this turn|that last moved/.test(B.card.text);
      if (!counts && !hasTrigger(b.clauses, /^on_reveal$/) && effs(a.clauses, /^move$/).some((h) => h.effect.selectors.includes('sel:on_reveal_card'))
        && !effs(a.clauses, /^(move|grant_moveable)$/).some((h) => !h.effect.selectors.includes('sel:on_reveal_card') && h.effect.target !== 'self')) return false; // Grand Master moves On Reveal cards only
      // A mover filtered by cost (Xorn: "ANY 3 or 4-Cost card") only moves matching cards.
      if (!counts && effs(a.clauses, /^(move|grant_moveable)$/).every((h) => h.effect.target === 'self' || (costPred(h.clause.text)?.test(B.card.cost) === false))) return false;
      // A mover that takes your highest-Power card(s) (Doctor Strange) rarely picks a small card.
      if (!counts && B.card.power < HIGH_POWER && effs(a.clauses, /^(move|grant_moveable)$/).every((h) => h.effect.target === 'self' || h.effect.selectors.includes('sel:highest_power'))) return false;
            return counts || movesOthers(a.clauses, A.card);      // a self-mover (or a token mover such as Sam Wilson's Shield) does not move another card's "when this moves"
    }
    case 'discard': {
      const counts = hasTag(b.tags, /^(scale:discard_count|cond:have_discarded|cond:have_discarded_and_destroyed)$/) || hasTrigger(b.clauses, /^on_other_discarded$/)
        || effs(b.clauses, /^resurrect$/, /^own$/).some((h) => /discarded/.test(h.clause.text));
      if (counts) return true;
      // B itself must be discarded: A has to discard from your hand, and its selector must be able to pick B.
      const hits = ownHandDiscards(a);
      if (!hits.length) return false;
      return hits.some((h) => discardPicks(h.clause, B.card) !== false);
    }
    case 'destroy': {
      if (!hasTrigger(b.clauses, /^when_destroyed$/)) return true;
      // A filtered destroyer must be able to hit B (Killmonger x Marrow, mechanics §4.3 v2).
      return effs(a.clauses, /^destroy$/, /^(own_(?!player)|all_|both$)/).some((h) => {
        const cp = costPred(h.clause.text), pp = powerPred(h.clause.text);
        if (cp && !cp.test(B.card.cost)) return false;
        if (pp && !pp.test(B.card.power)) return false;
        if (h.effect.selectors.includes('sel:less_power_than_self') && B.card.power >= A.card.power) return false;
        if (h.effect.selectors.includes('sel:highest_power') && B.card.power < HIGH_POWER) return false;
        if (h.clause.conditions.includes('fallback')) return false;
        return true;
      });
    }
    case 'bounce': {
      const c = effs(a.clauses, /^bounce$/, /^own_(?!player)/)[0]?.clause;
      const cp = c ? costPred(c.text) : null;
      return !cp || cp.test(B.card.cost);
    }
    case 'on_reveal_amp': {
      if (/released before|copy its text\.$/.test(A.card.text)) return false;
      if (effs(b.clauses, /^deck_replace$/).length) return false;       // repeating Loki replaces the same deck again
      const c = effs(a.clauses, /^repeat_on_reveal$/)[0]?.clause;
      const cp = c ? costPred(c.text) : null;
      return !cp || cp.test(B.card.cost);
    }
    case 'ongoing_amp': {
      const c = effs(a.clauses, /^(repeat_ongoing|buff)$/, /^own_(?!player)/)[0]?.clause;
      const cp = c ? costPred(c.text) : null;
      return !cp || cp.test(B.card.cost);
    }
    case 'empower': {
      const onlySelf = hasTrigger(b.clauses, /^on_self_empowered$/) && !hasTag(b.tags, /^(sel:increased_power|scale:increased_power_count|cond:have_increased_power)$/);
      return empowerHits(a).some((h) => {
        const cp = costPred(h.clause.text);
        if (cp && !cp.test(B.card.cost)) return false;
        if (onlySelf && h.effect.target === 'own_deck' && !/in deck/.test(B.card.text)) return false;
        if (onlySelf && h.effect.target === 'own_hand' && !/in hand/.test(B.card.text)) return false;
        return true;
      });
    }
    case 'created_cards': {
      const z = createdZones(a);
      const t = B.card.text;
      if (/Rocks/.test(t)) return /\bRocks?\b/.test(A.card.text);
      if (/created in your hand|created card from your hand/.test(t)) return z.has('hand');
      if (/created card from your deck/.test(t)) return z.has('deck');
      if (/created cards cost|total Cost of created cards/.test(t)) return z.has('hand') || z.has('deck');
      return true;
    }
    case 'affliction':
      // "where an enemy is afflicted" / "enemy cards here afflicted": the affliction must be able to land at that location.
      if (hasTag(b.tags, /^cond:enemy_afflicted_here$/) || /cards here afflicted/.test(B.card.text)) {
        return effs(a.clauses, /^afflict$/).some((h) => /^(enemy_here|all_here|all_anywhere|enemy_moved_card|moved_card)$/.test(h.effect.target) || /each location/.test(h.clause.text));
      }
      return true;
    case 'unspent_energy':
      // Skipping a turn leaves Energy unspent but gives no bonus Energy (Jim Hammond).
      if (hasTag(b.tags, /^scale:bonus_energy$/) && !effs(a.clauses, /^energy_gain$/, /^own_player$/).length) return false;
      // Only unconditional extra Energy for you feeds an unspent-Energy payoff (X-23's comes only when it is discarded).
      return hasTag(a.tags, /^cond:played_last_turn$/) || effs(a.clauses, /^energy_gain$/, /^own_player$/).some((h) => h.clause.conditions.length === 0
        && /^(on_reveal|activate|start_of_turn|on_own_play)$/.test(h.clause.trigger) && !/if they have any/.test(A.card.text));
    case 'self_affliction':
      // A card that destroys your cards at 0 Power or less removes the negative cards a switch-sides payoff wants (Hellcow Fractured Frontier x Annihilus); anti in templates.ts.
      if (destroysOwnNegative(a)) return false;
      // Printed negative Power is not an affliction: it feeds "switch sides", not "cards are afflicted with -5 Power".
      if (!effs(b.clauses, /^switch_sides$/, /^own_(?!player)/).length) return effs(a.clauses, /^afflict$/, /^(own_here|all_here|all_anywhere)$/).length > 0;
      return true;
    case 'junk_clog': {
      const z = junkZones(a);
      if (hasTag(b.tags, /^scale:opp_hand_size$/)) return z.has('hand');
      if (hasTag(b.tags, /^scale:opp_deck_size$/)) return z.has('deck');
      return z.has('board');
    }
    case 'cost_reduction':
      // Filtered or one-card reducers are left to filter:cost; only whole-hand / whole-deck / any-card reducers reach any big card.
      return effs(a.clauses, /^cost_reduce$/, /^(own_(hand|deck|anywhere|here|drawn_card)|own|both|all_)/).some((h) => h.clause.trigger !== 'static_cost'
        && !costPred(h.clause.text) && !powerPred(h.clause.text)
        && !h.effect.selectors.some((s) => /^sel:(cost_|created|top_of_deck|power_|moveable|leftmost|lowest|highest)/.test(s))
        && !/created|Moveable card|top card|Set (their|its) Cost|give it|the copy|They cost|copies of this|It costs 0/.test(h.clause.text));
    case 'merge':
      return /merge this into|Merge this into/.test(A.card.text);
    case 'big_power': {
      const n = bigPowerThreshold(b);
      return n !== null && A.card.power >= n;
    }
    case 'one_cost':
      return oneCostPayoffAccepts(b, A);
    case 'multi_play':
      return !/if it has an On Reveal/.test(B.card.text) || hasTrigger(a.clauses, /^on_reveal$/);
    case 'deck_top': {
      // A payoff that banishes the top card throws the preparation away (Kraglin x Spider-Man Noir); only a stacked card feeds it. Anti in templates.ts.
      if (banishesTop(b) && !effs(a.clauses, /^deck_stack$/).length) return false;
      const top = effs(a.clauses, /^(buff|cost_reduce|power_set|deck_stack)$/, /^(own_deck|both)$/).every((h) => h.effect.kind === 'deck_stack' || /top/.test(h.clause.text));
      return !top || deckPuller(b) === 'top';
    }
    case 'draw': {
      if (!hasTrigger(b.clauses, /^on_draw_any$/)) {
        // "When you draw this" / Quickdraw: A must be able to draw B itself: from your own deck, unfiltered.
        return effs(a.clauses, /^draw$/, /^(own_player|both)$/).some((h) => !costPred(h.clause.text) && !powerPred(h.clause.text) && !/created/.test(h.clause.text));
      }
      const pp = powerPred(B.card.text);
      if (!pp) return true;
      return effs(a.clauses, /^draw$/).some((h) => { const ap = powerPred(h.clause.text); return ap !== null && ap.n >= pp.n; });
    }
    case 'sequencing':
      return true;
    default:
      return true;
  }
}

/** Destroys your own cards at 0 Power or less (Hellcow Fractured Frontier). */
export const destroysOwnNegative = (v: CardView): boolean =>
  effs(v.clauses, /^destroy$/, /^own_(?!player)/).some((h) => h.effect.selectors.includes('sel:power_le') && /\b0 Power or less|Power below 0|negative Power/.test(h.clause.text));

/** Banishes the top card of your deck (Kraglin). */
export const banishesTop = (v: CardView): boolean =>
  effs(v.clauses, /^banish$/, /^own_deck$/).some((h) => h.effect.selectors.includes('sel:top_of_deck') || /top card/.test(h.clause.text));

/** B's own-side 1-Cost sentence accepts A: a bounce or a repeat needs an On Reveal to return or repeat. */
function oneCostPayoffAccepts(b: CardView, A: Node): boolean {
  const c = b.clauses.find((cl) => /\b1-Cost|1 and 6-Cost|1, 2, and 3-Cost|cost 1 or less/.test(cl.text) && !/enemy|ALL|opponent|[Aa]dd a random|Create a|can't be destroyed/.test(cl.text));
  if (!c) return false;
  if (c.effects.some((e) => e.kind === 'discard')) return false;            // Bullseye discarding a 1-drop is the discard axis, not a reward
  if (c.effects.some((e) => e.kind === 'bounce' || e.kind === 'repeat_on_reveal')) return hasTrigger(A.v.clauses, /^on_reveal$/);
  return true;
}

/** Does this location-scoped amplifier/enabler act "here" only? */
function hereScoped(axis: string, A: Node, B: Node): boolean {
  const c = enablerClause(axis, A.v);
  if (axis === 'go_wide') return hasTag(B.v.tags, /^(scale:own_cards_here|cond:own_side_full)$/) && /here|this location/.test(A.card.text);
  if (!c) return false;
  return c.effects.some((e) => e.target === 'own_here' || e.target === 'all_here') && ['on_reveal_amp', 'ongoing_amp', 'activate_amp', 'alone', 'destroy'].includes(axis);
}

/**
 * Strength of an axis edge for this pair (HEURISTIC): the axis weight, one less when the enabler's
 * part is unaimed (a discard that does not say which card goes) or the payoff needs a second thing
 * the enabler does not give ("discarded and destroyed").
 */
function pairStrength(axis: string, A: Node, B: Node, base: number): number {
  if (axis === 'discard') {
    const selfOnly = hasTrigger(B.v.clauses, /^when_discarded$/) && !hasTag(B.v.tags, /^(scale:discard_count|cond:have_discarded)$/) && !hasTrigger(B.v.clauses, /^on_other_discarded$/);
    if (selfOnly && ownHandDiscards(A.v).every((h) => discardPicks(h.clause, B.card) === null && !h.effect.selectors.some((s) => /^sel:(leftmost|rightmost)$/.test(s)))) return base - 1;
    if (hasTag(B.v.tags, /^cond:have_discarded_and_destroyed$/) && !hasTrigger(B.v.clauses, /^(when_discarded|on_other_discarded)$/) && !hasTag(B.v.tags, /^(scale:discard_count|cond:have_discarded)$/)) return base - 1;
  }
  // A filtered mass destroyer (Killmonger, Lady Deathstrike) feeds a destroyed-count payoff only if you also run matching cards.
  if (axis === 'destroy' && !hasTrigger(B.v.clauses, /^when_destroyed$/)
    && effs(A.v.clauses, /^destroy$/, /^(all_|both$)/).length && !effs(A.v.clauses, /^destroy$/, /^own_(?!player)/).length) return base - 1;
  // Payoffs that need a third card: Firehair uses the destroyed card's On Reveal; Firelord revives only 3-Cost cards.
  if ((axis === 'destroy' || axis === 'discard') && (effs(B.v.clauses, /^repeat_on_reveal$/, undefined, /^on_other_destroyed$/).length
    || effs(B.v.clauses, /^resurrect$/, /^own$/).some((h) => costPred(h.clause.text) !== null))) return base - 1;
  // Clog on the enemy board pays off only at the right location (Mojo, Dagger), except a standing "for each enemy card here" (Punisher).
  if (axis === 'junk_clog' && !hasTag(B.v.tags, /^scale:(opp_hand_size|opp_deck_size)$/) && !hasTrigger(B.v.clauses, /^ongoing$/)) return base - 1;
  if (axis === 'junk_clog' && hasTag(B.v.tags, /^cond:both_sides_full$/)) return base - 1;
  // "When you draw this" and Quickdraw only fire if the extra draw happens to be this card.
  if (axis === 'draw' && !hasTrigger(B.v.clauses, /^on_draw_any$/)) return base - 1;
  if (axis === 'destroy' && hasTag(B.v.tags, /^cond:have_discarded_and_destroyed$/) && !hasTrigger(B.v.clauses, /^(when_destroyed|on_other_destroyed)$/)
    && !hasTag(B.v.tags, /^(scale:destroyed_count|cond:have_destroyed|obj:destroyed)$/)) return base - 1;
  return base;
}

/** HEURISTIC: a card this strong is a plausible "highest-Power" pick. */
const HIGH_POWER = 5;

const sideHeuristic = (r: number | undefined): boolean => r === 0.5;

/** R1: every axis enabler x payoff pair that passes the guards. */
export function axisEdges(nodes: readonly Node[]): RawEdge[] {
  const out: RawEdge[] = [];
  for (const axis of AXES) {
    const en = nodes.filter((n) => (n.f.axes[axis.id]?.e ?? 0) > 0);
    const pa = nodes.filter((n) => (n.f.axes[axis.id]?.p ?? 0) > 0);
    for (const A of en) {
      for (const B of pa) {
        if (A.card.defId === B.card.defId || !pairOk(axis.id, A, B)) continue;
        const heuristic = BROAD_AXES.has(axis.id) || axis.heuristic || sideHeuristic(A.f.axes[axis.id]?.e) || sideHeuristic(B.f.axes[axis.id]?.p);
        const ac = enablerClause(axis.id, A.v);
        out.push({
          a: A.card.defId, b: B.card.defId, rule: `axis:${axis.id}`, family: FAMILY[axis.id] ?? `axis:${axis.id}`,
          kind: 'synergy', strength: pairStrength(axis.id, A, B, axis.weight), heuristic, here: hereScoped(axis.id, A, B),
          label: `${A.card.name} is a ${axis.label.toLowerCase()} enabler; ${B.card.name} pays it off${heuristic ? ' (heuristic)' : ''}`,
          detail: `${quote(A.card, ac?.text)} / ${quote(B.card)}`,
        });
      }
    }
  }
  return out;
}

export { oneCostPayoffAccepts };
export type { Role };
