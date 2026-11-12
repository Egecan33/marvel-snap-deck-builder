import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createCardDb, createMetaIndex, toCard, type UntappedCardRow } from '@/engine/carddb';
import type { TextFix } from '@/engine/text/clean';
import type { CardDb, CardEdge, CardFeatures, FormatDef, MetaArchetype, MetaIndex, MetaInfo, MetaList, PlanDef } from '@/engine/types';
import { openDb, type Db } from './db';
import { cacheSlot, dropCaches, serverState } from './state';

/** Below this many lists the 30-day snapshot is preferred when one was synced (spec §6.1). */
const THIN_SNAPSHOT_LISTS = 1000;

/** The process-wide database handle, opened on first use. */
export function getDb(): Db {
  const s = serverState();
  return (s.db ??= openDb());
}

/** Reviewed data files committed under sync-data/ (spec §6.2). A missing file is an empty list. */
export function readSyncData<T>(file: string, root: string = process.cwd()): T[] {
  const full = path.join(/* turbopackIgnore: true */ root, 'sync-data', file);
  if (!existsSync(full)) return [];
  const parsed = JSON.parse(readFileSync(full, 'utf8')) as unknown;
  if (Array.isArray(parsed)) return parsed as T[];
  const inner = (parsed as { formats?: T[]; plans?: T[]; items?: T[] }) ?? {};
  return inner.formats ?? inner.plans ?? inner.items ?? [];
}

/** sync-data/card-text-fixes.json: defId -> reviewed text (plan Task 2, dropped numbers). */
export function readTextFixes(root: string = process.cwd()): Record<string, TextFix> {
  const full = path.join(/* turbopackIgnore: true */ root, 'sync-data', 'card-text-fixes.json');
  if (!existsSync(full)) return {};
  const parsed = JSON.parse(readFileSync(full, 'utf8')) as unknown;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, TextFix>) : {};
}

interface SnapshotRow { id: string; timeframe: string; lists: number; json: string }

/**
 * The meta snapshot the app reads: the newest current-period snapshot, or the newest 30-day one
 * while the current period is still thin. An empty index when nothing was synced.
 */
export function loadMetaIndex(db: Db): MetaIndex {
  const newest = (timeframeLike: string): SnapshotRow | undefined =>
    db.prepare('SELECT id, timeframe, lists, json FROM meta_snapshots WHERE timeframe LIKE ? ORDER BY fetched_at DESC LIMIT 1').get(timeframeLike) as SnapshotRow | undefined;
  const current = newest('CURRENT_META_PERIOD');
  const wide = newest('EXACTLY_LAST_30_DAYS%');
  const pick = current && current.lists >= THIN_SNAPSHOT_LISTS ? current : wide ?? current;
  if (!pick) return createMetaIndex(null, [], []);

  const info = JSON.parse(pick.json) as MetaInfo;
  const lists = (
    db.prepare('SELECT list_key AS key, cards, archetype, games, wins, cluster FROM meta_lists WHERE snapshot = ? ORDER BY games DESC, list_key').all(pick.id) as {
      key: string; cards: string; archetype: number | null; games: number; wins: number; cluster: number;
    }[]
  ).map((r): MetaList => ({ key: r.key, cards: JSON.parse(r.cards) as string[], archetypeId: r.archetype, games: r.games, wins: r.wins, cluster: r.cluster }));
  const archetypes = (db.prepare('SELECT json FROM meta_archetypes WHERE snapshot = ? ORDER BY games DESC, id').all(pick.id) as { json: string }[]).map(
    (r) => JSON.parse(r.json) as MetaArchetype,
  );
  return createMetaIndex(info, lists, archetypes);
}

/** Builds a CardDb from the database for the clock value `now`. Not cached. */
export function buildCardDb(db: Db, now: number, root: string = process.cwd()): CardDb {
  const fixes = readTextFixes(root);
  const cards = (db.prepare('SELECT json FROM cards').all() as { json: string }[]).map((r) => toCard(JSON.parse(r.json) as UntappedCardRow, now, fixes));
  const features = (db.prepare('SELECT json FROM card_features').all() as { json: string }[]).map((r) => JSON.parse(r.json) as CardFeatures);
  const edges = (db.prepare('SELECT json FROM card_edges').all() as { json: string }[]).map((r) => JSON.parse(r.json) as CardEdge);
  return createCardDb({
    cards, features, edges,
    formats: readSyncData<FormatDef>('formats.json', root),
    plans: readSyncData<PlanDef>('plans.json', root),
    meta: loadMetaIndex(db),
    now,
  });
}

interface Cached { db: CardDb; nextRelease: number }

/**
 * The cached CardDb. Card classes depend on the clock, so the cache is rebuilt once the next
 * scheduled release date has passed, as well as after every sync (`invalidateCardDb`).
 */
export function loadCardDb(db: Db = getDb(), now: number = Date.now()): CardDb {
  let cached = cacheSlot<Cached | null>('carddb', () => null);
  if (!cached || now >= cached.nextRelease) {
    const built = buildCardDb(db, now);
    const future = built.all().map((c) => c.releaseAt).filter((t): t is number => t !== null && t > now);
    cached = { db: built, nextRelease: future.length > 0 ? Math.min(...future) : Infinity };
    serverState().caches.set('carddb', cached);
  }
  return cached.db;
}

export function invalidateCardDb(): void {
  dropCaches();
}
