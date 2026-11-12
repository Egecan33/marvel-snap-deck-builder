import { describe, expect, it } from 'vitest';
import { clusterLists, createMetaIndex } from '@/engine/carddb';
import type { MetaArchetype, MetaInfo, MetaList } from '@/engine/types';
import { buildArchetypes, buildSnapshot, decodeDecks, type DecksResponse } from '@/ingest/meta';

// 14 card ids; the response's own d_map order is deliberately not alphabetical.
const D_MAP = ['Zabu', 'Angela', 'Blade', 'Carnage', 'Deadpool', 'Elektra', 'Falcon', 'Gambit', 'Hulk', 'IronMan', 'Jubilee', 'Kazar', 'Lizard', 'Medusa'];
const idx = (...names: string[]) => names.map((n) => D_MAP.indexOf(n));
const A = ['Angela', 'Blade', 'Carnage', 'Deadpool', 'Elektra', 'Falcon', 'Gambit', 'Hulk', 'IronMan', 'Jubilee', 'Kazar', 'Lizard'];
const B = [...A.slice(0, 11), 'Medusa'];               // shares 11 with A
const C = ['Zabu', 'Medusa', ...A.slice(0, 10)];       // shares 10 with A, 11 with B

const RESPONSE: DecksResponse = {
  data: [
    {
      d: idx(...A),
      'POOL3 (8000-16000)': { arch_id: 892, alt_arch_id: null, Omega: [26, 18, -9.8], Vibranium: [7, 2, -9.9] },
      POOL2: { arch_id: 145, alt_arch_id: null, Vibranium: [3, 1, -10] },
    },
    { d: idx(...B), 'POOL3 (24000+)': { arch_id: null, alt_arch_id: 244, Infinite: [300, 150, -9.9], null: [10, 4, -9] } },
    { d: idx(...C), 'POOL3 (24000+)': { arch_id: 892, alt_arch_id: null, Galactic: [40, 30, -9.9] } },
    { d: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], POOL1: { arch_id: null, alt_arch_id: null, Iron: [50, 25, -9] } },   // duplicate index
    { d: idx(...A.slice(0, 11)), POOL1: { arch_id: null, alt_arch_id: null, Iron: [50, 25, -9] } },                    // 11 cards
    { d: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99], POOL1: { arch_id: null, alt_arch_id: null, Iron: [50, 25, -9] } },   // outside d_map
  ],
  metadata: { d_map: D_MAP },
};

describe('decodeDecks', () => {
  const out = decodeDecks(RESPONSE);

  it('decodes rows through the response d_map', () => {
    expect(out.lists).toHaveLength(3);
    expect(out.lists[0].cards).toEqual([...A].sort());
    expect(out.lists[0].key).toBe([...A].sort().join('|'));
    expect(out.lists[2].cards).toContain('Zabu');
  });

  it('decodes with whatever d_map the response carries, not a stored one', () => {
    const shifted: DecksResponse = { data: [{ d: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], POOL1: { arch_id: null, alt_arch_id: null, Iron: [20, 10, 0] } }], metadata: { d_map: A } };
    expect(decodeDecks(shifted).lists[0].cards).toEqual([...A].sort());
  });

  it('sums games and wins over buckets and ranks', () => {
    expect(out.lists[0].games).toBe(36);
    expect(out.lists[0].wins).toBe(21);
    expect(out.lists[1].games).toBe(310);
    expect(out.lists[1].wins).toBe(154);
  });

  it('takes the archetype of the bucket with the most games and keeps the candidate separately', () => {
    expect(out.lists[0].archetypeId).toBe(892);
    expect(out.lists[1].archetypeId).toBeNull();
    expect(out.lists[1].altArchetypeId).toBe(244);
  });

  it('rejects rows with a duplicate index, a wrong size or an index outside d_map', () => {
    expect(out.rejected).toHaveLength(3);
    expect(out.rejected.map((r) => r.row)).toEqual([3, 4, 5]);
    expect(out.rejected[0].reason).toMatch(/duplicate/);
    expect(out.rejected[1].reason).toMatch(/12/);
    expect(out.rejected[2].reason).toMatch(/d_map/);
  });

  it('survives a malformed response', () => {
    expect(decodeDecks({} as DecksResponse)).toEqual({ lists: [], rejected: [] });
    expect(decodeDecks({ data: [{ d: null }], metadata: { d_map: [] } } as unknown as DecksResponse).rejected).toHaveLength(1);
  });
});

describe('clusterLists', () => {
  it('puts lists that share 11 cards in one cluster, transitively', () => {
    const D = ['Zabu', 'Medusa', 'Angela', 'Blade', 'Carnage', 'Deadpool', 'Elektra', 'Falcon', 'Gambit', 'X1', 'X2', 'X3'];
    expect(clusterLists([{ cards: A }, { cards: B }])).toEqual([0, 0]);
    expect(clusterLists([{ cards: A }, { cards: D }, { cards: B }, { cards: C }])).toEqual([0, 1, 0, 0]);
  });

  it('keeps lists sharing 10 cards apart and handles the empty case', () => {
    expect(clusterLists([{ cards: A }, { cards: C }])).toEqual([0, 1]);
    expect(clusterLists([])).toEqual([]);
  });

  it('does not depend on card order inside a list', () => {
    expect(clusterLists([{ cards: [...A].reverse() }, { cards: B }])).toEqual([0, 0]);
  });
});

describe('buildSnapshot and createMetaIndex', () => {
  const decoded = decodeDecks(RESPONSE).lists;
  // A fourth, well-played list far from the others so thresholds can be tested.
  const far = { key: '', cards: ['Zabu', 'Medusa', 'Hulk', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].sort(), archetypeId: 7, altArchetypeId: null, games: 1000, wins: 400 };
  far.key = far.cards.join('|');
  const snap = buildSnapshot([...decoded, far], {
    source: 'untapped:CURRENT_META_PERIOD', periodId: 137, periodLabel: 'Nov 3', periodStart: '2026-11-03T20:01:54Z', fetchedAt: '2026-11-12T00:00:00Z',
  });
  const archetypes: MetaArchetype[] = buildArchetypes(
    snap.lists,
    { 892: { arch_name: 'Arthur', card_popularity: { Angela: 100, Blade: 90, Zabu: 12 } }, 7: { arch_name: 'Far' } },
    { 892: { POOL3: { Omega: [100, 60, -9] }, POOL1: { Iron: [20, 10, -9] } }, 7: { POOL3: { Infinite: [1080, 400, -9] } } },
  );
  const index = createMetaIndex(snap.info, snap.lists, archetypes);

  it('builds snapshot info with clusters and the pooled baseline', () => {
    const info: MetaInfo = snap.info;
    expect(info.lists).toBe(4);
    expect(info.clusters).toBe(2);
    expect(info.games).toBe(36 + 310 + 40 + 1000);
    expect(info.baselineWinRate).toBeCloseTo((21 + 154 + 30 + 400) / 1386, 10);
    expect(info.minGamesPerList).toBe(36);
    expect(info.periodId).toBe(137);
  });

  it('orders lists by games and assigns cluster ids', () => {
    const lists: readonly MetaList[] = index.lists();
    expect(lists.map((l) => l.games)).toEqual([1000, 310, 40, 36]);
    expect(lists[1].cluster).toBe(lists[2].cluster);
    expect(lists[1].cluster).toBe(lists[3].cluster);
    expect(lists[0].cluster).not.toBe(lists[1].cluster);
  });

  it('answers listsWith and cardStat', () => {
    expect(index.listsWith('Zabu')).toEqual([0, 2]);
    expect(index.listsWith('Nope')).toEqual([]);
    const hulk = index.cardStat('Hulk')!;
    expect(hulk.lists).toBe(4);
    expect(hulk.listShare).toBe(1);
    expect(hulk.clusterShare).toBe(1);
    expect(hulk.games).toBe(1386);
    const zabu = index.cardStat('Zabu')!;
    expect(zabu.lists).toBe(2);
    expect(zabu.listShare).toBe(0.5);
    expect(zabu.clusterShare).toBe(1);
    expect(index.cardStat('Lizard')!.clusterShare).toBe(0.5);
    expect(index.cardStat('Nope')).toBeUndefined();
  });

  it('gives winDelta against the snapshot baseline, null under 200 games', () => {
    const base = snap.info.baselineWinRate;
    expect(index.cardStat('Zabu')!.winDelta).toBeCloseTo((400 + 30) / 1040 - base, 10);
    expect(index.cardStat('Hulk')!.winDelta).toBeCloseTo(0, 10);
    expect(index.cardStat('Lizard')!.games).toBe(36);
    expect(index.cardStat('Lizard')!.winDelta).toBeNull();
  });

  it('counts pairs by lists and by clusters, zeros when unseen', () => {
    expect(index.pair('Angela', 'Blade')).toEqual({ lists: 3, clusters: 1 });
    expect(index.pair('Blade', 'Angela')).toEqual({ lists: 3, clusters: 1 });
    expect(index.pair('Zabu', 'Medusa')).toEqual({ lists: 2, clusters: 2 });
    expect(index.pair('Lizard', 'Q1')).toEqual({ lists: 0, clusters: 0 });
    expect(index.pair('Nope', 'Hulk')).toEqual({ lists: 0, clusters: 0 });
    expect(index.pair('Hulk', 'Hulk')).toEqual({ lists: 0, clusters: 0 });
  });

  it('builds archetypes from the manifest, the stats query and the lists', () => {
    const arthur = index.archetypes().find((a) => a.id === 892)!;
    expect(arthur.name).toBe('Arthur');
    expect(arthur.games).toBe(120);
    expect(arthur.wins).toBe(70);
    expect(arthur.share).toBeCloseTo(120 / 1200, 10);
    expect(arthur.topCards.slice(0, 2)).toEqual(['Angela', 'Blade']);
    expect(arthur.sample).toEqual(snap.lists.find((l) => l.archetypeId === 892)!.cards);
    expect(arthur.planId).toBeNull();
    expect(index.archetypes()[0].id).toBe(7);
  });

  it('an empty index is safe', () => {
    const empty = createMetaIndex(null, [], []);
    expect(empty.info()).toBeNull();
    expect(empty.lists()).toEqual([]);
    expect(empty.listsWith('Hulk')).toEqual([]);
    expect(empty.cardStat('Hulk')).toBeUndefined();
    expect(empty.pair('A', 'B')).toEqual({ lists: 0, clusters: 0 });
    expect(empty.archetypes()).toEqual([]);
  });
});
