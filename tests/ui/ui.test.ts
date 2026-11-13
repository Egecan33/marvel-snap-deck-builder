import { describe, expect, it } from 'vitest';
import type { Deck, NoveltyReport } from '@/engine/types';
import { PLACEHOLDER_SVG, PLACEHOLDER_WIDTH } from '@/server/images';
import {
  DECK_SIZE, PROVENANCE, SERVER_PLACEHOLDER_WIDTH, addCard, bandLabel, curveOf, deckIds, emptyDeck, nearestSummary, pct, ratingBand, removeCard, sortByCost,
  swapCard, toggleLock, withLocks,
} from '@/app/lib/ui';

const deck = (ids: string[]): Deck => ({ ...emptyDeck('T'), cards: ids.map((defId) => ({ defId, locked: false })) });
const lookup = {
  A: { defId: 'A', name: 'Alpha', cost: 3, power: 2 },
  B: { defId: 'B', name: 'Beta', cost: 1, power: 1 },
  C: { defId: 'C', name: 'Gamma', cost: 1, power: 4 },
  D: { defId: 'D', name: 'Delta', cost: 9, power: 12 },
};

const nov = (over: Partial<NoveltyReport>): NoveltyReport => ({
  novelty: 70, band: 'off-meta', parts: { listDistance: 0.7, connectedRarity: 0.6, packageNovelty: 0.8 },
  nearest: [], rareCards: [], pairs: [], corpus: null, claimsWithheld: null, ...over,
});

describe('deck edits', () => {
  it('adds once, never a duplicate, and stops at 12 cards', () => {
    let d = deck([]);
    d = addCard(d, 'A');
    d = addCard(d, 'A');
    expect(deckIds(d)).toEqual(['A']);
    const full = deck(Array.from({ length: DECK_SIZE }, (_, i) => `X${i}`));
    expect(addCard(full, 'A')).toBe(full);
  });
  it('removes, locks and swaps in place', () => {
    const d = deck(['A', 'B', 'C']);
    expect(deckIds(removeCard(d, 'B'))).toEqual(['A', 'C']);
    expect(toggleLock(d, 'B').cards.find((c) => c.defId === 'B')?.locked).toBe(true);
    expect(deckIds(swapCard(d, 'B', 'D'))).toEqual(['A', 'D', 'C']);
    expect(swapCard(d, 'Z', 'D')).toBe(d);
    expect(deckIds(swapCard(d, 'B', 'A'))).toEqual(['A', 'B', 'C']);
  });
  it('withLocks marks build-around cards locked', () => {
    const d = withLocks(['A', 'B'], { themes: ['move'], buildMode: 'brew' });
    expect(d.cards).toEqual([{ defId: 'A', locked: true }, { defId: 'B', locked: true }]);
    expect(d.themes).toEqual(['move']);
  });
});

describe('ordering and curve', () => {
  it('sorts by cost, then name; unknown cards last', () => {
    expect(sortByCost(['A', 'Z', 'C', 'B'], lookup)).toEqual(['B', 'C', 'A', 'Z']);
  });
  it('counts the curve with 7 meaning 7 or more', () => {
    expect(curveOf(['A', 'B', 'C', 'D', 'Z'], lookup)).toEqual([0, 2, 0, 1, 0, 0, 0, 1]);
  });
});

describe('labels', () => {
  it('names novelty bands and rating bands', () => {
    expect(bandLabel('off-meta')).toBe('Off-meta');
    expect(bandLabel('unknown')).toBe('Not claimed');
    expect(ratingBand(85)).toBe('top');
    expect(ratingBand(61)).toBe('good');
    expect(ratingBand(45)).toBe('mid');
    expect(ratingBand(10)).toBe('low');
  });
  it('has a mark and an explanation for each provenance', () => {
    for (const p of ['measured', 'derived', 'heuristic'] as const) {
      expect(PROVENANCE[p].mark).toMatch(/^[A-Z]$/);
      expect(PROVENANCE[p].title.length).toBeGreaterThan(20);
    }
  });
  it('formats shares as percentages', () => {
    expect(pct(0.0012)).toBe('0.1%');
    expect(pct(0.98)).toBe('98%');
    expect(pct(0)).toBe('0%');
  });
});

describe('nearestSummary', () => {
  it('names the archetype of the nearest list', () => {
    const n = nov({ nearest: [{ key: 'k', shared: 5, archetype: 'Zombies', games: 900, cards: [] }] });
    expect(nearestSummary(n)).toBe('shares 5 of 12 with Zombies');
  });
  it('says when the nearest list has no archetype label', () => {
    const n = nov({ nearest: [{ key: 'k', shared: 3, archetype: null, games: 71, cards: [] }] });
    expect(nearestSummary(n)).toBe('shares 3 of 12 with an unlabelled list (71 games)');
  });
  it('says novelty is not claimed when there is no meta', () => {
    const n = nov({ band: 'unknown', novelty: 0, claimsWithheld: 'No meta lists are synced.' });
    expect(nearestSummary(n)).toBe('novelty not claimed: No meta lists are synced.');
  });
  it('says no list is near when nearest is empty', () => {
    expect(nearestSummary(nov({}))).toBe('shares no card with a known list');
  });
});

describe('image placeholder', () => {
  it('the UI knows the width of the server placeholder, and it is not the art width', () => {
    expect(SERVER_PLACEHOLDER_WIDTH).toBe(PLACEHOLDER_WIDTH);
    expect(PLACEHOLDER_WIDTH).not.toBe(512);
    expect(PLACEHOLDER_SVG).toContain(`width="${PLACEHOLDER_WIDTH}"`);
  });
});
