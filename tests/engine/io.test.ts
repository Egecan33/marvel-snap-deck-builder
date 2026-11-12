import { describe, expect, it } from 'vitest';
import { parseCollection } from '@/engine/io/collection';
import { decodeDeckCode, encodeDeckCode, shortCardCode } from '@/engine/io/deckcode';
import { exportDecklist, parseDecklist } from '@/engine/io/decklist';
import { isLegal, validateDeck } from '@/engine/rules/validate';
import type { Deck } from '@/engine/types';
import { card, deckNames, deckText, fixtureColliders, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();

const deckOf = (ids: string[], name = 'Test'): Deck => ({
  id: null, name, format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'brew',
});
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
/** Code line of a reference deck file: the first line that is not a comment. */
const codeLine = (name: string): string => deckText(name).split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#'))!;
/** Cards of a reference deck file read from its "# (cost) Name" lines only. */
const listed = (name: string): string[] =>
  deckText(name).split(/\r?\n/).map((l) => /^#\s*\(\d+\)\s*(.+)$/.exec(l.trim())?.[1]).filter((n): n is string => !!n).map((n) => card(n).defId);

// Sample pair from github.com/Mottelz/snapdeck, as kept in docs/research/analysis/deckcode/deckcode.mjs.
const PAIR = {
  short: 'QXBjbHBzQSxCbGQ1LENsbG5XbmdCLENydnNHbHZDLERyY2w3LEdtYnQ2LEtobnNoNyxMZFNmNyxNZGs1LE1yYnM3LFByeG1NZG5naHRGLFNjcm41',
  long: 'eyJOYW1lIjoiRGlzY2FyZCIsIkNhcmRzIjpbeyJDYXJkRGVmSWQiOiJBcG9jYWx5cHNlIn0seyJDYXJkRGVmSWQiOiJCbGFkZSJ9LHsiQ2FyZERlZklkIjoiQ29sbGVlbldpbmcifSx7IkNhcmREZWZJZCI6IkNvcnZ1c0dsYWl2ZSJ9LHsiQ2FyZERlZklkIjoiRHJhY3VsYSJ9LHsiQ2FyZERlZklkIjoiR2FtYml0In0seyJDYXJkRGVmSWQiOiJLaG9uc2h1In0seyJDYXJkRGVmSWQiOiJMYWR5U2lmIn0seyJDYXJkRGVmSWQiOiJNb2RvayJ9LHsiQ2FyZERlZklkIjoiTW9yYml1cyJ9LHsiQ2FyZERlZklkIjoiUHJveGltYU1pZG5pZ2h0In0seyJDYXJkRGVmSWQiOiJTY29ybiJ9XX0=',
  cards: ['Apocalypse', 'Blade', 'ColleenWing', 'CorvusGlaive', 'Dracula', 'Gambit', 'Khonshu', 'LadySif', 'Modok', 'Morbius', 'ProximaMidnight', 'Scorn'],
};
// A 2022 long code without a Name key (Den of Geek, same file).
const OLD_LONG = 'eyJDYXJkcyI6W3siQ2FyZERlZklkIjoiSGF3a2V5ZSJ9LHsiQ2FyZERlZklkIjoiUm9ja2V0UmFjY29vbiJ9LHsiQ2FyZERlZklkIjoiTWVkdXNhIn0seyJDYXJkRGVmSWQiOiJJcm9uaGVhcnQifSx7IkNhcmREZWZJZCI6IldoaXRlVGlnZXIifSx7IkNhcmREZWZJZCI6Ik9kaW4ifSx7IkNhcmREZWZJZCI6IkVsZWt0cmEifSx7IkNhcmREZWZJZCI6IldvbGZzYmFuZSJ9LHsiQ2FyZERlZklkIjoiR2Ftb3JhIn0seyJDYXJkRGVmSWQiOiJOaWdodGNyYXdsZXIifSx7IkNhcmREZWZJZCI6IkVuY2hhbnRyZXNzIn0seyJDYXJkRGVmSWQiOiJKZXNzaWNhSm9uZXMifV19';

describe('deck codes', () => {
  it('short card code: lower-case aeiouy removed, length in upper-case hex', () => {
    expect(shortCardCode('Blade')).toBe('Bld5');
    expect(shortCardCode('Apocalypse')).toBe('ApclpsA');
    expect(shortCardCode('HighEvolutionary')).toBe('HghEvltnr10');
  });

  it('reproduces the published short and long sample byte for byte', () => {
    expect(encodeDeckCode(PAIR.cards, '', 'short')).toBe(PAIR.short);
    expect(encodeDeckCode(PAIR.cards, 'Discard', 'long')).toBe(PAIR.long);
  });

  it('decodes the short and the long sample to the same 12 cards', () => {
    expect(decodeDeckCode(PAIR.short, db)).toEqual({ cards: PAIR.cards, name: null, format: 'short' });
    expect(decodeDeckCode(PAIR.long, db)).toEqual({ cards: PAIR.cards, name: 'Discard', format: 'long' });
  });

  it('decodes a 2022 long code that has no name', () => {
    const d = decodeDeckCode(OLD_LONG, db);
    expect(d?.format).toBe('long');
    expect(d?.name).toBeNull();
    expect(d?.cards).toHaveLength(12);
    expect(d?.cards.every((id) => db.get(id)?.cardClass === 'released')).toBe(true);
  });

  it('keeps a deck name with non-ASCII characters through a long round trip', () => {
    const code = encodeDeckCode(PAIR.cards, 'Araña “déjà vu” 龍', 'long');
    expect(code.startsWith('eyJ')).toBe(true);
    expect(decodeDeckCode(code, db)).toEqual({ cards: PAIR.cards, name: 'Araña “déjà vu” 龍', format: 'long' });
  });

  it('accepts surrounding whitespace and missing padding', () => {
    expect(decodeDeckCode(`  ${PAIR.long.replace(/=+$/, '')}\n`, db)?.cards).toEqual(PAIR.cards);
  });

  it('returns null for text that is not a deck code', () => {
    for (const text of ['', 'Hulk', 'Blade', 'not a code at all', '####', 'eyJ', 'AAAA', 'e30=', 'W10=']) expect(decodeDeckCode(text, db), text).toBeNull();
    expect(decodeDeckCode(undefined as unknown as string, db)).toBeNull();
  });

  it('never throws on a partial deck and round-trips it', () => {
    for (const n of [0, 1, 5, 13]) {
      const ids = [...PAIR.cards, 'Hulk'].slice(0, n);
      for (const format of ['short', 'long'] as const) {
        const code = encodeDeckCode(ids, 'Part', format);
        if (n > 0) expect(decodeDeckCode(code, db)?.cards, `${format} ${n}`).toEqual(ids);
      }
    }
  });

  it('keeps an id the database does not know as written, so the caller can report it', () => {
    const ids = ['LeftThePool', ...PAIR.cards.slice(1)];
    expect(decodeDeckCode(encodeDeckCode(ids, '', 'long'), db)?.cards).toEqual(ids);
    expect(decodeDeckCode(encodeDeckCode(ids, '', 'short'), db)?.cards).toEqual([shortCardCode('LeftThePool'), ...PAIR.cards.slice(1)]);
  });
});

describe('reference decks (tests/fixtures/decks)', () => {
  it('has six of them', () => {
    expect(deckNames()).toHaveLength(6);
  });

  for (const name of deckNames()) {
    it(`${name}: the short code in the file agrees with the ported encoder`, () => {
      const d = decodeDeckCode(codeLine(name), db);
      expect(d?.format).toBe('short');
      expect(d?.cards).toHaveLength(12);
      expect(sorted(d!.cards)).toEqual(sorted(listed(name)));
      expect(encodeDeckCode(d!.cards, '', 'short')).toBe(codeLine(name));
    });

    it(`${name}: short and long round trips`, () => {
      const ids = listed(name);
      expect(decodeDeckCode(encodeDeckCode(ids, '', 'short'), db)).toEqual({ cards: ids, name: null, format: 'short' });
      expect(decodeDeckCode(encodeDeckCode(ids, name, 'long'), db)).toEqual({ cards: ids, name, format: 'long' });
    });

    it(`${name}: parses to a legal deck and exports the same block`, () => {
      const parsed = parseDecklist(deckText(name), db);
      expect(parsed.unresolved).toEqual([]);
      expect(sorted(parsed.cards)).toEqual(sorted(listed(name)));
      expect(isLegal(validateDeck(deckOf(parsed.cards), db))).toBe(true);

      const fileBlock = deckText(name).split(/\r?\n/).slice(0, 14).join('\n');
      const out = exportDecklist(deckOf([...parsed.cards].reverse(), ''), db);
      expect(out).toBe(fileBlock);
      expect(sorted(parseDecklist(out, db).cards)).toEqual(sorted(parsed.cards));
    });
  }
});

describe('parseDecklist', () => {
  const fantomex = listed('fantomex');

  it('reads a bare short code and a bare long code', () => {
    expect(parseDecklist(codeLine('fantomex'), db)).toEqual({ cards: decodeDeckCode(codeLine('fantomex'), db)!.cards, unresolved: [], name: null });
    expect(parseDecklist(PAIR.long, db)).toEqual({ cards: PAIR.cards, unresolved: [], name: 'Discard' });
  });

  it('finds a code embedded in a pasted block of other text', () => {
    const text = `Hey, try my new list!\r\n\r\nDeck code: ${PAIR.short}\r\n\r\nIt wins a lot.`;
    expect(parseDecklist(text, db)).toEqual({ cards: PAIR.cards, unresolved: [], name: null });
  });

  it('reads the "# (cost) Name" lines when the block has no code', () => {
    const text = deckText('fantomex').split(/\r?\n/).filter((l) => l.startsWith('#')).join('\n');
    const parsed = parseDecklist(text, db);
    expect(parsed.cards).toEqual(fantomex);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.name).toBeNull();
  });

  it('reads (cost) Name, 1x Name, Name x1, bullets, numbering, defIds and CSV rows', () => {
    const text = [
      '(1) Blade', '1x The Hood', '1 Bucky Barnes', 'Carnage x1', '- Marrow', '* Wild Child', '7. Gambit', 'Killmonger',
      'MobiusMMobius', 'shadow king', 'Fantomex,4,6', 'Zombie Captain Marvel (4)',
    ].join('\n');
    const parsed = parseDecklist(text, db);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.cards).toEqual(fantomex);
  });

  it('keeps names that contain digits, commas, dots and punctuation', () => {
    const names = ['Doctor Doom 2099', 'Drax, Avatar Of Life', 'M.O.D.O.K.', 'Agent 13', 'Jeff the Baby Dolphin!?', 'Spider-Man 2099', 'Professor X', 'Araña', 'X-23'];
    const parsed = parseDecklist(names.map((n, i) => (i % 2 ? `1x ${n}` : `# (3) ${n}`)).join('\n'), db);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.cards).toEqual(names.map((n) => card(n).defId));
    expect(parsed.cards).toContain('Doom2099');
  });

  it('accepts curly apostrophes, wrong case and missing accents', () => {
    const parsed = parseDecklist('M’Baku\nASKANI‘SON\narana\nshang chi', db);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.cards).toEqual(['MBaku', 'Askanison', 'Arana', 'ShangChi']);
  });

  it('reports unknown lines with their line number and never drops them', () => {
    const parsed = parseDecklist('Blade\n\nFlurbo the Unknown\n1x Hulk\n(2) Nobody Here', db);
    expect(parsed.cards).toEqual(['Blade', 'Hulk']);
    expect(parsed.unresolved).toEqual([{ line: 3, text: 'Flurbo the Unknown' }, { line: 5, text: '(2) Nobody Here' }]);
  });

  it('resolves a shared name to the released card and never to a token or mode copy', () => {
    const colliders = new Set(fixtureColliders());
    for (const id of colliders) {
      const hit = parseDecklist(db.get(id)!.name, db);
      expect(hit.cards.every((c) => !colliders.has(c) && db.get(c)?.cardClass === 'released'), id).toBe(true);
    }
    expect(parseDecklist('Hulk', db).cards).toEqual(['Hulk']);
  });

  it('reports a token as unresolved whether it is written by name or by id', () => {
    const parsed = parseDecklist('Winter Soldier\nBannerHulk\nBlade', db);
    expect(parsed.cards).toEqual(['Blade']);
    expect(parsed.unresolved.map((u) => u.line)).toEqual([1, 2]);
    expect(parsed.unresolved[0].text).toContain('Winter Soldier');
  });

  it('keeps an unreleased card so that validation can say when it releases', () => {
    const parsed = parseDecklist(['Elder Dragon of the Moon', ...fantomex.slice(1)].join('\n'), db);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.cards[0]).toBe('ElderDragonOfTheMoon');
    expect(validateDeck(deckOf(parsed.cards), db).map((v) => v.code)).toEqual(['UNRELEASED']);
  });

  it('passes 11 and 13 cards and duplicates through unchanged', () => {
    expect(parseDecklist(fantomex.slice(0, 11).join('\n'), db).cards).toHaveLength(11);
    expect(parseDecklist([...fantomex, 'Hulk'].join('\n'), db).cards).toHaveLength(13);
    expect(parseDecklist(encodeDeckCode([...fantomex, 'Hulk'], '', 'short'), db).cards).toHaveLength(13);
    expect(parseDecklist('Hulk\nHulk', db).cards).toEqual(['Hulk', 'Hulk']);
  });

  it('reports the cards of a code that the database does not know or cannot deck', () => {
    const long = parseDecklist(`# my deck\n${encodeDeckCode(['LeftThePool', 'WinterSoldier', ...PAIR.cards.slice(2)], 'Old', 'long')}`, db);
    expect(long.cards).toEqual(PAIR.cards.slice(2));
    expect(long.name).toBe('Old');
    expect(long.unresolved.map((u) => u.line)).toEqual([2, 2]);
    expect(long.unresolved[0].text).toContain('LeftThePool');
    expect(long.unresolved[1].text).toContain('WinterSoldier');

    const short = parseDecklist(encodeDeckCode(['LeftThePool', ...PAIR.cards.slice(1)], '', 'short'), db);
    expect(short.cards).toEqual(PAIR.cards.slice(1));
    expect(short.unresolved).toHaveLength(1);
    expect(short.unresolved[0].text).toContain(shortCardCode('LeftThePool'));
  });

  it('returns nothing, without throwing, for empty or non-text input', () => {
    for (const text of ['', '   \n\n', '#\n#\n', undefined, null, 42]) {
      expect(parseDecklist(text as unknown as string, db)).toEqual({ cards: [], unresolved: [], name: null });
    }
  });
});

describe('exportDecklist', () => {
  it('writes cost-then-name lines, a bare #, the short code and the deck name', () => {
    const out = exportDecklist(deckOf(PAIR.cards, 'Discard'), db).split('\n');
    expect(out.slice(0, 12).every((l) => /^# \(\d+\) .+$/.test(l))).toBe(true);
    const costs = out.slice(0, 12).map((l) => Number(/\((\d+)\)/.exec(l)![1]));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(out[12]).toBe('#');
    expect(decodeDeckCode(out[13], db)?.format).toBe('short');
    expect(sorted(decodeDeckCode(out[13], db)!.cards)).toEqual(sorted(PAIR.cards));
    expect(out.slice(14)).toEqual(['#', '# Discard']);
  });

  it('writes no code for a deck that is not 12 different known cards, and says why', () => {
    const five = exportDecklist(deckOf(PAIR.cards.slice(0, 5)), db);
    expect(five.split('\n').filter((l) => /^# \(\d+\)/.test(l))).toHaveLength(5);
    expect(five.split('\n').some((l) => l !== '' && !l.startsWith('#'))).toBe(false);
    expect(five).toContain('5 cards');
    expect(parseDecklist(five, db).cards).toHaveLength(5);

    expect(() => exportDecklist(deckOf([]), db)).not.toThrow();
    const unknown = exportDecklist(deckOf(['LeftThePool', ...PAIR.cards.slice(1)]), db);
    expect(unknown).toContain('LeftThePool');
    expect(unknown.split('\n').some((l) => l !== '' && !l.startsWith('#'))).toBe(false);
  });
});

describe('parseCollection', () => {
  it('reads the distinct released cards of a game state file', () => {
    const file = JSON.stringify({
      ServerState: {
        Cards: [
          { CardDefId: 'Hulk', RarityDefId: 'Common' }, { CardDefId: 'Hulk', RarityDefId: 'Rare' }, { CardDefId: 'Blade' },
          { CardDefId: 'WinterSoldier' }, { CardDefId: 'BrandNewCardNobodyKnows' }, { RarityDefId: 'Common' }, null,
        ],
        CardDefStats: { Stats: { Hulk: { Boosters: 5 } } },
      },
    });
    const got = parseCollection(`﻿${file}`, db);
    expect(got.kind).toBe('state-file');
    expect(got.owned).toEqual(['Hulk', 'Blade']);
    expect(got.unresolved).toHaveLength(2);
    expect(got.unresolved.join(' ')).toContain('WinterSoldier');
    expect(got.unresolved.join(' ')).toContain('BrandNewCardNobodyKnows');
  });

  it('reports a JSON file it cannot use instead of guessing', () => {
    const broken = parseCollection('{"ServerState": {"Cards": [', db);
    expect(broken).toMatchObject({ owned: [], kind: 'state-file' });
    expect(broken.unresolved).toHaveLength(1);
    const other = parseCollection('{"collection": ["Hulk"]}', db);
    expect(other).toMatchObject({ owned: [], kind: 'state-file' });
    expect(other.unresolved).toHaveLength(1);
  });

  it('reads a list of names, ids, "# (cost) Name" lines and CSV rows', () => {
    const got = parseCollection('Hulk\n# (1) Blade\nShangChi,Series 3\n1x M’Baku\nhulk\n\nNot A Card\n', db);
    expect(got.kind).toBe('list');
    expect(got.owned).toEqual(['Hulk', 'Blade', 'ShangChi', 'MBaku']);
    expect(got.unresolved).toEqual(['Not A Card']);
  });

  it('marks the cards of several pasted deck codes as owned', () => {
    const text = `${deckText('fantomex')}\n\n${codeLine('kluh')}\n${PAIR.long}\n`;
    const got = parseCollection(text, db);
    expect(got.kind).toBe('deck-codes');
    expect(got.unresolved).toEqual([]);
    expect(sorted(got.owned)).toEqual(sorted([...new Set([...listed('fantomex'), ...listed('kluh'), ...PAIR.cards])]));
  });

  it('never owns a token, a mode copy or an unreleased card', () => {
    const got = parseCollection('Winter Soldier\nBannerHulk\nElder Dragon of the Moon\nHulk', db);
    expect(got.owned).toEqual(['Hulk']);
    expect(got.unresolved).toHaveLength(3);
    const viaCode = parseCollection(encodeDeckCode(['WinterSoldier', 'LeftThePool', 'Hulk'], '', 'long'), db);
    expect(viaCode.owned).toEqual(['Hulk']);
    expect(viaCode.unresolved).toHaveLength(2);
    for (const id of fixtureColliders()) expect(parseCollection(db.get(id)!.name, db).owned.every((c) => db.get(c)?.cardClass === 'released'), id).toBe(true);
  });

  it('returns an empty list for empty or non-text input', () => {
    for (const input of ['', ' \n ', undefined, null]) {
      expect(parseCollection(input as unknown as string, db)).toEqual({ owned: [], unresolved: [], kind: 'list' });
    }
  });
});
