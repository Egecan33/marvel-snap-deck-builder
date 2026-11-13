'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { BrewResult } from '@/engine/types';
import { CardDetailOverlay } from '../components/CardDetail';
import { BAND_COLOR, BandChip, CardArt, Dial, Overlay, Prov, RATING_COLOR } from '../components/card';
import { DeckArtGrid, NoveltyEvidence, planLine } from '../components/deck';
import { useNotify, useStatus } from '../components/Shell';
import { ImportDialog } from '../components/ImportDialog';
import { browseCards, buildDecks, createDeck, getCard, type BuildResponse, type Lookup, type ScoredCardView } from '../lib/api';
import { emptyDeck, errText, isAbort, nearestSummary, pct, ratingBand, withLocks } from '../lib/ui';
import { AXIS_OPTIONS } from '../lib/vocab';

const MAX_LOCKS = 4;
const MAX_THEMES = 3;

interface PromptForm { maxPlayRate: string; maxShared: string; wildcards: string; techExempt: boolean; ownedOnly: boolean; seed: string; count: string }
const DEFAULT_FORM: PromptForm = { maxPlayRate: '5', maxShared: '4', wildcards: '2', techExempt: true, ownedOnly: false, seed: '1', count: '6' };

function BrewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const notify = useNotify();
  const { status } = useStatus();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ScoredCardView[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [lookup, setLookup] = useState<Lookup>({});
  const [themes, setThemes] = useState<string[]>([]);
  const [mode, setMode] = useState<'brew' | 'tuned'>('brew');
  const [form, setForm] = useState<PromptForm>(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BuildResponse | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<BrewResult | null>(null);
  const [importing, setImporting] = useState(false);

  const learn = (cards: Lookup) => setLookup((l) => ({ ...l, ...cards }));

  // Build-around cards can arrive from Discover (?cards=A,B).
  useEffect(() => {
    const seed = params.get('cards');
    if (seed) setLocks(seed.split(',').filter(Boolean).slice(0, MAX_LOCKS));
  }, [params]);

  // Image search over the released pool, least played first when nothing is typed (brew seeds).
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      browseCards({ deck: emptyDeck(), q, sort: q ? 'name' : 'score', pageSize: 24, filters: q ? {} : { maxPlayRate: 0.01 } }, ctrl.signal).then(
        (res) => {
          setHits(res.cards);
          learn(Object.fromEntries(res.cards.map((c) => [c.card.defId, c.card])));
        },
        (e) => !isAbort(e) && notify.error(e),
      );
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, notify]);

  // Locked cards from a link may not be in the search results yet.
  useEffect(() => {
    const missing = locks.filter((id) => !lookup[id]);
    if (!missing.length) return;
    Promise.all(missing.map((id) => getCard(id, null).then((d) => d.card, () => null))).then((cards) =>
      learn(Object.fromEntries(cards.filter((c) => c !== null).map((c) => [c.defId, c]))),
    );
  }, [locks, lookup]);

  const toggleLock = (id: string) => setLocks((l) => (l.includes(id) ? l.filter((x) => x !== id) : l.length >= MAX_LOCKS ? l : [...l, id]));
  const toggleTheme = (id: string) => setThemes((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length >= MAX_THEMES ? t : [...t, id]));

  const num = (s: string, lo: number, hi: number): number | null => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
  };

  const brew = async (surprise = false) => {
    setBusy(true);
    setOutcome(null);
    try {
      const deck = withLocks(surprise ? [] : locks, { themes, buildMode: mode, format: 'ranked', name: 'Brew' });
      const rate = num(form.maxPlayRate, 0, 100);
      const res = await buildDecks(deck, {
        mode,
        seed: Math.round(num(form.seed, 0, 2 ** 31) ?? 1),
        count: Math.round(num(form.count, 1, 6) ?? 6),
        ownedOnly: form.ownedOnly,
        prompts: {
          maxPlayRate: rate === null ? null : rate / 100,
          maxShared: num(form.maxShared, 0, 12),
          wildcards: Math.round(num(form.wildcards, 0, 12) ?? 2),
          techExempt: form.techExempt,
          surprise,
        },
      });
      learn(res.cards);
      setOutcome(res);
    } catch (e) {
      notify.error(`Brew failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const open = async (r: BrewResult, i: number) => {
    try {
      const name = r.plan ? `${r.plan.name} brew ${i + 1}` : `Brew ${i + 1}`;
      const saved = await createDeck({ ...r.deck, name });
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
    }
  };

  const startEmpty = async () => {
    try {
      const saved = await createDeck({ ...emptyDeck('New deck'), buildMode: mode });
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
    }
  };

  const hasMeta = !!status?.meta;
  return (
    <div className="grid h-full grid-cols-[400px_1fr]">
      {/* ---------------------------------------------------------------- the brief */}
      <aside className="thin-scroll flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-line bg-panel/60 p-5" aria-label="Brew settings">
        <div>
          <h1 className="display text-[2rem] leading-none">Brew a deck</h1>
          <p className="mt-1 text-[0.85rem] text-muted">Pick up to {MAX_LOCKS} cards to build around. Brews are legal 12-card decks that clear the power floor and stay away from known lists.</p>
        </div>

        <section aria-label="Build-around cards">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[0.95rem] font-semibold">Build around</h2>
            <span className="text-[0.78rem] text-faint">{locks.length} of {MAX_LOCKS}</span>
          </div>
          {locks.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1" data-testid="locks">
              {locks.map((id) => (
                <button key={id} type="button" onClick={() => toggleLock(id)} title={`Remove ${lookup[id]?.name ?? id}`} className="rounded-lg bg-nov-brew/15">
                  <CardArt id={id} card={lookup[id]} />
                </button>
              ))}
            </div>
          )}
          <input
            className="field mt-2 w-full"
            placeholder="Search a card by name or text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search cards to build around"
            data-testid="brew-search"
          />
          <p className="mt-1 text-[0.75rem] text-faint">{q ? 'Click a card to build around it.' : 'Showing cards in under 1% of meta lists (measured). Type to search all.'}</p>
          <div className="mt-1 grid grid-cols-4 gap-0" data-testid="brew-hits">
            {hits.map((h) => (
              <button
                key={h.card.defId}
                type="button"
                onClick={() => toggleLock(h.card.defId)}
                aria-pressed={locks.includes(h.card.defId)}
                title={`${h.card.name}: ${h.card.text || 'no ability'} (${pct(h.playRate)} of meta lists)`}
                className={`rounded-lg ${locks.includes(h.card.defId) ? 'bg-nov-brew/25' : 'hover:bg-raised'}`}
                data-testid="brew-hit"
              >
                <CardArt id={h.card.defId} card={h.card} />
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Themes">
          <h2 className="text-[0.95rem] font-semibold">Themes <span className="font-normal text-faint">(optional, up to {MAX_THEMES})</span></h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AXIS_OPTIONS.map((a) => (
              <button key={a.id} type="button" className="chip" aria-pressed={themes.includes(a.id)} onClick={() => toggleTheme(a.id)} title={a.heuristic ? 'One side of this axis is a heuristic guess' : undefined}>
                {a.label}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Mode and prompts" className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.95rem] font-semibold">Mode</h2>
            <div className="seg" role="group" aria-label="Mode">
              <button type="button" aria-pressed={mode === 'brew'} onClick={() => setMode('brew')} data-testid="mode-brew">Brew (novel)</button>
              <button type="button" aria-pressed={mode === 'tuned'} onClick={() => setMode('tuned')} data-testid="mode-tuned">Tuned (strongest)</button>
            </div>
          </div>
          <div className={`grid grid-cols-2 gap-x-3 gap-y-2 text-[0.82rem] ${mode === 'tuned' ? 'opacity-50' : ''}`}>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Max play rate per card, %</span>
              <input className="field" inputMode="decimal" value={form.maxPlayRate} disabled={mode === 'tuned'} onChange={(e) => setForm({ ...form, maxPlayRate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Max cards shared with a list</span>
              <input className="field" inputMode="numeric" value={form.maxShared} disabled={mode === 'tuned'} onChange={(e) => setForm({ ...form, maxShared: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Wildcard slots (gem picks)</span>
              <input className="field" inputMode="numeric" value={form.wildcards} disabled={mode === 'tuned'} onChange={(e) => setForm({ ...form, wildcards: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5">
              <input type="checkbox" checked={form.techExempt} disabled={mode === 'tuned'} onChange={(e) => setForm({ ...form, techExempt: e.target.checked })} />
              <span className="text-muted">Tech cards skip the play-rate cap</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[0.82rem]">
            <label className="flex flex-col gap-1">
              <span className="text-muted">Seed (same seed, same decks)</span>
              <input className="field" inputMode="numeric" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Results (1 to 6)</span>
              <input className="field" inputMode="numeric" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={form.ownedOnly} onChange={(e) => setForm({ ...form, ownedOnly: e.target.checked })} />
              <span className="text-muted">Only cards in my collection ({status?.counts.owned ?? 0} owned)</span>
            </label>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy || (locks.length === 0 && themes.length === 0)} onClick={() => brew(false)} data-testid="brew-go">
            {busy ? 'Brewing…' : mode === 'brew' ? 'Brew' : 'Build'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => brew(true)} title="Start from a hidden-gem pair" data-testid="brew-surprise">Surprise me</button>
          <span className="flex-1" />
          <button type="button" className="btn btn-quiet" onClick={startEmpty} data-testid="start-empty">Start empty</button>
          <button type="button" className="btn btn-quiet" onClick={() => setImporting(true)} data-testid="open-import">Import</button>
        </div>
        {!hasMeta && <p className="text-[0.8rem] text-r-mid">No meta lists are synced: novelty cannot be claimed and brews skip the novelty bar.</p>}
      </aside>

      {/* ---------------------------------------------------------------- results */}
      <section className="thin-scroll min-h-0 overflow-y-auto p-6" aria-label="Brews" data-testid="brew-results">
        {!outcome && !busy && <EmptyGallery />}
        {busy && <p className="display text-[1.4rem] text-muted">Searching for decks that work and that nobody plays…</p>}
        {outcome?.refused && (
          <div className="max-w-[70ch] rounded-xl border border-r-low/60 bg-r-low/10 p-5" data-testid="brew-refused">
            <h2 className="display text-[1.4rem]">No deck cleared the floor</h2>
            <p className="mt-2 whitespace-pre-line text-[0.9rem]">{outcome.refused}</p>
          </div>
        )}
        <div className="space-y-5">
          {outcome?.results.map((r, i) => (
            <ResultCard key={i} r={r} i={i} lookup={lookup} onOpen={() => open(r, i)} onCard={setDetail} onEvidence={() => setEvidence(r)} />
          ))}
        </div>
      </section>

      {detail && <CardDetailOverlay id={detail} deckIds={null} onClose={() => setDetail(null)} />}
      {evidence && (
        <Overlay onClose={() => setEvidence(null)} label="Novelty evidence">
          <div className="p-6"><NoveltyEvidence nov={evidence.novelty} lookup={lookup} onOpen={setDetail} /></div>
        </Overlay>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function EmptyGallery() {
  return (
    <div className="max-w-[62ch] pt-10">
      <p className="display text-[2.6rem] leading-[0.95]">Pick a card nobody builds around.</p>
      <p className="mt-3 text-muted">
        Each brew comes back with two separate numbers: a rating of how well it works (heuristic, not calibrated against win rates) and a novelty score of how
        far it sits from the lists people play. A brew is only shown when it passes the power floor.
      </p>
    </div>
  );
}

function ResultCard({ r, i, lookup, onOpen, onCard, onEvidence }: {
  r: BrewResult; i: number; lookup: Lookup; onOpen: () => void; onCard: (id: string) => void; onEvidence: () => void;
}) {
  const [showPicks, setShowPicks] = useState(false);
  const locks = useMemo(() => new Set(r.deck.cards.filter((c) => c.locked).map((c) => c.defId)), [r]);
  const failed = r.floor.checks.filter((c) => !c.passed);
  const strongest = r.picks.find((p) => p.interaction)?.interaction.split(/(?<=\.)\s/)[0];
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_340px] gap-6 rounded-2xl border border-line bg-panel p-5" data-testid="brew-result">
      <div className="min-w-0">
        <DeckArtGrid ids={r.deck.cards.map((c) => c.defId)} lookup={lookup} onOpen={onCard} highlight={locks} />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-around">
          <Dial value={r.rating} label="Rating" color={RATING_COLOR[ratingBand(r.rating)]} size={104} testId="result-rating" sub={<span className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-faint"><Prov p="heuristic" /> uncalibrated</span>} />
          <Dial
            value={r.novelty.novelty}
            label="Novelty"
            color={BAND_COLOR[r.novelty.band]}
            size={104}
            claimed={r.novelty.band !== 'unknown'}
            testId="result-novelty"
            sub={<span className="mt-1"><BandChip band={r.novelty.band} /></span>}
          />
        </div>
        <h3 className="display mt-3 text-[1.3rem] leading-tight">{r.plan?.name ?? 'No clear plan'}</h3>
        <p className="mt-1 text-[0.85rem] text-muted"><Prov p="derived" /> {planLine(r.plan, lookup)}</p>
        <button type="button" className="mt-2 text-left text-[0.9rem] hover:text-nov-offmeta" onClick={onEvidence} data-testid="result-nearest">
          <Prov p="measured" /> Novelty: {nearestSummary(r.novelty)} <span className="text-faint">(evidence)</span>
        </button>
        {strongest && <p className="mt-2 text-[0.85rem]"><span className="font-semibold">Why it works:</span> {strongest}</p>}
        <p className={`mt-2 text-[0.8rem] ${r.floor.passed ? 'text-r-top' : 'text-r-low'}`}>
          {r.floor.passed ? `Power floor passed (${r.floor.checks.length} checks)` : `Floor failed: ${failed.map((c) => c.label).join(', ')}`}
        </p>
        <div className="mt-auto flex gap-2 pt-3">
          <button type="button" className="btn btn-primary" onClick={onOpen} data-testid="open-result">Open in builder</button>
          <button type="button" className="btn btn-quiet" onClick={() => setShowPicks((s) => !s)} aria-expanded={showPicks}>{showPicks ? 'Hide picks' : 'Why each card'}</button>
        </div>
      </div>
      {showPicks && (
        <div className="col-span-2 border-t border-line pt-4" data-testid="picks">
          <p className="mb-3 max-w-[90ch] text-[0.85rem] text-muted">{r.why}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-3 text-[0.82rem]">
            {r.picks.map((p) => (
              <li key={p.defId} className="grid grid-cols-[56px_1fr] gap-2">
                <button type="button" onClick={() => onCard(p.defId)} aria-label={lookup[p.defId]?.name ?? p.defId}><CardArt id={p.defId} card={lookup[p.defId]} /></button>
                <div className="space-y-0.5">
                  <p><b>{lookup[p.defId]?.name ?? p.defId}.</b> {p.interaction}</p>
                  <p className="text-muted">{p.unusual}</p>
                  <p className="text-muted">{p.replaces}</p>
                  <p className="text-r-mid">{p.risk}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="sr-only">Result {i + 1}</span>
    </article>
  );
}

export default function Page() {
  return (
    <Suspense>
      <BrewPage />
    </Suspense>
  );
}
