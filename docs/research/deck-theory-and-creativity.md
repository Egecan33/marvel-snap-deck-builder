# Deck theory and creativity mechanisms

Research for Snap Forge, Stage 0. Written 2026-11-12. Every web source below was accessed on 2026-11-12.

How to read this file:

- **Confirmed** means read from a live source on the access date. **Derived** means computed by a script in `docs/research/analysis/theory/` from confirmed inputs. **Heuristic** means a design choice of this file with no measurement behind it yet.
- All card text is quoted from the Marvel Snap Zone card JSON (S3). Card text changes often: the engine must read text from synced data, never from this file.
- **Verification note (2026-11-12).** The released pool is **511 cards** (Untapped rule, `data-sources.md` 1.1), not the 570 of S3: 570 counts every `status: released` row in S3, including 64 mode copies and non-collectible cards. The build will not use S3 (its robots.txt disallows the endpoint). Numbers below that depended on 570 were recomputed on the 511 pool and are marked. Every quoted card text, cost and power was re-checked against the Untapped dump (log at the end).
- Keywords that appear in quoted text (Horde, skill, Objective, Quickdraw, Empowered, Activate, front row) are not explained here. Their rules belong to `mechanics.md` and `rules-and-formats.md`.

## Sources

| Id | Source | Used for |
|---|---|---|
| S1 | Out of Games, "How to Play MARVEL SNAP", https://outof.games/realms/marvel-snap/guides/255-how-to-play-marvel-snap/ | deck size, opening hand, draws, turns, hand limit, win rule |
| S2 | Marvel Snap Zone, "Ranked Meta Tier List: November 8, 2026 - Knights of Avalon Week 1", https://marvelsnapzone.com/marvel-snap-ranked-meta-tier-list-november-8-2026/ (index: https://marvelsnapzone.com/tier-list/) | 15 current lists with win rate and cube average, tech commentary |
| S3 | Marvel Snap Zone card JSON, https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true | current cost, power and text of 748 cards (570 released, 178 unreleased) |
| S4 | Marvel Snap Zone, "Deckbuilding for Beginners in Marvel Snap", https://marvelsnapzone.com/?p=133483 | core / shell / tech vocabulary |
| S5 | snap.fan, "Top Ten Features Overlooked When Deck Building", https://snap.fan/news/top-ten-features-overlooked-when-deck-building/ | template curve, power-output questions |
| S6 | lsorber, "Marvel Snap optimal energy curve", https://github.com/lsorber/marvel-snap-optimal-energy-curve (README) | simulation of all 6,188 curves |
| S7 | snap.fan, "Data Analysis Guide" (2024-04-27), https://snap.fan/guides/data-analysis-guide/ | bias in played win rate versus drawn win rate |
| S8 | Marvel Snap Zone, "Snapalytics: Top-Performing Pairs", https://marvelsnapzone.com/marvel-snap-meta-data-analysis-top-performing-card-pair-combinations-and-hidden-gems/ | pair-level usage / win rate / cubes exist as community data |
| L1-L13 | Creativity literature, listed in section 4.1 | bibliographic data checked through the Crossref and arXiv APIs |

Not found: a community benchmark for "how much power wins a location". Two searches returned no number (section 1.5).

## 1. What a functioning 12-card deck needs

### 1.1 Confirmed rule inputs

| Fact | Value | Source |
|---|---|---|
| Deck | 12 different cards | S1 |
| Opening hand | 3 cards before turn 1, no mulligan | S1 |
| Draw | 1 card at the start of every turn, including turn 1 | S1 |
| Turns | 6; energy on turn t is t; unspent energy does not carry over | S1 |
| Hand limit | 7; at the limit you do not draw (no card is burned) | S1 |
| Win | more Power than the opponent at 2 of 3 locations | S1 |
| Reveal order | the player currently leading reveals first (priority) | S1 |

Settled on 2026-11-12 in `rules-and-formats.md` (R10, R12, R14): (a) 4 cards per side of a location, in two rows of two; the front row is the first two spots; skills leave the board after resolving. (b) Tie-break: with equal locations won, higher total Power across all three locations wins, which is the same outcome as S1's "biggest lead at their winning Location"; equal totals is a draw. Priority: more locations, then more total Power, then random. (c) Limbo, the location Magik creates ("On Reveal: Replace this location with 'Limbo'. Doesn't work after turn 5.", S3), reads "There is a turn 7 this game." (Untapped `locations.json`). Skill cards are ordinary deck cards and count toward the 12.

### 1.2 Draw maths (derived, exact)

Script: `analysis/theory/draw_odds.py` (hypergeometric with fractions, then checked against 200,000 seeded shuffles: every closed form within 0.5 percentage points).

Cards seen by turn t: `n(t) = 3 + t`. For n cards seen from 12: P(at least one of k) = `1 - C(12-k, n) / C(12, n)`; P(all k pieces) = `C(12-k, n-k) / C(12, n)`, which is `n(n-1)/132` for 2 pieces and `n(n-1)(n-2)/1320` for 3; P(at least one of a enablers and one of b payoffs) = `1 - C(12-a,n)/C(12,n) - C(12-b,n)/C(12,n) + C(12-a-b,n)/C(12,n)`.

| By turn | 1 | 2 | 3 | 4 | 5 | 6 | 7 (if it exists) |
|---|---|---|---|---|---|---|---|
| Cards seen | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| A specific card | 33.3% | 41.7% | 50.0% | 58.3% | 66.7% | **75.0%** | 83.3% |
| At least one of 2 | 57.6% | 68.2% | 77.3% | 84.8% | 90.9% | 95.5% | 98.5% |
| At least one of 3 | 74.5% | 84.1% | 90.9% | 95.5% | 98.2% | 99.5% | 100% |
| At least one of 4 | 85.9% | 92.9% | 97.0% | 99.0% | 99.8% | 100% | 100% |
| Both pieces of a 2-card combo | 9.1% | 15.2% | 22.7% | 31.8% | 42.4% | **54.5%** | 68.2% |
| All 3 pieces of a 3-card combo | 1.8% | 4.5% | 9.1% | 15.9% | 25.5% | **38.2%** | 54.5% |
| 1 enabler and 1 of 2 payoffs | 16.4% | 25.8% | 36.4% | 47.7% | 59.4% | 70.9% | 81.8% |
| 1 of 2 enablers and 1 of 2 payoffs | 29.3% | 43.4% | 57.6% | 70.7% | 82.0% | **90.9%** | 97.0% |
| 1 of 2 and 1 of 3 | 39.2% | 54.9% | 68.9% | 80.4% | 89.1% | 95.0% | 98.5% |
| 1 of 3 and 1 of 3 | 52.1% | 68.9% | 81.9% | 90.9% | 96.4% | 99.1% | 100% |

Consequences the engine should state in its reasons:

- A deck never sees 3 of its 12 cards in a 6-turn game. Any single card is absent in 25% of games, so a plan that needs one named card caps at 75%.
- A two-card combo with no redundancy works in 54.5% of games, a three-card combo in 38.2%. Two interchangeable cards per role lift a two-role plan to 90.9%.
- P(a card of cost at most t has been seen by turn t) with k such cards is the "at least one of k" row at that turn. Two 1-drops give a turn-1 play in 57.6% of games, three give 74.5%; four cards of cost at most 2 give 92.9% by turn 2.

Draw, tutor and thinning, by the final turn (script table A5):

| Extra cards seen by turn 6 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| A specific card | 75.0% | 83.3% | 91.7% | 100% |
| Both of 2 | 54.5% | 68.2% | 83.3% | 100% |
| All of 3 | 38.2% | 54.5% | 75.0% | 100% |

- A plain draw is +1 card seen. A card pulled from the deck to the board (Jubilee, "On Reveal: Add the top card of your deck to this location.") is also +1 seen and thins the deck.
- A tutor for card X makes "X" a group of two for the "at least one of k" formula, but X then arrives a turn late and costs the tutor's energy. Conditional tutors exist now: King Eitri "Activate: Draw a created card from your deck."; Jane Foster Mighty Thor "On Reveal: Draw all cards that cost 0 from your deck." (S3).
- Cards shuffled into your own deck (Thor "Shuffle Mjolnir into your deck", Beta Ray Bill "Shuffle Stormbreaker into your deck") dilute later draws: replace 12 by the current deck size for the remaining draws. The engine should compute this per deck from traits.

### 1.3 Energy curve (derived model, heuristic policy)

Total energy over 6 turns is 1+2+3+4+5+6 = **21**. With 9 cards seen, energy spent cannot exceed 9 times the average cost of the cards seen, so a deck with average cost below 21/9 = 2.33 cannot spend all its energy without generating cards.

`draw_odds.py` part C plays 20,000 seeded games per curve with printed costs only. "Greedy" spends as much energy as possible each turn without looking ahead; "clairvoyant" knows the draw order and is an upper bound. The two differ by at most 0.07 energy, so greedy is an adequate model. Not modelled: cost changes, extra energy, generated cards, board space, holding cards on purpose.

| Curve (cards at cost 1..6) | Avg cost | Energy spent of 21 | No play T1 | No play T2 | No play T3 |
|---|---|---|---|---|---|
| 2,4,3,2,1,0 (S6 optimum) | 2.67 | 20.28 | 42.7% | 3.7% | 0.0% |
| 2,3,4,2,1,0 (S5 template) | 2.75 | 20.17 | 42.8% | 9.3% | 0.0% |
| 2,3,3,2,1,1 (mean of the 15 S2 lists, rounded) | 3.00 | 20.14 | 42.0% | 9.5% | 0.5% |
| 1,4,3,2,1,1 (S6, with one 6-drop) | 3.08 | 20.04 | 66.4% | 6.1% | 0.3% |
| 0,1,3,4,1,2 plus one 7-drop (4-Cost Summons, S2) | 4.25 | 18.28 | 100% | 58.3% | 8.5% |
| 0,0,2,3,4,3 (stress: top-heavy) | 4.67 | 17.21 | 100% | 100% | 23.0% |
| 6,6,0,0,0,0 (stress: all cheap) | 1.50 | 13.50 | 3.0% | 0.0% | 0.0% |

Community references agree: S6 simulated all 6,188 curves (C(17,5) = 6188, checked) and ranks 2,4,3,2,1,0 first and 1,4,3,2,1,1 first among curves with a 6-drop. S5's author builds most decks on 2 one-drops, 3 two-drops, 4 three-drops, 2 four-drops, 1 five-drop.

Measured on the 15 lists of S2 (`meta_snapshot_stats.py`): mean cards per cost 1..6 = 2.00, 2.47, 3.00, 1.93, 1.33, 1.13 (plus 0.07 each at cost 0 and 7); average cost from 2.17 to 4.25; cards of cost 2 or less from 1 to 8; cards of cost 5 or more from 0 to 4. In the greedy model the real lists spend between **18.30 and 20.28** energy (median 19.28) and miss turn 3 entirely in at most 8.5% of games. Three of the 15 lists run two or fewer cards of cost 2 or less, so "at least N early drops" must not be a hard rule: the energy model is the rule, and a skipped early game is acceptable when it is planned.

### 1.4 Role mix and packages

- S4's vocabulary: **core** cards create the win condition, a **shell / package** is a small set of cards usually played together (its example is Darkhawk with three rock cards), **tech** is a card meant to counter the opponent that does not contribute to making the deck function. Its reference deck has two tech cards.
- S2 (current meta): two disruptive cards "still leaves 10 slots open to do our own thing"; a third makes things "a lot trickier"; "most synergies can't afford to run three to four cards with no tie to their core strategy."
- From 1.2, a package that needs one of each of two roles needs 2 x 2 cards to reach 90.9% by turn 6. Twelve slots therefore hold **one primary package of 4 to 6 cards, at most one secondary package of 3 to 4, and 2 to 4 flexible slots** (tech, early plays, finisher). Three independent packages cannot each reach 2 x 2 unless cards serve two packages. (Heuristic, built on the derived odds.)
- Default role targets (heuristic): 3 to 5 cards playable by turn 2, at least 2 power payoffs or finishers that are worth 5+ energy of play on turns 5 and 6, 0 to 3 tech cards, and every non-tech card in at least one package.

### 1.5 Power needed to win

No community benchmark was found. What is measured:

- Mean printed power by cost, recomputed 2026-11-12 on the 500 characters of the 511-card pool (the 11 skills have no Power and are left out): cost 1: 2.15, 2: 2.75, 3: 3.69, 4: 5.46, 5: 6.42, 6: 8.59. Playing one average card on curve every turn is 29.1 printed power for 21 energy, about 1.38 per energy. (The original figures on the 570 S3 rows were 1.97, 2.75, 3.64, 5.32, 6.31, 8.64; 28.6; 1.36.) This is a floor reference, not a target: abilities are worth power.
- Sum of printed power of the 12 cards in the 15 S2 lists: 34 to 60, median 48. Lists with low printed power (Fantomex 34, Nimrolactus 35, Skilled Zombie Horde 37) score through abilities, so printed power alone cannot rate a deck.
- S2 on one list: "Shou-Lao plus Sasquatch can be enough to win two locations on turn six" (printed power 8 and 11, plus Shou-Lao's buff).
- S5 asks the right questions without numbers: what is the ideal power output and what is the low-roll output.

Proposal: do not hardcode an absolute power target. Calibrate the floor from the goldfish model of section 4.8 run on the synced meta corpus (default: the 20th percentile of meta lists, per win-condition family).

## 2. Win-condition taxonomy

Each row is detectable from card traits (trait names are placeholders for `mechanics.md`). Examples are the 15 lists of S2 (deck codes decoded with `meta_snapshot_stats.py`; win rate / cube average as printed, which S2 itself calls inflated by bots in week 1). Text in quotes is S3.

| # | Plan | How it takes 2 of 3, and when | Enabler -> payoff traits | Folds to | Current example (S2) |
|---|---|---|---|---|---|
| 1 | Counter scaling, go-wide (Horde) | Cheap cards feed a shared counter all game; a payoff converts it on turn 5 or 6 | `horde_add` -> `horde_payoff` (Zombie Giant-Man "Horde +2, then this gains Power equal to your Zombie Horde.") | Shadow King (reset), text removal | Skilled Zombie Horde, 64.5% / 0.8 |
| 2 | Tempo: many small On Reveals | Two or more cards per turn; a mobile body grows and a discounted 6-drop lands with other cards on turn 6 | `cheap_on_reveal`, `multi_play` -> `per_card_played` (Werewolf By Night, Shou-Lao the Undying, Sasquatch "Costs 1 less for each card you played last turn.") | Cosmo, Killmonger ("Destroy ALL 1-Cost cards."), cost increase | Small On Reveals, 63% / 0.9 |
| 3 | Put-into-play burst | Turn 6 adds bodies to the other two locations at once | `hand_to_board` (Anti-Polar Magneto "Add a 3 or 4-Cost card from your hand to each other location."; Jubilee; Dragon Lord) -> big 3-4 drops | Stardust ("Cards can't be added to locations except by playing or moving them."), Cosmo | 4-Cost Summons, 62.5% / 1.05; 4-Costs 2099 |
| 4 | Affliction and Power theft | Wins lanes by lowering the enemy total; Objective cards transform mid-game | `steal_power`, `afflict` -> `stolen_power_payoff` (Vampire Deacon Frost) | Luke Cage ("Your front-row cards can't have their Power reduced."), Shadow King | 4-Costs Afflict, 63.5% / 0.75 |
| 5 | Shuffle-in and draw (hammers) | On Reveal cards add strong cards to the deck; a tutor and a repeat effect cash them on turns 5-6 | `shuffle_into_deck` -> `tutor`, `repeat_on_reveal` (Odin) | Cosmo, Shadow King (S2) | Curved Hammer Time, 62.5% / 0.95 |
| 6 | No-ability stats, go-tall | High printed power on curve; High Evolutionary "Unlock the potential of your cards with no abilities." | `no_ability` -> `no_ability_payoff` | Shang-Chi ("Destroy an enemy card here that has 10 or more Power."), Mobius M. Mobius and Luke Cage (S2) | Curved High Evo, 63% / 0.8 |
| 7 | Disruption as the plan | Cheap bodies keep priority; 3 to 5 denial cards subtract more than they cost | `deny_*`, `text_removal`, `cost_tax` plus efficient stats | Decks that do not depend on the denied axis | Created Disruption 63%; Agatha Disrupts 58% |
| 8 | Destroy scaling | Self-destroy for value; payoffs copy or grow | `destroy_own` (Carnage, Venom) -> `when_destroyed` (Nimrod "Add a copy of this to each other location."), `destroy_count` (Knull, Death) | Armor ("Cards here can't be destroyed."), Cosmo, Stardust (copies are added cards; inferred from text) | Fantomex 60%; Nimrolactus 56.5% |
| 9 | Location removal | Galactus "If you're winning this location and this is your only card here, destroy all other locations." turns 2 of 3 into 1 of 1 | `solo_lane_setup`, `power_double` -> `destroy_locations` | Any card played into that lane, Cosmo | Nimrolactus |
| 10 | Discard scaling | Discards are fuel; payoffs count them or return | `discard_own` (M.O.D.O.K., Colleen Wing) -> `when_discarded` (Swarm, Apocalypse), `discard_count` (Morbius) | Hand disruption, cost increase; Cosmo on the outlets | Bullseye Discard, 56% / 0.75 |
| 11 | Ongoing stacking | One lane's total is multiplied, then shared: Iron Man "Your total Power is doubled here.", Onslaught, The Living Tribunal "Split your total Power evenly among all locations." | `ongoing_multiplier` -> `ongoing_repeat`, `copy_ongoing` (Mystique) | Enchantress ("Remove the abilities from all Ongoing cards here."), Rogue, Echo, Super-Skrull, text removal | Ongoing Tribunal, 55.5% / 0.9 |
| 12 | Extra energy | More than 21 energy over the game for bigger late turns | `max_energy_up` (Wiccan "+2 Max Energy" if all Energy was spent; Electro; Hope Summers) -> 5-6 drops | Missing the ramp card (75% cap), cost tax, tempo decks | Curved Wiccan, 59% / 0.6 |
| 13 | Extra turn | Magik creates Limbo ("There is a turn 7 this game.", confirmed 2026-11-12); decks plan a seventh turn | `extra_turn` -> late payoffs; 10 cards seen | Location replacement, decks that peak on turn 6 | Magik is in 3 of 15 lists |
| 14 | Move reallocation | Power is committed early and moved after the opponent commits | `mover`, `moveable` -> `on_move_payoff` (Human Torch, Dagger, Kraven) | Professor X ("Moving is the only way to add or remove a character from here." cuts both ways), Shadow King | none in S2 this week |
| 15 | Lockdown | Win a lane early, then close it | `lane_lock` (Storm, Professor X, Goose) -> early power | Jeff the Baby Land Shark, move, added cards | no dedicated list in S2 |
| 16 | Last-turn hidden power | Hold power off the board until turn 6 so it cannot be answered | `activate_burst` (Fantomex), `next_card_double` (Shuri), `unrevealed` (Invisible Woman) | Alioth, Cosmo on the lane, priority loss | Fantomex ("able to hide its points until the last turn", S2) |
| 17 | Cost-diversity payoff | Play one card of each cost; payoffs count different costs in play (Kluh, Vampire Enchantress, Hela) | `distinct_costs` -> `per_distinct_cost` | Missed curve, Mobius (cost reduction denied) | Created Disruption, Curved Wiccan (Kluh) |
| 18 | Deck and hand attack | Remove or weaken the opponent's key cards before they are played | `opp_deck_remove` (Yondu, Cable, Gladiator), `opp_hand_tax` (Iceman, Black Bolt, Leech) -> Darkhawk | Redundant decks | parts of Agatha Disrupts, Curved Disruption |

Detection rule (heuristic): a deck has plan P when it holds at least `a` enablers and `b` payoffs of P's traits; its assembly probability is the a x b row of 1.2. The primary plan is the one with the highest (assembly probability x payoff weight); a second plan is reported if it also clears the threshold.

## 3. Opposing plans and tech

What S2 says the field looks like in week 1 of November 2026: Zombie Horde and Vampire / affliction lists lead; Arthur Pendragon has revived 4-cost and Anti-Polar Magneto lists; every disruptive list runs Shadow King and Mobius M. Mobius; Stardust "might be required once again"; Luke Cage gains value against Vampire Deacon Frost and High Evolutionary; Cosmo is "nowhere to be seen", which helps Small On Reveals and Curved Hammer Time.

| Opposing plan | Tech class | Cards and current text (S3) |
|---|---|---|
| Buffs and scaling on a body | Power reset | Shadow King 3/4 "On Reveal: Reset all cards here to their original Power." |
| Cost reduction, free skills, discounted finishers | Cost lock | Mobius M. Mobius 3/3 "Ongoing: Your Costs can't be increased. Your opponent's Costs can't be reduced." |
| Cards added by effects (summons, copies, bots) | Add lock | Stardust 4/6 "Ongoing: Cards can't be added to locations except by playing or moving them." |
| Affliction and theft | Reduction immunity | Luke Cage 2/2 "Ongoing: Your front-row cards can't have their Power reduced." |
| On Reveal chains | On Reveal lock | Cosmo 3/3 "Ongoing: On Reveal abilities won't happen here." |
| One huge card | Big-card removal | Shang-Chi 4/3 "On Reveal: Destroy an enemy card here that has 10 or more Power." |
| Ongoing stacking | Ongoing removal or theft | Enchantress 5/8 "Remove the abilities from all Ongoing cards here."; Rogue 3/3 "Steal the text from an enemy Ongoing card here."; Echo 1/2; Super-Skrull 4/2 "Has the Ongoing effects of all enemy cards." |
| 1-cost swarms | Sweeper | Killmonger 3/3 "On Reveal: Destroy ALL 1-Cost cards." |
| Destroy plans (and enemy removal) | Destroy lock | Armor 2/3 "Ongoing: Cards here can't be destroyed." |
| Any text-dependent card | Text removal | Red Guardian 3/2; Cosmic Ghost Rider 5/6 "Remove the text from front-row enemy cards here."; Deafening Chord 1/0 (3-Cost or lower); Alioth 6/7 (unrevealed enemy characters here) |
| Expensive finishers in hand | Hand attack | Iceman 1/2 "+1 Cost"; Leech 4/5 (removes text from 6-Cost or more cards in hand); Black Bolt 5/8 (discards the cheapest card) |
| Created cards | Created tax | Gorgon 2/3 "Your opponent's created cards cost 1 more. (maximum 6)" |
| Lane commitment on the last turn | Displacement | Juggernaut 4/5 "Move away all enemy cards played here this turn."; Magneto 6/12 (moves enemy 3 and 4-Cost cards) |

Engine use: each plan in section 2 carries a "folds to" list of tech classes; each tech card carries its class as a trait; tech value in a build is (meta share of the plans it answers) x (how badly they fold), with meta share from synced data. Tech must be read from synced text because the table above will age.

## 4. Creativity

### 4.1 What the literature measures

Bibliographic data verified through Crossref / arXiv. The summaries are this file's reading of the papers, not quotations.

| Ref | Work | Idea used here |
|---|---|---|
| L1 | Boden, The Creative Mind, 2nd ed., Routledge 2004, doi:10.4324/9780203508527 | Creative = novel, surprising and valuable; combinational, exploratory and transformational creativity |
| L2 | Ritchie, "Some Empirical Criteria for Attributing Creativity to a Computer Program", Minds and Machines 17(1), 2007, doi:10.1007/s11023-007-9066-2 | Rate outputs on typicality and quality separately; creativity lives in high quality with low typicality |
| L3 | Grace, Maher, Fisher, Brady, "Data-intensive evaluation of design creativity using novelty, value, and surprise", IJDCI 3(3-4), 2015, doi:10.1080/21650349.2014.943295 | Novelty = distance from existing designs; surprise = violation of an expectation learned from data; value separate |
| L4 | Kaminskas, Bridge, "Diversity, Serendipity, Novelty, and Coverage", ACM TiiS 7(1), 2016, doi:10.1145/2926720 | Survey of beyond-accuracy objectives and how they trade off against accuracy |
| L5 | Castells, Hurley, Vargas, "Novelty and Diversity in Recommender Systems", Recommender Systems Handbook, 2015, doi:10.1007/978-1-4899-7637-6_26 | Popularity-based novelty (inverse popularity) and distance-based novelty |
| L6 | Vargas, Castells, "Rank and relevance in novelty and diversity metrics for recommender systems", RecSys 2011, doi:10.1145/2043932.2043955 | Novelty should be weighted by relevance: an irrelevant novel item is worth nothing |
| L7 | Ge, Delgado-Battenfeld, Jannach, "Beyond accuracy: evaluating recommender systems by coverage and serendipity", RecSys 2010, doi:10.1145/1864708.1864761 | Serendipity = unexpected relative to an obvious baseline, and useful |
| L8 | Zhou et al., "Solving the apparent diversity-accuracy dilemma of recommender systems", PNAS 107(10), 2010, doi:10.1073/pnas.1000488107 | Novelty of an item as self-information of its popularity |
| L9 | Church, Hanks, "Word association norms, mutual information, and lexicography", ACL 1989, doi:10.3115/981623.981633 | Pointwise mutual information for co-occurrence, and its instability at low counts |
| L10 | Lehman, Stanley, "Abandoning Objectives: Evolution Through the Search for Novelty Alone", Evolutionary Computation 19(2), 2011, doi:10.1162/EVCO_a_00025 | Novelty search: reward distance to nearest neighbours in a behaviour space |
| L11 | Lehman, Stanley, "Revising the evolutionary computation abstraction: minimal criteria novelty search", GECCO 2010, doi:10.1145/1830483.1830503 | Novelty counts only for individuals that meet a minimal criterion |
| L12 | Mouret, Clune, "Illuminating search spaces by mapping elites", arXiv:1504.04909, 2015 | MAP-Elites: keep the best solution in each cell of a descriptor grid |
| L13 | Fontaine, Lee, Soros, De Mesentier Silva, Togelius, Hoover, "Mapping Hearthstone Deck Spaces through MAP-Elites with Sliding Boundaries", GECCO 2019, doi:10.1145/3321707.3321794, arXiv:1904.10656 | Quality-diversity applied to card-game decks |

Translation to Snap Forge: **novelty** = distance from the known meta corpus (L3, L5, L10); **popularity novelty** = self-information of card play rates (L8); **surprise** = co-play far below what popularity predicts (L3, L9); **value** = the power floor (L1, L2); **serendipity** = novel and valuable together, never novelty alone (L6, L7); the search is novelty search with a minimal criterion (L11) and a MAP-Elites grid for variety (L12, L13).

### 4.2 Calibration facts from the current meta (derived)

From the 15 lists of S2: 132 distinct cards (26% of the 511 released; the original "23% of 570" used the S3 row count); 99 of them appear in exactly one list; pairwise shared cards average 0.66 (67 of 105 pairs share nothing); each list's nearest neighbour shares 1 to 7 cards (1: 3 lists, 2: 4, 3: 1, 4: 1, 5: 4, 7: 2). Most-shared cards: Mobius M. Mobius (5 lists), Scarlet Witch Queen of Chaos, Thanos Fractured Frontier, Shadow King (4 each).

Two consequences. First, real meta lists are already far apart, so "distance to the nearest list" only means something against a large corpus (several hundred lists including variants); against 15 lists nearly everything looks novel. Second, for two 12-card decks Jaccard similarity is `o / (24 - o)` where o is the shared-card count, a monotone function of o, so the engine should show the overlap count ("shares 7 of 12 with 4-Cost Summons"), which a person can check.

### 4.3 (a) Deck novelty score, 0 to 100

```
Novelty(D) = 100 * (0.45 * ListDistance + 0.25 * ConnectedRarity + 0.30 * PackageNovelty)

ListDistance    = 1 - o1 / 12            o1 = max over corpus lists m of |D ∩ m|
rarity(c)       = log2(1 / max(p_c, 0.002)) / log2(1 / 0.002)      p_c = share of corpus decks playing c
ConnectedRarity = (1/12) * sum over c in D of rarity(c) * [c has a strong edge in D, or is tagged tech]
PackageNovelty  = sum over strong edges e in D of s_e * U_e  /  sum over strong edges of s_e     (0 if no edges)
```

`s_e` is the engine's mechanical interaction score of a pair (0 to 1, strong when at least 0.5) and `U_e` is the unexplored factor of 4.4. Rarity by play rate: 30% -> 0.19, 10% -> 0.37, 3% -> 0.56, 1% -> 0.74, 0.2% or less -> 1.00.

Worked examples (`creativity_formulas.py`, synthetic inputs): exact meta copy 9; two flex cards swapped 18; known variant sharing 7 cards 35; off-meta build on a known core 53; brew sharing 2 cards with rare cards and new pairs 80. A pile of twelve unplayed cards with no interactions scores 45 (it would score 70 without the "connected" condition), which is why novelty is never shown alone: **Brew score = Novelty x [power floor passed]**. Bands (heuristic): below 35 meta, 35 to 59 variant, 60 to 79 off-meta, 80 and above brew.

- Data: corpus of meta lists with dates and weights, per-card play rate, interaction network.
- Failure modes: a small or stale corpus inflates novelty; one site's naming of archetypes hides variants; rarity rewards cards that are rare because they are weak (mitigated by the floor and by connected rarity); new-release cards look rare for a week.

### 4.4 (b) Under-explored synergy discovery

For a pair (a, b) with N corpus lists, n_a, n_b and n_ab counts:

```
expected   = n_a * n_b / N
lift_s     = (n_ab + 5) / (expected + 5)                      smoothed toward 1 with pseudo-count 5
U_ab       = 1 - min(1, WilsonUpper95(n_ab, N) / 0.01)        "unexplored": 1% co-play counts as explored
Gem(a, b)  = 100 * s_ab * U_ab * sqrt(q_a * q_b)              q = card quality, 0 to 1
```

The Wilson upper bound is what handles thin data: with no co-play observed, U is 0.00 at N = 15 or 100, 0.11 at N = 300, 0.73 at N = 1,000, 0.91 at N = 3,000. The tool cannot call a pair "unexplored" until the corpus is large enough to have seen it. The smoothed lift is a second, separate reason: lift_s below 0.5 with expected at least 5 means "both cards are popular but are rarely played together" (200 and 150 lists of 1,000, together in 3: raw lift 0.10, smoothed 0.23).

Triples: `s_abc` = the weakest of the three pair scores, or a dedicated enabler + payoff + amplifier pattern; U from the triple's count; multiply by 0.70 (= 38.2% / 54.5%, the assembly odds of three pieces relative to two) unless a piece has a substitute in the deck.

- Data: N at least 300 lists for any claim, ideally 1,000+ across two sources; S8 shows pair statistics exist as community data, but public pair tables list top pairs, not the full matrix, so co-play must be counted from scraped lists.
- Failure modes: the engine's interaction score is wrong (a pair is unplayed because of an anti-synergy the rules miss: low lift between two popular cards is the warning sign and should be shown, not hidden); the pair is unplayed because both cards compete for the same energy turn; quality q inherits the bias of played win rate (S7 recommends drawn win rate).

### 4.5 (c) Brew build mode

Objective: maximise `F(D) = Novelty(D) + 2 * SynergySum(D)` over 12-card sets, subject to the power floor. The synergy term only breaks ties toward decks that hold together. The floor is a hard constraint on every returned deck (minimal criterion, L11).

| # | Constraint | Default | Basis |
|---|---|---|---|
| C1 | Legal: 12 distinct cards, format-legal, owned if owned-only | hard | rules |
| C2 | Energy: modelled energy spent of 21, with cost and energy effects applied | at least 18.0; warn below 19.0 | lowest real list 18.30, median 19.28 (1.3) |
| C3 | No dead early game unless planned: P(no play on turn 3) | at most 10% | real lists at most 8.5% |
| C4 | Primary plan assembly probability by turn 6 | at least 80% (2 x 2 gives 90.9%) | 1.2 |
| C5 | Build-around mode (one named card): plan needs at least 3 partners, and a second plan without the card clears C4 | hard in that mode | single card caps at 75% |
| C6 | Synergy density: strong pairs of 66 | at least 10, and at most 2 cards with no strong edge | heuristic |
| C7 | Card quality: deck mean / single-card minimum | 45 / 25 of 100, the minimum waived for a card with 3+ strong edges | heuristic |
| C8 | Tech and flexible slots | at most 3 off-plan cards | S2 |
| C9 | Goldfish power (4.8) | at least the 20th percentile of the meta corpus in the same plan family | to be calibrated |

Search procedure, deterministic for a seed (seeded PRNG; candidates and neighbours iterated in card-id order; ties broken by card id):

1. **Candidate pool.** The full space is C(511,12) = 5.8e23 (corrected from C(570,12) = 2.2e24). Keep the seed cards plus the top 80 to 120 cards by (interaction with the seeds + rarity), after applying the constraint prompts of 4.6.
2. **Greedy construction.** From the seeds (or from a sampled hidden-gem pair), add the card with the best marginal F minus penalties for violated constraints until 12 cards.
3. **Simulated annealing over one-card swaps.** 20,000 proposals, geometric cooling from temperature 8 to 0.05, penalties `mu_i * violation_i` inside the search, best zero-penalty deck kept. Evaluation is incremental: 11 pair lookups for synergy and an inverted index card -> meta lists for o1.
4. **MAP-Elites archive.** Descriptors: primary plan (18 families of section 2) x curve shape (average cost below 2.6, 2.6 to 3.3, above 3.3) = 54 cells. Each cell keeps the feasible deck with the highest F. Parents are drawn uniformly from occupied cells and mutated by one or two swaps or by injecting a package. The UI shows the grid: up to 54 different brews instead of one.
5. **Final check.** Run the goldfish model only on the elites that will be shown.

Feasibility (derived, synthetic data only): `creativity_formulas.py` runs 20,000 full evaluations of a comparable objective over 570 cards and 300 lists in about 1.2 to 1.6 seconds in CPython, returns a zero-penalty deck, and returns the same deck for the same seed. The TypeScript engine with incremental evaluation should be well inside "a few seconds"; this needs a timing test in Stage 3.

Failure modes: the annealer exploits whatever the interaction scores overrate; penalties tuned too low return nothing feasible; MAP-Elites cells for rare plans stay empty (show them as empty, do not fill them with weak decks).

### 4.6 (d) Constraint prompts

| Prompt | Formal meaning | Note |
|---|---|---|
| Build around this off-meta card | seed = {card}; C5 applies; candidates ranked by interaction with the seed | reject the seed with a reason if fewer than 3 partners exist |
| No card above X% play rate | candidates = cards with p_c at most X | default X = 5%; tech slots may be exempted by a switch |
| At most N cards shared with any meta list | o1 at most N as a hard constraint | default N = 4; calibrate against 4.2 once the corpus is large |
| Wildcard slots | k slots (default 2) filled by maximising Gem with cards already in the deck, exempt from C8 | each wildcard must still have one strong edge |
| Series / owned only | candidates filtered by series or collection | report how much novelty and floor headroom the filter cost |
| Avoid archetype / avoid package | remove a package's cards from the candidates | lets a user ask for "discard without M.O.D.O.K." |
| Surprise me | sample a seed pair from the top Gem scores with the session seed | same seed, same brew |

### 4.7 (e) Explanation template

Every creative pick renders these fields, each naming cards (AGENTS rule 4):

1. **Interaction**: "{card} + {partner}: {enabler trait} feeds {payoff trait}", with both card texts quoted from synced data.
2. **Why it is unusual**: "{card} is in {p}% of tracked decks; this pair appears in {n_ab} of {N} lists (popularity alone predicts about {expected}); the deck shares at most {o1} of 12 cards with {nearest list}."
3. **What it replaces**: "Takes the slot {standard card} holds in {nearest list or package}: {delta in assembly odds, energy spent, plan coverage}."
4. **Risk**: the specific fold ("Cosmo stops both On Reveals"), the odds ("needs both cards: 54.5% by turn 6, 90.9% with {substitute}"), and the data confidence ("pair statistics rest on N = {N} lists; below 300 the 'unexplored' claim is not made").
5. **Label**: measured / derived / heuristic for each number shown.

### 4.8 (f) Keeping it honest

| Part | Status |
|---|---|
| Draw and combo odds | Derived exactly from confirmed rules |
| Energy spent, no-play odds | Derived from a model with a stated policy; ignores cost changes until traits supply them |
| Play rates, co-play counts, nearest list | Measured, as good as the corpus; show N and the date |
| Interaction scores, card quality, plan detection, all weights and thresholds | Heuristic |
| Novelty and Gem scores | Defined quantities built from the above; they measure distance and unexploredness, not strength |

Validating that brews function without a game simulator:

- **Structural checks** (C1 to C8): every one is a count or an exact probability and can be unit-tested.
- **Known-good test**: every list in the synced meta corpus must pass the floor; a floor that rejects a tier-1 list is wrong. Report the pass rate.
- **Known-bad tests**: seeded random 12-card piles and the pile of 4.3 must fail; a deck made of one package plus eight unrelated cards must fail C6.
- **Ablation**: removing the build-around card must lower the deck's plan score; if it does not, the "creative" card is decoration.
- **Optional goldfish simulation of turns 1 to 6**: shuffle with a seed, draw by the rules, each turn play the affordable subset with the best modelled value, place cards by a fixed policy that follows the detected plan (for example tallest lane first, then the second lane), and apply only self-contained effects that traits can express: printed power, self-buffs, counters, cost changes, extra energy, own-deck draws. Output per deck: distribution of total power, of the second-highest lane (the lane that decides 2 of 3), energy spent, and the rate at which the plan assembled.
  - It **can** claim: the deck spends its energy; the plan assembles in x% of games; unopposed output is at the p-th percentile of the meta corpus under the same model.
  - It **cannot** claim: a win rate, a matchup result, anything about priority, location effects, opposing tech, hidden information, snapping or cubes. It overrates plans that fold to common tech and underrates disruption decks, whose value is the opponent's lost power; those need the tech table of section 3, not the goldfish.

## 5. Defaults for the design doc

All heuristic unless marked. D = derived by a script here, M = measured on S2 / S3 on 2026-11-12.

| Name | Default |
|---|---|
| Cards seen by turn t | 3 + t; 9 by turn 6 (D) |
| Single card / 2-card / 3-card assembly by turn 6 | 75.0% / 54.5% / 38.2% (D) |
| Redundancy target per plan | 2 enablers x 2 payoffs = 90.9% (D); floor 80% |
| Total energy | 21 (D); modelled spend floor 18.0, warning below 19.0 (M: real lists 18.30 to 20.28) |
| Minimum average cost to be able to spend 21 energy from 9 cards | 2.33 (D) |
| Reference curve, cards at cost 1..6 | 2,3,3,2,1,1 (M, mean of 15 lists); 2,4,3,2,1,0 is the efficiency optimum (S6, D) |
| P(no play on turn 3) ceiling | 10% (M: real lists at most 8.5%) |
| Package budget | 1 primary of 4 to 6 cards, 1 secondary of 3 to 4, 2 to 4 flexible |
| Tech / off-plan slots | 0 to 3 |
| Strong interaction threshold; minimum strong pairs; orphan cards | 0.5; 10 of 66; at most 2 |
| Card quality floor | deck mean 45, single card 25 (waived with 3+ strong edges) |
| Novelty weights | list distance 0.45, connected rarity 0.25, package novelty 0.30 |
| Play-rate floor for rarity | 0.2% |
| Novelty bands | below 35 meta, 35-59 variant, 60-79 off-meta, 80+ brew |
| Gem: explored co-play rate, confidence, pseudo-count | 1% of lists, one-sided 95% Wilson bound, 5 |
| Corpus size for "unexplored" claims | at least 300 lists; aim for 1,000+ |
| Low-lift warning | smoothed lift below 0.5 with expected co-play at least 5 |
| Triple discount | 0.70 (D) |
| Brew objective | Novelty + 2 x synergy sum, floor as hard constraints |
| Search | 80 to 120 candidates, 20,000 annealing proposals, temperature 8 to 0.05, MAP-Elites 18 plans x 3 curve shapes |
| Prompts | play-rate cap 5%, max shared cards 4, wildcard slots 2 |
| Goldfish power floor | 20th percentile of the meta corpus in the same plan family (to calibrate) |

## Open questions

1. Board capacity (4 per side), the front-row rule, the tie-break and Limbo's text were settled on 2026-11-12 (section 1.1, `rules-and-formats.md` R10, R12, R14) at card-text and community level; no official wording exists for capacity, tie-break or priority. They set the placement policy of the goldfish model and plans 3, 9, 13 and 15.
2. No community number exists for the power that wins a lane; the goldfish percentile needs the meta corpus and has not been run.
3. Corpus size: one tier-list page gives 15 lists. The novelty and gem formulas need hundreds; `meta-sources.md` must say whether a source offers that volume with play rates and, ideally, drawn win rates.
4. S2's week-1 win rates are inflated by bots by its own account; plan weights should not be fitted to them.
5. Thresholds C6 and C7 depend on how `mechanics.md` scores interactions and quality; re-tune them with the known-good test once the engine exists.
6. Whether Stardust stops Nimrod copies, DoomBots and Excalibur is inferred from text, not tested.

## Verification log (2026-11-12)

Independent pass against the Untapped dump (`raw/cards/cards.json`, build 58.15.3, 791 rows) and the live S2 page.

| Claim | Checked against | Verdict |
|---|---|---|
| "570 released" cards | Untapped rule: 511. 570 is the count of `status: released` rows in S3, mode copies included | Corrected in the notes, 1.5, 4.2 and 4.5. The S3 row in Sources and the "570 cards" in the 4.5 feasibility run (a synthetic size) are left as written |
| Deck 12 different cards; opening hand 3; draw 1 per turn including turn 1; 6 turns; hand limit 7 | S1 local copy; official Sanctum Showdown post ("start with three cards in your hand", "Each turn, you draw a card") | Confirmed; same values as `rules-and-formats.md` R1 to R7 |
| Cards seen by turn t = 3 + t; 9 of 12 by turn 6; 75.0% / 54.5% / 38.2% | Arithmetic from the confirmed inputs (9/12; 9x8/132; 9x8x7/1320) | Confirmed. `draw_odds.py` was not re-run |
| Open items (a) capacity and front row, (b) tie-break, (c) Limbo | Card text, community pages, Untapped `locations.json` | Corrected: all three now stated in 1.1 |
| Quoted text, cost and power of 42 cards (sections 1.2, 2 and the tech table of 3): Jubilee, King Eitri, Jane Foster Mighty Thor, Thor, Beta Ray Bill, Magik, Zombie Giant-Man, Sasquatch (power 11), Shou-Lao the Undying (power 8), Killmonger 3/3, Anti-Polar Magneto, Stardust 4/6, Luke Cage 2/2, High Evolutionary, Shang-Chi 4/3, Nimrod, Armor 2/3, Galactus, Iron Man, The Living Tribunal, Enchantress 5/8, Wiccan, Professor X, Shadow King 3/4, Mobius M. Mobius 3/3, Cosmo 3/3, Rogue 3/3, Echo 1/2, Super-Skrull 4/2, Red Guardian 3/2, Cosmic Ghost Rider 5/6, Deafening Chord 1/0, Alioth 6/7, Iceman 1/2, Leech 4/5, Black Bolt 5/8, Gorgon 2/3, Juggernaut 4/5, Magneto 6/12, Human Torch, and name-only checks of Vampire Deacon Frost and Werewolf By Night | Untapped dump | Confirmed 42 of 42 on cost and power; text equal on 41. The one difference, Jane Foster Mighty Thor "cost 0", is a dropped "0" in the Untapped text, so the quote here is right. Mismatch rate 0% |
| Deafening Chord is a tech "card" at 1/0 | Untapped: `isSkill`, cost 1 | Confirmed, with the note that it is a skill: it has no Power and does not stay on the board |
| 15 lists on S2, deck codes decodable | S2 re-fetched: 15 short codes, each 12 distinct released cards | Confirmed |
| 132 distinct cards, 99 in exactly one list; Mobius M. Mobius in 5 lists; Scarlet Witch Queen of Chaos, Thanos Fractured Frontier, Shadow King in 4 | Recount from the 15 live codes | Confirmed |
| Mean power by cost, C(n,12), "23% of released" | Recomputed on the 511 pool | Corrected |
| Curve table, energy model, novelty and gem formulas, literature list, tier-list win rates and commentary quotes | not re-run or re-read (out of this pass's budget) | Could not confirm in this pass |
