import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as buildRoute from '@/app/api/build/route';
import * as cardRoute from '@/app/api/card/[id]/route';
import * as cardsRoute from '@/app/api/cards/route';
import * as collectionRoute from '@/app/api/collection/route';
import * as deckRoute from '@/app/api/decks/[id]/route';
import * as decksRoute from '@/app/api/decks/route';
import * as exportRoute from '@/app/api/export/route';
import * as gemsRoute from '@/app/api/gems/route';
import * as imgRoute from '@/app/api/img/[file]/route';
import * as importRoute from '@/app/api/import/route';
import * as improveRoute from '@/app/api/improve/route';
import * as settingsRoute from '@/app/api/settings/route';
import * as statusRoute from '@/app/api/status/route';
import * as syncRoute from '@/app/api/sync/route';
import type { BuildOutcome, Deck } from '@/engine/types';
import type { AnalyzeResponse, CardsResponse, CollectionSummary, DeckResponse, ImportResponse, StatusResponse } from '@/server/api-types';
import type { Db } from '@/server/db';
import { deckText } from '../helpers/fixture-db';
import { seedDb, useServerDb } from './server-db';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', unknown>>;

const ROUTES: [RegExp, RouteModule][] = [
  [/^\/api\/status$/, statusRoute], [/^\/api\/sync$/, syncRoute], [/^\/api\/decks$/, decksRoute],
  [/^\/api\/decks\/(?<id>[^/]+)$/, deckRoute], [/^\/api\/analyze$/, analyzeRoute], [/^\/api\/cards$/, cardsRoute],
  [/^\/api\/card\/(?<id>[^/]+)$/, cardRoute], [/^\/api\/build$/, buildRoute], [/^\/api\/improve$/, improveRoute],
  [/^\/api\/gems$/, gemsRoute], [/^\/api\/import$/, importRoute], [/^\/api\/export$/, exportRoute],
  [/^\/api\/collection$/, collectionRoute], [/^\/api\/settings$/, settingsRoute], [/^\/api\/img\/(?<file>[^/]+)$/, imgRoute],
];

/** Calls the route handler a real request to `url` would reach. */
async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const u = new URL(url, 'http://localhost:3230');
  for (const [pattern, mod] of ROUTES) {
    const m = pattern.exec(u.pathname);
    if (!m) continue;
    const handler = mod[method as keyof RouteModule] as Handler | undefined;
    if (!handler) return new Response('method not allowed', { status: 405 });
    const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return handler(new Request(u, init), { params: Promise.resolve(params) });
  }
  return new Response('not found', { status: 404 });
}
const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
  const res = await request(method, url, body);
  const data = (await res.json()) as T;
  expect(res.status, `${method} ${url}: ${JSON.stringify(data).slice(0, 300)}`).toBeLessThan(300);
  return data;
};

const deckOf = (ids: string[], d: Partial<Deck> = {}): Deck => ({
  id: null, name: 't', format: 'ranked', cards: ids.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'brew', ...d,
});

/** A build-around card that brews on the fixture (Task 8 hand-over: Sunspot -> Unspent energy). */
const LOCK = 'Sunspot';

let db: Db;
let tmp: string;
const envBefore = { data: process.env.SNAP_FORGE_DATA, images: process.env.SNAP_FORGE_IMAGES };

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'snap-forge-api-'));
  mkdirSync(path.join(tmp, 'images'));
  writeFileSync(path.join(tmp, 'images', 'Hulk.webp'), Buffer.from('RIFF0000WEBPVP8 '));
  writeFileSync(path.join(tmp, 'secret.txt'), 'not an image');
  process.env.SNAP_FORGE_IMAGES = path.join(tmp, 'images');
  db = seedDb(path.join(tmp, 'forge.db'));
  useServerDb(db);
});
afterAll(() => {
  useServerDb(null);
  db.close();
  rmSync(tmp, { recursive: true, force: true });
  if (envBefore.images === undefined) delete process.env.SNAP_FORGE_IMAGES;
  else process.env.SNAP_FORGE_IMAGES = envBefore.images;
});

/** The zombie reference deck, imported through the API. */
async function zombie(): Promise<Deck> {
  const imp = await call<ImportResponse>('POST', '/api/import', { text: deckText('zombie') });
  return imp.deck;
}

describe('status and settings', () => {
  it('reports counts, sync state, meta, coverage and formats', async () => {
    const s = await call<StatusResponse>('GET', '/api/status');
    expect(s.counts.released).toBeGreaterThan(400);
    expect(s.counts.features).toBeGreaterThan(400);
    expect(s.counts.edges).toBeGreaterThan(5000);
    expect(s.counts.strongEdges).toBeGreaterThan(0);
    expect(s.meta?.lists).toBe(300);
    expect(s.corpus.withheld).toMatch(/clusters/);
    expect(s.sync.features?.info).toMatchObject({ implemented: true });
    expect(s.coverage).toMatchObject({ noClause: 0 });
    expect(s.formats.find((f) => f.id === 'ranked')).toMatchObject({ verified: true, checked: true });
    expect(s.formats.find((f) => f.id === 'high-voltage')).toMatchObject({ checked: false });
    expect(s.empty).toBe(false);
  });

  it('reads and validates settings', async () => {
    const before = await call<{ settings: Record<string, unknown> }>('GET', '/api/settings');
    expect(before.settings).toMatchObject({ ownedOnly: false, format: 'ranked' });
    const after = await call<{ settings: Record<string, unknown> }>('PUT', '/api/settings', { settings: { seed: 7 } });
    expect(after.settings.seed).toBe(7);
    expect((await request('PUT', '/api/settings', { settings: { ownedOnly: 'yes' } })).status).toBe(400);
    expect((await request('PUT', '/api/settings', { settings: { format: 'no-such-mode' } })).status).toBe(400);
    await call('PUT', '/api/settings', { settings: { seed: 1 } });
  });

  it('sync route rejects unknown steps', async () => {
    expect((await request('POST', '/api/sync', { step: 'everything' })).status).toBe(400);
    const s = await call<{ running: boolean }>('GET', '/api/sync?since=0');
    expect(s.running).toBe(false);
  });
});

describe('analyze', () => {
  it('returns every block for a full deck', async () => {
    const deck = await zombie();
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck });
    for (const key of ['rating', 'novelty', 'floor', 'plans', 'energy', 'lines', 'deckScores', 'violations', 'cards'] as const) expect(a[key], key).toBeDefined();
    expect(a.rating.subscores.length).toBeGreaterThan(0);
    expect(a.plans.primary?.planId).toBe('horde');
    expect(a.energy.pNoPlay).toHaveLength(7);
    expect(a.lines.turns).toHaveLength(6);
    expect(a.deckScores).toHaveLength(12);
    for (const s of a.deckScores) expect(deck.cards.map((c) => c.defId)).toContain(s.defId);
    expect(a.floor.checks.length).toBeGreaterThan(0);
    expect(a.formatChecked).toBe(true);
  });

  it('never fails on partial and odd decks', async () => {
    for (const ids of [[], ['Hulk'], ['Hulk', 'NotACard', 'Hulk']]) {
      const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: deckOf(ids) });
      expect(Number.isFinite(a.rating.rating)).toBe(true);
      expect(a.violations.length).toBeGreaterThan(0);
    }
    expect((await request('POST', '/api/analyze', { deck: 'Hulk' })).status).toBe(400);
    expect((await request('POST', '/api/analyze', 'not json')).status).toBe(400);
  });
});

describe('cards', () => {
  it('scores cards, filters by axis and by play-rate ceiling, puts gated cards last', async () => {
    const deck = await zombie();
    const all = await call<CardsResponse>('POST', '/api/cards', { deck, pageSize: 1000 });
    expect(all.total).toBeGreaterThan(400);
    // In-deck cards are scored leave-one-out and flagged, not gated (scoring/scorer.ts).
    expect(all.cards.filter((c) => c.inDeck).map((c) => c.card.defId).sort()).toEqual(deck.cards.map((c) => c.defId).sort());

    // Gated cards come last: a mode with a ban list gates its banned cards.
    const sanctum = await call<CardsResponse>('POST', '/api/cards', { deck: { ...deck, format: 'sanctum-showdown' }, pageSize: 1000 });
    const firstGated = sanctum.cards.findIndex((c) => c.score.gate !== null);
    expect(firstGated).toBeGreaterThan(0);
    for (const c of sanctum.cards.slice(firstGated)) expect(c.score.gate?.code).toBe('MODE_BANNED');
    expect(sanctum.cards.length - firstGated).toBeGreaterThan(5);

    const destroy = await call<CardsResponse>('POST', '/api/cards', { deck, filters: { axis: 'destroy' }, pageSize: 1000 });
    expect(destroy.total).toBeGreaterThan(0);
    expect(destroy.total).toBeLessThan(all.total);
    for (const c of destroy.cards) expect(c.axes.destroy, c.card.name).toBeDefined();

    const rare = await call<CardsResponse>('POST', '/api/cards', { deck, filters: { maxPlayRate: 0.01 }, pageSize: 1000 });
    expect(rare.total).toBeGreaterThan(0);
    expect(rare.total).toBeLessThan(all.total);
    for (const c of rare.cards) expect(c.playRate, c.card.name).toBeLessThanOrEqual(0.01);

    const page = await call<CardsResponse>('POST', '/api/cards', { deck, q: 'zombie', page: 0, pageSize: 5 });
    expect(page.cards.length).toBeGreaterThan(0);
    expect(page.cards.length).toBeLessThanOrEqual(5);

    const cheap = await call<CardsResponse>('POST', '/api/cards', { deck: deckOf([]), filters: { cost: [1] }, sort: 'name', pageSize: 1000 });
    for (const c of cheap.cards) expect(c.card.cost).toBe(1);
    const names = cheap.cards.map((c) => c.card.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, 'en')));
  });

  it('card detail gives features, partners with reasons and play rate', async () => {
    const d = await call<{ card: { defId: string }; features: unknown; partners: { defId: string; reasons: unknown[] }[]; playRate: unknown; score: unknown }>(
      'GET', '/api/card/Hulk?deck=Patriot,Hulk',
    );
    expect(d.card.defId).toBe('Hulk');
    expect(d.features).toBeTruthy();
    expect(d.partners.length).toBeGreaterThan(0);
    expect(d.partners[0]!.reasons.length).toBeGreaterThan(0);
    expect(d.score).toBeTruthy();
    expect((await request('GET', '/api/card/NotACard')).status).toBe(404);
  });

  it('gems', async () => {
    const g = await call<{ gems: { cards: string[] }[]; withheld: string | null }>('GET', '/api/gems?limit=5');
    expect(g.gems.length).toBeLessThanOrEqual(5);
    expect(g.withheld).toMatch(/clusters/);
  });
});

describe('decks, import and export', () => {
  it('imports a deck code, saves, loads and exports it', async () => {
    const block = deckText('magneto');
    const code = block.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))!;
    const imp = await call<ImportResponse>('POST', '/api/import', { text: code });
    expect(imp.deck.cards).toHaveLength(12);
    expect(imp.unresolved).toEqual([]);

    const saved = await call<DeckResponse>('POST', '/api/decks', { deck: { ...imp.deck, name: 'Magneto test' } });
    expect(saved.deck.id).toBeTruthy();
    const loaded = await call<DeckResponse>('GET', `/api/decks/${saved.deck.id}`);
    expect(loaded.deck.cards.map((c) => c.defId).sort()).toEqual(imp.deck.cards.map((c) => c.defId).sort());
    expect(loaded.deck.name).toBe('Magneto test');

    const list = await call<{ decks: { id: string; rating: number; legal: boolean; band: string }[] }>('GET', '/api/decks');
    const tile = list.decks.find((t) => t.id === saved.deck.id)!;
    expect(tile.legal).toBe(true);
    expect(tile.rating).toBeGreaterThan(0);

    const exp = await call<{ text: string; long: string | null; short: string | null }>('POST', '/api/export', { deck: loaded.deck });
    expect(exp.text).toContain(code);
    expect(exp.short).toBe(code);
    const again = await call<ImportResponse>('POST', '/api/import', { text: exp.long });
    expect(again.deck.cards.map((c) => c.defId).sort()).toEqual(imp.deck.cards.map((c) => c.defId).sort());

    const renamed = await call<DeckResponse>('PUT', `/api/decks/${saved.deck.id}`, { deck: { ...loaded.deck, name: 'Renamed' } });
    expect(renamed.deck.name).toBe('Renamed');
    await call('DELETE', `/api/decks/${saved.deck.id}`);
    expect((await request('GET', `/api/decks/${saved.deck.id}`)).status).toBe(404);
    expect((await request('PUT', '/api/decks/nope', { deck: loaded.deck })).status).toBe(404);
  });

  it('reports unresolved import lines instead of dropping them', async () => {
    const imp = await call<ImportResponse>('POST', '/api/import', { text: 'Hulk\nNot A Real Card\nPatriot' });
    expect(imp.deck.cards.map((c) => c.defId)).toEqual(['Hulk', 'Patriot']);
    expect(imp.unresolved).toEqual([{ line: 2, text: 'Not A Real Card' }]);
    expect(imp.violations.length).toBeGreaterThan(0);
  });
});

describe('build, improve and collection', () => {

  it('build returns floor-passing decks containing the locked card', async () => {
    const out = await call<BuildOutcome>('POST', '/api/build', { deck: { ...deckOf([]), cards: [{ defId: LOCK, locked: true }] }, options: { count: 2, seed: 1 } });
    expect(out.refused, out.refused ?? '').toBeNull();
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r.floor.passed).toBe(true);
      expect(r.deck.cards).toHaveLength(12);
      expect(r.deck.cards.map((c) => c.defId)).toContain(LOCK);
    }
    expect((await request('POST', '/api/build', { deck: deckOf([]), options: { mode: 'fast' } })).status).toBe(400);
  });

  it('improve returns checked swaps that never cut a locked card', async () => {
    const deck = await zombie();
    deck.cards[0]!.locked = true;
    const out = await call<{ swaps: { out: string; in: string; ratingAfter: number; ratingBefore: number }[] }>(
      'POST', '/api/improve', { deck, direction: 'stronger', options: { seed: 1 } },
    );
    for (const s of out.swaps) {
      expect(s.out).not.toBe(deck.cards[0]!.defId);
      expect(s.ratingAfter).toBeGreaterThan(s.ratingBefore);
    }
    expect((await request('POST', '/api/improve', { deck, direction: 'weirder' })).status).toBe(400);
  });

  it('collection import then owned-only build uses only owned cards', async () => {
    const base = await call<BuildOutcome>('POST', '/api/build', { deck: { ...deckOf([]), cards: [{ defId: LOCK, locked: true }] }, options: { count: 1, seed: 1 } });
    const first = base.results[0]!.deck.cards.map((c) => c.defId);
    // Drop four picks that are not strong partners of the lock, so C5 still holds for the owned pool.
    const partners = (await call<{ partners: { defId: string; strong: boolean }[] }>('GET', `/api/card/${LOCK}`)).partners.filter((p) => p.strong).map((p) => p.defId);
    const missing = new Set(first.filter((id) => id !== LOCK && !partners.includes(id)).slice(0, 4));
    expect(missing.size).toBe(4);

    const all = await call<CardsResponse>('POST', '/api/cards', { deck: deckOf([]), pageSize: 1000 });
    const ownedNames = all.cards.filter((c) => !missing.has(c.card.defId)).map((c) => c.card.name);
    const imp = await call<{ added: number; unresolved: string[]; summary: CollectionSummary }>('POST', '/api/collection', { text: ownedNames.join('\n'), mode: 'replace' });
    expect(imp.added).toBe(ownedNames.length);
    expect(imp.summary.owned).toBe(ownedNames.length);
    expect(imp.summary.bySeries.reduce((s, x) => s + x.owned, 0)).toBe(ownedNames.length);

    const out = await call<BuildOutcome>('POST', '/api/build', { deck: { ...deckOf([]), cards: [{ defId: LOCK, locked: true }] }, options: { count: 1, seed: 1, ownedOnly: true } });
    expect(out.results.length, out.refused ?? '').toBeGreaterThan(0);
    const owned = new Set((await call<CollectionSummary>('GET', '/api/collection')).ownedIds);
    for (const r of out.results) for (const c of r.deck.cards) expect(owned.has(c.defId), c.defId).toBe(true);

    const cards = await call<CardsResponse>('POST', '/api/cards', { deck: deckOf([]), filters: { owned: true }, pageSize: 1000 });
    expect(cards.total).toBe(ownedNames.length);
  });

  it('per-series toggles and clearing', async () => {
    const s0 = await call<CollectionSummary>('GET', '/api/collection');
    const series = s0.bySeries.find((x) => x.owned < x.total) ?? s0.bySeries[0]!;
    const on = await call<{ summary: CollectionSummary }>('POST', '/api/collection', { series: series.series, owned: true });
    expect(on.summary.bySeries.find((x) => x.series === series.series)!.owned).toBe(series.total);
    const off = await call<{ summary: CollectionSummary }>('POST', '/api/collection', { series: series.series, owned: false });
    expect(off.summary.bySeries.find((x) => x.series === series.series)!.owned).toBe(0);
    expect((await request('POST', '/api/collection', { series: 'x', owned: true })).status).toBe(400);
    const cleared = await call<CollectionSummary>('DELETE', '/api/collection');
    expect(cleared.owned).toBe(0);
  });
});

describe('images', () => {
  it('serves files, a placeholder on a miss, and refuses path traversal', async () => {
    const hit = await request('GET', '/api/img/Hulk.webp');
    expect(hit.status).toBe(200);
    expect(hit.headers.get('Content-Type')).toBe('image/webp');
    expect(hit.headers.get('Cache-Control')).toMatch(/max-age=\d+/);
    const miss = await request('GET', '/api/img/Patriot.webp');
    expect(miss.status).toBe(404);
    expect(miss.headers.get('Content-Type')).toMatch(/svg/);
    // A raw "../" never reaches the route (URLs are normalised first); the handler refuses it anyway.
    const raw = await imgRoute.GET(new Request('http://localhost:3230/api/img/x'), { params: Promise.resolve({ file: '../secret.txt' }) });
    expect(raw.status).toBe(400);
    for (const bad of ['..%2Fsecret.txt', '..%2F..%2Fforge.db', 'Hulk.png', '%2Fetc%2Fpasswd']) {
      expect((await request('GET', `/api/img/${bad}`)).status, bad).toBe(400);
    }
  });
});

describe('empty meta', () => {
  let bare: Db;
  beforeAll(() => {
    bare = seedDb(':memory:', { meta: false });
    useServerDb(bare);
  });
  afterAll(() => {
    useServerDb(db);
    bare.close();
  });

  it('everything works with no meta snapshot', async () => {
    const s = await call<StatusResponse>('GET', '/api/status');
    expect(s.meta).toBeNull();
    expect(s.corpus.withheld).toBeTruthy();
    const deck = await zombie();
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck });
    expect(a.novelty.band).toBe('unknown');
    expect(a.novelty.claimsWithheld).toBeTruthy();
    expect(a.lines.field).toEqual([]);
    const cards = await call<CardsResponse>('POST', '/api/cards', { deck, filters: { maxPlayRate: 0.01 }, pageSize: 10 });
    expect(cards.total).toBeGreaterThan(0);
    const out = await call<BuildOutcome>('POST', '/api/build', { deck: { ...deckOf([]), cards: [{ defId: LOCK, locked: true }] }, options: { count: 1, seed: 1 } });
    expect(out.results.length + (out.refused ? 1 : 0)).toBeGreaterThan(0);
    await call('GET', '/api/gems?limit=3');
    await call('GET', '/api/card/Hulk');
    await call('POST', '/api/improve', { deck, direction: 'more-original' });
  });
});
