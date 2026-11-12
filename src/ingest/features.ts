import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeNetwork } from '@/engine/features/compute';
import { coverage, type ParsedEntry } from '@/engine/text/coverage';
import { applyOverrides, loadOverrides, type Overrides } from '@/engine/text/overrides';
import { parseCard } from '@/engine/text/parse';
import type { CardEdge } from '@/engine/types';
import { buildCardDb } from '@/server/carddb';
import { writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';

/** sync-data/card-overrides.json, or no overrides when the file is missing. */
export function readOverrides(root: string = process.cwd()): Overrides {
  const file = path.join(/* turbopackIgnore: true */ root, 'sync-data', 'card-overrides.json');
  return existsSync(file) ? loadOverrides(JSON.parse(readFileSync(file, 'utf8')) as unknown) : {};
}

export interface FeaturesSummary {
  cards: number; features: number; edges: number; strong: number; anti: number;
  coverage: { noClause: number; unparsed: number; attributeMismatch: number; staleOverrides: string[] };
  ms: number;
}

/**
 * The features step (spec §6.1, §8): parse every released and upcoming card with the reviewed
 * overrides, derive traits / axes / tech roles / quality, build the edges between released cards,
 * and replace `card_features` and `card_edges` in one transaction. Prints the coverage report and
 * the 30 strongest edges. Idempotent: a rerun gives the same tables.
 *
 * Not done here yet: tagging each meta archetype with its plan family needs the plan definitions
 * of Task 6 (sync-data/plans.json), so `MetaArchetype.planId` stays null.
 */
export function syncFeatures(db: Db, log: Log, opts: { now?: number; root?: string } = {}): FeaturesSummary {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const cardDb = buildCardDb(db, now, opts.root);
  const cards = cardDb.all();
  const released = cardDb.released();
  if (released.length === 0) throw new Error('no released cards in the database: run `pnpm sync cards` first');
  const overrides = readOverrides(opts.root);

  const { features, edges } = computeNetwork({ cards, meta: cardDb.meta(), overrides });

  const parsed: Record<string, ParsedEntry> = {};
  for (const c of released) parsed[c.defId] = applyOverrides(c, parseCard(c), overrides);
  const cov = coverage(released, parsed);

  const insertFeature = db.prepare('INSERT INTO card_features(def_id, json) VALUES (?, ?)');
  const insertEdge = db.prepare('INSERT INTO card_edges(a, b, score, json) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM card_features').run();
    db.prepare('DELETE FROM card_edges').run();
    for (const f of features) insertFeature.run(f.defId, JSON.stringify(f));
    for (const e of edges) insertEdge.run(e.a, e.b, e.score, JSON.stringify(e));
  })();

  const summary: FeaturesSummary = {
    cards: released.length,
    features: features.length,
    edges: edges.length,
    strong: edges.filter((e) => e.strong).length,
    anti: edges.filter((e) => e.score < 0).length,
    coverage: {
      noClause: cov.noClause.length,
      unparsed: cov.unparsed.length,
      attributeMismatch: cov.attributeMismatch.length,
      staleOverrides: cov.staleOverrides,
    },
    ms: Date.now() - started,
  };
  writeSyncState(db, 'features', { implemented: true, ...summary });

  const name = (id: string): string => cardDb.get(id)?.name ?? id;
  log(`features: ${summary.cards} released cards, ${summary.features} with features, ${summary.edges} edges (${summary.strong} strong, ${summary.anti} net negative)`);
  log(`coverage: ${summary.coverage.noClause} cards with no clause, ${summary.coverage.unparsed} unparsed sentences, ${summary.coverage.attributeMismatch} attribute disagreements, stale overrides: ${cov.staleOverrides.join(', ') || 'none'}`);
  log('30 strongest edges:');
  for (const e of strongest(edges, 30)) {
    log(`  ${e.score.toFixed(3)}  ${name(e.a)} + ${name(e.b)}  [${e.reasons.filter((r) => r.kind === 'synergy').map((r) => r.rule).join(', ')}]`);
  }
  return summary;
}

/** Highest-scoring edges first; ties by synergy, then ids, so the list is stable. */
export function strongest(edges: readonly CardEdge[], n: number): CardEdge[] {
  return [...edges].sort((x, y) => y.score - x.score || y.synergy - x.synergy || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)).slice(0, n);
}
