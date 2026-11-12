import type { CardDb, FormatDef, FormatId } from '../types';

/** The mode a deck falls back to and the one whose rules every unverified mode is checked against. */
export const RANKED: FormatId = 'ranked';

/** The format of `id` from sync-data/formats.json, or null when the file does not declare it. */
export function findFormat(db: CardDb, id: FormatId | null | undefined): FormatDef | null {
  if (typeof id !== 'string') return null;
  return db.formats().find((f) => f.id === id) ?? null;
}

/**
 * True when Snap Forge can say a deck passes this mode: its rules and ban list are verified and it
 * is built from a collection (rules §1.2). For any other mode the legal verdict is Ranked's only,
 * and the UI must not claim a pass for the mode itself.
 */
export function isCheckedFormat(format: FormatDef | null): boolean {
  return format !== null && format.verified && format.constructed;
}

/** Display name of a mode id, falling back to the id itself for a mode formats.json does not know. */
export function formatName(db: CardDb, id: FormatId | null | undefined): string {
  return findFormat(db, id)?.name ?? (typeof id === 'string' && id ? id : 'this mode');
}
