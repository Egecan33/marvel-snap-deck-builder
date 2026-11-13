import { createHash } from 'node:crypto';
import { checkFloor } from '@/engine/builder/floor';
import { energyModel } from '@/engine/maths/energy';
import { gemsNear } from '@/engine/novelty/gems';
import { noveltyOf } from '@/engine/novelty/novelty';
import { detectPlans } from '@/engine/plans/detect';
import { rateDeck } from '@/engine/rating/rate';
import { findFormat, isCheckedFormat } from '@/engine/rules/formats';
import { isLegal, validateDeck } from '@/engine/rules/validate';
import { createScorer } from '@/engine/scoring/scorer';
import { generateLines } from '@/engine/lines/lines';
import type { Card, CardDb, CardScore, Deck, EngineContext } from '@/engine/types';
import type { AnalyzeResponse, CardView } from './api-types';
import { loadCardDb } from './carddb';
import { ownedMap } from './collection';
import { getSettings } from './settings';
import { cacheSlot } from './state';

/** Analyses kept in memory (the deck being edited plus a few recent ones). */
const ANALYSIS_CACHE = 24;

export const cardView = (c: Card): CardView => {
  const { rawText: _raw, ...rest } = c;
  void _raw;
  return rest;
};

/** Cards by defId for the ids given (unknown ids are left out). */
export function cardLookup(ids: Iterable<string | null | undefined>, db: CardDb = loadCardDb()): Record<string, CardView> {
  const out: Record<string, CardView> = {};
  for (const id of ids) {
    if (!id || out[id]) continue;
    const c = db.get(id);
    if (c) out[id] = cardView(c);
  }
  return out;
}

/**
 * The engine context of a request. `ownedOnly` overrides the setting; when owned-only is on the
 * collection is the `owned` map (possibly empty, then every add gate says NOT_OWNED).
 */
export function engineContext(ownedOnly?: boolean | null): EngineContext {
  const db = loadCardDb();
  const useOwned = typeof ownedOnly === 'boolean' ? ownedOnly : getSettings().ownedOnly;
  return { db, owned: useOwned ? ownedMap() : null };
}

/** Content key of a deck plus the owned map in force: same key, same analysis. */
export function deckKey(deck: Deck, ctx: EngineContext): string {
  const h = createHash('sha1');
  h.update(JSON.stringify([deck.format, deck.buildMode, deck.themes, deck.cards.map((c) => [c.defId, c.locked])]));
  h.update(ctx.owned ? Object.keys(ctx.owned).sort().join(',') : '-');
  return h.digest('hex');
}

/** Score of each card in the deck (leave-one-out, scoring/scorer.ts), in deck order. Unknown cards are skipped. */
export function deckScores(deck: Deck, ctx: EngineContext): CardScore[] {
  const scorer = createScorer(deck, ctx);
  const seen = new Set<string>();
  const out: CardScore[] = [];
  for (const dc of deck.cards) {
    const c = ctx.db.get(dc.defId);
    if (!c || seen.has(c.defId)) continue;
    seen.add(c.defId);
    out.push(scorer.score(c));
  }
  return out;
}

/**
 * POST /api/analyze: every engine block for one deck. Cached by deck content (LRU of 24) and
 * dropped with the CardDb after a sync. The floor treats locked cards as build-around cards.
 */
export function analyzeDeck(deck: Deck, ctx: EngineContext = engineContext()): AnalyzeResponse {
  const cache = cacheSlot('analysis', () => new Map<string, AnalyzeResponse>());
  const key = deckKey(deck, ctx);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const db = ctx.db;
  const violations = validateDeck(deck, db, ctx.owned);
  const locked = deck.cards.filter((c) => c.locked && db.get(c.defId)).map((c) => c.defId);
  const res: AnalyzeResponse = {
    rating: rateDeck(deck, ctx),
    novelty: noveltyOf(deck, ctx),
    floor: checkFloor(deck, ctx, [...new Set(locked)]),
    plans: detectPlans(deck, ctx),
    energy: energyModel(deck, db),
    lines: generateLines(deck, ctx),
    deckScores: deckScores(deck, ctx),
    violations,
    legal: isLegal(violations),
    formatChecked: isCheckedFormat(findFormat(db, deck.format)),
    gemsNear: gemsNear(deck, ctx, 5),
    cards: cardLookup(deck.cards.map((c) => c.defId), db),
  };
  cache.set(key, res);
  while (cache.size > ANALYSIS_CACHE) cache.delete(cache.keys().next().value as string);
  return res;
}
