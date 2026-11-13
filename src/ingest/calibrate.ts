/**
 * Calibration read-out (plan Task 12). Prints, against the real synced database:
 *   - brews around 10 off-meta build-around cards (cards, rating, novelty, plan, floor, pick reasons);
 *   - the tuned build around the core of the 5 most-played archetypes.
 * It is a reading aid for a person, not a test: nothing here asserts a threshold.
 *
 *   pnpm tsx src/ingest/calibrate.ts [--seed N] [--count N] [Card Name ...]
 *
 * Without card names the 10 build-around cards are drawn with mulberry32(seed) from released,
 * non-skill cards whose list share is under 1% (the brew property test's "under-1% half").
 */
import { pathToFileURL } from 'node:url';
import { build } from '@/engine/builder/build';
import { DEFAULT_PROMPTS } from '@/engine/builder/pool';
import { mulberry32 } from '@/engine/maths/rng';
import type { BrewResult, CardDb, Deck, EngineContext } from '@/engine/types';
import { loadCardDb } from '@/server/carddb';

const OFF_META_SHARE = 0.01;
const DEFAULT_SEED = 20261124;

const deckOf = (locks: string[], mode: 'brew' | 'tuned'): Deck => ({
  id: null, name: 'calibrate', format: 'ranked', themes: [], buildMode: mode,
  cards: locks.map((defId) => ({ defId, locked: true })),
});

/** Off-meta build-around cards: released, not skills, list share under 1%, sampled by seed. */
export function offMetaCards(db: CardDb, n: number, seed: number): string[] {
  const pool = db.released()
    .filter((c) => !c.isSkill && (db.meta().cardStat(c.defId)?.listShare ?? 0) < OFF_META_SHARE)
    .map((c) => c.defId)
    .sort();
  const rnd = mulberry32(seed);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  return out;
}

export function describeResult(db: CardDb, r: BrewResult): string {
  const name = (id: string) => db.get(id)?.name ?? id;
  const cards = [...r.deck.cards].map((c) => db.get(c.defId)).filter((c) => c !== undefined)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'en'))
    .map((c) => `(${c.cost}) ${c.name}${r.deck.cards.find((d) => d.defId === c.defId)?.locked ? ' [lock]' : ''}`);
  const failed = r.floor.checks.filter((c) => !c.passed).map((c) => `${c.key} ${c.value}/${c.threshold}`);
  const near = r.novelty.nearest[0];
  const lines = [
    `  rating ${r.rating}, novelty ${r.novelty.novelty} (${r.novelty.band}), plan ${r.plan ? `${r.plan.name} (assembly ${(r.plan.assembly * 100).toFixed(0)}%, key turn ${r.plan.keyTurn})` : 'none'}`,
    `  floor ${r.floor.passed ? 'passed' : `FAILED: ${failed.join(', ')}`}${near ? `; nearest list shares ${near.shared} of 12` : ''}`,
    `  cards: ${cards.join(', ')}`,
    `  why: ${r.why}`,
    ...r.picks.map((p) => `   - ${name(p.defId)}: ${p.interaction} | unusual: ${p.unusual} | replaces: ${p.replaces} | risk: ${p.risk}`),
  ];
  return lines.join('\n');
}

export function runCalibration(db: CardDb, opts: { seed: number; count: number; names: string[] }): string {
  const ctx: EngineContext = { db, owned: null };
  const out: string[] = [];
  const ids = opts.names.length
    ? opts.names.map((n) => db.byName(n)?.defId ?? n)
    : offMetaCards(db, 10, opts.seed);
  out.push(`# Brews around ${ids.length} off-meta cards (seed 1, count ${opts.count})`);
  for (const id of ids) {
    const card = db.get(id);
    const share = db.meta().cardStat(id)?.listShare ?? 0;
    out.push(`\n## ${card?.name ?? id} (${card ? `${card.cost}/${card.power}` : '?'}, list share ${(share * 100).toFixed(2)}%): ${card?.text ?? ''}`);
    const t0 = performance.now();
    const res = build(deckOf([id], 'brew'), ctx, { mode: 'brew', seed: 1, count: opts.count, owned: null, prompts: { ...DEFAULT_PROMPTS } });
    const ms = Math.round(performance.now() - t0);
    if (res.refused) out.push(`  REFUSED (${ms} ms): ${res.refused}`);
    res.results.forEach((r, i) => out.push(`### result ${i + 1} (${ms} ms for the build)\n${describeResult(db, r)}`));
  }
  const archetypes = [...db.meta().archetypes()].sort((a, b) => b.games - a.games).slice(0, 5);
  out.push(`\n# Tuned builds around the core (top 4 cards) of the ${archetypes.length} most-played archetypes`);
  for (const a of archetypes) {
    const core = a.topCards.slice(0, 4).filter((id) => db.get(id));
    out.push(`\n## ${a.name} (${(a.share * 100).toFixed(1)}% of games, plan ${a.planId ?? 'untagged'}): core ${core.map((id) => db.get(id)!.name).join(', ')}`);
    const res = build(deckOf(core, 'tuned'), ctx, { mode: 'tuned', seed: 1, count: 1, owned: null, prompts: { ...DEFAULT_PROMPTS } });
    if (res.refused) out.push(`  REFUSED: ${res.refused}`);
    for (const r of res.results) {
      const sample = new Set(a.sample);
      const shared = r.deck.cards.filter((c) => sample.has(c.defId)).length;
      out.push(`${describeResult(db, r)}\n  shares ${shared} of 12 with the archetype's most-played list`);
    }
  }
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  let seed = DEFAULT_SEED;
  let count = 2;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed') seed = Number(args[++i]);
    else if (args[i] === '--count') count = Number(args[++i]);
    else names.push(args[i]!);
  }
  const db = loadCardDb();
  if (db.released().length === 0) {
    console.error('No cards in the database. Run `pnpm sync` first.');
    process.exitCode = 1;
    return;
  }
  console.log(runCalibration(db, { seed, count, names }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
