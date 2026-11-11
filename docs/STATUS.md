# Build status and how to resume

This file is the single place a new session reads to continue the build if the previous one was cut off. Update it at every stage boundary, in the same commit as the stage's work.

Last updated: 2026-11-12. Repo created; research (Stage 0) running.

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
| 0 | Research (5 topics) with one fact-check pass, files in `docs/research/` | **in progress** |
| 1 | Design doc and implementation plan with the types contract | not started |
| 2 | Foundation and data: scaffold, sync (cards, images, meta), fixtures | not started |
| 3 | Engine, adversarial reviewer after it | not started |
| 4 | API and UI | not started |
| 5 | End-to-end tests | not started |
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

Read the plan (once it exists), run `git log --oneline | head -20` to see which task commits exist, and start at the first task without one.
