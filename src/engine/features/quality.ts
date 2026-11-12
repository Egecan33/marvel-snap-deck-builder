/**
 * Card quality, 0-100, deck-independent (spec §8.4). HEURISTIC throughout: the weights below are
 * judgement, labelled as such in the UI. Three parts, each in quality points around a base of 50:
 *
 *  - stat:     printed Power against the pool mean for its cost (theory §1.5 measured the means;
 *              here they are recomputed from the synced pool), minus a fixed amount for drawbacks
 *  - text:     modelled power-equivalents of the card's effects, halved for conditional effects
 *  - measured: the card's win-rate delta against the snapshot baseline, shrunk toward zero with a
 *              prior worth 50 games per list (meta §5), as at most +/-10 points; 0 without data
 */
import type { Card, Clause, MetaCardStat } from '../types';
import { isDrawback } from './traits';

export interface PoolStats { meanPower: Record<number, number>; cards: number }

/** Cost bucket used for the pool mean: 0..6, and 7 for 7 or more. */
const bucket = (cost: number): number => Math.max(0, Math.min(7, Math.round(cost)));

/** Mean printed Power per cost over released non-skill cards (skills have no Power). */
export function poolStatsOf(cards: readonly Card[]): PoolStats {
  const sum = new Map<number, { s: number; n: number }>();
  let n = 0;
  for (const c of cards) {
    if (c.cardClass !== 'released' || c.isSkill) continue;
    const b = bucket(c.cost);
    const cur = sum.get(b) ?? { s: 0, n: 0 };
    cur.s += c.power;
    cur.n += 1;
    sum.set(b, cur);
    n += 1;
  }
  const meanPower: Record<number, number> = {};
  for (let b = 0; b <= 7; b++) {
    const own = sum.get(b);
    if (own && own.n > 0) { meanPower[b] = own.s / own.n; continue; }
    // No card at this cost: borrow the nearest cost that has cards (a pool of 0 cards gives 0).
    let found = 0;
    for (let d = 1; d <= 7; d++) {
      const near = sum.get(b - d) ?? sum.get(b + d);
      if (near && near.n > 0) { found = near.s / near.n; break; }
    }
    meanPower[b] = found;
  }
  return { meanPower, cards: n };
}

/** Points per power-equivalent (HEURISTIC). */
const POINTS_PER_POWER = 4;
const TEXT_CAP = { min: -6, max: 10 };
const DRAWBACK_POWER = 2;

const MANY = /^(own_here|own_anywhere|own_other_locations|own_hand|own_deck|own)$/;

/** Power-equivalent of one effect (HEURISTIC). Conditional and scaling factors are applied by the caller. */
function effectValue(kind: string, target: string, magnitude: number | null, card: Card): number {
  const m = magnitude ?? 0;
  const enemy = target.startsWith('enemy');
  const ownOther = MANY.test(target) || target === 'own_next_played' || target === 'own_played_card' || target === 'own_drawn_card';
  switch (kind) {
    case 'buff':
      if (target === 'self') return m;
      if (enemy) return -m;
      return ownOther ? m * (MANY.test(target) ? 2 : 1) : m;
    case 'afflict':
      if (target === 'self' || target.startsWith('own')) return -m;
      return enemy ? Math.max(m, 1) : 0;
    case 'power_double': return target === 'self' ? Math.max(card.power, 2) * 0.5 : 3;
    case 'power_steal': return Math.max(m, 1) * 2;
    case 'power_absorb': return 2;
    case 'destroy': return enemy ? 3 : 0;
    case 'draw': case 'gen_hand': case 'copy_card': return 1.5;
    case 'gen_board': return target === 'own' ? Math.max(m, 2) : 0;
    case 'summon': case 'resurrect': return 3;
    case 'energy_gain': case 'energy_max': return target === 'own_player' ? 2 : 0;
    case 'cost_reduce': return target === 'self' ? Math.max(m, 1) : enemy ? 0 : Math.max(m, 1) * 1.5;
    case 'cost_increase': return enemy ? 1.5 : 0;
    case 'silence': case 'steal_text': return enemy ? 2 : 0;
    case 'loc_power': return target.startsWith('own') ? m * 0.5 : -m;
    case 'repeat_on_reveal': case 'repeat_ongoing': case 'repeat_eot': case 'repeat_activate': case 'copy_text': return 2;
    case 'horde': return Math.max(m, 1);
    case 'move': case 'grant_moveable': case 'protect': case 'lockdown': case 'deny_on_reveal': case 'junk_board':
    case 'junk_hand': case 'junk_deck': case 'merge': case 'transform': return 1;
    case 'opp_draw': return -2;
    default: return 0.5;
  }
}

/** Text value in power-equivalents (HEURISTIC; conservative for conditional effects). */
export function textValue(card: Card, clauses: readonly Clause[]): number {
  let total = 0;
  for (const c of clauses) {
    const conditional = c.conditions.length > 0 || c.trigger === 'objective' || c.trigger === 'play_restriction';
    const scaled = c.scaling.length > 0;
    for (const e of c.effects) {
      if (e.kind === 'play_restriction') { total -= 1; continue; }
      let v = effectValue(e.kind, e.target, e.magnitude, card);
      if (scaled && v > 0) v *= 2;
      if (conditional && v > 0) v *= 0.5;
      if (/lose \d Max Energy/.test(c.text)) v = -2;
      total += v;
    }
  }
  return Math.max(TEXT_CAP.min, Math.min(TEXT_CAP.max, total));
}

/** Measured part: shrunk win-rate delta in points, at most +/-10, 0 when there is no delta. */
export function measuredPoints(metaStat: MetaCardStat | undefined): number {
  if (!metaStat || metaStat.winDelta === null || !Number.isFinite(metaStat.winDelta) || metaStat.games <= 0) return 0;
  const prior = 50 * Math.max(1, metaStat.lists);
  const shrink = metaStat.games / (metaStat.games + prior);
  return Math.max(-10, Math.min(10, metaStat.winDelta * 100 * shrink));
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function qualityOf(
  card: Card,
  clauses: readonly Clause[],
  poolStats: PoolStats,
  metaStat: MetaCardStat | undefined,
): { quality: number; parts: { stat: number; text: number; measured: number } } {
  const mean = poolStats.meanPower[bucket(card.cost)] ?? 0;
  const statPower = card.isSkill ? 0 : card.power - mean - (isDrawback(clauses) ? DRAWBACK_POWER : 0);
  const stat = round1(statPower * POINTS_PER_POWER);
  const text = round1(textValue(card, clauses) * POINTS_PER_POWER);
  const measured = round1(measuredPoints(metaStat));
  const raw = 50 + stat + text + measured;
  const quality = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50;
  return { quality, parts: { stat, text, measured } };
}
