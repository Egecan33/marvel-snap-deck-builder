import type { CardDb } from '../types';

/**
 * Marvel Snap deck codes, ported from docs/research/analysis/deckcode/deckcode.mjs (data §4.1).
 *
 *   long:  base64 of UTF-8 JSON {"Name": ..., "Cards": [{"CardDefId": ...}, ...]}; Name optional
 *   short: base64 of the cards' short codes joined by commas; no name
 *
 * A short card code is the defId with every lower-case a, e, i, o, u, y removed, then the defId's
 * length in upper-case hex. It is one-way, so decoding needs the card table.
 * The engine imports no Node module, so base64 and UTF-8 are done here rather than with Buffer.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]));
B64_INDEX.set('-', 62); // URL-safe alphabet, accepted on decode only
B64_INDEX.set('_', 63);

/** A whole token that could be a deck code: base64 characters with optional padding. */
export const DECK_CODE_TOKEN = /^[A-Za-z0-9+/_-]+={0,2}$/;

function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogate
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** Strict UTF-8 decode; null on any malformed sequence (so random base64 is rejected). */
function utf8Decode(bytes: number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let need: number;
    let cp: number;
    if (b < 0x80) { need = 0; cp = b; }
    else if (b >= 0xc2 && b < 0xe0) { need = 1; cp = b & 31; }
    else if (b >= 0xe0 && b < 0xf0) { need = 2; cp = b & 15; }
    else if (b >= 0xf0 && b < 0xf5) { need = 3; cp = b & 7; }
    else return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 63);
    }
    if ((need === 2 && cp < 0x800) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

function base64Encode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/** Decodes standard or URL-safe base64, padded or not. Null when the text cannot be base64. */
function base64Decode(text: string): number[] | null {
  const body = text.replace(/=+$/, '');
  if (body.length % 4 === 1 || text.length - body.length > 2) return null;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of body) {
    const v = B64_INDEX.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/** Short card code (data §4.1): `Blade` → `Bld5`, `HighEvolutionary` → `HghEvltnr10`. */
export function shortCardCode(defId: string): string {
  return defId.replace(/[aeiouy]/g, '') + defId.length.toString(16).toUpperCase();
}

const CLASS_RANK = { released: 0, upcoming: 1, token: 2 } as const;
const shortTables = new WeakMap<CardDb, Map<string, string>>();

/**
 * Short code → defId for every card row. data §4.1 measured no collision among 791 rows; if a
 * later sync brings one, the released card wins, so a code never resolves to a token by accident.
 */
function shortTable(db: CardDb): Map<string, string> {
  let table = shortTables.get(db);
  if (table) return table;
  table = new Map();
  const ranked = [...db.all()].sort((a, b) => CLASS_RANK[a.cardClass] - CLASS_RANK[b.cardClass] || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
  for (const c of ranked) {
    const code = shortCardCode(c.defId);
    if (!table.has(code)) table.set(code, c.defId);
  }
  shortTables.set(db, table);
  return table;
}

/**
 * Deck code of `cards` (defIds, in the given order). Short is what sites publish today; long is
 * what Untapped's builder exports and the only format that carries a name (data §4.2).
 * Any card count is encoded; whether the deck is complete is the validator's business.
 */
export function encodeDeckCode(cards: string[], name: string, format: 'long' | 'short'): string {
  const ids = Array.isArray(cards) ? cards.filter((c): c is string => typeof c === 'string') : [];
  const text = format === 'short'
    ? ids.map(shortCardCode).join(',')
    : JSON.stringify({ Name: typeof name === 'string' ? name : '', Cards: ids.map((CardDefId) => ({ CardDefId })) });
  return base64Encode(utf8Encode(text));
}

const SHORT_PIECE = /^[A-Za-z0-9]+[0-9A-F]$/;

/**
 * Reads one deck code (surrounding whitespace allowed). Returns the defIds in code order, or null
 * when the text is not a deck code. Ids the database does not know are kept as written (a short
 * code that maps to no card is kept as the short code) so the caller can report them; nothing is
 * dropped. A short code is accepted only when at least one of its pieces is a known card.
 */
export function decodeDeckCode(code: string, db: CardDb): { cards: string[]; name: string | null; format: 'long' | 'short' } | null {
  if (typeof code !== 'string') return null;
  const token = code.trim();
  if (token.length < 4 || !DECK_CODE_TOKEN.test(token)) return null;
  const bytes = base64Decode(token);
  if (!bytes || bytes.length === 0) return null;
  const text = utf8Decode(bytes);
  if (text === null) return null;

  if (text.trimStart().startsWith('{')) {
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const list = (obj as { Cards?: unknown }).Cards;
    if (!Array.isArray(list) || list.length === 0) return null;
    const cards: string[] = [];
    for (const entry of list) {
      const id = entry && typeof entry === 'object' ? (entry as { CardDefId?: unknown }).CardDefId : undefined;
      if (typeof id !== 'string' || id === '') return null;
      cards.push(id);
    }
    const rawName = (obj as { Name?: unknown }).Name;
    return { cards, name: typeof rawName === 'string' && rawName.trim() !== '' ? rawName : null, format: 'long' };
  }

  const pieces = text.split(',').map((p) => p.trim());
  if (!pieces.every((p) => SHORT_PIECE.test(p))) return null;
  const table = shortTable(db);
  const cards = pieces.map((p) => table.get(p) ?? p);
  if (!pieces.some((p) => table.has(p))) return null;
  return { cards, name: null, format: 'short' };
}
