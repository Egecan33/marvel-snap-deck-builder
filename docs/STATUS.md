# Build status and how to resume

This file is the single place a new session reads to continue the build if the previous one was cut off. Update it at every stage boundary, in the same commit as the stage's work.

Last updated: 2026-11-12. Research written, design and plan committed. Research verified. Stage 2 (plan Tasks 1-2) running.

## Owner's decisions (do not re-ask)

- New standalone repo, same recipe as Commander Forge and Riftbound Forge: pure TypeScript engine without IO, SQLite (better-sqlite3), card images on disk, Next.js UI on localhost, shared types contract, staged build with a commit per task.
- Local, single-user, English UI, every card shown as an image. No AI at runtime; rule- and data-based scoring with visible reasons.
- **Creativity in deck building is the main emphasis.** Novelty must be measurable, and a creative deck must still function (power floor). Say plainly what is heuristic.
- Features: auto-build a legal 12-card deck around chosen cards or a theme; hand-building with live updates; per-card 0-100 score; deck 0-100 rating with sub-scores and fixes; paste a list or deck code and get ordered swap proposals with reasons and rating deltas, accept or reject one by one; optional collection with owned-only mode; theorycraft (synergies and packages, win conditions, turn 1-6 energy plan with draw odds, play against common opposing plans, tech choices).
- No game fact from memory: rules, card pool, balance changes and data sources come from primary and live sources, fact-checked by a second agent; lists in synced data files.
- Scraping community sites is acceptable for a local personal tool.
- Skip brainstorming questions; decide sensibly and list the choices at the end.
- Cost discipline: about five research topics with one fact-check pass, no extra research rounds, each workflow under about 8 agents, stages as separate workflows, commit before every stage boundary.
- Local repo with git commits per task. Publish to GitHub only if the owner asks.
- Do not touch `~/github_repositories/riftbound-forge` or any other repository.

## Stages

| # | Stage | State |
|---|---|---|
| 0 | Research (5 topics) with one fact-check pass, files in `docs/research/` | done; all five files carry a verification log |
| 1 | Design doc `docs/superpowers/specs/2026-11-12-snap-forge-design.md` and plan `docs/superpowers/plans/2026-11-12-snap-forge.md` | done |
| 2 | Foundation and data: plan Tasks 1-2 | **in progress** |
| 3 | Engine: plan Tasks 3-9, adversarial reviewer after it | not started |
| 4 | API and UI: plan Tasks 10-11 | not started |
| 5 | End-to-end tests and calibration: plan Task 12 | not started |
| 6 | Final review by driving the real UI and looking at screenshots | not started |

## Stage 0 detail

Expected files in `docs/research/`; a file is verified when it ends with a `## Verification log` section written by the fact-checker.

| File | Topic |
|---|---|
| `rules-and-formats.md` | deck construction, game rules that theory depends on, current modes and restrictions, recent balance changes |
| `data-sources.md` | card data and image sources (tested), deck code format, collection import |
| `meta-sources.md` | meta decklists, play-rate and win-rate data (tested), scraping recipe |
| `mechanics.md` | ability and keyword glossary, text patterns measured on the real pool, enabler/payoff axes, anti-synergies |
| `deck-theory-and-creativity.md` | what a working deck needs, energy and draw maths, win conditions, tech, and the measurable creativity mechanisms |

## Resume

Read the plan, run `git log --oneline | head -20` to see which task commits exist, and start at the first task without one.

## Known facts that shaped the plan

- Card data, images and meta all come from Untapped's anonymous JSON (`data-sources.md`, `meta-sources.md`). Marvel Snap Zone's API is disallowed by its robots.txt and is not used.
- Collection sync by Snap ID alone is not possible; no site exposes a collection without a login, and the game has no macOS client with local files. The app uses one import box (state file, pasted list, deck codes) plus per-series toggles.
- The research parser reads 96.5% of cards at token level but had the effect target wrong on 15% in a hand-check; plan Task 4 must reach 95% on a hand-verified audit fixture before the engine builds on it.
- The current short deck-code format is implemented from a community library and tested by round trip, not yet against a code copied from the game.
- Untapped's card text omits dynamic numbers in at least 24 released rows; `sync-data/card-text-fixes.json` supplies the reviewed full text (plan Task 2).
- Untapped's parent company terms forbid scraping without written permission and allow personal, non-commercial use (wording in `data-sources.md` and `meta-sources.md`). The owner accepted scraping for a local personal tool; sync stays slow, low-volume and manual. Revisit before publishing the repo.
- Still unconfirmed: official wording for slot count, tie-break and priority; ban lists of every limited-time mode except the Sanctum Showdown lists on file.
