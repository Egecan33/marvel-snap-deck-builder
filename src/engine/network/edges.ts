/**
 * The interaction network (spec §8.3): rule firings -> fan-out weighted reasons -> one edge per pair.
 *
 * Weighting (HEURISTIC, adapted from the prototype, mechanics §4.1): a rule firing from A to B weighs
 *   strength / log2(2 + max(fanA, fanB))
 * where fanA is how many cards A reaches under that rule and fanB how many reach B, so narrow
 * relationships (Patriot x Hulk) outrank broad ones (Wong x any On Reveal card). The prototype used
 * the geometric mean sqrt(fanA * fanB); that let a filter matching a third of the pool (Shadowlands
 * Daredevil's "6 or more Power") count as narrow because each matched card had only one such
 * partner, and the edge audit judged those edges lenient, not true. The maximum treats a relation
 * as broad when either side is broad.
 * A pair counts each family once (its best rule, whichever direction), synergy and anti separately:
 *   synergy = min(1, sum of synergy families), anti = min(1, sum of anti families), score = synergy - anti.
 * Heuristic reasons (broad axes, cost or Power guesses) cannot make an edge strong on their own:
 * their synergy is capped just below STRONG unless a text-derived synergy reason also fires.
 */
import type { Card, CardEdge, CardFeatures, EdgeReason } from '../types';
import { axisEdges, node, type Node, type RawEdge } from './rules';
import { templateEdges } from './templates';

/** An edge is strong at this score or more (spec §8.3). */
export const STRONG = 0.5;
const HEURISTIC_CAP = STRONG - 0.01;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * Weight that maps to a score of 1 (HEURISTIC, calibrated on the edge audit): a narrow strength-3
 * rule (Patriot x Hulk, about 1.1) is strong alone; a broad one (Zabu x any 4-Cost card, about 0.67) is not.
 */
const NORM = 1.2;
/** Extra families add at half weight, so stacking generic rules cannot outrank one precise rule. */
const EXTRA = 0.5;

/** Best family value plus half of the others, normalised to 0..1. */
function combine(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => y - x);
  const raw = sorted[0]! + EXTRA * sorted.slice(1).reduce((s, v) => s + v, 0);
  return Math.min(1, raw / NORM);
}
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Raw rule firings over released cards that have features. */
export function ruleFirings(cards: readonly Card[], featuresById: Readonly<Record<string, CardFeatures>>): RawEdge[] {
  const nodes: Node[] = [];
  for (const c of cards) {
    const f = featuresById[c.defId];
    if (f) nodes.push(node(c, f));
  }
  nodes.sort((x, y) => (x.card.defId < y.card.defId ? -1 : x.card.defId > y.card.defId ? 1 : 0));
  return [...axisEdges(nodes), ...templateEdges(nodes)];
}

export function buildEdges(cards: readonly Card[], featuresById: Readonly<Record<string, CardFeatures>>): CardEdge[] {
  const raw = ruleFirings(cards, featuresById);
  // Deduplicate a rule firing twice for the same ordered pair (two clauses of one card).
  const seen = new Set<string>();
  const firings = raw.filter((e) => {
    const k = `${e.a}>${e.b}>${e.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const fanA = new Map<string, number>();
  const fanB = new Map<string, number>();
  for (const e of firings) {
    fanA.set(`${e.a}>${e.rule}`, (fanA.get(`${e.a}>${e.rule}`) ?? 0) + 1);
    fanB.set(`${e.b}>${e.rule}`, (fanB.get(`${e.b}>${e.rule}`) ?? 0) + 1);
  }

  interface Acc { a: string; b: string; reasons: (EdgeReason & { family: string; here: boolean })[] }
  const pairs = new Map<string, Acc>();
  for (const e of firings) {
    const fan = Math.max(fanA.get(`${e.a}>${e.rule}`) ?? 1, fanB.get(`${e.b}>${e.rule}`) ?? 1);
    const value = round3(e.strength / Math.log2(2 + fan));
    const key = pairKey(e.a, e.b);
    let acc = pairs.get(key);
    if (!acc) {
      acc = { a: e.a < e.b ? e.a : e.b, b: e.a < e.b ? e.b : e.a, reasons: [] };
      pairs.set(key, acc);
    }
    acc.reasons.push({ rule: e.rule, kind: e.kind, label: e.label, detail: e.detail, value, heuristic: e.heuristic, family: e.family, here: e.here });
  }

  const edges: CardEdge[] = [];
  for (const acc of pairs.values()) {
    const best = new Map<string, EdgeReason & { family: string; here: boolean }>();
    for (const r of acc.reasons) {
      const k = `${r.kind}:${r.family}`;
      const cur = best.get(k);
      if (!cur || r.value > cur.value || (r.value === cur.value && cur.heuristic && !r.heuristic)) best.set(k, r);
    }
    const counted = [...best.values()];
    const syn = counted.filter((r) => r.kind === 'synergy');
    const anti = counted.filter((r) => r.kind === 'anti');
    let synergy = combine(syn.map((r) => r.value));
    if (syn.length && syn.every((r) => r.heuristic)) synergy = Math.min(synergy, HEURISTIC_CAP);
    const antiSum = combine(anti.map((r) => r.value));
    const score = round3(synergy - antiSum);
    const reasons: EdgeReason[] = acc.reasons
      .sort((x, y) => y.value - x.value || x.rule.localeCompare(y.rule))
      .map(({ rule, kind, label, detail, value, heuristic }) => ({ rule, kind, label, detail, value, heuristic }));
    edges.push({
      a: acc.a, b: acc.b,
      synergy: round3(synergy), anti: round3(antiSum), score,
      strong: score >= STRONG,
      // The interaction that carries the edge (its best synergy reason, else any anti) needs a shared location.
      sameLocation: syn.length ? syn.reduce((m, r) => (r.value > m.value ? r : m)).here : anti.some((r) => r.here),
      reasons,
    });
  }
  edges.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return edges;
}
