/**
 * Deck-level readings shared by the rating and the per-card score: pair statistics over the
 * interaction network, payoffs with no enabler, unreachable play restrictions, near-miss plans and the
 * meta share each tech role answers. HEURISTIC where noted; every result names its cards.
 */
import { AXIS_BY_ID } from '../features/axes';
import { TECH_ROLES } from '../features/tech';
import { compileAtom, detectPlans, matchesAny } from '../plans/detect';
import type { AxisId, CardDb, CardEdge, Deck, Fix, PlanDef, TechRole } from '../types';

export interface PairStats {
  pairs: number;                  // pairs with an edge
  synSum: number;                 // sum of positive pair scores
  strong: CardEdge[];             // strong edges
  anti: CardEdge[];               // edges with anti-synergy
  antiSum: number;
  degree: Map<string, number>;    // strong edges per card
  best: Map<string, number>;      // best pair score per card
}

export function pairStats(db: CardDb, ids: readonly string[]): PairStats {
  const set = new Set(ids);
  const s: PairStats = { pairs: 0, synSum: 0, strong: [], anti: [], antiSum: 0, degree: new Map(), best: new Map() };
  for (const id of ids) {
    for (const e of db.edges(id)) {
      if (e.a !== id || e.a === e.b || !set.has(e.b)) continue;
      s.pairs++;
      s.synSum += Math.max(0, e.score);
      if (e.anti > 0) {
        s.anti.push(e);
        s.antiSum += e.anti;
      }
      if (e.strong) {
        s.strong.push(e);
        for (const x of [e.a, e.b]) s.degree.set(x, (s.degree.get(x) ?? 0) + 1);
      }
      for (const x of [e.a, e.b]) s.best.set(x, Math.max(s.best.get(x) ?? 0, e.score));
    }
  }
  s.anti.sort((x, y) => y.anti - x.anti);
  return s;
}

export const nameOf = (db: CardDb, id: string): string => db.get(id)?.name ?? id;

export function names(db: CardDb, ids: readonly string[]): string {
  const n = ids.map((id) => nameOf(db, id));
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** Best synergy reason label of an edge. */
export function edgeLabel(e: CardEdge, kind: 'synergy' | 'anti' = 'synergy'): string {
  const r = e.reasons.filter((x) => x.kind === kind).sort((x, y) => y.value - x.value)[0];
  return r ? `${r.label}${r.heuristic ? ' (heuristic)' : ''}` : kind;
}

/**
 * Payoffs with no enabler (mechanics §4.1, deck-level check; HEURISTIC): a card whose text rewards an
 * axis (payoff strength 1) when no other deck card enables any of its payoff axes, the card does not
 * enable them itself, and it has no strong edge in the deck.
 */
export function unsupportedPayoffs(db: CardDb, ids: readonly string[], stats: PairStats): { defId: string; axes: AxisId[] }[] {
  const out: { defId: string; axes: AxisId[] }[] = [];
  for (const id of ids) {
    const ax = db.features(id)?.axes ?? {};
    const payoffAxes = Object.entries(ax).filter(([, v]) => v.p >= 1).map(([k]) => k);
    if (payoffAxes.length === 0 || (stats.degree.get(id) ?? 0) > 0) continue;
    const fed = payoffAxes.some((k) => (ax[k]!.e >= 0.5) || ids.some((o) => o !== id && (db.features(o)?.axes[k]?.e ?? 0) >= 0.5));
    if (!fed) out.push({ defId: id, axes: payoffAxes });
  }
  return out;
}

/**
 * Play restrictions the deck cannot meet (HEURISTIC; rules are the pool's own sentences, read by the
 * restriction clause): "where you have a 1-Cost card" needs another 1-Cost card, "where an enemy is
 * afflicted" needs an affliction enabler. Restrictions about turns or location positions are always
 * reachable. Returns the restricted card and why.
 */
export function unreachableRestrictions(db: CardDb, ids: readonly string[]): { defId: string; why: string }[] {
  const out: { defId: string; why: string }[] = [];
  for (const id of ids) {
    const r = db.features(id)?.restriction;
    if (!r) continue;
    const costM = /where you have an? (\d+)-Cost card/i.exec(r);
    if (costM) {
      const cost = Number(costM[1]);
      if (!ids.some((o) => o !== id && db.get(o)?.cost === cost)) out.push({ defId: id, why: `${r} No other ${cost}-Cost card is in the deck.` });
      continue;
    }
    if (/afflicted/i.test(r) && !ids.some((o) => o !== id && (db.features(o)?.axes.affliction?.e ?? 0) >= 0.5)) {
      out.push({ defId: id, why: `${r} No card in the deck gives enemies negative Power.` });
    }
  }
  return out;
}

/** A card-browser filter for a plan pattern: its first atom that maps to an axis, tech role or cost. */
export function filterFor(pattern: string, side: 'e' | 'p'): Fix['filter'] {
  for (const atom of pattern.split('&').map((a) => a.trim())) {
    const ax = /^axis:([a-z_]+)\.[ep]$/.exec(atom);
    if (ax) return { axis: ax[1]! };
    if (atom.startsWith('role:')) return { techRole: atom.slice(5) };
    const c = /^cost:(-?\d+)-(-?\d+)$/.exec(atom);
    if (c) return { minCost: Number(c[1]), maxCost: Math.min(Number(c[2]), 99) };
    if (AXIS_BY_ID.has(atom)) return { axis: atom };
  }
  void side;
  return null;
}

/** Text of a plan pattern for a fix: the axis rule when there is one, else the pattern itself. */
export function patternWords(pattern: string, side: 'e' | 'p'): string {
  const ax = /axis:([a-z_]+)\.([ep])/.exec(pattern);
  if (ax) {
    const def = AXIS_BY_ID.get(ax[1]!);
    if (def) return `${def.label.toLowerCase()} (${ax[2] === 'e' ? def.enablerRule : def.payoffRule})`;
  }
  void side;
  return pattern.split('&').map((a) => atomWords(a.trim())).join(' and ');
}

// Words for the trait atoms plans.json uses (display only; matching uses the atoms themselves).
// Task 12 review: a fix read "a card with summon_own". Unknown atoms fall back to their id with spaces.
const ATOM_WORDS: Record<string, string> = {
  activate: 'an Activate ability', afflict_enemy: 'an effect that afflicts enemy cards', buff_self: 'a way to grow its own Power',
  destroy_own: 'an effect that destroys your own cards', draw_player: 'card draw', energy_gain_player: 'an Energy gain',
  energy_max_player: 'a Max Energy gain', gen_deck_deck: 'an effect that adds cards to your deck', horde_own: 'a Zombie Horde effect',
  loc_change_location: 'an effect that changes a location', no_ability: 'no ability', on_reveal: 'an On Reveal',
  power_double_own: 'an effect that doubles your cards\' Power', power_double_self: 'an effect that doubles its own Power',
  power_steal_enemy: 'a Power steal', power_steal_enemy_hand: 'a Power steal from the enemy hand',
  repeat_on_reveal_own: 'an effect that repeats your On Reveals', reveal_delay_own: 'an effect that delays your reveals',
  summon_own: 'an effect that puts a card into play on your side', total_power_location: 'an effect that counts total Power at a location',
  'cond:alone_here': 'a condition on being alone at its location', 'cond:turn_number': 'a condition on the turn number',
  'scale:distinct_costs': 'scaling with different Costs', 'scale:opp_deck_size': "scaling with the opponent's deck size",
  'scale:opp_hand_size': "scaling with the opponent's hand size", 'creates:no_ability': 'a created card with no ability',
};

function atomWords(atom: string): string {
  if (ATOM_WORDS[atom]) return ATOM_WORDS[atom]!;
  const range = /^(cost|power):(-?\d+)-(-?\d+)$/.exec(atom);
  if (range) {
    const [, what, lo, hi] = range;
    const label = what === 'cost' ? 'Cost' : 'Power';
    return Number(hi) >= 99 ? `${label} ${lo} or more` : `${label} ${lo}-${hi}`;
  }
  if (atom.startsWith('role:')) {
    const role = TECH_ROLES.find((r) => r.id === atom.slice(5));
    return `the ${role ? role.label.toLowerCase() : atom.slice(5)} tech role`;
  }
  return atom.replace(/^[a-z]+:/, '').replaceAll('_', ' ');
}

export interface NearPlan { plan: PlanDef; enablers: string[]; payoffs: string[]; missing: 'enabler' | 'payoff'; need: number }

/**
 * Plan families the deck nearly has: one side meets its minimum and the other is short (HEURISTIC).
 * Sorted by how much of the plan is present, then by payoff weight.
 */
export function nearPlans(db: CardDb, ids: readonly string[]): NearPlan[] {
  const out: NearPlan[] = [];
  for (const plan of db.plans()) {
    if ([...plan.enablerTraits, ...plan.payoffTraits].some((p) => p.split('&').some((a) => !compileAtom(a.trim())))) continue;
    const enablers: string[] = [];
    const payoffs: string[] = [];
    for (const id of ids) {
      const c = db.get(id)!;
      const f = db.features(id);
      if (matchesAny(c, f, db, plan.enablerTraits)) enablers.push(id);
      else if (matchesAny(c, f, db, plan.payoffTraits)) payoffs.push(id);
    }
    const eShort = Math.max(0, plan.minEnablers - enablers.length);
    const pShort = Math.max(0, plan.minPayoffs - payoffs.length);
    if (eShort > 0 && pShort === 0 && payoffs.length > 0) out.push({ plan, enablers, payoffs, missing: 'enabler', need: eShort });
    else if (pShort > 0 && eShort === 0 && enablers.length > 0) out.push({ plan, enablers, payoffs, missing: 'payoff', need: pShort });
  }
  out.sort((x, y) => x.need - y.need || (y.enablers.length + y.payoffs.length) - (x.enablers.length + x.payoffs.length) || y.plan.payoffWeight - x.plan.payoffWeight || (x.plan.id < y.plan.id ? -1 : 1));
  return out;
}

const roleShareCache = new WeakMap<CardDb, Map<TechRole, { share: number; archetypes: string[] }>>();

/**
 * Share of meta games whose archetype's plan folds to each tech role (measured shares; the archetype's
 * plan is its synced `planId`, else the primary plan detected on its most-played list, HEURISTIC).
 * Empty without a meta snapshot.
 */
export function roleFieldShare(db: CardDb): Map<TechRole, { share: number; archetypes: string[] }> {
  const hit = roleShareCache.get(db);
  if (hit) return hit;
  const out = new Map<TechRole, { share: number; archetypes: string[] }>();
  const meta = db.meta();
  if (meta.info()) {
    const plans = new Map(db.plans().map((p) => [p.id, p]));
    for (const a of meta.archetypes()) {
      const deck: Deck = { id: null, name: a.name, format: 'ranked', cards: a.sample.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' };
      const planId = a.planId ?? detectPlans(deck, { db, owned: null }).primary?.planId ?? null;
      const plan = planId ? plans.get(planId) : undefined;
      if (!plan) continue;
      for (const role of plan.foldsTo) {
        const r = out.get(role) ?? { share: 0, archetypes: [] };
        r.share += Math.max(0, a.share);
        r.archetypes.push(a.name);
        out.set(role, r);
      }
    }
  }
  roleShareCache.set(db, out);
  return out;
}
