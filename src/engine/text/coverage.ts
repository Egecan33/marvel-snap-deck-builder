/**
 * Coverage report of the card-text parser (spec §8.1), produced on every features run and shown on the
 * Data page: cards with no effect read, sentences not fully read, disagreements between the parsed
 * magnitudes and Untapped's structured `attributes.data`, and stale overrides.
 */
import type { Card, Clause } from '../types';

export interface ParsedEntry { clauses: Clause[]; unparsed: string[]; staleOverride?: boolean }
export interface CoverageReport {
  noClause: string[];
  unparsed: { defId: string; text: string }[];
  attributeMismatch: { defId: string; detail: string }[];
  staleOverrides: string[];
}

/**
 * Untapped attribute -> effect kinds whose magnitude should equal it. The attribute names are the
 * source's; which kinds carry each one was read off the pool texts (e.g. Zombie cards write the
 * Horde amount as AddedPower).
 */
const ATTRIBUTE_KINDS: Record<string, readonly string[]> = {
  AddedPower: ['buff', 'horde', 'loc_power'],
  ReducedPower: ['afflict'],
  ReducedCost: ['cost_reduce'],
  AddedCost: ['cost_increase'],
  AddedMaxEnergy: ['energy_max'],
  AddedEnergy: ['energy_gain'],
  StolenPower: ['power_steal'],
};
/** Kinds that bring a card into the game, for the Card_Token cross-check. */
const CREATES = new Set(['gen_hand', 'gen_board', 'gen_deck', 'junk_hand', 'junk_board', 'junk_deck', 'summon', 'copy_card', 'transform', 'horde', 'special']);

/** Disagreements between a card's structured attributes and its parsed effects, in words. */
export function attributeMismatches(card: Pick<Card, 'attributes' | 'tokens'>, clauses: readonly Clause[]): string[] {
  const effects = clauses.flatMap((c) => c.effects);
  const out: string[] = [];
  for (const [attr, kinds] of Object.entries(ATTRIBUTE_KINDS)) {
    const value = card.attributes[attr];
    if (value === undefined || value === 0) continue;
    const found = effects.filter((e) => kinds.includes(e.kind));
    if (found.some((e) => e.magnitude !== null && Math.abs(e.magnitude) === Math.abs(value))) continue;
    const seen = found.map((e) => `${e.kind} ${e.magnitude ?? '?'}`);
    out.push(`${attr}=${value} but parsed ${seen.length ? seen.join(', ') : `no ${kinds.join('/')}`}`);
  }
  if (card.tokens.length > 0 && !effects.some((e) => CREATES.has(e.kind))) {
    out.push(`creates ${card.tokens.join(', ')} (Card_Token) but no effect that adds a card was parsed`);
  }
  return out;
}

/** Coverage of `cards` (normally the released pool) given each card's parse after overrides. */
export function coverage(cards: readonly Card[], parsedById: Readonly<Record<string, ParsedEntry>>): CoverageReport {
  const report: CoverageReport = { noClause: [], unparsed: [], attributeMismatch: [], staleOverrides: [] };
  for (const card of cards) {
    const p = parsedById[card.defId] ?? { clauses: [], unparsed: [] };
    if (card.hasAbility && !p.clauses.some((c) => c.effects.length > 0)) report.noClause.push(card.defId);
    for (const text of p.unparsed) report.unparsed.push({ defId: card.defId, text });
    for (const detail of attributeMismatches(card, p.clauses)) report.attributeMismatch.push({ defId: card.defId, detail });
    if (p.staleOverride) report.staleOverrides.push(card.defId);
  }
  return report;
}
