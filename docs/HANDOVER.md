# Hand-over notes between stages

Facts about the code and data that a later task needs and the plan does not state. Append a section per stage; keep it short.

## After Stage 2 (Tasks 1-2, commits 3565bb3 and a46c3de)

Measured on 2026-11-12, game build 58.15.3: 791 card rows = 511 released, 31 upcoming, 249 token/other; 230 locations; meta period 137 with 4,763 lists in 2,810 clusters, 345,061 games, baseline win rate 57.7%, 48 archetypes (1,323 lists unlabelled), 11,134 stored pairs; 598 images on disk (22 rows have no art on the host: 3 tokens and 19 upcoming).

- **Card rows.** The `cards` table and `tests/fixtures/cards.json` hold raw Untapped rows; class is computed at load from `now`. `toCard(row, now, fixes?)`. The fixture's default `now` is its `capturedAt`. Helper exports: `fixtureDb(now?)`, `fixtureRows()`, `fixtureColliders()`, `textFixes()`, `deckNames()`, `deckText()`, `resetFixtureDb()`.
- **Class trap.** A `collectible` row with `series: 0` (ElderDragonOfTheMoon) becomes `token`, not `released`, once its date passes unless cards are re-synced. For "upcoming, then legal" tests use a recently released card with an earlier `now`.
- **Text shape.** `Header: body` with straight quotes. Objective cards read `Objective: goal -> reward. (0/N)`. Flavour-only text is `''`. Upcoming rows can have junk placeholder text. 25 rows get their dropped numbers from `sync-data/card-text-fixes.json`.
- **Names.** `byName` uses a letters-and-digits key (`normalizeName`). No two released cards collide; 24 non-released rows collide with a released name. Display names can differ a lot from defIds ("Doctor Doom 2099" is `Doom2099`).
- **Meta.** `MetaList.cards` is sorted by defId and `key` is that joined with `|`; lists are ordered by games descending. `MetaArchetype.sample` is the most-played list, `topCards` up to 16 from the manifest, `planId` null until the features step sets it. `winDelta` is null under 200 games. Pair counts and clusters are written by the meta step.
- **Reference decks** (`tests/fixtures/decks/`: fantomex, kluh, magneto, zombie, arthur, patriot) use the site block: `# (cost) Name` lines, `#`, a short code, `#`, a comment. The short code was produced by a small encoder in `src/ingest/fixtures.ts`; Task 3 must cross-check it against its port of `docs/research/analysis/deckcode/deckcode.mjs`.
- **Features hook.** `fixtureHooks.compute` in `tests/helpers/fixture-db.ts` is null, so `features()` is undefined and `edges()` empty. Task 5 sets it and calls `resetFixtureDb()`. `src/ingest/features.ts` is a stub.
- **Sync.** Images download serially, 1 s apart. `pnpm sync meta` refuses within 6 h of the last run unless `--force`.

## After Task 3 (rules and import/export)

72 tests in `tests/engine/{rules,io}.test.ts`; suite 142 tests.

- **Exports beyond the plan.** `rules/formats.ts`: `RANKED`, `findFormat(db, id)`, `isCheckedFormat(fmt)` (verified and constructed), `formatName(db, id)`. `io/deckcode.ts`: `shortCardCode(defId)`, `DECK_CODE_TOKEN`. `io/resolve.ts`: `tidy`, `candidates`, `lookup`, `resolveLine`, `rejectReason`, `LIST_LINE` (shared line reading; use these for any name search).
- **Unverified modes.** `validateDeck` gives `MODE_UNVERIFIED` (warning) and checks Ranked rules only; `isLegal` can still be true. The UI must call `isCheckedFormat(findFormat(db, deck.format))` before claiming a pass for the mode itself. Draft gives only `MODE_NOT_CONSTRUCTED` (info). An unknown format id is treated as unverified.
- **Extra codes.** `SKILL_CARDS` (info, one line naming the skills; no cap known). `gateFor` also returns `IN_DECK`; gate order: UNKNOWN_CARD, NOT_DECKABLE, UNRELEASED, IN_DECK, MODE_BANNED, NOT_OWNED. `NOT_DECKABLE.cardIds` holds the token plus the released cards whose `tokens` create it.
- **Not implemented:** checks 10 `STATS_STALE`, 11 `RECENTLY_CHANGED`, 13 `ROTATION_SOON`: the CardDb has no sync date or balance-change log. `UNKNOWN_CARD` says "since the card sync" without a date for the same reason.
- **Decoding.** `decodeDeckCode` keeps unknown ids as written (an unknown short piece stays a short code), accepts any card count, padding-less and URL-safe base64, and returns null for anything else (a short code needs at least one known piece). `parseDecklist`: the first code anywhere in the text wins (also embedded in a sentence) and other lines are then ignored; tokens never resolve, upcoming cards do (validation reports them); `parseCollection` owns released cards only. Collection unresolved entries are strings, decklist ones carry line numbers.
- **Export.** `exportDecklist` sorts by cost then `localeCompare(name, 'en')` and writes the short code in that order; it reproduces the six fixture blocks byte for byte. No code unless 12 different known cards; unknown ids are written `# (?) id` so re-import reports them.
- **Cross-check.** The six fixture short codes agree with the port and with `deckcode.mjs` itself (`decode` + `encodeShort`, byte-equal).
