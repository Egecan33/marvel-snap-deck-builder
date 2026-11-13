import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * The one place that decides where the database, card images and caches live. Everything else
 * (server, sync CLI, image route, status) asks this function.
 * - `SNAP_FORGE_DATA` set: that folder (tests and power users).
 * - Portable bundle: the launcher sets `SNAP_FORGE_BUNDLE` to the unzipped folder; data goes in
 *   its `data/` folder, next to the app.
 * - From source: `./data` under the project root.
 * turbopackIgnore: the bundler must not trace the image files under data/ into the build.
 */
export function dataDir(): string {
  if (process.env.SNAP_FORGE_DATA) return process.env.SNAP_FORGE_DATA;
  if (process.env.SNAP_FORGE_BUNDLE) return path.join(/* turbopackIgnore: true */ process.env.SNAP_FORGE_BUNDLE, 'data');
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
}

/** `forge.db` in the data folder, unless `SNAP_FORGE_DB` names another file. */
export const defaultDbPath = (): string => process.env.SNAP_FORGE_DB ?? path.join(dataDir(), 'forge.db');

// Tables of spec §6.3. `cards.json` is the source row as fetched: the class column is what it was
// at sync time and is recomputed from the row at every load, because it depends on the clock.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  def_id TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_name ON cards(name);
CREATE TABLE IF NOT EXISTS locations (def_id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS card_features (def_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS card_edges (
  a TEXT NOT NULL, b TEXT NOT NULL, score REAL NOT NULL, json TEXT NOT NULL, PRIMARY KEY (a, b)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS card_edges_b ON card_edges(b);
CREATE TABLE IF NOT EXISTS meta_snapshots (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, timeframe TEXT NOT NULL,
  period_id INTEGER, period_label TEXT, period_start TEXT, season TEXT,
  fetched_at TEXT NOT NULL, etag TEXT, last_modified TEXT,
  lists INTEGER NOT NULL, clusters INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
  min_games INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta_lists (
  snapshot TEXT NOT NULL, list_key TEXT NOT NULL, cards TEXT NOT NULL,
  archetype INTEGER, alt_archetype INTEGER, games INTEGER NOT NULL, wins INTEGER NOT NULL, cluster INTEGER NOT NULL,
  PRIMARY KEY (snapshot, list_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta_archetypes (
  snapshot TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
  json TEXT NOT NULL, PRIMARY KEY (snapshot, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta_card_stats (
  snapshot TEXT NOT NULL, def_id TEXT NOT NULL, lists INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
  low_rank_matches INTEGER, low_rank_win_rate REAL, PRIMARY KEY (snapshot, def_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta_pairs (
  snapshot TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, lists INTEGER NOT NULL, clusters INTEGER NOT NULL,
  PRIMARY KEY (snapshot, a, b)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS collection (def_id TEXT PRIMARY KEY, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (step TEXT PRIMARY KEY, finished_at TEXT NOT NULL, info TEXT NOT NULL);
`;

/** Opens (and creates if needed) the SQLite database. Pass ':memory:' for tests. */
export function openDb(dbPath: string = defaultDbPath()): Db {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

/** `at` is the clock value of the run; callers that take `now` as a parameter pass it on. */
export function writeSyncState(db: Db, step: string, info: Record<string, unknown>, at: number = Date.now()): void {
  db.prepare(
    'INSERT INTO sync_state(step, finished_at, info) VALUES (?, ?, ?) ' +
      'ON CONFLICT(step) DO UPDATE SET finished_at = excluded.finished_at, info = excluded.info',
  ).run(step, new Date(at).toISOString(), JSON.stringify(info));
}

export function readSyncState(db: Db, step: string): { finishedAt: string; info: Record<string, unknown> } | null {
  const row = db.prepare('SELECT finished_at AS finishedAt, info FROM sync_state WHERE step = ?').get(step) as
    | { finishedAt: string; info: string }
    | undefined;
  if (!row) return null;
  let info: Record<string, unknown> = {};
  try {
    info = JSON.parse(row.info) as Record<string, unknown>;
  } catch {
    // an unreadable info blob is treated as empty
  }
  return { finishedAt: row.finishedAt, info };
}
