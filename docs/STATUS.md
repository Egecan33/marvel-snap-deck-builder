# Build status and how to resume

This file is the single place a new session reads to continue the build if the previous one was cut off. Update it at every stage boundary, in the same commit as the stage's work.

Last updated: 2026-11-13. Stages 0-6 done, including a calibration pass and a check of the running UI by the orchestrator (Hela brews into a legal Discard deck sharing 3 of 12 cards with the Discard archetype; Kahhori is refused for having only 2 partners, a known recall gap). Stage 7 (package and publish, plan Task 13) done: public repository and release v0.1.0 on 2026-11-13, after the owner's yes; see the stage table. All stages are done.

## Owner's decisions (do not re-ask)

- New standalone repo, same recipe as Commander Forge and Riftbound Forge: pure TypeScript engine without IO, SQLite (better-sqlite3), card images on disk, Next.js UI on localhost, shared types contract, staged build with a commit per task.
- Local, single-user, English UI, every card shown as an image. No AI at runtime; rule- and data-based scoring with visible reasons.
- **Creativity in deck building is the main emphasis.** Novelty must be measurable, and a creative deck must still function (power floor). Say plainly what is heuristic.
- Features: auto-build a legal 12-card deck around chosen cards or a theme; hand-building with live updates; per-card 0-100 score; deck 0-100 rating with sub-scores and fixes; paste a list or deck code and get ordered swap proposals with reasons and rating deltas, accept or reject one by one; optional collection with owned-only mode; theorycraft (synergies and packages, win conditions, turn 1-6 energy plan with draw odds, play against common opposing plans, tech choices).
- No game fact from memory: rules, card pool, balance changes and data sources come from primary and live sources, fact-checked by a second agent; lists in synced data files.
- Scraping community sites is acceptable for a local personal tool.
- Skip brainstorming questions; decide sensibly and list the choices at the end.
- Cost discipline: about five research topics with one fact-check pass, no extra research rounds, each workflow under about 8 agents, stages as separate workflows, commit before every stage boundary.
- Owner, 2026-11-12 (relayed by the parent session): "package both like the Magic one and put them on GitHub, with everything". Final stage, plan Task 13. Until then: local repo, commits per task, no push.
- Do not touch `~/github_repositories/riftbound-forge` or any other repository.
- Owner, 2026-11-13 (relayed by the parent session): a direct, explicit yes to publishing the repository **publicly** on GitHub, knowing that Untapped.gg's terms forbid scraping without permission and allow personal, non-commercial use only. This satisfies the confirmation step of plan Task 13. The README states the terms; the bundles ship no card data or images, and each user runs the slow manual sync themselves.

## Stages

| # | Stage | State |
|---|---|---|
| 0 | Research (5 topics) with one fact-check pass, files in `docs/research/` | done; all five files carry a verification log |
| 1 | Design doc `docs/superpowers/specs/2026-11-12-snap-forge-design.md` and plan `docs/superpowers/plans/2026-11-12-snap-forge.md` | done |
| 2 | Foundation and data: plan Tasks 1-2 | done (scaffold, sync steps, fixtures; `pnpm sync` was run for build 58.15.3) |
| 3 | Engine: plan Tasks 3-9, adversarial reviewer after it | done (review fixed 2026-11-13: held-out strong-edge precision 82.5% strict / 100% lenient on 40; clause audit 124/125 parser, 125/125 with overrides; floor 87/200 meta lists, 0/50 random piles; brews 10/20; 404 tests) |
| 4 | API and UI: plan Tasks 10-11 | done (API: 16 route tests; UI: all screens of spec §16, driven in a real browser at 1440x900 with screenshots, images load from data/images; suite 433 tests) |
| 5 | End-to-end tests and calibration: plan Task 12 | done (5 Playwright flows of spec §17 pass on a copy of the real synced database; `src/ingest/calibrate.ts` read-out; fixes at the source: Arthur Pendragon override, two dropped turn counters, edge-label and fix wording; suite 437 tests) |
| 6 | Final review by driving the real UI and looking at screenshots | done (7 off-meta build-arounds brewed in the UI and read; screenshots in `docs/screenshots/`; UI fixes: picks layout, lock/score overlap, abort race, icon) |
| 7 | Package like Commander Forge and publish on GitHub: plan Task 13 | done 2026-11-13. Public repo https://github.com/Egecan33/marvel-snap-deck-builder, release `v0.1.0` (https://github.com/Egecan33/marvel-snap-deck-builder/releases/tag/v0.1.0) with `SnapForge-0.1.0-macos-arm64.zip` (53.0 MB), `-macos-x64.zip` (55.1 MB), `-windows-x64.zip` (42.0 MB); the release workflow passed on the first tag on all three runners (typecheck, 451 tests, build, bundle smoke test). The released macOS arm64 zip was downloaded, unzipped, started with its starter and opened its Data page on port 3230. Not verified: the macOS Intel and Windows bundles were never run on a real machine (CI only); the builds are unsigned. Before the push, a local macOS arm64 bundle unzipped into a fresh folder, started with its starter, Data page opened, full sync from the packaged app (511 released cards, 620 images wanted, 598 downloaded, 22 tokens without art upstream, 12.5 min), brew around Morgan le Fay returned decks with images (rating 83, novelty 78, floor passed) |

## Stage 0 detail

Expected files in `docs/research/`; a file is verified when it ends with a `## Verification log` section written by the fact-checker.

| File | Topic |
|---|---|
| `rules-and-formats.md` | deck construction, game rules that theory depends on, current modes and restrictions, recent balance changes |
| `data-sources.md` | card data and image sources (tested), deck code format, collection import |
| `meta-sources.md` | meta decklists, play-rate and win-rate data (tested), scraping recipe |
| `mechanics.md` | ability and keyword glossary, text patterns measured on the real pool, enabler/payoff axes, anti-synergies |
| `deck-theory-and-creativity.md` | what a working deck needs, energy and draw maths, win conditions, tech, and the measurable creativity mechanisms |

## Known limitations

Measured on the fixture (511 released cards, 300 meta lists) and the real database (build 58.15.3, meta period 137), 2026-11-13.

Calibration pass (2026-11-13): numbers below are after it; before/after in `docs/HANDOVER.md` "After the calibration pass".

- **Rating tuned, still short of the spec target and not calibrated against win rates.** 181 of the 200 most-played fixture lists rate 60+ (target 95%; real database 185), 47 of 50 random piles rate under 40 (target all). The three random piles at 40-60 hold a real package by chance (two Moveable cards and two move payoffs). Median meta list 85, median brew 80 (real 84): pairs with no measured co-play earn at most half the synergy credit, a heuristic choice made so a brew does not outrank the median meta list by default.
- **Power floor below target.** 170 of 200 fixture lists pass (target 95%; real database 181 of 200); 0 of 50 random piles pass, 1 of 150 in a second set (a destroy package by chance). The rest fail the energy model (Arthur lists: Zabu's and Captain Britain's cost cuts are not modelled; ramp lists: generated cards are not modelled) or cohesion on the thin fixture corpus (208 clusters; co-play evidence needs a pair in 3+ clusters).
- **Measured evidence depends on the corpus.** Co-play counts only for pairs seen in 3+ clusters with a significant lift; the floor's cohesion bar is set from 300 seeded random piles of the same database, so it rises with a bigger snapshot (6.5 on the fixture). Thin snapshots give lists less measured cohesion.
- **Interaction recall.** Partners now include 0.4-0.5 edges with a text-derived reason (held-out band audit 85% strict); 7 of 20 random off-meta build-arounds are still refused (Namora, Gilgamesh, H.E.R.B.I.E., Super-Adaptoid: fewer than 3 partners under the 5% play-rate prompt; Thor, Esme Cuckoo, Namorita: no deck clears the floor and novelty bar). Real read-out: 6 of 10 produce; Doctor Octopus, Strong Guy, The Fallen One and Spider-Man Noir are refused for partners.
- **Repeated cards.** Hub damping and lock relevance removed Aurora-style riders; Spider-Man 2099 is still in 7 of 13 brews (it moves and afflicts, so it sits in move and affliction plans). Results of one build differ by at least 4 cards.
- **Plan families** were added for created cards, skills, spend-all-energy and Empower; a deck holding 5 of an archetype's 8 most-played cards counts as that archetype (measured). Lists without a family or a known core (Kazoo-like piles, On Reveal piles) still get no plan unless their cards cohere well above chance.
- **Field advice is generic.** Lines against each archetype repeat "race it with your payoffs" unless a tech card applies; no win-rate matrix.
- **Energy model** ignores board space, generated cards and cost cuts from other cards (the main reason Arthur lists fail no-play-on-turn-3); turn lines group plays by cost and do not say how many.
- **Parser gaps** listed in `docs/HANDOVER.md` (Task 4 and engine review): about 2% of cards with a known wrong target, Mysterio, Frankie Raye, Sandstorm lossy.
- **Not implemented:** stale-stats and recently-changed warnings (no balance-change log), win-rate prediction (non-goal), phone layout (non-goal). The game-state-file collection import was not tested against a real file.
- **Data terms.** The data source allows personal, non-commercial use and forbids scraping without permission; fine for a local tool. Weighed before publishing: the owner chose to publish (2026-11-13); the repository and downloads hold no card data or images, and the README states the terms.

## Resume

Read the plan, run `git log --oneline | head -20` to see which task commits exist, and start at the first task without one.

## Known facts that shaped the plan

- Card data, images and meta all come from Untapped's anonymous JSON (`data-sources.md`, `meta-sources.md`). Marvel Snap Zone's API is disallowed by its robots.txt and is not used.
- Collection sync by Snap ID alone is not possible; no site exposes a collection without a login, and the game has no macOS client with local files. The app uses one import box (state file, pasted list, deck codes) plus per-series toggles.
- The research parser reads 96.5% of cards at token level but had the effect target wrong on 15% in a hand-check; plan Task 4 must reach 95% on a hand-verified audit fixture before the engine builds on it.
- The current short deck-code format is implemented from a community library and tested by round trip, not yet against a code copied from the game.
- Untapped's card text omits dynamic numbers in at least 24 released rows; `sync-data/card-text-fixes.json` supplies the reviewed full text (plan Task 2).
- Untapped's parent company terms forbid scraping without written permission and allow personal, non-commercial use (wording in `data-sources.md` and `meta-sources.md`). The owner accepted scraping for a local personal tool; sync stays slow, low-volume and manual. Revisited before publishing: the owner said yes to a public repository on 2026-11-13.
- Still unconfirmed: official wording for slot count, tie-break and priority; ban lists of every limited-time mode except the Sanctum Showdown lists on file.
