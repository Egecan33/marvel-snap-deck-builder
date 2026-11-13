import { build } from '@/engine/builder/build';
import { applySwaps, improveDeck } from '@/engine/builder/improve';
import { DEFAULT_PROMPTS } from '@/engine/builder/pool';
import type { BuildOptions, BuildOutcome, Deck, EngineContext, Prompts, SwapProposal } from '@/engine/types';
import type { CardView } from './api-types';
import { cardLookup, engineContext } from './context';
import { HttpError, isObject } from './http';
import { getSettings } from './settings';

const share = (v: unknown, what: string): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new HttpError(400, `options.prompts.${what} must be a share from 0 to 1, or null.`);
  return v;
};
const whole = (v: unknown, what: string, lo: number, hi: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `options.${what} must be a whole number from ${lo} to ${hi}.`);
  return v;
};

/** Prompts over the theory §4.6 defaults (DEFAULT_PROMPTS, heuristic). Bad values are a 400. */
export function sanitizePrompts(input: unknown): Prompts {
  if (input === undefined || input === null) return { ...DEFAULT_PROMPTS };
  if (!isObject(input)) throw new HttpError(400, 'options.prompts must be an object.');
  const p: Prompts = { ...DEFAULT_PROMPTS, avoid: [...DEFAULT_PROMPTS.avoid] };
  if ('maxPlayRate' in input) p.maxPlayRate = share(input.maxPlayRate, 'maxPlayRate');
  if ('techExempt' in input) {
    if (typeof input.techExempt !== 'boolean') throw new HttpError(400, 'options.prompts.techExempt must be true or false.');
    p.techExempt = input.techExempt;
  }
  if ('maxShared' in input) p.maxShared = input.maxShared === null ? null : whole(input.maxShared, 'prompts.maxShared', 0, 12);
  if ('wildcards' in input) p.wildcards = whole(input.wildcards, 'prompts.wildcards', 0, 12);
  if ('maxSeries' in input) p.maxSeries = input.maxSeries === null ? null : whole(input.maxSeries, 'prompts.maxSeries', 0, 100);
  if ('avoid' in input) {
    if (!Array.isArray(input.avoid) || input.avoid.some((x) => typeof x !== 'string')) throw new HttpError(400, 'options.prompts.avoid must be a list of card ids.');
    p.avoid = (input.avoid as string[]).slice(0, 500);
  }
  if ('surprise' in input) {
    if (typeof input.surprise !== 'boolean') throw new HttpError(400, 'options.prompts.surprise must be true or false.');
    p.surprise = input.surprise;
  }
  return p;
}

/**
 * Build options from a request: mode defaults to the deck's build mode, seed and count to the
 * settings. `ownedOnly` (default: the setting) makes the collection the owned map.
 */
export function buildOptions(input: unknown, deck: Deck): { opts: BuildOptions; ctx: EngineContext } {
  if (input !== undefined && input !== null && !isObject(input)) throw new HttpError(400, 'options must be an object.');
  const o = (input ?? {}) as Record<string, unknown>;
  const s = getSettings();
  const mode = o.mode ?? deck.buildMode;
  if (mode !== 'brew' && mode !== 'tuned') throw new HttpError(400, "options.mode must be 'brew' or 'tuned'.");
  const seed = o.seed === undefined ? s.seed : whole(o.seed, 'seed', 0, 2 ** 31);
  const count = o.count === undefined ? s.brewCount : whole(o.count, 'count', 1, 6);
  if (o.ownedOnly !== undefined && typeof o.ownedOnly !== 'boolean') throw new HttpError(400, 'options.ownedOnly must be true or false.');
  const ctx = engineContext(o.ownedOnly as boolean | undefined);
  return { ctx, opts: { mode, seed, count, owned: ctx.owned, prompts: sanitizePrompts(o.prompts) } };
}

/** POST /api/build: `BuildOutcome` plus the cards it names. */
export function runBuild(deck: Deck, options: unknown): BuildOutcome & { cards: Record<string, CardView> } {
  const { opts, ctx } = buildOptions(options, deck);
  const out = build(deck, ctx, opts);
  return { ...out, cards: cardLookup(out.results.flatMap((r) => r.deck.cards.map((c) => c.defId)), ctx.db) };
}

export const DIRECTIONS = ['stronger', 'more-original'] as const;

/** POST /api/improve: ordered checked swaps (never cutting a locked card) and the deck after all of them. */
export function runImprove(deck: Deck, direction: unknown, options: unknown): { swaps: SwapProposal[]; deck: Deck; cards: Record<string, CardView> } {
  if (!DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) throw new HttpError(400, `direction must be one of ${DIRECTIONS.join(', ')}.`);
  const { opts, ctx } = buildOptions(options, deck);
  const swaps = improveDeck(deck, ctx, opts, direction as (typeof DIRECTIONS)[number]);
  const after = applySwaps(deck, swaps);
  return { swaps, deck: after, cards: cardLookup([...deck.cards.map((c) => c.defId), ...swaps.map((s) => s.in)], ctx.db) };
}
