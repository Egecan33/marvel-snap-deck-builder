#!/usr/bin/env python3
"""Rule-based ability-text parser prototype for Snap Forge (no AI, stdlib only).

Reads  docs/research/raw/mechanics/cards.json (see build_pool.py)
Writes out/traits.json   per-card clauses, effects, tags
       out/coverage.json coverage numbers, unparsed fragments by frequency

Model
  card -> segments (keyword header such as "On Reveal:") -> sentences -> clause
  clause = trigger + effects[] + conditions[] + scaling[] + selectors[] + durations[]
  effect = kind + target + magnitude

"Fully parsed" is a token-level claim: every word of the sentence is consumed by an effect
core, a trigger phrase, a condition, a scaling phrase, a selector/target phrase, a duration
or a function word, and no condition/scaling fell into the generic "other" bucket.
It does NOT prove the phrases were attached to the right effect; that is hand-checked
separately (see mechanics.md).
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.normpath(os.path.join(HERE, "..", "..", "raw", "mechanics"))
OUT = os.path.join(HERE, "out")

HEADERS = [
    ("On Reveal and When Destroyed", ["on_reveal", "when_destroyed"]),
    ("When Discarded or Destroyed", ["when_discarded", "when_destroyed"]),
    ("On Reveal", ["on_reveal"]),
    ("Ongoing", ["ongoing"]),
    ("Activate", ["activate"]),
    ("Game Start", ["game_start"]),
    ("End of Turn", ["end_of_turn"]),
    ("Start of Turn (after drawing)", ["start_of_turn"]),
    ("Start of Turn", ["start_of_turn"]),
    ("When Destroyed", ["when_destroyed"]),
    ("When Discarded", ["when_discarded"]),
    ("Objective", ["objective"]),
    ("Quickdraw", ["quickdraw"]),
]
HEADER_RE = re.compile("(" + "|".join(re.escape(h) for h, _ in HEADERS) + "):")
HEADER_MAP = dict(HEADERS)

# sentence-level triggers that have no keyword header: (regex, trigger, may override a keyword segment)
PASSIVE = [
    (r"^When this (card )?moves( to a location)?,?", "on_self_move", True),
    (r"^The first time this moves,?", "on_self_move", True),
    (r"^After this moves to a location,?", "on_self_move", True),
    (r"^When this returns to your hand,?", "on_self_bounce", True),
    (r"^When this merges,?", "on_self_merge", True),
    (r"^Gains (?=\+\d+ Power from merging)", "on_self_merge", True),
    (r"^When this is Empowered,?", "on_self_empowered", True),
    (r"^When your cards in play are Empowered,?", "on_any_empowered", True),
    (r"^When you draw this,?|^When drawn,?", "on_draw_self", True),
    (r"^When you draw a card( with \d+ or more Power)?,?", "on_draw_any", True),
    (r"^After one of your other cards is destroyed,?", "on_other_destroyed", True),
    (r"^When one of your cards is destroyed,?", "on_other_destroyed", True),
    (r"^When you discard a card,?", "on_other_discarded", True),
    (r"^When (a|an enemy) card moves here,?", "on_other_move", True),
    (r"^The first time another one of your cards moves here each turn,?", "on_other_move", True),
    (r"^After your opponent plays (a|an)( Ongoing)? card here,?", "on_opp_play", False),
    (r"^After ANY( \d or \d-Cost)? card is played here,?", "on_any_play", False),
    (r"^After you play (a|an) [^,]*?(card|skill)( here)?( with (higher Power|an On Reveal|\d+ or more Power))?( here)?,?", "on_own_play", False),
    (r"^After the next time you play a \d-Cost card,?", "on_own_play", False),
    (r"^Each card you play to fill your side of a location", "on_own_play", False),
    (r"^Each turn, the first card you play at another location", "on_own_play", False),
    (r"^Your cards reveal here", "on_own_play", False),
    (r"^At the end of the game,?", "end_of_game", False),
    (r"^The next time your opponent would start a turn with bonus Energy,?", "on_opp_bonus_energy", False),
    (r"^(Costs? \d+ (less|if)|This card's cost is reduced|If a card moved last turn, this costs)", "static_cost", True),
    (r"^Double Cost reductions to this", "static_cost", True),
    (r"^(You can only play this|You can't play this|If you played a card last turn, you can't play this)", "play_restriction", True),
    (r"^Moveable( once| twice)?\.?$", "moveable", True),
    (r"^(Starts in your opening hand|You always draw this card)", "draw_position", True),
]
PASSIVE = [(re.compile(r), t, o) for r, t, o in PASSIVE]

# ---- qualifiers -------------------------------------------------------------------------------
CONDITIONS = [
    (r"if you're winning (here|this location)( after next turn)?( with an On Reveal card)?|each time you're winning here|where you are winning|for each location you're winning|if you'd be winning its location", "winning_here"),
    (r"if you're losing this location|to a location you're losing", "losing_here"),
    (r"if (your side of this location|your side here|your side) is full( here)?|that's full on your side|to fill your side of a location|when your side of this location is full", "own_side_full"),
    (r"if both sides here are full|if either side here is full", "both_sides_full"),
    (r"if this is your only card here|and this is your only card here|alone at another location", "alone_here"),
    (r"if your opponent played (a card|any cards) here this turn", "opp_played_here"),
    (r"if you play a card at this location next turn|if you play your next card at this location", "play_here_next"),
    (r"if you don't play a card at this location next turn", "no_play_here_next"),
    (r"if you have unspent Energy|for each turn you've ended with unspent Energy|End \d turns in a row with unspent Energy", "own_unspent_energy"),
    (r"if your opponent has unspent Energy", "opp_unspent_energy"),
    (r"if you spent all your Energy|and spent all your Energy|if you've spent all your Energy on previous turns|for each turn in which you spent all your Energy", "spent_all_energy"),
    (r"if you played \d cards?( this turn)?|for each turn you played \d or more cards", "played_n_cards"),
    (r"if you played a 1-Cost card this turn", "played_1cost"),
    (r"if you played an On Reveal", "played_on_reveal"),
    (r"if you played a card last turn", "played_last_turn"),
    (r"that wins you the game", "wins_game"),
    (r"if your hand is full", "hand_full"),
    (r"if your hand has 1 or fewer cards", "hand_small"),
    (r"if a card moved last turn|if you used a Moveable ability", "moved_recently"),
    (r"if your opponent discarded a card this game", "opp_discarded"),
    (r"if you've discarded a card|for each turn you've discarded a card", "have_discarded"),
    (r"if one of your cards has been destroyed", "have_destroyed"),
    (r"if you've had cards discarded and destroyed", "have_discarded_and_destroyed"),
    (r"if you have the highest Power among cards in play", "own_highest_power"),
    (r"if the last card you played has an (On Reveal|Ongoing)", "last_played_has_keyword"),
    (r"if this is at the middle location", "at_middle"),
    (r"if this is in the back row", "in_back_row"),
    (r"if it's an odd turn, otherwise give to the right location", "odd_even_turn"),
    (r"on even turns|on turn \d|after turn \d|until turn \d|Doesn't work after turn \d", "turn_number"),
    (r"if it has less Power|if it was 4-Cost or more|if it's 5-Cost or more|if it has an On Reveal", "if_it_stat"),
    (r"if your opponent has 4 cards here", "opp_count_here"),
    (r"if any of your locations are empty", "own_empty_location"),
    (r"if you have any cards with increased Power in play", "have_increased_power"),
    (r"if your opponent played a card with greater Power this turn", "opp_played_bigger"),
    (r"if a player Snapped", "snapped"),
    (r"if you can't|if your total is higher|if they have any|those that can't", "fallback"),
    (r"where you have a 1-Cost card", "have_1cost_here"),
    (r"where an enemy is afflicted with negative Power", "enemy_afflicted_here"),
    (r"if your other cards in play cost exactly 8 total", "exact_cost_total"),
    (r"\bif [^,.]*", "other"),
]
SCALING = [
    (r"for each card in your hand|each card in your hand gives", "own_hand_size"),
    (r"for each card in your opponent's hand", "opp_hand_size"),
    (r"for each card in your opponent's deck", "opp_deck_size"),
    (r"for each enemy card (here|there)", "enemy_cards_here"),
    (r"for each other card you have here|for each of your cards at the right location", "own_cards_here"),
    (r"for each( card)? destroyed( this game)?|for each location where one of your cards has been destroyed", "destroyed_count"),
    (r"for each time you discarded a card this game", "discard_count"),
    (r"for each time one of your cards moved this game|for each moved", "move_count"),
    (r"for each returned", "bounce_count"),
    (r"for each other Ongoing card you have in play", "own_ongoing_count"),
    (r"for EACH On Reveal card in play", "on_reveal_count"),
    (r"for each( of your)? unspent Energy( last turn)?", "unspent_energy"),
    (r"for each bonus Energy you have", "bonus_energy"),
    (r"for each different Cost among (them|their cards in play|your cards in play)", "distinct_costs"),
    (r"for each different Power among all other cards here", "distinct_powers"),
    (r"for each location that's full on your side", "full_locations"),
    (r"for each of your created cards in play", "created_in_play"),
    (r"for each other card you played this turn|for each card you played last turn", "cards_played"),
    (r"for each card in play afflicted with negative Power", "afflicted_count"),
    (r"for each of your cards that has 10 or more Power", "big_power_count"),
    (r"for each of your other cards in play with increased Power", "increased_power_count"),
    (r"for each \d-Cost or more card you have here and in hand", "big_cost_count"),
    (r"for each of your front-Row characters", "front_row_count"),
    (r"for each higher-Cost card here", "higher_cost_here"),
    (r"for each Moveable card you've played", "moveable_played"),
    (r"with Cost equal to your unspent Energy", "unspent_energy"),
    (r"for each location\b", "locations"),
    (r"for each\b", "each"),
    (r"for each [^,.]*", "other"),
]
DURATIONS = [
    r"until the end of next turn", r"until the game ends", r"next turn", r"this turn", r"last turn",
    r"each turn( this is in play)?", r"once per game", r"this game", r"as the turn starts", r"after this turn",
    r"the first time", r"\(?if possible\)?", r"instead", r"otherwise", r"immediately", r"always",
]
SELECTORS = [
    (r"highest-Power|highest Power", "sel:highest_power"), (r"lowest-Power|lowest Power", "sel:lowest_power"),
    (r"highest-Cost|that costs the most", "sel:highest_cost"), (r"lowest-Cost|that costs the least", "sel:lowest_cost"),
    (r"\brandom(ly)?\b|EXTREMELY random", "sel:random"), (r"leftmost", "sel:leftmost"), (r"rightmost", "sel:rightmost"),
    (r"(the )?last (card|character) (you|your opponent|EACH player) played|your card that last moved", "sel:last_played"),
    (r"(the |your )?next (card|character) you play|after you play (your next (card|character)|it|them all)", "sel:next_played"),
    (r"front-row|front row", "sel:front_row"), (r"back-row|back row", "sel:back_row"),
    (r"\bcreated\b|that were created in your hand", "sel:created"),
    (r"even-costed", "sel:even_cost"), (r"odd-costed", "sel:odd_cost"),
    (r"\d(, \d,)? (and|or) \d-Cost( or more)?", "sel:cost_set"),
    (r"\d-Cost or (more|higher)|that are \d-Cost or more|that Cost \d or more", "sel:cost_ge"),
    (r"\d-Cost or (less|lower)|that cost \d or less|\d-Cost or less", "sel:cost_le"),
    (r"\d-Cost", "sel:cost_eq"), (r"that cost(s)? 0", "sel:cost_eq"),
    (r"(that has |with )?\d+ or more Power", "sel:power_ge"), (r"with \d+ or less Power|\d+ or less Power|with Power below 0|with \d Power or less|with 1 or less Power", "sel:power_le"),
    (r"with less Power( than [^.]*)?", "sel:less_power_than_self"),
    (r"with no abilities", "sel:no_ability"), (r"with increased Power", "sel:increased_power"),
    (r"afflicted with negative Power|afflicted", "sel:afflicted"),
    (r"On Reveal cards?|cards? with an On Reveal", "sel:on_reveal_card"), (r"Ongoing cards?", "sel:ongoing_card"),
    (r"Activate cards?", "sel:activate_card"), (r"End of Turn cards?", "sel:eot_card"), (r"Moveable card", "sel:moveable_card"),
    (r"When Discarded card", "sel:when_discarded_card"),
    (r"unrevealed", "sel:unrevealed"), (r"\btop (card|character|\d cards)\b|deck's top card|bottom card", "sel:top_of_deck"),
    (r"with the same (Power|Cost)|costs the same or more", "sel:same_stat"), (r"\bskill\b", "sel:skill"),
    (r"that moved this turn|played here this turn|you revealed this turn|destroyed last turn|played this turn|played next turn", "sel:this_turn"),
    (r"\bdifferent\b", "sel:different"), (r"\bfirst\b", "sel:first"), (r"\b(up to )?\d+ total Cost\b", "sel:total_cost"),
    (r"that started there|that isn't full|with the fewest cards|in front of it|\bRocks\b", "sel:misc"),
    (r"discarded (or|and) destroyed", "sel:from_discarded_or_destroyed"),
    (r"\bdestroyed\b", "sel:from_destroyed"), (r"\b(you )?discarded\b", "sel:from_discarded"),
    (r"\b(you |are )?play(ed|s)?\b", "sel:played"),
]
TARGET_WORDS = [
    r"your opponent's (hand|deck|starting deck|side of this location|side)", r"their (hand|side of this location|cards in play)",
    r"(in|from|to) your hand( or deck)?", r"your (whole )?hand", r"(in|into|from|of) your deck", r"your deck", r"both decks|EACH deck's|in ALL hands",
    r"each player('s hand)?|EACH player|the losing player's deck|Nobody|Players",
    r"your opponent", r"enem(y|ies)", r"your (other )?(cards|characters)( here| in play)?", r"one of your( other)?", r"your other",
    r"(ALL|all|every|each|EACH|any|ANY) (other )?(cards?|characters?)( here| in play)?", r"other cards?( here)?",
    r"(at|to|in) (each|another|the) other locations?", r"(at|to) (each|another|a random|the right|the left|the middle|this|the old|any) location(s)?( to the (left|right))?",
    r"(to|on) (each|your) side of this location|on your side|your side of this location", r"to the (right|left)|one location to the (right|left)|to random locations|a location",
    r"your opening hand", r"the (left|right|middle) location", r"your lowest-Power location", r"\bhere\b", r"\bthere\b", r"in play", r"this location", r"other locations", r"at each location", r"this card's|this card|itself|this one",
    r"your", r"its location", r"old location", r"its previous location", r"both", r"away", r"\blocations?\b",
]
STOP = set("""a an the to and then of that it its is are with from on at in this card cards character characters you
too be by for has have had their them they those these or but as would do does get gets gain gains give gives each
one two three four 1 2 3 4 5 6 12 into was were who which so can when after up out all other another new copy copies
he she him her my i me she's there's until while than more less 0 times time turns turn 's many additional reveals reveal ones""".split())

# ---- effects: (kind, regex, fixed_target or None) ----------------------------------------------------
E = []


def eff(kind, rx, target=None):
    E.append((kind, re.compile(rx, re.I), target))


# order matters: earlier rules claim their span first
eff("deny_on_reveal", r"On Reveal abilities won't happen here", "location")
eff("repeat_on_reveal", r"its ability happens again|repeat the On Reveal abilities of|the On Reveal abilities of (.*?) repeat|your On Reveal abilities here repeat|uses that card's On Reveal|Use \d On Reveals from cards released before Rama-Tut's time|Use the highest-Cost On Reveal in your hand|repeat (this|its On Reveal) ability")
eff("repeat_ongoing", r"your other Ongoing effects here apply an additional time|has the Ongoing effects of|has \d random Ongoing abilities")
eff("repeat_eot", r"your End of Turn abilities repeat")
eff("repeat_activate", r"Immediately Activate|\(?without using up their Activate abilities\)?")
eff("silence", r"remove(s)? (the|its) (text|abilities)( from| of| on)?", None)
eff("steal_text", r"steal the text (from|of)")
eff("copy_text", r"cop(y|ies) (its|the) text( of| from)?( like it just revealed)?|copy the text|replace the text of|with text from (a )?random cards?( of the same Cost)?|\"oink!\"")
eff("transform", r"Transform into [A-Z][\w' ,]+|transform(s)? (into|your|those cards into)|become a copy of|unlock (the|their) potential( of)?")
eff("reveal_delay", r"(are )?not revealed until the game ends|don't reveal( it)? until the game ends")
eff("protect", r"can't be destroyed(, moved, or have its Power reduced)?|can't have their Power reduced|Nothing can stop you from (moving or )?playing (this|cards)( to any location| anywhere)?")
eff("lockdown", r"you can't play cards here|Nobody can play cards|You can only play 1 card a turn|must play their first card here|is the last turn cards can be played here|Moving is the only way to add or remove a character from here|Cards can't be added to locations except by playing or moving them|can't move|you can't play them", None)
eff("play_restriction", r"You can only play this( at| where)?|You can't play this( after turn \d| at)?|you can't play this", "self")
eff("loc_change", r"Replace (this|each other|its) location( with (a new one|'Limbo'|this one|a random new one))?|destroy all other locations|Flood this location|Swap the positions of the other two locations", "location")
eff("loc_power", r"(The location to the right has|Adjacent locations have|to other locations|Your opponent has [+-]\d+ Power at each other location|Your adjacent locations with 2\+ cards and no repeated Costs have)( [+-]\d+ Power)?|[+-]\d+ Power(?= +to other locations)", "location")
eff("total_power", r"Your total Power is doubled here|Split your total Power evenly among all locations", "location")
eff("switch_sides", r"switch(es)? sides")
eff("grant_moveable", r"(is|are|gains?|It's|and) Moveable|Moveable (once|twice)|^Moveable$|gets? [+-]\d Power when it moves")
eff("resurrect", r"resurrects?|reviv(e|ed)|gets revived|regenerate|bring back|put this back|return in its next phase|return all your discarded and destroyed cards to hand")
eff("bounce", r"returns? (this |your [^.]*?|it )?to your hand")
eff("merge", r"merges? (this |it |them |cards from your deck |your [^.]*?|the last card you played )?into( this| it| one of your cards)?|merges?\b|from merging")
eff("junk_deck", r"Shuffle (a|\d+) Rocks? into (your opponent's|the losing player's) deck", "enemy_deck")
eff("gen_deck", r"Shuffle(s)? (in )?(\d+ |the |a )?[A-Z][\w' ]*?(into your deck|new cards into your deck)|Shuffle in \d Demons|Replace this with \d Kangs|Shuffle \d+ new cards into your deck|Shuffle the six Infinity Stones into your deck", "own_deck")
eff("junk_hand", r"Add (a|an|\d) [A-Z][\w' ]*? to your opponent's hand", "enemy_hand")
eff("junk_board", r"Add (a|an) [A-Z][\w' ]*? to your opponent's side of this location|Add a card from your opponent's deck to their side of this location|Pull the lowest-Power character from your opponent's hand to their side of this location", "enemy_here")
eff("summon", r"Put a (created )?card from your hand here|Add the top card of your deck to this location|Add a \d-Cost or less card from your deck here|add it here|Add a \d or \d-Cost card from your hand to each other location|add a card from your hand to the old location|flies out of your hand or deck to replace it|Runs from your hand to a random location|Replace this with a \d-Cost card from your hand or deck|swap (it|the last card you played) with (one|a card[^.]*?) from your deck|Put an Ongoing card from your deck here|This jumps to|Jump to|Recruit a card|Pull Excalibur free to here")
eff("copy_card", r"cop(y|ies) (of )?(your hand|your opening hand|this|it|the enemy card\(s\)|a card|the leftmost card|one of them|the character)|Add copies of|Add a copy( of)?|two copies of this|Add an exact clone of this|Add two copies of this|Get a copy of|Copy this|Copy the|copy one of them|Copy a card|Copy your hand")
eff("gen_board", r"Add (a |an |\d |the )?[\w\-' /]*?(Rock|Squirrel|DoomBot( 2099)?|Tiger|Illusion|Void|Sinister Clone|Broodlings|Ice Cube|Sword of Fu Xi|Cap's Shield|character)(?!s? to your hand)s?( here)?( with the same Power)?|Deploy four 2-Power Drones|Create a 1-Cost card|Replace this with (the Winter Soldier|Spider-Man)")
eff("gen_hand", r"Add (a|an|\d|the|another) [\w\-' /,]*?to your hand|Add [A-Z][\w/' ]+ to your hand|The Ten Rings starts in your hand|Fill your hand with random cards|get a Vampiric Spear|to get a random character|Add step 1 to hand|starts in your hand", "own_hand")
eff("energy_max", r"[+-]\d+ Max Energy|lose \d Max Energy|Set your Max Energy equal to this card's Power")
eff("energy_gain", r"\+\d+ Energy|steal \d bonus Energy|they don't get it|that much Energy")
eff("cost_reduce", r"-\d+ Costs?|costs? \d+ less|cost \d less|costs 0|It costs 0|cards cost 0|of this that cost 0|this costs 1|Costs [13]\b|costs 3\b|cost is reduced by the cost of|cost a maximum of 4|Set (the|their) Costs? (and Power )?(of [^.]*?)?to [0-3]\b|Set (its|their) Costs? to [0-3]\b|Double Cost reductions")
eff("cost_increase", r"\+\d+ Costs?|costs? \d+ more|costs 6|Increase the Cost|cost \d more")
eff("cost_other", r"Costs can't be (increased|reduced)|Shuffle the base Costs|Swap the Power and Cost")
eff("power_double", r"double (this card's|its|your Champion's) Power|with (its )?Power doubled|with double the Power|Double Power increases to this|Double the Power reductions on")
eff("power_steal", r"steals? (all the |\d+ )?Power( from)?|have stolen Power")
eff("power_set", r"Set (the |this card's |ALL cards here to )?(\d+ )?Power( of [^.]*?)?( equal)? to( \d+| that of| the banished card's Cost)?|and Power to \d+|Power to \d+|with its Power set to \d+|Reset [^.]*? to their original Power|Invert the Power of|Set ALL cards here to \d+ Power|Set their Power to the banished card's Cost|Set the top character of your deck's Power to \d+")
eff("power_absorb", r"gain(s)? (its|the) Power( of)?|Add their Power to|Add this card's Power to|with negative Power equal to this card's Power|Power equal to( this card's Power| your Zombie Horde)?|Has the combined Power of|Swap Power with|Remove that card's Power from|with that much negative Power|with negative Power equal to|with that same increase|Compare the Power of")
eff("banish", r"banish(ed)?")
eff("horde", r"Horde \+\d+( for each)?|your Zombie Horde|Horde first if necessary", "self")
eff("afflict", r"\bafflict\b[^.]*?-\d+ Power|split -\d+ Power among|-\d+ Power|\bafflict\b")
eff("buff", r"\+\d+ Power( each)?( each time)?")
eff("deck_stack", r"Put your leftmost card in hand on top of your deck", "own_hand")
eff("deck_replace", r"Replace your deck with your opponent's starting deck", "own_deck")
eff("repeat_self", r"Repeat on a different enemy", "enemy_anywhere")
eff("expiry", r"Doesn't work", "self")
eff("discard", r"\bdiscards?\b")
eff("destroy", r"\bdestroy\b( it with a Rock)?")
eff("move", r"\bmoves?\b( away| it back)?|pull an enemy card from here to there")
eff("opp_draw", r"Your opponent draws \d cards?", "enemy")
eff("draw", r"\bdraws?\b( Agatha)?|Starts in your opening hand|You always draw this card|and not before|you can't draw cards")
eff("info", r"Tap this to see the top card of your deck|you get to see your opponent's plays before you make your own|You can see the unrevealed locations|Your text emotes are ruder", "self")

OBJECTIVE_REQ = [
    (r"Your cards are destroyed \d times", "obj:destroyed"),
    (r"Have \d cards that are \d-Cost or more in play", "obj:big_cost_in_play"),
    (r"Have a full front row at each location", "obj:full_front_rows"),
    (r"Play \d total Cost of created cards", "obj:created_played"),
    (r"Have \d different Powers among your other cards in play", "obj:distinct_powers"),
    (r"Cards in play are afflicted with -\d Power", "obj:afflicted"),
    (r"Have \d cards with no abilities in play", "obj:no_ability"),
    (r"End \d turns in a row with unspent Energy", "obj:unspent_energy"),
    (r"Play \d On Reveal cards", "obj:on_reveal_played"),
    (r"\d of your cards have stolen Power", "obj:stolen_power"),
    (r"This has \d or more Power", "obj:self_power"),
    (r"Win that location", "obj:win_location"),
]


def split_sentences(text):
    parts = re.split(r"(?<=[.!])\s+(?=[A-Z+\-\"])", text.strip())
    return [p.strip() for p in parts if p.strip()]


def segments(text):
    """Yield (triggers, body) per keyword header; text before the first header is passive."""
    out = []
    pos = 0
    cur = ["passive"]
    for m in HEADER_RE.finditer(text):
        # ignore headers quoted inside another ability (Thanos Fractured Frontier)
        if text.count('"', 0, m.start()) % 2 == 1:
            continue
        body = text[pos:m.start()].strip()
        if body:
            out.append((cur, body))
        cur = HEADER_MAP[m.group(1)]
        pos = m.end()
    body = text[pos:].strip()
    if body:
        out.append((cur, body))
    return out


def resolve_target(window, kind):
    w = window
    low = w.lower()
    here = bool(re.search(r"\bhere\b|\bthere\b|at this location|from here", low))
    if re.search(r"in all hands|each player|both decks|each deck|nobody|players must|either side|both sides", low):
        return "both"
    if re.search(r"opponent's hand|their hand", low):
        return "enemy_hand"
    if re.search(r"opponent's (starting )?deck|losing player's deck", low):
        return "enemy_deck"
    if re.search(r"\b(all|any) (other )?(cards|characters|\d)|\ball cards\b|each (other )?card here|each card here|\bany\b", low) and not re.search(r"your|enemy", low):
        return "all_here" if here else "all_anywhere"
    if re.search(r"enem(y|ies)|opponent", low):
        return "enemy_here" if here else "enemy_anywhere"
    if re.search(r"your (whole )?hand|in hand\b|from your hand|to your hand", low):
        return "own_hand"
    if re.search(r"your deck|deck's top|from your deck", low):
        return "own_deck"
    if re.search(r"\bcards here\b|cards? .*\bhere\b", low) and not re.search(r"\byour\b|\byou\b", low) and kind not in ("buff", "afflict") :
        return "all_here"
    if re.search(r"your|one of|you have|you play|you played", low):
        if re.search(r"other locations?|at each location|another location|adjacent|left location|right location", low) and kind in ("buff", "afflict", "destroy"):
            return "own_other_locations"
        return "own_here" if here else "own_anywhere"
    if re.search(r"\b(cards|characters) here\b|each card here", low):
        return "all_here"
    if kind in ("cost_increase", "cost_reduce") and re.search(r"^\W*(all )?cards cost", low):
        return "both"
    if re.search(r"\b(it|its|them|they|their|those|that card|the copy|both)\b", low) and kind in ("buff", "afflict", "cost_reduce", "cost_increase", "power_set", "power_double", "move", "destroy", "grant_moveable", "silence"):
        return "that_card"
    return "self?"


# what "it" means when no earlier effect in the card names a target
TRIGGER_SUBJECT = {
    "on_opp_play": "enemy_here", "on_own_play": "own_played_card", "on_any_play": "any_played_card",
    "on_other_move": "moved_card", "on_draw_any": "own_drawn_card", "on_self_move": "self",
    "on_self_merge": "self", "on_self_empowered": "self", "on_self_bounce": "self", "when_destroyed": "self",
    "when_discarded": "self", "on_draw_self": "self",
}


def settle_targets(clauses):
    """Second pass over a card: resolve pronoun targets and bare defaults using earlier effects."""
    last = None
    for c in clauses:
        for e in c["effects"]:
            t, k = e["target"], e["kind"]
            core = e["core"].lower()
            if k == "resurrect":
                if re.search(r"put this back|return in its next phase|regenerate", core):
                    t = "self"
                elif "opponent" in c["text"].lower():
                    t = "enemy"
                else:
                    t = "own"
                low = c["text"].lower() + " " + c.get("objective_req", "").lower()
                d, x = "discard" in low, "destroy" in low
                e["source"] = "both" if d and x else ("discarded" if d else ("destroyed" if x else c["trigger"]))
            elif k == "summon" and re.search(r"jump|runs|flies", core):
                t = "self"
            elif k == "discard" and t not in ("enemy_hand", "both"):
                t = "own_hand"
            elif k == "protect" and core.startswith("nothing can stop"):
                t = "self" if "this" in core else "own_player"
            elif k == "power_set" and "this card's power" in core:
                t = "self"
            elif t == "that_card":
                if last and not (last == "self" and c["trigger"] in ("on_own_play", "on_any_play", "on_opp_play", "on_other_move", "on_draw_any")):
                    t = last
                elif "sel:next_played" in c["selectors"] or "play_here_next" in c["conditions"]:
                    t = "own_next_played"
                else:
                    t = TRIGGER_SUBJECT.get(c["trigger"], "self")
            elif t == "self?":
                if k in ("cost_reduce", "cost_increase") and c["trigger"] != "static_cost" and last and "this" not in core:
                    t = last
                elif k == "lockdown":
                    t = "both"
                else:
                    t = "self"
            if k == "bounce":
                e.pop("magnitude", None)
            e["target"] = t
            if k not in ("energy_gain", "energy_max", "horde", "info", "banish"):
                last = t


DEST = re.compile(r"\bmoves here|\bto (this location|here|the (right|left|middle)( location)?|another location|a random location|random locations|that card|there|any location)|one location to the (left|right)|at another location|to a location[^.]*", re.I)


def parse_sentence(sent, trigger):
    clause = {"trigger": trigger, "text": sent, "effects": [], "conditions": [], "scaling": [],
              "selectors": [], "durations": [], "residual": []}
    s = sent
    consumed = [False] * len(s)

    def claim(a, b):
        for i in range(a, b):
            consumed[i] = True

    def free(a, b):
        return not any(consumed[a:b])

    # trigger phrase
    trig_span = None
    for rx, trig, override in PASSIVE:
        m = rx.search(s)
        if m:
            clause["trigger_phrase"] = m.group(0)
            for srx, tag in SELECTORS:
                if re.search(srx, m.group(0), re.I):
                    clause["selectors"].append("trig_" + tag)
            if trig not in ("static_cost", "play_restriction", "moveable", "draw_position"):
                claim(m.start(), m.end())
                trig_span = (m.start(), m.end())
            break
    mask = list(s)
    if trig_span:
        for i in range(*trig_span):
            mask[i] = " "
    for rx, name in CONDITIONS:
        for m in re.finditer(rx, s, re.I):
            if free(m.start(), m.end()):
                claim(m.start(), m.end())
                clause["conditions"].append(name)
                for i in range(m.start(), m.end()):
                    mask[i] = " "
    for rx, name in SCALING:
        for m in re.finditer(rx, s, re.I):
            if free(m.start(), m.end()):
                claim(m.start(), m.end())
                clause["scaling"].append(name)
                if name not in ("each",):
                    for i in range(m.start(), m.end()):
                        mask[i] = " "
    masked = "".join(mask)
    found = []
    for kind, rx, fixed in E:
        for m in rx.finditer(masked):
            if m.end() > m.start() and free(m.start(), m.end()):
                claim(m.start(), m.end())
                found.append((m.start(), m.end(), kind, fixed, m.group(0)))
    found.sort()
    prev_target = None
    # cores whose target phrase precedes them ("give X +2 Power"): look back to the previous core
    trailing = ("buff", "afflict", "cost_reduce", "cost_increase", "power_double", "energy_gain", "energy_max")
    for i, (a, b, kind, fixed, core) in enumerate(found):
        if i == 0:
            w_start = 0
        elif kind in trailing and not core.lower().startswith("afflict"):
            w_start = found[i - 1][1]
        else:
            w_start = a
        w_end = found[i + 1][0] if i + 1 < len(found) else len(s)
        window = masked[w_start:w_end]
        e = {"kind": kind, "core": core}
        if kind in ("gen_board", "loc_power", "afflict", "buff"):
            num = re.search(r"([+-]?\d+)[- ]Power", core)
        elif kind in ("silence", "copy_text", "repeat_on_reveal", "summon", "copy_card", "protect", "lockdown", "play_restriction"):
            num = None
        else:
            num = re.search(r"[+-]?\d+", core)
        if num:
            e["magnitude"] = int(num.group(1) if num.lastindex else num.group(0))
        dest = DEST.search(window)
        if dest:
            e["dest"] = dest.group(0)
        twin = DEST.sub(" ", window) if kind in ("move", "summon", "gen_board", "copy_card", "resurrect") else window
        if kind == "bounce":
            twin = re.sub(r"to (your )?hand", " ", twin, flags=re.I)
        gap = masked[found[i - 1][1]:a] if i else ""
        low = window.lower()
        if fixed:
            tgt = fixed
        elif i and kind in ("buff", "afflict", "cost_reduce", "cost_increase", "power_set", "power_double") \
                and re.fullmatch(r"\W*(and|or|,|too)?\W*", gap) and found[i - 1][2] in ("buff", "afflict", "cost_reduce", "cost_increase", "power_set", "silence"):
            tgt = prev_target
        elif i and kind == "silence" and re.fullmatch(r"\W*and\W*", gap):
            tgt = prev_target
        elif kind in ("energy_gain", "energy_max"):
            tgt = "enemy_player" if re.search(r"opponent|they", low) else "own_player"
        elif kind == "draw":
            tgt = "enemy_deck" if "opponent's deck" in low else ("both" if "each player" in low else "own_player")
        elif kind == "lockdown" and re.match(r"you can", core, re.I):
            tgt = "own_player"
        elif kind == "repeat_on_reveal" and "its ability" in core.lower():
            tgt = "own_here"
        elif kind in ("buff", "power_double") and re.search(r"this card's power|this gains|give this\b|\bthis and\b", low):
            tgt = "self"
        elif kind == "bounce" and re.search(r"returns? this", core, re.I):
            tgt = "self"
        else:
            tgt = resolve_target(twin, kind)
        if kind in ("gen_board", "copy_card", "summon", "resurrect"):
            dl = window.lower()
            scope = "here" if re.search(r"\bhere\b|this location|to replace it|replace this", dl) else (
                "other" if re.search(r"other locations?|another location|old location|right location", dl) else (
                    "random" if re.search(r"random locations?|lowest-power location|fewest cards|each location", dl) else "na"))
            e["scope"] = scope
            if kind == "copy_card" and re.search(r"(in|into|to) your hand|your hand|opening hand", dl):
                e["into"] = "hand"
            if kind == "gen_board":
                tgt = "both" if "each side" in dl else ("enemy" if re.search(r"opponent|their side", dl) else "own")
        e["target"] = tgt
        prev_target = tgt
        clause["effects"].append(e)
        if kind == "cost_reduce" and re.search(r"Cost and Power", core):
            clause["effects"].append({"kind": "power_set", "core": core, "magnitude": e.get("magnitude"), "target": tgt})
    for rx, tag in SELECTORS:
        for m in re.finditer(rx, s, re.I):
            if free(m.start(), m.end()):
                claim(m.start(), m.end())
                clause["selectors"].append(tag)
            elif tag not in clause["selectors"] and re.search(rx, s, re.I):
                clause["selectors"].append(tag)
    for rx in DURATIONS:
        for m in re.finditer(rx, s, re.I):
            if free(m.start(), m.end()):
                claim(m.start(), m.end())
                clause["durations"].append(m.group(0).lower())
    for rx in TARGET_WORDS:
        for m in re.finditer(rx, s, re.I):
            if free(m.start(), m.end()):
                claim(m.start(), m.end())
    rest = "".join(ch if not consumed[i] else " " for i, ch in enumerate(s))
    words = [w for w in re.findall(r"[A-Za-z0-9'/+\-!]+", rest) if w.lower() not in STOP]
    clause["residual"] = words
    clause["selectors"] = sorted(set(clause["selectors"]))
    static = trigger in ("moveable", "draw_position", "static_cost", "play_restriction")
    clause["parsed"] = bool(clause["effects"] or static) and not words \
        and "other" not in clause["conditions"] and "other" not in clause["scaling"]
    return clause


def parse_card(card):
    text = card["text"]
    notes = re.findall(r"\(([^)]*)\)", text)
    body = re.sub(r"\s*\((?!s\))[^)]*\)", "", text)
    body = body.replace("card(s)", "cards")
    clauses = []
    for trigs, seg in segments(body):
        if trigs == ["objective"]:
            req, _, reward = seg.partition("=>")
            c = parse_sentence(reward.strip(), "objective") if reward.strip() else {
                "trigger": "objective", "text": "", "effects": [], "conditions": [], "scaling": [],
                "selectors": [], "durations": [], "residual": ["<no reward>"], "parsed": False}
            c["objective_req"] = req.strip()
            tag = next((t for rx, t in OBJECTIVE_REQ if re.search(rx, req)), None)
            c["objective_tag"] = tag
            if not tag:
                c["parsed"] = False
                c["residual"] = c["residual"] + ["<objective-req>"]
            clauses.append(c)
            continue
        prev = None
        for sent in split_sentences(seg):
            trig = None
            for rx, t, override in PASSIVE:
                if rx.search(sent):
                    if trigs == ["passive"] or override:
                        trig = [t]
                    break
            if trig is None:
                trig = trigs if trigs != ["passive"] else (prev or ["passive"])
            prev = trig
            for t in trig:
                clauses.append(parse_sentence(sent, t))
    settle_targets(clauses)
    tags = set()
    for c in clauses:
        tags.add("trig:" + c["trigger"])
        for e in c["effects"]:
            tags.add(f"{e['kind']}:{e['target']}")
            tags.add(f"{c['trigger']}>{e['kind']}:{e['target']}")
            if e.get("scope"):
                tags.add(f"{e['kind']}@{e['scope']}")
            if e.get("into"):
                tags.add(f"{e['kind']}>hand")
        tags.update("cond:" + x for x in c["conditions"])
        tags.update("scale:" + x for x in c["scaling"])
        tags.update(c["selectors"])
        if c.get("objective_tag"):
            tags.add(c["objective_tag"])
    if not text:
        tags.add("no_ability")
    return {
        "id": card["id"], "name": card["name"], "cost": card["cost"], "power": card["power"], "text": text,
        "triggers": sorted({c["trigger"] for c in clauses}), "clauses": clauses, "notes": notes,
        "tags": sorted(tags),
        "has_trait": bool(not text or any(c["effects"] or c["trigger"] != "passive" for c in clauses)),
        "fully_parsed": bool(not text or (clauses and all(c["parsed"] for c in clauses))),
    }


def main():
    pool = json.load(open(os.path.join(RAW, "cards.json")))
    parsed = [parse_card(c) for c in pool]
    os.makedirs(OUT, exist_ok=True)
    json.dump(parsed, open(os.path.join(OUT, "traits.json"), "w"), indent=1, ensure_ascii=False)
    n = len(parsed)
    with_text = [p for p in parsed if p["text"]]
    no_ability = [p["name"] for p in parsed if not p["text"]]
    clauses = [c for p in with_text for c in p["clauses"]]
    resid = collections.Counter()
    unparsed_sent = collections.Counter()
    for p in with_text:
        for c in p["clauses"]:
            if not c["parsed"]:
                unparsed_sent[c["text"]] += 1
                for w in c["residual"]:
                    resid[w.lower()] += 1
    cov = {
        "pool": n,
        "no_ability": no_ability,
        "cards_with_text": len(with_text),
        "cards_with_trait_pct_of_text": round(100 * sum(p["has_trait"] and bool(any(c["effects"] for c in p["clauses"]) or any(c["trigger"] in ("moveable", "static_cost", "play_restriction", "draw_position") for c in p["clauses"])) for p in with_text) / len(with_text), 1),
        "cards_fully_parsed_pct_of_text": round(100 * sum(p["fully_parsed"] for p in with_text) / len(with_text), 1),
        "cards_fully_parsed_pct_of_pool": round(100 * sum(p["fully_parsed"] for p in parsed) / n, 1),
        "clauses": len(clauses),
        "clauses_parsed_pct": round(100 * sum(c["parsed"] for c in clauses) / len(clauses), 1),
        "clauses_with_effect_pct": round(100 * sum(bool(c["effects"]) for c in clauses) / len(clauses), 1),
        "trigger_counts": collections.Counter(c["trigger"] for c in clauses).most_common(),
        "effect_kind_counts": collections.Counter(e["kind"] for c in clauses for e in c["effects"]).most_common(),
        "target_counts": collections.Counter(e["target"] for c in clauses for e in c["effects"]).most_common(),
        "unparsed_sentences": unparsed_sent.most_common(),
        "residual_words": resid.most_common(120),
        "cards_without_any_effect": [p["name"] for p in with_text if not any(c["effects"] for c in p["clauses"])],
        "cards_not_fully_parsed": [p["name"] for p in with_text if not p["fully_parsed"]],
    }
    json.dump(cov, open(os.path.join(OUT, "coverage.json"), "w"), indent=1, ensure_ascii=False)
    brief = {k: v for k, v in cov.items() if k not in ("unparsed_sentences", "residual_words", "no_ability", "cards_not_fully_parsed")}
    print(json.dumps(brief, ensure_ascii=False))
    if "-v" in sys.argv:
        print("RESIDUAL", resid.most_common(150))
        for p in with_text:
            for c in p["clauses"]:
                if not c["parsed"]:
                    print("UNP|", p["name"], "|", c["trigger"], "|", c["text"], "|", c["residual"], "|", [e["kind"] for e in c["effects"]])


if __name__ == "__main__":
    main()
