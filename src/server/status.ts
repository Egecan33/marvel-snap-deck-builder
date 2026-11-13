import { readdirSync } from 'node:fs';
import { corpusOf } from '@/engine/novelty/clusters';
import { isCheckedFormat } from '@/engine/rules/formats';
import type { StatusResponse } from './api-types';
import { getDb, loadCardDb } from './carddb';
import { readSyncState } from './db';
import { imageDir } from './images';
import { SYNC_STEPS } from './sync-runner';

const count = (sql: string): number => (getDb().prepare(sql).get() as { n: number }).n;

function imagesOnDisk(): number {
  try {
    return readdirSync(imageDir()).filter((f) => f.endsWith('.webp')).length;
  } catch {
    return 0;
  }
}

/** GET /api/status: what the Data page shows (spec §16) and what the UI needs to decide on first run. */
export function status(): StatusResponse {
  const db = loadCardDb();
  const all = db.all();
  const byClass = { released: 0, upcoming: 0, token: 0 };
  for (const c of all) byClass[c.cardClass] += 1;
  const sync: StatusResponse['sync'] = {};
  for (const step of SYNC_STEPS) sync[step] = readSyncState(getDb(), step);
  const corpus = corpusOf(db);
  const coverage = sync.features?.info.coverage;
  return {
    empty: byClass.released === 0,
    counts: {
      cards: all.length, released: byClass.released, upcoming: byClass.upcoming, tokens: byClass.token,
      features: count('SELECT COUNT(*) AS n FROM card_features'),
      edges: count('SELECT COUNT(*) AS n FROM card_edges'),
      strongEdges: db.released().reduce((s, c) => s + db.edges(c.defId).filter((e) => e.strong && e.a === c.defId).length, 0),
      locations: count('SELECT COUNT(*) AS n FROM locations'),
      decks: count('SELECT COUNT(*) AS n FROM decks'),
      owned: count('SELECT COUNT(*) AS n FROM collection'),
      images: imagesOnDisk(),
    },
    sync,
    meta: db.meta().info(),
    corpus: { lists: corpus.lists, clusters: corpus.clusters, archetypes: db.meta().archetypes().length, withheld: corpus.withheld },
    coverage: coverage && typeof coverage === 'object' ? (coverage as Record<string, unknown>) : null,
    formats: db.formats().map((f) => ({ ...f, checked: isCheckedFormat(f) })),
  };
}
