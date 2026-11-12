# Snap Forge — design

Date: 2026-11-12. Owner's decisions are recorded in `docs/STATUS.md`; they were given up front ("skip the brainstorming questions, decide sensibly"), so this document was not sent back for approval. Section 17 lists the calls made here that the owner can overrule.

Research this design rests on is in `docs/research/`. References look like `theory §4.3` (`deck-theory-and-creativity.md`), `mechanics §3`, `data §1.1` (`data-sources.md`), `meta §4` (`meta-sources.md`), `rules §5` (`rules-and-formats.md`). When this document and a research file disagree, this document wins; when it is silent, the research file is the spec. Each research file ends with a verification log written by an independent fact-checker; anything it marks unconfirmed is treated as unconfirmed here too.

## 1. Intent

A local, single-user web app for building Marvel Snap decks and theorycrafting with them, built the way Commander Forge and Riftbound Forge were: pure TypeScript engine, SQLite, card images on disk, Next.js UI on localhost.

The owner, in their words: "I want to make the same thing for Marvel Snap, but I want to push the deckbuilding there, so creativity is important." And later: set up collection syncing by Snap ID or similar.

The difference from the two earlier tools is the emphasis. They help build a good deck. This one must help build a **new** deck that still works: measurably far from the known meta lists, held together by real mechanical interactions, and explained.

## 2. Goals

1. **Brew** (the headline feature): from one or more build-around cards, a theme, a hidden-gem pair, or nothing ("surprise me"), produce several legal 12-card decks that maximise novelty while clearing a power floor. Each pick shows why it works, why it is unusual, what it replaces and what the risk is.
2. **Auto-build (tuned)**: the same builder with novelty switched off, for the best functioning deck around the chosen cards.
3. **Build by hand** on the same screen with live legality, per-card scores, rating and novelty. Any mix: lock some cards, fill the rest.
4. **Per-card score 0-100** relative to the current deck, with parts, partner cards and reasons.
5. **Deck rating 0-100** with sub-scores and concrete fixes, and next to it a separate **Novelty 0-100** with its evidence (nearest known lists, rare cards, unexplored pairs).
6. **Improve a list**: paste a text list or deck code, get ordered swap proposals with reasons and rating and novelty deltas, accept or reject one by one. Two directions: "make it stronger" and "make it more original without making it worse".
7. **Collection** with an owned-only mode: one credential-free import box (game state file, pasted list, deck codes) plus per-series bulk marking.
8. **Rules enforced exactly** (`rules §5`): 12 cards, no duplicates, released and deckable cards only, mode ban lists from synced data.
9. **Theorycraft**: packages and synergies in the deck and one card away; win conditions (how the deck takes two of three locations and when); a turn 1-6 energy plan with draw odds; play against the common opposing plans of the current meta; tech choices.
10. **Discover**: a browsable list of under-explored pairs and triples (strong interaction, low observed co-play), each a one-click brew seed.
11. **Images first.** Every card is an image everywhere. Works offline after sync.

## 3. Non-goals (v1)

Accounts, hosting, multi-user. AI/LLM features. A game simulator, opponent modelling or win-rate prediction. Draft mode (decks are drafted in game). Limited-time modes whose rules could not be verified (they are listed as unverified, never as legal). Variants, card art selection, prices, cube or snap advice beyond one line. Phone layout. Non-English text. Sync by logging in to a third-party site.

## 4. Anti-goals

- A deck the app calls legal that is not.
- A score, rating, novelty claim or suggestion without its reasons.
- A "creative" deck that cannot function: no brew is returned unless it passes the power floor, and the floor is tested against real meta lists (they must pass) and random piles (they must fail).
- Novelty presented as strength. Novelty measures distance and unexploredness. The UI never merges it into the rating.
- Calling a pair "unexplored" when the corpus is too small to know (`theory §4.4`).
- A card the engine does not understand passing silently. Every released card produces at least one parsed clause, is a no-ability card, or sits in the reviewed overrides file; a test fails otherwise.
- Card pool, release state, mode bans, tech tables or meta lists hardcoded in source files.
- Advice that reads the same for any deck. Lines name cards from the deck.
- A heuristic shown as if it were a rule or a measurement. Every number is labelled measured, derived or heuristic.

## 5. Stack and layout

Next.js (App Router), React, TypeScript strict, Tailwind, pnpm, Node 22, `better-sqlite3`, Vitest, Playwright, `tsx` for CLIs. Same versions as Commander Forge. Dev and start on port 3230.

```
src/engine/            pure TypeScript, no IO
  types.ts             shared contract
  carddb.ts            in-memory card database
  rules/               deck validation per mode
  text/                card-text parser: markup clean-up, clauses, overrides
  features/            traits, axes (enabler/payoff), tech roles, quality
  network/             card-to-card edges from axes and pair templates
  maths/               hypergeometric odds, energy model, seeded RNG
  plans/               win-condition families: detection, assembly odds, folds
  scoring/             per-card score
  rating/              deck rating and fixes
  novelty/             novelty score, hidden gems, nearest lists
  builder/             floor, tuned build, brew search, fill, swaps, improve
  lines/               turn plan, sequencing, packages, matchups, tech
  io/                  decklist text, deck codes, collection import
src/ingest/            sync CLIs
src/server/            SQLite repositories, analysis context
src/app/               UI and route handlers
sync-data/             reviewed data committed to git (formats, overrides)
data/                  SQLite, images, caches (gitignored)
```

Infrastructure that already exists in Commander Forge is copied and adapted, not rewritten: `src/ingest/http.ts`, `images.ts`, `sync.ts`; `src/server/db.ts`, `state.ts`, `sync-runner.ts`, `images.ts`, `settings.ts`; `src/app/components/Shell.tsx`, `VirtualGrid.tsx`, `card.tsx`; the builder page structure (`Builder`, `Browser`, `DeckView`, `Panels`). Game logic is new.

## 6. Data

### 6.1 Sources and sync

`pnpm sync [step|all]`, each step resumable and idempotent. Requests are serial per host with `User-Agent: SnapForge/0.1`, no cookies and no personal data.

| Step | Source | Notes |
|---|---|---|
| `cards` | `https://snapjson.untapped.gg/v2/latest/en/cards.json` (`data §1.1`) | Store every row. Class per row, recomputed at sync and at load because it depends on the clock: **released** = `collectible === true && series > 0 && min(seriesStartTimestamps) <= now`; **upcoming** = a start timestamp in the future; **token/other** otherwise. Text is cleaned of game markup; the keyword headers in bold are kept as structure. Skill cards carry `isSkill`. Token links come from `attributes.cards.Card_Token`. The game build number is read from the redirect and stored. |
| `locations` | `.../locations.json` | Name and text, for reference in lines. No released flag exists; locations are context only. |
| `images` | `https://snapjson.untapped.gg/art/render/framebreak/common/512/{defId}.webp` | `data/images/{defId}.webp`, 6 parallel, resume, `.part` then rename. About 25 MB for the released pool. Cost and power are not drawn on this art, so the UI draws them. Released and upcoming cards plus referenced tokens. |
| `meta` | Untapped analytics JSON (`meta §4`, steps 1-8) | Current meta period lists with games and wins, archetype manifest and stats, low-rank card stats. Decode each response with its own `d_map`. Validate before replacing the stored snapshot. At most one run per 6 hours. A 30-day snapshot is added when the current period has under 1,000 lists. |
| `features` | computed locally | Parse text, derive traits, axes, tech roles, quality, edges; derive play rates, pair counts and near-duplicate clusters from the meta lists; detect the plan family of each archetype. Re-run after any other step. |

Marvel Snap Zone's `getinfo` API is not used: its robots.txt disallows it (`meta §2.3`). snap.fan blocks automated access. marvelsnap.pro is an optional fallback for meta skeletons only.

A banner appears when card data is older than 7 days or the meta snapshot is from an earlier meta period than Untapped's current one.

### 6.2 Reviewed data files (`sync-data/`)

- `formats.json`: modes with `verified` flag, ban list, list date and source URL. Ships Ranked (no bans) and Sanctum Showdown (launch list, flagged stale, `rules §1.2`). Other modes are present as unverified so the validator says "not verified" instead of "legal".
- `card-overrides.json`: per-card clause corrections and hand-written clauses for the cards the parser cannot read (`mechanics §2.2, §5`), each with the card's text at review time. When synced text no longer matches the reviewed text the override is ignored and the card is reported on the Data page as needing review.
- `plans.json`: the win-condition families (`theory §2`): trait patterns for enablers and payoffs, thresholds, the tech classes each folds to, the turn the plan comes online. Data, so it can be corrected without touching code.

### 6.3 Tables

`cards` (defId PK, class, json), `locations`, `card_features` (defId PK, json), `card_edges` (a, b, score, json), `meta_snapshots`, `meta_lists` (snapshot, listKey, cards json, archetype, games, wins, cluster), `meta_archetypes`, `meta_card_stats`, `meta_pairs` (snapshot, a, b, lists, clusters), `collection`, `decks`, `settings`, `sync_state`.

## 7. Rules engine (`src/engine/rules`)

`validateDeck(deck, db) → Violation[]`, implementing the fifteen checks of `rules §5` with the same codes. Checks 1-6 are legality errors and decide the legal chip; 7-13 are warnings or information; 14-15 are heuristic warnings and never change legality.

Points that are easy to get wrong:

- Release state depends on today's date. Never stored as a fixed list.
- A card is deckable only in the released class. Tokens, mode copies, augments, tutorial cards and non-collectible skills share names with real cards; lookups by name must prefer the released card.
- Collectible, released skill cards are deck cards and count toward the 12. No cap on skills per deck was found (`rules §1.1`); none is enforced, and the violation list says so once if a deck holds skills.
- Mode bans come from `formats.json`. An unverified mode yields `MODE_UNVERIFIED`, never a pass.

## 8. Card understanding (`src/engine/text`, `features`, `network`)

This is what every other part depends on, and where the research was least certain: the Python prototype parsed 96.5% of cards at token level, but a hand-check found the effect **target** wrong on 15% of parsed cards (`mechanics §2.1`), and sampled edge precision was 70% strict (`mechanics §4.3`). The build treats those numbers as the starting point to beat, not as good enough.

### 8.1 Parser

A TypeScript port of `docs/research/analysis/mechanics/parse_cards.py`, run on the Untapped pool (the prototype ran on another source). Text → keyword segments → sentences → `Clause { trigger, effects[] { kind, target, magnitude, selectors }, conditions[], scaling[], notes[] }`. The vocabulary (triggers, effect kinds, targets, conditions, scaling sources) is that of `mechanics §2`.

Three additions over the prototype:

- **Structured cross-check.** Untapped's `attributes.data` (`AddedPower`, `ReducedCost`, …) and `attributes.cards.Card_Token` are compared with the parsed magnitudes and created cards. A disagreement is reported in the coverage report.
- **Overrides.** The 46 hard cards of `mechanics §5` and every card found wrong in review get reviewed clauses in `sync-data/card-overrides.json`.
- **Target audit.** A committed test fixture of at least 80 cards with hand-verified clauses (kind and target), including the ten cards the prototype got wrong. The stage is not finished below 95% card-level agreement on that fixture.

A coverage report is produced on every `features` run: cards with no clause, unparsed sentences, attribute disagreements, stale overrides. It is shown on the Data page.

### 8.2 Traits, axes, tech roles

Per card, stored: clauses; traits (flat ids derived from clauses, for example `destroy_own`, `when_destroyed`, `on_reveal`, `ongoing`, `cost_reduce_hand`); **axes** with enabler and payoff strength (the 32 axes of `mechanics §3`, the nine heuristic ones flagged); **tech roles** (the classes of `theory §3` and `mechanics §3`: ongoing removal, text removal, On Reveal denial, power reset, cost lock, add lock, reduction immunity, big-card removal, sweeper, destroy lock, hand attack, displacement, lockdown, protection); drawback and play-restriction flags; draw/tutor/thinning effect on cards seen.

### 8.3 Network

Edges come from the axis rules and the pair templates of `mechanics §4.1`, synergy and anti-synergy, each with a reason that names the rule and quotes both cards' relevant text. Strength is normalised to 0-1; an edge is **strong** at 0.5 or more. The fan-out weighting of the prototype is kept (narrow relationships outrank broad ones) and labelled heuristic.

Changes from the prototype: the broad heuristic axes (`bounce`, `cost_reduction`, `energy_ramp`, `sequencing`, `multi_play`, `location_control`) cannot create a strong edge by themselves; they add to an edge that a text-derived rule already created or count as weak. Location-scoped amplifiers (Wong-style "here") note that both cards must share a location. The edge audit of the prototype is repeated on the final rule set: 60 sampled edges, hand-checked, precision recorded in the commit and on the Data page. Target: 85% strict among strong edges.

All pairs of released cards are computed at sync (about 130,000 pairs) and the non-zero ones stored.

### 8.4 Card quality (heuristic, labelled)

`quality` 0-100 per card, deck-independent, from three sources blended by how much data exists:

- **Stat line**: printed power against the pool mean for its cost (`theory §1.5`), with drawbacks subtracting.
- **Text value**: modelled power-equivalents of its effects from clauses (magnitudes, scaling caps, reach), conservative for conditional effects.
- **Measured**: the card's win-rate delta against the snapshot baseline, shrunk toward zero with a prior worth 50 games per list (`meta §5`), and only as a ±10 adjustment. Nearly half the pool has too little play data to say anything (`meta §3`), so measured data never gates a card.

## 9. Maths (`src/engine/maths`)

Exact, from confirmed rules (`theory §1.2`): cards seen by turn t is 3 + t; P(at least one of k), P(all k), P(one of a and one of b) by turn; adjusted for the deck's own draw, tutor and shuffle-in effects.

Energy model (`theory §1.3`): seeded Monte Carlo of the greedy "spend the most energy" policy over the deck's costs, with the cost and energy effects that traits can express. Outputs: expected energy spent of 21, P(no play) per turn, most likely play per turn. Results are cached by the deck's cost signature. This is a model, labelled derived-from-a-model; it does not know about holding cards on purpose.

## 10. Win conditions (`src/engine/plans`)

`detectPlans(deck, ctx) → PlanReport`. For each family in `plans.json`: the deck's enablers and payoffs, the assembly probability by the plan's key turn (section 9), how it takes two of three locations and when (from the family's template, filled with the deck's cards), what it folds to with the share of the current meta that runs those tech cards, and whether it relies on one unreplaceable card (75% cap).

The primary plan is the family with the highest assembly × payoff weight; a secondary plan is reported when it also clears the threshold. A deck with no plan at 60% is told so. All detection is heuristic and labelled.

## 11. Per-card score (`src/engine/scoring`)

`scoreCard(card, context) → { score, parts, reasons, partners, gate }`. In-deck cards are scored leave-one-out so in-deck and out-of-deck cards share a scale.

**Gates** (score 0, card greyed with the reason): not released; not deckable; banned in the selected mode; already in the deck; not owned when owned-only is on.

| Part | Weight | What it measures |
|---|---|---|
| Synergy | 30 | Strong and weak edges into the current deck, saturating; anti-synergy subtracted; match with the chosen themes and build-around cards. |
| Quality | 20 | Section 8.4. |
| Plan | 15 | What the card adds to the deck's primary or secondary plan: a missing role, redundancy that lifts assembly odds, or a finisher. |
| Energy | 15 | Change in modelled energy spent and in no-play odds if the card is added. |
| Meta or Novelty | 15 | In tuned mode: inclusion rate among lists of the deck's nearest archetypes, shrunk for thin data. In brew mode: the card's contribution to deck novelty (connected rarity, unexplored strong pairs with deck cards), zero for a rare card with no strong edge into the deck. |
| Tech | 5 | Share of the current meta the card's tech role answers, when the deck has room for off-plan cards. |

Every score keeps its parts, partner cards and plain-English reasons. Rescoring the pool after a deck change stays under 150 ms; deck-independent parts are cached.

## 12. Deck rating (`src/engine/rating`)

`rateDeck(deck, context) → { rating, legal, complete, subscores[], violations[] }`.

| Sub-score | Weight | Basis |
|---|---|---|
| Synergy | 18 | Strong pairs of 66, cards with no strong edge, anti-synergy pairs. |
| Plan | 18 | Primary plan strength, payoff quality, secondary plan. Heuristic. |
| Energy | 16 | Modelled energy spent against the 18.0 floor and 19.3 meta median; no-play odds on turns 2-4. |
| Consistency | 14 | Assembly odds of the primary plan; single-card dependence; draw and tutor support. Derived. |
| Card quality | 14 | Mean quality and the weak tail. Heuristic. |
| Resilience | 10 | How much of the current meta's tech hits the primary plan, and whether a second plan survives it. Uses measured play rates of tech cards. |
| Coherence | 10 | Off-plan cards, unreachable play restrictions, payoffs with no enabler (`mechanics §4.1`, deck-level checks). |

Legality is a separate pass/fail chip; an illegal deck's rating is capped at 40. Incomplete decks scale targets by size and are labelled "so far". Each sub-score lists up to three fixes naming cards and numbers, and clicking one filters the card browser. The rating is a construction check, not a win-rate prediction, and the UI says so.

Calibration test: the 200 most-played meta lists in the fixture should rate 60 or more and pass the floor at a rate of at least 95%; seeded random piles should rate under 40 and fail the floor.

## 13. Novelty and discovery (`src/engine/novelty`)

Formulas and defaults are those of `theory §4.3-§4.4` and `§5`, computed against the synced corpus (4,763 lists in the first snapshot).

- **Novelty(D)** = 100 × (0.45 × ListDistance + 0.25 × ConnectedRarity + 0.30 × PackageNovelty). Shown with its evidence: "shares at most 5 of 12 cards with *archetype name* (the list itself, clickable)", the deck's rare-but-connected cards with their play rates, and its unexplored strong pairs with observed and expected co-play. Bands: under 35 meta, 35-59 variant, 60-79 off-meta, 80+ brew.
- **Brew score** = Novelty when the floor is passed, otherwise shown struck through with the failed constraints.
- Near-duplicate lists are collapsed into clusters before counting pair evidence (`meta §3`: 48% of lists are one card from another), so one popular list with twenty variants counts once.
- **Hidden gems**: `Gem(a,b) = 100 × s_ab × U_ab × sqrt(q_a × q_b)` with the Wilson-bound unexplored factor, computed for all strong edges at sync and stored. Triples from pairs sharing a card, discounted 0.70. A smoothed lift under 0.5 with expected co-play of 5 or more is shown as a warning ("both popular, rarely together: there may be a reason"), not hidden.
- Corpus honesty: the snapshot is tracker users at high ranks and only lists with 20 or more games (`meta §3`). Every novelty panel shows source, date, list count and that caveat. Cards released in the last 14 days are marked "new, rarity not meaningful".

## 14. Builder (`src/engine/builder`)

Inputs: mode (`brew` or `tuned`), build-around cards (locks), theme axes, constraint prompts, options (owned only, seed).

**Power floor** (`theory §4.5`, C1-C8), a hard filter on every deck the builder returns: legal; modelled energy spent ≥ 18.0; P(no play on turn 3) ≤ 10%; primary plan assembly ≥ 80%; ≥ 10 strong pairs and ≤ 2 cards with no strong edge; mean quality ≥ 45 and no card under 25 unless it has 3 or more strong edges; ≤ 3 off-plan cards; in build-around mode the named card needs ≥ 3 strong partners and the deck needs a plan that survives without it. `checkFloor(deck) → { passed, checks[] }` with each check's value, threshold and status, shown in the UI. Thresholds are constants in one file, marked heuristic, re-tuned against the calibration test of section 12. The goldfish power percentile (C9) is not a constraint in v1: nothing reliable computes it yet.

**Search**, deterministic for a seed:

1. Candidate pool: locks plus the top ~120 cards by interaction with the locks and themes (plus rarity in brew mode), after applying the prompts.
2. Greedy construction from the locks (or from a sampled gem pair for "surprise me").
3. Seeded simulated annealing over one-card swaps with constraint penalties; objective `Novelty + 2 × SynergySum` in brew mode, `Rating` in tuned mode. Locked cards never leave.
4. An archive keyed by primary plan × curve shape keeps the best floor-passing deck per cell as the search runs. Brew returns up to six decks from different cells, best first. Empty result with the reasons when nothing passes (for example a build-around card with fewer than three partners).

Budget: under 3 seconds per build on the full pool, with a timing test.

**Constraint prompts** (`theory §4.6`): build around these cards; no card above X% play rate (default 5%, tech exempt by a switch); at most N cards shared with any known list (default 4); k wildcard slots filled by gem score (default 2); owned only; series ceiling; avoid a card or an archetype's package; surprise me.

**Explanations** (`theory §4.7`): every non-locked card in a brew carries interaction, why it is unusual, what it replaces, risk, and a measured/derived/heuristic label per number.

**Improve**: ordered swaps `{out, in, reason, ratingBefore, ratingAfter, noveltyBefore, noveltyAfter}`, at most 12, never cutting a locked card. Direction `stronger` accepts a swap that raises the rating; direction `more-original` accepts one that raises novelty without lowering the rating by more than one point or failing the floor. **Fill the rest** and **Suggest swaps** as in Commander Forge.

## 15. Lines (`src/engine/lines`)

Deterministic; every line names cards in the deck and carries its reason, probability where one exists, and a heuristic flag.

- **Turn plan**: turns 1-6 from the energy model: the most likely plays, P(a play), and the plan card that matters that turn.
- **Assembly**: the plan's pieces with exact odds by its key turn, what a missing piece costs, and the substitute in the deck.
- **Sequencing**: ordered pairs from clause structure (amplifier before carrier at the same location, "last card played" copiers, cost reducers before their targets, cards that need a full or empty side).
- **Locations**: how the plan distributes over three locations (tall and hold, wide, move, lockdown) and cards with location restrictions.
- **Packages**: complete in the deck, and one card away with the missing card.
- **Against the field**: for each of the top opposing plans in the synced meta (archetype name, share of games, its detected plan): which of your cards answer it, which of its usual tech cards hit you, and what to hold or play around. No win-rate matrix is claimed.
- **Tech choices**: the tech roles that would cover the largest uncovered share of the meta, with the cards for them that fit the deck best and what each would replace.
- **Risks**: single-card dependence, anti-synergy pairs, a plan that folds to a tech card played in more than a set share of lists.

## 16. Screens

Desktop. Dark, card-art-forward, dense but calm. Cost and power are drawn on each card tile because the art has none.

- **Data**: sync status and buttons per step, image progress, game build, meta snapshot (period, date, lists, games, caveats), parser coverage report, edge audit numbers, formats and their verification state.
- **Decks**: saved decks as tiles with their 12 cards, rating, novelty band and legality.
- **Brew** (`/new`): pick build-around cards (image search), themes, mode and prompts → a gallery of up to six brews, each with rating, novelty, plan, nearest known list and a one-line why; open any in the builder. Also Start empty and Import.
- **Builder**: header (rating gauge, novelty gauge with band, legal chip, 12 slots sorted by cost, energy curve); card browser (image grid with score badges, search, filters for cost, axis, tech role, series, owned, play-rate ceiling; gated cards greyed with the reason); panels: Rating, Novelty, Plan, Lines, Network (partners, packages, gems one card away), Field, Improve. Card overlay: image, text, clauses as the engine understood them, score parts, partners with reasons, play rate.
- **Discover**: hidden-gem pairs and triples with both card images, the interaction, the co-play evidence, and "Brew around this".
- **Collection**: the import box (file, paste, deck codes), per-series bulk toggles, counts owned by series.
- **Import / export**: text lists and both deck-code formats.

## 17. Testing and done

- Engine unit tests on a committed fixture of real cards (all cards named in the research files, the 80-card clause audit set, the cards of the fixture meta lists) and a fixture of 300 real meta lists.
- One test per legality check. Parser audit at 95% or better. Edge audit recorded. Calibration test (section 12). Floor tests: known-good, known-bad, ablation of the build-around card (`theory §4.8`).
- Brew property test: 20 build-around cards from the under-1% half of the pool → for each, either a legal floor-passing deck of novelty 60+ containing the card with at least three explained partners, or an explicit refusal with the reason. Same seed, same deck.
- Lines test: three decks of different plans share almost no lines; every line names a card in its deck.
- Playwright: brew around a card, open a result, see 12 images, rating, novelty and a legal chip; remove a card and see numbers change; improve an imported deck code and accept a swap; import a collection and build owned-only.
- Final review by driving the real UI and looking at screenshots.

Done means: sync completes with images on disk; the owner can build around a chosen card in brew mode and get a legal, functioning, visibly non-meta deck with reasons, edit it by hand with live scores, and read its rating, win conditions and lines, with the network unplugged after sync.

## 18. Builder's calls the owner can overrule

Project name and port 3230. Untapped as the only automatic data source. Snap-ID-only collection sync is not possible (`data §5`), so the import box and bulk toggles stand in for it. Ranked as the default mode, Sanctum Showdown shipped with a stale-flagged list, other modes unverified. 512 px framebreak art. All weights, thresholds and the plan catalogue (heuristic). Annealing with a plan × curve archive instead of a full MAP-Elites loop. No goldfish power simulation in v1. Novelty kept out of the rating. Skill cards deckable without a cap. GitHub publishing and desktop packaging left out until asked for.
