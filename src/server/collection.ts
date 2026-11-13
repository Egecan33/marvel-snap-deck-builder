import { parseCollection } from '@/engine/io/collection';
import type { CollectionSummary } from './api-types';
import { getDb, loadCardDb } from './carddb';
import { HttpError } from './http';
import { cacheSlot, serverNow, serverState } from './state';

const changed = (): void => {
  serverState().caches.delete('owned');
};

/** Owned released cards as the engine's `owned` map. Cards no longer in the pool are left out. */
export function ownedMap(): Record<string, true> {
  return cacheSlot('owned', () => {
    const db = loadCardDb();
    const out: Record<string, true> = {};
    for (const r of getDb().prepare('SELECT def_id AS id FROM collection').all() as { id: string }[]) if (db.get(r.id)?.cardClass === 'released') out[r.id] = true;
    return out;
  });
}

export function collectionSummary(): CollectionSummary {
  const db = loadCardDb();
  const owned = ownedMap();
  const groups = new Map<number, { series: number; label: string; owned: number; total: number }>();
  for (const c of db.released()) {
    const g = groups.get(c.series) ?? { series: c.series, label: c.seriesLabel, owned: 0, total: 0 };
    g.total += 1;
    if (owned[c.defId]) g.owned += 1;
    groups.set(c.series, g);
  }
  const ownedIds = Object.keys(owned).sort();
  return { owned: ownedIds.length, released: db.released().length, bySeries: [...groups.values()].sort((a, b) => a.series - b.series), ownedIds };
}

function addIds(ids: readonly string[]): number {
  const db = getDb();
  const at = new Date(serverNow()).toISOString();
  const ins = db.prepare('INSERT OR IGNORE INTO collection(def_id, added_at) VALUES (?, ?)');
  let added = 0;
  db.transaction(() => {
    for (const id of ids) added += ins.run(id, at).changes;
  })();
  return added;
}

/**
 * Imports the box input (a state file, deck codes or a card list; `parseCollection` decides).
 * `replace` empties the collection first. Unresolved entries are returned, never dropped silently.
 */
export function importCollection(text: unknown, mode: unknown = 'add'): { added: number; unresolved: string[]; kind: string; summary: CollectionSummary } {
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text must be the collection file contents, deck codes or a card list.');
  if (text.length > 5_000_000) throw new HttpError(413, 'text is larger than 5 MB.');
  if (mode !== 'add' && mode !== 'replace') throw new HttpError(400, "mode must be 'add' or 'replace'.");
  const parsed = parseCollection(text, loadCardDb());
  if (mode === 'replace') getDb().prepare('DELETE FROM collection').run();
  const added = addIds(parsed.owned);
  changed();
  return { added, unresolved: parsed.unresolved, kind: parsed.kind, summary: collectionSummary() };
}

/** Per-series bulk toggle: own (or stop owning) every released card of one series code. */
export function setSeries(series: unknown, owned: unknown): CollectionSummary {
  if (typeof series !== 'number' || !Number.isInteger(series)) throw new HttpError(400, 'series must be a series code (a whole number).');
  if (typeof owned !== 'boolean') throw new HttpError(400, 'owned must be true or false.');
  const ids = loadCardDb().released().filter((c) => c.series === series).map((c) => c.defId);
  if (ids.length === 0) throw new HttpError(400, `No released card has series code ${series}.`);
  if (owned) addIds(ids);
  else {
    const del = getDb().prepare('DELETE FROM collection WHERE def_id = ?');
    getDb().transaction(() => {
      for (const id of ids) del.run(id);
    })();
  }
  changed();
  return collectionSummary();
}

export function clearCollection(): CollectionSummary {
  getDb().prepare('DELETE FROM collection').run();
  changed();
  return collectionSummary();
}
