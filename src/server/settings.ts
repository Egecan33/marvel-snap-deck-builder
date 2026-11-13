import { findFormat, RANKED } from '@/engine/rules/formats';
import type { Settings } from './api-types';
import { getDb, loadCardDb } from './carddb';
import { HttpError, isObject } from './http';
import { cacheSlot, serverState } from './state';

export const DEFAULT_SETTINGS: Readonly<Settings> = { ownedOnly: false, format: RANKED, seed: 1, brewCount: 6 };

const ROW = 'app';

/** Stored settings over the defaults; an unreadable row is the defaults. */
export function getSettings(): Settings {
  return cacheSlot('settings', () => {
    const row = getDb().prepare('SELECT json FROM settings WHERE key = ?').get(ROW) as { json: string } | undefined;
    let stored: Partial<Settings> = {};
    try {
      if (row) stored = JSON.parse(row.json) as Partial<Settings>;
    } catch {
      // defaults
    }
    try {
      return { ...DEFAULT_SETTINGS, ...validate(stored) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
}

function validate(input: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if ('ownedOnly' in input) {
    if (typeof input.ownedOnly !== 'boolean') throw new HttpError(400, 'settings.ownedOnly must be true or false.');
    out.ownedOnly = input.ownedOnly;
  }
  if ('format' in input) {
    if (typeof input.format !== 'string' || !findFormat(loadCardDb(), input.format)) throw new HttpError(400, 'settings.format must be a known mode id (sync-data/formats.json).');
    out.format = input.format;
  }
  if ('seed' in input) {
    if (typeof input.seed !== 'number' || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 2 ** 31) throw new HttpError(400, 'settings.seed must be a whole number from 0 to 2^31.');
    out.seed = input.seed;
  }
  if ('brewCount' in input) {
    if (typeof input.brewCount !== 'number' || !Number.isInteger(input.brewCount) || input.brewCount < 1 || input.brewCount > 6) throw new HttpError(400, 'settings.brewCount must be 1 to 6.');
    out.brewCount = input.brewCount;
  }
  return out;
}

/** Merges a partial update into the stored settings. Unknown keys are ignored; bad values are a 400. */
export function updateSettings(patch: unknown): Settings {
  if (!isObject(patch)) throw new HttpError(400, 'settings must be an object.');
  const next: Settings = { ...getSettings(), ...validate(patch) };
  getDb().prepare('INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(ROW, JSON.stringify(next));
  serverState().caches.delete('settings');
  return next;
}
