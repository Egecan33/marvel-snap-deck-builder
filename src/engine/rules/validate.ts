import type { Card, CardDb, Deck, FormatDef, Violation } from '../types';
import { findFormat, formatName, isCheckedFormat } from './formats';

/**
 * Deck validator: the checks of docs/research/rules-and-formats.md §5 with the same codes.
 *
 *   1 DECK_SIZE, 2 DUPLICATE_CARD, 3 UNKNOWN_CARD, 4 NOT_DECKABLE, 5 UNRELEASED, 6 MODE_BANNED  (errors, rules)
 *   7 MODE_UNVERIFIED, 8 MODE_LIST_STALE (warnings), 9 MODE_NOT_CONSTRUCTED (info), 12 NOT_OWNED (warning)
 *   SKILL_CARDS (info): skills count toward the 12 and no per-deck cap is known (rules §1.1, spec §7).
 *
 * Not here: 10 STATS_STALE, 11 RECENTLY_CHANGED and 13 ROTATION_SOON need the sync date and a balance
 * change log, which the CardDb does not carry yet; 14-15 are heuristics added by the Task 6/7 callers.
 * None of these checks is a heuristic: deck size, one copy and the deckable pool are rules §1.1,
 * the release class comes from synced data, bans from sync-data/formats.json.
 */

const SIZE = 12; // rules §1.1: exactly 12 cards

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** "Name" or, when the name alone could mean another card, "Name (DefId)". */
function label(db: CardDb, card: Card): string {
  const byName = db.byName(card.name);
  return byName && byName.defId !== card.defId ? `${card.name} (${card.defId})` : card.name;
}

function violation(code: string, severity: Violation['severity'], message: string, cardIds: string[]): Violation {
  return { code, severity, message, cardIds, heuristic: false };
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Released cards whose data says they create `defId` (Untapped `attributes.cards.Card_Token`). */
function creatorsOf(db: CardDb, defId: string): Card[] {
  return db.released().filter((c) => c.tokens.includes(defId));
}

function notDeckableMessage(db: CardDb, card: Card): string {
  const who = `${card.name} (${card.defId})`;
  const makers = creatorsOf(db, card.defId).map((c) => c.name);
  return makers.length > 0
    ? `${who} is created by ${listNames(makers)} and cannot be put in a deck.`
    : `${who} is not a collectible card in the synced data (a token, mode copy or created card) and cannot be put in a deck.`;
}

function unreleasedMessage(db: CardDb, card: Card): string {
  const when = card.releaseAt !== null && card.releaseAt > db.now ? `releases on ${isoDay(card.releaseAt)}` : 'has not been released yet';
  return `${label(db, card)} ${when} and cannot be played yet.`;
}

function bannedMessage(db: CardDb, card: Card, format: FormatDef): string {
  const date = format.listDate ? `list dated ${format.listDate}` : 'list undated';
  const source = format.sourceUrl ? `, source ${format.sourceUrl}` : '';
  return `${label(db, card)} is banned in ${format.name} (${date}${source}).`;
}

function notOwnedMessage(db: CardDb, card: Card): string {
  return `${label(db, card)} is not in your collection (${card.seriesLabel}).`;
}

/** Card ids of a deck object, tolerating broken entries: a missing id becomes ''. */
function idsOf(deck: Deck): string[] {
  const cards: unknown = deck && (deck as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) return [];
  return cards.map((entry) => {
    const id = entry && typeof entry === 'object' ? (entry as { defId?: unknown }).defId : undefined;
    return typeof id === 'string' ? id : '';
  });
}

export function validateDeck(deck: Deck, db: CardDb, owned?: Record<string, true> | null): Violation[] {
  const out: Violation[] = [];
  const ids = idsOf(deck);
  // A missing format is Ranked; an empty id is treated like any unknown id (MODE_UNVERIFIED), not silently as Ranked (engine review).
  const formatId = deck && typeof deck.format === 'string' ? deck.format : 'ranked';
  const format = findFormat(db, formatId);

  // 1. Deck size (rules §1.1).
  if (ids.length !== SIZE) {
    out.push(violation('DECK_SIZE', 'error', `Deck has ${ids.length} cards; a deck must have exactly ${SIZE}.`, []));
  }

  // 2. One copy per card (rules §1.1). defIds are the base ids; variants are cosmetic and carry no id of their own.
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n < 2) continue;
    const c = db.get(id);
    out.push(violation('DUPLICATE_CARD', 'error', `${c ? label(db, c) : id} appears ${n} times; only one copy is allowed.`, [id]));
  }

  // 3-5. Pool: known, collectible, released at db.now (rules §1.1, class computed from synced data).
  ids.forEach((id, i) => {
    if (!id) out.push(violation('UNKNOWN_CARD', 'error', `Deck entry ${i + 1} has no card id.`, []));
  });
  const unique = [...counts.keys()];
  const cards: Card[] = [];
  for (const id of unique) {
    const c = db.get(id);
    if (!c) {
      out.push(violation('UNKNOWN_CARD', 'error', `${id} is not in the card database; it may have been renamed or removed since the card sync.`, [id]));
    } else if (c.cardClass === 'token') {
      out.push(violation('NOT_DECKABLE', 'error', notDeckableMessage(db, c), [id, ...creatorsOf(db, id).map((m) => m.defId)]));
    } else if (c.cardClass === 'upcoming') {
      out.push(violation('UNRELEASED', 'error', unreleasedMessage(db, c), [id]));
    } else {
      cards.push(c);
    }
  }

  // 6-9. Mode (rules §1.2, sync-data/formats.json).
  if (format && !format.constructed) {
    out.push(violation('MODE_NOT_CONSTRUCTED', 'info', `${format.name} decks are drafted in-game and cannot be built from a collection.`, []));
  } else if (!isCheckedFormat(format)) {
    out.push(violation('MODE_UNVERIFIED', 'warning', `${formatName(db, formatId)} restrictions are not verified; legality shown is for Ranked only.`, []));
  } else if (format) {
    const banned = new Set(format.banned);
    for (const c of cards) if (banned.has(c.defId)) out.push(violation('MODE_BANNED', 'error', bannedMessage(db, c, format), [c.defId]));
    if (format.stale) {
      out.push(violation('MODE_LIST_STALE', 'warning',
        `${format.name} ban list is from ${format.listDate ?? 'an unknown date'}; the mode has run since, and its current list may differ.`, []));
    }
  }

  // 12. Collection (data §5): only when a collection is loaded.
  if (owned) {
    for (const c of cards) if (owned[c.defId] !== true) out.push(violation('NOT_OWNED', 'warning', notOwnedMessage(db, c), [c.defId]));
  }

  // Skills: deck cards that count toward the 12, no cap known (rules §1.1). One line, never a verdict.
  const skills = cards.filter((c) => c.isSkill);
  if (skills.length > 0) {
    out.push(violation('SKILL_CARDS', 'info',
      `${listNames(skills.map((c) => label(db, c)))} ${skills.length === 1 ? 'is a skill' : 'are skills'}: skills count toward the 12 cards, and no limit on skills per deck is known.`,
      skills.map((c) => c.defId)));
  }
  return out;
}

/** A deck is legal when no violation is an error. Warnings and information never change the verdict. */
export function isLegal(violations: Violation[]): boolean {
  return !violations.some((v) => v.severity === 'error');
}

/**
 * Why `card` cannot be added to `deck` right now (spec §11 gates), or null. Order: unknown,
 * not deckable, unreleased, already in the deck, banned in the deck's mode, not owned.
 */
export function gateFor(card: Card, deck: Deck, db: CardDb, owned: Record<string, true> | null): { code: string; message: string } | null {
  const known = card && typeof card.defId === 'string' ? db.get(card.defId) : undefined;
  if (!known) {
    const id = card && typeof card.defId === 'string' ? card.defId : '';
    const name = card && typeof card.name === 'string' && card.name !== id ? `${card.name} (${id})` : id;
    return { code: 'UNKNOWN_CARD', message: `${name} is not in the card database; it may have been removed since the card sync.` };
  }
  if (known.cardClass === 'token') return { code: 'NOT_DECKABLE', message: notDeckableMessage(db, known) };
  if (known.cardClass === 'upcoming') return { code: 'UNRELEASED', message: unreleasedMessage(db, known) };
  if (idsOf(deck).includes(known.defId)) return { code: 'IN_DECK', message: `${label(db, known)} is already in the deck; only one copy is allowed.` };
  const format = findFormat(db, deck?.format);
  if (format && isCheckedFormat(format) && format.banned.includes(known.defId)) {
    return { code: 'MODE_BANNED', message: bannedMessage(db, known, format) };
  }
  if (owned && owned[known.defId] !== true) return { code: 'NOT_OWNED', message: notOwnedMessage(db, known) };
  return null;
}
