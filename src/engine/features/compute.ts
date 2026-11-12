/**
 * Card features (spec §8.2): parse -> reviewed overrides -> traits, axes, tech roles, flags, draw and
 * energy model, quality. `computeNetwork` runs it over a pool and builds the interaction network.
 */
import { buildEdges } from '../network/edges';
import { applyOverrides, type Overrides } from '../text/overrides';
import { parseCard } from '../text/parse';
import type { Card, CardEdge, CardFeatures, Clause, MetaCardStat, MetaIndex } from '../types';
import { axesOf } from './axes';
import { poolStatsOf, qualityOf, type PoolStats } from './quality';
import { techRolesOf } from './tech';
import { effs, isDrawback, restrictionOf, traitsOf } from './traits';

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, twelve: 12 };

/** Count named in a sentence ("Shuffle 4 ...", "the six Infinity Stones"), or 1. */
function countIn(text: string, magnitude: number | null): number {
  if (magnitude !== null && magnitude > 0) return magnitude;
  const m = /\b(\d+|one|two|three|four|five|six|seven|eight|twelve)\b/i.exec(text);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : WORD_NUMBERS[m[1]!.toLowerCase()] ?? 1;
}

/**
 * Draw / energy model inputs (theory §1.2-1.3): extra cards seen, extra Energy, own cost discount
 * and cards added to your own deck. Read from clause magnitudes; a missing magnitude counts as 1.
 */
export function modelOf(clauses: readonly Clause[]): CardFeatures['model'] {
  let extraSeen = 0;
  for (const h of effs(clauses, /^draw$/, /^(own_player|both|enemy_deck)$/)) {
    if (h.clause.trigger === 'draw_position' || /can't draw|Draw Agatha/.test(h.clause.text)) continue;
    extraSeen += /Draw all cards/.test(h.clause.text) ? 1 : countIn(h.clause.text, h.effect.magnitude);
  }
  let extraEnergy = 0;
  for (const h of effs(clauses, /^(energy_gain|energy_max)$/, /^own_player$/)) {
    const m = h.effect.magnitude ?? 1;
    extraEnergy += /lose \d Max Energy/i.test(h.clause.text) ? -m : m;
  }
  let selfDiscount = 0;
  for (const h of effs(clauses, /^cost_reduce$/, /^self$/, /^static_cost$/)) selfDiscount += h.effect.magnitude ?? 1;
  let deckDilution = 0;
  for (const h of effs(clauses, /^gen_deck$/, /^own_deck$/)) deckDilution += countIn(h.clause.text, h.effect.magnitude);
  return { extraSeen, extraEnergy, selfDiscount, deckDilution };
}

/** Features of one card. `overrides` are the reviewed clauses of sync-data/card-overrides.json. */
export function computeFeatures(card: Card, overrides: Overrides, poolStats: PoolStats, metaStat: MetaCardStat | undefined): CardFeatures {
  const parsed = applyOverrides(card, parseCard(card), overrides);
  const clauses = parsed.clauses;
  const { quality, parts } = qualityOf(card, clauses, poolStats, metaStat);
  return {
    defId: card.defId,
    clauses,
    unparsed: parsed.unparsed,
    traits: traitsOf(card, clauses),
    axes: axesOf(card, clauses),
    techRoles: techRolesOf(card, clauses),
    drawback: isDrawback(clauses),
    restriction: restrictionOf(clauses),
    model: modelOf(clauses),
    quality,
    qualityParts: parts,
  };
}

/**
 * Features for every released and upcoming card, and the edges between released cards (spec §8.3:
 * all pairs of released cards). Pure: the caller passes the pool, the meta index and the overrides.
 */
export function computeNetwork(input: { cards: readonly Card[]; meta: MetaIndex | null; overrides: Overrides }): { features: CardFeatures[]; edges: CardEdge[] } {
  const stats = poolStatsOf(input.cards);
  const features: CardFeatures[] = [];
  for (const c of input.cards) {
    if (c.cardClass === 'token') continue;
    features.push(computeFeatures(c, input.overrides, stats, input.meta?.cardStat(c.defId)));
  }
  const byId: Record<string, CardFeatures> = {};
  for (const f of features) byId[f.defId] = f;
  const released = input.cards.filter((c) => c.cardClass === 'released');
  return { features, edges: buildEdges(released, byId) };
}
