/**
 * Reviewed clauses for cards the parser cannot read (sync-data/card-overrides.json, spec §8.1).
 *
 * An override is tied to the exact text it was reviewed against. Card texts change with balance
 * patches, so an override whose `reviewedText` differs from the card's current text is ignored and
 * reported stale: the parser's reading is used and the coverage report lists the card for review.
 */
import type { Card, Clause, Effect } from '../types';

export interface OverrideEffect { kind: string; target: string; magnitude?: number | null; selectors?: string[] }
export interface OverrideClause {
  trigger: string;
  effects: OverrideEffect[];
  conditions?: string[];
  scaling?: string[];
  notes?: string[];
  text: string;
}
export interface CardOverride { reviewedText: string; note: string; clauses: OverrideClause[] }
export type Overrides = Readonly<Record<string, CardOverride>>;

/** Overrides from the parsed JSON of sync-data/card-overrides.json (`{ cards: { defId: CardOverride } }`). */
export function loadOverrides(json: unknown): Overrides {
  const cards = (json as { cards?: unknown } | null)?.cards;
  if (!cards || typeof cards !== 'object') return {};
  const out: Record<string, CardOverride> = {};
  for (const [defId, value] of Object.entries(cards as Record<string, unknown>)) {
    const o = value as Partial<CardOverride>;
    if (typeof o?.reviewedText === 'string' && Array.isArray(o.clauses)) {
      out[defId] = { reviewedText: o.reviewedText, note: typeof o.note === 'string' ? o.note : '', clauses: o.clauses };
    }
  }
  return out;
}

const toClause = (c: OverrideClause): Clause => ({
  trigger: c.trigger,
  effects: c.effects.map((e): Effect => ({ kind: e.kind, target: e.target, magnitude: e.magnitude ?? null, selectors: e.selectors ?? [] })),
  conditions: c.conditions ?? [],
  scaling: c.scaling ?? [],
  notes: c.notes ?? [],
  text: c.text,
  source: 'override',
  complete: true,
});

/** The reviewed clauses when the override still matches the card's text; else the parse, flagged stale. */
export function applyOverrides(
  card: Pick<Card, 'defId' | 'text'>,
  parsed: { clauses: Clause[]; unparsed: string[] },
  overrides: Overrides,
): { clauses: Clause[]; unparsed: string[]; staleOverride: boolean } {
  const o = Object.prototype.hasOwnProperty.call(overrides, card.defId) ? overrides[card.defId] : undefined;
  if (!o) return { clauses: parsed.clauses, unparsed: parsed.unparsed, staleOverride: false };
  if (o.reviewedText !== card.text) return { clauses: parsed.clauses, unparsed: parsed.unparsed, staleOverride: true };
  return { clauses: o.clauses.map(toClause), unparsed: [], staleOverride: false };
}
