# AGENTS.md

Guidance for coding agents (and people) working in this repository.

## What this is

Snap Forge is a local, single-user deck builder and theorycrafting tool for Marvel Snap whose main goal is **creative deck building**: decks that work mechanically and are measurably different from the known meta lists. One Next.js process on localhost, SQLite on disk, card images on disk. No AI or LLM calls at runtime: every output is computed from card data, rules and synced meta data, and is shown with its reasons.

It follows the recipe of the owner's Commander Forge (`~/github_repositories/commander-forge`) and Riftbound Forge (`~/github_repositories/riftbound-forge`). Those repositories are read-only references. Never modify them.

Read `docs/STATUS.md` first. It says what is built and where to resume.

## Layout

| Path | Contents | Rule |
|---|---|---|
| `src/engine/` | Pure TypeScript: rules, card understanding, interaction network, scoring, rating, novelty, builder, lines | No imports from Node, Next, React or `src/server`. Takes a `CardDb` and plain data. |
| `src/engine/types.ts` | The shared type contract | Do not rename or reshape. Add a field here first and say so in the commit. |
| `src/ingest/` | Sync CLIs (cards, images, meta, features) | Resumable and idempotent. |
| `src/server/` | SQLite repositories, analysis context | |
| `src/app/` | UI and route handlers | Every card is shown as an image. |
| `sync-data/` | Reviewed data files committed to git (formats, overrides, archetype tags) | Lists live here, not in code. |
| `docs/research/` | Verified research | The spec for game facts. |
| `docs/superpowers/specs`, `plans` | Design and implementation plan | Read the section a task names before starting it. |
| `tests/` | Vitest (engine, server), Playwright (e2e), fixtures | |
| `data/` | SQLite file, images, caches | Gitignored. Never commit. |

## Hard rules

1. **Never state a game fact from memory.** Deck size, card text, costs, series, mode restrictions, bans: take them from `docs/research/` (which cites sources) or from synced data. If the research is silent, look it up in a primary or live source and add it there with the source.
2. **Lists live in synced data, not code.** Card pool, unreleased cards, mode restrictions and meta lists must not be hardcoded. A hardcode needs a comment saying why data cannot express it.
3. **A deck the app calls legal must be legal.** Rules changes need a test per rule.
4. **No score without reasons.** Every score, rating and suggestion carries human-readable reasons naming the cards involved.
5. **Label heuristics.** Anything not derived from an official rule or measured data is marked heuristic in code comments and in the UI.
6. **Creative is not the same as random.** Every novelty-driven suggestion must show the mechanical interaction that makes it work and must clear the power floor. A creative deck that cannot function is a bug.
7. **Theorycraft output must be deck-specific.** Lines, win conditions and matchup notes name the cards in the deck.
8. **No card images or card data in git** except the small test fixture. They belong to Marvel / Second Dinner and are downloaded by the sync step.
9. **No personal information** in any outgoing request header, URL or payload. Use a generic `User-Agent`. Requests to community sites are serial and slow.

## Commands

```bash
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm e2e              # playwright test
pnpm sync [step|all]  # cards, images, meta, features
pnpm dev              # localhost:3230
```

A task is finished when `pnpm typecheck && pnpm test` pass.

## Commits

- One task per commit, staging only that task's paths.
- Conventional prefixes: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, with a scope where it helps.
- If a change alters the type contract or a rule, say so in the message.
- Trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Legal

This is a fan project, not endorsed by Marvel or Second Dinner. Keep the disclaimer in `README.md` intact.
