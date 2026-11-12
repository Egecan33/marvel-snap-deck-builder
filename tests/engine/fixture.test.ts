import { describe, expect, it } from 'vitest';
import { classOf, clusterLists, normalizeName, toCard } from '@/engine/carddb';
import { cleanText, findTextHoles } from '@/engine/text/clean';
import { card, deckNames, deckText, fixtureColliders, fixtureDb, fixtureNow, fixtureRows, textFixes } from '../helpers/fixture-db';

const db = fixtureDb();
const DAY = 86_400_000;

describe('card fixture', () => {
  it('holds the released pool, upcoming cards and the tokens they create', () => {
    expect(db.released().length).toBeGreaterThan(450);
    expect(db.released().every((c) => c.cardClass === 'released')).toBe(true);
    expect(db.all().some((c) => c.cardClass === 'upcoming')).toBe(true);
    for (const c of db.all()) for (const t of c.cardClass === 'token' ? [] : c.tokens) expect(db.get(t), `${c.defId} -> ${t}`).toBeDefined();
  });

  it('uses defIds made of letters and digits only', () => {
    expect(db.all().every((c) => /^[A-Za-z0-9]+$/.test(c.defId))).toBe(true);
  });

  it('has sane numbers and no markup on every card', () => {
    for (const c of db.all()) {
      expect(Number.isFinite(c.cost) && Number.isFinite(c.power), c.defId).toBe(true);
      expect(c.text.replace(/ -> /g, ' '), c.defId).not.toMatch(/[<>\n\u0001’]/);
      expect(c.hasAbility, c.defId).toBe(c.text !== '');
    }
    expect(card('Hulk').hasAbility).toBe(false);
    expect(card('Sentinel').text).toMatch(/^On Reveal: /);
  });

  it('has no two released cards with the same lookup name', () => {
    const names = db.released().map((c) => normalizeName(c.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('byName resolves every released card to itself', () => {
    for (const c of db.released()) expect(db.byName(c.name)?.defId, c.name).toBe(c.defId);
  });

  it('carries 20 non-deckable rows that share a name with a released card, and byName never returns them', () => {
    const colliders = fixtureColliders();
    expect(colliders).toHaveLength(20);
    for (const id of colliders) {
      const c = db.get(id)!;
      expect(c, id).toBeDefined();
      expect(c.cardClass, id).not.toBe('released');
      const found = db.byName(c.name)!;
      expect(found.cardClass, c.name).toBe('released');
      expect(found.defId).not.toBe(id);
    }
    expect(db.byName('hulk')?.defId).toBe('Hulk');
    expect(db.byName('m’baku')?.defId).toBe('MBaku');
  });

  it('recomputes classes for another clock value', () => {
    const newest = db.released().filter((c) => c.releaseAt !== null).sort((a, b) => b.releaseAt! - a.releaseAt!)[0];
    const before = fixtureDb(newest.releaseAt! - DAY);
    expect(before.get(newest.defId)?.cardClass).toBe('upcoming');
    expect(before.released().length).toBeLessThan(db.released().length);
    const row = fixtureRows().find((r) => classOf(r, fixtureNow()) === 'upcoming' && (r.series ?? 0) > 0);
    if (row) expect(toCard(row, Math.max(...row.seriesStartTimestamps!) + DAY).cardClass).toBe('released');
  });

  it('has skills among the released cards', () => {
    expect(db.released().filter((c) => c.isSkill).length).toBeGreaterThan(0);
  });

  it('has no features or edges before the features engine exists, and reads formats from sync-data', () => {
    if (db.features('Hulk') === undefined) expect(db.edges('Hulk')).toEqual([]);
    expect(db.formats().map((f) => f.id)).toEqual(expect.arrayContaining(['ranked', 'sanctum-showdown', 'draft']));
  });
});

describe('formats.json', () => {
  it('lists only released cards as banned, by defId', () => {
    for (const f of db.formats()) for (const id of f.banned) expect(db.get(id)?.cardClass, `${f.id}: ${id}`).toBe('released');
    const sanctum = db.formats().find((f) => f.id === 'sanctum-showdown')!;
    expect(sanctum.banned).toHaveLength(19);
    expect(sanctum.stale).toBe(true);
    expect(sanctum.sourceUrl).toMatch(/^https:\/\/marvelsnap\.com\//);
    expect(db.formats().find((f) => f.id === 'ranked')).toMatchObject({ verified: true, banned: [], constructed: true });
    for (const id of ['high-voltage', 'grand-arena', 'team-clash', 'deadpools-diner']) expect(db.formats().find((f) => f.id === id)?.verified, id).toBe(false);
    expect(db.formats().find((f) => f.id === 'draft')?.constructed).toBe(false);
  });
});

describe('dropped numbers in card text', () => {
  const fixes = textFixes();

  it('detects each hole pattern and ignores layout whitespace', () => {
    const c = (rawText: string) => ({ defId: 'X', rawText, text: cleanText(rawText) });
    expect(findTextHoles([c('<b>On Reveal:</b> Draw all cards that cost  from your deck.')])).toEqual(['X']);
    expect(findTextHoles([c('<b>When Destroyed:</b> Return this to your hand. It costs .')])).toEqual(['X']);
    expect(findTextHoles([c('<b>On Reveal:</b> Add a random -Cost or more card to your hand.')])).toEqual(['X']);
    expect(findTextHoles([c('<sprite=4> <b>Objective:</b> Do it <sprite=0> Win. <color=#d040ff>(/6)</color>')])).toEqual(['X']);
    expect(findTextHoles([c('Give +2 Power for each turn. (+)')])).toEqual(['X']);
    expect(findTextHoles([c('<sprite=4> <b>Objective:</b> Do it <sprite=0> Win. <color=#d040ff>(4/6)</color>')])).toEqual([]);
    expect(findTextHoles([c('<b>On Reveal</b>: +1 Power for each \ncard in your hand.  \n<b>Quickdraw</b>: Give your hand +1 Power.')])).toEqual([]);
    expect(findTextHoles([c('<b>On Reveal:</b> Give a card -3 Cost.')])).toEqual([]);
    expect(findTextHoles([c('<i>"flavour"</i>')])).toEqual([]);
  });

  it('a fix applies only while the description equals the reviewed rawText', () => {
    const row = { defId: 'JaneFoster', name: 'Jane Foster', cost: 5, power: 8, description: '<b>On Reveal:</b> Draw all cards that cost  from your deck.' };
    const fix = { JaneFoster: { rawText: row.description, text: 'On Reveal: Draw all cards that cost 0 from your deck.' } };
    expect(toCard(row, 0, fix).text).toBe('On Reveal: Draw all cards that cost 0 from your deck.');
    expect(toCard(row, 0, fix).rawText).toBe(row.description);
    expect(toCard({ ...row, description: '<b>On Reveal:</b> Draw 2 cards.' }, 0, fix).text).toBe('On Reveal: Draw 2 cards.');
    expect(toCard(row, 0).text).toBe('On Reveal: Draw all cards that cost from your deck.');
    expect(findTextHoles([toCard(row, 0, fix)])).toEqual([]);
    expect(findTextHoles([toCard(row, 0)])).toEqual(['JaneFoster']);
  });

  it('guard: no released fixture card has a hole without a valid fix', () => {
    expect(findTextHoles(db.released())).toEqual([]);
  });

  it('every fix still matches its card and changes only the missing value', () => {
    const rows = new Map(fixtureRows().map((r) => [r.defId, r]));
    for (const [defId, fix] of Object.entries(fixes)) {
      const row = rows.get(defId);
      expect(row, defId).toBeDefined();
      expect(row!.description, `${defId}: source text changed, review the fix`).toBe(fix.rawText);
      expect(findTextHoles([{ defId, rawText: fix.rawText, text: fix.text }]), defId).toEqual([]);
      // The fix is the cleaned source text with digits inserted and nothing else changed.
      expect(fix.text.replace(/\d/g, '').replace(/\s+/g, ''), defId).toBe(cleanText(fix.rawText).replace(/\d/g, '').replace(/\s+/g, ''));
      expect(card(defId).text).toBe(fix.text);
    }
    expect(Object.keys(fixes).length).toBeGreaterThanOrEqual(24);
    expect(findTextHoles(fixtureRows().filter((r) => classOf(r, fixtureNow()) === 'released').map((r) => toCard(r, fixtureNow()))).length).toBeGreaterThanOrEqual(24);
  });
});

describe('meta fixture', () => {
  const meta = db.meta();

  it('holds the 300 most-played lists with consistent info', () => {
    const info = meta.info()!;
    const lists = meta.lists();
    expect(lists).toHaveLength(300);
    expect(info.lists).toBe(300);
    expect(info.games).toBe(lists.reduce((s, l) => s + l.games, 0));
    expect(info.clusters).toBe(new Set(lists.map((l) => l.cluster)).size);
    expect(clusterLists(lists)).toEqual(lists.map((l) => l.cluster));
    expect(info.baselineWinRate).toBeGreaterThan(0.3);
    expect(info.baselineWinRate).toBeLessThan(0.8);
    expect(info.periodId).not.toBeNull();
    for (let i = 1; i < lists.length; i++) expect(lists[i - 1].games).toBeGreaterThanOrEqual(lists[i].games);
  });

  it('lists are 12 distinct known cards with a sorted key', () => {
    for (const l of meta.lists()) {
      expect(new Set(l.cards).size).toBe(12);
      expect(l.key).toBe([...l.cards].sort().join('|'));
      for (const id of l.cards) expect(db.get(id), id).toBeDefined();
      expect(l.wins).toBeLessThanOrEqual(l.games);
    }
  });

  it('has the archetype of every labelled list', () => {
    const ids = new Set(meta.archetypes().map((a) => a.id));
    for (const l of meta.lists()) if (l.archetypeId !== null) expect(ids.has(l.archetypeId)).toBe(true);
    for (const a of meta.archetypes()) {
      expect(a.name).not.toBe('');
      expect(a.sample).toHaveLength(12);
      expect(a.topCards.length).toBeGreaterThan(0);
    }
  });

  it('answers card and pair questions without NaN', () => {
    const top = meta.lists()[0];
    const stat = meta.cardStat(top.cards[0])!;
    expect(stat.lists).toBeGreaterThan(0);
    expect(stat.listShare).toBeGreaterThan(0);
    expect(stat.listShare).toBeLessThanOrEqual(1);
    expect(Number.isNaN(stat.clusterShare)).toBe(false);
    expect(meta.pair(top.cards[0], top.cards[1]).lists).toBeGreaterThan(0);
    expect(meta.pair(top.cards[0], 'Squirrel')).toEqual({ lists: 0, clusters: 0 });
    expect(meta.listsWith(top.cards[0])).toContain(0);
  });
});

describe('reference decklists', () => {
  it('are six lists from six archetypes whose lines resolve to 12 released cards', () => {
    const names = deckNames();
    expect(names).toHaveLength(6);
    const keys = new Set<string>();
    for (const name of names) {
      const lines = deckText(name).split('\n').map((l) => /^#\s*\(\s*(\d+)\s*\)\s*(.+?)\s*$/.exec(l)).filter((m) => m !== null);
      expect(lines, name).toHaveLength(12);
      const cards = lines.map((m) => db.byName(m[2])!);
      for (const [i, c] of cards.entries()) {
        expect(c, `${name}: ${lines[i][2]}`).toBeDefined();
        expect(c.cardClass).toBe('released');
        expect(c.cost).toBe(Number(lines[i][1]));
      }
      const key = cards.map((c) => c.defId).sort().join('|');
      const list = db.meta().lists().find((l) => l.key === key);
      expect(list, name).toBeDefined();
      expect(list!.archetypeId).not.toBeNull();
      keys.add(String(list!.archetypeId));
    }
    expect(keys.size).toBe(6);
  });
});
