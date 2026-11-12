import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeNetwork } from '@/engine/features/compute';
import { buildEdges, STRONG } from '@/engine/network/edges';
import type { CardEdge } from '@/engine/types';
import { card, fixtureDb, fixtureOverrides } from '../helpers/fixture-db';

interface Judged { a: string; b: string; rules: string[]; judgement: 'true' | 'lenient' | 'false'; note: string }
interface Audit {
  seed: number;
  precision: { strict: number; lenient: number; true: number; false: number };
  sample: Judged[];
  knownTrue: { a: string; b: string; why: string }[];
  knownUnrelated: { a: string; b: string }[];
  anti: { a: string; b: string; rule: string; why: string }[];
  heldOut: { seed: number; precision: { strict: number; lenient: number; true: number; false: number }; sample: Judged[] };
  reviewFalse: { a: string; b: string; why: string }[];
}
const audit = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/edge-audit.json', import.meta.url)), 'utf8')) as Audit;

const db = fixtureDb();
const edge = (a: string, b: string): CardEdge | undefined => db.edge(a, b);
const allEdges = (): CardEdge[] => {
  const seen = new Map<string, CardEdge>();
  for (const c of db.released()) for (const e of db.edges(c.defId)) seen.set(`${e.a}|${e.b}`, e);
  return [...seen.values()];
};

describe('edge audit (tests/fixtures/edge-audit.json)', () => {
  it('holds 60 hand-judged strong edges, 15 known-true and 15 known-unrelated pairs', () => {
    expect(audit.sample).toHaveLength(60);
    expect(audit.knownTrue).toHaveLength(15);
    expect(audit.knownUnrelated).toHaveLength(15);
    for (const s of audit.sample) expect(['true', 'lenient', 'false']).toContain(s.judgement);
    for (const s of audit.sample) expect(s.note.length, `${s.a}|${s.b}`).toBeGreaterThan(10);
  });

  it('records the strict precision measured on the sample, at or above the plan target of 85%', () => {
    const t = audit.sample.filter((s) => s.judgement === 'true').length;
    const ok = audit.sample.filter((s) => s.judgement !== 'false').length;
    expect(audit.precision.true).toBe(t);
    expect(audit.precision.strict).toBeCloseTo(t / 60, 3);
    expect(audit.precision.lenient).toBeCloseTo(ok / 60, 3);
    expect(t / 60).toBeGreaterThanOrEqual(0.85);
  });

  it('every sampled edge judged true or lenient is still strong; every one judged false no longer is', () => {
    for (const s of audit.sample) {
      const e = edge(s.a, s.b);
      if (s.judgement === 'false') expect(e?.strong ?? false, `${s.a}|${s.b} judged false`).toBe(false);
      else expect(e?.strong, `${s.a}|${s.b} judged ${s.judgement}`).toBe(true);
    }
  });

  it.each(audit.knownTrue.map((k) => [k.a, k.b, k.why]))('known-true %s + %s is strong', (a, b) => {
    const e = edge(a, b);
    expect(e?.strong, `${a}|${b}`).toBe(true);
    expect(e!.score).toBeGreaterThanOrEqual(STRONG);
  });

  it.each(audit.knownUnrelated.map((k) => [k.a, k.b]))('unrelated %s + %s has no strong edge', (a, b) => {
    expect(card(a) && card(b)).toBeTruthy();
    expect(edge(a, b)?.strong ?? false).toBe(false);
  });

  it('held-out sample (after the engine review) keeps its judgements and records its precision', () => {
    const h = audit.heldOut;
    expect(h.sample).toHaveLength(40);
    const inSample = new Set(audit.sample.map((s) => `${s.a}|${s.b}`));
    const t = h.sample.filter((s) => s.judgement === 'true').length;
    const ok = h.sample.filter((s) => s.judgement !== 'false').length;
    expect(h.precision.strict).toBeCloseTo(t / 40, 3);
    expect(h.precision.lenient).toBeCloseTo(ok / 40, 3);
    expect(h.precision.lenient).toBeGreaterThanOrEqual(0.95);
    for (const s of h.sample) {
      expect(inSample.has(`${s.a}|${s.b}`), `${s.a}|${s.b} is held out`).toBe(false);
      if (s.judgement === 'false') expect(edge(s.a, s.b)?.strong ?? false).toBe(false);
      else expect(edge(s.a, s.b)?.strong, `${s.a}|${s.b} judged ${s.judgement}`).toBe(true);
    }
  });

  it.each(audit.reviewFalse.map((k) => [k.a, k.b, k.why]))('engine review: %s + %s is not strong (%s)', (a, b) => {
    expect(card(a) && card(b)).toBeTruthy();
    expect(edge(a, b)?.strong ?? false).toBe(false);
  });

  it.each(audit.anti.map((k) => [k.a, k.b, k.rule]))('anti-synergy %s + %s (%s)', (a, b, rule) => {
    const e = edge(a, b);
    expect(e, `${a}|${b}`).toBeDefined();
    expect(e!.anti).toBeGreaterThan(0);
    expect(e!.strong).toBe(false);
    expect(e!.reasons.some((r) => r.kind === 'anti' && r.rule === rule)).toBe(true);
  });
});

describe('network rules (spec §8.3)', () => {
  it('scores are in -1..1, strong exactly at STRONG or more, no NaN', () => {
    const edges = allEdges();
    expect(edges.length).toBeGreaterThan(5000);
    for (const e of edges) {
      expect(Number.isFinite(e.score)).toBe(true);
      expect(e.synergy).toBeGreaterThanOrEqual(0);
      expect(e.synergy).toBeLessThanOrEqual(1);
      expect(e.anti).toBeGreaterThanOrEqual(0);
      expect(e.anti).toBeLessThanOrEqual(1);
      expect(e.strong).toBe(e.score >= STRONG);
      expect(e.a < e.b).toBe(true);
      expect(e.reasons.length).toBeGreaterThan(0);
    }
  });

  it('a heuristic reason alone never makes a strong edge', () => {
    for (const e of allEdges()) {
      const syn = e.reasons.filter((r) => r.kind === 'synergy');
      if (syn.length && syn.every((r) => r.heuristic)) expect(e.strong, `${e.a}|${e.b}`).toBe(false);
    }
    // Shuri doubles the next card's Power; Hulk is a big target, but only by the heuristic Power guess.
    const e = edge('Shuri', 'Hulk');
    expect(e?.reasons.every((r) => r.heuristic)).toBe(true);
    expect(e?.strong).toBe(false);
  });

  it('every reason names both cards and quotes their text', () => {
    for (const e of allEdges().slice(0, 2000)) {
      const a = card(e.a), b = card(e.b);
      for (const r of e.reasons) {
        expect(r.detail, r.rule).toContain(a.name);
        expect(r.detail, r.rule).toContain(b.name);
        expect(r.label.length).toBeGreaterThan(10);
        expect(Number.isFinite(r.value) && r.value > 0).toBe(true);
      }
    }
    const patriot = edge('Patriot', 'Hulk')!;
    expect(patriot.reasons[0]!.detail).toContain('Your cards with no abilities have +2 Power');
    expect(patriot.reasons[0]!.detail).toContain('Hulk (6/14, no ability)');
  });

  it('marks "here"-scoped amplifiers as needing a shared location', () => {
    expect(edge('Wong', 'Agent13')?.sameLocation).toBe(true);
    expect(edge('Cosmo', 'Agent13')?.sameLocation).toBe(true);
    expect(edge('Patriot', 'Hulk')?.sameLocation).toBe(false);
  });

  it('weights narrow relationships above broad ones', () => {
    // Patriot x Hulk (7 no-ability cards) outranks Wong x any On Reveal card (about 250).
    expect(edge('Patriot', 'Hulk')!.score).toBeGreaterThan(edge('Wong', 'Agent13')!.score);
    expect(edge('Wong', 'Agent13')!.strong).toBe(false);
  });

  it('does not read enemy-side effects as own-side synergy (Review focus 2)', () => {
    // Shang-Chi destroys an enemy card: no destroy synergy with Deadpool's When Destroyed.
    expect(edge('ShangChi', 'Deadpool')?.reasons.some((r) => r.rule === 'axis:destroy') ?? false).toBe(false);
    // Black Bolt discards from the opponent's hand: no discard synergy with Apocalypse.
    expect(edge('BlackBolt', 'Apocalypse')?.reasons.some((r) => r.rule.startsWith('axis:discard')) ?? false).toBe(false);
    // Killmonger's "ALL 1-Cost" also hits your own 1-drops.
    expect(edge('Killmonger', 'MistyKnight')?.reasons.some((r) => r.rule === 'mass:hits_own')).toBe(true);
  });

  it('is deterministic and pure', () => {
    const cards = db.released().slice(0, 120);
    const one = computeNetwork({ cards, meta: db.meta(), overrides: fixtureOverrides() });
    const two = computeNetwork({ cards, meta: db.meta(), overrides: fixtureOverrides() });
    expect(two).toEqual(one);
    const byId = Object.fromEntries(one.features.map((f) => [f.defId, f]));
    expect(buildEdges(cards, byId)).toEqual(one.edges);
    expect(buildEdges([], {})).toEqual([]);
  });

  it('covers the released pool: edges only between released cards', () => {
    const released = new Set(db.released().map((c) => c.defId));
    for (const e of allEdges()) {
      expect(released.has(e.a)).toBe(true);
      expect(released.has(e.b)).toBe(true);
    }
  });
});
