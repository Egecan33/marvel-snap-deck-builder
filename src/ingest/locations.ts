import { cleanText } from '@/engine/text/clean';
import { writeSyncState, type Db } from '@/server/db';
import { buildFromUrl, type Log } from './cards';
import { getJson, type HttpOptions } from './http';

export const LOCATIONS_URL = 'https://snapjson.untapped.gg/v2/latest/en/locations.json';

interface LocationRow { defId: string; name?: string; description?: string; [key: string]: unknown }

/**
 * Locations are context for theorycraft lines only. The source has no released flag (data §3),
 * so nothing here says whether a location is in rotation.
 */
export async function syncLocations(db: Db, log: Log, opts: { http?: HttpOptions } = {}): Promise<void> {
  const { data, url } = await getJson<unknown>(LOCATIONS_URL, opts.http);
  if (!Array.isArray(data)) throw new Error('locations.json is not an array; keeping the stored locations');
  const rows = data.filter((r): r is LocationRow => typeof r === 'object' && r !== null && typeof (r as LocationRow).defId === 'string');
  if (rows.length < 50) throw new Error(`locations.json looks wrong (${rows.length} rows); keeping the stored locations`);
  const insert = db.prepare('INSERT OR REPLACE INTO locations(def_id, name, json) VALUES (?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM locations').run();
    for (const r of rows) {
      const name = typeof r.name === 'string' && r.name ? r.name : r.defId;
      insert.run(r.defId, name, JSON.stringify({ defId: r.defId, name, text: cleanText(r.description), rawText: r.description ?? '', attributes: r.attributes ?? null }));
    }
  })();
  const info = { build: buildFromUrl(url), source: url, rows: rows.length };
  writeSyncState(db, 'locations', info);
  log(`locations finished ${JSON.stringify(info)}`);
}
