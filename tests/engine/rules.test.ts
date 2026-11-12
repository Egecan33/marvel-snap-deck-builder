import { describe, expect, it } from 'vitest';
import { parseDecklist } from '@/engine/io/decklist';
import { findFormat, isCheckedFormat } from '@/engine/rules/formats';
import { gateFor, isLegal, validateDeck } from '@/engine/rules/validate';
import type { CardDb, Deck, Violation } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const DAY = 86_400_000;

const deckOf = (ids: string[], format = 'ranked'): Deck => ({
  id: null, name: 'Test', format, cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'brew',
});
const ref = (name: string): string[] => parseDecklist(deckText(name), db).cards;
const codes = (v: Violation[]): string[] => v.map((x) => x.code);
const only = (v: Violation[], code: string): Violation[] => v.filter((x) => x.code === code);
/** The reference deck with its first card replaced. */
const swapFirst = (name: string, id: string): string[] => [id, ...ref(name).slice(1)];

const fantomex = ref('fantomex');
const arthur = ref('arthur');

describe('validateDeck: rule checks (rules §5, 1-6)', () => {
  it('accepts the six reference decks in Ranked', () => {
    for (const name of ['arthur', 'fantomex', 'kluh', 'magneto', 'patriot', 'zombie']) {
      const v = validateDeck(deckOf(ref(name)), db);
      expect(v.filter((x) => x.severity !== 'info'), name).toEqual([]);
      expect(isLegal(v), name).toBe(true);
    }
  });

  it('1 DECK_SIZE: 11 cards is an error that states the count', () => {
    const v = validateDeck(deckOf(fantomex.slice(0, 11)), db);
    expect(codes(v)).toEqual(['DECK_SIZE']);
    expect(v[0].severity).toBe('error');
    expect(v[0].message).toContain('11 cards');
    expect(v[0].message).toContain('exactly 12');
    expect(isLegal(v)).toBe(false);
  });

  it('1 DECK_SIZE: an empty deck gives one size error and nothing else', () => {
    const v = validateDeck(deckOf([]), db);
    expect(codes(v)).toEqual(['DECK_SIZE']);
    expect(v[0].message).toContain('0 cards');
  });

  it('1 DECK_SIZE: 13 different cards is an error', () => {
    const v = validateDeck(deckOf([...fantomex, 'Hulk']), db);
    expect(codes(v)).toEqual(['DECK_SIZE']);
    expect(v[0].message).toContain('13 cards');
  });

  it('2 DUPLICATE_CARD: names the card and how often it appears', () => {
    const v = validateDeck(deckOf(swapFirst('fantomex', fantomex[1])), db);
    const dup = only(v, 'DUPLICATE_CARD');
    expect(dup).toHaveLength(1);
    expect(dup[0].severity).toBe('error');
    expect(dup[0].cardIds).toEqual([fantomex[1]]);
    expect(dup[0].message).toContain(card(fantomex[1]).name);
    expect(dup[0].message).toContain('2 times');
    expect(isLegal(v)).toBe(false);
  });

  it('3 UNKNOWN_CARD: an id that is not in the card database', () => {
    const v = validateDeck(deckOf(swapFirst('fantomex', 'LeftThePoolCard')), db);
    const unknown = only(v, 'UNKNOWN_CARD');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe('error');
    expect(unknown[0].cardIds).toEqual(['LeftThePoolCard']);
    expect(unknown[0].message).toContain('LeftThePoolCard');
    expect(codes(v)).toEqual(['UNKNOWN_CARD']);
  });

  it('4 NOT_DECKABLE: a created card names the card that makes it', () => {
    expect(card('WinterSoldier').cardClass).toBe('token');
    const v = validateDeck(deckOf(swapFirst('kluh', 'WinterSoldier')), db);
    const bad = only(v, 'NOT_DECKABLE');
    expect(bad).toHaveLength(1);
    expect(bad[0].severity).toBe('error');
    expect(bad[0].message).toContain('Winter Soldier');
    expect(bad[0].message).toContain('Bucky Barnes');
    expect(bad[0].cardIds).toContain('WinterSoldier');
    expect(isLegal(v)).toBe(false);
  });

  it('4 NOT_DECKABLE: a mode copy that shares a released name is told apart by its id', () => {
    expect(card('BannerHulk').name).toBe('Hulk');
    const v = only(validateDeck(deckOf(swapFirst('kluh', 'BannerHulk')), db), 'NOT_DECKABLE');
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('BannerHulk');
    expect(v[0].message).toContain('cannot be put in a deck');
  });

  it('5 UNRELEASED: a card is an error before its date and legal after it', () => {
    const newest = [...db.released()].filter((c) => c.releaseAt !== null).sort((a, b) => b.releaseAt! - a.releaseAt!)[0];
    const ids = swapFirst('fantomex', newest.defId);
    expect(isLegal(validateDeck(deckOf(ids), db))).toBe(true);

    const before: CardDb = fixtureDb(newest.releaseAt! - DAY);
    expect(before.get(newest.defId)?.cardClass).toBe('upcoming');
    const v = validateDeck(deckOf(ids), before);
    const un = only(v, 'UNRELEASED');
    expect(un).toHaveLength(1);
    expect(un[0].severity).toBe('error');
    expect(un[0].cardIds).toEqual([newest.defId]);
    expect(un[0].message).toContain(newest.name);
    expect(un[0].message).toContain(new Date(newest.releaseAt!).toISOString().slice(0, 10));
    expect(isLegal(v)).toBe(false);
  });

  it('5 UNRELEASED: an announced card with a future date', () => {
    const v = only(validateDeck(deckOf(swapFirst('fantomex', 'ElderDragonOfTheMoon')), db), 'UNRELEASED');
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Elder Dragon of the Moon');
    expect(v[0].message).toContain('2026-11-17');
  });

  it('6 MODE_BANNED: a Sanctum Showdown banned card is an error there and legal in Ranked', () => {
    expect(arthur).toContain('CaptainMarvel');
    expect(isLegal(validateDeck(deckOf(arthur, 'ranked'), db))).toBe(true);

    const v = validateDeck(deckOf(arthur, 'sanctum-showdown'), db);
    const banned = only(v, 'MODE_BANNED');
    expect(banned).toHaveLength(1);
    expect(banned[0].severity).toBe('error');
    expect(banned[0].cardIds).toEqual(['CaptainMarvel']);
    expect(banned[0].message).toContain('Captain Marvel');
    expect(banned[0].message).toContain('Sanctum Showdown');
    expect(banned[0].message).toContain('https://marvelsnap.com/new-limited-time-mode-sanctum-showdown/');
    expect(isLegal(v)).toBe(false);
  });
});

describe('validateDeck: mode and collection notes (rules §5, 7-9 and 12)', () => {
  it('7 MODE_UNVERIFIED: an unverified mode warns and claims Ranked legality only', () => {
    const v = validateDeck(deckOf(fantomex, 'high-voltage'), db);
    const w = only(v, 'MODE_UNVERIFIED');
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe('warning');
    expect(w[0].message).toContain('High Voltage');
    expect(w[0].message).toContain('not verified');
    expect(w[0].message).toContain('Ranked only');
    expect(isCheckedFormat(findFormat(db, 'high-voltage'))).toBe(false);
    expect(isCheckedFormat(findFormat(db, 'ranked'))).toBe(true);
  });

  it('7 MODE_UNVERIFIED: a mode id that formats.json does not know', () => {
    const v = validateDeck(deckOf(fantomex, 'made-up-mode'), db);
    expect(codes(v)).toEqual(['MODE_UNVERIFIED']);
    expect(v[0].message).toContain('made-up-mode');
    expect(isCheckedFormat(findFormat(db, 'made-up-mode'))).toBe(false);
  });

  it('8 MODE_LIST_STALE: a stale ban list warns with its date and keeps the deck legal', () => {
    const v = validateDeck(deckOf(fantomex, 'sanctum-showdown'), db);
    expect(codes(v)).toEqual(['MODE_LIST_STALE']);
    expect(v[0].severity).toBe('warning');
    expect(v[0].message).toContain('Sanctum Showdown');
    expect(v[0].message).toContain('2025');
    expect(isLegal(v)).toBe(true);
    expect(codes(validateDeck(deckOf(fantomex, 'ranked'), db))).toEqual([]);
  });

  it('9 MODE_NOT_CONSTRUCTED: Draft is information, not a verdict', () => {
    const v = validateDeck(deckOf(fantomex, 'draft'), db);
    expect(codes(v)).toEqual(['MODE_NOT_CONSTRUCTED']);
    expect(v[0].severity).toBe('info');
    expect(v[0].message).toContain('Draft');
    expect(isCheckedFormat(findFormat(db, 'draft'))).toBe(false);
  });

  it('12 NOT_OWNED: warns per missing card when a collection is loaded, never without one', () => {
    const owned: Record<string, true> = {};
    for (const id of fantomex.slice(2)) owned[id] = true;
    const v = validateDeck(deckOf(fantomex), db, owned);
    const missing = only(v, 'NOT_OWNED');
    expect(missing.map((x) => x.cardIds[0]).sort()).toEqual(fantomex.slice(0, 2).sort());
    for (const m of missing) {
      expect(m.severity).toBe('warning');
      expect(m.message).toContain(card(m.cardIds[0]).name);
      expect(m.message).toContain(card(m.cardIds[0]).seriesLabel);
    }
    expect(isLegal(v)).toBe(true);
    expect(only(validateDeck(deckOf(fantomex), db, null), 'NOT_OWNED')).toEqual([]);
    expect(only(validateDeck(deckOf(fantomex), db), 'NOT_OWNED')).toEqual([]);
  });

  it('a deck with skills gets exactly one info line naming them', () => {
    const zombie = ref('zombie');
    const skills = zombie.filter((id) => card(id).isSkill);
    expect(skills.length).toBeGreaterThanOrEqual(2);
    const v = validateDeck(deckOf(zombie), db);
    expect(codes(v)).toEqual(['SKILL_CARDS']);
    expect(v[0].severity).toBe('info');
    expect([...v[0].cardIds].sort()).toEqual([...skills].sort());
    for (const id of skills) expect(v[0].message).toContain(card(id).name);
    expect(isLegal(v)).toBe(true);
    expect(only(validateDeck(deckOf(fantomex), db), 'SKILL_CARDS')).toEqual([]);
  });
});

describe('validateDeck: odd input', () => {
  it('every violation that concerns cards names each of them', () => {
    const messy = ['WinterSoldier', 'ElderDragonOfTheMoon', 'Gone', 'CaptainMarvel', 'CaptainMarvel', 'AstralProjection', 'Hulk', 'BannerHulk'];
    const v = validateDeck(deckOf(messy, 'sanctum-showdown'), db, { Hulk: true });
    expect(new Set(codes(v))).toEqual(new Set([
      'DECK_SIZE', 'DUPLICATE_CARD', 'UNKNOWN_CARD', 'NOT_DECKABLE', 'UNRELEASED', 'MODE_BANNED', 'MODE_LIST_STALE', 'NOT_OWNED', 'SKILL_CARDS',
    ]));
    for (const x of v) {
      expect(x.heuristic, x.code).toBe(false);
      for (const id of x.cardIds) {
        const c = db.get(id);
        expect(x.message.includes(id) || (c !== undefined && x.message.includes(c.name)), `${x.code} ${id}: ${x.message}`).toBe(true);
      }
    }
  });

  it('does not throw on broken deck objects', () => {
    const broken = { id: null, name: '', format: 'ranked', cards: [{ defId: '', locked: false }, null, { locked: true }], themes: [], buildMode: 'brew' } as unknown as Deck;
    expect(() => validateDeck(broken, db)).not.toThrow();
    expect(isLegal(validateDeck(broken, db))).toBe(false);
    expect(() => validateDeck({ ...deckOf([]), cards: undefined } as unknown as Deck, db)).not.toThrow();
  });

  it('isLegal is true only without errors', () => {
    const v = (severity: Violation['severity']): Violation => ({ code: 'X', severity, message: '', cardIds: [], heuristic: false });
    expect(isLegal([])).toBe(true);
    expect(isLegal([v('warning'), v('info')])).toBe(true);
    expect(isLegal([v('warning'), v('error')])).toBe(false);
  });
});

describe('gateFor', () => {
  const ranked = deckOf(fantomex);
  const sanctum = deckOf(fantomex, 'sanctum-showdown');

  it('is null for a released card that the mode allows', () => {
    expect(gateFor(card('Hulk'), ranked, db, null)).toBeNull();
    expect(gateFor(card('CaptainMarvel'), ranked, db, null)).toBeNull();
    expect(gateFor(card('Hulk'), sanctum, db, { Hulk: true })).toBeNull();
  });

  it('gates tokens, unreleased cards, mode bans and unowned cards, naming the card', () => {
    const token = gateFor(card('WinterSoldier'), ranked, db, null);
    expect(token?.code).toBe('NOT_DECKABLE');
    expect(token?.message).toContain('Winter Soldier');

    const upcoming = gateFor(card('ElderDragonOfTheMoon'), ranked, db, null);
    expect(upcoming?.code).toBe('UNRELEASED');
    expect(upcoming?.message).toContain('2026-11-17');

    const banned = gateFor(card('CaptainMarvel'), sanctum, db, null);
    expect(banned?.code).toBe('MODE_BANNED');
    expect(banned?.message).toContain('Captain Marvel');

    const unowned = gateFor(card('Hulk'), ranked, db, { Blade: true });
    expect(unowned?.code).toBe('NOT_OWNED');
    expect(unowned?.message).toContain('Hulk');
  });

  it('gates a card object the database no longer holds', () => {
    const ghost = { ...card('Hulk'), defId: 'GhostCard', name: 'Ghost Card' };
    expect(gateFor(ghost, ranked, db, null)?.code).toBe('UNKNOWN_CARD');
  });
});
