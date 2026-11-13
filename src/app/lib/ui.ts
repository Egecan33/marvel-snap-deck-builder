/**
 * Pure helpers for the UI: deck edits, ordering, labels and formatters. No React, no fetch, so the
 * tests in tests/ui run them directly.
 */
import type { Deck, NoveltyReport, Provenance } from '@/engine/types';

/** Rules §1.1: a deck is exactly 12 different cards. */
export const DECK_SIZE = 12;

/**
 * The image route answers a missing file with an SVG card back of this intrinsic width
 * (src/server/images.ts PLACEHOLDER_WIDTH); real art is 512. Browsers fire no error for it.
 */
export const SERVER_PLACEHOLDER_WIDTH = 510;

// ---------------------------------------------------------------------------------------------
// Deck edits (each returns a new deck, or the same object when nothing changes)

export function emptyDeck(name = 'New deck', format = 'ranked'): Deck {
  return { id: null, name, format, cards: [], themes: [], buildMode: 'brew' };
}

export const deckIds = (deck: Deck): string[] => deck.cards.map((c) => c.defId);
export const inDeck = (deck: Deck, id: string): boolean => deck.cards.some((c) => c.defId === id);

/** Adds a card once. A full deck (12) or a card already in it is left unchanged. */
export function addCard(deck: Deck, id: string): Deck {
  if (inDeck(deck, id) || deck.cards.length >= DECK_SIZE) return deck;
  return { ...deck, cards: [...deck.cards, { defId: id, locked: false }] };
}

export function removeCard(deck: Deck, id: string): Deck {
  return { ...deck, cards: deck.cards.filter((c) => c.defId !== id) };
}

export function toggleLock(deck: Deck, id: string): Deck {
  return { ...deck, cards: deck.cards.map((c) => (c.defId === id ? { ...c, locked: !c.locked } : c)) };
}

/** Replaces `out` with `into` in the same slot. No-op when `out` is missing or `into` is already in the deck. */
export function swapCard(deck: Deck, out: string, into: string): Deck {
  if (!inDeck(deck, out) || inDeck(deck, into)) return deck;
  return { ...deck, cards: deck.cards.map((c) => (c.defId === out ? { defId: into, locked: false } : c)) };
}

/** A deck holding only the build-around cards, locked, for /api/build. */
export function withLocks(ids: readonly string[], rest: Partial<Deck> = {}): Deck {
  return { ...emptyDeck(), ...rest, cards: ids.map((defId) => ({ defId, locked: true })) };
}

// ---------------------------------------------------------------------------------------------
// Ordering

export interface CostLike { name: string; cost: number; power: number }

/** Cost, then name (the order the game and the export block use). Unknown ids go last. */
export function sortByCost(ids: readonly string[], lookup: Readonly<Record<string, CostLike | undefined>>): string[] {
  return [...ids].sort((a, b) => {
    const ca = lookup[a];
    const cb = lookup[b];
    if (!ca || !cb) return (ca ? 0 : 1) - (cb ? 0 : 1) || a.localeCompare(b);
    return ca.cost - cb.cost || ca.name.localeCompare(cb.name, 'en');
  });
}

/** Cards at cost 0..7 (index 7 = 7 or more); unknown ids are not counted. */
export function curveOf(ids: readonly string[], lookup: Readonly<Record<string, CostLike | undefined>>): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const id of ids) {
    const c = lookup[id];
    if (c) out[Math.max(0, Math.min(7, c.cost))]! += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Labels

export type Band = NoveltyReport['band'];
const BAND_LABEL: Record<Band, string> = { meta: 'Meta', variant: 'Variant', 'off-meta': 'Off-meta', brew: 'Brew', unknown: 'Not claimed' };
export const bandLabel = (b: Band): string => BAND_LABEL[b];
export const BAND_RANGE: Record<Band, string> = {
  meta: 'under 35', variant: '35 to 59', 'off-meta': '60 to 79', brew: '80 and over', unknown: 'no meta to compare with',
};

export type RatingBand = 'top' | 'good' | 'mid' | 'low';
export function ratingBand(n: number): RatingBand {
  if (n >= 80) return 'top';
  if (n >= 60) return 'good';
  if (n >= 40) return 'mid';
  return 'low';
}

/** Spec §4: every number is labelled measured, derived or heuristic. */
export const PROVENANCE: Record<Provenance, { mark: string; label: string; title: string }> = {
  measured: { mark: 'M', label: 'measured', title: 'Measured: counted from synced meta lists or card data.' },
  derived: { mark: 'D', label: 'derived', title: 'Derived: exact maths (draw odds, energy model) over the cards as read.' },
  heuristic: { mark: 'H', label: 'heuristic', title: 'Heuristic: a judgement-based weight or rule, not calibrated against win rates.' },
};

export const SCORE_PART_LABEL: Record<string, string> = {
  synergy: 'Synergy with the deck',
  quality: 'Card quality',
  plan: 'Fits the plan',
  energy: 'Energy curve',
  meta: 'Played with these cards',
  novelty: 'Unusual pick',
  tech: 'Tech coverage',
};

/** Provenance of the per-card score parts (spec §11). */
export const SCORE_PART_PROVENANCE: Record<string, Provenance> = {
  synergy: 'heuristic', quality: 'heuristic', plan: 'derived', energy: 'derived', meta: 'measured', novelty: 'measured', tech: 'heuristic',
};

// ---------------------------------------------------------------------------------------------
// Novelty summary: the one line a brew result leads with.

export function nearestSummary(n: NoveltyReport): string {
  if (n.band === 'unknown') return `novelty not claimed: ${n.claimsWithheld ?? 'no meta to compare with.'}`;
  const near = n.nearest[0];
  if (!near || near.shared === 0) return 'shares no card with a known list';
  const who = near.archetype ?? `an unlabelled list (${near.games.toLocaleString('en-US')} games)`;
  return `shares ${near.shared} of ${DECK_SIZE} with ${who}`;
}

// ---------------------------------------------------------------------------------------------
// Formatters

export function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0%';
  const v = x * 100;
  return v < 10 ? `${(Math.round(v * 10) / 10).toString()}%` : `${Math.round(v)}%`;
}
export const fmtInt = (n: number): string => n.toLocaleString('en-US');
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';
