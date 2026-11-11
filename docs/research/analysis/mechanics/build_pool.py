#!/usr/bin/env python3
"""Normalise the raw Marvel Snap Zone card dump into the research pool.

Input : docs/research/raw/mechanics/cards_msz.json
        (GET https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true, 2026-11-12)
Output: docs/research/raw/mechanics/cards.json   released + collectible cards (has a Series/source)
        docs/research/raw/mechanics/tokens.json  non-collectible cards referenced by name in pool text

Pool rule (measured, not hardcoded names): status == "released" and source != "None".
The 64 released cards with source "None" are mode-only cards (Champions, team variants, event cards).
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.normpath(os.path.join(HERE, "..", "..", "raw", "mechanics"))


def clean(text, keep_objective_arrow=True):
    t = text or ""
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("’", "'").replace("‘", "'").replace("\xa0", " ")
    t = t.replace("“", '"').replace("”", '"').strip()
    if keep_objective_arrow and t.startswith("Objective:"):
        # the source drops the arrow glyph between requirement and reward, leaving a double space
        t = re.sub(r"\s{2,}", " => ", t, count=1)
    return re.sub(r"\s+", " ", t).strip()


def norm(c):
    return {
        "id": c["carddefid"],
        "name": re.sub(r"<[^>]+>", "", c["name"]).strip(),
        "cost": c["cost"],
        "power": c["power"],
        "text": clean(c["ability"]),
        "series": c["source"],
        "status": c["status"],
        "url": c["url"],
    }


def main():
    cards = json.load(open(os.path.join(RAW, "cards_msz.json")))["success"]["cards"]
    pool = sorted(
        (norm(c) for c in cards if c["status"] == "released" and c["source"] != "None"),
        key=lambda c: c["name"],
    )
    alltext = " ".join(c["text"] for c in pool)
    tokens = []
    for c in cards:
        if c["status"] == "released" and c["source"] != "None":
            continue
        n = norm(c)
        if n["name"].startswith("!") or "Champion" in n["name"] or " - " in n["name"]:
            continue
        if re.search(r"\b" + re.escape(n["name"]) + r"s?\b", alltext):
            tokens.append(n)
    json.dump(pool, open(os.path.join(RAW, "cards.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(tokens, open(os.path.join(RAW, "tokens.json"), "w"), indent=1, ensure_ascii=False)
    print("pool", len(pool), "tokens", len(tokens), "raw", len(cards))


if __name__ == "__main__":
    main()
