import type { Card, CardDb, Deck } from '../types';
import { decodeDeckCode, DECK_CODE_TOKEN, encodeDeckCode } from './deckcode';
import { LIST_LINE, rejectReason, resolveLine, tidy } from './resolve';

/**
 * Pasted decklists (spec §16 import/export, data §4.4, plan Review focus 5).
 *
 * Like Untapped's importer (data §4.2): the first deck code anywhere in the text wins and the rest
 * is ignored; without a code every non-comment line and every "# (cost) Name" line is a card.
 * Tokens and mode copies are never resolved; an unreleased card is kept so that validation can say
 * when it releases. Every line that does not give a card is reported with its line number.
 */

const SPLIT = /[\s:;,"'<>()[\]{}|]+/;
const MIN_CODE = 8; // the shortest code (one short card code) is 8 base64 characters

function findCode(lines: string[], db: CardDb): { line: number; decoded: NonNullable<ReturnType<typeof decodeDeckCode>> } | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === '' || l.startsWith('#')) continue;
    const tokens = DECK_CODE_TOKEN.test(l) ? [l] : l.split(SPLIT);
    for (const t of tokens) {
      if (t.length < MIN_CODE) continue;
      const decoded = decodeDeckCode(t, db);
      if (decoded) return { line: i + 1, decoded };
    }
  }
  return null;
}

export function parseDecklist(text: string, db: CardDb): { cards: string[]; unresolved: { line: number; text: string }[]; name: string | null } {
  if (typeof text !== 'string') return { cards: [], unresolved: [], name: null };
  const lines = text.split(/\r?\n|\r/).map(tidy);
  const cards: string[] = [];
  const unresolved: { line: number; text: string }[] = [];

  const code = findCode(lines, db);
  if (code) {
    for (const id of code.decoded.cards) {
      const why = rejectReason(id, db, true);
      if (why) unresolved.push({ line: code.line, text: `${why} (from the deck code)` });
      else cards.push(id);
    }
    return { cards, unresolved, name: code.decoded.name };
  }

  lines.forEach((l, i) => {
    if (l === '' || (l.startsWith('#') && !LIST_LINE.test(l))) return;
    const hit = resolveLine(l, db);
    if (hit && hit.cardClass !== 'token') cards.push(hit.defId);
    else unresolved.push({ line: i + 1, text: l });
  });
  return { cards, unresolved, name: null };
}

const byCostThenName = (a: Card, b: Card): number => a.cost - b.cost || a.name.localeCompare(b.name, 'en');

/**
 * The block sites show next to a code (data §4.4): "# (cost) Name" per card sorted by cost then
 * name, a bare "#", the short code, then "#" and "# {deck name}". A deck that is not 12 different
 * known cards gets no code, and a comment line says why; unknown ids are listed as "# (?) id".
 */
export function exportDecklist(deck: Deck, db: CardDb): string {
  const entries: unknown[] = Array.isArray(deck?.cards) ? deck.cards : [];
  const ids = entries
    .map((e) => (e && typeof e === 'object' ? (e as { defId?: unknown }).defId : undefined))
    .filter((id): id is string => typeof id === 'string' && id !== '');
  const known = ids.map((id) => db.get(id)).filter((c): c is Card => c !== undefined).sort(byCostThenName);
  const unknown = ids.filter((id) => !db.get(id));

  const lines = [...known.map((c) => `# (${c.cost}) ${c.name}`), ...unknown.map((id) => `# (?) ${id}`), '#'];
  const distinct = new Set(ids).size;
  const problems: string[] = [];
  if (ids.length !== 12 || distinct !== ids.length) problems.push(`the deck has ${ids.length} cards${distinct !== ids.length ? ` (${distinct} different)` : ''}`);
  if (unknown.length > 0) problems.push(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the card database`);
  lines.push(problems.length === 0
    ? encodeDeckCode(known.map((c) => c.defId), '', 'short')
    : `# No deck code: ${problems.join('; ')}. A code needs 12 different cards from the card database.`);

  const name = typeof deck?.name === 'string' ? tidy(deck.name.replace(/[\r\n]+/g, ' ')) : '';
  if (name) lines.push('#', LIST_LINE.test(`# ${name}`) ? `# Deck: ${name}` : `# ${name}`);
  return lines.join('\n');
}
