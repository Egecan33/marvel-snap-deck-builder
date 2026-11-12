/**
 * Search core of the builder (spec §14 steps 2-4; theory §4.5): a fast evaluator over a fixed candidate
 * pool, greedy construction, seeded simulated annealing over one-card swaps with constraint penalties,
 * and an archive keyed by primary plan x curve shape. Deterministic for a seed: candidates are iterated
 * in a fixed order and every random choice comes from mulberry32.
 *
 * The evaluator recomputes a 12-card deck from precomputed pool matrices (66 pair lookups, 18 plan
 * families, list overlap through the card -> list index), about a microsecond scale per deck, so the
 * annealer can afford thousands of proposals. It reproduces exactly: pair statistics, strong pairs,
 * linked/unlinked cards, the novelty formula of novelty.ts (unrounded), plan matching of plans/detect.ts
 * (assembly odds, primary/secondary, off-plan cards) and quality checks. It does NOT run the energy model:
 * energy is a curve PROXY inside the search (HEURISTIC, below), and every deck the builder returns is
 * re-checked with the exact floor (floor.ts) afterwards.
 */
import { pAtLeastOne, pOneOfEach } from '../maths/hypergeo';
import { mulberry32 } from '../maths/rng';
import { coplay, corpusOf, rarity } from '../novelty/clusters';
import { NOVELTY_WEIGHTS } from '../novelty/novelty';
import { foldInfo, matchesAny, PLAN_THRESHOLD } from '../plans/detect';
import { CONSISTENCY, PLAN, QUALITY, RATING_WEIGHTS, RESILIENCE, SYNERGY, COHERENCE } from '../rating/constants';
import type { CardDb, PlanDef } from '../types';
import { FLOOR } from './floor';

/** Search budget and penalty weights (HEURISTIC; theory §4.5 gives 20,000 proposals, temperature 8 to 0.05). */
export const SEARCH = {
  proposals: 8000,
  tStart: 8,
  tEnd: 0.05,
  /** Objective points per unit of constraint violation. */
  penalty: 12,
  /** Objective points lost by a chain for landing in a cell an earlier chain already holds (diversity). */
  occupiedPenalty: 12,
  /** Probability that a proposal draws the incoming card from a deck card's linked neighbours. */
  neighbourBias: 0.65,
  /** Candidates kept per archive cell before the exact check. */
  perCell: 5,
  /** Brew mode: the band a returned brew must reach (spec §13: 60+ is off-meta). */
  minNovelty: 60,
  /** Energy proxy: average effective cost range and cheap-card counts (theory §5: 2.33 is the least average
   * cost that can spend 21 energy from 9 cards; reference curve 2,3,3 cards at cost 1..3). */
  minAvgCost: 2.4,
  maxAvgCost: 4.2,
  minCostAtMost2: 3,
  minCostAtMost3: 5,
} as const;

/** Curve shape of the archive (theory §4.5: average cost below 2.6, 2.6 to 3.3, above 3.3). */
export function curveShape(avgCost: number): 'low' | 'mid' | 'high' {
  return avgCost < 2.6 ? 'low' : avgCost <= 3.3 ? 'mid' : 'high';
}

export interface Ev {
  n: number;
  syn: number;
  antiSum: number;
  strong: number;
  linked: number;
  unlinked: number;
  loose: number;
  meanQ: number;
  weak: number;
  o1: number;
  novelty: number;
  primary: { k: number; asm: number; strength: number; eff: number; enablers: number[]; payoffs: number[]; single: boolean } | null;
  secondary: { k: number; strength: number; eff: number } | null;
  bestAsm: number;
  bestStrength: number;
  offPlan: number;
  avgCost: number;
  avgEff: number;
  cheap2: number;
  cheap3: number;
  partnersShort: number;
  withoutShort: number;
  gemBonus: number;
  /** Positive pair scores between fixed (build-around) cards and the rest. */
  lockSyn: number;
  /** C5 cards that are members of the primary plan. */
  locksInPlan: number;
  violations: number;
  cell: string;
}

export interface SpaceOptions {
  mode: 'brew' | 'tuned';
  /** Cards the search never removes (locks and the surprise seed pair). */
  fixed: string[];
  /** Cards C5 applies to (brew mode locks). */
  c5: string[];
  maxShared: number | null;
  wildcards: number;
}

export interface Space {
  ids: string[];
  index: Map<string, number>;
  evaluate(deck: readonly number[]): Ev;
  objective(ev: Ev): number;
  /** Pool cards with a pair of `FLOOR.linkedEdge` or more to card i, best first. */
  neighbours: number[][];
  fixed: number[];
}

interface PlanRow { def: PlanDef; role: Uint8Array; exposure: number }

/** Builds the evaluator over a pool. `ids` must be unique; order is kept. */
export function createSpace(db: CardDb, ids: readonly string[], opts: SpaceOptions): Space {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const corpus = corpusOf(db);
  const meta = db.meta();
  const hasMeta = !!meta.info();
  const score = new Float64Array(n * n);
  const anti = new Float64Array(n * n);
  const strongM = new Uint8Array(n * n);
  const uM = new Float64Array(n * n);
  const gemM = new Float64Array(n * n);
  const q = new Float64Array(n);
  const rar = new Float64Array(n);
  const tech = new Uint8Array(n);
  const cost = new Float64Array(n);
  const eff = new Float64Array(n);
  const extraSeen = new Float64Array(n);
  const lists: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i]!;
    const c = db.get(id)!;
    const f = db.features(id);
    q[i] = f?.quality ?? 50;
    rar[i] = rarity(corpus.listShare(id));
    tech[i] = (f?.techRoles.length ?? 0) > 0 ? 1 : 0;
    cost[i] = c.cost;
    eff[i] = Math.max(0, c.cost - Math.max(0, f?.model.selfDiscount ?? 0));
    extraSeen[i] = Math.max(0, f?.model.extraSeen ?? 0);
    lists.push(hasMeta ? Int32Array.from(meta.listsWith(id)) : new Int32Array(0));
    for (const e of db.edges(id)) {
      if (e.a !== id || e.a === e.b) continue;
      const j = index.get(e.b);
      if (j === undefined) continue;
      for (const [x, y] of [[i, j], [j, i]] as const) {
        score[x * n + y] = e.score;
        anti[x * n + y] = e.anti;
        strongM[x * n + y] = e.strong ? 1 : 0;
      }
      if (e.strong) {
        const ev = coplay(corpus, [e.a, e.b]);
        const s = Math.max(0, Math.min(1, e.score));
        const g = 100 * s * ev.unexplored * Math.sqrt(Math.max(0, Math.min(1, q[i]! / 100)) * Math.max(0, Math.min(1, (db.features(e.b)?.quality ?? 50) / 100)));
        uM[i * n + j] = uM[j * n + i] = ev.unexplored;
        gemM[i * n + j] = gemM[j * n + i] = g;
      }
    }
  }
  const neighbours: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i && score[i * n + j]! >= FLOOR.linkedEdge!) row.push(j);
    row.sort((a, b) => score[i * n + b]! - score[i * n + a]! || a - b);
    neighbours.push(row);
  }

  const plans: PlanRow[] = db.plans().map((def) => {
    const role = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = db.get(ids[i]!)!;
      const f = db.features(ids[i]!);
      const e = matchesAny(c, f, db, def.enablerTraits);
      const p = matchesAny(c, f, db, def.payoffTraits);
      role[i] = e && p ? 3 : e ? 1 : p ? 2 : 0;
    }
    let exposure = 0;
    if (hasMeta) {
      let keep = 1;
      for (const r of def.foldsTo) keep *= 1 - (foldInfo(db, r).fieldShare ?? 0);
      exposure = 1 - keep;
    }
    return { def, role, exposure };
  });

  const asmMemo = new Map<number, number>();
  function assembly(k: number, e: number, p: number, extra: number, size: number): number {
    const key = ((k * 16 + e) * 16 + p) * 64 + extra * 16 + Math.min(15, size);
    const hit = asmMemo.get(key);
    if (hit !== undefined) return hit;
    const def = plans[k]!.def;
    const a = def.minEnablers === 0 && e === 0
      ? pAtLeastOne(p, def.keyTurn, extra, size)
      : def.minPayoffs === 0 && p === 0
        ? pAtLeastOne(e, def.keyTurn, extra, size)
        : pOneOfEach(e, p, def.keyTurn, extra, size);
    asmMemo.set(key, a);
    return a;
  }

  interface PM { k: number; asm: number; strength: number; members: number[]; enablers: number[]; payoffs: number[] }
  /** plans/detect.ts matchPlan over pool indexes, all families, sorted like detectPlans. */
  function matchAll(deck: readonly number[]): PM[] {
    const out: PM[] = [];
    const size = Math.max(12, deck.length);
    for (let k = 0; k < plans.length; k++) {
      const { def, role } = plans[k]!;
      const enablers: number[] = [];
      const payoffs: number[] = [];
      const dual: number[] = [];
      let draws = 0;
      for (const i of deck) {
        const r = role[i]!;
        if (r === 3) dual.push(i);
        else if (r === 1) enablers.push(i);
        else if (r === 2) payoffs.push(i);
        if (cost[i]! < def.keyTurn) draws += extraSeen[i]!;
      }
      for (const i of dual) {
        if (def.minEnablers > 0 && enablers.length < def.minEnablers && payoffs.length >= Math.max(1, def.minPayoffs)) enablers.push(i);
        else payoffs.push(i);
      }
      if (enablers.length < def.minEnablers || payoffs.length < def.minPayoffs || enablers.length + payoffs.length === 0) continue;
      const extra = Math.min(3, Math.floor(draws / 2));
      const asm = assembly(k, Math.min(15, enablers.length), Math.min(15, payoffs.length), extra, size);
      out.push({ k, asm, strength: Math.min(1, Math.max(0, asm * def.payoffWeight)), members: [...enablers, ...payoffs], enablers, payoffs });
    }
    out.sort((x, y) => y.strength - x.strength || y.asm - x.asm || (plans[x.k]!.def.id < plans[y.k]!.def.id ? -1 : 1));
    return out;
  }

  const fixed = opts.fixed.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  const c5 = opts.c5.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  const fixedSet = new Set(fixed);
  const listCount = new Int32Array(hasMeta ? meta.lists().length : 0);
  const touched: number[] = [];

  function linkage(pm: PM): number {
    let pairs = 0;
    let linked = 0;
    for (const e of pm.enablers) for (const p of pm.payoffs) {
      if (e === p) continue;
      pairs++;
      if (score[e * n + p]! >= SYNERGY.weakEdge) linked++;
    }
    return pairs ? linked / pairs : 0;
  }

  /** rate.ts synergy sub-score value of `deck` without card `skip` (-1: none); see floor.ts synergyValue. */
  function synergyValue(deck: readonly number[], skip: number): number {
    const ids = skip < 0 ? deck : deck.filter((i) => i !== skip);
    const m = ids.length;
    let syn = 0;
    let strong = 0;
    let antiSum = 0;
    const link = new Uint8Array(m);
    for (let x = 0; x < m; x++) for (let y = x + 1; y < m; y++) {
      const a = ids[x]!;
      const b = ids[y]!;
      const sc = score[a * n + b]!;
      if (sc > 0) syn += sc;
      if (anti[a * n + b]! > 0) antiSum += anti[a * n + b]!;
      if (strongM[a * n + b]) strong++;
      if (sc >= SYNERGY.weakEdge) link[x] = link[y] = 1;
    }
    const pairScale = m > 1 ? (m * (m - 1)) / 2 / 66 : 0;
    let orphans = 0;
    for (let x = 0; x < m; x++) if (!link[x]) orphans++;
    const v = SYNERGY.wSum * Math.min(1, syn / Math.max(0.5, SYNERGY.sumTarget * pairScale)) + SYNERGY.wStrong * Math.min(1, strong / Math.max(1, SYNERGY.strongTarget * pairScale))
      + SYNERGY.wConnected * (m ? 1 - orphans / m : 0) - SYNERGY.antiPenalty * antiSum;
    return Math.max(0, Math.min(1, v));
  }

  function evaluate(deck: readonly number[]): Ev {
    const m = deck.length;
    let syn = 0;
    let antiSum = 0;
    let strong = 0;
    let linkedPairs = 0;
    const deg = new Int32Array(m);
    const link = new Uint8Array(m);
    let pnNum = 0;
    let pnDen = 0;
    let lockSyn = 0;
    const bestGem = new Float64Array(m);
    for (let x = 0; x < m; x++) {
      const a = deck[x]!;
      for (let y = x + 1; y < m; y++) {
        const b = deck[y]!;
        const s = score[a * n + b]!;
        if (s > 0) {
          syn += s;
          if (fixedSet.has(a) || fixedSet.has(b)) lockSyn += s;
        }
        const an = anti[a * n + b]!;
        if (an > 0) antiSum += an;
        if (s >= FLOOR.linkedEdge!) {
          linkedPairs++;
          link[x] = link[y] = 1;
        }
        if (strongM[a * n + b]) {
          strong++;
          deg[x]!++;
          deg[y]!++;
          const sc = Math.max(0, Math.min(1, s));
          pnNum += sc * uM[a * n + b]!;
          pnDen += sc;
          const g = gemM[a * n + b]!;
          if (g > bestGem[x]!) bestGem[x] = g;
          if (g > bestGem[y]!) bestGem[y] = g;
        }
      }
    }
    // Novelty (novelty.ts formula, unrounded).
    let o1 = 0;
    for (const i of deck) for (const l of lists[i]!) {
      if (listCount[l] === 0) touched.push(l);
      const v = ++listCount[l]!;
      if (v > o1) o1 = v;
    }
    for (const l of touched) listCount[l] = 0;
    touched.length = 0;
    let cr = 0;
    for (let x = 0; x < m; x++) if (deg[x]! > 0 || tech[deck[x]!]) cr += rar[deck[x]!]!;
    cr = Math.min(1, cr / Math.max(12, m));
    const ld = 1 - Math.min(12, o1) / 12;
    const pn = pnDen > 0 ? pnNum / pnDen : 0;
    const novelty = 100 * (NOVELTY_WEIGHTS.listDistance * ld + NOVELTY_WEIGHTS.connectedRarity * cr + NOVELTY_WEIGHTS.packageNovelty * pn);

    // Quality.
    let qSum = 0;
    let weak = 0;
    for (let x = 0; x < m; x++) {
      const qq = q[deck[x]!]!;
      qSum += qq;
      if (qq < FLOOR.cardQuality! && deg[x]! < FLOOR.waiverStrong!) weak++;
    }
    const meanQ = m ? qSum / m : 0;

    // Plans.
    const all = matchAll(deck);
    const qualified = all.filter((p) => p.asm >= PLAN_THRESHOLD);
    const pr = qualified[0];
    const se = qualified[1];
    const onPlan = new Set<number>([...(pr?.members ?? []), ...(se?.members ?? [])]);
    let offPlan = 0;
    let loose = 0;
    let unlinked = 0;
    for (let x = 0; x < m; x++) {
      const off = !onPlan.has(deck[x]!);
      if (off) offPlan++;
      if (!link[x]) {
        unlinked++;
        if (off) loose++;
      }
    }
    const effOf = (p: PM): number => p.strength * (1 - PLAN.linkageWeight + PLAN.linkageWeight * linkage(p));
    const primary = pr ? {
      k: pr.k, asm: pr.asm, strength: pr.strength, eff: effOf(pr), enablers: pr.enablers, payoffs: pr.payoffs,
      single: (pr.payoffs.length === 1 && plans[pr.k]!.def.minPayoffs > 0) || (pr.enablers.length === 1 && plans[pr.k]!.def.minEnablers > 0)
        || (plans[pr.k]!.def.minEnablers === 0 && pr.enablers.length === 0 && pr.payoffs.length === 1),
    } : null;
    const secondary = se ? { k: se.k, strength: se.strength, eff: effOf(se) } : null;

    // Curve proxy.
    let cSum = 0;
    let eSum = 0;
    let cheap2 = 0;
    let cheap3 = 0;
    for (const i of deck) {
      cSum += cost[i]!;
      eSum += eff[i]!;
      if (eff[i]! <= 2) cheap2++;
      if (eff[i]! <= 3) cheap3++;
    }
    const avgCost = m ? cSum / m : 0;
    const avgEff = m ? eSum / m : 0;

    // C5 build-around.
    let partnersShort = 0;
    let withoutShort = 0;
    let decoration = 0;
    for (const lock of c5) {
      const x = deck.indexOf(lock);
      if (x < 0) continue;
      partnersShort += Math.max(0, FLOOR.buildAroundPartners! - deg[x]!);
      const rest = deck.filter((i) => i !== lock);
      const best = matchAll(rest).find((p) => p.asm >= PLAN_THRESHOLD);
      if (!best || best.asm < FLOOR.planAssembly!) withoutShort += 1;
      // Ablation (floor.ts): plan strength or the synergy sub-score must drop without the card.
      const dPlan = (pr?.strength ?? 0) - (best?.strength ?? 0);
      if (!(dPlan > 1e-9) && !(synergyValue(deck, -1) - synergyValue(deck, lock) > 1e-9)) decoration++;
    }

    // Wildcards: the best k gem scores of non-fixed cards (theory §4.6).
    let gemBonus = 0;
    if (opts.mode === 'brew' && opts.wildcards > 0) {
      const g: number[] = [];
      for (let x = 0; x < m; x++) if (!fixedSet.has(deck[x]!)) g.push(bestGem[x]!);
      g.sort((a, b) => b - a);
      for (let x = 0; x < Math.min(opts.wildcards, g.length); x++) gemBonus += g[x]!;
    }

    // Violations of the floor proxies (and of the brew requirements), in comparable units.
    const alt = linkedPairs >= FLOOR.linkedPairsAlt!;
    const bestAsm = all.reduce((s, p) => Math.max(s, p.asm), 0);
    let v = 0;
    if (!alt) {
      v += Math.max(0, FLOOR.strongPairs! - strong);
      if (!pr || pr.asm < FLOOR.planAssembly!) v += 1 + 5 * Math.max(0, FLOOR.planAssembly! - bestAsm);
    }
    v += Math.max(0, unlinked - FLOOR.unlinkedCards!);
    v += Math.max(0, loose - FLOOR.looseCards!);
    v += Math.max(0, FLOOR.meanQuality! - meanQ) / 4;
    v += Math.max(0, weak - FLOOR.weakCards!);
    v += 3 * Math.max(0, SEARCH.minAvgCost - avgEff) + Math.max(0, avgEff - SEARCH.maxAvgCost);
    v += Math.max(0, SEARCH.minCostAtMost2 - cheap2) + Math.max(0, SEARCH.minCostAtMost3 - cheap3);
    v += partnersShort + 2 * withoutShort + 2 * decoration;
    if (opts.mode === 'brew') {
      if (opts.maxShared !== null) v += Math.max(0, o1 - opts.maxShared);
      v += Math.max(0, SEARCH.minNovelty - novelty) / 4;
      // A brew needs a detected plan (not only the network alternative): it is what the explanations name.
      if (!pr) v += 1;
    }
    const cell = `${pr ? plans[pr.k]!.def.id : 'none'}|${curveShape(avgCost)}`;
    const locksInPlan = pr ? c5.filter((i) => pr.members.includes(i)).length : 0;
    return {
      n: m, syn, antiSum, strong, linked: linkedPairs, unlinked, loose, meanQ, weak, o1, novelty, primary, secondary,
      bestAsm, bestStrength: all[0]?.strength ?? 0, offPlan, avgCost, avgEff, cheap2, cheap3, partnersShort, withoutShort, gemBonus, lockSyn, locksInPlan, violations: v, cell,
    };
  }

  /**
   * Tuned objective: the rating of rate.ts recomputed from the evaluator (HEURISTIC proxy: energy is the
   * curve proxy, coherence ignores unsupported payoffs and restrictions, resilience ignores the second
   * plan credit). The builder ranks its final decks by the exact `rateDeck`.
   */
  function fastRating(ev: Ev): number {
    const clamp = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
    const synV = SYNERGY.wSum * Math.min(1, ev.syn / SYNERGY.sumTarget) + SYNERGY.wStrong * Math.min(1, ev.strong / SYNERGY.strongTarget)
      + SYNERGY.wConnected * (1 - ev.unlinked / Math.max(1, ev.n)) - SYNERGY.antiPenalty * ev.antiSum;
    let planV: number;
    let consV = 0;
    let resV = 0;
    if (ev.primary) {
      const p = ev.primary;
      const pq = p.payoffs.length ? p.payoffs.reduce((s, i) => s + q[i]!, 0) / p.payoffs.length : 50;
      const sv = ev.secondary ? clamp((ev.secondary.eff - PLAN.zeroStrength) / (PLAN.fullStrength - PLAN.zeroStrength)) : 0;
      planV = PLAN.wPrimary * clamp((p.eff - PLAN.zeroStrength) / (PLAN.fullStrength - PLAN.zeroStrength))
        + PLAN.wPayoffQuality * clamp((pq - PLAN.payoffQualityLow) / (PLAN.payoffQualityHigh - PLAN.payoffQualityLow)) + PLAN.wSecondary * sv;
      consV = clamp((p.asm - CONSISTENCY.low) / (CONSISTENCY.high - CONSISTENCY.low)) - (p.single ? CONSISTENCY.singleCardPenalty : 0);
      resV = hasMeta ? (1 - RESILIENCE.exposureWeight * plans[p.k]!.exposure) * clamp(p.eff / PLAN.fullStrength) : RESILIENCE.noMeta;
    } else {
      planV = PLAN.noPrimaryCredit * clamp(ev.bestStrength / PLAN.fullStrength);
    }
    const energyV = clamp(1 - 0.5 * (Math.max(0, SEARCH.minAvgCost - ev.avgEff) + Math.max(0, SEARCH.minCostAtMost3 - ev.cheap3) / 2 + Math.max(0, SEARCH.minCostAtMost2 - ev.cheap2) / 2));
    const qualV = clamp((ev.meanQ - QUALITY.meanLow) / (QUALITY.meanHigh - QUALITY.meanLow)) - QUALITY.tailPenalty * ev.weak;
    const cohV = 1 - COHERENCE.offPlanPenalty * Math.max(0, ev.offPlan - COHERENCE.offPlanAllowed);
    return RATING_WEIGHTS.synergy * clamp(synV) + RATING_WEIGHTS.plan * clamp(planV) + RATING_WEIGHTS.energy * energyV
      + RATING_WEIGHTS.consistency * clamp(consV) + RATING_WEIGHTS.quality * clamp(qualV) + RATING_WEIGHTS.resilience * clamp(resV)
      + RATING_WEIGHTS.coherence * clamp(cohV);
  }

  /**
   * Brew: Novelty + 2 x SynergySum (theory §4.5) + wildcard gem bonus / 10, plus (HEURISTIC, so the
   * build-around card is the centre and not decoration) its pair scores once more and 10 points when it
   * is in the primary plan. Tuned: the rating proxy. Minus penalties.
   */
  function objective(ev: Ev): number {
    const base = opts.mode === 'brew' ? ev.novelty + 2 * ev.syn + ev.gemBonus / 10 + ev.lockSyn + 10 * ev.locksInPlan : fastRating(ev);
    return base - SEARCH.penalty * ev.violations;
  }

  return { ids: [...ids], index, evaluate, objective, neighbours, fixed };
}

export interface Candidate { deck: number[]; F: number; ev: Ev }
export interface Archive { cells: Map<string, Candidate[]> }

const keyOf = (deck: readonly number[]): string => [...deck].sort((a, b) => a - b).join(',');

export function offer(archive: Archive, deck: number[], ev: Ev, F: number): void {
  if (ev.violations > 1e-9 || ev.n !== 12) return;
  let list = archive.cells.get(ev.cell);
  if (!list) archive.cells.set(ev.cell, (list = []));
  const key = keyOf(deck);
  if (list.some((c) => keyOf(c.deck) === key)) return;
  if (list.length >= SEARCH.perCell && F <= list[list.length - 1]!.F) return;
  list.push({ deck: [...deck], F, ev });
  list.sort((a, b) => b.F - a.F || (keyOf(a.deck) < keyOf(b.deck) ? -1 : 1));
  if (list.length > SEARCH.perCell) list.pop();
}

/**
 * Greedy construction (theory §4.5 step 2, HEURISTIC marginal): from the fixed cards add, until 12, the
 * pool card with the best objective of the partial deck; ties by pool order.
 */
export function greedy(space: Space, start: readonly number[], size = 12): number[] {
  const deck = [...start];
  const inDeck = new Set(deck);
  while (deck.length < size) {
    let best = -1;
    let bestF = -Infinity;
    for (let i = 0; i < space.ids.length; i++) {
      if (inDeck.has(i)) continue;
      deck.push(i);
      const F = space.objective(space.evaluate(deck));
      deck.pop();
      if (F > bestF) {
        bestF = F;
        best = i;
      }
    }
    if (best < 0) break;
    deck.push(best);
    inDeck.add(best);
  }
  return deck;
}

/**
 * Seeded simulated annealing over one-card swaps (theory §4.5 step 3). Fixed cards never leave. Every
 * accepted zero-violation deck is offered to the archive. Returns the best deck seen (by objective).
 */
export function anneal(space: Space, start: readonly number[], seed: number, proposals: number, archive: Archive, occupied: ReadonlySet<string> = new Set()): Candidate {
  const rnd = mulberry32(seed);
  const fixed = new Set(space.fixed);
  const cur = [...start];
  const free = cur.map((_, i) => i).filter((i) => !fixed.has(cur[i]!));
  const obj = (ev: Ev): number => space.objective(ev) - (occupied.has(ev.cell) ? SEARCH.occupiedPenalty : 0);
  let curEv = space.evaluate(cur);
  let curF = obj(curEv);
  offer(archive, cur, curEv, space.objective(curEv));
  let best: Candidate = { deck: [...cur], F: curF, ev: curEv };
  if (free.length === 0 || space.ids.length <= cur.length) return best;
  const inDeck = new Set(cur);
  const N = Math.max(1, proposals);
  for (let it = 0; it < N; it++) {
    const T = SEARCH.tStart * Math.pow(SEARCH.tEnd / SEARCH.tStart, it / Math.max(1, N - 1));
    const slot = free[Math.floor(rnd() * free.length)]!;
    let incoming: number;
    if (rnd() < SEARCH.neighbourBias) {
      const anchor = cur[Math.floor(rnd() * cur.length)]!;
      const nb = space.neighbours[anchor]!;
      incoming = nb.length ? nb[Math.floor(rnd() * Math.min(nb.length, 25))]! : Math.floor(rnd() * space.ids.length);
    } else {
      incoming = Math.floor(rnd() * space.ids.length);
    }
    if (inDeck.has(incoming)) continue;
    const outgoing = cur[slot]!;
    cur[slot] = incoming;
    const ev = space.evaluate(cur);
    const F = obj(ev);
    if (F >= curF || rnd() < Math.exp((F - curF) / T)) {
      inDeck.delete(outgoing);
      inDeck.add(incoming);
      curEv = ev;
      curF = F;
      offer(archive, cur, ev, space.objective(ev));
      if (F > best.F) best = { deck: [...cur], F, ev };
    } else {
      cur[slot] = outgoing;
    }
  }
  return best;
}
