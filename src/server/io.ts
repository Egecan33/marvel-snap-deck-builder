import { encodeDeckCode } from '@/engine/io/deckcode';
import { exportDecklist, parseDecklist } from '@/engine/io/decklist';
import { validateDeck } from '@/engine/rules/validate';
import type { Card, Deck } from '@/engine/types';
import type { ExportResponse, ImportResponse } from './api-types';
import { cardLookup, engineContext } from './context';
import { HttpError } from './http';
import { getSettings } from './settings';

const MAX_TEXT = 200_000;

/**
 * POST /api/import: a deck code (long or short, bare or in the "# (1) Card" block) or a card list.
 * The deck is not saved; unresolved lines are returned with their line numbers.
 */
export function importDeck(text: unknown, format: unknown): ImportResponse {
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text must be a deck code or a card list.');
  if (text.length > MAX_TEXT) throw new HttpError(413, 'text is too long for a deck.');
  const ctx = engineContext();
  const parsed = parseDecklist(text, ctx.db);
  const deck: Deck = {
    id: null,
    name: parsed.name?.trim() || 'Imported deck',
    format: typeof format === 'string' && format ? format : getSettings().format,
    cards: parsed.cards.map((defId) => ({ defId, locked: false })),
    themes: [],
    buildMode: 'tuned',
  };
  return { deck, unresolved: parsed.unresolved, violations: validateDeck(deck, ctx.db, ctx.owned), cards: cardLookup(parsed.cards, ctx.db) };
}

/**
 * POST /api/export: the site text block (`exportDecklist`) and both deck codes. Codes are written
 * only for 12 different known cards, in the order the text block uses (cost, then name).
 */
export function exportDeck(deck: Deck): ExportResponse {
  const db = engineContext().db;
  const text = exportDecklist(deck, db);
  const ids = deck.cards.map((c) => c.defId);
  const known = ids.map((id) => db.get(id)).filter((c): c is Card => c !== undefined);
  if (ids.length !== 12 || new Set(ids).size !== 12 || known.length !== 12) return { text, long: null, short: null };
  const order = [...known].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'en')).map((c) => c.defId);
  return { text, long: encodeDeckCode(order, deck.name, 'long'), short: encodeDeckCode(order, '', 'short') };
}
