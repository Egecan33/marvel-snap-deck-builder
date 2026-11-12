import { classOf, type UntappedCardRow } from '@/engine/carddb';
import type { CardClass } from '@/engine/types';
import { writeSyncState, type Db } from '@/server/db';
import { getJson, type HttpOptions } from './http';

export type Log = (line: string) => void;

export const CARDS_URL = 'https://snapjson.untapped.gg/v2/latest/en/cards.json';

/** `latest` redirects to the game build: .../v2/58.15.3/en/cards.json (data §1.1). */
export function buildFromUrl(url: string): string | null {
  const m = /\/v2\/([^/]+)\/[a-z]{2}\/[a-z-]+\.json/i.exec(url);
  return m && m[1] !== 'latest' ? m[1] : null;
}

export function countClasses(rows: readonly UntappedCardRow[], now: number): Record<CardClass, number> {
  const counts: Record<CardClass, number> = { released: 0, upcoming: 0, token: 0 };
  for (const r of rows) counts[classOf(r, now)] += 1;
  return counts;
}

const isRow = (r: unknown): r is UntappedCardRow =>
  typeof r === 'object' && r !== null && typeof (r as UntappedCardRow).defId === 'string' && (r as UntappedCardRow).defId !== '';

/** Replaces the card table with `rows` in one transaction. The stored row is the source row. */
export function storeCards(db: Db, rows: readonly UntappedCardRow[], now: number): Record<CardClass, number> {
  const insert = db.prepare('INSERT OR REPLACE INTO cards(def_id, name, class, json) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM cards').run();
    for (const r of rows) insert.run(r.defId, typeof r.name === 'string' ? r.name : r.defId, classOf(r, now), JSON.stringify(r));
  })();
  return countClasses(rows, now);
}

export async function syncCards(db: Db, log: Log, opts: { now?: number; http?: HttpOptions } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  const { data, url } = await getJson<unknown>(CARDS_URL, opts.http);
  if (!Array.isArray(data)) throw new Error('cards.json is not an array; keeping the stored cards');
  const rows = data.filter(isRow);
  const counts = countClasses(rows, now);
  // A truncated or reshaped file must not wipe a good table.
  if (rows.length < 400 || counts.released < 300) {
    throw new Error(`cards.json looks wrong (${rows.length} rows, ${counts.released} released); keeping the stored cards`);
  }
  storeCards(db, rows, now);
  const build = buildFromUrl(url);
  const info = { build, source: url, rows: rows.length, skipped: data.length - rows.length, ...counts };
  writeSyncState(db, 'cards', info);
  log(`cards finished ${JSON.stringify(info)}`);
}
