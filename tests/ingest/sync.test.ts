import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFromUrl, syncCards } from '@/ingest/cards';
import { USER_AGENT } from '@/ingest/http';
import { imageTargets, syncImages } from '@/ingest/images';
import { syncMeta } from '@/ingest/meta';
import { buildCardDb, loadMetaIndex } from '@/server/carddb';
import { openDb, readSyncState } from '@/server/db';
import { fixtureDb, fixtureNow, fixtureRows } from '../helpers/fixture-db';

const NOW = fixtureNow();
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 ')]);
const tmp = mkdtempSync(path.join(tmpdir(), 'snapforge-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Seen { url: string; headers: Record<string, string>; cookie: boolean }

/** A fetch stand-in that serves canned bodies by URL substring and records what was asked. */
function fakeFetch(routes: [string, () => Response][], seen: Seen[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, headers, cookie: Object.keys(headers).some((h) => h.toLowerCase() === 'cookie') });
    const route = routes.find(([part]) => url.includes(part));
    return route ? route[1]() : new Response('not found', { status: 404 });
  }) as typeof fetch;
}
const json = (body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status: 200, headers });

describe('cards step', () => {
  it('reads the build from the redirected URL', () => {
    expect(buildFromUrl('https://snapjson.untapped.gg/v2/58.15.3/en/cards.json')).toBe('58.15.3');
    expect(buildFromUrl('https://snapjson.untapped.gg/v2/latest/en/cards.json')).toBeNull();
  });

  it('stores every row and loads the same pool as the fixture', async () => {
    const db = openDb(':memory:');
    const seen: Seen[] = [];
    const lines: string[] = [];
    await syncCards(db, (l) => lines.push(l), { now: NOW, http: { gapMs: 0, fetchImpl: fakeFetch([['cards.json', json(fixtureRows())]], seen) } });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['User-Agent']).toBe(USER_AGENT);
    expect(seen[0].cookie).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(fixtureRows().length);
    expect(readSyncState(db, 'cards')?.info.released).toBe(fixtureDb().released().length);
    const loaded = buildCardDb(db, NOW);
    expect(loaded.released().map((c) => c.defId)).toEqual(fixtureDb().released().map((c) => c.defId));
    expect(loaded.get('JaneFoster')?.text).toBe(fixtureDb().get('JaneFoster')?.text);
    expect(loaded.meta().info()).toBeNull();
    expect(loaded.formats().length).toBeGreaterThan(0);
    db.close();
  });

  it('keeps the stored cards when the file looks wrong', async () => {
    const db = openDb(':memory:');
    const http = (body: unknown) => ({ gapMs: 0, fetchImpl: fakeFetch([['cards.json', json(body)]]) });
    await syncCards(db, () => undefined, { now: NOW, http: http(fixtureRows()) });
    await expect(syncCards(db, () => undefined, { now: NOW, http: http(fixtureRows().slice(0, 30)) })).rejects.toThrow(/looks wrong/);
    await expect(syncCards(db, () => undefined, { now: NOW, http: http({ error: true }) })).rejects.toThrow(/not an array/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(fixtureRows().length);
    db.close();
  });
});

describe('images step', () => {
  it('targets released and upcoming cards and their tokens, never mode copies', () => {
    const ids = imageTargets(fixtureRows(), NOW);
    expect(ids).toContain('Hulk');
    expect(ids).toContain('Squirrel');
    expect(ids).not.toContain('ElektraTutorial');
    expect(ids.slice(0, fixtureDb().released().length).sort()).toEqual(fixtureDb().released().map((c) => c.defId).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('downloads with --limit, resumes, and treats 404 as no art yet', async () => {
    const db = openDb(':memory:');
    await syncCards(db, () => undefined, { now: NOW, http: { gapMs: 0, fetchImpl: fakeFetch([['cards.json', json(fixtureRows())]]) } });
    const targets = imageTargets(fixtureRows(), NOW).slice(0, 5);
    const seen: Seen[] = [];
    const fetchImpl = fakeFetch(
      [
        [`/${targets[1]}.webp`, () => new Response('nope', { status: 404 })],
        [`/${targets[2]}.webp`, () => new Response('<html>blocked</html>', { status: 200 })],
        ['.webp', () => new Response(WEBP, { status: 200 })],
      ],
      seen,
    );
    const first = await syncImages(db, () => undefined, { limit: 5, dir: tmp, now: NOW, http: { gapMs: 0, fetchImpl } });
    expect(first.downloaded).toBe(3);
    expect(first.noArt).toEqual([targets[1]]);
    expect(first.failures).toHaveLength(1);
    expect(first.failures[0]).toContain(targets[2]);
    expect(readdirSync(tmp).sort()).toEqual([targets[0], targets[3], targets[4]].map((id) => `${id}.webp`).sort());
    expect(seen.every((s) => s.url.startsWith('https://snapjson.untapped.gg/art/render/framebreak/common/512/'))).toBe(true);

    const again = await syncImages(db, () => undefined, { limit: 5, dir: tmp, now: NOW, http: { gapMs: 0, fetchImpl } });
    expect(again.skipped).toBe(3);
    expect(again.downloaded).toBe(0);
    expect(again.onDisk).toBe(3);
    db.close();
  });
});

describe('meta step', () => {
  const lists = fixtureDb().meta().lists().slice(0, 40);
  const dMap = [...new Set(lists.flatMap((l) => l.cards))].reverse();
  const decks = {
    data: lists.map((l) => ({ d: l.cards.map((c) => dMap.indexOf(c)), 'POOL3 (24000+)': { arch_id: l.archetypeId, alt_arch_id: null, Infinite: [l.games, l.wins, -9.9] } })),
    metadata: { d_map: dMap },
  };
  const games = lists.reduce((s, l) => s + l.games, 0);
  const archIds = [...new Set(lists.map((l) => l.archetypeId).filter((id): id is number => id !== null))];
  const routes = (decksBody: unknown = decks): [string, () => Response][] => [
    ['filter-manifest', json({ current_meta_period: { id: 137, start_ts: '2026-11-03T20:01:54Z', description: 'Nov 3', data_volume: { min: { num_games: games, num_decks: lists.length } } } })],
    ['current_season', json({ current_season: 'November2026' })],
    ['archetypes_manifest_v3', json({ data: Object.fromEntries(archIds.map((id) => [id, { arch_name: `Arch ${id}`, card_popularity: { Hulk: 50 } }])) })],
    ['decks_stats_by_pool_v4/free?TimestampRangeFilter=CURRENT_META_PERIOD', json(decksBody, { etag: '"v1"' })],
    ['decks_stats_by_pool_v4/free?TimestampRangeFilter=EXACTLY_LAST_30_DAYS', json(decks)],
    ['archetypes_by_pool_v4', json({ data: Object.fromEntries(archIds.map((id) => [id, { POOL3: { Infinite: [1000, 550, -9] } }])) })],
    ['card_stats_by_pool_v2', json({ data: { Hulk: { POOL3: { Gold: { num_matches: 100, winrate: 60 }, Iron: { num_matches: 100, winrate: 40 } } } }, metadata: {} })],
  ];

  it('stores a snapshot the index can be loaded from, plus a 30-day one while the period is thin', async () => {
    const db = openDb(':memory:');
    const seen: Seen[] = [];
    const log: string[] = [];
    await syncMeta(db, (l) => log.push(l), { now: NOW, http: { gapMs: 0, fetchImpl: fakeFetch(routes(), seen) } });
    expect(seen.every((s) => s.url.startsWith('https://api.snap.untapped.gg/api/v1/') && s.headers['User-Agent'] === USER_AGENT && !s.cookie)).toBe(true);
    expect(seen.length).toBeLessThanOrEqual(12);
    expect(seen.filter((s) => s.url.includes('EXACTLY_LAST_30_DAYS'))).toHaveLength(3);
    expect((db.prepare('SELECT COUNT(*) AS n FROM meta_snapshots').get() as { n: number }).n).toBe(2);

    const index = loadMetaIndex(db);
    const info = index.info()!;
    expect(info.lists).toBe(40);
    expect(info.games).toBe(games);
    expect(info.periodLabel).toMatch(/30 days/);          // thin current period: the wide snapshot is read
    expect(index.lists().map((l) => l.key)).toEqual([...lists].sort((a, b) => b.games - a.games || (a.key < b.key ? -1 : 1)).map((l) => l.key));
    expect(index.archetypes().length).toBe(archIds.length);
    expect(index.archetypes()[0].name).toMatch(/^Arch \d+$/);
    const low = db.prepare("SELECT low_rank_matches AS m, low_rank_win_rate AS w FROM meta_card_stats WHERE def_id = 'Hulk' LIMIT 1").get() as { m: number; w: number };
    expect(low).toEqual({ m: 200, w: 0.5 });
    expect(readSyncState(db, 'meta')?.info.lists).toBe(40);

    // A second run inside six hours does not touch the network.
    const before = seen.length;
    await syncMeta(db, (l) => log.push(l), { now: NOW + 3600_000, http: { gapMs: 0, fetchImpl: fakeFetch(routes(), seen) } });
    expect(seen.length).toBe(before);
    expect(log.at(-1)).toMatch(/skipped/);

    // A forced run sends the stored ETag for the current-period lists.
    await syncMeta(db, () => undefined, { now: NOW + 7200_000, force: true, http: { gapMs: 0, fetchImpl: fakeFetch(routes(), seen) } });
    expect(seen.slice(before).find((s) => s.url.includes('decks_stats') && s.url.includes('CURRENT_META_PERIOD'))?.headers['If-None-Match']).toBe('"v1"');
    expect((db.prepare('SELECT COUNT(*) AS n FROM meta_snapshots').get() as { n: number }).n).toBe(2);
    db.close();
  });

  it('keeps the stored snapshot when the response is invalid', async () => {
    const db = openDb(':memory:');
    await syncMeta(db, () => undefined, { now: NOW, http: { gapMs: 0, fetchImpl: fakeFetch(routes()) } });
    const broken = { data: decks.data.map((r, i) => (i % 2 ? r : { ...r, d: r.d.slice(0, 11) })), metadata: decks.metadata };
    await expect(syncMeta(db, () => undefined, { now: NOW + 1, force: true, http: { gapMs: 0, fetchImpl: fakeFetch(routes(broken)) } })).rejects.toThrow(/invalid|manifest/);
    const failing: [string, () => Response][] = [['decks_stats', () => new Response('', { status: 202 })], ...routes()];
    await expect(syncMeta(db, () => undefined, { now: NOW + 2, force: true, http: { gapMs: 0, fetchImpl: fakeFetch(failing) } })).rejects.toThrow(/HTTP 202/);
    expect(loadMetaIndex(db).info()?.lists).toBe(40);
    db.close();
  });
});
