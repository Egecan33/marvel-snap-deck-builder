import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCardDb, createMetaIndex, toCard, type UntappedCardRow } from '@/engine/carddb';
import { computeNetwork } from '@/engine/features/compute';
import type { TextFix } from '@/engine/text/clean';
import { loadOverrides, type Overrides } from '@/engine/text/overrides';
import type { Card, CardDb, CardEdge, CardFeatures, FormatDef, MetaArchetype, MetaIndex, MetaInfo, MetaList, PlanDef } from '@/engine/types';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const SYNC_DATA = fileURLToPath(new URL('../../sync-data/', import.meta.url));

interface CardFixture { capturedAt: number; build: string | null; colliders: string[]; cards: UntappedCardRow[] }
interface MetaFixture { info: MetaInfo; fullSnapshot: MetaInfo; archetypes: MetaArchetype[]; lists: MetaList[] }

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const readList = <T>(file: string): T[] => (existsSync(SYNC_DATA + file) ? readJson<T[]>(SYNC_DATA + file) : []);

let cardFixture: CardFixture | null = null;
let metaFixture: MetaFixture | null = null;
const cards = (): CardFixture => (cardFixture ??= readJson<CardFixture>(FIXTURES + 'cards.json'));
const meta = (): MetaFixture => (metaFixture ??= readJson<MetaFixture>(FIXTURES + 'meta.json'));

/** Reviewed texts for cards whose source description drops a number (sync-data/card-text-fixes.json). */
export const textFixes = (): Record<string, TextFix> =>
  existsSync(SYNC_DATA + 'card-text-fixes.json') ? readJson<Record<string, TextFix>>(SYNC_DATA + 'card-text-fixes.json') : {};

/** The clock value the fixture was captured at; the default `now` of `fixtureDb()`. */
export const fixtureNow = (): number => cards().capturedAt;
/** Raw Untapped rows of the fixture, for tests that need a field the Card type does not carry. */
export const fixtureRows = (): readonly UntappedCardRow[] => cards().cards;
/** defIds of the non-deckable rows that share a display name with a released card. */
export const fixtureColliders = (): readonly string[] => cards().colliders;

/** Reviewed clauses of sync-data/card-overrides.json, read once. */
let overridesCache: Overrides | null = null;
export const fixtureOverrides = (): Overrides =>
  (overridesCache ??= existsSync(SYNC_DATA + 'card-overrides.json') ? loadOverrides(readJson<unknown>(SYNC_DATA + 'card-overrides.json')) : {});

/**
 * Features and edges are not in the fixture: they are computed from it at test time by the features
 * engine (plan Task 5), with the committed overrides. Set `compute` to null for a database without them.
 */
export const fixtureHooks: {
  compute: ((input: { cards: Card[]; formats: FormatDef[]; plans: PlanDef[]; meta: MetaIndex; now: number }) => { features: CardFeatures[]; edges: CardEdge[] }) | null;
} = { compute: (input) => computeNetwork({ cards: input.cards, meta: input.meta, overrides: fixtureOverrides() }) };

const cache = new Map<number, CardDb>();

/**
 * CardDb over tests/fixtures (real synced rows and meta lists) and the committed sync-data files.
 * Card classes are computed for `now`, which defaults to the moment the fixture was captured.
 */
export function fixtureDb(now: number = fixtureNow()): CardDb {
  const hit = cache.get(now);
  if (hit) return hit;
  const m = meta();
  const fixes = textFixes();
  const input = {
    cards: cards().cards.map((row) => toCard(row, now, fixes)),
    formats: readList<FormatDef>('formats.json'),
    plans: readList<PlanDef>('plans.json'),
    meta: createMetaIndex(m.info, m.lists, m.archetypes),
    now,
  };
  const computed = fixtureHooks.compute ? fixtureHooks.compute(input) : { features: [], edges: [] };
  const db = createCardDb({ ...input, ...computed });
  cache.set(now, db);
  return db;
}

/** Forget cached databases (after changing `fixtureHooks`). */
export function resetFixtureDb(): void {
  cache.clear();
}

/** Fixture card by display name or defId. Throws when the fixture lacks it. */
export function card(nameOrId: string): Card {
  const db = fixtureDb();
  const c = db.get(nameOrId) ?? db.byName(nameOrId);
  if (!c) throw new Error(`fixture card not found: ${nameOrId}`);
  return c;
}

/** Names (without .txt) of the reference decklists in tests/fixtures/decks. */
export function deckNames(): string[] {
  return readdirSync(FIXTURES + 'decks').filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
}

/** Raw text of tests/fixtures/decks/<name>.txt. */
export function deckText(name: string): string {
  return readFileSync(`${FIXTURES}decks/${name}.txt`, 'utf8');
}
