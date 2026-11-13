'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import edgeAudit from '../../../tests/fixtures/edge-audit.json';
import { Prov } from '../components/card';
import { CorpusNote } from '../components/deck';
import { useNotify, useStatus } from '../components/Shell';
import { getSync, startSync, type SyncState, type SyncStep } from '../lib/api';
import { fmtDate, fmtInt, pct } from '../lib/ui';

const STEPS: { step: SyncStep; label: string; what: string }[] = [
  { step: 'cards', label: 'Cards', what: 'Card rows, text, cost and Power for the current game build.' },
  { step: 'locations', label: 'Locations', what: 'Location rows.' },
  { step: 'meta', label: 'Meta lists', what: 'Lists, archetypes and play rates of the current meta period. Refuses within 6 hours of the last run.' },
  { step: 'features', label: 'Card understanding', what: 'Parses card text into clauses, axes, tech roles, then the interaction network. Run after cards.' },
  { step: 'images', label: 'Images', what: 'Card art into data/images, one second apart. Only missing files are fetched.' },
];

/** Data (spec §16): sync status and buttons, image progress, build, meta snapshot, parser coverage, edge audit, formats. */
export default function DataPage() {
  const notify = useNotify();
  const { status, refresh } = useStatus();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const since = useRef(0);
  const logRef = useRef<HTMLPreElement>(null);

  const poll = useCallback(async () => {
    try {
      const s = await getSync(since.current);
      since.current = s.lineCount;
      setSync(s);
      if (s.lines.length) setLines((l) => [...l, ...s.lines].slice(-400));
      return s;
    } catch (e) {
      notify.error(e);
      return null;
    }
  }, [notify]);

  useEffect(() => {
    void poll();
  }, [poll]);
  useEffect(() => {
    if (!sync?.running) return;
    const t = setInterval(async () => {
      const s = await poll();
      if (s && !s.running) void refresh();
    }, 1000);
    return () => clearInterval(t);
  }, [sync?.running, poll, refresh]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const run = async (step: SyncStep | 'all') => {
    try {
      since.current = 0;
      setLines([]);
      setSync(await startSync(step));
    } catch (e) {
      notify.error(e);
    }
  };

  const s = status;
  const imgInfo = s?.sync.images?.info as { wanted?: number; noArt?: string[] } | undefined;
  const cov = s?.coverage as { noClause?: number; unparsed?: number; attributeMismatch?: number; staleOverrides?: string[] } | null | undefined;
  const build = (s?.sync.cards?.info as { build?: string } | undefined)?.build;
  const feat = s?.sync.features?.info as { archetypes?: { total: number; tagged: number } } | undefined;

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <h1 className="display text-[2.2rem] leading-none">Data</h1>
      {s?.empty && (
        <div className="mt-3 max-w-[70ch] rounded-xl border border-nov-brew/60 bg-nov-brew/10 p-4" data-testid="first-run">
          <p className="display text-[1.3rem]">No card data yet.</p>
          <p className="mt-1 text-[0.9rem]">Run a full sync: cards, locations, meta lists, card understanding and images. It takes a few minutes, mostly for the images. After that the app works offline.</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-[1fr_420px] gap-8">
        <section aria-label="Sync">
          <div className="flex items-center gap-3">
            <h2 className="display text-[1.4rem]">Sync</h2>
            <button type="button" className="btn btn-primary btn-sm" disabled={sync?.running} onClick={() => run('all')} data-testid="sync-all">Sync everything</button>
            {sync?.running && <span className="text-[0.85rem] text-muted">Running {sync.step}…</span>}
            {sync && !sync.running && sync.exitCode !== null && (
              <span className={`text-[0.85rem] ${sync.exitCode === 0 ? 'text-r-top' : 'text-r-low'}`}>Last run ({sync.step}) {sync.exitCode === 0 ? 'finished' : `failed (exit ${sync.exitCode})`}</span>
            )}
          </div>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel">
            {STEPS.map((x) => {
              const st = s?.sync[x.step];
              return (
                <li key={x.step} className="flex items-center gap-4 px-4 py-3" data-testid={`sync-${x.step}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{x.label}</p>
                    <p className="text-[0.8rem] text-muted">{x.what}</p>
                  </div>
                  <span className="w-44 text-right text-[0.8rem] text-faint">{st ? `Done ${fmtDate(st.finishedAt)}` : 'Never run'}</span>
                  <button type="button" className="btn btn-sm" disabled={sync?.running} onClick={() => run(x.step)}>Run</button>
                </li>
              );
            })}
          </ul>
          {lines.length > 0 && (
            <pre ref={logRef} className="thin-scroll mt-3 max-h-64 overflow-auto rounded-xl border border-line bg-ink p-3 text-[0.75rem] text-muted" data-testid="sync-log">{lines.join('\n')}</pre>
          )}

          {s && !s.empty && (
            <>
              <h2 className="display mt-8 text-[1.4rem]">Card understanding</h2>
              <ul className="mt-2 space-y-1 text-[0.88rem]">
                <li><Prov p="measured" /> {fmtInt(s.counts.features)} cards with features; {fmtInt(s.counts.edges)} interaction edges, {fmtInt(s.counts.strongEdges)} strong.</li>
                {cov && (
                  <li><Prov p="measured" /> Parser coverage: {cov.noClause ?? 0} released cards without a clause, {cov.unparsed ?? 0} unread sentences, {cov.attributeMismatch ?? 0} disagreements with the card attributes{cov.staleOverrides?.length ? `, stale overrides: ${cov.staleOverrides.join(', ')}` : ', no stale override'}.</li>
                )}
                <li>
                  <Prov p="measured" /> Edge audit (hand-read sample of strong edges): {pct(edgeAudit.precision.strict)} strict, {pct(edgeAudit.precision.lenient)} lenient on {edgeAudit.sample.length} edges;
                  held-out after the review {pct(edgeAudit.heldOut.precision.strict)} strict, {pct(edgeAudit.heldOut.precision.lenient)} lenient on {edgeAudit.heldOut.sample.length}.
                </li>
                {feat?.archetypes && <li><Prov p="derived" /> {feat.archetypes.tagged} of {feat.archetypes.total} meta archetypes matched to a plan family.</li>}
              </ul>
            </>
          )}
        </section>

        <aside className="space-y-6">
          {s && (
            <section>
              <h2 className="display text-[1.4rem]">Cards</h2>
              <ul className="mt-2 space-y-0.5 text-[0.88rem]" data-testid="data-counts">
                <li>Game build <b>{build ?? 'unknown'}</b></li>
                <li><b>{fmtInt(s.counts.released)}</b> released, {fmtInt(s.counts.upcoming)} upcoming, {fmtInt(s.counts.tokens)} tokens and other rows</li>
                <li><b>{fmtInt(s.counts.images)}</b> images on disk{imgInfo?.wanted ? ` of ${fmtInt(imgInfo.wanted)} wanted` : ''}{imgInfo?.noArt?.length ? ` (${imgInfo.noArt.length} have no art on the host)` : ''}</li>
                <li>{fmtInt(s.counts.locations)} locations, {fmtInt(s.counts.decks)} saved decks, {fmtInt(s.counts.owned)} owned cards</li>
              </ul>
            </section>
          )}
          {s && (
            <section>
              <h2 className="display text-[1.4rem]">Meta snapshot</h2>
              {s.meta ? (
                <ul className="mt-2 space-y-0.5 text-[0.88rem]">
                  <li>{s.meta.periodLabel ?? `Period ${s.meta.periodId}`}{s.meta.periodStart ? `, from ${fmtDate(s.meta.periodStart)}` : ''}</li>
                  <li><b>{fmtInt(s.meta.lists)}</b> lists in {fmtInt(s.meta.clusters)} clusters, {fmtInt(s.meta.games)} games, {s.corpus.archetypes} archetypes</li>
                  <li>Baseline win rate {pct(s.meta.baselineWinRate)}</li>
                </ul>
              ) : null}
              <div className="mt-2"><CorpusNote corpus={s.meta} withheld={s.corpus.withheld} /></div>
            </section>
          )}
          {s && (
            <section>
              <h2 className="display text-[1.4rem]">Modes</h2>
              <ul className="mt-2 space-y-2 text-[0.85rem]" data-testid="formats">
                {s.formats.map((f) => (
                  <li key={f.id}>
                    <span className="font-semibold">{f.name}</span>{' '}
                    <span className={f.checked ? 'text-r-top' : 'text-r-mid'}>{f.checked ? 'verified' : f.constructed ? 'not verified' : 'not constructed'}</span>
                    {f.stale && <span className="text-r-mid">, list may be stale</span>}
                    {f.banned.length > 0 && <span className="text-muted">, {f.banned.length} banned</span>}
                    <p className="text-[0.78rem] text-faint">{f.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[0.75rem] text-faint">Unofficial fan project. Not affiliated with, endorsed or sponsored by Marvel or Second Dinner.</p>
        </aside>
      </div>
    </div>
  );
}
