import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { storeCards } from '@/ingest/cards';
import { strongest, syncFeatures } from '@/ingest/features';
import { buildCardDb } from '@/server/carddb';
import { openDb, readSyncState } from '@/server/db';
import { fixtureDb, fixtureNow, fixtureRows } from '../helpers/fixture-db';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('features sync step', () => {
  const db = openDb(':memory:');
  storeCards(db, fixtureRows(), fixtureNow());
  const lines: string[] = [];
  const summary = syncFeatures(db, (l) => lines.push(l), { now: fixtureNow(), root: ROOT });

  it('stores features and edges, and the CardDb reads them back', () => {
    const fx = fixtureDb();
    expect(summary.cards).toBe(fx.released().length);
    expect(summary.features).toBeGreaterThanOrEqual(summary.cards);
    expect(summary.edges).toBeGreaterThan(5000);
    expect(summary.strong).toBeGreaterThan(0);
    const loaded = buildCardDb(db, fixtureNow(), ROOT);
    expect(loaded.features('Hulk')?.axes.no_ability?.e).toBe(1);
    expect(loaded.edge('Patriot', 'Hulk')).toEqual(fx.edge('Patriot', 'Hulk'));
    expect(loaded.edges('Hulk').length).toBe(fx.edges('Hulk').length);
  });

  it('writes sync_state and prints counts, coverage and the 30 strongest edges', () => {
    const state = readSyncState(db, 'features');
    expect(state?.info).toMatchObject({ implemented: true, cards: summary.cards, edges: summary.edges, strong: summary.strong });
    expect(lines[0]).toMatch(/released cards, .* edges \(\d+ strong/);
    expect(lines.some((l) => l.startsWith('coverage:'))).toBe(true);
    const idx = lines.indexOf('30 strongest edges:');
    expect(lines.length - idx - 1).toBe(30);
    expect(summary.ms).toBeLessThan(60_000);
  });

  it('is idempotent', () => {
    const again = syncFeatures(db, () => undefined, { now: fixtureNow(), root: ROOT });
    expect({ ...again, ms: 0 }).toEqual({ ...summary, ms: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM card_edges').get() as { n: number }).n).toBe(summary.edges);
  });

  it('refuses to run on an empty card table', () => {
    expect(() => syncFeatures(openDb(':memory:'), () => undefined, { root: ROOT })).toThrow(/no released cards/);
  });

  it('tags stored meta archetypes with the primary plan of their sample list', () => {
    const tdb = openDb(':memory:');
    storeCards(tdb, fixtureRows(), fixtureNow());
    const zombie = fixtureDb().meta().archetypes().find((a) => a.name === 'Zombie')!;
    tdb.prepare('INSERT INTO meta_archetypes(snapshot, id, name, games, wins, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run('s1', zombie.id, zombie.name, zombie.games, zombie.wins, JSON.stringify({ ...zombie, planId: null }));
    const out: string[] = [];
    const s = syncFeatures(tdb, (l) => out.push(l), { now: fixtureNow(), root: ROOT });
    expect(s.archetypes).toEqual({ total: 1, tagged: 1 });
    const row = tdb.prepare('SELECT json FROM meta_archetypes WHERE id = ?').get(zombie.id) as { json: string };
    expect((JSON.parse(row.json) as { planId: string | null }).planId).toBe('horde');
    expect(out.some((l) => /^plans: 1 of 1 meta archetypes/.test(l))).toBe(true);
  });

  it('orders the strongest edges by score', () => {
    const top = strongest(fixtureDb().edges('Hulk'), 3);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.score).toBeGreaterThanOrEqual(top[i]!.score);
  });
});
