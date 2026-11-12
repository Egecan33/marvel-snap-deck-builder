# Mechanics and card understanding

Research date: 2026-11-12. Everything below is derived from the live card pool fetched that day, plus the
cited pages. Nothing here is taken from memory. Anything that is not a direct reading of card text or of a
cited page is marked **HEURISTIC**.

## 0. Data and how to reproduce

> **Verification note (2026-11-12).** The project's pool is the **Untapped rule: 511 cards**
> (`collectible === true && series > 0 && min(seriesStartTimestamps) <= now`, see `data-sources.md` 1.1). The build
> will not use the Marvel Snap Zone `getinfo` endpoint (its robots.txt disallows it). Every count in this file was
> measured on the 506-card Marvel Snap Zone pool below and is kept as measured; treat counts as "of 506". The 506 are
> a strict subset of the 511. Missing from it: **Arthur Pendragon, Mordred, Vampire America Chavez, Zombie Nova**
> (`released` with `source: None` in that source) and **Lancelot** (`unreleased` there). All five are released,
> collectible cards. Mephisto and Toad are correctly excluded (non-collectible, series 0 in Untapped). The source's
> ability text is also empty for 9 cards that do have text, which changes the no-ability class from 16 to 7 (see 1.2).
> `parse_cards.py` was re-run on the 511 pool; results are in 2.1.

| Item | Value |
|---|---|
| Card source | `GET https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true` (accessed 2026-11-12, 748 records) |
| Pool rule | `status == "released"` and `source != "None"` (has a Series / starter / collection-level source) |
| Pool size | **506 cards** (490 with ability text, 16 with none). Cost spread: 0:2, 1:70, 2:124, 3:128, 4:81, 5:54, 6:39, 7:6, 8:2 |
| Left out | 64 released cards with no source (Champions, team-mode variants, non-collectible cards such as Mephisto and Toad, and, wrongly, the four real cards Arthur Pendragon, Mordred, Vampire America Chavez, Zombie Nova) and 178 "unreleased" records (wrongly including Lancelot), which in this source also hold every token and skill (Rock, Demon, Mjolnir, Widow's Bite, ...) |
| Raw files | `docs/research/raw/mechanics/` (gitignored): `cards_msz.json`, `cards.json` (pool), `tokens.json` (25 non-pool cards named in pool text), fetched pages as `.html`/`.txt` |
| Scripts | `docs/research/analysis/mechanics/`: `build_pool.py`, `parse_cards.py`, `axes_edges.py`, `make_overrides.py` (Python 3 stdlib) |
| Outputs | `docs/research/analysis/mechanics/out/`: `traits.json`, `coverage.json`, `axes.json`, `axes_examples.json`, `edges.json`, `edges_summary.json`, `overrides_proposed.json`, `precision_sample_v1.txt`, `precision_sample_v2.txt` |

Run order: `build_pool.py`, `parse_cards.py`, `axes_edges.py summary`, `make_overrides.py`.
`out/traits.json`, `axes_examples.json`, `edges.json` and `overrides_proposed.json` contain card text, so they
fall under AGENTS.md rule 8 (no card data in git); they should be regenerated, not committed. `out/` is not
gitignored yet.

Web budget used: 15 requests (1 card dump, 2 guessed URLs that returned 404, 4 searches, 8 page fetches).

### Sources (all accessed 2026-11-12)

| Id | URL | Kind |
|---|---|---|
| S1 | https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true | card data (community database) |
| S2 | https://marvelsnap.com/patch-notes-may-19th-2026/ | official patch notes |
| S3 | https://marvelsnap.com/new-season-fractured-frontier/ | official season post |
| S4 | https://marvelsnap.com/new-season-vampires-vs-zombies/ | official season post |
| S5 | https://marvelsnap.com/marvel-snaps-foundational-focus/ | official developer post |
| S6 | https://marvelsnap.com/patch-notes-march-10-2026/ | official patch notes |
| S7 | https://snap.fan/news/january-26-patch/ | community datamine write-up |
| S8 | https://marvelsnapzone.com/marvel-snap-abilities-guide/ | community guide |
| S9 | https://marvelsnap.com/patch-notes-august-18-2026/ | official patch notes (nothing used) |

## 1. Glossary

"Pool" = number of pool cards carrying the class, measured by `parse_cards.py`. Where no official definition
was found within the request budget the cell says **card text only**: the meaning is what the pool texts say
and has no primary definition behind it yet.

### 1.1 Keyword headers (text before a colon)

| Class | Definition | Source | Pool |
|---|---|---|---|
| On Reveal | "Ability triggers when card is flipped on the board." Cards are revealed when they go from face down to face up. | S8 (community) | 240 |
| Ongoing | "Continuous effects on the battlefield and may even be dynamic, changing its values depending on the condition." | S8 (community) | 74 |
| Activate | Official (launch post, 2024, https://marvelsnap.com/our-first-brand-new-ability-activate/): "a new Ability that lets the player decide when the Card's text will trigger"; "Activate abilities cannot be triggered until the turn after they are played"; "Each ability can only be used once per game!"; it costs nothing. Card text agrees on once-only: Jocasta activates other cards "without using up their Activate abilities"; H.E.R.B.I.E. swaps abilities "until one is used". The post is from 2024: re-check the "turn after" timing against current card text before the engine relies on it. | official post, S1 | 33 |
| End of Turn | card text only. Fires each turn end; some work from hand ("if in hand or in play": Red Hulk, Galactus First Steps; Black Cat discards itself from hand; Makkari runs from hand). | S1 | 31 |
| Start of Turn | card text only (Mad Thinker: "Start of Turn (after drawing)"). | S1 | 8 |
| Game Start | card text only. Deck or hand changes before turn 1 (Thanos, Agamotto, Arishem, Kang, Agatha, Zombie Galacti, Shang-Chi Master of the Rings, Emperor Hulkling, High Evolutionary, Uatu, Dormammu, Sinister Six, Thanos Fractured Frontier). | S1 | 13 |
| When Destroyed | card text only. Variants "When Discarded or Destroyed" (Wolverine, X-23, Marrow) and "On Reveal and When Destroyed" (Zombie Nova: a released collectible card, in the 511 pool, missing from the 506). | S1 | 13 |
| When Discarded | card text only. | S1 | 11 |
| Objective | "A new keyword" introduced with the X-Men: Origins of Apocalypse season; you are "working toward something" and can "play an Objective card before you complete it" (S5). Datamine wording: "Post end of turn, the card will check for completion of the objectives, if so, the effect triggers once." (S7, not official). Text shape: `Objective: <requirement> -> <reward>. (progress/target)`. | S5, S7 | 12 |
| Quickdraw | "These effects are active the first turn you draw them. (Next turn if cards are already revealing.)" | S3 (official) | 4 (+ Thanos Fractured Frontier grants it to all your cards) |

### 1.2 Keywords inside sentences

| Term | Definition | Source | Pool |
|---|---|---|---|
| Empowered | "When a card's Power is permanently increased. Ongoing Power changes don't count." Setting Power to a higher value (Valkyrie) counts. | S2 (official) | 4 payoffs (Clea, Sebastian Shaw, Sub-Mariner, Venus) |
| Moveable | "You may move this while playing cards." Appears as `Moveable`, `Moveable once`, `Moveable twice`, or granted ("all cards are Moveable to this location"). | S2 (official) | 19 mention it, 10 have it as their own keyword |
| Horde +N | "Horde: Give your Zombie Horde that much Power"; a shared pool that "only goes up". The Zombie Horde is a 0/0 token card (S1, non-pool). | S4 (official) | 7 |
| Afflict | card text only: giving negative Power ("Afflict an enemy card with -2 Power"); "afflicted with negative Power" is a state other cards read (Ajax, Diamondback, Ikari). | S1 | 21 |
| Destroy | card text only; S8: "destroying your opponent's cards can be a bit more specific and may also require you to destroy your own cards". | S1, S8 | 25 destroy effects |
| Discard | card text only; S8: "cards that cause you to remove cards from your hand". | S1, S8 | 18 discard effects |
| Move | card text only; S8: "Cards can move from one location to another". | S1, S8 | 28 move effects |
| Return to hand (bounce) | card text only (Beast, Falcon, Toxin; self: Kitty Pryde, Boomerang, Deadpool, Headpool, Sabretooth). No keyword. | S1 | 8 |
| Merge | card text only: "merge this into it" (Agony), "Merge cards from your deck into this" (Blob). Trigger "When this merges" exists (Man-Spider, Peni Parker, Strange Supreme). | S1 | 9 |
| Banish | Official (patch notes 2025-03-04): "a new term and zone for cards that are gone for good: unlike destroyed and discarded cards, they won't be hopping back into the match"; "nothing that cares about discarded or destroyed cards will look at banished ones". All skills are banished after resolving. In card text: Kraglin, Mole Man, Yondu, Adamantium Infusion. No pool card pays off for banishing. | official, S1 | 4 |
| Resurrect / Revive / Regenerate / "Bring back" / "Put this back" | card text only. Four wordings for returning a destroyed or discarded card; the parser folds them into `resurrect` with a `source` (destroyed / discarded / both). | S1 | 19 effects |
| Created | card text only: cards not in the starting deck ("Your created cards cost 1 less", "created in your hand", "enemy created card"). | S1 | 10 |
| Skill | A card type, not a keyword. Official (patch notes 2025-03-04, https://marvelsnap.com/patch-notes-march-4-2025/): "Skills don't have Power, and are banished (gone forever) after taking effect"; banished "After their own On Reveal effects, but before any cards or locations that take effect after a card is played. Basically other cards will see them as played cards, but they won't remain in play". Collectible skills **go in decks and count toward the 12** (11 are in the 511 pool; 1,285 of 4,763 Untapped meta lists hold one; see `rules-and-formats.md` 1.1). Cards that name skills: Nicholas Scratch "After you play a skill", Scarlet Witch Queen of Chaos "Add an EXTREMELY random skill". Marvel Snap Zone has no type flag (every record is `Character`); **the Untapped dump has `isSkill`** (61 rows) and writes skill power as 0. | official, Untapped | 2 name skills; 11 skills in the 511 pool |
| front row / back row | Each side of a location has 4 spots in two rows of two; the front row is the first and second spots, the back row the third and fourth (Marvel Snap Zone, 2025-04-01: "The back row refers to the third and fourth spots on a location"). Consistent with card text: En Sabah Nur's "full front row at each location" counts to 6; Prodigy "If this is in the back row, copy the text of the card in front of it". Authority: `rules-and-formats.md` R10. No official definition found. | S1, community | 8 |
| Max Energy / Energy next turn / bonus Energy / unspent Energy | card text only. Three different things in text: permanent `+1 Max Energy` (7 cards), `+1 Energy next turn` (one-shot), and "bonus Energy" (3 cards: Entropic Havok, Jim Hammond, Quicksand). 10 cards read "unspent Energy". | S1 | see text |
| Steal Power | card text only ("Steal 1 Power from ..."); Vampire Deacon Frost counts "cards [that] have stolen Power". | S1 | 10 |
| Switch sides | card text only (Green Goblin, Hobgoblin, Titania, Viper, Annihilus). | S1 | 5 |
| Transform / Become a copy / Unlock the potential | card text only. | S1 | 7 |
| Recruit / Pull | card text only (Baron Zemo recruits from the opponent's deck; Doctor Octopus pulls from the opponent's hand). | S1 | 2 |
| Copy text / steal text / remove text | card text only. "text" and "abilities" are both used ("Remove the text from", "Remove the abilities from"). | S1 | 16 / 3 / 10 |
| No ability | **7 cards** in the Untapped dump: Abomination, Cyclops, Hulk, Misty Knight, Shocker, The Thing, Wasp. Corrected 2026-11-12: the Marvel Snap Zone data showed 16 because its ability field is empty for 9 cards that have text (Batroc the Leaper, Black Knight, M'Baku, Martyr, Nebula, Negasonic Teenage Warhead, Scream, The Collector, Weapon X Wolverine; e.g. The Collector "When a card enters your hand from anywhere (except your deck), +1 Power.", also printed in the official 2026-09-10 balance post). Every "16" below (1.4, the `no_ability` axis, 2.1 pool percentages, edges that use the class) inherits this error. | Untapped | 7 |

Not in the released pool but visible in the data: S7's summary of an October 2026 datamine mentions
"Frontline/Backline" keywords as not final. Treat as unconfirmed.

### 1.3 Functional classes (no keyword; parser effect kinds)

| Class | Parser kind(s) | Pool effects | Example (exact text) |
|---|---|---|---|
| Add to location (summon tokens) | `gen_board` | 18 | Squirrel Girl: "On Reveal: Add a 1-Power Squirrel to each other location." |
| Put a real card into play | `summon` | 17 | Jubilee: "On Reveal: Add the top card of your deck to this location." |
| Add to hand | `gen_hand`, `copy_card` into hand | 28 + 11 | Agent 13: "On Reveal: Add a random card to your hand." |
| Add to deck | `gen_deck` | 7 | Thor: "On Reveal: Shuffle Mjolnir into your deck." |
| Cost reduction | `cost_reduce` | 40 (12 are self-discounts) | Zabu: "On Reveal: Give each 4-Cost card in your deck -1 Cost." |
| Energy gain / ramp | `energy_gain`, `energy_max` | 11 + 6 | Electro: "On Reveal: +1 Max Energy. Ongoing: You can only play 1 card a turn." |
| Copy | `copy_card`, `copy_text` | 17 + 16 | Moon Girl: "On Reveal: Copy your hand." |
| Steal | `power_steal`, `steal_text`, summon from enemy deck | 10 + 3 + 1 | Rogue: "On Reveal: Steal the text from an enemy Ongoing card here." |
| Junk / clog | `junk_board`, `junk_hand`, `junk_deck`, `opp_draw` | 3 + 2 + 3 + 1 | Master Mold: "On Reveal: Add 2 Sentinel to your opponent's hand." |
| Lockdown | `lockdown` | 9 | Professor X: "Ongoing: Moving is the only way to add or remove a character from here." |
| Location control | `loc_change`, `loc_power` | 7 + 6 | Scarlet Witch: "On Reveal: Replace this location with a new one." |
| Protection | `protect` | 6 | Armor: "Ongoing: Cards here can't be destroyed." |
| Tech vs Ongoing | `silence`/`steal_text` naming Ongoing | 4 | Enchantress: "On Reveal: Remove the abilities from all Ongoing cards here." |
| Tech vs On Reveal | `deny_on_reveal`, text removal of unrevealed cards | 1 + 1 | Cosmo: "Ongoing: On Reveal abilities won't happen here." |
| Tech vs other keywords | `silence` | 2 | Ghost (End of Turn), Super-Adaptoid (steals Activate) |
| Draw / tutor | `draw` | 11 | Jane Foster Mighty Thor: "On Reveal: Draw all cards that cost 0 from your deck." |
| Delayed reveal | `reveal_delay` | 3 | Invisible Woman: "Ongoing: Cards you play here are not revealed until the game ends." |

### 1.4 Rule interactions that matter for scoring (each is a reading of pool text)

| Interaction | Evidence in pool text | Consequence for the engine |
|---|---|---|
| On Reveal repetition | Wong "Your On Reveal abilities here repeat"; Odin, Misery "Repeat the On Reveal abilities of your other cards here"; Grand Master "Its ability happens again"; Joaquin Torres (1-Cost only) | location-scoped ("here"): the amplifier and the carrier must share a location |
| On Reveal copying | Absorbing Man "If the last card you played has an On Reveal, copy its text. (if able)"; Astral Projection (from hand); Chameleon (revealed this turn) | depends on play order ("last card you played") |
| Ongoing repetition | Onslaught "Your other Ongoing effects here apply an additional time"; Moonstone (3-Cost or less, here); Mystique copies an Ongoing text | location-scoped; Onslaught says "other" |
| Counters to the above | Cosmo stops On Reveal "here" for everyone; Enchantress removes "all Ongoing cards here" (both sides); Ghost removes End of Turn "here"; Alioth / Cosmic Ghost Rider / Red Guardian remove enemy text only | own Cosmo / Enchantress / Ghost hit own cards at that location |
| "No abilities" as a resource | Patriot "+2 Power" to cards with no abilities; High Evolutionary "Unlock the potential"; Selene Horseman of Famine objective "3 cards with no abilities in play" | the 7 no-ability cards (see 1.2) are enablers, not filler |
| Cost clamps | "(maximum 6)" on Iceman, Sandman, Gorgon; "(minimum 1)" on Quinjet, Sera, Ravonna Renslayer; Wave "cost a maximum of 4"; Mobius M. Mobius blocks increases for you and reductions for the opponent | reducers with "(minimum 1)" do nothing for 1-Cost cards |
| Play restrictions | Crossbones (only where winning), Cull Obsidian (only where you have a 1-Cost card), Giganto (left location only), Ikari (only where an enemy is afflicted), Sentry (not the right location), Ebony Maw (not after turn 3), The Infinaut (not if you played a card last turn) | each needs a deck-level check that the condition is reachable |
| Play-count limits | Electro "You can only play 1 card a turn"; Jean Grey "Players must play their first card here each turn"; Ebony Maw "You can't play cards here"; Goose "Nobody can play cards that cost 4 or more here"; Storm; Professor X; Stardust "Cards can't be added to locations except by playing or moving them" | conflicts with multi-play payoffs and with add-to-location effects |
| Bypass | Jeff the Baby Land Shark "Nothing can stop you from moving or playing this to any location"; War Machine "Nothing can stop you from playing cards anywhere" | answers to the row above |
| Full-side conditions | Ant Man, Human Torch First Steps, The Thing First Steps ("if your side here is full"), Dazzler, Elsa Bloodstone, Mojo ("both sides"), Lizard ("if your opponent has 4 cards here") | a side holds 4 cards (Lizard's text; settled in `rules-and-formats.md` R10). Skills do not occupy a spot after resolving |
| Alone conditions | Namor, Orka ("your only card here"), Namora, Namorita, Galactus, Warpath ("any of your locations are empty") | conflict with cards that add bodies to other locations |
| Turn references | Daredevil (turn 5), Arishem (turn 3), Domino (turn 2), Magik (not after turn 5), Baron Mordo (until turn 6), Agatha (even turns), Starhawk (odd turn) | the turn count is referenced up to 6; game length rule not fetched here |
| Hand effects that work from hand | "(if in hand or in play)": Clea, Sub-Mariner, Red Hulk, Galactus First Steps; "(if in hand, in deck, or in play)": Sebastian Shaw | hand buffs count as Empowered triggers for these |

## 2. Text parser prototype

`parse_cards.py` splits a text into keyword segments, then sentences, and turns each sentence into a clause:
`trigger` + `effects[] {kind, target, magnitude, scope/source}` + `conditions[]` + `scaling[]` ("for each
...") + `selectors[]` (highest-Power, N-Cost, created, ...) + `durations[]`. Parentheticals are kept as notes.
30 trigger values, 51 effect kinds, 23 target values, 39 named conditions, 26 named scaling sources.

Targets: `self`, `own_here`, `own_anywhere`, `own_other_locations`, `own` (side for created/summoned cards),
`own_hand`, `own_deck`, `own_player`, `own_next_played`, `own_played_card`, `own_drawn_card`, `enemy_here`,
`enemy_anywhere`, `enemy_hand`, `enemy_deck`, `enemy_player`, `enemy`, `all_here`, `all_anywhere`, `both`,
`location`, `moved_card`, `any_played_card`.

### 2.1 Coverage (3 passes, then stopped)

| Measure | Pass 1 | Pass 3 (final) |
|---|---|---|
| Cards with text | 490 | 490 |
| Cards with >= 1 trait (effect or static trigger) | 98.6% | **98.8%** (484/490) |
| Cards fully parsed, of cards with text | 84.9% | **96.5%** (473/490) |
| Cards fully parsed, of pool (no-ability cards count as parsed) | 85.4% | **96.6%** |
| Clauses | 580 | 580 |
| Clauses fully parsed | 85.7% | 96.2% |
| Clauses with >= 1 effect | 96.0% | 96.9% |

**What "fully parsed" means, and its limit.** It is a token-level claim: every word of every sentence was
consumed by an effect core, trigger phrase, condition, scaling phrase, selector, target phrase, duration or
a function word, and no condition or scaling fell into the generic `other` bucket. It does not prove the
phrases were attached to the right effect. The target-phrase and function-word lists are generous, so this
number overstates understanding.

**Hand-check of parsed traits.** 40 random fully-parsed cards (seed 2026): 34 correct, 6 with a wrong or
incomplete effect target (Wade Wilson, Tarantula, Mirage, Captain Britain, Wolverine Horseman of War,
Shadowlands Daredevil). **Trait precision at card level: 85% (34/40).** All six errors are target attachment,
not effect kind. Other known mis-targets found while auditing by kind: Annihilus (destroy), Sandman (cost
increase), Jane Foster Fractured Frontier, Zombie Giant-Man.

Cards with text but no effect at all (6): Bruce Banner, Dormammu, H.E.R.B.I.E., Nico Minoru, Punisher War
Machine, Thanos Fractured Frontier.

**Re-run on the Untapped-rule pool (verification, 2026-11-12).** `parse_cards.py` unchanged, input swapped for the
511 Untapped cards (markup stripped, `<sprite=0>` mapped to the Objective arrow, flavour-only text treated as empty;
output written outside the repo): 504 cards with text, 7 without; cards with at least one trait 98.4% of cards with
text; **fully parsed 93.5%** of cards with text and of the pool; 596 clauses, 93.8% fully parsed, 96.0% with an
effect. The drop from 96.5% has two causes, neither a parser regression: the 9 cards the 506 pool wrongly had as
text-less are one-off sentences (Batroc, Black Knight, M'Baku, Martyr, Nebula, The Collector, Weapon X Wolverine
fail), and the Untapped text drops dynamic numbers ("cost  from your deck", "It costs .", see `data-sources.md`
1.1), which breaks about 9 more sentences. 37 distinct unparsed sentences on this pool against 22 before. `axes_edges.py`
and `make_overrides.py` were **not** re-run on the 511 pool, so sections 3 to 5 are still 506-pool numbers.

### 2.2 Unparsed sentences (22, each occurs once)

| Card | Sentence |
|---|---|
| Agatha Harkness | She controls your cards on even turns. |
| Aurora | Repeat for Ongoing, Activate, and End of Turn. |
| Bruce Banner | If you have unspent Energy, 33% chance to HULK OUT! |
| Dormammu | Begin a Summoning Ritual. |
| Galactus First Steps | My Herald is the next character I see you play. / +2 Power if you're winning my Herald's location. |
| Gwenpool | Pick a random character in your hand 3 times. |
| H.E.R.B.I.E. | Each turn this is in play, swap to a new Activate ability until one is used. |
| Jane Foster Fractured Frontier | Judge 4 other random characters. / Judge the worthy again. |
| Magik | Doesn't work after turn 5. |
| Nico Minoru | After you play your next card, cast a spell. |
| Psylocke Fractured Frontier | Your whole hand instead. |
| Punisher War Machine | When drawn, mark one of your empty locations. / Objective reward "+1 Max Energy" (the source drops the arrow, so requirement and reward were not split) |
| Sam Wilson Captain America | Cap's Shield is Moveable. |
| Sinister Six | The first 6 characters you draw are EVIL! / After you play them all, merge them into this and add this to the last one's location. |
| Techno-Organic Virus | Infect your other cards here. |
| Thanos Fractured Frontier | Your cards have "Quickdraw: Thanos loads an Infinity Shot." / Fire all loaded Shots. |
| Zombie Galacti | Choose 6 other characters in your deck. |

Because every unparsed sentence is unique, more regex passes would only add one-card rules. These belong in
the overrides file (section 5).

## 3. Enabler / payoff axes

32 axes, derived from which trait patterns occur on both a "does it" and a "rewards it" side in the pool.
Counts are from `axes_edges.py`. E = enablers, P = payoffs, B = both. H marks axes whose enabler or payoff
side is a heuristic rather than a reading of text. Five example cards per side with exact text are in
`out/axes_examples.json`; names are listed here to stay inside the page budget, with one exact text each.

| Axis | E | P | B | Enabler pattern | Payoff pattern | Examples E / P |
|---|---|---|---|---|---|---|
| destroy | 15 | 29 | 2 | `destroy` on own / all / both | When Destroyed, on_other_destroyed, destroyed counts, resurrect from destroyed | Arnim Zola, Attuma, Carnage, Deathlok, Destroyer / Adamantium Infusion, Air-Walker, Angel, Archangel Horseman of Death, Bucky Barnes |
| discard | 16 | 20 | 1 | `discard` on own hand / both | When Discarded, discard counts, resurrect from discarded | Blade, Bullseye, Colleen Wing, Corvus Glaive, Dracula / Apocalypse, Colonel America, Fantomex, Firelord, Ghost Rider |
| move | 38 | 19 | 7 | moves own cards, grants Moveable, or moves itself | "When this moves", move counts, "moved last turn" | Arana, Captain Marvel, Cloak, Doctor Strange, Drax Avatar Of Life / Aunt May, Dagger, Friendly Neighborhood Carnage, Hercules, Human Torch |
| bounce (H) | 3 | 83 | 0 | returns own cards to hand | "When this returns", On Reveal cards costing <= 2 (heuristic) | Beast, Falcon, Toxin / Agent 13, Agent Venom, America Chavez, Baron Mordo, Bast |
| on_reveal_amp | 12 | 240 | 7 | `repeat_on_reveal`, On Reveal text copy | carrier: any On Reveal card | Absorbing Man, Astral Projection, Firehair, Grand Master, Joaquin Torres Falcon II / (any On Reveal) |
| on_reveal_count | 240 | 4 | 1 | any On Reveal card | counts or rewards On Reveal cards | (any On Reveal) / Aurora, Gorr the God Butcher, Stryfe, Zombie Blade |
| ongoing_amp | 6 | 68 | 4 | `repeat_ongoing`, Ongoing text copy, buffs to Ongoing cards | carrier: Ongoing card that is not a drawback | Captain America, Goliath, Moonstone, Mystique, Onslaught / Ajax, Ant Man, Armor, Blue Marvel, Caiera |
| end_of_turn_amp | 3 | 31 | 0 | repeats or buffs End of Turn cards | carrier: End of Turn card | Aurora, Fantasticar, Invisible Woman First Steps / Adam Warlock, Attuma, Aunt May, Black Cat, Bruce Banner |
| activate_amp | 2 | 33 | 1 | `repeat_activate` | carrier: Activate card | Aurora, Jocasta / Arana, Askani'son, Awesome Andy, Black Swan, Black Widow |
| one_cost | 72 | 10 | 0 | base cost 1, or creates 1-Cost cards | own-side clause naming 1-Cost cards | Agent 13, Agony, America Chavez, Ant Man, Arana / Black Swan, Bullseye, Caiera, Cull Obsidian, Falcon |
| go_wide (H) | 33 | 10 | 0 | adds bodies to own side | full-side conditions, per-location counts, global Ongoing buff | Air-Walker, Anti-Polar Magneto, Arnim Zola, Askani'son, Blink / Ant Man, Blue Marvel, Dazzler, En Sabah Nur, Human Torch First Steps |
| hand_size | 49 | 12 | 0 | adds cards to hand, bounce, draw | per-card-in-hand scaling, "hand is full", whole-hand buffs | Adam Warlock, Agatha Harkness, Agent 13, Agent Coulson, Bastion / Bast, Devil Dinosaur, Headpool, Kahhori, Mad Thinker |
| empower | 52 | 8 | 0 | non-Ongoing buff to own cards | Empowered triggers, "increased Power" | Adamantium Infusion, Agent Venom, America Chavez, Anti-Venom, Arana / Clea, Gilgamesh, Jack Flag, Sebastian Shaw, Sub-Mariner |
| cost_reduction (H) | 28 | 93 | 3 | reduces cost of own hand / deck | base cost >= 5 without self-discount (heuristic) | Anti-Venom, Aunt May, Bastion, Beast, Black Swan / Aero, Agamotto, Agatha Harkness, Ajax, Alioth |
| energy_ramp (H) | 13 | 41 | 1 | energy gain / Max Energy for self | base cost >= 6 (heuristic) | Arishem, Corvus Glaive, Electro, Hope Summers, Jennifer Kale / Agatha Harkness, Alioth, Anti-Polar Magneto, Apocalypse, Arishem |
| unspent_energy | 9 | 9 | 1 | extra energy, skip-a-turn cards | unspent / bonus Energy conditions and scaling | Hope Summers, Jennifer Kale, Kraglin, Peni Parker, Psylocke / Bruce Banner, Jim Hammond Human Torch, Lady Bullseye, Magus, She-Hulk |
| affliction | 18 | 5 | 1 | afflicts enemy / all cards | reads afflicted cards | Bullseye, Caliban Horseman of Pestilence, Diamondback, Fantomex, Fastball Special / Ajax, Diamondback, Ikari, Polaris Horseman of Pestilence, Scorpion Brand New Day |
| self_affliction | 8 | 4 | 0 | afflicts own cards, or negative base Power | switch sides, Power-reduction immunity | Hazmat, Hellcow Fractured Frontier, Man-Thing, Mister Negative, The Hood / Annihilus, Luke Cage, Polaris Horseman of Pestilence, Viper |
| created_cards | 70 | 9 | 0 | creates cards (hand, deck, board) | own-side clause naming created cards | Agamotto, Agent 13, Agent Coulson, Arishem, Arnim Zola / Eson, Gambit Horseman of Death, King Eitri, Mockingbird, Ozymandias |
| junk_clog | 13 | 5 | 0 | junk to enemy side / hand / deck, pulls enemies in | scaling on enemy hand / deck / cards here, both sides full | Aero, Black Widow, Doctor Octopus, Gladiator, Korg / Dagger, Darkhawk, Mojo, Punisher, Ronan the Accuser |
| location_control (H) | 11 | 53 | 1 | lockdown, location change | bypass: movers, add-to-other-location (heuristic) | Galactus, Goose, Jean Grey, Legion, Magik / Anti-Polar Magneto, Arana, Arnim Zola, Askani'son, Captain Marvel |
| merge | 9 | 3 | 3 | any merge | "When this merges" | Agony, Blob, Hulkbuster, Man-Spider, Peni Parker / Man-Spider, Peni Parker, Strange Supreme |
| skills | 1 | 1 | 0 | text adds a "skill" | "After you play a skill" | Scarlet Witch Queen of Chaos / Nicholas Scratch |
| deck_top | 9 | 11 | 0 | buffs / discounts own deck or its top card | puts deck cards into play, reads the top card | Agent Venom, America Chavez, Anti-Venom, Loki, Okoye / Ares, Blink, Blob, Iron Lad, Jubilee |
| draw | 7 | 9 | 0 | extra draw | "When you draw", Quickdraw | Adam Warlock, Agatha Harkness, Crystal, Jane Foster Mighty Thor, King Eitri / Copycat, Jane Foster Fractured Frontier, Jubilee Silver Surfer, Namorita, Psylocke Fractured Frontier |
| no_ability | 16 | 3 | 0 | empty text | names cards with no abilities | Abomination, Batroc the Leaper, Black Knight, Cyclops, Hulk / High Evolutionary, Patriot, Selene Horseman of Famine |
| power_steal | 10 | 1 | 0 | steals Power | "cards have stolen Power" | Boomerang, Cassandra Nova, Dragon of the Moon, Laufey, Rocket and Groot / Vampire Deacon Frost |
| horde | 6 | 2 | 1 | Horde +N | reads the Zombie Horde | The Hunger, Zombie Giant-Man, Zombie Mister Fantastic, Zombie Scarlet Witch, Zombie Sentry / Zombie Blade, Zombie Giant-Man |
| big_power | 34 | 5 | 1 | base Power >= 10 | own-side "N or more Power" filter | Agamotto, Agatha Harkness, Apocalypse, Attuma, Crossbones / Blob, Shadowlands Daredevil, Skaar, Surtur, Thaddeus Ross |
| multi_play (H) | 76 | 15 | 1 | cost <= 1, bounce, free cards (heuristic) | "After you play a card", cards-played counts | Agent 13, Agony, America Chavez, Ant Man, Arana / Agony, Angela, Bishop, Elsa Bloodstone, Ezekiel Sims |
| alone (H) | 14 | 6 | 0 | clears own lane (heuristic) | "your only card here", empty location | Arnim Zola, Attuma, Beast, Carnage, Deathlok / Galactus, Namor, Namora, Namorita, Orka |
| sequencing (H) | 12 | 45 | 1 | Power effect on next / last card played | base Power >= 9 (heuristic) | Arana, Forge, Kid Omega, Man-Spider, Maverick / Aero, Agamotto, Agatha Harkness, Apocalypse, Attuma |

One exact text per axis family, to show the pattern: destroy P Deadpool "When Destroyed: Return this to your
hand with double the Power."; discard P Apocalypse "When Discarded: Put this back with +4 Power."; move P
Human Torch "When this moves, double its Power."; one_cost P Ka-Zar "Ongoing: Your 1-Cost cards have +1
Power."; hand_size P Devil Dinosaur "Ongoing: +2 Power for each card in your hand."; empower P Sebastian
Shaw "When this is Empowered, gain an additional +2 Power. (if in hand, in deck, or in play)"; affliction P
Ajax "Ongoing: +1 Power for each card in play afflicted with negative Power."; created_cards P Mockingbird
"Costs 1 less for each of your created cards in play."; unspent_energy P Sunspot "End of Turn: Gain +1 Power
for each unspent Energy."; no_ability P Patriot "Ongoing: Your cards with no abilities have +2 Power.";
alone P Namor "Ongoing: +5 Power if this is your only card here."; big_power P Surtur "After you play a card
with 10 or more Power, this gains +2 Power."

Non-axis tech roles (in `axes.json` under `_tech`): ongoing removal 4, enemy text removal 6, On Reveal
denial 1, enemy destroy 9, enemy discard 3, enemy cost increase 3, enemy displace 7, lockdown 9, protection
6, play-restricted 7, drawback cards 13 (Attuma, Destroyer, Ebony Maw, Electro, Havok, Hellcow Fractured
Frontier, Lizard, Maximus, Red Skull, Starbrand, Tombstone, Typhoid Mary, Yellowjacket).

Axes found to be payoff-less in the pool: **banish** (4 enablers, no card rewards banishing) and **skills**
(one enabler, one payoff by text). Corrected 2026-11-12: the skill type **is** in the Untapped data (`isSkill`), so
the 11 deckable skills are enablers for Nicholas Scratch and the axis is not payoff-less; it was not rebuilt here.
The `no_ability` axis lists 16 enablers; only 7 are real (1.2).

## 4. Pair-interaction rules

### 4.1 Rule templates

Strength is 1 to 3. S = synergy, A = anti-synergy. All of these are implemented in `axes_edges.py`.

| Rule id | A trait | B trait | Kind | Str | Why |
|---|---|---|---|---|---|
| axis:* (32) | axis enabler | axis payoff | S | 1-3 | section 3; guards: self-movers only feed move counters; created-card payoffs need the right zone (hand / deck / board / Rocks); filtered cost reducers are left to filter:cost; filtered destroyers must be able to hit B |
| filter:cost | own-side buff / discount / protect / repeat / play condition naming N-Cost | B's base cost matches | S | 3 (exact) / 2 (range) | Zabu x 4-Cost, Ka-Zar x 1-Cost, Jane Foster Mighty Thor x 0-Cost |
| filter:power | own-side clause naming "N or more / less Power" | B's base Power matches | S | 3 / 2 | Surtur, Skaar, Thaddeus Ross x 10+ Power |
| discard:selector_hit | discard with selector (highest cost, lowest cost, odd, even, cost <= 1) | When Discarded card the selector points at | S | 2 | Lady Sif x Apocalypse; Sword Master x odd-cost payoffs |
| discard:selector_miss | same | When Discarded card the selector will not pick | A | 1 | Colleen Wing x Helicarrier |
| mass:destroy_feeds | mass destroy with cost / Power filter | matching When Destroyed card | S | 2 | Killmonger x Nova |
| mass:hits_own | mass destroy / afflict / lockdown with filter on all cards | own card that matches | A | 2 / 1 | Killmonger x own 1-Cost; U.S. Agent x own 4+ Cost; Goose |
| syn:remove_own_drawback | removes own text (Zero, Sauron; Enchantress here) | drawback card | S | 3 / 2 | Zero x Typhoid Mary |
| anti:silences_own_ongoing | Sauron (deck) / Enchantress (here) | own non-drawback Ongoing | A | 2 / 1 | Ongoing-heavy deck with own Ongoing removal |
| anti:silences_own_end_of_turn | Ghost | own End of Turn card | A | 1 | same idea for End of Turn |
| anti:cosmo_own_on_reveal | Cosmo | own On Reveal card | A | 1 | location-scoped |
| anti:protect_blocks_when_destroyed | Armor / Caiera (1 and 6-Cost) | When Destroyed card (matching cost) | A | 1 / 2 | the trigger never fires |
| anti:protect_blocks_destroyer | Armor | destroys own cards here | A | 2 | destroy plan blocked at that location |
| anti:discard_vs_hand_size | discards own hand | hand-size payoff | A | 2 | M.O.D.O.K. x Devil Dinosaur |
| syn:discard_small_hand | discards own hand | wants <= 1 card in hand (Strong Guy) | S | 2 | |
| anti:discard_hits_key_card | discards highest cost / whole hand | cost >= 5 card with no discard payoff | A | 2 | discard that hits your own key cards |
| anti:filler_vs_alone | adds bodies to other locations | alone / empty-location payoff | A | 2 | Ultron x Namor |
| anti:filler_vs_space | same | resurrect / summon that needs free slots | A | 1 | cards that fill own locations vs cards needing space |
| anti:one_card_a_turn | Electro | multi-play payoff | A | 3 | "You can only play 1 card a turn" |
| syn:one_card_a_turn | Electro | wants exactly 1 card played | S | 2 | Moondragon, Doctor Doom 2099 |
| anti:junk_feeds_penalty | adds / moves cards onto the enemy side | loses Power per enemy card (Lizard, Red Hulk Fractured Frontier) | A | 2 | clog that turns on your own penalty |

Deck-level checks that are not pairs (stored as axis roles, to be evaluated on a whole list): a payoff with
zero enablers in the deck (destroy, discard, move, merge, created, horde, power_steal, no_ability, affliction);
6-drop plans without ramp or reduction; play-restricted cards whose condition no other card helps to meet.

Pair weight = strength / log2(2 + sqrt(fanout_A x fanout_B)) under that rule, so narrow relationships
(Patriot x Hulk) outrank broad ones (Wong x any On Reveal card). **HEURISTIC.** Pair score = sum of synergy
weights minus anti weights.

### 4.2 Result on the pool

| Measure | Value |
|---|---|
| Edges (card, card, rule) | **16,398** (14,321 synergy, 2,077 anti-synergy) |
| Distinct pairs | 14,826 of 127,765 possible (11.6%); 12,868 net positive, 1,958 net negative |
| Largest rules | axis:on_reveal_amp 2,394; filter:cost 1,726; axis:multi_play 1,096; axis:on_reveal_count 959; mass:hits_own 892; axis:cost_reduction 835 |

The 30 strongest pairs by score:

| # | Pair | Score | Rules |
|---|---|---|---|
| 1 | Bast + Falcon | 1.959 | bounce, one_cost, hand_size, filter:cost |
| 2 | Falcon + Majestic Wingbeat | 1.959 | bounce, one_cost, hand_size, filter:cost |
| 3 | Bullseye + Scorn | 1.890 | discard, one_cost, discard:selector_hit |
| 4 | Bullseye + Swarm | 1.890 | discard, one_cost, discard:selector_hit |
| 5 | Bullseye + X-23 | 1.890 | discard, one_cost, discard:selector_hit |
| 6 | Hazmat + Polaris Horseman of Pestilence | 1.874 | affliction, self_affliction |
| 7 | Hellcow Fractured Frontier + Polaris Horseman of Pestilence | 1.874 | affliction, self_affliction |
| 8 | Polaris Horseman of Pestilence + U.S. Agent | 1.874 | affliction, self_affliction |
| 9 | Peni Parker + Strange Supreme | 1.814 | created_cards, merge |
| 10 | Agatha Harkness + Shadowlands Daredevil | 1.793 | draw, big_power, filter:power |
| 11 | Shadowlands Daredevil + Sinister Six | 1.793 | draw, big_power, filter:power |
| 12 | Zombie Blade + Zombie Giant-Man | 1.790 | on_reveal_count, horde |
| 13 | Jane Foster Mighty Thor + Wasp | 1.693 | filter:cost |
| 14 | Jane Foster Mighty Thor + Yellowjacket | 1.693 | filter:cost |
| 15 | Man-Thing + Polaris Horseman of Pestilence | 1.665 | affliction, self_affliction, mass:hits_own |
| 16 | Sword Master + Zombie Black Cat | 1.662 | discard, discard:selector_hit |
| 17 | Moon Knight + Proxima Midnight | 1.624 | discard, discard:selector_hit |
| 18 | The Hunger + Zombie Blade | 1.621 | on_reveal_count, horde |
| 19 | Zombie Blade + Zombie Mister Fantastic | 1.621 | on_reveal_count, horde |
| 20 | Zombie Blade + Zombie Sentry | 1.621 | on_reveal_count, horde |
| 21 | Zombie Blade + Zombie Venom | 1.621 | on_reveal_count, horde |
| 22 | King Eitri + Shadowlands Daredevil | 1.577 | created_cards, draw |
| 23 | Apocalypse + Lady Sif | 1.575 | discard, discard:selector_hit |
| 24 | Helicarrier + Lady Sif | 1.575 | discard, discard:selector_hit |
| 25 | Khonshu + Lady Sif | 1.575 | discard, discard:selector_hit |
| 26 | Lady Sif + Weapon H | 1.575 | discard, discard:selector_hit |
| 27 | Sinister Six + Skaar | 1.567 | big_power, sequencing, filter:power |
| 28 | Shadowlands Daredevil + Stryfe | 1.554 | on_reveal_amp, on_reveal_count, filter:power |
| 29 | Falcon + Kitty Pryde | 1.547 | bounce, one_cost, filter:cost |
| 30 | Odin + Shadowlands Daredevil | 1.542 | on_reveal_amp, big_power, filter:power |

Reading of the top list: the discard-selector, horde, merge, 0-Cost tutor and affliction-objective pairs are
real and specific. Shadowlands Daredevil is over-ranked: its "6 or more Power" filter matches about a third
of the pool and the recipient of its +2 Power is not stated (section 5). Stacking several generic rules
(Falcon rows) still outranks single precise rules; the scoring needs calibration against meta data.
Most negative pairs: Electro with each multi-play payoff (-1.175 after weighting), then Devil Dinosaur with
M.O.D.O.K. / Lady Sif.

### 4.3 Hand-check of 30 random edges (honest numbers)

Each sampled edge was judged against both exact texts as **correct** (a real interaction a player could use
or must avoid), **weak** (true but generic or dependent on sharing a location) or **wrong**.

| Sample | Correct | Weak | Wrong | Strict precision | Lenient precision |
|---|---|---|---|---|---|
| v1: first rule set, seed 20261112 (19,858 edges) | 17 | 6 | 7 | **57%** | 77% |
| v2: after 5 fixes, seed 4242 (16,505 edges) | 21 | 5 | 4 | **70%** | 87% |

v1 errors and what they led to: Luna Snow x Eson (created on board, payoff needs hand: zone guard added);
Ezekiel Sims x Human Torch (a self-mover does not move another card: guard added); Black Swan x Leader and
Loki x Magneto (filtered or deck-replacing reducers treated as generic: guard added); Rama-Tut x Jessica
Jones (not a repeater of own cards: excluded); Ebony Maw x Zombie Sentry and The Hood x Caiera (cost <= 1 as
a "go wide" body; removed from go_wide, The Hood case remains).

v2 errors: Joaquin Torres x Moira X and x Agony (1-Cost cards without an On Reveal), Nova x Werewolf By Night
(payoff needs an On Reveal), Killmonger x Marrow (cost 2, not hit). Three guards for these were added
afterwards; **the final 16,398-edge set has not been re-sampled**, so 70% strict is the last measured number.
The lists of all 60 judged edges are in `out/precision_sample_v1.txt` and `_v2.txt`.

Weak edges cluster in location-scoped anti rules (Cosmo, Lady Deathstrike, U.S. Agent, filler_vs_space) and
in the heuristic axes (energy_ramp, cost_reduction, sequencing, multi_play). The build should either drop
strength-1 heuristic edges from pair scoring or show them as "soft" with the heuristic label (AGENTS.md rule 5).

## 5. Cards for the reviewed overrides file (46)

Machine-readable copy with the parser's current reading: `out/overrides_proposed.json`. Text is exact (S1).

| Card | Cost/Power | Text | Why review |
|---|---|---|---|
| Agatha Harkness | 6/12 | Game Start: Draw Agatha. She controls your cards on even turns. | unique control effect |
| Aurora | 6/5 | On Reveal: Give one of your other On Reveal cards at each location +2 Power. Repeat for Ongoing, Activate, and End of Turn. | elliptical second sentence |
| Bruce Banner | 2/1 | End of Turn: If you have unspent Energy, 33% chance to HULK OUT! | result not in text |
| Dormammu | 7/13 | Game Start: Begin a Summoning Ritual. (Add step 1 to hand.) | multi-step, steps are non-pool cards |
| Galactus First Steps | 6/11 | My Herald is the next character I see you play. End of Turn: +2 Power if you're winning my Herald's location. (if in hand or in play) | unique designation |
| Gwenpool | 4/5 | On Reveal: Pick a random character in your hand 3 times. Give +2 Power each time. | two-sentence loop |
| H.E.R.B.I.E. | 2/3 | Each turn this is in play, swap to a new Activate ability until one is used. | abilities not in text |
| Jane Foster Fractured Frontier | 3/3 | On Reveal: Judge 4 other random characters. +1 Power (if yours) or -1 Power (enemies). Quickdraw: Judge the worthy again. | unique verb |
| Magik | 3/2 | On Reveal: Replace this location with 'Limbo'. Doesn't work after turn 5. | named location, turn limit |
| Nico Minoru | 1/2 | On Reveal: After you play your next card, cast a spell. (The spell changes each turn.) | spells not in text |
| Psylocke Fractured Frontier | 3/4 | On Reveal: Give cards in your hand that are 5-Cost or more -1 Cost. Quickdraw: Your whole hand instead. | Quickdraw modifies the On Reveal |
| Punisher War Machine | 2/2 | When drawn, mark one of your empty locations. Objective: Win that location +1 Max Energy. | marked location; arrow lost in source |
| Sam Wilson Captain America | 2/2 | On Reveal: Add Cap's Shield to another location. Ongoing: Cap's Shield is Moveable. | token carries half the effect |
| Sinister Six | 6/12 | Game Start: The first 6 characters you draw are EVIL! After you play them all, merge them into this and add this to the last one's location. (0/6) | unique marking, delayed merge |
| Techno-Organic Virus | 2/0 | On Reveal: Infect your other cards here (replace their text). Copy this to your hand. | unique verb |
| Thanos Fractured Frontier | 5/7 | Game Start: Your cards have "Quickdraw: Thanos loads an Infinity Shot." On Reveal: Fire all loaded Shots. | quoted granted ability; Shot effect not in text |
| Zombie Galacti | 7/5 | Game Start: Choose 6 other characters in your deck. On Reveal: Transform those cards into copies of this. | choice plus mass transform |
| Arishem | 7/7 | Game Start: Shuffle 12 new cards into your deck. On turn 3, get +1 Max Energy. | changes deck size and energy curve |
| Thanos | 6/12 | Game Start: Shuffle the six Infinity Stones into your deck. | Stones are non-pool cards |
| Agamotto | 5/10 | Game Start: Shuffle 4 Ancient Arcana into your deck. | Arcana are non-pool cards |
| Kang | 3/4 | Game Start: Replace this with 4 Kangs with text from random cards that Cost 3 or more. | one slot becomes 4 random cards |
| Loki | 1/2 | On Reveal: Replace your deck with your opponent's starting deck. Give those cards -1 Cost. | invalidates deck-based synergies |
| Rama-Tut | 4/5 | On Reveal: Use 3 On Reveals from cards released before Rama-Tut's time. | not a repeater of own cards |
| Silver Surfer First Steps | 3/5 | End of Turn: If you're winning this location with an On Reveal card, copy its text. | does the copied On Reveal fire? |
| Debrii | 3/7 | On Reveal: Add a Rock to each other location. | which side(s)? |
| Shanna | 3/4 | On Reveal: Add a random 1-Cost character to each location. | which side(s)? |
| Annihilus | 5/8 | On Reveal: Your cards with Power below 0 switch sides. Destroy those that can't. | parser mis-targets the destroy |
| Sandman | 5/8 | On Reveal: Next turn, cards cost 1 more. (maximum 6) | parser mis-targets (both players) |
| Mirage | 2/3 | On Reveal: Copy the character that costs the least from your opponent's hand into your hand. Give it +2 Power. | buff recipient mis-parsed |
| Captain Britain | 2/2 | After you play a 4-Cost or more card, give it +1 Power and a card in your hand -1 Cost. | buff recipient mis-parsed |
| Wade Wilson | 2/2 | When Destroyed: Replace this with a 1-Cost card from your hand or deck with +2 Power. | buff recipient mis-parsed |
| Tarantula | 2/2 | End of Turn: If you have the highest Power among cards in play, give this and 2 characters in your hand +1 Power. | two recipients |
| Shadowlands Daredevil | 2/3 | On Reveal: Shuffle in 3 Demons. When you draw a card with 6 or more Power, +2 Power. | recipient of +2 not stated |
| High Evolutionary | 4/7 | Game Start: Unlock the potential of your cards with no abilities. | new texts live elsewhere |
| Shang-Chi, Master of the Rings | 3/5 | Game Start: The Ten Rings starts in your hand. On Reveal: Unlock their potential. | token plus hidden text |
| En Sabah Nur | 4/5 | Objective: Have a full front row at each location -> Transform into Apocalypse, Celestials' Chosen. (0/6) | becomes a non-pool card |
| Vampire Deacon Frost | 4/5 | Objective: 3 of your cards have stolen Power -> Transform into Crimson Behemoth. (0/3) | becomes a non-pool card |
| Red Onslaught | 4/4 | Ongoing: Has 3 random Ongoing abilities. | random text |
| Emperor Hulkling | 6/12 | Game Start: Copy the text of a random 6-Cost card. | random text |
| Mister Negative | 4/-1 | On Reveal: Swap the Power and Cost of all cards in your deck. | deck-wide stat inversion |
| The Living Tribunal | 6/9 | Ongoing: Split your total Power evenly among all locations. | redistributes Power |
| Captain Marvel | 4/6 | At the end of the game, move to a location that wins you the game. (If possible) | end-of-game move |
| Cerebro | 3/0 | Ongoing: Your highest-Power cards have +3 Power. | needs an "equal base Power" rule |
| Ms. Marvel | 4/5 | Ongoing: Your adjacent locations with 2+ cards and no repeated Costs have +6 Power. | distinct-cost condition per location |
| Legion | 5/7 | On Reveal: Replace each other location with this one. | location replacement |
| Daredevil | 2/3 | On turn 5, you get to see your opponent's plays before you make your own. | information only |

("->" stands for the arrow glyph the source drops between an Objective's requirement and reward.)

The 25 non-pool cards named by pool text (`raw/mechanics/tokens.json`) also need reviewed entries, because
half of several effects lives on them: Rock, Demon, Squirrel, Drone, DoomBot, DoomBot 2099, Broodling,
Sinister Clone, Winter Soldier, Zombie Horde, Ice Cube, Widow's Bite, Widow's Kiss, Mjolnir, Stormbreaker,
Sword of Fu Xi, Cap's Shield, SP//dr, Tao Mandala, The Grand Design, The Ten Rings, Flames of the Faltine,
Vampiric Spear, Apocalypse Celestials' Chosen, Crimson Behemoth. Not matched by name and still missing:
Muramasa Shard, Infinity Stones, Ancient Arcana, Incantation, Arrows, Thief's Tools, Ultron's Stones, Hawk
and Bear auroras, Sentinel copies, Illusion, Tiger, Void, Limbo.

## 6. Open questions

1. **Pool boundary. Settled 2026-11-12:** no. The rule is the Untapped one (511 cards, section 0 note). The
   "Fractured Frontier" cards are separate collectible cards in Untapped too (own `defId`, series 7/8), so keeping
   them was right. Dropping Mordred and Arthur Pendragon was wrong (both released and collectible); dropping
   Mephisto and Toad was right.
2. **Skill typing. Settled 2026-11-12:** the Untapped dump has `isSkill` on 61 rows (for example The Grand Design
   and Tao Mandala are skills; Excalibur and Winter Soldier are not).
3. **Official definitions still missing** for Game Start, End of Turn, Start of Turn, Merge, Afflict, created,
   front row / back row (community definition only), bonus Energy, Resurrect vs Revive vs Regenerate (same thing
   or not?). Activate, Banish and Skill got official text on 2026-11-12 (1.1, 1.2). No official glossary page was found; the in-game keyword tooltips would be the primary source.
4. **Objective timing** rests on a community datamine sentence (S7), not an official one.
5. **Board rules used implicitly**: cards per side of a location and game length are implied by card text
   (Lizard, turn references) but were not fetched here; the rules researcher's file should be the authority.
   Settled 2026-11-12 in `rules-and-formats.md`: 4 per side (R10), 6 turns unless text changes it (R1; Limbo:
   "There is a turn 7 this game.").
6. **Side ambiguity** in "Add X to each (other) location" (Debrii, Shanna, Luna Snow says "each side").
7. **Edge scoring** is uncalibrated: the fan-out weighting is a heuristic and 70% strict precision is too low
   for creative suggestions without filtering by rule and strength.

## Verification log (2026-11-12)

Independent pass against the Untapped dump (`raw/cards/cards.json`, re-fetched: build 58.15.3, unchanged), local
copies of the cited official posts, and four live pages. `marvelsnapzone.com/getinfo` was not requested.

| Claim | Checked against | Verdict |
|---|---|---|
| Pool = 506 by `status == released and source != None` | Set difference with the Untapped-rule pool (511) | Corrected: project pool is 511; the 5 missing cards and why are in the section 0 note. 0 cards are in the 506 and not in the 511 |
| "Drops Mephisto, Mordred, Toad" as mode/event cards | Untapped rows | Corrected: Mephisto and Toad are non-collectible; Mordred (3/4, series 10, from 2026-11-05) is a real card |
| Zombie Nova is a "mode card, not in pool" | Untapped: `collectible`, series 10, from 2026-10-14; in 67+ meta lists | Corrected |
| "Fractured Frontier" cards are separate cards | Untapped: own `defId`, collectible, series 7/8 | Confirmed |
| 16 no-ability cards | Untapped text; official 2026-09-10 post for The Collector | Corrected: 7. Downstream counts flagged, not rebuilt |
| Cost and power of the 506 shared cards | Untapped dump | Confirmed, 0 differences |
| Section 5 overrides table (46 cards: cost, power, text) | Untapped dump | Confirmed 46 of 46 on cost and power; text equal on 42, and the 4 differences (Annihilus, Sinister Six, En Sabah Nur, Vampire Deacon Frost) are a missing "0" in the Untapped text, so this file's text is the right one. Mismatch rate 0% |
| 42 quoted card texts in sections 1 to 4 (glossary examples, rule interactions, axis examples) | Untapped dump | Confirmed 41 of 42; the one difference (Jane Foster Mighty Thor "cost 0") is again the dropped "0" in Untapped. Mismatch rate 0% for this file |
| On Reveal, Ongoing definitions (S8) | Local copy of the guide: both quoted sentences present | Confirmed (community source; no official definition found) |
| Activate | Official launch post (fetched) | Corrected: official definition added (player-chosen timing, not before the turn after it is played, once per game) |
| Game Start, End of Turn, Start of Turn | no official definition found in the posts fetched | Could not confirm beyond card text |
| Horde | Local copy of S4: "Horde: Give your Zombie Horde that much Power", "it only goes up" | Confirmed (official) |
| Objective | Local copy of S5: both quotes present. Timing sentence is from the S7 datamine | Confirmed (official) for the definition; timing could not be confirmed officially |
| Quickdraw | Local copy of S3: "These effects are active the first turn you draw them. (Next turn if cards are already revealing.)" | Confirmed (official) |
| Empowered, Moveable | Local copy of S2 (2026-05-19 patch notes): both `[New Keyword]` lines present as quoted | Confirmed (official) |
| Skills: definition; in decks; count toward 12 | Official 2025-03-04 patch notes (fetched); `isSkill`; Untapped meta lists | Corrected: was "card text only, no type flag". Skills are a card type with no Power, banished after resolving; the 11 collectible ones are deck cards that count toward the 12 |
| front row / back row | Card text; Marvel Snap Zone Captain Carter guide (fetched) | Corrected: definition added, community level |
| Keyword counts on the 511 pool (plain text search, not the parser) | Untapped dump | For reference: On Reveal 253, Ongoing 83, Activate 36, End of Turn 35, Start of Turn 8, Game Start 13, When Destroyed 11, When Discarded 11, Objective 12, Quickdraw 5, Horde 7, Empowered 4, Moveable 19. The table counts above are parser classes on 506 cards and differ |
| Parser coverage 96.5% | Re-run on the 511 pool | Corrected for the build pool: 93.5% fully parsed (2.1) |
| Axes, edges, precision samples (sections 3, 4) | not re-run on the 511 pool | Could not confirm; still 506-pool numbers, and affected by the no-ability and skill corrections |
