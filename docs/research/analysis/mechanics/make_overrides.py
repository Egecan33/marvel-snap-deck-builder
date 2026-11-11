#!/usr/bin/env python3
"""Proposed review list: cards whose text the rule parser cannot (or should not) be trusted on.

Writes out/overrides_proposed.json = [{name, cost, power, text, reason, parser_tags}].
The reasons are research notes, not game facts; a human must write the actual override.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
T = {c["name"]: c for c in json.load(open(os.path.join(OUT, "traits.json")))}

REASONS = {
    # not fully parsed (unique verbs)
    "Agatha Harkness": "unique: 'She controls your cards on even turns'",
    "Aurora": "'Repeat for Ongoing, Activate, and End of Turn' is an elliptical second sentence",
    "Bruce Banner": "unique: 33% chance to 'HULK OUT' (result card not in text)",
    "Dormammu": "unique multi-step 'Summoning Ritual'; steps are separate non-pool cards",
    "Galactus First Steps": "unique 'Herald' designation",
    "Gwenpool": "two-sentence loop ('Pick ... 3 times. Give +2 Power each time')",
    "H.E.R.B.I.E.": "rotating Activate abilities not in the text",
    "Jane Foster Fractured Frontier": "unique verb 'Judge'; Quickdraw repeats it",
    "Magik": "names a location ('Limbo') whose text is not on the card; turn limit",
    "Nico Minoru": "spell changes each turn; spells not in the text",
    "Psylocke Fractured Frontier": "Quickdraw sentence only modifies the On Reveal ('Your whole hand instead')",
    "Punisher War Machine": "marks a location on draw; Objective reward depends on it",
    "Sam Wilson Captain America": "token (Cap's Shield) carries half of the effect",
    "Sinister Six": "unique 'EVIL' marking and delayed merge",
    "Techno-Organic Virus": "unique verb 'Infect' (replace their text) plus self-copy",
    "Thanos Fractured Frontier": "grants a quoted Quickdraw ability to other cards; 'Infinity Shot' effect not in text",
    "Zombie Galacti": "Game Start choice plus On Reveal mass transform",
    # parsed but the meaning is not in the words
    "Arishem": "'12 new cards' are random; changes deck size and opening energy curve",
    "Thanos": "the six Infinity Stones are non-pool cards with their own texts",
    "Agamotto": "Ancient Arcana are non-pool cards (skills?) with their own texts",
    "Kang": "replaced at Game Start by 4 random-text Kangs: deck slot becomes 4 cards",
    "Loki": "replaces own deck; every deck-based synergy of the list stops applying",
    "Rama-Tut": "uses On Reveals of other (older) cards, not of your deck; parser tags it as a repeater",
    "Silver Surfer First Steps": "copies text at End of Turn; whether the copied On Reveal fires is not stated",
    "Debrii": "'Add a Rock to each other location' does not say which side(s)",
    "Shanna": "'Add a random 1-Cost character to each location' does not say which side(s)",
    "Annihilus": "'switch sides. Destroy those that can't' - parser mis-targets the destroy",
    "Sandman": "parser target for the cost increase is wrong (affects all players next turn)",
    "Mirage": "buff goes to the copied card in own hand; parser says enemy_hand",
    "Captain Britain": "buff goes to the played card; parser says own_hand",
    "Wade Wilson": "the +2 Power goes to the replacement card; parser says self",
    "Tarantula": "buff hits self AND 2 cards in hand; parser records self only",
    "Shadowlands Daredevil": "bare '+2 Power' after 'When you draw a card' - recipient not stated",
    "High Evolutionary": "'Unlock the potential' rewrites specific no-ability cards; new texts are not in this card's text",
    "Shang-Chi, Master of the Rings": "The Ten Rings token plus 'Unlock their potential'",
    "En Sabah Nur": "transforms into a non-pool card with its own text",
    "Vampire Deacon Frost": "transforms into a non-pool card with its own text",
    "Red Onslaught": "3 random Ongoing abilities",
    "Emperor Hulkling": "random 6-Cost text at Game Start",
    "Mister Negative": "swaps Power and Cost of the deck: deck-wide stat inversion, no numeric magnitude",
    "The Living Tribunal": "redistributes total Power across locations",
    "Captain Marvel": "end-of-game conditional move",
    "Cerebro": "'Your highest-Power cards' - payoff for equal base Power across the deck (needs a dedicated rule)",
    "Ms. Marvel": "adjacent-location condition on distinct Costs",
    "Legion": "replaces other locations with this one",
    "Daredevil": "information effect on turn 5 only",
}


def main():
    out = []
    for name, why in REASONS.items():
        c = T[name]
        out.append({"name": name, "cost": c["cost"], "power": c["power"], "text": c["text"], "reason": why,
                    "fully_parsed": c["fully_parsed"],
                    "parser_effects": sorted({f"{cl['trigger']}>{e['kind']}:{e['target']}" for cl in c["clauses"] for e in cl["effects"]})})
    json.dump(out, open(os.path.join(OUT, "overrides_proposed.json"), "w"), indent=1, ensure_ascii=False)
    for o in out:
        print(f"| {o['name']} | {o['cost']}/{o['power']} | {o['text']} | {o['reason']} |")


if __name__ == "__main__":
    main()
