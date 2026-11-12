# Rules and formats (Marvel Snap)

Researched 2026-11-12. Every fact below was read from a live page on that date (access date for all rows: 2026-11-12). Nothing is from memory. `UNCONFIRMED` means no fetched source states it; do not encode it as a rule until resolved. Raw downloads: `docs/research/raw/rules/` (gitignored).

## Sources

| Key | URL | Kind | Published |
|---|---|---|---|
| S1 | https://marvelsnap.com/news/ | Official news index | live |
| S2 | https://marvelsnap.com/new-season-knights-of-avalon/ | Official season post | 2026-10-30 |
| S3 | https://marvelsnap.com/balance-update-october-29-2026/ | Official OTA | 2026-10-29 |
| S4 | https://marvelsnap.com/patch-notes-october-20-2026/ | Official patch 58.x | 2026-10-20 |
| S5 | https://marvelsnap.com/balance-update-october-15-2026/ | Official OTA | 2026-10-15 |
| S6 | https://marvelsnap.com/balance-update-october-1-2026/ | Official OTA | 2026-10-01 |
| S7 | https://marvelsnap.com/patch-notes-september-15-2026/ | Official patch 57.x | 2026-09-15 |
| S8 | https://marvelsnap.com/balance-update-september-10-2026/ | Official OTA | 2026-09-10 |
| S9 | https://marvelsnap.com/balance-update-august-27-2026/ | Official OTA | 2026-08-27 |
| S10 | https://marvelsnap.com/?p=92434 | Official patch 56.x | 2026-08-18 |
| S11 | https://marvelsnap.com/unlocking-the-future-of-your-collection-snap-packs/ | Official Snap Packs announcement | 2025 (pre April 29) |
| S12 | https://marvelsnap.com/marvel-snaps-foundational-focus/ | Official 2026 roadmap post | early 2026 (exact date not captured) |
| S13 | https://marvelsnap.com/new-limited-time-mode-sanctum-showdown/ | Official Sanctum Showdown launch post | 2025 (page since edited; exact date not captured) |
| S14 | https://outof.games/news/9600-marvel-snap-is-getting-a-draft-mode-on-august-24/ | Community news (cites a GameSpot interview) | 2026-08 |
| S15 | https://outof.games/realms/marvel-snap/guides/255-how-to-play-marvel-snap/ | Community beginner guide | old (launch era); still served |
| S16 | https://www.fourthlocation.com/schedule/ | Community schedule (acquisition labels) | live |
| S17 | https://marvelsnapzone.com/news/ota-balance-updates/ | Community OTA index | live |
| S18 | Web search result snippets (marvelsnapzone.com/seasonal-series-4-snap-pack/, marvelsnapzone.com/wolverine-horseman-of-war-guide/, blizzardwatch 2022 guides) | Snippet only, page not opened | mixed |

Source quality note: the official site has no rules document. `marvelsnap.com/how-to-play/` renders its content client-side and returned no text to a plain fetch. Core rules therefore rest on S15 (community, old) plus corroboration from the official S13 post where it restates base rules. Treat section 2 rows sourced only to S15 as "community-confirmed, not officially confirmed".

## 1. Deck construction

### 1.1 Standard (collection) decks

| Rule | Value | Source | Status |
|---|---|---|---|
| Deck size | Exactly 12 cards | S15 ("deck of twelve different cards"); S4 ("ready-to-play 12-card decks") | Confirmed (official S4 for size) |
| Duplicates | None. One copy per card | S15 | Community-confirmed |
| Variants | A variant is the same card as its base; cannot be run alongside it | S15 | Community-confirmed |
| Card ownership | Player must own the card (decks are built from the collection) | S14 (contrasts Draft with "bringing in a deck from their collection") | Confirmed indirectly |
| Deckable pool | A card is deckable when, in the Untapped dump, `collectible === true` and `series > 0` and `min(seriesStartTimestamps) <= now`. **511 cards on 2026-11-12** (500 characters + 11 skills). This is the one pool rule for the project; see the verification log | `data-sources.md` 1.1; verified 2026-11-12 | Measured. All 4,763 Untapped meta lists use only these 511 ids |
| Unreleased cards | Not deckable until released. Release dates per card are published in the season post (see 4.2) and carried as `seriesStartTimestamps` in card data | S2 | Inferred from release schedule; no explicit rule text |
| Created / token cards | Cards that only exist when made by another card (examples named in official notes: Excalibur, The Grand Design, Cap's Shield, Winter Soldier "from Bucky Barnes", Basic Arrow "from Kate Bishop", Tao Mandala "from The Ancient One", Apocalypse Celestials' Chosen via transform) are not part of the collectible pool | S2, S3, S6, S9 (they are described as added/created/transformed, never as acquirable) | UNCONFIRMED as an explicit rule. Take the deckable flag from synced card data, never from a hardcoded list |
| Skill cards | A non-character card type. Official definition (patch notes 2025-03-04, https://marvelsnap.com/patch-notes-march-4-2025/): "Skills don't have Power, and are banished (gone forever) after taking effect"; they are banished "After their own On Reveal effects, but before any cards or locations that take effect after a card is played", so they do not keep a slot at the location. Collectible skills **go in decks and count toward the 12**: 11 skills are in the deckable pool (Adamantium Infusion, Astral Projection, Deafening Chord, Fastball Special, Majestic Wingbeat, Sandstorm, Spider Sense, Techno-Organic Virus, The Hunger, The Inversion, Web Sling) and 1,285 of 4,763 Untapped meta lists contain at least one, always as one of 12 distinct cards (up to 5 skills in one list). The other 50 skill rows are created-only or mode-only. Card data flags them with `isSkill` (Untapped); current Spider-Sense is 5/- | S8, S4; verified 2026-11-12 | Confirmed (official definition + measured deck data). No cap on skills per deck is stated anywhere; lists with 5 exist |
| Minimum/maximum by cost, series, team | None found | - | UNCONFIRMED (no source states a restriction) |

### 1.2 Modes

Standard rules = section 2. "LTGM" = limited-time game mode. Official statement: the game runs "six rotating limited-time modes" (S12). LTGMs can ban cards: the deck picker shows a "Banned Card icon" on decks in LTGMs (S4), High Voltage has a "banned filter button" (S10), Grand Arena has an "Invalid Deck icon" (S10).

| Mode | Availability (2026) | Deck rules | Turns / energy | Win condition | Banned cards | Source |
|---|---|---|---|---|---|---|
| Ranked | Permanent | Standard 12, no duplicates | Standard | Standard; cubes at stake move rank | None found. UNCONFIRMED that none exist | S15, S7 |
| Conquest | UNCONFIRMED (not mentioned in any 2026 page fetched) | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | - |
| Sanctum Showdown | Recurring LTGM. Current run Nov 5-12, 2026 | Collection decks, minus banned cards | Start 3 cards and 1 max energy, +1 card and +1 energy each turn. No fixed turn 6 end | First to 16 points, checked after each turn. T1-T2: one random location is the Sanctum, worth 1 point. From T3: Sanctum 4 points, other locations 1 each. Both at 16+: higher total wins; equal: tie. Snap: from T3, once per turn, +1 point to the Sanctum that turn. No retreat incentive | Launch list (S13): Annihilus, Captain Marvel, Debrii, Dracula, Galactus, Green Goblin, Hobgoblin, Juggernaut, Invisible Woman, Kang, M'Baku, Magik, Malekith, Martyr, Mysterio, Quake, Storm, Supergiant, Viper; plus some locations. A later community list (Fourth Location guide, 2026-01-27, https://www.fourthlocation.com/sanctum-showdown-strategy-guide-january-26/) differs: Annihilus, Cannonball, Captain Marvel, Cull Obsidian, Dracula, Galactus, Green Goblin, Hobgoblin, Invisible Woman, Juggernaut, Magik, Makkari, Malekith, Man-Spider, Martyr, M'Baku, Mysterio, Negasonic Teenage Warhead, Quake, Rocket & Groot, Rocket Raccoon, Sauron, Scream, Viper, Werewolf By Night (25; Debrii, Kang, Storm, Supergiant no longer listed). So the list changes between runs. List for the Nov 5-12, 2026 run: UNCONFIRMED | S13, S2 |
| Draft | LTGM, debuted 2026-08-24; 2nd run from 2026-09-28; 3rd run Nov 19 - Dec 1, 2026 | Not a collection deck. Pick a 3-card Starter (archetypes such as Ramp, Swarm, Move, Destroy, Control, Ongoing), draft to 10 cards, grow to 12 between matches. Duplicates allowed. Cards can have boosted stats and Augments. Draft-only rarity. Ownership not required (S7: variants shown are cosmetic only) | Standard turn structure per S14 | Run ends at 5 wins or 2 losses, one Respawn Token per run. From the 2nd run, matches use "Sanctum Showdown-style scoring" (S7) | Card pool is curated; list not published in fetched sources | S14, S7, S2 |
| High Voltage | Recurring. "3-Day High Voltage" Nov 14-17, 2026 | Has a banned list (banned filter in UI) | UNCONFIRMED | UNCONFIRMED | List UNCONFIRMED | S2, S10 |
| Deadpool's Diner | Exists in 2026 client (bug fixes in 58.x). No November 2026 run listed | UNCONFIRMED | UNCONFIRMED | Described officially only as a mode about snapping "into the stratosphere" (S13) | UNCONFIRMED | S4, S13 |
| Grand Arena | LTGM in 2026 client | Has deck validity rules ("Invalid Deck icon"). Details UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | S10, S14 |
| Team Clash | LTGM in 2026 client. Uses card Teams (X-Men, Spider-Verse...) and "team effects"; has a banned icon | Details UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | S4, S7 |

Consequence for the app: mode restrictions cannot be completed from official text today. Ship `sync-data/formats` with Ranked (standard) and Sanctum Showdown (launch list, flagged stale); leave other modes as declared-but-unverified so the validator reports "not verified" rather than "legal".

## 2. Core game rules

| # | Rule | Value | Source | Status |
|---|---|---|---|---|
| R1 | Turns | 6. "Usually after turn 6": cards and locations can change it | S15 | Community-confirmed. The list of turn-changing cards/locations must come from card data |
| R2 | Energy | Turn N gives N energy (1 max energy on turn 1, +1 per turn). Unspent energy does not carry over | S15; S13 restates "one Max Energy... each turn another Max Energy" | Confirmed |
| R3 | Bonus energy / cost reduction | Both exist as separate effects ("bonus Energy", "Cost reduction") | S3 | Confirmed (mechanic existence) |
| R4 | Starting hand | 3 cards, no mulligan | S15; S13 ("start with three cards in your hand") | Confirmed |
| R5 | Draw | 1 card at the start of each turn, including turn 1 | S15; S13 ("each turn, you draw a card") | Confirmed |
| R6 | Max hand size | 7. With a full hand the draw is skipped, not burned | S15 | Community-confirmed |
| R7 | Cards seen (derived, no draw effects) | 3 + N by turn N: T1 4, T2 5, T3 6, T4 7, T5 8, T6 9 of 12; T7 10 | Derived from R4, R5 | Derived. P(specific card seen by T6) = 9/12 = 75% |
| R8 | Fixed-draw effects | Some cards override draw order (Domino: "You always draw this card on turn 2, and not before"; Draft augment Superstar starts in opening hand) | S6, S14 | Confirmed; engine must read these from card text |
| R9 | Locations | 3 locations, all hidden at start. Left reveals on T1, middle on T2, right on T3 | S15 | Community-confirmed |
| R10 | Slots per side per location | **4 per side, in two rows of two.** The **front row** is the first and second spots filled, the **back row** the third and fourth. Characters only: a skill is banished after it resolves and frees its slot | Current card text (Untapped dump 58.15.3): Lizard "-4 Power if your opponent has 4 cards here"; En Sabah Nur "Have a full front row at each location ... (0/6)" = 2 front-row spots x 3 locations; Prodigy "If this is in the back row, copy the text of the card in front of it". Layout stated by Marvel Snap Zone (2025-04-01, https://marvelsnapzone.com/captain-carter-theorycraft/): "There are (usually) four spots on each location ... split into two rows, each containing two spots. The back row refers to the third and fourth spots". Official 2025-03-04 patch notes speak of skills "leaving extra card slots at locations" | Confirmed by card text + community statement (verified 2026-11-12). No official sentence gives the number. "(usually)": read capacity changes from card/location text, do not assume them |
| R11 | Winning | More Power than the opponent at 2 of 3 locations at game end | S15 | Community-confirmed |
| R12 | Tie-break | If both players win the same number of locations: higher **total Power across all three locations** wins; equal totals = draw, no cubes move. S15's wording ("the biggest lead at their winning Location") gives the same result in every case: when locations won are equal (1-1 with one tied, or all three tied) the difference in total Power equals the difference of the two winning margins | S15, S18; PC Gamer, Shacknews, Twinfinite via search (2026-11-12) | Community-confirmed, two wordings shown equivalent (derived). No official wording found |
| R13 | Simultaneous play | Both players play hidden, then cards reveal in the order each player played them | S15 | Community-confirmed |
| R14 | Priority | Decided at the start of each turn: the player winning more locations reveals first (name highlighted); if locations are level, the player with more total Power; if that is also level, including turn 1, a random pick | S15; snap.fan "A Guide on Priority" (2023-12-12, https://snap.fan/guides/a-guide-on-priority/): "designated by who is winning the most locations at the start of a turn. If there is a tie, it is based upon who has the highest power overall. ... if there is equal power, and equal locations then it's a 50/50-coin flip. This also happens on turn one" | Community-confirmed (verified 2026-11-12). One search result (ForgeGuides) claims the losing player reveals first; it contradicts S15 and snap.fan and is not used. No official text found |
| R15 | Cubes | Stakes double on a Snap and double again automatically at game end. Retreat loses the current stake. Both retreat = draw | S15 | Community-confirmed. Not a deck-building input except for "snap condition" notes |
| R16 | Keywords seen in current official text | On Reveal, Ongoing, Activate, Game Start, Start of Turn (new standard wording, 57.x), End of Turn, Objective (2026), Quickdraw, Moveable, Horde, Empowered, When Discarded, Judge | S3, S5, S6, S7, S8, S12 | Confirmed as existing; definitions belong to the card-data research |
| R17 | Card stat notation | Official notes write `Cost/Power` (e.g. `3/4`); skills write `Cost/-` | S3, S8 | Confirmed |

## 3. Card acquisition (as of 2026-11-12)

### 3.1 Structure

| Element | Current state | Source |
|---|---|---|
| Series | Series labels still in use. Series 3, 4 and 5 are named in current official posts. Series 1 is referenced ("strong Series 1 cards like Apocalypse") | S2, S5, S11 |
| Series 1-2 | Assumed Collection Level track. UNCONFIRMED from fetched pages | - |
| Series 3 | Earned along the Collection Level track; also via Series 3 Collector's Pack | S11 |
| Series 4 | In 2026, new LTGM reward cards enter as Series 4 (Mordred, Knight's Vow). Label "S4" | S2, S16 |
| Series 5 | Season pass cards and weekly seasonal cards are Series 5 | S2 |
| Season pass | Two paid tiers: Premium (one new card) and Super Premium (a second new card + more). Community lists them at $10 and $20 | S2, S16 |
| Weekly release | One new Series 5 card per week through the "Seasonal SNAP Pack" | S2 |
| LTGM cards | Earned on the event reward track / Portal Pull during the event, later sold in the Card Shop | S2, S13 |
| Card Shop | Replaced the Token Shop. Sells Snap Packs, Spotlight cards, pinnable rotating cards, Token packs for Gold, Featured Sets, Spotlight Variants; free daily Tokens | S11, S12, S2 |
| Currency | Collector's Tokens. Collection Level track pays 3000 Tokens where it used to pay a Spotlight Key | S11 |
| Promo | Some cards arrive via Inbox or login events | S16 |

### 3.2 Snap Packs (replaced Spotlight Caches)

| Pack | Pool at launch design | Source |
|---|---|---|
| New Series 5 pack | All Series 5 cards from the current and one previous season; pool updates weekly | S11 |
| New Series 4 pack | All Series 4 cards from the current and two previous seasons; pool updates each season | S11 |
| Collector's Packs (S3, S4, S5) | One per series; every card not in the "New" packs | S11 |
| Guarantee | Each pack gives 1 unowned card (no duplicates) plus 2 bonus rewards | S11 |
| 2026 naming | Current posts say "Seasonal SNAP Pack" and "Series 5 SNAP Pack"; community pages describe cards rotating from a Seasonal pack to the Collector pack after roughly three months (example: joined Nov 4, 2025, rotated Feb 3, 2026) | S2, S18 |

### 3.3 Changes 2025-2026

| Date | Change | Source |
|---|---|---|
| 2025-04-29 (target date; community reports it shipped then) | Spotlight Caches retired; Snap Packs and Card Shop introduced; Spotlight Keys converted at 3000 Tokens each | S11, S18 |
| 2025 | LTGMs grew from two to six; event premium passes and pre-built decks added; about 100 new cards in the year | S12 |
| Early 2026 | Second Dinner states catch-up is still too hard and that acquisition improvements are planned for 2026 | S12 |
| April 2026 | A community guide calls Wolverine, Horseman of War "the first Series 5 card" of the April 2026 season, which implies the series labels were restructured around then | S18. UNCONFIRMED (snippet only) |
| 2026-10-20 | Deck Bundles: 12-card (sometimes 3- or 6-card) purchasable decks, price discounted by cards already owned, tailored per account, rotating | S4 |
| Unknown | Series drops (cards moving down a series): schedule and current policy UNCONFIRMED | - |

### 3.4 Suggested availability model (heuristic, label as such in UI)

| Tier | Meaning | Derived from |
|---|---|---|
| `unreleased` | Release date in the future | season post dates |
| `starter_track` | Series 1-3, earned by Collection Level | series field |
| `event` | Series 4 from an LTGM track, later Card Shop | series + source label LTGM |
| `seasonal_pack` | Series 5, in the current Seasonal pack window | series + release date |
| `season_pass` / `super_pass` | Paid pass card of the current season | source label SP / SPSP |
| `collector_pack` | Older Series 4/5 in a Collector's Pack | series + age |
| `promo` | Inbox/login only | source label Promo |

## 4. Recent balance changes and current season

### 4.1 OTA and patch card changes, 2026-08-27 to 2026-11-12

Notation `Cost/Power`. All rows are from the official post for that date.

| Date | Card | Old -> New | Source |
|---|---|---|---|
| 2026-10-29 | Scarlet Witch Queen of Chaos | 3/4 -> 3/3 | S3 |
| 2026-10-29 | En Sabah Nur | 4/6 -> 4/5 | S3 |
| 2026-10-29 | Apocalypse, Celestials' Chosen | 4/9 -> 4/8 | S3 |
| 2026-10-29 | The First Ghost Rider | 2/7 -> 2/8 | S3 |
| 2026-10-29 | Hellcow | 4/7 -> 3/5 | S3 |
| 2026-10-29 | Wolverine, Horseman of War | 4/3 -> 4/4; Objective threshold 5 -> 6 Power | S3 |
| 2026-10-29 | Klaw | 4/2 -> 4/3 | S3 |
| 2026-10-29 | Leech | 4/4 -> 4/5; now hits "6-Cost or more" (was 6-Cost only) | S3 |
| 2026-10-29 | Entropic Havok | 3/3 -> 3/4 | S3 |
| 2026-10-20 (patch) | Dracula | 4/1 -> 4/2; gains the Power the discarded card had at discard time | S4 |
| 2026-10-20 (patch) | Kid Omega | Gains the Power the target had when destroyed (behaviour change) | S4 |
| 2026-10-20 (patch) | Fastball Special, Web Sling | Team tags removed from Skills | S4 |
| 2026-10-15 | Thanos Fractured Frontier | 5/8 -> 5/7 | S5 |
| 2026-10-15 | Anti-Polar Magneto | 6/9 -> 6/8 | S5 |
| 2026-10-15 | Caliban | Affliction -7 -> -6 | S5 |
| 2026-10-15 | Karen Page | 4/6 -> 4/5 | S5 |
| 2026-10-15 | Colleen Wing | 2/4 -> 2/5 | S5 |
| 2026-10-15 | Apocalypse | 6/9 -> 6/10 | S5 |
| 2026-10-15 | Swarm | 2/3 -> 1/3 | S5 |
| 2026-10-15 | Zombie Venom | Horde +2 -> Horde +3 | S5 |
| 2026-10-01 | Thanos Fractured Frontier | No longer pre-loads one Infinity Shot at Game Start (text reworded) | S6 |
| 2026-10-01 | Domino | 2/4 -> 2/3 | S6 |
| 2026-10-01 | Jane Foster Fractured Frontier | 3/4 -> 3/3 | S6 |
| 2026-10-01 | Blink | 5/7 -> 5/8; swaps for a card that costs "the same or more" (was "more") | S6 |
| 2026-10-01 | Tao Mandala (from The Ancient One) | 2/- -> 3/- | S6 |
| 2026-10-01 | Zombie Captain Marvel | 4/5 -> 4/6 | S6 |
| 2026-10-01 | Winter Soldier (from Bucky Barnes) | 2/7 -> 2/8 | S6 |
| 2026-10-01 | Tombstone | 2/4 -> 2/5 | S6 |
| 2026-10-01 | Kluh | 5/10 -> 5/11 | S6 |
| 2026-10-01 | Basic Arrow (from Kate Bishop) | +3 Power -> +4 Power | S6 |
| 2026-10-01 | Hellcow Fractured Frontier | Text: added "Other" (cannot destroy itself) | S6 |
| 2026-09-15 (patch) | Entropic Havok, Jim Hammond Human Torch, Kitty Pryde, Mad Thinker, Merlin, Superior Spider-Man, Viv Vision, Ice Cube, Team Clash Professor X, Team Clash Wolverine | Text only: "Start of Turn:" keyword wording. Locations Hala and Time Theater reworded. No function change | S7 |
| 2026-09-10 | Venus | 3/3 -> 3/2 | S8 |
| 2026-09-10 | Scorpion Brand New Day | 6/8 -> 6/6 | S8 |
| 2026-09-10 | Blink | 5/8 -> 5/7 | S8 |
| 2026-09-10 | Isca the Unbeaten | 4/3 -> 4/2 | S8 |
| 2026-09-10 | Gambit Horseman of Death | 3/5 -> 4/6 | S8 |
| 2026-09-10 | Nicholas Scratch | 1/2 -> 1/3 | S8 |
| 2026-09-10 | Vulture | On move +3 -> +4 Power | S8 |
| 2026-09-10 | The Collector | 2/2 -> 2/3 | S8 |
| 2026-09-10 | Spider-Sense | 6/- -> 5/- | S8 |
| 2026-09-10 | Superior Iron Man | 5/7 -> 5/8 | S8 |
| 2026-09-10 | Mister Fantastic First Steps | Hand buff +2 -> +3 Power | S8 |
| 2026-09-10 | Majestic Wingbeat | +2 -> +3 Power | S8 |
| 2026-08-27 | Sam Wilson Captain America | 2/3 -> 2/2 | S9 |
| 2026-08-27 | Mister Fantastic First Steps | 3/4 -> 3/5 | S9 |
| 2026-08-27 | Strong Guy | 3/3 -> 3/4 | S9 |
| 2026-08-27 | Death Fractured Frontier | 5/8 -> 5/9 | S9 |
| 2026-08-27 | Spider-Sense | 5/- (+2 Power) -> 6/- (+3 Power) | S9 |
| 2026-08-27 | Klaw | 5/4, right location +7 -> 4/2, right location +6 | S9 |

Also in window but not opened: OTA of 2026-08-13 (listed in S17). The patch of 2026-08-18 (S10) was fetched; no card stat changes were found in the indexed text.

Cadence: one OTA about every two weeks (Aug 27, Sep 10, Oct 1, Oct 15, Oct 29), one client patch per month (Aug 18, Sep 15, Oct 20). Next OTA is expected around Nov 12-13 and the next patch around Nov 17; both UNCONFIRMED. Re-sync before trusting stats.

### 4.2 Current season: Knights of Avalon (November 2026)

Announced 2026-10-30 (S2). Preceding seasons from S1: AXIS: Inversion (post 2026-08-31), Vampires vs. Zombies (post 2026-10-02). Fractured Frontier preceded those (S9). Exact season start/end timestamps: UNCONFIRMED (first card releases Nov 3).

| Card | Series / source | Release | Text (as announced) |
|---|---|---|---|
| Arthur Pendragon | S5 / Premium Pass | Season start | On Reveal: Pull Excalibur free to here. (Excalibur - Ongoing: Your 4-Cost or more cards have +2 Power.) |
| Merlin of Avalon | S5 / Super Premium Pass | Season start | On Reveal: Add The Grand Design to your hand. (The Grand Design: Costs 1 less per created card played. On Reveal: Give one of your cards at each other location +5 Power.) |
| Captain Britain | S5 / Seasonal SNAP Pack | 2026-11-03 | After you play a 4-Cost or more card, give it +1 Power and a card in your hand -1 Cost. |
| Lancelot | S5 / Seasonal SNAP Pack | 2026-11-10 | Ongoing: Your cards with increased Power have +1 Power. |
| Elder Dragon of the Moon | S5 / Seasonal SNAP Pack | 2026-11-17 (unreleased today) | Costs 1 less for each of your cards in play with increased Power. |
| Sir Percy Black Knight | S5 / Seasonal SNAP Pack | 2026-11-24 (unreleased today) | Costs 1 less for each other 4-Cost or more card you have in hand. |
| Mordred | S4 / LTGM (Sanctum Showdown, Nov 5-12) | From 2026-11-05 on the reward track | Ongoing: +2 Power for each higher-Cost card here. |
| Knight's Vow | S4 / LTGM (Draft, Nov 19 - Dec 1) (unreleased today) | From 2026-11-19 | On Reveal: Give a 4-Cost or more character in your hand -1 Cost and a 3-Cost or less one +3 Power. |

Costs and Power for these cards are not in the season post text; take them from synced card data. New locations: Niamh's Lake (Nov 11), Round Table (Nov 25).

Checked against the Untapped dump (build 58.15.3, 2026-11-12): Arthur Pendragon 4/4, Merlin of Avalon 1/2, Captain Britain 2/2, Lancelot 4/6, Mordred 3/4 are released and deckable today; Elder Dragon of the Moon 9/12 (2026-11-17), Sir Percy Black Knight 6/9 (2026-11-24) and Knight's Vow 2/- (2026-11-19) are not. Knight's Vow is a **skill** (`isSkill`). All texts in the table match the dump. Release timestamps in the dump are 19:00 UTC on the listed day (season start 2026-11-03T19:00Z). The dump's own `series` field labels Arthur Pendragon 9 (SeasonPass) and Mordred 10 (LimitedTimeEvent, `possibleSeries` 7 = Series 4) until they move into a numbered series, so "S5"/"S4" in the table are the announced destinations, not the current data value.

### 4.3 Fetching changes programmatically

| Option | Result | Notes |
|---|---|---|
| `https://marvelsnap.com/wp-json/wp/v2/posts` | HTTP 401 "REST API is restricted to authenticated users" (tested 2026-11-12) | Not usable |
| `https://marvelsnap.com/news/` and `/news/page/N/`, `/category/game-updates/` | Plain HTML, 10 posts per page with title + date + link | Works with a plain GET and generic User-Agent |
| Post slugs | `balance-update-<month>-<d>-<yyyy>`, `patch-notes-<month>-<d>-<yyyy>`, `new-season-<name>` | Do not guess; read links from the index (older posts used different slug shapes) |
| Post body format | Card name line, then `[Old] C/P - text`, then `[Change]` or `[New]` line | Parseable with a line parser; `[Change] a > b` and `[New] full text` both occur. Keep the raw text and a parsed diff |
| RSS (`/feed/`) | Not tested | Open question |
| marvelsnapzone OTA index (S17) | HTML list of per-OTA articles | Secondary cross-check only |

No official machine-readable changelog was found. The canonical source is the official news posts.

## 5. Validator checks

Severity: `error` = deck is not legal; `warning` = legal but the user should know; `info` = context. Every message must name the cards involved (AGENTS rule 4).

| # | Code | Severity | Condition | Message template | Basis |
|---|---|---|---|---|---|
| 1 | `DECK_SIZE` | error | card count != 12 | "Deck has {n} cards; a deck must have exactly 12." | 1.1 |
| 2 | `DUPLICATE_CARD` | error | same card id twice (variants collapse to base id) | "{card} appears {n} times; only one copy is allowed." | 1.1 |
| 3 | `UNKNOWN_CARD` | error | id not in synced card DB | "{name} is not in the card database (last sync {date})." | AGENTS rule 3 |
| 4 | `NOT_DECKABLE` | error | card flagged token/created/summoned-only in synced data | "{card} is created by {source card} and cannot be put in a deck." | 1.1 (flag from data) |
| 5 | `UNRELEASED` | error | release date > today | "{card} releases on {date} and cannot be played yet." | 1.1, 4.2 |
| 6 | `MODE_BANNED` | error | card in selected mode's ban list | "{card} is banned in {mode} (list dated {date}, source {url})." | 1.2 |
| 7 | `MODE_UNVERIFIED` | warning | selected mode has no verified rules/ban list in `sync-data/formats` | "{mode} restrictions are not verified; legality shown is for Ranked only." | 1.2 |
| 8 | `MODE_LIST_STALE` | warning | mode ban list older than the mode's latest run | "{mode} ban list is from {date}; the mode has run since." | 1.2 |
| 9 | `MODE_NOT_CONSTRUCTED` | info | mode is Draft | "Draft decks are drafted in-game and cannot be built from a collection." | 1.2 |
| 10 | `STATS_STALE` | warning | last card sync older than the latest known OTA/patch date | "Card stats were synced {date}; a balance update was published {date2}." | 4.1 |
| 11 | `RECENTLY_CHANGED` | info | card changed in the last N days | "{card} changed on {date}: {old} -> {new}." | 4.1 |
| 12 | `NOT_OWNED` | warning | collection loaded and card not owned | "{card} is not in your collection ({availability tier})." | 3.4 |
| 13 | `ROTATION_SOON` | info | card's pack window ends or card releases within N days | "{card} {event} on {date}." | 3.2 (heuristic) |
| 14 | `CURVE_UNPLAYABLE` | warning (heuristic) | e.g. no card playable on turns 1-2, or total cost far above energy available over 6 turns (21) | "No plays before turn {n}: {cards}." | R2, R7; heuristic, label as such |
| 15 | `DEPENDENCY_MISSING` | warning (heuristic) | card needs a partner type absent from the deck (e.g. discard payoff with no discarder) | "{card} needs {requirement}; none of the 12 cards provides it." | card-understanding engine; heuristic |

Checks 1-6 are rule checks and need one test each (AGENTS rule 3). Checks 14-15 are heuristics and must not affect the legal/illegal verdict.

## 6. Open questions

1. Settled 2026-11-12 (R10): 4 slots per side, front row = first two spots. Still open: no official sentence states it, and which effects change capacity must be read from text.
2. Settled at community level 2026-11-12 (R12, R14). Still open: an official wording for the tie-break and for priority.
3. Current ban lists for Sanctum Showdown (post-launch changes), High Voltage, Deadpool's Diner, Grand Arena, Team Clash; and each mode's turn/energy rules. No fetched page lists them. Likely only visible in-client or on community mode guides.
4. Conquest: does it still exist in late 2026, and does it use standard deck rules? Not mentioned in any 2026 official page fetched.
5. Settled 2026-11-12 (1.1): skills are deckable and count toward the 12; the Untapped dump exposes `isSkill` and the deckable rule separates the 11 collectible skills from the 50 others. No per-deck skill limit is stated in any source.
6. Series structure in 2026: was Series 5 redefined in April 2026 (S18 snippet)? Where do Series 1-2 sit now? Are series drops still happening and on what schedule?
7. Snap Pack prices in Tokens and the exact Seasonal -> Collector rotation window in 2026.
8. Exact season start/end timestamps and the "server reset" time, needed for `UNRELEASED` to flip on the right day.
9. Is there an RSS feed or other stable endpoint on marvelsnap.com for the changelog (wp-json is closed)?
10. The 2026-08-13 OTA and any OTA published on or after 2026-11-12 are not in the table in 4.1.
11. Research budget note: this file used about 30 searches/fetches (budget was ~25); mode guides on community sites were not opened and are the obvious next source for question 3.

## Verification log (2026-11-12)

Independent pass. Local ground truth: Untapped dump `raw/cards/cards.json` (re-fetched the same day: 791 rows, build 58.15.3, byte-for-byte the same cards) and `raw/meta/untapped/`. Live pages fetched with `User-Agent: SnapForge/0.1`.

| Claim | Checked against | Verdict |
|---|---|---|
| Deck = exactly 12 different cards, one copy | S15 text (local copy); 4,763 of 4,763 Untapped meta lists have 12 distinct ids; 15 live deck codes on the Marvel Snap Zone tier list of 2026-11-08 each decode to 12 distinct cards | Confirmed |
| What makes a card undeckable | Untapped rule (`collectible`, `series > 0`, started timestamp): 511 deckable, 31 upcoming, 249 tokens / mode copies / created skills | Corrected: rule and count added to 1.1 |
| Skill cards: deckable? count toward 12? cap? | Official patch notes 2025-03-04 (fetched); `isSkill` in the dump; meta lists | Corrected: was "cap UNCONFIRMED", now deckable, counts toward 12, no cap stated, 5 seen |
| Starting hand 3, draw 1 per turn incl. turn 1, 9 cards seen by turn 6 (R4, R5, R7) | S15 and S13 local copies ("Before Turn 1, three cards"; "start with three cards in your hand"; "Each turn, you draw a card") | Confirmed; agrees with `deck-theory-and-creativity.md` 1.1-1.2 |
| Max hand 7, no burn (R6) | S15 local copy | Confirmed (community) |
| R10 slots per side, front row | Card text in dump (Lizard, En Sabah Nur, Prodigy, Captain Carter, Luke Cage); Marvel Snap Zone Captain Carter guide (fetched) | Corrected: was UNCONFIRMED, now 4 per side, front row = first two spots |
| R12 tie-break | S15; search results (PC Gamer, Shacknews, Twinfinite) | Corrected: single rule stated, the two wordings shown equivalent. Official wording: could not confirm |
| R14 priority and its tie-break | S15; snap.fan priority guide (fetched) | Corrected: locations, then total Power, then random. Official wording: could not confirm |
| Limbo adds a turn (R1 "cards and locations can change it") | Untapped `locations.json`: Limbo "There is a turn 7 this game." | Confirmed |
| Sanctum Showdown launch ban list (19 cards) | S13 local copy of the official post | Confirmed as the launch list |
| Sanctum Showdown current ban list | Fourth Location guide 2026-01-27 (fetched) | Corrected: later 25-card community list added; November 2026 list could not be confirmed |
| Season card list, release dates, texts (4.2) | S2 local copy; Untapped dump | Confirmed; cost/power, skill flag and timestamps added |
| Balance table 4.1, spot-check | "Old" values of 25 rows re-read from the live official posts of 2026-10-29, 2026-10-15, 2026-09-10 (Scarlet Witch Queen of Chaos, En Sabah Nur, The First Ghost Rider, Hellcow, Klaw, Leech, Entropic Havok, Wolverine Horseman of War, Thanos Fractured Frontier, Anti-Polar Magneto, Karen Page, Colleen Wing, Apocalypse, Swarm, Venus, Scorpion Brand New Day, Isca, Gambit Horseman of Death, Nicholas Scratch, The Collector, Superior Iron Man, ...); "New" values of 40 rows compared with current cost/power/text in the dump | Confirmed, 0 mismatches of 40 (includes created cards Winter Soldier 2/8, Tao Mandala 3/-, Basic Arrow +4, Apocalypse Celestials' Chosen 4/8) |
| No OTA or patch after 2026-10-29 as of today | Live `https://marvelsnap.com/news/` | Confirmed: newest post is the season post of 2026-10-30 |
| High Voltage, Grand Arena, Team Clash, Deadpool's Diner, Conquest rules and ban lists | not re-researched | Could not confirm (unchanged) |
