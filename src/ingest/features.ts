import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeNetwork } from '@/engine/features/compute';
import { detectPlans } from '@/engine/plans/detect';
import { coverage, type ParsedEntry } from '@/engine/text/coverage';
import { applyOverrides, loadOverrides, type Overrides } from '@/engine/text/overrides';
import { parseCard } from '@/engine/text/parse';
import type { CardDb, CardEdge, MetaArchetype } from '@/engine/types';
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
  archetypes: { total: number; tagged: number };
  ms: number;
}

/**
 * The features step (spec §6.1, §8): parse every released and upcoming card with the reviewed
 * overrides, derive traits / axes / tech roles / quality, build the edges between released cards,
 * and replace `card_features` and `card_edges` in one transaction. Prints the coverage report and
 * the 30 strongest edges. Idempotent: a rerun gives the same tables.
 *
 * Then tags every stored meta archetype with the primary plan of its most-played list
 * (`MetaArchetype.planId`, sync-data/plans.json; null when no plan reaches the threshold).
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

  const archetypes = tagArchetypes(db, buildCardDb(db, now, opts.root));

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
    archetypes,
    ms: Date.now() - started,
  };
  writeSyncState(db, 'features', { implemented: true, ...summary });

  const name = (id: string): string => cardDb.get(id)?.name ?? id;
  log(`features: ${summary.cards} released cards, ${summary.features} with features, ${summary.edges} edges (${summary.strong} strong, ${summary.anti} net negative)`);
  log(`coverage: ${summary.coverage.noClause} cards with no clause, ${summary.coverage.unparsed} unparsed sentences, ${summary.coverage.attributeMismatch} attribute disagreements, stale overrides: ${cov.staleOverrides.join(', ') || 'none'}`);
  log(`plans: ${archetypes.tagged} of ${archetypes.total} meta archetypes tagged with a primary plan`);
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

/**
 * Sets `planId` on every stored meta archetype (all snapshots) to the primary plan that `detectPlans`
 * finds in the archetype's sample list, or null. Uses the features just written.
 */
export function tagArchetypes(db: Db, cardDb: CardDb): { total: number; tagged: number } {
  const rows = db.prepare('SELECT snapshot, id, json FROM meta_archetypes').all() as { snapshot: string; id: number; json: string }[];
  const update = db.prepare('UPDATE meta_archetypes SET json = ? WHERE snapshot = ? AND id = ?');
  let tagged = 0;
  db.transaction(() => {
    for (const r of rows) {
      const a = JSON.parse(r.json) as MetaArchetype;
      const deck = { id: null, name: a.name, format: 'ranked', cards: a.sample.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' as const };
      const planId = detectPlans(deck, { db: cardDb, owned: null }).primary?.planId ?? null;
      if (planId) tagged++;
      update.run(JSON.stringify({ ...a, planId }), r.snapshot, r.id);
    }
  })();
  return { total: rows.length, tagged };
}
