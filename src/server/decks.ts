import { randomUUID } from 'node:crypto';
import { noveltyOf } from '@/engine/novelty/novelty';
import { rateDeck } from '@/engine/rating/rate';
import type { Deck, DeckCard } from '@/engine/types';
import type { DeckTile } from './api-types';
import { getDb } from './carddb';
import { deckKey, engineContext } from './context';
import { HttpError, isObject } from './http';
import { getSettings } from './settings';
import { cacheSlot, serverNow } from './state';

export const MAX_NAME = 200;
/** More than a deck holds, so partial and over-full decks can be edited and analysed. */
export const MAX_CARDS = 40;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEF_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Turns request data into a `Deck`. Shapes that cannot be a deck are a 400. Card entries may be
 * defId strings or `{ defId, locked }`. Duplicates and unknown ids are kept: the validator reports
 * them (a deck the owner is editing must not lose cards silently).
 */
export function sanitizeDeck(input: unknown): Deck {
  if (!isObject(input)) throw new HttpError(400, 'deck must be an object.');
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME) : 'Untitled deck';
  const id = typeof input.id === 'string' && ID.test(input.id) ? input.id : null;
  const raw = input.cards ?? [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'deck.cards must be a list.');
  if (raw.length > MAX_CARDS) throw new HttpError(400, `deck.cards can hold at most ${MAX_CARDS} entries.`);
  const cards: DeckCard[] = [];
  for (const e of raw as unknown[]) {
    const defId = typeof e === 'string' ? e : isObject(e) && typeof e.defId === 'string' ? e.defId : null;
    if (!defId || !DEF_ID.test(defId)) throw new HttpError(400, 'deck.cards entries need a defId (letters, digits, - or _).');
    cards.push({ defId, locked: isObject(e) && e.locked === true });
  }
  const format = typeof input.format === 'string' && input.format ? input.format.slice(0, 64) : getSettings().format;
  const themes = Array.isArray(input.themes) ? [...new Set((input.themes as unknown[]).filter((t): t is string => typeof t === 'string' && t.length <= 64))].slice(0, 8) : [];
  const buildMode = input.buildMode === 'tuned' ? 'tuned' : 'brew';
  return { id, name, format, cards, themes, buildMode };
}

interface Row { id: string; name: string; json: string; updated_at: string }

const readRow = (row: Row): Deck => ({ ...sanitizeDeck(JSON.parse(row.json)), id: row.id, name: row.name });

export function getDeck(id: string): { deck: Deck; updatedAt: string } | null {
  const row = getDb().prepare('SELECT id, name, json, updated_at FROM decks WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  try {
    return { deck: readRow(row), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/** Saves a deck: as a new one (fresh id) when `id` is omitted, else over the deck with that id. */
export function saveDeck(deck: Deck, id?: string): { deck: Deck; updatedAt: string } | null {
  const db = getDb();
  const updatedAt = new Date(serverNow()).toISOString();
  if (id === undefined) {
    const saved: Deck = { ...deck, id: randomUUID() };
    db.prepare('INSERT INTO decks(id, name, json, updated_at) VALUES (?, ?, ?, ?)').run(saved.id, saved.name, JSON.stringify(saved), updatedAt);
    return { deck: saved, updatedAt };
  }
  const saved: Deck = { ...deck, id };
  const res = db.prepare('UPDATE decks SET name = ?, json = ?, updated_at = ? WHERE id = ?').run(saved.name, JSON.stringify(saved), updatedAt, id);
  return res.changes > 0 ? { deck: saved, updatedAt } : null;
}

export function deleteDeck(id: string): boolean {
  return getDb().prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0;
}

type TileNumbers = Pick<DeckTile, 'rating' | 'legal' | 'complete' | 'novelty' | 'band'>;

/** Saved decks, newest first, with rating, novelty band and legality. Numbers are computed once per deck version. */
export function listDecks(): DeckTile[] {
  const rows = getDb().prepare('SELECT id, name, json, updated_at FROM decks ORDER BY updated_at DESC, id').all() as Row[];
  const numbers = cacheSlot('deck-tiles', () => new Map<string, TileNumbers>());
  const ctx = engineContext();
  const tiles: DeckTile[] = [];
  const live = new Set<string>();
  for (const row of rows) {
    let deck: Deck;
    try {
      deck = readRow(row);
    } catch {
      continue; // a row that is not a deck is not listed
    }
    const key = deckKey(deck, ctx);
    live.add(key);
    let n = numbers.get(key);
    if (!n) {
      const r = rateDeck(deck, ctx);
      const nov = noveltyOf(deck, ctx);
      n = { rating: r.rating, legal: r.legal, complete: r.complete, novelty: nov.novelty, band: nov.band };
      numbers.set(key, n);
    }
    tiles.push({ id: row.id, name: row.name, updatedAt: row.updated_at, format: deck.format, cards: deck.cards.map((c) => c.defId), ...n });
  }
  for (const key of numbers.keys()) if (!live.has(key)) numbers.delete(key);
  return tiles;
}
