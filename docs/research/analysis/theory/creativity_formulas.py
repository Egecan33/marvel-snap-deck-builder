#!/usr/bin/env python3
"""Worked examples and a feasibility check for the creativity formulas in
docs/research/deck-theory-and-creativity.md (section 4).

Everything here is a definition or a heuristic, not a measurement of the game.
Part 4 uses SYNTHETIC data only: it shows that the search is fast and
deterministic for a seed, not that its output is a good deck.

Run: python3 docs/research/analysis/theory/creativity_formulas.py
"""
from math import comb, log2, sqrt, exp
import random
import time

POOL = 570          # released cards in the Marvel Snap Zone card JSON on 2026-11-12
DECK = 12


# ---- 4a. deck novelty ------------------------------------------------------
W_LIST, W_RARITY, W_PACKAGE = 0.45, 0.25, 0.30
P_FLOOR = 0.002     # play rates below 0.2% are treated as 0.2%


def list_distance(nearest_overlap: int) -> float:
    return 1 - nearest_overlap / DECK


def rarity(play_rate: float) -> float:
    """Self-information of a card's play rate, scaled to 0..1 at P_FLOOR."""
    p = min(1.0, max(P_FLOOR, play_rate))
    return log2(1 / p) / log2(1 / P_FLOOR)


def novelty(nearest_overlap, play_rates, package_novelty, connected=None):
    """connected[i] is False when card i has no strong interaction in the deck and is
    not a tagged tech card: such a card earns no rarity credit ("connected rarity")."""
    if connected is None:
        connected = [True] * len(play_rates)
    r = sum(rarity(p) for p, c in zip(play_rates, connected) if c) / len(play_rates)
    return 100 * (W_LIST * list_distance(nearest_overlap) + W_RARITY * r + W_PACKAGE * package_novelty)


# ---- 4b. hidden gems -------------------------------------------------------
Z = 1.645           # one-sided 95%
R_EXPLORED = 0.01   # a pair seen in 1% of lists counts as fully explored
KAPPA = 5           # pseudo-count for the smoothed lift


def wilson_upper(k: int, n: int, z: float = Z) -> float:
    if n == 0:
        return 1.0
    p = k / n
    centre = p + z * z / (2 * n)
    margin = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return min(1.0, (centre + margin) / (1 + z * z / n))


def unexplored(n_ab: int, n_lists: int) -> float:
    return 1 - min(1.0, wilson_upper(n_ab, n_lists) / R_EXPLORED)


def smoothed_lift(n_ab, n_a, n_b, n_lists):
    expected = n_a * n_b / n_lists
    return (n_ab + KAPPA) / (expected + KAPPA)


def gem(interaction, n_ab, n_lists, q_a, q_b):
    return 100 * interaction * unexplored(n_ab, n_lists) * sqrt(q_a * q_b)


def row(*cells):
    print("| " + " | ".join(str(c) for c in cells) + " |")


def part_sizes():
    print("### 1. Search space")
    print(f"12-card decks from {POOL} cards: C({POOL},12) = {comb(POOL, 12):.3e}")
    print(f"energy curves (12 cards over costs 1..6): C(17,5) = {comb(17, 5)}")
    print(f"pairs in a deck: {comb(12, 2)}, triples: {comb(12, 3)}; pairs in the pool: {comb(POOL, 2)}")


def part_novelty():
    print("\n### 2. Novelty score, worked examples (weights 0.45 / 0.25 / 0.30)")
    row("case", "nearest overlap", "mean play rate", "package novelty", "score")
    row("---", "---", "---", "---", "---")
    cases = [
        ("exact copy of a meta list", 12, 0.12, 0.0),
        ("meta list, 2 flex cards swapped", 10, 0.10, 0.05),
        ("known variant (7 shared, like the two 4-cost lists)", 7, 0.08, 0.20),
        ("off-meta build on a known core", 5, 0.04, 0.45),
        ("brew: 2 shared, rare cards, new pairs", 2, 0.01, 0.80),
        ("pile of unplayed cards with no interactions", 0, 0.002, 0.0),
    ]
    for name, o, p, pn in cases:
        connected = [pn > 0 or o == 12] * 12
        row(name, o, f"{p:.1%}", pn, f"{novelty(o, [p] * 12, pn, connected):.0f}")
    print(f"(the pile would score {novelty(0, [0.002] * 12, 0.0):.0f} if unconnected cards kept their rarity credit)")
    print("\nRarity term by play rate:")
    row("play rate", "30%", "10%", "3%", "1%", "0.2% or less")
    row("---", "---", "---", "---", "---", "---")
    row("rarity", *[f"{rarity(p):.2f}" for p in (0.30, 0.10, 0.03, 0.01, 0.002)])


def part_gems():
    print("\n### 3. Unexplored factor U = 1 - min(1, WilsonUpper95(n_ab, N) / 1%)")
    sizes = (15, 100, 300, 1000, 3000, 10000)
    row("pair seen in n_ab lists \\ corpus N", *sizes)
    row("---", *["---"] * len(sizes))
    for n_ab in (0, 1, 3, 10):
        row(n_ab, *[f"{unexplored(n_ab, n):.2f}" for n in sizes])
    print("\nSmoothed lift (n_ab + 5) / (n_a * n_b / N + 5), N = 1000:")
    row("n_a", "n_b", "n_ab", "expected", "raw lift", "smoothed lift")
    row("---", "---", "---", "---", "---", "---")
    for n_a, n_b, n_ab in ((200, 150, 3), (200, 150, 30), (200, 150, 90), (20, 15, 0), (20, 15, 6)):
        e = n_a * n_b / 1000
        row(n_a, n_b, n_ab, f"{e:.1f}", f"{n_ab / e:.2f}", f"{smoothed_lift(n_ab, n_a, n_b, 1000):.2f}")
    print("\nGem score examples (interaction, n_ab, N, quality a, quality b):")
    for args in ((0.9, 0, 1000, 0.7, 0.6), (0.9, 0, 15, 0.7, 0.6), (0.9, 12, 1000, 0.7, 0.6),
                 (0.9, 0, 1000, 0.2, 0.2), (0.3, 0, 3000, 0.8, 0.8)):
        print(f"  gem{args} = {gem(*args):.0f}")


# ---- 4c. search feasibility on synthetic data -------------------------------
def synthetic_world(seed):
    rng = random.Random(seed)
    cost = [rng.choice((1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6)) for _ in range(POOL)]
    play = [min(0.4, rng.paretovariate(1.2) * 0.004) for _ in range(POOL)]
    quality = [rng.uniform(0.2, 0.9) for _ in range(POOL)]
    inter = {}
    for _ in range(9000):                       # about 5.5% of pairs interact
        a, b = rng.sample(range(POOL), 2)
        inter[(min(a, b), max(a, b))] = rng.uniform(0.3, 1.0)
    popular = sorted(range(POOL), key=lambda c: -play[c])[:150]
    meta = [frozenset(rng.sample(popular, DECK)) for _ in range(300)]
    index = {}
    for i, m in enumerate(meta):
        for c in m:
            index.setdefault(c, []).append(i)
    return cost, play, quality, inter, meta, index


def evaluate(deck, world):
    cost, play, quality, inter, meta, index = world
    d = sorted(deck)
    edges = [inter.get((d[i], d[j]), 0.0) for i in range(DECK) for j in range(i + 1, DECK)]
    strong = sum(1 for s in edges if s >= 0.5)
    overlap = {}
    for c in d:
        for i in index.get(c, ()):
            overlap[i] = overlap.get(i, 0) + 1
    nearest = max(overlap.values(), default=0)
    nov = novelty(nearest, [play[c] for c in d], 0.5)
    low = sum(1 for c in d if cost[c] <= 2)
    avg = sum(cost[c] for c in d) / DECK
    mean_q = sum(quality[c] for c in d) / DECK
    # power floor as penalties (stand-ins for the real constraints of section 4c)
    penalty = (25 * max(0, 3 - low) + 40 * max(0.0, 2.33 - avg) + 40 * max(0.0, avg - 3.9)
               + 12 * max(0, 10 - strong) + 200 * max(0.0, 0.45 - mean_q))
    return nov + 2.0 * sum(edges) - penalty, penalty


def anneal(seed, world, iterations=20_000):
    rng = random.Random(seed)
    deck = set(rng.sample(range(POOL), DECK))
    score, pen = evaluate(deck, world)
    best = (score, pen, frozenset(deck))
    t0, t1 = 8.0, 0.05
    for i in range(iterations):
        temp = t0 * (t1 / t0) ** (i / iterations)
        out = rng.choice(sorted(deck))
        inn = rng.randrange(POOL)
        if inn in deck:
            continue
        cand = set(deck)
        cand.remove(out)
        cand.add(inn)
        s, p = evaluate(cand, world)
        if s >= score or rng.random() < exp((s - score) / temp):
            deck, score, pen = cand, s, p
            if p == 0 and (best[1] > 0 or s > best[0]):
                best = (s, p, frozenset(deck))
    return best


def part_search():
    print("\n### 4. Search feasibility (SYNTHETIC data, 20,000 evaluations per run)")
    world = synthetic_world(1)
    start = time.perf_counter()
    a = anneal(42, world)
    elapsed = time.perf_counter() - start
    b = anneal(42, world)
    c = anneal(43, world)
    print(f"one run: {elapsed:.2f} s in CPython; feasible deck found (penalty 0): {a[1] == 0}; "
          f"objective {a[0]:.1f}")
    print(f"same seed gives the same deck: {a[2] == b[2]}; another seed gives another deck: {a[2] != c[2]}")
    assert a[2] == b[2]


if __name__ == "__main__":
    part_sizes()
    part_novelty()
    part_gems()
    part_search()
