/**
 * Deck-level readings shared by the rating and the per-card score: pair statistics over the
 * interaction network, payoffs with no enabler, unreachable play restrictions, near-miss plans and the
 * meta share each tech role answers. HEURISTIC where noted; every result names its cards.
 */
import { AXIS_BY_ID } from '../features/axes';
import { TECH_ROLES } from '../features/tech';
import { gradedWeight, isPartner } from '../network/edges';
import { mulberry32 } from '../maths/rng';
import { corpusOf, LIFT_PSEUDO, wilsonLower } from '../novelty/clusters';
import { compileAtom, detectPlans, matchesAny } from '../plans/detect';
import type { AxisId, CardDb, CardEdge, Deck, Fix, PlanDef, TechRole } from '../types';
import { COHESION, MEASURED, SYNERGY } from './constants';

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
  s.antiSum = cappedAnti(s.anti.map((e) => [e.a, e.b, e.anti] as const));
  return s;
}

/**
 * Sum of anti-synergy with each card's share capped (calibration pass; SYNERGY.antiPerCard): an edge counts
 * in full only while both of its cards take part in at most `antiPerCard` of anti in all, else it is scaled
 * down by the busier card's load. Generic over card keys so the search evaluator can share it.
 */
export function cappedAnti<K>(edges: readonly (readonly [K, K, number])[]): number {
  const load = new Map<K, number>();
  for (const [a, b, w] of edges) for (const x of [a, b]) load.set(x, (load.get(x) ?? 0) + w);
  let sum = 0;
  for (const [a, b, w] of edges) sum += w * Math.min(1, SYNERGY.antiPerCard / Math.max(load.get(a)!, load.get(b)!, 1e-9));
  return sum;
}

export interface MeasuredPair { value: number; observed: number; expected: number; lift: number; share: number; clusters: number }

const measuredCache = new WeakMap<CardDb, Map<string, MeasuredPair | null>>();

/**
 * Measured co-play evidence of a pair (calibration pass; MEASURED in constants.ts), over list clusters of the
 * synced corpus. The pair must co-occur significantly above chance: the lift that the one-sided 95% Wilson
 * LOWER bound of its co-play rate supports is at least `MEASURED.minLift` (cards of one big archetype family
 * co-occur a little above chance everywhere, so a raw lift is not enough). Its weight is then the share of
 * the rarer card's clusters that also hold the other card ("when you see the rarer card, the other is
 * there"), mapped to 0..1 between `shareZero` and `shareFull`. Null when the corpus or either card has too
 * little data or the pair is not significant. Cached per database.
 */
export function measuredPair(db: CardDb, a: string, b: string): MeasuredPair | null {
  let cache = measuredCache.get(db);
  if (!cache) measuredCache.set(db, (cache = new Map()));
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out: MeasuredPair | null = null;
  const corpus = corpusOf(db);
  const N = corpus.clusters;
  if (a !== b && N >= MEASURED.minCorpusClusters) {
    const na = corpus.cardClusters(a);
    const nb = corpus.cardClusters(b);
    if (na >= MEASURED.minCardClusters && nb >= MEASURED.minCardClusters) {
      const observed = corpus.together([a, b]);
      if (observed >= MEASURED.minTogether) {
        const expected = (na * nb) / N;
        const liftLow = expected > 0 ? (wilsonLower(observed, N) * N) / expected : 0;
        const share = observed / Math.min(na, nb);
        const value = liftLow >= MEASURED.minLift ? Math.max(0, Math.min(1, (share - MEASURED.shareZero) / (MEASURED.shareFull - MEASURED.shareZero))) : 0;
        if (value > 0) out = { value, observed, expected, lift: (observed + LIFT_PSEUDO) / (expected + LIFT_PSEUDO), share, clusters: N };
      }
    }
  }
  cache.set(key, out);
  return out;
}

export interface CohesionPair { a: string; b: string; mech: number; measured: number; weight: number; edge: CardEdge | undefined; m: MeasuredPair | null }
export interface Cohesion {
  /** Sum over pairs of max(mechanical x mechFactor, measured). */
  total: number;
  /** Part of `total` carried by mechanical edges (heuristic network). */
  mech: number;
  /** Part of `total` that only measured co-play adds (measured). */
  measured: number;
  /** Pairs with any weight, heaviest first. */
  pairs: CohesionPair[];
  /** Cards in no pair with weight (no edge of 0.2+ and no measured co-play). */
  unlinked: string[];
  /** Real partners per card (network/edges.ts `isPartner`). */
  partners: Map<string, number>;
}

/**
 * Graded cohesion of a deck (calibration pass, spec §12 synergy and §14 C6 reworked): every pair counts the
 * larger of its graded mechanical weight (x COHESION.mechFactor, heuristic) and its measured co-play weight,
 * so 0.3-0.5 edges and proven pairs count instead of only edges of 0.5 or more. Pure and deterministic.
 */
export function cohesionOf(db: CardDb, ids: readonly string[]): Cohesion {
  const pairs: CohesionPair[] = [];
  const linked = new Set<string>();
  const partners = new Map<string, number>();
  let total = 0;
  let mechSum = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      if (a === b) continue;
      const e = db.edge(a, b);
      const mech = gradedWeight(e) * COHESION.mechFactor;
      const m = measuredPair(db, a, b);
      const measured = m?.value ?? 0;
      const weight = Math.max(mech, measured);
      if (isPartner(e)) for (const x of [a, b]) partners.set(x, (partners.get(x) ?? 0) + 1);
      if (weight <= 0) continue;
      total += weight;
      mechSum += mech;
      linked.add(a);
      linked.add(b);
      pairs.push({ a, b, mech, measured, weight, edge: e, m });
    }
  }
  pairs.sort((x, y) => y.weight - x.weight || (x.a + x.b < y.a + y.b ? -1 : 1));
  return { total, mech: mechSum, measured: total - mechSum, pairs, unlinked: ids.filter((id) => !linked.has(id)), partners };
}

/** Cohesion credit 0..1: mechanical pairs earn at most `COHESION.mechCap` of `target`, measured co-play the rest. */
export function cohesionCredit(mech: number, measured: number, target: number): number {
  return Math.min(1, (Math.min(mech, COHESION.mechCap * target) + measured) / Math.max(1e-9, target));
}

/** Cards with a pair of at least `COHESION.tiedWeight` to another deck card (mechanical or measured). */
export function tiedCards(c: Cohesion): Set<string> {
  const out = new Set<string>();
  for (const p of c.pairs) if (p.weight >= COHESION.tiedWeight) { out.add(p.a); out.add(p.b); }
  return out;
}

/**
 * The rating's synergy sub-score value (calibration pass): graded cohesion against `COHESION.fullCredit`
 * scaled by the deck's pair count, plus the share of cards linked to another card, minus anti-synergy;
 * clamped to [0, 1]. Shared by rate.ts and the floor's ablation check so both read the same number.
 */
export function synergyValueOf(c: Cohesion, n: number, antiSum: number, capped = true): number {
  const pairScale = n > 1 ? (n * (n - 1)) / 2 / 66 : 0;
  const target = Math.max(0.5, COHESION.fullCredit * pairScale);
  const connected = n ? 1 - c.unlinked.length / n : 0;
  // `capped: false` (the floor's ablation check) reads the card's whole contribution: under the mechanical cap a brew's credit is
  // saturated, so removing a load-bearing card would not lower it.
  const credit = capped ? cohesionCredit(c.mech, c.measured, target) : Math.min(1, c.total / target);
  const v = SYNERGY.wCohesion * credit + SYNERGY.wConnected * connected - SYNERGY.antiPenalty * antiSum;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** Seeded random piles behind the floor's cohesion bar (calibration pass). */
export const COHESION_NULL = { seed: 20261130, piles: 300 } as const;
const nullCache = new WeakMap<CardDb, { max: number; p95: number }>();

/**
 * Cohesion that chance reaches in this pool and corpus (calibration pass, derived): the largest and 95th
 * percentile cohesion of `COHESION_NULL.piles` random 12-card piles of released cards drawn with
 * mulberry32(`COHESION_NULL.seed`). Measured co-play grows with the corpus, so a fixed bar would let random
 * piles through on a large snapshot; the floor's C6 bar is never below this maximum. Cached per database.
 */
export function cohesionNull(db: CardDb): { max: number; p95: number } {
  const hit = nullCache.get(db);
  if (hit) return hit;
  const pool = db.released().map((c) => c.defId).sort();
  const rnd = mulberry32(COHESION_NULL.seed);
  const totals: number[] = [];
  for (let k = 0; k < COHESION_NULL.piles && pool.length >= 12; k++) {
    const pile = new Set<string>();
    while (pile.size < 12) pile.add(pool[Math.floor(rnd() * pool.length)]!);
    totals.push(cohesionOf(db, [...pile]).total);
  }
  totals.sort((x, y) => x - y);
  const out = { max: totals[totals.length - 1] ?? 0, p95: totals[Math.floor(0.95 * (totals.length - 1))] ?? 0 };
  nullCache.set(db, out);
  return out;
}

/** Cohesion bar of a complete deck for this database: COHESION.bar, or the most cohesion seeded random piles reach when higher. */
export function cohesionBar(db: CardDb): number {
  return Math.max(COHESION.bar, Math.ceil(cohesionNull(db).max * 10 + 1e-9) / 10);
}

/** "A + B" for the heaviest pairs, labelled measured or by their edge. */
export function cohesionPairsText(db: CardDb, c: Cohesion, n = 3): string {
  return c.pairs.slice(0, n).map((p) => p.measured > p.mech && p.m
    ? `${nameOf(db, p.a)} + ${nameOf(db, p.b)} (together in ${p.m.observed} of ${p.m.clusters} list clusters, ${p.m.expected.toFixed(1)} expected by popularity, ${Math.round(p.m.share * 100)}% of the rarer card's clusters; measured)`
    : `${nameOf(db, p.a)} + ${nameOf(db, p.b)} (pair score ${(p.edge?.score ?? 0).toFixed(2)}, heuristic)`).join('; ');
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
/**
 * Axes whose payoff side is a CARRIER, not a need (features/axes.ts payoff rules): any On Reveal, Ongoing, End of
 * Turn or Activate card benefits from an amplifier, a deck puller or a "when you draw" card works on ordinary draws,
 * and a global buff works without fillers. Such a card has nothing missing when no enabler is in the deck.
 * Calibration pass: the coherence fix read "Anti-Polar Magneto rewards repeat on reveals" for every On Reveal card.
 */
const CARRIER_AXES: ReadonlySet<string> = new Set(['on_reveal_amp', 'ongoing_amp', 'end_of_turn_amp', 'activate_amp', 'deck_top', 'draw', 'go_wide']);

export function unsupportedPayoffs(db: CardDb, ids: readonly string[], stats: PairStats): { defId: string; axes: AxisId[] }[] {
  const out: { defId: string; axes: AxisId[] }[] = [];
  for (const id of ids) {
    const ax = db.features(id)?.axes ?? {};
    const payoffAxes = Object.entries(ax).filter(([k, v]) => v.p >= 1 && !CARRIER_AXES.has(k)).map(([k]) => k);
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
  gen_hand_hand: 'an effect that adds cards to your hand', copy_card_hand: 'an effect that copies a card into your hand',
  cost_reduce_hand: 'a Cost cut on cards in your hand', 'cond:spent_all_energy': 'a condition on spending all your Energy',
  'scale:cards_played': 'scaling with the cards you played', 'cond:played_n_cards': 'a condition on playing several cards in a turn',
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
