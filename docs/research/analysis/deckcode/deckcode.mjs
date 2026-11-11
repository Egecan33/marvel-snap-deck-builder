#!/usr/bin/env node
// Marvel Snap deck code decode/encode, research proof for docs/research/data-sources.md section 4.
// No dependencies. Usage:
//   node deckcode.mjs --selftest [path/to/cards.json]
//   node deckcode.mjs decode '<code or pasted block>' [path/to/cards.json]
//   node deckcode.mjs encode-short|encode-long Id1,Id2,...(12 CardDefIds)
// cards.json = the Untapped dump (array of {defId, name, cost, ...}); default ../../raw/cards/cards.json.
//
// Algorithm sources (accessed 2026-11-12):
//  - snap.untapped.gg production JS: _app chunk (short-name function) and pages/deck-builder chunk
//    (import accepts both formats and "# (cost) Name" lines; export writes the long format).
//  - github.com/Mottelz/snapdeck (pushed 2026-11-07): scripts/convert-cards.js, src/core/*.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const B64_LINE = /^[A-Za-z0-9+/]+={0,2}$/;
const LIST_LINE = /^#\s*\(\s*\d+\s*\)\s*(.+?)\s*$/;

/** Short card code: CardDefId minus lowercase a,e,i,o,u,y, then the original length in upper-case hex. */
export function shortName(cardDefId) {
  return cardDefId.replace(/[aeiouy]/g, '') + cardDefId.length.toString(16).toUpperCase();
}

/** Short format: base64 of the 12 short card codes joined by commas. */
export function encodeShort(cardDefIds) {
  if (cardDefIds.length !== 12) throw new Error('A deck needs 12 cards');
  return Buffer.from(cardDefIds.map(shortName).join(','), 'utf8').toString('base64');
}

/** Long format: base64 of JSON {"Name": ..., "Cards": [{"CardDefId": ...} x12]}. Name is optional on decode. */
export function encodeLong(cardDefIds, name = '') {
  if (cardDefIds.length !== 12) throw new Error('A deck needs 12 cards');
  const obj = { Name: name, Cards: cardDefIds.map((CardDefId) => ({ CardDefId })) };
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

/** Lookup tables from a card list (array of {defId, name}). Needed for the short format and for name lists. */
export function buildIndex(cards) {
  const byShort = new Map();
  const byName = new Map();
  for (const c of cards) {
    const s = shortName(c.defId);
    if (byShort.has(s)) throw new Error(`short code collision: ${s} (${byShort.get(s)} / ${c.defId})`);
    byShort.set(s, c.defId);
    // several defIds can share a display name (mode-specific copies); prefer the collectible one
    if (c.name && (!byName.has(c.name.toLowerCase()) || c.collectible)) byName.set(c.name.toLowerCase(), c.defId);
  }
  return { byShort, byName };
}

/**
 * Decode whatever a player pastes: a bare code, or the full block with "# (cost) Name" lines.
 * Returns {format: 'long'|'short'|'list', name, cardDefIds}. Throws on unknown input.
 */
export function decode(text, index) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const code = lines.filter((l) => !l.startsWith('#') && l.length > 1).find((l) => B64_LINE.test(l));
  if (code) {
    const raw = Buffer.from(code, 'base64').toString('utf8');
    if (raw.trimStart().startsWith('{')) {
      const obj = JSON.parse(raw);
      return { format: 'long', name: obj.Name ?? '', cardDefIds: (obj.Cards ?? []).map((c) => c.CardDefId) };
    }
    if (!index) throw new Error('short format needs a card index');
    const ids = raw.split(',').map((s) => {
      const id = index.byShort.get(s.trim());
      if (!id) throw new Error(`unknown short card code: ${s}`);
      return id;
    });
    return { format: 'short', name: '', cardDefIds: ids };
  }
  // fallback: the plain list lines
  if (!index) throw new Error('no code line found');
  const ids = lines
    .map((l) => LIST_LINE.exec(l)?.[1])
    .filter(Boolean)
    .map((n) => {
      const id = index.byName.get(n.toLowerCase());
      if (!id) throw new Error(`unknown card name: ${n}`);
      return id;
    });
  if (!ids.length) throw new Error('no code and no list lines found');
  return { format: 'list', name: '', cardDefIds: ids };
}

/** The text block shown next to a code: "# (cost) Name" per card sorted by cost then name, "#", then the code. */
export function formatBlock(cardDefIds, cardsById, code) {
  const rows = cardDefIds
    .map((id) => cardsById.get(id))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
    .map((c) => `# (${c.cost}) ${c.name}`);
  // Sites and the game append their own trailing "# ..." comment line; it carries no data, so none is written here.
  return [...rows, '#', code].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Fixtures. All fetched 2026-11-12.
const REAL_LONG = [
  // Den of Geek article (published 2022-11-18), codes copied out of the game at that time; JSON has no Name key.
  // https://www.denofgeek.com/games/best-marvel-snap-decks-you-have-to-try/
  'eyJDYXJkcyI6W3siQ2FyZERlZklkIjoiSGF3a2V5ZSJ9LHsiQ2FyZERlZklkIjoiUm9ja2V0UmFjY29vbiJ9LHsiQ2FyZERlZklkIjoiTWVkdXNhIn0seyJDYXJkRGVmSWQiOiJJcm9uaGVhcnQifSx7IkNhcmREZWZJZCI6IldoaXRlVGlnZXIifSx7IkNhcmREZWZJZCI6Ik9kaW4ifSx7IkNhcmREZWZJZCI6IkVsZWt0cmEifSx7IkNhcmREZWZJZCI6IldvbGZzYmFuZSJ9LHsiQ2FyZERlZklkIjoiR2Ftb3JhIn0seyJDYXJkRGVmSWQiOiJOaWdodGNyYXdsZXIifSx7IkNhcmREZWZJZCI6IkVuY2hhbnRyZXNzIn0seyJDYXJkRGVmSWQiOiJKZXNzaWNhSm9uZXMifV19',
  'eyJDYXJkcyI6W3siQ2FyZERlZklkIjoiU3BlY3RydW0ifSx7IkNhcmREZWZJZCI6Ik5hbW9yIn0seyJDYXJkRGVmSWQiOiJBbnRNYW4ifSx7IkNhcmREZWZJZCI6IkFybW9yIn0seyJDYXJkRGVmSWQiOiJDYXB0YWluQW1lcmljYSJ9LHsiQ2FyZERlZklkIjoiTXJGYW50YXN0aWMifSx7IkNhcmREZWZJZCI6IkNvbG9zc3VzIn0seyJDYXJkRGVmSWQiOiJLYVphciJ9LHsiQ2FyZERlZklkIjoiTmlnaHRjcmF3bGVyIn0seyJDYXJkRGVmSWQiOiJNb3JwaCJ9LHsiQ2FyZERlZklkIjoiQmx1ZU1hcnZlbCJ9LHsiQ2FyZERlZklkIjoiU2NhcmxldFdpdGNoIn1dfQ==',
  'eyJDYXJkcyI6W3siQ2FyZERlZklkIjoiSXJvbkZpc3QifSx7IkNhcmREZWZJZCI6Ik5pZ2h0Y3Jhd2xlciJ9LHsiQ2FyZERlZklkIjoiS3JhdmVuIn0seyJDYXJkRGVmSWQiOiJEb2N0b3JTdHJhbmdlIn0seyJDYXJkRGVmSWQiOiJNdWx0aXBsZU1hbiJ9LHsiQ2FyZERlZklkIjoiQ2xvYWsifSx7IkNhcmREZWZJZCI6IlZ1bHR1cmUifSx7IkNhcmREZWZJZCI6IlZpc2lvbiJ9LHsiQ2FyZERlZklkIjoiSGVpbWRhbGwifSx7IkNhcmREZWZJZCI6IkZvcmdlIn0seyJDYXJkRGVmSWQiOiJIdWxrYnVzdGVyIn0seyJDYXJkRGVmSWQiOiJFYm9ueU1hdyJ9XX0=',
];
// github.com/Mottelz/snapdeck src/helpers/sample.ts: the same deck as a short and a long code.
const PAIR = {
  short: 'QXBjbHBzQSxCbGQ1LENsbG5XbmdCLENydnNHbHZDLERyY2w3LEdtYnQ2LEtobnNoNyxMZFNmNyxNZGs1LE1yYnM3LFByeG1NZG5naHRGLFNjcm41',
  long: 'eyJOYW1lIjoiRGlzY2FyZCIsIkNhcmRzIjpbeyJDYXJkRGVmSWQiOiJBcG9jYWx5cHNlIn0seyJDYXJkRGVmSWQiOiJCbGFkZSJ9LHsiQ2FyZERlZklkIjoiQ29sbGVlbldpbmcifSx7IkNhcmREZWZJZCI6IkNvcnZ1c0dsYWl2ZSJ9LHsiQ2FyZERlZklkIjoiRHJhY3VsYSJ9LHsiQ2FyZERlZklkIjoiR2FtYml0In0seyJDYXJkRGVmSWQiOiJLaG9uc2h1In0seyJDYXJkRGVmSWQiOiJMYWR5U2lmIn0seyJDYXJkRGVmSWQiOiJNb2RvayJ9LHsiQ2FyZERlZklkIjoiTW9yYml1cyJ9LHsiQ2FyZERlZklkIjoiUHJveGltYU1pZG5pZ2h0In0seyJDYXJkRGVmSWQiOiJTY29ybiJ9XX0=',
};
// Live meta decks (card lists, no code strings) from https://snap.untapped.gg/en/meta/decks __NEXT_DATA__.
const LIVE_DECKS = [
  ['High Evo', ['Sunspot', 'MistyKnight', 'Armor', 'Scorpion', 'Shocker', 'Cyclops', 'ShangChi', 'HighEvolutionary', 'TheThing', 'Enchantress', 'Abomination', 'Hulk']],
  ['Fantomex', ['Hood', 'Blade', 'WildChild', 'BuckyBarnes', 'Carnage', 'Marrow', 'Gambit', 'Killmonger', 'MobiusMMobius', 'ShadowKing', 'ZombieCaptainMarvel', 'Fantomex']],
  ['Thor', ['Wasp', 'Iceman', 'KingEitri', 'Surge', 'Lockjaw', 'Phastos', 'Thor', 'BetaRayBill', 'ThanosFracturedFrontier', 'JaneFoster', 'Gorr', 'Odin']],
  ['Arthur', ['Moondragon', 'LukeCage', 'AstralProjection', 'DraxAvatarOfLife', 'InvisibleWomanFirstSteps', 'CalibanHorseman', 'ArthurPendragon', 'CaptainMarvel', 'Doom2099', 'IronLad', 'DrDoom', 'AntiPolarMagneto']],
];

function loadCards(path) {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path ?? resolve(here, '../../raw/cards/cards.json'), 'utf8'));
}

function selftest(cardsPath) {
  const cards = loadCards(cardsPath);
  const index = buildIndex(cards); // throws on any short-code collision
  const byId = new Map(cards.map((c) => [c.defId, c]));
  let pass = 0;
  const ok = (cond, label) => {
    if (!cond) throw new Error(`FAIL: ${label}`);
    pass++;
    console.log(`ok  ${label}`);
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  console.log(`cards in index: ${cards.length}, short codes unique: ${index.byShort.size === cards.length}`);

  REAL_LONG.forEach((code, i) => {
    const d = decode(code, index);
    ok(d.format === 'long' && d.cardDefIds.length === 12 && d.cardDefIds.every((id) => byId.has(id)), `real long code ${i + 1} decodes to 12 known cards (${d.cardDefIds.slice(0, 3).join(', ')}, ...)`);
    ok(same(decode(encodeLong(d.cardDefIds, d.name), index).cardDefIds, d.cardDefIds), `real long code ${i + 1} long round trip`);
    ok(same(decode(encodeShort(d.cardDefIds), index).cardDefIds, d.cardDefIds), `real long code ${i + 1} re-encoded short round trip`);
  });

  const s = decode(PAIR.short, index);
  const l = decode(PAIR.long, index);
  ok(s.format === 'short' && l.format === 'long' && same(s.cardDefIds, l.cardDefIds), 'short and long sample decode to the same 12 cards');
  ok(encodeShort(l.cardDefIds) === PAIR.short, 'encodeShort reproduces the short sample byte for byte');
  ok(encodeLong(l.cardDefIds, l.name) === PAIR.long, 'encodeLong reproduces the long sample byte for byte');

  for (const [name, ids] of LIVE_DECKS) {
    ok(ids.every((id) => byId.has(id)), `live deck ${name}: all 12 ids in card dump`);
    ok(same(decode(encodeShort(ids), index).cardDefIds, ids) && same(decode(encodeLong(ids, name), index).cardDefIds, ids), `live deck ${name}: short and long round trip`);
    const block = formatBlock(ids, byId, encodeShort(ids));
    ok(same(decode(block, index).cardDefIds, ids), `live deck ${name}: full text block decodes`);
    const listOnly = block.split('\n').filter((x) => LIST_LINE.test(x)).join('\n');
    ok(same([...decode(listOnly, index).cardDefIds].sort(), [...ids].sort()), `live deck ${name}: "# (cost) Name" lines alone decode`);
  }
  console.log(`\n${pass} checks passed`);
  console.log('\nExample block:\n' + formatBlock(LIVE_DECKS[0][1], byId, encodeShort(LIVE_DECKS[0][1])));
}

const [cmd, arg, cardsPath] = process.argv.slice(2);
if (cmd === '--selftest') selftest(arg);
else if (cmd === 'decode') console.log(JSON.stringify(decode(arg, buildIndex(loadCards(cardsPath))), null, 2));
else if (cmd === 'encode-short') console.log(encodeShort(arg.split(',')));
else if (cmd === 'encode-long') console.log(encodeLong(arg.split(',')));
else if (cmd) console.error('usage: node deckcode.mjs --selftest [cards.json] | decode <text> [cards.json] | encode-short <ids> | encode-long <ids>');
