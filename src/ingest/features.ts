import { writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';

/**
 * Stub until the features engine exists (plan Task 5). The real step parses card text, derives
 * traits, axes, tech roles, quality and edges, tags each archetype with its plan family, and
 * fills `card_features` and `card_edges`. Near-duplicate clusters and pair counts are already
 * written by the meta step.
 */
export function syncFeatures(db: Db, log: Log): void {
  writeSyncState(db, 'features', { implemented: false });
  log('features skipped: the features engine is not implemented yet (plan Task 5)');
}
