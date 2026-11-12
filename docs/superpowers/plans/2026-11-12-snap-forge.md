# Snap Forge Implementation Plan

> **For agentic workers:** execute task by task. Steps use checkbox (`- [ ]`) syntax. Read the spec section and research sections named in each task before starting it. Write the tests of a task before its implementation.

**Goal:** a local web app that brews, builds, scores, rates, improves and theorycrafts Marvel Snap decks, with measurable novelty and a power floor, and card images on disk.

**Architecture:** one Next.js process. A pure TypeScript engine (`src/engine`, no IO) over an in-memory card database. Ingest CLIs load Untapped card and meta JSON into SQLite and download images. Card understanding is a text parser with a reviewed overrides file; everything else (network, plans, scores, novelty, builder, lines) is computed from its output and the synced meta lists.

**Tech stack:** Node 22, pnpm, Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, better-sqlite3, Vitest, Playwright, tsx. Same dependency versions as `~/github_repositories/commander-forge/package.json`.

**Spec:** `docs/superpowers/specs/2026-11-12-snap-forge-design.md`. Research: `docs/research/*.md` (read the verification log at the end of a file before relying on it).

## Global constraints

- Repo: `~/github_repositories/snap-forge`. Never modify any other repository. Read-only references: `~/github_repositories/commander-forge` (copy and adapt infrastructure and UI structure from it), `~/github_repositories/riftbound-forge` (do not touch; another session is building it).
- `AGENTS.md` hard rules apply: no game fact from memory; lists in `sync-data/` or synced data, not code; no score without reasons; heuristics labelled in code comments and UI; no card data or images in git except test fixtures.
- `src/engine/**` imports nothing from Node, Next, React or `src/server`. No `Date.now()` or `Math.random()` inside the engine: time and seeds are parameters.
- Shared types live in `src/engine/types.ts` exactly as in Task 1. Add a field there first and say so in the commit message.
- Card ids are Untapped `defId` strings everywhere (`ShangChi`). Display names are never keys.
- HTTP: `User-Agent: SnapForge/0.1`, serial per host, ≥ 2 s apart on `api.snap.untapped.gg`, no cookies, no personal data. Do not fetch `marvelsnapzone.com/getinfo` or `/msz-api` (robots.txt disallows), and do not work around Cloudflare blocks.
- Images: `data/images/{defId}.webp`. `data/` is gitignored. Fixtures are committed under `tests/fixtures/`.
- English UI. Desktop. Every card shown as an image, with cost and power drawn by the UI.
- Port 3230.
- Each task ends with `pnpm typecheck && pnpm test` green and one commit staging only that task's paths (never `git add -A`; other agents may be working in the same checkout). Trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. No push (local repo). Update the stage table in `docs/STATUS.md` when a stage finishes.

## Review focus

1. **Name collisions.** Mode copies, tokens and augments share display names with released cards (`data §1.1`). Any lookup by name (import, collection, search) must resolve to the released card, and never put a non-deckable row in a deck. → Tasks 2, 3.
2. **Wrong effect targets.** The research parser mis-attached the target on 15% of cards (own vs enemy, here vs anywhere). A destroy-enemy card read as destroy-own creates false synergy edges. → Tasks 4, 5 (audit fixtures).
3. **Partial and odd decks.** 0 cards, 5 cards, 13 cards, a deck of twelve 6-drops, a deck holding a card that left the pool after a sync: every engine function returns sane values, never throws, never divides by zero, never returns NaN. → Tasks 3, 6, 7, 8, 9.
4. **Thin or missing meta.** No meta snapshot synced yet, or fewer than 300 lists: novelty still computes from what exists, "unexplored" claims are withheld, UI says why; nothing crashes. → Tasks 7, 8, 10, 11.
5. **Messy imports.** Long and short deck codes, codes wrapped in the "# (1) Card" comment block sites add, lists with `(cost) Name` or `1x Name`, curly apostrophes, unknown or unreleased cards, 11 or 13 cards. Unresolved lines are reported, never dropped silently. → Task 3.
6. **Brew that cheats the objective.** Annealing will exploit whatever the edge scores overrate (broad heuristic axes, rare weak cards). The floor, the ablation test and the "rare card needs a strong edge" rule are what stop it. → Tasks 5, 7, 8.

## File map

```
src/engine/types.ts               contract (Task 1)
src/engine/carddb.ts              in-memory CardDb (Task 2)
src/engine/rules/                 validate.ts, formats.ts (Task 3)
src/engine/io/                    decklist.ts, deckcode.ts, collection.ts (Task 3)
src/engine/text/                  clean.ts, parse.ts, vocab.ts, overrides.ts, coverage.ts (Task 4)
src/engine/features/              traits.ts, axes.ts, tech.ts, quality.ts, compute.ts (Task 5)
src/engine/network/               rules.ts, templates.ts, edges.ts (Task 5)
src/engine/maths/                 rng.ts, hypergeo.ts, energy.ts (Task 6)
src/engine/plans/                 detect.ts (Task 6)
src/engine/scoring/               scorer.ts (Task 7)
src/engine/rating/                rate.ts (Task 7)
src/engine/novelty/               novelty.ts, gems.ts, clusters.ts (Task 7)
src/engine/builder/               floor.ts, pool.ts, search.ts, build.ts, improve.ts (Task 8)
src/engine/lines/                 lines.ts (Task 9)
src/ingest/                       http.ts, cards.ts, locations.ts, images.ts, meta.ts, features.ts, fixtures.ts, sync.ts
src/server/                       db.ts, carddb.ts, decks.ts, collection.ts, settings.ts, context.ts, sync-runner.ts, images.ts
src/app/api/**  src/app/**
sync-data/                        formats.json, card-overrides.json, plans.json
tests/fixtures/                   cards.json, meta.json, clause-audit.json, edge-audit.json, decks/*.txt
tests/helpers/fixture-db.ts
tests/engine/**  tests/server/**  tests/e2e/**
```

---

## Stage 2 — foundation and data

### Task 1: Scaffold and contract

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`, `pnpm-workspace.yaml`, `src/app/layout.tsx`, `src/app/page.tsx` (placeholder), `src/app/globals.css`, `src/engine/types.ts`, `tests/engine/smoke.test.ts`.

- [ ] Create the Next.js + TypeScript + Tailwind app in the repo root by copying Commander Forge's config files and adapting names (existing `docs/`, `README.md`, `AGENTS.md`, `.gitignore` stay). Scripts: `dev`, `build`, `start` (port 3230), `typecheck`, `test` (`vitest run`), `e2e`, `sync` (`tsx src/ingest/sync.ts`). Alias `@/*` → `src/*`. `better-sqlite3` in `serverExternalPackages`.
- [ ] Write `src/engine/types.ts` exactly:

```ts
export type CardClass = 'released' | 'upcoming' | 'token';
export type FormatId = string;            // 'ranked', 'sanctum-showdown', ...
export type AxisId = string;              // 'destroy', 'discard', 'move', ... (mechanics §3)
export type TechRole = string;            // 'ongoing-removal', 'power-reset', ... (spec §8.2)
export type Provenance = 'measured' | 'derived' | 'heuristic';

export interface Card {
  defId: string;                 // Untapped defId, primary key
  name: string;
  cost: number;
  power: number;
  text: string;                  // markup removed; '' for no-ability cards
  rawText: string;               // source description
  hasAbility: boolean;
  isSkill: boolean;
  isSeasonPass: boolean;
  series: number;                // Untapped series number (data §1.1)
  seriesLabel: string;           // 'Series 3', 'Series 5', 'Starter', ...
  releaseAt: number | null;      // epoch ms of first availability; null = always available
  cardClass: CardClass;          // computed from the clock at load
  tokens: string[];              // defIds this card creates (Card_Token)
  attributes: Record<string, number>; // attributes.data numbers
}

export interface Effect {
  kind: string;                  // mechanics §2 effect kinds
  target: string;                // mechanics §2 targets
  magnitude: number | null;
  selectors: string[];
}
export interface Clause {
  trigger: string;               // 'on_reveal', 'ongoing', 'activate', 'end_of_turn', 'static', ...
  effects: Effect[];
  conditions: string[];
  scaling: string[];
  notes: string[];
  text: string;                  // the sentence(s) this clause came from
  source: 'parser' | 'override';
  complete: boolean;             // every token consumed
}

export interface CardFeatures {
  defId: string;
  clauses: Clause[];
  unparsed: string[];
  traits: string[];
  axes: Record<AxisId, { e: number; p: number; heuristic: boolean }>; // sparse, strengths in [0,1]
  techRoles: TechRole[];
  drawback: boolean;
  restriction: string | null;    // play restriction in words, or null
  model: { extraSeen: number; extraEnergy: number; selfDiscount: number; deckDilution: number };
  quality: number;               // 0..100, heuristic
  qualityParts: { stat: number; text: number; measured: number };
}

export interface EdgeReason { rule: string; kind: 'synergy' | 'anti'; label: string; detail: string; value: number; heuristic: boolean }
export interface CardEdge { a: string; b: string; synergy: number; anti: number; score: number; strong: boolean; sameLocation: boolean; reasons: EdgeReason[] }

export interface FormatDef {
  id: FormatId; name: string; verified: boolean; constructed: boolean;
  banned: string[];              // defIds
  listDate: string | null; sourceUrl: string | null; stale: boolean; note: string;
}

export interface PlanDef {
  id: string; name: string;
  enablerTraits: string[]; payoffTraits: string[];
  minEnablers: number; minPayoffs: number;
  keyTurn: number;               // turn the plan comes online
  takesLocations: string;        // template with {enablers} {payoffs}
  foldsTo: TechRole[];
  payoffWeight: number;          // heuristic
}

export interface MetaInfo {
  source: string; periodId: number | null; periodLabel: string | null; periodStart: string | null;
  fetchedAt: string; lists: number; clusters: number; games: number;
  baselineWinRate: number; minGamesPerList: number;
}
export interface MetaList { key: string; cards: string[]; archetypeId: number | null; games: number; wins: number; cluster: number }
export interface MetaArchetype { id: number; name: string; games: number; wins: number; share: number; topCards: string[]; sample: string[]; planId: string | null }
export interface MetaCardStat { lists: number; listShare: number; clusterShare: number; games: number; winDelta: number | null }
export interface MetaPairStat { lists: number; clusters: number }
export interface MetaIndex {
  info(): MetaInfo | null;
  lists(): readonly MetaList[];
  listsWith(defId: string): readonly number[];      // indexes into lists()
  cardStat(defId: string): MetaCardStat | undefined;
  pair(a: string, b: string): MetaPairStat;          // zeros when unseen
  archetypes(): readonly MetaArchetype[];
}

export interface CardDb {
  now: number;                                       // epoch ms the classes were computed for
  get(defId: string): Card | undefined;
  byName(name: string): Card | undefined;            // case/diacritic/apostrophe-insensitive; prefers released
  released(): readonly Card[];
  all(): readonly Card[];
  features(defId: string): CardFeatures | undefined;
  edges(defId: string): readonly CardEdge[];
  edge(a: string, b: string): CardEdge | undefined;
  formats(): readonly FormatDef[];
  plans(): readonly PlanDef[];
  meta(): MetaIndex;
}

export interface DeckCard { defId: string; locked: boolean }
export interface Deck {
  id: string | null; name: string;
  format: FormatId;
  cards: DeckCard[];
  themes: AxisId[];
  buildMode: 'brew' | 'tuned';
}

export interface Violation { code: string; severity: 'error' | 'warning' | 'info'; message: string; cardIds: string[]; heuristic: boolean }

export interface EnergyReport {
  expectedSpent: number;          // of 21
  pNoPlay: number[];              // index 1..6
  likelyPlays: string[][];        // index 1..6, defIds
  curve: number[];                // cards at cost 0..7 (7 = 7+)
  avgCost: number;
}

export interface PlanMatch {
  planId: string; name: string; strength: number;   // 0..1
  enablers: string[]; payoffs: string[];
  assembly: number; keyTurn: number;
  singleCardDependence: string | null;
  takesLocations: string;
  foldsTo: { role: TechRole; cards: string[]; fieldShare: number | null }[];
}
export interface PlanReport { primary: PlanMatch | null; secondary: PlanMatch | null; all: PlanMatch[]; offPlan: string[] }

export interface ScorePart { key: 'synergy' | 'quality' | 'plan' | 'energy' | 'meta' | 'novelty' | 'tech'; points: number; max: number }
export interface CardScore {
  defId: string; score: number;   // 0..100 integer
  parts: ScorePart[]; reasons: string[];
  partners: { defId: string; score: number; reason: string }[];
  gate: { code: string; message: string } | null;
}

export interface Fix { text: string; filter: { axis?: AxisId; techRole?: TechRole; maxCost?: number; minCost?: number } | null }
export interface SubScore { key: string; label: string; weight: number; value: number; fixes: Fix[]; provenance: Provenance }
export interface DeckRating { rating: number; legal: boolean; complete: boolean; subscores: SubScore[]; violations: Violation[] }

export interface NearList { key: string; shared: number; archetype: string | null; games: number; cards: string[] }
export interface PairEvidence { a: string; b: string; strength: number; observed: number; expected: number; unexplored: number; liftSmoothed: number; warning: string | null }
export interface NoveltyReport {
  novelty: number;                // 0..100
  band: 'meta' | 'variant' | 'off-meta' | 'brew';
  parts: { listDistance: number; connectedRarity: number; packageNovelty: number };
  nearest: NearList[];            // up to 3
  rareCards: { defId: string; listShare: number; connected: boolean; isNew: boolean }[];
  pairs: PairEvidence[];
  corpus: MetaInfo | null;
  claimsWithheld: string | null;  // why "unexplored" is not claimed, when the corpus is thin
}
export interface Gem { cards: string[]; gem: number; strength: number; unexplored: number; reason: string; observed: number; expected: number; warning: string | null }

export interface FloorCheck { key: string; label: string; value: number; threshold: number; passed: boolean; detail: string; provenance: Provenance }
export interface FloorReport { passed: boolean; checks: FloorCheck[] }

export interface Line { kind: 'turn' | 'assembly' | 'sequence' | 'location' | 'package' | 'one-away' | 'field' | 'tech' | 'risk'; text: string; cardIds: string[]; reason: string; probability: number | null; provenance: Provenance }
export interface LineReport { turns: Line[]; assembly: Line[]; sequencing: Line[]; locations: Line[]; packages: Line[]; oneAway: Line[]; field: Line[]; tech: Line[]; risks: Line[] }

export interface Prompts {
  maxPlayRate: number | null;     // list share ceiling, e.g. 0.05
  techExempt: boolean;
  maxShared: number | null;       // max cards shared with any known list
  wildcards: number;              // slots filled by gem score
  maxSeries: number | null;
  avoid: string[];                // defIds
  surprise: boolean;
}
export interface BuildOptions { mode: 'brew' | 'tuned'; seed: number; owned: Record<string, true> | null; prompts: Prompts; count: number }
export interface PickReason { defId: string; interaction: string; unusual: string; replaces: string; risk: string }
export interface BrewResult { deck: Deck; rating: number; novelty: NoveltyReport; floor: FloorReport; plan: PlanMatch | null; why: string; picks: PickReason[] }
export interface BuildOutcome { results: BrewResult[]; refused: string | null }
export interface SwapProposal { out: string; in: string; reason: string; ratingBefore: number; ratingAfter: number; noveltyBefore: number; noveltyAfter: number }

export interface EngineContext { db: CardDb; owned: Record<string, true> | null }
```

- [ ] `tests/engine/smoke.test.ts` imports a type and asserts `1 + 1 === 2`. `pnpm typecheck && pnpm test`. Commit.

### Task 2: Data ingest, database, fixtures

**Spec:** §6. **Research:** `data §1-§3, §6`, `meta §2.1, §4, §5`.

**Files:** `src/ingest/*`, `src/server/{db,carddb,images,sync-runner}.ts`, `src/engine/carddb.ts`, `src/engine/text/clean.ts`, `sync-data/formats.json`, `tests/fixtures/*`, `tests/helpers/fixture-db.ts`, `tests/engine/{carddb,clean}.test.ts`, `tests/ingest/meta.test.ts`.

**Produces:** `openDb(path?)` with the tables of spec §6.3; `cleanText(description): string` (markup removed, bold keyword headers kept as `On Reveal: ...`, flavour-only text → `''`); `toCard(row, now): Card`; `classOf(row, now): CardClass`; `createCardDb(input: { cards, features, edges, formats, plans, meta, now }): CardDb` (pure); `createMetaIndex(info, lists, archetypes): MetaIndex` (derives card stats, pair counts and `listsWith`); `clusterLists(lists): number[]` (near-duplicate clusters: lists sharing ≥ 11 cards, union-find); `loadCardDb(db)` cached with `invalidateCardDb()`; CLI steps `cards`, `locations`, `images` (`--limit N`), `meta`, `features` (stub until Task 5), each writing `sync_state` and printing progress; `fixtureDb(now?)`.

- [ ] Tests on inline Untapped-shaped rows: released rule (`collectible && series > 0 && min start ≤ now`); a row with `collectible: true`, `series: 0` and a future date is `upcoming`; a `*Champion` copy is `token`; class changes when `now` passes the start date; `-62135596800000` → `releaseAt: null`; `cleanText` strips `<b>`, `<i>`, `<color>`, `<sprite>`, joins `\n`, returns `''` for italic-only flavour; `byName` prefers the released card over a same-named token and accepts wrong case and curly apostrophes; `tokens` filled from `Card_Token`.
- [ ] Meta decode test on an inline response-shaped sample: rows are indexes into that response's own `d_map`; a row with a duplicate index or ≠ 12 cards is rejected; `clusterLists` puts two lists sharing 11 cards in one cluster; `pair()` returns zeros for an unseen pair; `cardStat().winDelta` is relative to the snapshot baseline and `null` under 200 games.
- [ ] **Dropped numbers** (`data §1.1`, "Trap found in verification"): Untapped's `description` omits dynamic numbers in at least 24 released rows ("cost  from your deck", "(/6)", "a random -Cost or more card"). `sync-data/card-text-fixes.json` maps `defId → { rawText, text }`: the complete text, reviewed against the value in `attributes.data` or an official post, applied by `toCard` only while the row's `description` still equals `rawText`. `findTextHoles(cards): string[]` detects the patterns (double space inside a sentence, `(/N)`, `(+)`, ` -Cost`, `cost  `); a test fails when a released fixture card has a hole and no valid fix. A fix that cannot be verified is left out and the card listed in the commit message; never guess a number.
- [ ] Copy and adapt `http.ts`, `images.ts`, `sync.ts`, `db.ts`, `sync-runner.ts`, `images.ts` (server) from Commander Forge.
- [ ] `sync-data/formats.json` from `rules §1.2`: `ranked` (verified, no bans), `sanctum-showdown` (launch list as defIds resolved against synced cards, `stale: true`, source URL and date), and `high-voltage`, `grand-arena`, `team-clash`, `deadpools-diner` as `verified: false`; `draft` as `constructed: false`.
- [ ] `cards`, `locations`, `images`, `meta` steps per spec §6.1 and `meta §4`. Reuse `docs/research/analysis/meta/fetch-sample.mjs` logic for decoding.
- [ ] `fixtures`: after a real sync, write `tests/fixtures/cards.json` with every released card row (the pool is small: about 511 rows, text only, no images) plus the tokens they reference and 20 non-deckable name-colliding rows; `tests/fixtures/meta.json` with the 300 most-played lists, their archetypes and the snapshot info; six reference decklists in `tests/fixtures/decks/` taken from the most-played lists of six different archetypes.
- [ ] Run the real sync: cards, locations, meta, all images. Record counts in the commit message (released, upcoming, token, images on disk, lists, clusters, games). Commit code, sync-data and fixtures.

---

## Stage 3 — engine

### Task 3: Rules and import/export

**Spec:** §7, §16 import/export. **Research:** `rules §1, §5`, `data §4, §5`.

**Files:** `src/engine/rules/*`, `src/engine/io/*`, `tests/engine/{rules,io}.test.ts`.

**Produces:**
```ts
validateDeck(deck: Deck, db: CardDb, owned?: Record<string, true> | null): Violation[]   // codes of rules §5; checks 14-15 are added by Task 6/7 callers, not here
isLegal(violations: Violation[]): boolean                                             // no 'error'
gateFor(card: Card, deck: Deck, db: CardDb, owned: Record<string, true> | null): { code: string; message: string } | null
parseDecklist(text: string, db: CardDb): { cards: string[]; unresolved: { line: number; text: string }[]; name: string | null }
decodeDeckCode(code: string, db: CardDb): { cards: string[]; name: string | null; format: 'long' | 'short' } | null
encodeDeckCode(cards: string[], name: string, format: 'long' | 'short'): string
exportDecklist(deck: Deck, db: CardDb): string        // "# (cost) Name" lines + code, like sites show
parseCollection(input: string, db: CardDb): { owned: string[]; unresolved: string[]; kind: 'state-file' | 'deck-codes' | 'list' }
```
Port `docs/research/analysis/deckcode/deckcode.mjs` for both code formats (short code: defId minus lowercase `aeiouy` plus length in uppercase hex; decoding needs the card table).

- [ ] Rules tests, one per check 1-9 and 12 of `rules §5`, on fixture cards, plus: empty deck, 13 cards, a token in the deck, an upcoming card (and the same card legal when `now` is after its date), a Sanctum Showdown banned card legal in `ranked`, an unverified mode gives `MODE_UNVERIFIED` and no pass claim, a deck with skills yields one info line.
- [ ] IO tests: every Review focus 5 input; long and short round trips for the six reference decks; `parseDecklist` finds a code embedded in a pasted block; `parseCollection` reads `{ServerState:{Cards:[{CardDefId}]}}`, a list of names, and several deck codes; name-colliding token never resolved.
- [ ] Implement. Commit.

### Task 4: Card-text parser

**Spec:** §8.1. **Research:** `mechanics §1, §2, §5`; prototype `docs/research/analysis/mechanics/parse_cards.py` and its `out/` JSON (local, gitignored: regenerate by running the scripts if missing).

**Files:** `src/engine/text/{vocab,parse,overrides,coverage}.ts`, `sync-data/card-overrides.json`, `tests/fixtures/clause-audit.json`, `tests/engine/text/*.test.ts`.

**Produces:** `parseCard(card: Card): { clauses: Clause[]; unparsed: string[] }`; `applyOverrides(card, parsed, overrides): { clauses, unparsed, staleOverride: boolean }`; `coverage(cards, parsedById): { noClause: string[]; unparsed: { defId: string; text: string }[]; attributeMismatch: { defId: string; detail: string }[]; staleOverrides: string[] }`; `TRIGGERS`, `EFFECT_KINDS`, `TARGETS` constant lists.

- [ ] Port the prototype to TypeScript and run it on the fixture pool (Untapped text, not the prototype's source).
- [ ] Build `tests/fixtures/clause-audit.json`: at least 80 released cards with hand-verified `{trigger, kind, target}` per clause, read from the card's actual synced text: the ten cards the prototype got wrong (`mechanics §2.1`), 15 tech cards of `theory §3`, 5 per major axis (destroy, discard, move, bounce, ongoing, on-reveal, cost, energy, affliction, junk, merge), 10 chosen at random with a fixed seed. Verify each by reading the text, not by trusting the parser's output.
- [ ] Fix target attachment until the audit test passes at ≥ 95% of cards with every clause matching. Record the number in the commit message.
- [ ] `sync-data/card-overrides.json`: reviewed clauses for the cards of `mechanics §5` and `§2.2` that the parser still cannot read, each with `reviewedText`. An override whose `reviewedText` differs from the synced text is ignored and reported stale (test).
- [ ] Attribute cross-check: `AddedPower`, `ReducedCost` and similar against parsed magnitudes; list disagreements in coverage (test on three cards).
- [ ] Coverage guard test: every released fixture card has ≥ 1 clause, or `hasAbility === false`, or an override. Commit with pool coverage numbers.

### Task 5: Features and network

**Spec:** §8.2-§8.4. **Research:** `mechanics §3, §4`, `theory §1.5, §3`, `meta §5`.

**Files:** `src/engine/features/*`, `src/engine/network/*`, `src/ingest/features.ts`, `tests/fixtures/edge-audit.json`, `tests/engine/{features,network}.test.ts`.

**Produces:** `traitsOf(card, clauses): string[]`; `axesOf(card, clauses): CardFeatures['axes']`; `techRolesOf(card, clauses): TechRole[]`; `qualityOf(card, clauses, poolStats, metaStat): { quality, parts }`; `computeFeatures(card, overrides, poolStats, metaStat): CardFeatures`; `buildEdges(cards, featuresById): CardEdge[]`; `AXES: { id, label, heuristic }[]`; `TECH_ROLES: { id, label, answers: string }[]`; constant `STRONG = 0.5`.

- [ ] Axis and tech tests on named fixture cards: for each of the 32 axes one known enabler and one known payoff (take the examples of `mechanics §3` and confirm them against the synced text first); each tech card of `theory §3` gets its role; drawback and restriction flags on five cards each.
- [ ] Network rules per spec §8.3: axis rules, the pair templates of `mechanics §4.1`, heuristic axes capped below `STRONG` unless a text-derived rule also fires, `sameLocation` set for "here"-scoped amplifiers. Each reason quotes the relevant text of both cards.
- [ ] `tests/fixtures/edge-audit.json`: 60 edges sampled with a fixed seed from the strong edges, each hand-judged `true | false | lenient` by reading both texts, plus 15 known-true pairs and 15 known-unrelated pairs. Tests: known-true pairs are strong; unrelated pairs have no strong edge; anti-synergy examples of `mechanics §4.1` (own Cosmo with own On Reveal, Armor with own destroy plan, hand discard with a hand-size payoff) come out as `anti`. Report strict precision of the 60 in the commit message; iterate on rules until ≥ 85% or say plainly what it is.
- [ ] Quality: stat part from pool mean power per cost; text part from clause magnitudes (conservative for conditional effects); measured part within ±10 from `winDelta`, zero when `null`. Tests: a no-ability card with above-mean power outscores one below; quality is in 0-100 for the whole pool; no NaN without meta.
- [ ] `pnpm sync features` parses the full pool and stores features and edges; prints card, strong-edge and total-edge counts and the 30 strongest edges; under 60 s. Regenerate fixtures so `fixtureDb()` carries features and edges (computed at test time from fixture cards, not stored). Commit.

### Task 6: Maths and plans

**Spec:** §9, §10. **Research:** `theory §1.2, §1.3, §2`.

**Files:** `src/engine/maths/*`, `src/engine/plans/*`, `sync-data/plans.json`, `tests/engine/{maths,plans}.test.ts`.

**Produces:**
```ts
mulberry32(seed: number): () => number
cardsSeen(turn: number, extra?: number): number
pAtLeastOne(k: number, turn: number, extra?: number, deckSize?: number): number
pAll(k: number, turn: number, extra?: number, deckSize?: number): number
pOneOfEach(a: number, b: number, turn: number, extra?: number, deckSize?: number): number
energyModel(deck: Deck, db: CardDb, seed?: number, games?: number): EnergyReport      // cached by cost signature
detectPlans(deck: Deck, ctx: EngineContext): PlanReport
```

- [ ] Maths tests with the exact values of `theory §1.2`: specific card by turn 6 = 0.75; both of 2 = 0.5455; all of 3 = 0.3818; 2 × 2 = 0.9091; +1 seen → 0.8333 / 0.6818 / 0.5455; `pAtLeastOne(2, 1)` = 0.5758. Energy tests against `theory §1.3` within ±0.15: curve 2,4,3,2,1,0 → 20.28; 0,0,2,3,4,3 → 17.21; 6,6,0,0,0,0 → 13.50; deterministic for a seed; empty deck → 0 without throwing.
- [ ] `sync-data/plans.json`: the 18 families of `theory §2` expressed with the trait ids Task 5 actually emits (check them against `traitsOf` output, not against the research's placeholder names), fold lists as tech roles, key turns.
- [ ] Plan tests: each of the six reference decks gets a primary plan whose enablers and payoffs are in the deck; at least four different primary plans across them; assembly equals `pOneOfEach` for the counts found; a deck with one payoff and one enabler reports `singleCardDependence`; `foldsTo[].fieldShare` comes from meta card stats and is `null` without meta; twelve unrelated cards → `primary: null`.
- [ ] Commit.

### Task 7: Scoring, rating, novelty

**Spec:** §11, §12, §13. **Research:** `theory §4.2-§4.4, §5`, `meta §3, §5`.

**Files:** `src/engine/scoring/*`, `src/engine/rating/*`, `src/engine/novelty/*`, `tests/engine/{scoring,rating,novelty}.test.ts`.

**Produces:**
```ts
createScorer(deck: Deck, ctx: EngineContext): { score(card: Card): CardScore; scoreAll(filter?: (c: Card) => boolean): CardScore[] }
rateDeck(deck: Deck, ctx: EngineContext): DeckRating
noveltyOf(deck: Deck, ctx: EngineContext): NoveltyReport
wilsonUpper(k: number, n: number): number
unexplored(observedClusters: number, totalClusters: number): number
gemsFor(db: CardDb, limit?: number): Gem[]                 // all strong edges, pairs and triples, best first
gemsNear(deck: Deck, ctx: EngineContext, limit?: number): Gem[]   // gems completing with one more card
```

- [ ] Scoring tests: every gate of spec §11; a card with two strong edges into the deck outscores a similar-quality card with none by ≥ 10; an anti-synergy partner lowers the score and is named; leave-one-out equality; parts sum to score ±1; `reasons.length ≥ 1`; brew mode gives a rare card with no strong edge 0 novelty points; tuned mode uses the meta part; empty deck does not throw; `scoreAll` over the released pool under 400 ms.
- [ ] Rating tests: the calibration of spec §12 on the fixture (top-200 lists ≥ 60 at a ≥ 95% rate; 50 seeded random piles < 40); illegal deck ≤ 40; partial 5-card deck returns a rating, no NaN, `complete: false`; removing the only enabler of the primary plan lowers `plan` and adds a fix naming a replacement axis; each sub-score ≤ 3 fixes; provenance set.
- [ ] Novelty tests with the formulas of `theory §4.3-§4.4`: an exact copy of a fixture list scores < 15 and band `meta`; the same list with two swaps is `meta` or `variant` and names the original as nearest with `shared: 10`; `wilsonUpper(0, 300)` and `unexplored` reproduce 0.11 at 300 and 0.73 at 1,000 (±0.02); with no meta, `claimsWithheld` is set and nothing throws; a pile of rare unconnected cards has `connectedRarity` 0; cards released within 14 days of `db.now` are flagged `isNew`; pair evidence counts clusters, not raw lists.
- [ ] Commit.

### Task 8: Builder

**Spec:** §14. **Research:** `theory §4.5-§4.8`.

**Files:** `src/engine/builder/*`, `tests/engine/builder.test.ts`.

**Produces:**
```ts
FLOOR: Record<string, number>                               // thresholds of spec §14, heuristic
checkFloor(deck: Deck, ctx: EngineContext, buildAround?: string[]): FloorReport
build(deck: Deck, ctx: EngineContext, opts: BuildOptions): BuildOutcome       // keeps locked cards
fillRest(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck
suggestSwaps(deck: Deck, ctx: EngineContext, opts: BuildOptions, direction: 'stronger' | 'more-original', count?: number): SwapProposal[]
improveDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, direction: 'stronger' | 'more-original', max?: number): SwapProposal[]
applySwaps(deck: Deck, swaps: SwapProposal[]): Deck
explainPicks(deck: Deck, ctx: EngineContext): PickReason[]
DEFAULT_PROMPTS: Prompts
```
Search per spec §14: candidate pool → greedy → seeded annealing with penalties → archive by primary plan × curve shape (avg cost < 2.6, 2.6-3.3, > 3.3). Incremental evaluation; the energy model is consulted from its cache.

- [ ] Floor tests (`theory §4.8`): ≥ 95% of the top-200 fixture lists pass; 50 seeded random piles all fail; one package plus eight unrelated cards fails the synergy check; every check reports value and threshold.
- [ ] Brew property test of spec §17: 20 build-around cards drawn with a fixed seed from released cards under 1% list share → each outcome is either `refused` with a reason, or results that are legal, pass the floor, contain the card, have novelty ≥ 60 and `picks` naming ≥ 3 partners of the card. At least 12 of the 20 must produce a deck; print the table of card → novelty / rating / plan / refusal in the test output.
- [ ] Ablation: for each produced brew, removing the build-around card lowers the primary plan strength or the synergy sub-score; if neither, the test fails.
- [ ] Tuned mode: build around a top archetype's core cards returns a deck rating ≥ 65. Same seed → same decks; different seed → different. `prompts.maxPlayRate`, `maxShared`, `avoid`, owned-only and `maxSeries` are each respected (one test each). `count: 6` returns decks from different archive cells. `surprise` works with an empty deck.
- [ ] Improve: a reference deck with three cards replaced by weak unrelated ones gets ≥ 2 `stronger` proposals each raising the rating; `more-original` proposals never lower the rating by more than 1 and never fail the floor; locked cards are never cut.
- [ ] Each `build` call under 3 s on the fixture pool (timing test with a generous CI margin of 6 s). Commit.

### Task 9: Lines

**Spec:** §15. **Research:** `theory §2, §3`, `mechanics §1.4`.

**Files:** `src/engine/lines/*`, `tests/engine/lines.test.ts`.

**Produces:** `generateLines(deck: Deck, ctx: EngineContext): LineReport`.

- [ ] Tests: every `Line.cardIds` is non-empty and ⊆ deck (field and tech lines may also name cards outside it); six reference decks of different archetypes share < 15% of line texts pairwise; turn lines exist for turns 1-6 with probabilities in [0, 1]; assembly odds change when a redundant piece is removed; sequencing lines come out for a known amplifier + carrier pair with `sameLocation`; field lines name the top archetypes from fixture meta with their share; with no meta, `field` and `tech` are empty and nothing throws; provenance set on every line; partial decks do not throw.
- [ ] Commit.

---

## Stage 4 — API and UI

### Task 10: Server and API

**Spec:** §6.3, §16. **Files:** `src/server/*`, `src/app/api/**/route.ts`, `tests/server/api.test.ts`.

Routes (JSON): `GET /api/status` (counts, sync state, meta info, coverage report, formats); `POST/GET /api/sync`; `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/[id]`; `POST /api/analyze {deck}` → `{ rating, novelty, floor, plans, energy, lines, deckScores, violations }`; `POST /api/cards {deck, q, filters, sort, page, pageSize}` → scored cards, gated last; `GET /api/card/[id]?deck=` → card, features, top partners, play rate; `POST /api/build {deck, options}` → `BuildOutcome`; `POST /api/improve {deck, direction, options}`; `GET /api/gems?q&limit`; `POST /api/import`, `POST /api/export`; `GET/POST/DELETE /api/collection` (import box input and per-series toggles); `GET/PUT /api/settings`; `GET /api/img/[file]` with a one-year cache header and an SVG placeholder on 404.

- [ ] Tests against a temp SQLite seeded from fixtures: analyze returns every block; `/api/cards` filter by axis and by play-rate ceiling; build returns floor-passing decks; import of a deck code → save → load round trip; collection import then owned-only build uses only owned cards; image path traversal → 400; everything works with an empty meta table.
- [ ] Commit.

### Task 11: UI

**Spec:** §16. Use the `frontend-design` skill. Commander Forge's UI (`~/github_repositories/commander-forge/src/app`) is the reference for structure and interaction: copy and adapt `Shell`, `VirtualGrid`, the card component and the builder layout.

- [ ] `/` decks. `/new` Brew: build-around picker, themes, mode, prompts → gallery of results → open in builder; Start empty; Import.
- [ ] `/deck/[id]` builder with header (rating gauge, novelty gauge and band, legal chip, 12 slots, curve), card browser, panels (Rating, Novelty, Plan, Lines, Network, Field, Improve), card overlay showing the clauses the engine read. Debounced autosave and re-analyze; optimistic edits.
- [ ] `/discover` gems. `/collection`. `/data`. First run with an empty DB redirects to `/data`.
- [ ] Every number carries its measured / derived / heuristic mark. Novelty panels show corpus source, date, list count and the tracker-bias caveat. Missing image → placeholder tile with the name, cost and power.
- [ ] Commit.

---

## Stage 5 — end to end

### Task 12: End-to-end, calibration, review

- [ ] Playwright against the real synced DB: the five flows of spec §17.
- [ ] `pnpm tsx src/ingest/calibrate.ts`: for 10 off-meta build-around cards print the brews (cards, rating, novelty, plan, floor, pick reasons) and for 5 top archetypes the tuned build; read them and fix what is plainly wrong (a brew whose "interaction" is not real is a parser or network bug: fix it there and add the pair to the audit fixture).
- [ ] Whole-branch review against the spec's goals and anti-goals by driving the real UI and reading screenshots; fix findings; `pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] `README.md`: real getting-started, screenshots, what is measured and what is heuristic. `docs/STATUS.md` final.

---

## Stage 7 — package and publish

### Task 13: Portable downloads and GitHub release

Owner, 2026-11-12 (relayed by the parent session): "package both like the Magic one and put them on GitHub, with everything." Do this only after Task 12 is finished and reviewed.

**Reference:** `~/github_repositories/commander-forge` `packaging/` (`assemble.mjs`, `build-sync.mjs`, `launcher.mjs`, the `.command` and `.bat` starters, `READ ME FIRST.txt`, `RELEASE_NOTES.md`), `.github/workflows/release.yml`, the `build:sync` and `package` scripts, standalone Next output (its commits 275a85b and e35f899).

- [ ] Port the packaging: portable zips for macOS arm64, macOS x64 and Windows x64 with the bundled Node binary and a double-click starter. The bundle ships code and `sync-data/` only: no card data, no images. First start opens the Data page and syncs. The data directory is decided by one function (next to the app when packaged, `./data` from source).
- [ ] Build the macOS bundle locally, unzip into a fresh folder, start it, sync, brew a deck; fix what breaks. The Windows bundle is verified by CI only; say so in the README and the release notes.
- [ ] Repository contents: `LICENSE` (MIT, copyright "Egecan33"); `AGENTS.md`; README in the style of Commander Forge's (download and downloads badges, test badge, hero screenshot, feature list, screenshot table, download and first-run steps per system including opening an unsigned app, run from source, what is heuristic, data sources); fan-project disclaimer naming Marvel and Second Dinner; card data and images stay out of git; research pushed as written, raw downloads gitignored.
- [ ] **Before the first push, confirm with the owner in this session.** Two reasons: creating a public repository is outward-facing, and the data source's terms forbid scraping without written permission and allow personal, non-commercial use only (`data-sources.md`, `meta-sources.md`), which matters more for a published tool than for a local one. State both and proceed on their yes. Also check that the commit author email is a GitHub noreply address; rewrite authorship before pushing if it is not.
- [ ] Public repository on the owner's GitHub account (Egecan33) under a searchable name such as `marvel-snap-deck-builder`, with a description and topics.
- [ ] Tag `v0.1.0`, wait for the release workflow, confirm the GitHub Release holds all three zips, download the macOS one and start it once. Update README download links.
