#!/usr/bin/env python3
"""Draw and energy maths for a 12-card Marvel Snap deck.

Inputs are the rules confirmed in docs/research/deck-theory-and-creativity.md:
12 distinct cards, 3 cards in hand before turn 1, one draw at the start of
every turn including turn 1, 6 turns, energy on turn t = t, hand limit 7.

Part A is exact (hypergeometric, fractions). Part B checks A by simulation.
Part C is a Monte Carlo energy model with two play policies; it is a model,
not a rule, and is labelled heuristic in the research file.

Run: python3 docs/research/analysis/theory/draw_odds.py
Standard library only. Deterministic (fixed seed).
"""
from fractions import Fraction
from functools import lru_cache
from itertools import combinations
from math import comb
import random

DECK = 12
OPENING_HAND = 3
TURNS = 6
HAND_LIMIT = 7
SEED = 20261112


def seen(turn: int, extra: int = 0) -> int:
    """Cards seen by the time you play on `turn` (opening hand + one per turn)."""
    return min(DECK, OPENING_HAND + turn + extra)


def p_at_least_one(k: int, n: int) -> Fraction:
    """P(at least one of k specific cards among n seen)."""
    return 1 - Fraction(comb(DECK - k, n), comb(DECK, n))


def p_all(k: int, n: int) -> Fraction:
    """P(all k specific cards among n seen)."""
    if n < k:
        return Fraction(0)
    return Fraction(comb(DECK - k, n - k), comb(DECK, n))


def p_one_of_each(a: int, b: int, n: int) -> Fraction:
    """P(at least one of group A (a cards) and at least one of group B (b cards))."""
    none_a = Fraction(comb(DECK - a, n), comb(DECK, n))
    none_b = Fraction(comb(DECK - b, n), comb(DECK, n))
    none_ab = Fraction(comb(DECK - a - b, n), comb(DECK, n))
    return 1 - none_a - none_b + none_ab


def pct(x) -> str:
    return f"{float(x) * 100:5.1f}%"


def table(title, header, rows):
    print(f"\n### {title}")
    print("| " + " | ".join(str(h) for h in header) + " |")
    print("|" + "---|" * len(header))
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")


def part_a():
    turns = list(range(1, TURNS + 2))  # include turn 7 (Limbo / extra turn)
    table("A1. Cards seen by turn (no extra draw)", ["turn"] + turns,
          [["cards seen"] + [seen(t) for t in turns],
           ["share of deck"] + [pct(Fraction(seen(t), DECK)) for t in turns]])

    table("A2. P(at least one of k cards seen by turn N); k=1 is a specific card",
          ["k \\ turn"] + turns,
          [[k] + [pct(p_at_least_one(k, seen(t))) for t in turns] for k in range(1, 7)])

    table("A3. P(all pieces of a combo seen by turn N)", ["pieces \\ turn"] + turns,
          [[k] + [pct(p_all(k, seen(t))) for t in turns] for k in (2, 3, 4)])

    table("A4. Redundancy: P(>=1 enabler AND >=1 payoff by turn N), a enablers x b payoffs",
          ["a x b \\ turn"] + turns,
          [[f"{a} x {b}"] + [pct(p_one_of_each(a, b, seen(t))) for t in turns]
           for a, b in ((1, 1), (1, 2), (2, 2), (1, 3), (2, 3), (3, 3), (4, 2), (4, 3))])

    table("A5. Extra draws: P by final turn 6 with d extra cards seen",
          ["event \\ extra draws d", 0, 1, 2, 3],
          [["specific card"] + [pct(p_at_least_one(1, seen(6, d))) for d in range(4)],
           ["both of 2"] + [pct(p_all(2, seen(6, d))) for d in range(4)],
           ["all of 3"] + [pct(p_all(3, seen(6, d))) for d in range(4)],
           ["1 enabler x 2 payoffs"] + [pct(p_one_of_each(1, 2, seen(6, d))) for d in range(4)]])

    table("A6. P(at least one card of cost <= t has been seen by turn t), k_t such cards",
          ["k_t \\ turn t", 1, 2, 3],
          [[k] + [pct(p_at_least_one(k, seen(t))) for t in (1, 2, 3)] for k in range(1, 8)])

    table("A7. P(a specific card is in the opening 3 / seen by its natural turn)",
          ["cost c", 1, 2, 3, 4, 5, 6],
          [["seen by turn c"] + [pct(Fraction(seen(c), DECK)) for c in range(1, 7)],
           ["NOT seen by turn 6"] + [pct(1 - Fraction(seen(6), DECK))] * 6])


def part_b(trials=200_000):
    """Monte Carlo check of the closed forms in part A."""
    rng = random.Random(SEED)
    deck = list(range(DECK))
    hits = {"one": 0, "two": 0, "three": 0, "1x2": 0, "any3": 0}
    n = seen(6)
    for _ in range(trials):
        rng.shuffle(deck)
        s = set(deck[:n])
        hits["one"] += 0 in s
        hits["two"] += (0 in s and 1 in s)
        hits["three"] += (0 in s and 1 in s and 2 in s)
        hits["1x2"] += (0 in s and (1 in s or 2 in s))
        hits["any3"] += bool(s & {0, 1, 2})
    exact = {"one": p_at_least_one(1, n), "two": p_all(2, n), "three": p_all(3, n),
             "1x2": p_one_of_each(1, 2, n), "any3": p_at_least_one(3, n)}
    rows = []
    worst = 0.0
    for k in hits:
        sim = hits[k] / trials
        diff = abs(sim - float(exact[k]))
        worst = max(worst, diff)
        rows.append([k, pct(exact[k]), f"{sim * 100:5.1f}%", f"{diff * 100:.2f} pp"])
    table(f"B. Simulation check at turn 6 ({trials} shuffles, seed {SEED})",
          ["event", "exact", "simulated", "abs diff"], rows)
    assert worst < 0.005, "closed form and simulation disagree"
    print("\nCheck passed: every closed form is within 0.5 pp of simulation.")


@lru_cache(maxsize=None)
def _maximal_plays(hand, energy):
    out = set()
    idx = range(len(hand))
    for r in range(len(hand) + 1):
        for combo in combinations(idx, r):
            total = sum(hand[i] for i in combo)
            if total > energy:
                continue
            rest = [hand[i] for i in idx if i not in combo]
            if rest and min(rest) <= energy - total:
                continue
            out.add(tuple(sorted(hand[i] for i in combo)))
    return tuple(out)


def maximal_plays(hand, energy):
    """Distinct maximal sub-multisets of `hand` (costs) with total <= energy.

    Maximal = no further card in hand fits in the leftover energy. Holding back a
    card that fits never increases total energy spent, so restricting to maximal
    plays keeps the optimum. Memoised on the sorted hand.
    """
    return _maximal_plays(tuple(sorted(hand)), energy)


def simulate_energy(costs, trials, rng):
    """Return per-turn stats for the greedy policy and the clairvoyant optimum.

    Greedy: each turn play the subset that spends the most energy this turn
    (ties: fewer cards, i.e. the bigger bodies). It never looks ahead.
    Clairvoyant: knows the draw order and maximises total energy spent; an upper
    bound on what any real policy can spend. Cards that cost more than the turn's
    energy stay in hand; cost reduction, ramp and board space are ignored.
    """
    spent_greedy = [0.0] * TURNS
    full_greedy = [0] * TURNS
    noplay_greedy = [0] * TURNS
    total_opt = 0.0
    deck = list(costs)
    for _ in range(trials):
        rng.shuffle(deck)
        order = tuple(deck)

        # greedy
        hand = list(order[:OPENING_HAND])
        ptr = OPENING_HAND
        for t in range(1, TURNS + 1):
            if len(hand) < HAND_LIMIT and ptr < DECK:
                hand.append(order[ptr])
                ptr += 1  # at the hand limit no card is drawn and the deck is untouched
            best = max(maximal_plays(hand, t), key=lambda p: (sum(p), -len(p)))
            for c in best:
                hand.remove(c)
            s = sum(best)
            spent_greedy[t - 1] += s
            full_greedy[t - 1] += (s == t)
            noplay_greedy[t - 1] += (len(best) == 0)

        # clairvoyant optimum
        @lru_cache(maxsize=None)
        def best_from(t, hand_t, ptr):
            if t > TURNS:
                return 0
            h = list(hand_t)
            if len(h) < HAND_LIMIT and ptr < DECK:
                h.append(order[ptr])
                ptr += 1
            res = 0
            for play in maximal_plays(h, t):
                rest = list(h)
                for c in play:
                    rest.remove(c)
                res = max(res, sum(play) + best_from(t + 1, tuple(sorted(rest)), ptr))
            return res

        total_opt += best_from(1, tuple(sorted(order[:OPENING_HAND])), OPENING_HAND)
    n = trials
    return ([x / n for x in spent_greedy], [x / n for x in full_greedy],
            [x / n for x in noplay_greedy], total_opt / n)


def curve_to_costs(curve):
    """curve = cards at cost 1..6 (a 0-cost or 7-cost card is passed explicitly)."""
    costs = []
    for cost, count in curve.items():
        costs += [cost] * count
    assert len(costs) == DECK, (curve, len(costs))
    return costs


def part_c(trials=20_000):
    rng = random.Random(SEED)
    curves = {
        "2,4,3,2,1,0 (lsorber optimum)": {1: 2, 2: 4, 3: 3, 4: 2, 5: 1},
        "1,4,3,2,1,1 (lsorber, with a 6)": {1: 1, 2: 4, 3: 3, 4: 2, 5: 1, 6: 1},
        "2,3,4,2,1,0 (snap.fan template)": {1: 2, 2: 3, 3: 4, 4: 2, 5: 1},
        "2,3,3,2,1,1 (mean of 15 meta lists, rounded)": {1: 2, 2: 3, 3: 3, 4: 2, 5: 1, 6: 1},
        "3,4,3,0,1,1 (Skilled Zombie Horde)": {1: 3, 2: 4, 3: 3, 5: 1, 6: 1},
        "0,1,3,4,1,2 + one 7 (4-Cost Summons)": {2: 1, 3: 3, 4: 4, 5: 1, 6: 2, 7: 1},
        "0,0,2,3,4,3 (top-heavy stress case)": {3: 2, 4: 3, 5: 4, 6: 3},
        "6,6,0,0,0,0 (all cheap stress case)": {1: 6, 2: 6},
    }
    rows_total, rows_turn, rows_none = [], [], []
    for name, curve in curves.items():
        costs = curve_to_costs(curve)
        spent, full, noplay, opt = simulate_energy(costs, trials, rng)
        g = sum(spent)
        rows_total.append([name, f"{sum(costs) / DECK:.2f}", f"{g:.2f}", f"{opt:.2f}",
                           f"{21 - opt:.2f} to {21 - g:.2f}"])
        rows_turn.append([name] + [f"{x:.2f}" for x in spent])
        rows_none.append([name] + [pct(x) for x in noplay])
    table(f"C1. Expected energy spent over 6 turns of 21 available ({trials} games per curve, seed {SEED})",
          ["curve (cards at cost 1..6)", "avg cost", "greedy", "clairvoyant", "energy wasted (range)"],
          rows_total)
    table("C2. Expected energy spent per turn, greedy policy", ["curve", "T1", "T2", "T3", "T4", "T5", "T6"],
          rows_turn)
    table("C3. P(no play at all on turn t), greedy policy", ["curve", "T1", "T2", "T3", "T4", "T5", "T6"],
          rows_none)


if __name__ == "__main__":
    print(f"Deck {DECK}, opening hand {OPENING_HAND}, one draw per turn incl. turn 1, {TURNS} turns.")
    part_a()
    part_b()
    part_c()
