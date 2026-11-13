'use client';

import { useCallback, useMemo, type RefObject } from 'react';
import type { Deck } from '@/engine/types';
import { CardArt, ScoreBadge } from '../../components/card';
import { useNotify } from '../../components/Shell';
import { VirtualGrid, usePaged } from '../../components/VirtualGrid';
import { browseCards, type CardFilters, type CardSort, type ScoredCardView } from '../../lib/api';
import { DECK_SIZE, pct } from '../../lib/ui';
import { AXIS_OPTIONS, TECH_OPTIONS } from '../../lib/vocab';

export interface BrowserQuery {
  q: string; cost: number[]; axis: string; side: '' | 'e' | 'p'; techRole: string; owned: boolean; maxPlayRate: string; hideSkills: boolean; sort: CardSort;
  /** The rating fix that set these filters, shown as a chip so it can be undone. */
  fromFix: string | null;
}
export const DEFAULT_QUERY: BrowserQuery = { q: '', cost: [], axis: '', side: '', techRole: '', owned: false, maxPlayRate: '', hideSkills: false, sort: 'score', fromFix: null };

function toFilters(q: BrowserQuery): CardFilters {
  const f: CardFilters = {};
  if (q.cost.length) f.cost = q.cost;
  if (q.axis) {
    f.axis = q.axis;
    if (q.side) f.side = q.side;
  }
  if (q.techRole) f.techRole = q.techRole;
  if (q.owned) f.owned = true;
  const r = Number(q.maxPlayRate);
  if (q.maxPlayRate.trim() !== '' && Number.isFinite(r) && r >= 0) f.maxPlayRate = r / 100;
  if (q.hideSkills) f.skills = false;
  return f;
}

const PAGE = 60;

/** The card browser (spec §16): every released card scored for this deck, gated cards greyed with the reason. */
export function Browser({ deck, query, setQuery, onAdd, onOpen, searchRef }: {
  deck: Deck; query: BrowserQuery; setQuery: (q: BrowserQuery) => void;
  onAdd: (c: ScoredCardView) => void; onOpen: (c: ScoredCardView) => void; searchRef: RefObject<HTMLInputElement | null>;
}) {
  const notify = useNotify();
  const deckKey = deck.cards.map((c) => c.defId).join(',');
  const filters = useMemo(() => toFilters(query), [query]);
  const key = `${deckKey}|${query.q}|${JSON.stringify(filters)}|${query.sort}`;
  const resetKey = `${query.q}|${JSON.stringify(filters)}|${query.sort}`;
  const fetchPage = useCallback(
    (page: number, signal: AbortSignal) =>
      browseCards({ deck: { ...deck, cards: deck.cards }, q: query.q, filters, sort: query.sort, page, pageSize: PAGE }, signal).then((r) => ({ total: r.total, items: r.cards })),
    [deckKey, query.q, filters, query.sort],
  );
  const { total, ensure, itemAt, loading } = usePaged<ScoredCardView>(key, PAGE, fetchPage, notify.error);
  const full = deck.cards.length >= DECK_SIZE;
  const set = (patch: Partial<BrowserQuery>) => setQuery({ ...query, ...patch, fromFix: null });

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Card browser" data-testid="browser">
      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={searchRef}
            className="field min-w-0 flex-1"
            placeholder="Search name or text  ( / )"
            value={query.q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="Search cards"
            data-testid="browser-search"
          />
          <select className="field" value={query.sort} onChange={(e) => set({ sort: e.target.value as CardSort })} aria-label="Sort">
            <option value="score">Best for this deck</option>
            <option value="cost">Cost</option>
            <option value="power">Power</option>
            <option value="playRate">Play rate</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              type="button"
              className="chip !px-2 tabular-nums"
              aria-pressed={query.cost.includes(n)}
              onClick={() => set({ cost: query.cost.includes(n) ? query.cost.filter((x) => x !== n) : [...query.cost, n] })}
              aria-label={n === 7 ? 'Cost 7 or more' : `Cost ${n}`}
            >
              {n === 7 ? '7+' : n}
            </button>
          ))}
          <select className="field !h-7 max-w-[11rem] text-[0.8rem]" value={query.axis} onChange={(e) => set({ axis: e.target.value })} aria-label="Axis" data-testid="filter-axis">
            <option value="">Any axis</option>
            {AXIS_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {query.axis && (
            <select className="field !h-7 text-[0.8rem]" value={query.side} onChange={(e) => set({ side: e.target.value as BrowserQuery['side'] })} aria-label="Axis side">
              <option value="">Either side</option>
              <option value="e">Enablers</option>
              <option value="p">Payoffs</option>
            </select>
          )}
          <select className="field !h-7 max-w-[10rem] text-[0.8rem]" value={query.techRole} onChange={(e) => set({ techRole: e.target.value })} aria-label="Tech role">
            <option value="">Any tech role</option>
            {TECH_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[0.8rem] text-muted">
            Play rate ≤
            <input className="field !h-7 w-12 text-[0.8rem]" inputMode="decimal" value={query.maxPlayRate} onChange={(e) => set({ maxPlayRate: e.target.value })} aria-label="Maximum play rate in percent" data-testid="filter-playrate" />%
          </label>
          <button type="button" className="chip" aria-pressed={query.owned} onClick={() => set({ owned: !query.owned })}>Owned</button>
          <button type="button" className="chip" aria-pressed={query.hideSkills} onClick={() => set({ hideSkills: !query.hideSkills })}>No skills</button>
          {query.fromFix && (
            <button type="button" className="chip" aria-pressed onClick={() => setQuery(DEFAULT_QUERY)} title="Clear the filters this fix set">
              From fix: {query.fromFix.length > 40 ? `${query.fromFix.slice(0, 40)}…` : query.fromFix} ×
            </button>
          )}
        </div>
        <p className="text-[0.75rem] text-faint">{total === null ? 'Scoring the pool…' : `${total} cards${loading ? ', loading…' : ''}`}. Scores are for this deck (heuristic); badge colours: green 80+, yellow 60+, amber 40+.</p>
      </div>
      <div className="min-h-0 flex-1">
        <VirtualGrid<ScoredCardView>
          count={total ?? 0}
          itemAt={itemAt}
          ensure={ensure}
          keyOf={(c) => c.card.defId}
          minTile={132}
          gap={0}
          resetKey={resetKey}
          testId="browser-grid"
          empty={total === 0 ? <p className="p-4 text-muted">No card matches. Clear a filter.</p> : null}
          render={(c) => {
            const gated = !!c.score.gate;
            return (
              <div className={`card group ${gated ? 'opacity-40 grayscale' : ''}`} data-testid="browser-card" data-id={c.card.defId} title={gated ? `${c.card.name}: ${c.score.gate!.message}` : `${c.card.name} (${pct(c.playRate)} of meta lists)`}>
                <button type="button" className="absolute inset-0 cursor-zoom-in" onClick={() => onOpen(c)} aria-label={`Details for ${c.card.name}`}>
                  <CardArt id={c.card.defId} card={c.card} />
                </button>
                <div className="pointer-events-none absolute bottom-[9%] left-[20%]"><ScoreBadge score={c.score} /></div>
                {c.inDeck ? (
                  <span className="pointer-events-none absolute bottom-[9%] right-[20%] rounded bg-nov-offmeta px-1 text-[0.7rem] font-semibold leading-[1.4rem] text-[#160d2b]">in deck</span>
                ) : (
                  !gated && !full && (
                    <div className="tile-actions">
                      <button type="button" className="tile-btn tile-hover" onClick={() => onAdd(c)} aria-label={`Add ${c.card.name}`} data-testid="browser-add">+</button>
                    </div>
                  )
                )}
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}
