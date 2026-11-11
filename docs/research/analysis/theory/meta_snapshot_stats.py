#!/usr/bin/env python3
"""Curve and overlap statistics of the lists in one Marvel Snap Zone tier-list page.

Used to calibrate the novelty score in docs/research/deck-theory-and-creativity.md.
No card data is stored in git: pass the two downloaded files as arguments.

  curl -sL -A 'research-script/1.0' -o tier.html \
    https://marvelsnapzone.com/marvel-snap-ranked-meta-tier-list-november-8-2026/
  curl -sL -A 'research-script/1.0' -o cards.json \
    'https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true'
  python3 meta_snapshot_stats.py tier.html cards.json

Deck codes on the page are base64 of comma-separated short names. A short name is
the card's CardDefId with the lowercase letters a, e, i, o, u, y removed, followed by
the hexadecimal length of the CardDefId (observed on the page; all 180 codes of the
2026-11-08 page resolve with this rule).
"""
import base64
import collections
import json
import re
import sys


def short_code(def_id: str) -> str:
    return re.sub(r"[aeiouy]", "", def_id) + format(len(def_id), "X")


def load(tier_html: str, cards_json: str):
    cards = json.load(open(cards_json, encoding="utf8"))["success"]["cards"]
    by_code = {}
    for c in cards:
        if c.get("carddefid"):
            by_code.setdefault(short_code(c["carddefid"]), c)
    html = open(tier_html, encoding="utf8", errors="ignore").read()
    decks = {}
    for block in html.split('<div class="deck-block')[1:]:
        name = re.search(r'<div class="name">(.*?)</div>', block).group(1)
        code = re.search(r'deck-sharecode" data-value="([^"]+)"', block).group(1)
        keys = base64.b64decode(code).decode().split(",")
        missing = [k for k in keys if k not in by_code]
        if missing:
            raise SystemExit(f"unresolved codes in {name}: {missing}")
        decks[name] = [by_code[k] for k in keys]
    return decks


def main():
    decks = load(sys.argv[1], sys.argv[2])
    n = len(decks)
    print(f"{n} lists, {sum(len(d) for d in decks.values())} card slots")
    total = collections.Counter()
    print("\n| list | curve cost 0..7 | avg cost | sum of printed power | cost<=2 | cost>=5 |")
    print("|---|---|---|---|---|---|")
    for name, cs in decks.items():
        cu = collections.Counter(c["cost"] for c in cs)
        total.update(cu)
        print(f"| {name} | {','.join(str(cu.get(i, 0)) for i in range(8))} | "
              f"{sum(c['cost'] for c in cs) / 12:.2f} | {sum(c['power'] for c in cs)} | "
              f"{sum(v for k, v in cu.items() if k <= 2)} | {sum(v for k, v in cu.items() if k >= 5)} |")
    print("\nmean cards per cost:", {k: round(v / n, 2) for k, v in sorted(total.items())})

    sets = {k: {c["name"] for c in v} for k, v in decks.items()}
    names = list(sets)
    pair = [len(sets[a] & sets[b]) for i, a in enumerate(names) for b in names[i + 1:]]
    print(f"\npairwise shared cards: mean {sum(pair) / len(pair):.2f}, max {max(pair)}, "
          f"histogram {dict(sorted(collections.Counter(pair).items()))}")
    nn = {a: max(len(sets[a] & sets[b]) for b in names if b != a) for a in names}
    print("nearest-neighbour shared cards per list:", dict(sorted(collections.Counter(nn.values()).items())))
    print("nearest-neighbour Jaccard distance per list (1 - o/(24-o)):",
          sorted(round(1 - o / (24 - o), 2) for o in nn.values()))
    freq = collections.Counter(c for s in sets.values() for c in s)
    print(f"distinct cards {len(freq)}; in >=3 lists:",
          [(k, v) for k, v in freq.most_common() if v >= 3])
    print("cards in exactly 1 list:", sum(1 for v in freq.values() if v == 1))

    # energy model of draw_odds.py on the real cost lists (printed costs only)
    import os
    import random
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import draw_odds
    rng = random.Random(draw_odds.SEED)
    print("\n| list | energy spent of 21 (greedy) | P(no play) T1 | T2 | T3 |")
    print("|---|---|---|---|---|")
    totals = []
    for name, cs in decks.items():
        spent, _full, noplay, _opt = draw_odds.simulate_energy([c["cost"] for c in cs], 5000, rng)
        totals.append(sum(spent))
        print(f"| {name} | {sum(spent):.2f} | {noplay[0]:.0%} | {noplay[1]:.0%} | {noplay[2]:.0%} |")
    totals.sort()
    print(f"energy spent: min {totals[0]:.2f}, median {totals[len(totals) // 2]:.2f}, max {totals[-1]:.2f}")


if __name__ == "__main__":
    main()
