#!/usr/bin/env node
// Analysis of the sample written by fetch-sample.mjs. Prints the numbers quoted in
// docs/research/meta-sources.md and writes two derived tables next to the raw files.
//
//   node docs/research/analysis/meta/analyze-sample.mjs [TIMEFRAME]
//
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'raw', 'meta', 'untapped');
const TF = process.argv[2] ?? 'CURRENT_META_PERIOD';
const load = (name) => JSON.parse(readFileSync(join(RAW, name), 'utf8'));
const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
const RANK_ORDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Vibranium', 'Omega', 'Galactic', 'Infinite'];

const raw = load(`decks_stats_by_pool_v4.${TF}.json`);
const dMap = raw.metadata.d_map;
const archManifest = load('archetypes_manifest_v3.json').data;
const cardsV2 = load('cards_v2.json');
const now = Date.now();
const released = cardsV2.filter(
  (c) => c.collectible && (c.seriesStartTimestamps ?? []).some((t) => t <= now),
);

// ---- normalise decks -------------------------------------------------------
const decks = raw.data.map((row) => {
  const cards = row.d.map((i) => dMap[i]);
  let games = 0;
  let wins = 0;
  const byRank = {};
  const archVotes = {};
  const altVotes = {};
  for (const [bucket, v] of Object.entries(row)) {
    if (bucket === 'd') continue;
    let bucketGames = 0;
    for (const [rank, t] of Object.entries(v)) {
      if (rank === 'arch_id' || rank === 'alt_arch_id') continue;
      games += t[0];
      wins += t[1];
      bucketGames += t[0];
      byRank[rank] = (byRank[rank] ?? 0) + t[0];
    }
    if (v.arch_id != null) archVotes[v.arch_id] = (archVotes[v.arch_id] ?? 0) + bucketGames;
    if (v.alt_arch_id != null) altVotes[v.alt_arch_id] = (altVotes[v.alt_arch_id] ?? 0) + bucketGames;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { cards, key: [...cards].sort().join('|'), games, wins, byRank, arch: top(archVotes), altArch: top(altVotes), buckets: Object.keys(row).filter((k) => k !== 'd') };
});

const N = decks.length;
const G = decks.reduce((s, d) => s + d.games, 0);
const W = decks.reduce((s, d) => s + d.wins, 0);
console.log(`# timeframe ${TF}`);
console.log(`rows ${N}; distinct card sets ${new Set(decks.map((d) => d.key)).size}; d_map size ${dMap.length}`);
console.log(`deck sizes: ${JSON.stringify([...new Set(decks.map((d) => new Set(d.cards).size))])}`);
console.log(`games ${G}; wins ${W}; pooled win rate ${pct(W / G)}`);
const gs = decks.map((d) => d.games).sort((a, b) => a - b);
const q = (p) => gs[Math.min(gs.length - 1, Math.floor(p * gs.length))];
console.log(`games per list: min ${gs[0]} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} p99 ${q(0.99)} max ${gs[gs.length - 1]}`);
const rankGames = {};
for (const d of decks) for (const [r, g] of Object.entries(d.byRank)) rankGames[r] = (rankGames[r] ?? 0) + g;
console.log('games by rank: ' + RANK_ORDER.filter((r) => rankGames[r]).map((r) => `${r} ${pct(rankGames[r] / G)}`).join(', '));
const bucketCount = {};
for (const d of decks) for (const b of d.buckets) bucketCount[b] = (bucketCount[b] ?? 0) + 1;
console.log('collection buckets (lists present in each): ' + JSON.stringify(bucketCount));
for (const t of [20, 50, 100, 200]) console.log(`lists with >= ${t} games: ${decks.filter((d) => d.games >= t).length}`);

// ---- per-card play rate ----------------------------------------------------
const card = {};
for (const d of decks) {
  for (const c of d.cards) {
    const e = (card[c] ??= { lists: 0, games: 0, wins: 0 });
    e.lists += 1;
    e.games += d.games;
    e.wins += d.wins;
  }
}
const cardRows = Object.entries(card).map(([id, e]) => ({ id, ...e, listShare: e.lists / N, gameShare: e.games / G, winRate: e.wins / e.games }));
cardRows.sort((a, b) => b.listShare - a.listShare);
console.log('\n## top 30 cards by share of lists (share of games, win rate of lists containing it)');
cardRows.slice(0, 30).forEach((r, i) => console.log(`${i + 1}. ${r.id} ${pct(r.listShare)} (${pct(r.gameShare)}, ${pct(r.winRate)})`));

const releasedDef = released.map((c) => c.defId);
const under1 = releasedDef.filter((id) => (card[id]?.lists ?? 0) / N < 0.01);
const zero = releasedDef.filter((id) => !card[id]);
const under1Games = releasedDef.filter((id) => (card[id]?.games ?? 0) / G < 0.01);
console.log(`\nreleased collectible cards (cards_v2, series start <= today): ${releasedDef.length}; zero-list cards: ${zero.join(',')}`);
console.log(`in < 1% of lists: ${under1.length} (${pct(under1.length / releasedDef.length)}); in zero lists: ${zero.length}; in < 1% of games: ${under1Games.length}`);
for (const t of [0.02, 0.05, 0.1]) console.log(`in >= ${pct(t, 0)} of lists: ${releasedDef.filter((id) => (card[id]?.lists ?? 0) / N >= t).length}`);
const sortedShare = cardRows.map((r) => r.lists).sort((a, b) => b - a);
const slots = N * 12;
let acc = 0;
let k50 = 0;
let k80 = 0;
sortedShare.forEach((v, i) => {
  acc += v;
  if (!k50 && acc >= 0.5 * slots) k50 = i + 1;
  if (!k80 && acc >= 0.8 * slots) k80 = i + 1;
});
console.log(`deck slots: 50% are filled by the top ${k50} cards, 80% by the top ${k80}`);

// ---- pair lift ---------------------------------------------------------------
const MIN_SUPPORT = Math.max(30, Math.ceil(0.01 * N));
const pair = new Map();
for (const d of decks) {
  const cs = [...d.cards].sort();
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const k = cs[i] + '+' + cs[j];
    pair.set(k, (pair.get(k) ?? 0) + 1);
  }
}
const pairRows = [];
for (const [k, n] of pair) {
  if (n < MIN_SUPPORT) continue;
  const [a, b] = k.split('+');
  pairRows.push({ a, b, n, lift: n / N / ((card[a].lists / N) * (card[b].lists / N)), conf: n / Math.min(card[a].lists, card[b].lists) });
}
pairRows.sort((x, y) => y.lift - x.lift);
console.log(`\n## pairs: ${pair.size} distinct pairs seen of ${(dMap.length * (dMap.length - 1)) / 2} possible; ${pairRows.length} with support >= ${MIN_SUPPORT} lists`);
console.log(`pairs with lift >= 2: ${pairRows.filter((p) => p.lift >= 2).length}; lift >= 5: ${pairRows.filter((p) => p.lift >= 5).length}; lift < 0.5: ${pairRows.filter((p) => p.lift < 0.5).length}`);
console.log('top 30 by lift (lists together, lift, share of the rarer card\'s lists):');
pairRows.slice(0, 30).forEach((p, i) => console.log(`${i + 1}. ${p.a} + ${p.b}  n=${p.n} lift=${p.lift.toFixed(1)} conf=${pct(p.conf, 0)}`));

// ---- archetype concentration --------------------------------------------------
const arch = {};
for (const d of decks) {
  const id = d.arch ?? 'unlabelled';
  const e = (arch[id] ??= { lists: 0, games: 0, wins: 0 });
  e.lists += 1;
  e.games += d.games;
  e.wins += d.wins;
}
const archRows = Object.entries(arch).map(([id, e]) => ({ id, name: id === 'unlabelled' ? '(no arch_id)' : archManifest[id]?.arch_name ?? `#${id}`, ...e }));
const labelled = archRows.filter((r) => r.id !== 'unlabelled').sort((a, b) => b.games - a.games);
const un = arch.unlabelled ?? { lists: 0, games: 0 };
const top10 = labelled.slice(0, 10);
const byLists = [...labelled].sort((a, b) => b.lists - a.lists).slice(0, 10);
console.log(`\n## archetypes: ${labelled.length} labelled archetypes present (manifest has ${Object.keys(archManifest).length}, ${Object.values(archManifest).filter((a) => a.active).length} active)`);
console.log(`unlabelled: ${pct(un.lists / N)} of lists, ${pct(un.games / G)} of games; of those, with alt_arch_id: ${decks.filter((d) => !d.arch && d.altArch).length} lists`);
console.log(`top 10 archetypes by games cover ${pct(top10.reduce((s, r) => s + r.games, 0) / G)} of games and ${pct(top10.reduce((s, r) => s + r.lists, 0) / N)} of lists`);
console.log(`top 10 archetypes by lists cover ${pct(byLists.reduce((s, r) => s + r.lists, 0) / N)} of lists`);
top10.forEach((r, i) => console.log(`${i + 1}. ${r.name} (#${r.id}) games ${pct(r.games / G)} lists ${pct(r.lists / N)} wr ${pct(r.wins / r.games)}`));

// ---- how far apart are known lists (sizes the novelty scale) ------------------
const sets = raw.data.map((r) => r.d);
const nearest = new Array(N).fill(0);
for (let i = 0; i < N; i++) {
  const a = sets[i];
  for (let j = i + 1; j < N; j++) {
    const b = sets[j];
    let p = 0;
    let s = 0;
    let o = 0;
    while (p < 12 && s < 12) {
      if (a[p] === b[s]) { o++; p++; s++; } else if (a[p] < b[s]) p++; else s++;
    }
    if (o > nearest[i]) nearest[i] = o;
    if (o > nearest[j]) nearest[j] = o;
  }
}
const hist = {};
for (const o of nearest) hist[12 - o] = (hist[12 - o] ?? 0) + 1;
console.log('\n## cards different from the nearest other list (count of lists): ' + JSON.stringify(hist));

// ---- per-card stats table from the card_stats endpoint -------------------------
const csFile = `card_stats_by_pool_v2.${TF}.json`;
if (existsSync(join(RAW, csFile))) {
  const cs = load(csFile);
  const totals = cs.metadata.matches.POOL3;
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const rows = Object.entries(cs.data).map(([id, v]) => {
    let m = 0;
    let w = 0;
    for (const s of Object.values(v.POOL3 ?? {})) { m += s.num_matches; w += (s.num_matches * s.winrate) / 100; }
    return { id, matches: m, playRate: m / total, winRate: m ? w / m : null };
  }).sort((a, b) => b.matches - a.matches);
  const base = rows.reduce((s, r) => s + r.matches * (r.winRate ?? 0), 0) / rows.reduce((s, r) => s + r.matches, 0);
  console.log(`\n## card_stats endpoint: ${rows.length} cards; ranks ${Object.keys(totals).join(',')}; matches ${total}; match-weighted mean card win rate ${pct(base)}`);
  console.log('top 10: ' + rows.slice(0, 10).map((r) => `${r.id} ${pct(r.playRate)} wr ${pct(r.winRate)}`).join('; '));
  console.log(`cards with < 100 matches: ${rows.filter((r) => r.matches < 100).length}; < 1% play rate: ${rows.filter((r) => r.playRate < 0.01).length}; not in any list of the decks endpoint: ${rows.filter((r) => !card[r.id]).length}`);
  const a = rows.filter((r) => card[r.id]);
  const rank = (arr, f) => { const s = [...arr].sort((x, y) => f(y) - f(x)); return new Map(s.map((r, i) => [r.id, i])); };
  const r1 = rank(a, (r) => r.playRate);
  const r2 = rank(a, (r) => card[r.id].games);
  const n = a.length;
  const d2 = a.reduce((s, r) => s + (r1.get(r.id) - r2.get(r.id)) ** 2, 0);
  console.log(`Spearman(card_stats play rate, decks-endpoint game share) = ${(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3)} over ${n} cards`);
  writeFileSync(join(RAW, `_derived.card-stats.${TF}.csv`), 'card,matches,play_rate,win_rate,lists,list_share,game_share\n' + rows.map((r) => [r.id, r.matches, r.playRate.toFixed(5), r.winRate?.toFixed(4) ?? '', card[r.id]?.lists ?? 0, ((card[r.id]?.lists ?? 0) / N).toFixed(5), ((card[r.id]?.games ?? 0) / G).toFixed(5)].join(',')).join('\n') + '\n');
}
writeFileSync(join(RAW, `_derived.pairs.${TF}.csv`), 'a,b,lists,lift\n' + pairRows.map((p) => [p.a, p.b, p.n, p.lift.toFixed(3)].join(',')).join('\n') + '\n');
