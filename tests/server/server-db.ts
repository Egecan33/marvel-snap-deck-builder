import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MetaArchetype, MetaInfo, MetaList } from '@/engine/types';
import { storeCards } from '@/ingest/cards';
import { syncFeatures } from '@/ingest/features';
import { storeSnapshot } from '@/ingest/meta';
import { invalidateCardDb } from '@/server/carddb';
import { openDb, type Db } from '@/server/db';
import { resetServerState, setClock } from '@/server/state';
import { fixtureNow, fixtureRows } from '../helpers/fixture-db';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

interface MetaFixture { info: MetaInfo; archetypes: MetaArchetype[]; lists: MetaList[] }

/**
 * A SQLite database filled from the committed fixtures the way `pnpm sync` fills the real one:
 * card rows, the 300-list meta fixture (unless `meta: false`), then the features step.
 */
export function seedDb(dbPath = ':memory:', opts: { meta?: boolean } = {}): Db {
  const db = openDb(dbPath);
  storeCards(db, fixtureRows(), fixtureNow());
  if (opts.meta !== false) {
    const m = JSON.parse(readFileSync(FIXTURES + 'meta.json', 'utf8')) as MetaFixture;
    storeSnapshot(db, {
      id: 'fixture', timeframe: 'CURRENT_META_PERIOD', season: null, etag: null, lastModified: null,
      info: m.info, lists: m.lists.map((l) => ({ ...l, altArchetypeId: null })), wins: m.lists.reduce((s, l) => s + l.wins, 0),
      archetypes: m.archetypes, lowRank: new Map(),
    });
  }
  syncFeatures(db, () => undefined, { now: fixtureNow(), root: ROOT });
  return db;
}

/** Points the server layer at `db` (or at nothing), pins the clock to the fixture, forgets every cache. */
export function useServerDb(db: Db | null): void {
  invalidateCardDb();
  resetServerState(db);
  setClock(db ? fixtureNow : null);
}
