#!/usr/bin/env python3
"""Synergy axes and pair-interaction rules over out/traits.json (stdlib only).

Writes out/axes.json  axis -> rule text, enablers, payoffs (card names)
       out/edges.json per-rule edges + aggregated pairs
Everything here that is not a direct reading of card text is a HEURISTIC and is labelled so.
"""
import collections
import itertools
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
T = json.load(open(os.path.join(OUT, "traits.json")))
BY = {c["name"]: c for c in T}

OWN = r"^own"            # strictly own cards / hand / deck
OWN_BOARD = r"^(own_here|own_anywhere|own_other_locations|own|own_next_played|own_played_card)$"
OWNISH = r"^(own|all|both)"  # also hits own cards


def effs(c, kind, tgt=None, trig=None):
    out = []
    for cl in c["clauses"]:
        if trig and not re.search(trig, cl["trigger"]):
            continue
        for e in cl["effects"]:
            if re.fullmatch(kind, e["kind"]) and (tgt is None or re.search(tgt, e["target"])):
                out.append((cl, e))
    return out


def has(c, rx):
    return any(re.search(rx, t) for t in c["tags"])


def trig(c, rx):
    return any(re.fullmatch(rx, t) for t in c["triggers"])


def txt(c, rx):
    return bool(re.search(rx, c["text"]))


def cost_pred(s):
    m = re.search(r"(\d), (\d),? and (\d)-Cost", s)
    if m:
        v = {int(x) for x in m.groups()}
        return (lambda k: k in v), "cost in %s" % sorted(v), 3
    m = re.search(r"(\d) (?:and|or) (\d)-Cost", s)
    if m:
        v = {int(x) for x in m.groups()}
        return (lambda k: k in v), "cost in %s" % sorted(v), 3
    m = re.search(r"(\d)-Cost or (?:more|higher)|that are (\d)-Cost or more|that Cost (\d) or more", s)
    if m:
        n = int(next(x for x in m.groups() if x))
        return (lambda k: k >= n), "cost >= %d" % n, 2
    m = re.search(r"(\d)-Cost or (?:less|lower)|cost (\d) or less", s)
    if m:
        n = int(next(x for x in m.groups() if x))
        return (lambda k: k <= n), "cost <= %d" % n, 2
    m = re.search(r"(\d)-Cost|that cost (\d)\b", s)
    if m:
        n = int(next(x for x in m.groups() if x))
        return (lambda k: k == n), "cost == %d" % n, 3
    return None


def power_pred(s):
    m = re.search(r"(\d+) or more Power", s)
    if m:
        n = int(m.group(1))
        return (lambda p: p >= n), "power >= %d" % n, 3
    m = re.search(r"(\d+) or less Power|(\d) Power or less", s)
    if m:
        n = int(next(x for x in m.groups() if x))
        return (lambda p: p <= n), "power <= %d" % n, 2
    return None


def self_mover(c):
    return trig(c, "moveable") or bool(effs(c, "move", r"^self$")) or bool(effs(c, "grant_moveable", r"^self$"))


def drawback(c):
    """Cards whose own text hurts their owner (candidates for own-side text removal). HEURISTIC."""
    if effs(c, "afflict", r"^(self|own_here)$", "ongoing") or effs(c, "buff", r"^enemy", "ongoing"):
        return True
    if effs(c, "lockdown", r"^own_player$", "ongoing") or (effs(c, "loc_power", None, "ongoing") and txt(c, r"Your opponent has \+")):
        return True
    if effs(c, "destroy", r"^own_other_locations$", "on_reveal") and not txt(c, r"for each|Add their Power"):
        return True
    if effs(c, "opp_draw", None) or effs(c, "afflict", r"^own_here$", "on_reveal"):
        return True
    if effs(c, "destroy", r"^own_here$", "end_of_turn") or txt(c, r"You lose \d Max Energy"):
        return True
    return False


def perm_buff_own(c):
    return [x for x in effs(c, "buff|power_double|power_set", OWN) if x[0]["trigger"] != "ongoing" and x[1]["target"] != "own_player"]


# ---------------------------------------------------------------------------------- axes
# name: (weight, heuristic?, description of enabler rule, enabler fn, description of payoff rule, payoff fn)
AX = collections.OrderedDict()


def axis(name, w, heur, edesc, efn, pdesc, pfn):
    AX[name] = dict(weight=w, heuristic=heur, enabler_rule=edesc, payoff_rule=pdesc, efn=efn, pfn=pfn)


axis("destroy", 3, False,
     "effect destroy with target own_* / all_* / both (destroys own cards)",
     lambda c: bool(effs(c, "destroy", OWNISH)),
     "trigger when_destroyed / on_other_destroyed, scaling destroyed_count, condition have_destroyed*, objective destroyed, "
     "resurrect with source destroyed|both (own), power from destroyed cards",
     lambda c: trig(c, "when_destroyed|on_other_destroyed") or has(c, r"^scale:destroyed_count|^cond:have_destroyed|^cond:have_discarded_and_destroyed|^obj:destroyed")
     or any(e.get("source") in ("destroyed", "both") and e["target"] == "own" for _, e in effs(c, "resurrect"))
     or (bool(effs(c, "power_absorb")) and has(c, "^sel:from_destroyed")))
axis("discard", 3, False,
     "effect discard with target own_hand / both",
     lambda c: bool(effs(c, "discard", r"own_hand|both")) and not (c["name"] == "Black Cat"),
     "trigger when_discarded / on_other_discarded, scaling discard_count, condition have_discarded*, resurrect with source discarded|both (own)",
     lambda c: trig(c, "when_discarded|on_other_discarded") or has(c, r"^scale:discard_count|^cond:have_discarded")
     or any(e.get("source") in ("discarded", "both") and e["target"] == "own" for _, e in effs(c, "resurrect")))
axis("move", 3, False,
     "effect move with an own target other than self, or grant_moveable to own/all cards; self-movers (Moveable keyword, move:self) also count",
     lambda c: bool(effs(c, "move", r"^own|moved_card|any_played")) or bool(effs(c, "grant_moveable", r"^(own|all)")) or self_mover(c),
     "trigger on_self_move / on_other_move (not enemy-only), scaling move_count|moveable_played, condition moved_recently, selector 'that moved this turn' / Moveable card",
     lambda c: trig(c, "on_self_move") or (trig(c, "on_other_move") and not txt(c, "When an enemy card moves"))
     or has(c, r"^scale:(move_count|moveable_played)|^cond:moved_recently|^sel:moveable_card") or txt(c, r"that moved this turn|that last moved"))
axis("bounce", 2, True,
     "effect bounce with an own target other than self",
     lambda c: bool(effs(c, "bounce", r"^own")),
     "trigger on_self_bounce, or (heuristic) an On Reveal card costing <= 2 that is worth replaying, or own-play counters",
     lambda c: trig(c, "on_self_bounce") or (trig(c, "on_reveal") and c["cost"] <= 2 and not effs(c, "bounce", r"^own")) or has(c, r"^scale:cards_played"))
axis("on_reveal_amp", 2, False,
     "effect repeat_on_reveal, or copy_text conditioned on an On Reveal",
     lambda c: bool(effs(c, "repeat_on_reveal")) or (bool(effs(c, "copy_text")) and txt(c, r"has an On Reveal|On Reveal card in your hand|with an On Reveal card")),
     "carrier: any card with trigger on_reveal; counters: scaling on_reveal_count, objective on_reveal_played, condition played_on_reveal, buffs to On Reveal cards",
     lambda c: trig(c, "on_reveal"))
axis("on_reveal_count", 2, False,
     "any card with trigger on_reveal",
     lambda c: trig(c, "on_reveal"),
     "scaling on_reveal_count, objective on_reveal_played, condition played_on_reveal, trigger filter 'with an On Reveal', buff selecting On Reveal cards",
     lambda c: has(c, r"^scale:on_reveal_count|^obj:on_reveal_played|^cond:played_on_reveal|^trig_sel:on_reveal_card") or (has(c, "^sel:on_reveal_card") and bool(effs(c, "buff", OWN))))
axis("ongoing_amp", 2, False,
     "effect repeat_ongoing, copy_text conditioned on an Ongoing, buffs selecting own Ongoing cards, scaling own_ongoing_count",
     lambda c: bool(effs(c, "repeat_ongoing", OWN)) or (bool(effs(c, "copy_text")) and txt(c, "has an Ongoing")) or (has(c, "^sel:ongoing_card") and bool(effs(c, "buff", OWN))) or has(c, "^scale:own_ongoing_count"),
     "carrier: any card with trigger ongoing that is not a drawback",
     lambda c: trig(c, "ongoing") and not drawback(c))
axis("end_of_turn_amp", 2, False,
     "effect repeat_eot, buff selecting End of Turn cards",
     lambda c: bool(effs(c, "repeat_eot")) or (has(c, "^sel:eot_card") and bool(effs(c, "buff", OWN))) or txt(c, "Repeat for Ongoing, Activate, and End of Turn"),
     "carrier: any card with trigger end_of_turn",
     lambda c: trig(c, "end_of_turn"))
axis("activate_amp", 2, False,
     "effect repeat_activate, or 'Repeat for ... Activate'",
     lambda c: bool(effs(c, "repeat_activate")) or txt(c, "Repeat for Ongoing, Activate, and End of Turn"),
     "carrier: any card with trigger activate",
     lambda c: trig(c, "activate"))
axis("one_cost", 2, False,
     "base cost == 1, or generates 1-Cost cards",
     lambda c: c["cost"] == 1 or txt(c, r"(Add|Create) a (random )?1-Cost"),
     "own-side clause that names 1-Cost cards (buff / cost / protect / repeat / condition / bounce)",
     lambda c: any(re.search(r"\b1-Cost|1 and 6-Cost|1, 2, and 3-Cost|cost 1 or less", cl["text"]) and not re.search(r"enemy|ALL|opponent|[Aa]dd a random|Create a", cl["text"]) for cl in c["clauses"]))
axis("go_wide", 2, True,
     "puts extra bodies on own side: gen_board own, copy_card to a location, summon",
     lambda c: bool(effs(c, "gen_board", r"^(own|both)$")) or any(e.get("scope") in ("other", "here", "random") and not e.get("into") for _, e in effs(c, "copy_card")) or bool(effs(c, "summon", OWN)),
     "condition own_side_full / both_sides_full, scaling full_locations|own_cards_here|front_row_count, objective full_front_rows, unfiltered Ongoing buff to all own cards",
     lambda c: has(c, r"^cond:(own_side_full|both_sides_full)|^scale:(full_locations|own_cards_here|front_row_count)|^obj:full_front_rows") or txt(c, r"^Ongoing: Your other cards have \+"))
axis("hand_size", 2, False,
     "gen_hand, copy_card into hand, bounce own, extra draw",
     lambda c: bool(effs(c, "gen_hand")) or any(e.get("into") for _, e in effs(c, "copy_card")) or bool(effs(c, "bounce", r"^own")) or bool(effs(c, "draw", r"own_player|both", r"^(?!draw_position)")),
     "scaling own_hand_size, condition hand_full, buffs/cost changes to all cards in hand",
     lambda c: has(c, r"^scale:own_hand_size|^cond:hand_full") or (bool(effs(c, "buff|power_set|cost_reduce", r"^own_hand$")) and txt(c, r"all cards in your hand|each card in your hand|your hand \+|whole hand|cards in your hand that")))
axis("empower", 2, False,
     "non-Ongoing buff / double / set-power aimed at own cards other than itself (a permanent Power increase)",
     lambda c: bool(perm_buff_own(c)),
     "trigger on_self_empowered / on_any_empowered, selector increased_power, scaling increased_power_count, condition have_increased_power, 'Double Power increases'",
     lambda c: trig(c, "on_self_empowered|on_any_empowered") or has(c, r"^sel:increased_power|^scale:increased_power_count|^cond:have_increased_power") or txt(c, "Double Power increases"))
axis("cost_reduction", 1, True,
     "effect cost_reduce on own hand / deck / cards (not a self-discount)",
     lambda c: bool(effs(c, "cost_reduce", r"^own_(hand|deck|anywhere|here|drawn_card)|^both$|^all")),
     "HEURISTIC: base cost >= 5 with no self-discount; plus explicit big-cost counters (scaling big_cost_count, objective big_cost_in_play)",
     lambda c: (c["cost"] >= 5 and not trig(c, "static_cost")) or has(c, r"^scale:big_cost_count|^obj:big_cost_in_play"))
axis("energy_ramp", 1, True,
     "effect energy_gain / energy_max for own_player with positive magnitude",
     lambda c: any((e.get("magnitude") or 1) > 0 and not re.search("lose", e["core"]) for _, e in effs(c, "energy_gain|energy_max", r"^own_player$")),
     "HEURISTIC: base cost >= 6 with no self-discount",
     lambda c: c["cost"] >= 6 and not trig(c, "static_cost"))
axis("unspent_energy", 3, False,
     "energy_gain for own_player (energy next turn / bonus energy), or 'skip a turn' cards (condition played_last_turn)",
     lambda c: bool(effs(c, "energy_gain", r"^own_player$")) or has(c, "^cond:played_last_turn"),
     "condition own_unspent_energy, scaling unspent_energy|bonus_energy, objective unspent_energy",
     lambda c: has(c, r"^cond:own_unspent_energy|^scale:(unspent_energy|bonus_energy)|^obj:unspent_energy"))
axis("affliction", 3, False,
     "effect afflict / power_steal aimed at enemy_* / all_* / both board cards",
     lambda c: bool(effs(c, "afflict", r"^(enemy_here|enemy_anywhere|all_here|all_anywhere|moved_card)$")),
     "selector afflicted (counts or conditions on afflicted cards), 'Double the Power reductions', objective afflicted",
     lambda c: has(c, r"^sel:afflicted|^scale:afflicted_count|^cond:enemy_afflicted_here|^obj:afflicted") or txt(c, "Double the Power reductions"))
axis("self_affliction", 3, False,
     "afflicts own cards (afflict own_here / all_*), or base Power < 0 without its own switch-sides",
     lambda c: bool(effs(c, "afflict", r"^(own_here|all_here|all_anywhere)$")) or (c["power"] < 0 and not effs(c, "switch_sides", "^self$")),
     "switch_sides for own cards, protect against Power reduction, objective afflicted",
     lambda c: bool(effs(c, "switch_sides", r"^own")) or txt(c, r"can't have their Power reduced") or has(c, "^obj:afflicted"))
axis("created_cards", 3, False,
     "creates cards: gen_hand, gen_board own, gen_deck, copy_card",
     lambda c: bool(effs(c, "gen_hand|gen_deck|copy_card")) or bool(effs(c, "gen_board", "^(own|both)$")),
     "own-side clause with selector created (cost, power, play, merge, draw of created cards), scaling created_in_play, objective created_played",
     lambda c: has(c, r"^scale:created_in_play|^obj:created_played") or any("sel:created" in cl["selectors"] and not re.search("enemy|opponent", cl["text"]) for cl in c["clauses"]) or txt(c, "Your Rocks have"))
axis("junk_clog", 2, False,
     "junk_board / junk_hand / junk_deck, gen_board on both sides, opp_draw, moves enemy cards into this location",
     lambda c: bool(effs(c, "junk_board|junk_hand|junk_deck|opp_draw")) or bool(effs(c, "gen_board", "^(both|enemy)$")) or any(re.search(r"this location|here", e.get("dest") or "") for _, e in effs(c, "move", r"^enemy_anywhere$")),
     "scaling opp_hand_size|opp_deck_size|enemy_cards_here with a positive buff, condition both_sides_full",
     lambda c: (has(c, r"^scale:(opp_hand_size|opp_deck_size|enemy_cards_here)") and not effs(c, "afflict", "^self$")) or has(c, "^cond:both_sides_full"))
axis("location_control", 1, True,
     "lockdown (both / all_here), loc_change",
     lambda c: bool(effs(c, "lockdown", r"^(both|all_here)$")) or bool(effs(c, "loc_change")),
     "HEURISTIC bypass: 'Nothing can stop you', moves own cards, adds cards to other locations, self-movers",
     lambda c: txt(c, "Nothing can stop you") or bool(effs(c, "move", r"^own")) or any(e.get("scope") in ("other", "random") for _, e in effs(c, "gen_board|copy_card|summon")) or self_mover(c))
axis("merge", 3, False,
     "effect merge (this card merges, or merges others)",
     lambda c: bool(effs(c, "merge")) or txt(c, r"Add SP//dr"),
     "trigger on_self_merge",
     lambda c: trig(c, "on_self_merge"))
axis("skills", 2, False,
     "text adds a skill (only cards whose text says 'skill'; skill typing of tokens is NOT in the source data)",
     lambda c: txt(c, r"\bskill\b") and bool(effs(c, "gen_hand")),
     "trigger on_own_play filtered to skill",
     lambda c: has(c, "^trig_sel:skill"))
axis("deck_top", 2, False,
     "buff / cost / power_set aimed at own_deck (top card or whole deck), deck_stack",
     lambda c: bool(effs(c, "buff|cost_reduce|power_set|deck_stack", r"^own_deck$|^both$", "on_reveal|activate|game_start")) and has(c, r"own_deck|deck_stack"),
     "pulls cards out of own deck onto the board or reads the top card: summon own_deck, merge own_deck, copy_text own_deck, Monstro-style static cost, banish own_deck",
     lambda c: bool(effs(c, "summon|merge|copy_text|banish", r"^own_deck$")) or txt(c, r"cost of your deck's top card|top 3 cards of both decks"))
axis("draw", 2, False,
     "extra draw for own player (draw own_player / both outside draw_position)",
     lambda c: any(cl["trigger"] != "draw_position" for cl, _ in effs(c, "draw", r"own_player|both")),
     "trigger on_draw_any / on_draw_self / quickdraw",
     lambda c: trig(c, "on_draw_any|on_draw_self|quickdraw"))
axis("no_ability", 3, False,
     "card has no ability text",
     lambda c: not c["text"],
     "selector no_ability on an own-side effect, objective no_ability",
     lambda c: has(c, r"^sel:no_ability|^obj:no_ability"))
axis("power_steal", 3, False,
     "effect power_steal",
     lambda c: bool(effs(c, "power_steal")),
     "objective stolen_power",
     lambda c: has(c, "^obj:stolen_power"))
axis("horde", 3, False,
     "effect horde with a +N magnitude (feeds the Zombie Horde)",
     lambda c: any(e.get("magnitude") for _, e in effs(c, "horde")),
     "reads the Horde: Power equal to the Horde, the Horde steals Power",
     lambda c: txt(c, r"equal to your Zombie Horde|your Zombie Horde steals"))
axis("big_power", 2, False,
     "base Power >= 10",
     lambda c: c["power"] >= 10,
     "own-side clause with a 'N or more Power' filter (N >= 6): play trigger, cost scaling, draw",
     lambda c: any(re.search(r"(1\d|[6-9]) or more Power", cl["text"] + cl.get("trigger_phrase", "")) and not re.search("enemy", cl["text"]) for cl in c["clauses"]))
axis("multi_play", 2, True,
     "HEURISTIC: base cost <= 1, bounce of own cards, or cards that add 0/1-cost cards to hand",
     lambda c: c["cost"] <= 1 or bool(effs(c, "bounce", r"^own")) or txt(c, r"that cost 0 to your hand|costs 0 this turn"),
     "trigger on_own_play without a cost/power filter, scaling cards_played, condition played_n_cards with n >= 2",
     lambda c: (trig(c, "on_own_play") and not has(c, r"^trig_sel:(cost|power|skill)") and not txt(c, "next time you play")) or has(c, "^scale:cards_played") or txt(c, r"played \(exactly\) 2 cards|played 2 or more cards"))
axis("alone", 2, True,
     "HEURISTIC: clears own lane (destroy own_here, bounce own_here, merge own_here)",
     lambda c: bool(effs(c, "destroy|bounce|merge", r"^own_here$")),
     "condition alone_here / own_empty_location",
     lambda c: has(c, r"^cond:(alone_here|own_empty_location)"))
axis("sequencing", 1, True,
     "sets up the next card played or reads the last card played (selector next_played / last_played) with a Power effect",
     lambda c: has(c, r"^sel:(next_played|last_played)") and bool(effs(c, "buff|power_double|power_absorb|power_set|merge")),
     "HEURISTIC: base Power >= 9 (best target for double / copy-Power / give-Power effects)",
     lambda c: c["power"] >= 9)

ROLES = {}
for name, a in AX.items():
    en = [c["name"] for c in T if a["efn"](c)]
    pa = [c["name"] for c in T if a["pfn"](c)]
    ROLES[name] = (set(en), set(pa))
    a["enablers"], a["payoffs"] = en, pa
    a["both"] = sorted(set(en) & set(pa))

TECH = {
    "ongoing_removal": [c["name"] for c in T if effs(c, "silence|steal_text") and txt(c, "Ongoing")],
    "text_removal_enemy": [c["name"] for c in T if effs(c, "silence", r"^enemy")],
    "on_reveal_denial": [c["name"] for c in T if effs(c, "deny_on_reveal")],
    "enemy_destroy": [c["name"] for c in T if effs(c, "destroy", r"^enemy")],
    "enemy_discard": [c["name"] for c in T if effs(c, "discard", r"enemy_hand|both")],
    "enemy_cost_increase": [c["name"] for c in T if effs(c, "cost_increase", r"^(enemy|both)")],
    "enemy_displace": [c["name"] for c in T if effs(c, "move", r"^enemy")],
    "lockdown": [c["name"] for c in T if effs(c, "lockdown")],
    "protection": [c["name"] for c in T if effs(c, "protect")],
    "play_restricted": [c["name"] for c in T if trig(c, "play_restriction")],
    "drawback_cards": [c["name"] for c in T if drawback(c)],
}

# ---------------------------------------------------------------------------------- edges
EDGES = []


def edge(a, b, rule, kind, strength, why):
    if a["name"] != b["name"]:
        EDGES.append({"a": a["name"], "b": b["name"], "rule": rule, "kind": kind, "strength": strength, "why": why})


def created_zones(c):
    z = set()
    if effs(c, "gen_hand") or any(e.get("into") for _, e in effs(c, "copy_card")):
        z.add("hand")
    if effs(c, "gen_deck"):
        z.add("deck")
    if effs(c, "gen_board", "^(own|both)$") or any(not e.get("into") for _, e in effs(c, "copy_card")):
        z.add("board")
    return z


def pair_ok(name, a, b):
    """Extra guards found by the first hand-check (v1 sample): zone and subject must line up."""
    if name == "move":
        moves_others = bool(effs(a, "move", r"^own|moved_card|any_played")) or bool(effs(a, "grant_moveable", r"^(own|all)"))
        counts = has(b, r"^scale:(move_count|moveable_played)|^cond:moved_recently") or trig(b, "on_other_move") or txt(b, "that moved this turn|that last moved")
        return moves_others or counts  # a self-mover does not move somebody else's "when this moves" card
    if name == "created_cards":
        z = created_zones(a)
        if txt(b, "Rocks"):
            return txt(a, "Rock")
        if txt(b, r"created card from your hand|created in your hand|created cards cost"):
            return "hand" in z or ("deck" in z and txt(b, "cost"))
        if txt(b, "created card from your deck"):
            return "deck" in z
        return True
    if name == "cost_reduction":
        # filtered reducers are handled by filter:cost; only unfiltered hand/deck reducers reach any big card
        for cl, e in effs(a, "cost_reduce", r"^own_(hand|deck|anywhere|here|drawn_card)|^both$|^all"):
            if not any(s.startswith(("sel:cost", "sel:created", "sel:top_of_deck", "sel:power", "sel:moveable")) for s in cl["selectors"]) \
                    and not txt(a, "Replace your deck|Add a random|Add copies|Copy a card|Copy the leftmost|Return your other"):
                return True
        return has(b, r"^scale:big_cost_count|^obj:big_cost_in_play") and False
    if name == "on_reveal_amp":
        return not txt(a, "released before|copy its text\\.$")
    if name == "destroy" and trig(b, "when_destroyed"):
        # fixed after the v2 hand-check: a filtered destroyer (Killmonger, Lady Deathstrike) must be able to hit b
        for cl, e in effs(a, "destroy", OWNISH):
            cp, pp = cost_pred(cl["text"]), power_pred(cl["text"])
            if (cp and not cp[0](b["cost"])) or (pp and not pp[0](b["power"])):
                return False
    if name == "multi_play" and txt(b, "if it has an On Reveal"):
        return trig(a, "on_reveal")
    return True


# R1 axis enabler x payoff
for name, ax in AX.items():
    en, pa = ROLES[name]
    for a in en:
        for b in pa:
            if a != b and pair_ok(name, BY[a], BY[b]):
                edge(BY[a], BY[b], "axis:" + name, "synergy", ax["weight"],
                     f"{a} is a {name} enabler ({ax['enabler_rule'][:60]}); {b} is a {name} payoff")

for a in T:
    # R2 cost / power filter match on own-side positive clauses
    for cl in a["clauses"]:
        s = cl["text"] + " " + cl.get("trigger_phrase", "")
        if re.search(r"enemy|opponent|ALL|Nobody|\bANY\b|EACH", s):
            continue
        kinds = {e["kind"] for e in cl["effects"]}
        positive = kinds & {"buff", "cost_reduce", "protect", "repeat_on_reveal", "bounce", "draw", "power_double", "play_restriction"}
        if not positive:
            continue
        if cl["trigger"] in ("static_cost",) and "scale:big_power_count" not in a["tags"] and "big_cost" not in " ".join(cl["scaling"]):
            pass
        cp, pp = cost_pred(s), power_pred(s)
        if "random" in s.lower() or re.search(r"Add a|Create a|Replace this", s):
            continue
        for b in T:
            if "repeat_on_reveal" in kinds and not trig(b, "on_reveal"):
                continue  # fixed after the v2 hand-check: a repeater needs an On Reveal to repeat
            if cp and cp[0](b["cost"]) and not re.search(r"this (card )?(has|gains)", s):
                edge(a, b, "filter:cost", "synergy", cp[2], f"{a['name']} text '{cl['text']}' names {cp[1]}; {b['name']} costs {b['cost']}")
            if pp and pp[0](b["power"]) and not s.startswith("This has") and "sel:top_of_deck" not in cl["selectors"]:
                edge(a, b, "filter:power", "synergy", pp[2], f"{a['name']} text '{cl['text']}' names {pp[1]}; {b['name']} has base Power {b['power']}")
    # R3 mass effects that hit own cards by cost/power filter
    for cl, e in effs(a, "destroy|afflict|lockdown", r"^(all_here|all_anywhere|both)$"):
        cp, pp = cost_pred(cl["text"]), power_pred(cl["text"])
        for b in T:
            hit = (cp and cp[0](b["cost"])) or (pp and pp[0](b["power"]))
            if not hit:
                continue
            if e["kind"] == "destroy" and trig(b, "when_destroyed"):
                edge(a, b, "mass:destroy_feeds", "synergy", 2, f"{a['name']} destroys {b['name']} ({cl['text']}), which has When Destroyed")
            else:
                edge(a, b, "mass:hits_own", "anti", 2 if e["kind"] == "destroy" else 1, f"{a['name']} '{cl['text']}' also hits your {b['name']} (cost {b['cost']}, power {b['power']})")
    # R4 discard selector vs When Discarded cost
    for cl, e in effs(a, "discard", r"own_hand|both"):
        for b in T:
            if not trig(b, "when_discarded"):
                continue
            sel = cl["selectors"]
            ok = None
            if "sel:highest_cost" in sel:
                ok = b["cost"] >= 5
            elif "sel:lowest_cost" in sel or "sel:lowest_power" in sel:
                ok = b["cost"] <= 2
            elif "sel:odd_cost" in sel:
                ok = b["cost"] % 2 == 1
            elif "sel:even_cost" in sel:
                ok = b["cost"] % 2 == 0
            elif "sel:cost_le" in sel:
                ok = b["cost"] <= 1
            if ok is True:
                edge(a, b, "discard:selector_hit", "synergy", 2, f"{a['name']} discard selector ({cl['text']}) points at {b['name']} (cost {b['cost']})")
            elif ok is False:
                edge(a, b, "discard:selector_miss", "anti", 1, f"{a['name']} discard selector ({cl['text']}) will not pick {b['name']} (cost {b['cost']}) while other cards are in hand")
    # R5 discard vs hand-size payoffs; highest-cost discard vs expensive cards without discard payoff
    if effs(a, "discard", r"own_hand") and a["name"] in ROLES["discard"][0]:
        for b in T:
            if has(b, r"^scale:own_hand_size|^cond:hand_full"):
                edge(a, b, "anti:discard_vs_hand_size", "anti", 2, f"{a['name']} empties your hand; {b['name']} wants a large hand")
            if has(b, "^cond:hand_small"):
                edge(a, b, "syn:discard_small_hand", "synergy", 2, f"{a['name']} empties your hand; {b['name']} wants 1 or fewer cards in hand")
        if has(a, "^sel:highest_cost") or txt(a, "Discard your hand"):
            for b in T:
                if b["cost"] >= 5 and b["name"] not in ROLES["discard"][1]:
                    edge(a, b, "anti:discard_hits_key_card", "anti", 2, f"{a['name']} discards your most expensive card; {b['name']} (cost {b['cost']}) has no discard payoff")
    # R6 own-side denial of own keywords
    if effs(a, "deny_on_reveal"):
        for b in T:
            if trig(b, "on_reveal"):
                edge(a, b, "anti:cosmo_own_on_reveal", "anti", 1, f"{a['name']} stops On Reveal abilities at its location, including your {b['name']}")
    if effs(a, "silence", r"^all_here$"):
        key = "ongoing" if txt(a, "Ongoing") else "end_of_turn"
        for b in T:
            if trig(b, key):
                if drawback(b):
                    edge(a, b, "syn:remove_own_drawback", "synergy", 2, f"{a['name']} removes the {key} text of {b['name']}, which is a drawback")
                else:
                    edge(a, b, "anti:silences_own_" + key, "anti", 1, f"{a['name']} removes ALL {key} abilities at its location, including your {b['name']}")
    if effs(a, "silence", r"^(own_anywhere|own_deck)$"):
        for b in T:
            if drawback(b) and (not txt(a, "Ongoing") or trig(b, "ongoing")):
                edge(a, b, "syn:remove_own_drawback", "synergy", 3, f"{a['name']} removes the text of {b['name']}, whose text is a drawback")
            elif txt(a, "Ongoing") and trig(b, "ongoing") and not drawback(b):
                edge(a, b, "anti:silences_own_ongoing", "anti", 2, f"{a['name']} removes Ongoing abilities in your deck, including {b['name']}")
    # R7 destroy protection vs destroy plans
    for cl, e in effs(a, "protect", r"^(all_here|own_anywhere)$"):
        if "destroyed" not in cl["text"]:
            continue
        cp = cost_pred(cl["text"])
        for b in T:
            if cp and not cp[0](b["cost"]):
                continue
            if trig(b, "when_destroyed"):
                edge(a, b, "anti:protect_blocks_when_destroyed", "anti", 2 if cp else 1, f"{a['name']} ({cl['text']}) stops {b['name']} from being destroyed, so its When Destroyed never fires")
            elif not cp and effs(b, "destroy", r"^own_here$"):
                edge(a, b, "anti:protect_blocks_destroyer", "anti", 2, f"{a['name']} ({cl['text']}) blocks {b['name']} from destroying your cards there")
    # R8 fillers vs alone / space
    fills_other = any(e.get("scope") in ("other", "random") and not e.get("into") for _, e in effs(a, "gen_board|copy_card")) and effs(a, "gen_board|copy_card", r"^(own|both|self|own_anywhere)$")
    if fills_other:
        for b in T:
            if has(b, r"^cond:(alone_here|own_empty_location)"):
                edge(a, b, "anti:filler_vs_alone", "anti", 2, f"{a['name']} adds cards to your other locations; {b['name']} wants to be alone / an empty location")
            if any(e["target"] == "own" for _, e in effs(b, "resurrect")) or effs(b, "summon", r"^own_(deck|hand)$"):
                edge(a, b, "anti:filler_vs_space", "anti", 1, f"{a['name']} fills your side of other locations; {b['name']} needs free slots to put cards into play")
    # R9 play-count conflicts
    if effs(a, "lockdown", r"^own_player$") and txt(a, "1 card a turn"):
        for b in T:
            if b["name"] in ROLES["multi_play"][1]:
                edge(a, b, "anti:one_card_a_turn", "anti", 3, f"{a['name']} limits you to 1 card a turn; {b['name']} pays off for playing several")
            if txt(b, r"played \(exactly\) 1 card|played 1 card this turn"):
                edge(a, b, "syn:one_card_a_turn", "synergy", 2, f"{a['name']} limits you to 1 card a turn; {b['name']} wants exactly 1 card played")
    # R10 enemy-count payoffs / penalties vs own junk onto the enemy side
    if a["name"] in ROLES["junk_clog"][0] and (effs(a, "junk_board") or effs(a, "gen_board", "^(both|enemy)$") or effs(a, "move", "^enemy_anywhere$")):
        for b in T:
            if effs(b, "afflict", "^self$") and has(b, r"^(scale:enemy_cards_here|cond:opp_count_here)"):
                edge(a, b, "anti:junk_feeds_penalty", "anti", 2, f"{a['name']} adds cards to the enemy side; {b['name']} loses Power for enemy cards there")
    # R11 self-affliction vs own low-power payoffs handled by axis; Luke Cage style protect vs own afflict
    # R12 skip-a-turn vs multi-play
    # R13 text copy of big statlines: sequencing handled by axis

# specificity: an edge counts for more when one of its endpoints has few partners under that rule
# (Patriot x Hulk is worth more than Wong x any On Reveal card). HEURISTIC weighting.
import math
fan_a = collections.Counter((e["a"], e["rule"]) for e in EDGES)
fan_b = collections.Counter((e["b"], e["rule"]) for e in EDGES)
for e in EDGES:
    fan = math.sqrt(fan_a[(e["a"], e["rule"])] * fan_b[(e["b"], e["rule"])])
    e["weight"] = round(e["strength"] / math.log2(2 + fan), 3)

PAIRS = collections.defaultdict(lambda: {"score": 0, "rules": []})
seen = set()
for e in EDGES:
    k = tuple(sorted((e["a"], e["b"])))
    rk = (k, e["rule"])
    if rk in seen:
        continue
    seen.add(rk)
    p = PAIRS[k]
    p["score"] = round(p["score"] + (e["weight"] if e["kind"] == "synergy" else -e["weight"]), 3)
    p["rules"].append({"rule": e["rule"], "kind": e["kind"], "strength": e["strength"], "weight": e["weight"], "why": e["why"]})
pairs = sorted(({"a": k[0], "b": k[1], **v} for k, v in PAIRS.items()), key=lambda p: (-p["score"], p["a"], p["b"]))

json.dump({n: {k: v for k, v in a.items() if k not in ("efn", "pfn")} for n, a in AX.items()} | {"_tech": TECH},
          open(os.path.join(OUT, "axes.json"), "w"), indent=1, ensure_ascii=False)
json.dump({"edges": EDGES, "pairs": pairs}, open(os.path.join(OUT, "edges.json"), "w"), ensure_ascii=False)

rule_counts = collections.Counter(e["rule"] for e in EDGES)
summary = {
    "axes": len(AX),
    "edges": len(EDGES),
    "pairs": len(pairs),
    "synergy_edges": sum(e["kind"] == "synergy" for e in EDGES),
    "anti_edges": sum(e["kind"] == "anti" for e in EDGES),
    "pairs_net_positive": sum(p["score"] > 0 for p in pairs),
    "pairs_net_negative": sum(p["score"] < 0 for p in pairs),
    "rule_counts": rule_counts.most_common(),
    "axis_counts": {n: [len(a["enablers"]), len(a["payoffs"]), len(a["both"])] for n, a in AX.items()},
    "tech_counts": {k: len(v) for k, v in TECH.items()},
}
json.dump(summary, open(os.path.join(OUT, "edges_summary.json"), "w"), indent=1, ensure_ascii=False)

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "summary"
    if mode == "summary":
        print(json.dumps(summary, ensure_ascii=False))
    elif mode == "axes":
        for n, a in AX.items():
            print(f"## {n} E={len(a['enablers'])} P={len(a['payoffs'])} both={len(a['both'])}")
            print("  E:", "; ".join(a["enablers"][:14]))
            print("  P:", "; ".join(a["payoffs"][:14]))
        for k, v in TECH.items():
            print("tech", k, len(v), "; ".join(v[:12]))
    elif mode == "examples":
        ex = {}
        for n, a in AX.items():
            ex[n] = {r: [{"name": x, "cost": BY[x]["cost"], "power": BY[x]["power"], "text": BY[x]["text"]} for x in sorted(a[r], key=lambda x: (len(BY[x]["text"]) == 0, x))[:5]] for r in ("enablers", "payoffs")}
        json.dump(ex, open(os.path.join(OUT, "axes_examples.json"), "w"), indent=1, ensure_ascii=False)
        for n, a in AX.items():
            print(f"{n}|{len(a['enablers'])}|{len(a['payoffs'])}|{len(a['both'])}|" + ", ".join(x["name"] for x in ex[n]["enablers"]) + "|" + ", ".join(x["name"] for x in ex[n]["payoffs"]))
    elif mode == "top":
        for p in pairs[:40]:
            print(p["score"], "|", p["a"], "+", p["b"], "|", ", ".join(r["rule"] for r in p["rules"]))
        print("--- most negative")
        for p in pairs[-15:]:
            print(p["score"], "|", p["a"], "+", p["b"], "|", ", ".join(r["rule"] for r in p["rules"]))
    elif mode == "sample":
        random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 20261112)
        uniq = [e for e in EDGES]
        for e in random.sample(uniq, 30):
            print(f"[{e['kind']} {e['strength']}] {e['rule']} :: {e['a']} ({BY[e['a']]['cost']}/{BY[e['a']]['power']}) \"{BY[e['a']]['text']}\"  X  {e['b']} ({BY[e['b']]['cost']}/{BY[e['b']]['power']}) \"{BY[e['b']]['text']}\"")
