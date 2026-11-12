import { pathToFileURL } from 'node:url';
import { invalidateCardDb } from '@/server/carddb';
import { openDb, type Db } from '@/server/db';
import { syncCards, type Log } from './cards';
import { syncFeatures } from './features';
import { syncImages } from './images';
import { syncLocations } from './locations';
import { syncMeta } from './meta';

// Dependency order: meta validates card ids against the card table, features read everything,
// images come last because they take the longest.
export const STEPS = ['cards', 'locations', 'meta', 'features', 'images'] as const;
export type Step = (typeof STEPS)[number];

interface Flags { limit?: number; force: boolean }

export async function runStep(step: Step, db: Db, log: Log, flags: Flags = { force: false }): Promise<void> {
  switch (step) {
    case 'cards': await syncCards(db, log); break;
    case 'locations': await syncLocations(db, log); break;
    case 'meta': await syncMeta(db, log, { force: flags.force }); break;
    case 'features': syncFeatures(db, log); break;
    case 'images': await syncImages(db, log, { limit: flags.limit }); break;
  }
  invalidateCardDb();
}

export const USAGE = `Usage: sync [${STEPS.join('|')}|all]... [--limit N] [--force]`;

export function parseArgs(argv: string[]): { steps: Step[]; flags: Flags } {
  const flags: Flags = { force: false };
  const steps: Step[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw new Error('--limit needs a non-negative integer');
      flags.limit = n;
    } else if (arg === '--force') {
      flags.force = true;   // meta: ignore the once-per-6-hours limit
    } else if (arg === 'all') {
      steps.push(...STEPS);
    } else if ((STEPS as readonly string[]).includes(arg)) {
      steps.push(arg as Step);
    } else {
      throw new Error(`unknown argument "${arg}". ${USAGE}`);
    }
  }
  if (steps.length === 0) steps.push(...STEPS);
  // Run in dependency order whatever order was typed, each step once.
  return { steps: STEPS.filter((s) => steps.includes(s)), flags };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const { steps, flags } = parseArgs(args);
  const db = openDb();
  const log: Log = (line) => console.log(line);
  try {
    for (const step of steps) {
      const started = Date.now();
      await runStep(step, db, log, flags);
      log(`${step} took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
