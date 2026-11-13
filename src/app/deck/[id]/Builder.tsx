'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardScore, Deck, Fix, SwapProposal } from '@/engine/types';
import { CardDetailOverlay } from '../../components/CardDetail';
import { BAND_COLOR, BandChip, CardArt, Dial, Overlay, Prov, RATING_COLOR, ScoreBadge } from '../../components/card';
import { useNotify } from '../../components/Shell';
import {
  ApiError, analyzeDeck, buildDecks, exportDeck, getCard, getDeck, improveDeck, updateDeck,
  type AnalyzeResponse, type Lookup, type ScoredCardView,
} from '../../lib/api';
import { DECK_SIZE, addCard, curveOf, deckIds, errText, isAbort, nearestSummary, ratingBand, removeCard, sortByCost, swapCard, toggleLock } from '../../lib/ui';
import { Browser, DEFAULT_QUERY, type BrowserQuery } from './Browser';
import {
  FieldPanel, ImprovePanel, LinesPanel, NetworkPanel, NoveltyPanel, PANELS, PlanPanel, RatingPanel, type PanelId, type ProposalState,
} from './Panels';

const LockIcon = ({ open = false }: { open?: boolean }) => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden fill="currentColor">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d={open ? 'M5 7V5a3 3 0 0 1 5.6-1.5' : 'M5 7V5a3 3 0 0 1 6 0v2'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/**
 * The builder (spec §16): header with the two dials, legality and curve; the 12 slots; the card
 * browser; the panels. Every edit is applied at once (optimistic), then after 250 ms the deck is
 * analysed and saved.
 */
export function Builder({ id }: { id: string }) {
  const notify = useNotify();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [settled, setSettled] = useState<Deck | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({});
  const [hints, setHints] = useState<Record<string, CardScore>>({});
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [panel, setPanel] = useState<PanelId>('rating');
  const [query, setQuery] = useState<BrowserQuery>(DEFAULT_QUERY);
  const [detail, setDetail] = useState<string | null>(null);
  const [exported, setExported] = useState<{ text: string; long: string | null; short: string | null } | null>(null);
  const [proposals, setProposals] = useState<ProposalState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveSeq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const learn = useCallback((cards: Lookup) => setLookup((cur) => ({ ...cur, ...cards })), []);

  // ---- load
  useEffect(() => {
    const ctrl = new AbortController();
    getDeck(id, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        setDeck(res.deck);
        setSettled(res.deck);
      },
      (e) => !isAbort(e) && setLoadError({ text: errText(e), missing: e instanceof ApiError && e.status === 404 }),
    );
    return () => ctrl.abort();
  }, [id, learn]);

  // ---- debounce, then analyse and save
  useEffect(() => {
    if (!deck || deck === settled) return;
    const t = setTimeout(() => setSettled(deck), 250);
    return () => clearTimeout(t);
  }, [deck, settled]);

  useEffect(() => {
    if (!settled) return;
    const ctrl = new AbortController();
    setAnalysing(true);
    analyzeDeck(settled, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        setAnalysis(res);
        setAnalysing(false);
      },
      (e) => {
        if (isAbort(e)) return;
        setAnalysing(false);
        notify.error(`Could not analyse the deck: ${errText(e)}`);
      },
    );
    return () => ctrl.abort();
  }, [settled, learn, notify]);

  useEffect(() => {
    if (!settled || !dirty.current) return;
    const seq = ++saveSeq.current;
    setSaveState('saving');
    updateDeck(id, settled).then(
      () => seq === saveSeq.current && setSaveState('saved'),
      (e) => {
        if (seq !== saveSeq.current) return;
        setSaveState('failed');
        notify.error(`The deck was not saved: ${errText(e)}`);
      },
    );
  }, [settled, id, notify]);

  const mutate = useCallback((fn: (d: Deck) => Deck) => {
    dirty.current = true;
    setDeck((d) => (d ? fn(d) : d));
  }, []);

  // "/" focuses the card search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = useCallback(
    (c: ScoredCardView) => {
      learn({ [c.card.defId]: c.card });
      setHints((h) => ({ ...h, [c.card.defId]: c.score }));
      mutate((d) => addCard(d, c.card.defId));
    },
    [learn, mutate],
  );
  const openScored = useCallback(
    (c: ScoredCardView) => {
      learn({ [c.card.defId]: c.card });
      setDetail(c.card.defId);
    },
    [learn],
  );

  // Panels name cards outside the deck (folds-to tech, nearest lists, gems, field): fetch their rows once.
  useEffect(() => {
    if (!analysis) return;
    const ls = analysis.lines;
    const wanted = new Set<string>([
      ...[analysis.plans.primary, analysis.plans.secondary].flatMap((p) => p?.foldsTo.flatMap((f) => f.cards) ?? []),
      ...analysis.novelty.nearest.flatMap((n) => n.cards),
      ...analysis.gemsNear.flatMap((g) => g.cards),
      ...[...ls.field, ...ls.tech, ...ls.oneAway].flatMap((l) => l.cardIds),
    ]);
    const missing = [...wanted].filter((x) => !lookup[x]).slice(0, 80);
    if (!missing.length) return;
    Promise.all(missing.map((x) => getCard(x, null).then((d) => d.card, () => null))).then((cards) =>
      learn(Object.fromEntries(cards.filter((c) => c !== null).map((c) => [c.defId, c]))),
    );
    // `lookup` is read, not a trigger: a new analysis is.
  }, [analysis]);

  const scores = useMemo(() => new Map((analysis?.deckScores ?? []).map((s) => [s.defId, s])), [analysis]);
  const scoreOf = (cardId: string) => scores.get(cardId) ?? hints[cardId];

  const applyFix = (f: Fix) => {
    if (!f.filter) return;
    const lo = f.filter.minCost ?? 0;
    const hi = f.filter.maxCost ?? (f.filter.minCost !== undefined ? 7 : -1);
    const cost = hi >= 0 ? [0, 1, 2, 3, 4, 5, 6, 7].filter((n) => n >= lo && n <= hi) : [];
    setQuery({ ...DEFAULT_QUERY, axis: f.filter.axis ?? '', techRole: f.filter.techRole ?? '', cost, fromFix: f.text });
  };

  const runImprove = async (direction: 'stronger' | 'more-original') => {
    if (!deck) return;
    setBusy('improve');
    try {
      const res = await improveDeck(deck, direction);
      learn(res.cards);
      setProposals({ direction, swaps: res.swaps });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const accept = (s: SwapProposal) => {
    mutate((d) => swapCard(d, s.out, s.in));
    // Later proposals were computed after this one: keep them in order; drop any that no longer apply.
    setProposals((p) => (p ? { ...p, swaps: p.swaps.filter((x) => x !== s) } : p));
    notify.info(`Swapped ${lookup[s.out]?.name ?? s.out} for ${lookup[s.in]?.name ?? s.in}`);
  };
  const reject = (s: SwapProposal) => setProposals((p) => (p ? { ...p, swaps: p.swaps.filter((x) => x !== s) } : p));

  const fillRest = async () => {
    if (!deck) return;
    setBusy('fill');
    try {
      const locked = new Map(deck.cards.map((c) => [c.defId, c.locked]));
      const res = await buildDecks({ ...deck, cards: deck.cards.map((c) => ({ ...c, locked: true })) }, { mode: 'tuned', count: 1 });
      learn(res.cards);
      const best = res.results[0];
      if (!best) {
        notify.error(res.refused ?? 'No deck could be completed from these cards.');
        return;
      }
      mutate((d) => ({ ...d, cards: best.deck.cards.map((c) => ({ defId: c.defId, locked: locked.get(c.defId) ?? false })) }));
      notify.info(`Filled ${DECK_SIZE - deck.cards.length} slots (tuned build)`);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };

  const doExport = async () => {
    if (!deck) return;
    try {
      setExported(await exportDeck(deck));
    } catch (e) {
      notify.error(e);
    }
  };

  if (loadError) {
    return (
      <div className="p-10">
        <p className="display text-[1.6rem]">{loadError.missing ? 'This deck does not exist.' : 'The deck could not be loaded.'}</p>
        <p className="mt-1 text-muted">{loadError.text}</p>
        <Link href="/" className="btn mt-4">Back to decks</Link>
      </div>
    );
  }
  if (!deck) return <p className="p-10 text-muted">Loading the deck…</p>;

  const ids = deckIds(deck);
  const sorted = sortByCost(ids, lookup);
  const curve = curveOf(ids, lookup);
  const maxCurve = Math.max(1, ...curve);
  const a = analysis;
  const rating = a?.rating.rating ?? 0;
  const errors = a?.violations.filter((v) => v.severity === 'error') ?? [];
  const legalText = !a ? '…' : a.legal ? (a.formatChecked ? 'Legal' : 'Legal under Ranked rules') : ids.length < DECK_SIZE ? `${ids.length} of 12` : 'Not legal';

  return (
    <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)]" data-testid="builder">
      {/* ---------------------------------------------------------------- header */}
      <header className="halftone flex items-center gap-6 border-b border-line bg-panel/70 px-5 py-3">
        <div className="min-w-0 flex-1">
          <input
            className="display w-full max-w-[28rem] bg-transparent text-[1.7rem] leading-tight outline-none focus:border-b focus:border-line"
            value={deck.name}
            onChange={(e) => mutate((d) => ({ ...d, name: e.target.value }))}
            aria-label="Deck name"
            data-testid="deck-name"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.8rem]">
            <span
              className={`rounded-full px-2 py-[1px] font-semibold ${!a ? 'bg-raised' : a.legal ? 'bg-r-top/20 text-r-top' : ids.length < DECK_SIZE ? 'bg-r-mid/20 text-r-mid' : 'bg-r-low/20 text-r-low'}`}
              title={errors.map((v) => v.message).join('\n') || undefined}
              data-testid="legal-chip"
            >
              {legalText}
            </span>
            <span className="text-faint">{deck.format}</span>
            <span className="text-faint">{saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Not saved' : 'Saved'}</span>
            {analysing && <span className="text-faint">analysing…</span>}
          </div>
          {a && (
            <p className="mt-1.5 max-w-[70ch] truncate text-[0.85rem] text-muted" data-testid="header-summary">
              {a.plans.primary ? `${a.plans.primary.name}, ${Math.round(a.plans.primary.assembly * 100)}% by turn ${a.plans.primary.keyTurn}` : 'No plan detected'}. This deck {nearestSummary(a.novelty)}.
            </p>
          )}
        </div>

        <div className="flex items-end gap-1" aria-label="Energy curve" title="Cards by cost (7 = 7 or more)">
          {curve.map((n, c) => (
            <div key={c} className="flex w-5 flex-col items-center">
              <div className="w-3.5 rounded-t bg-energy/80" style={{ height: `${(n / maxCurve) * 40 + (n ? 2 : 0)}px` }} />
              <span className="mt-0.5 text-[0.68rem] text-faint">{c === 7 ? '7+' : c}</span>
            </div>
          ))}
        </div>

        <Dial value={rating} label="Rating" color={RATING_COLOR[ratingBand(rating)]} size={96} testId="rating-gauge" sub={<span className="flex items-center gap-1 text-[0.68rem] text-faint"><Prov p="heuristic" />{a && !a.rating.complete ? 'so far' : 'uncalibrated'}</span>} />
        <button type="button" onClick={() => setPanel('novelty')} className="rounded-lg" aria-label="Open the novelty panel">
          <Dial
            value={a?.novelty.novelty ?? 0}
            label="Novelty"
            color={BAND_COLOR[a?.novelty.band ?? 'unknown']}
            size={96}
            claimed={!!a && a.novelty.band !== 'unknown'}
            testId="novelty-gauge"
            sub={a && <span className="mt-0.5"><BandChip band={a.novelty.band} /></span>}
          />
        </button>

        <div className="flex flex-col gap-1.5">
          <button type="button" className="btn btn-sm" onClick={fillRest} disabled={busy !== null || ids.length >= DECK_SIZE} data-testid="fill-rest">{busy === 'fill' ? 'Filling…' : 'Fill the rest'}</button>
          <button type="button" className="btn btn-sm" onClick={doExport} data-testid="export">Export</button>
        </div>
      </header>

      {/* ---------------------------------------------------------------- the 12 slots */}
      <section className="border-b border-line px-4 py-1" aria-label="Deck" data-testid="deck-slots">
        <div className="grid grid-cols-12">
          {Array.from({ length: DECK_SIZE }, (_, i) => {
            const cardId = sorted[i];
            if (!cardId) {
              return (
                <div key={`empty-${i}`} className="card">
                  <div className="card-missing border-dashed opacity-40"><small>empty</small></div>
                </div>
              );
            }
            const entry = deck.cards.find((c) => c.defId === cardId)!;
            const name = lookup[cardId]?.name ?? cardId;
            const score = scoreOf(cardId);
            return (
              <div key={cardId} className="card group -my-[4%]" data-testid="deck-card" data-id={cardId} data-locked={entry.locked || undefined}>
                <button type="button" className="absolute inset-0 cursor-zoom-in" onClick={() => setDetail(cardId)} aria-label={`Details for ${name}`}>
                  <CardArt id={cardId} card={lookup[cardId]} />
                </button>
                <div className="pointer-events-none absolute bottom-[10%] left-[20%]"><ScoreBadge score={score} /></div>
                <div className="tile-actions">
                  <button
                    type="button"
                    className={`tile-btn ${entry.locked ? 'tile-btn-on' : 'tile-hover'}`}
                    onClick={() => mutate((d) => toggleLock(d, cardId))}
                    aria-pressed={entry.locked}
                    aria-label={entry.locked ? `Unlock ${name}` : `Lock ${name}`}
                    title={entry.locked ? 'Locked: build-around card, never cut. Click to unlock.' : 'Lock: build around this card'}
                    data-testid="deck-lock"
                  >
                    <LockIcon open={!entry.locked} />
                  </button>
                  <button type="button" className="tile-btn tile-hover" onClick={() => mutate((d) => removeCard(d, cardId))} aria-label={`Remove ${name}`} data-testid="deck-remove">−</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- browser and panels */}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-0 border-r border-line">
          <Browser deck={settled ?? deck} query={query} setQuery={setQuery} onAdd={add} onOpen={openScored} searchRef={searchRef} />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex border-b border-line px-3" role="tablist" aria-label="Panels">
            {PANELS.map((p) => (
              <button key={p.id} type="button" role="tab" className="tab" aria-selected={panel === p.id} onClick={() => setPanel(p.id)} data-testid={`tab-${p.id}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel">
            {!a && <p className="text-muted">Analysing…</p>}
            {a && panel === 'rating' && <RatingPanel a={a} onFix={applyFix} />}
            {a && panel === 'novelty' && <NoveltyPanel a={a} lookup={lookup} onOpen={setDetail} />}
            {a && panel === 'plan' && <PlanPanel a={a} lookup={lookup} onOpen={setDetail} />}
            {a && panel === 'lines' && <LinesPanel a={a} />}
            {a && panel === 'network' && <NetworkPanel a={a} lookup={lookup} />}
            {a && panel === 'field' && <FieldPanel a={a} />}
            {panel === 'improve' && (
              <ImprovePanel state={proposals} busy={busy === 'improve'} lookup={lookup} onRun={runImprove} onAccept={accept} onReject={reject} onOpen={setDetail} />
            )}
          </div>
        </div>
      </div>

      {detail && (
        <CardDetailOverlay
          id={detail}
          deckIds={ids}
          onClose={() => setDetail(null)}
          action={
            ids.includes(detail) ? (
              <button type="button" className="btn btn-sm" onClick={() => { mutate((d) => removeCard(d, detail)); setDetail(null); }}>Remove from deck</button>
            ) : ids.length < DECK_SIZE ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { mutate((d) => addCard(d, detail)); setDetail(null); }}>Add to deck</button>
            ) : null
          }
        />
      )}
      {exported && (
        <Overlay onClose={() => setExported(null)} label="Export">
          <div className="space-y-3 p-6" data-testid="export-dialog">
            <h2 className="display text-[1.5rem]">Export</h2>
            {[
              { label: 'Deck code (paste into the game)', v: exported.long },
              { label: 'Short code', v: exported.short },
              { label: 'List with code', v: exported.text },
            ].map((x) => (
              <div key={x.label}>
                <div className="flex items-center justify-between text-[0.85rem]">
                  <span className="text-muted">{x.label}</span>
                  {x.v && <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard.writeText(x.v!).then(() => notify.info('Copied'), notify.error)}>Copy</button>}
                </div>
                {x.v ? <textarea readOnly className="field mt-1 h-20 w-full" value={x.v} /> : <p className="text-[0.82rem] text-faint">Needs 12 different known cards.</p>}
              </div>
            ))}
          </div>
        </Overlay>
      )}
    </div>
  );
}
