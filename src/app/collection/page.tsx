'use client';

import { useEffect, useState } from 'react';
import { useNotify, useStatus } from '../components/Shell';
import { clearCollection, getCollection, getSettings, importCollection, setSeries, updateSettings, type CollectionSummary, type Settings } from '../lib/api';
import { errText, isAbort } from '../lib/ui';

/**
 * Collection (spec §16): one import box (state file, pasted list, deck codes), per-series bulk
 * toggles and counts by series. No login anywhere: the game exposes no collection without one.
 */
export default function CollectionPage() {
  const notify = useNotify();
  const { refresh } = useStatus();
  const [sum, setSum] = useState<CollectionSummary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getCollection(ctrl.signal).then(setSum, (e) => !isAbort(e) && notify.error(e));
    getSettings(ctrl.signal).then((r) => setSettings(r.settings), (e) => !isAbort(e) && notify.error(e));
    return () => ctrl.abort();
  }, [notify]);

  const run = async (mode: 'add' | 'replace') => {
    setBusy(true);
    setReport(null);
    try {
      const r = await importCollection(text, mode);
      setSum(r.summary);
      setReport(`Read as ${r.kind}: ${r.added} cards added.${r.unresolved.length ? ` Not recognised (${r.unresolved.length}): ${r.unresolved.slice(0, 30).join(', ')}${r.unresolved.length > 30 ? '…' : ''}` : ''}`);
      void refresh();
    } catch (e) {
      setReport(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSeries = async (series: number, owned: boolean) => {
    try {
      setSum((await setSeries(series, owned)).summary);
      void refresh();
    } catch (e) {
      notify.error(e);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
  };

  return (
    <div className="mx-auto grid max-w-[1300px] grid-cols-[1fr_460px] gap-8 p-6">
      <section>
        <h1 className="display text-[2.2rem] leading-none">Collection</h1>
        <p className="mt-1 max-w-[65ch] text-[0.88rem] text-muted">
          Optional. With a collection, the card browser can show owned cards and builds can use only what you own. Paste deck codes or a card list, or load the
          game&apos;s collection state file if you have a copy of it.
        </p>
        <textarea
          className="field mt-4 h-72 w-full"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Deck codes, a card list (one name per line) or the state file contents'}
          aria-label="Collection input"
          data-testid="collection-text"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="btn btn-quiet cursor-pointer">
            Load a file
            <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <span className="flex-1" />
          <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => run('replace')}>Replace collection</button>
          <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => run('add')} data-testid="collection-add">Add to collection</button>
        </div>
        {report && <p className="mt-3 max-w-[80ch] text-[0.85rem]" data-testid="collection-report">{report}</p>}

        {settings && (
          <label className="mt-6 flex items-center gap-2 text-[0.9rem]">
            <input
              type="checkbox"
              checked={settings.ownedOnly}
              onChange={async (e) => {
                try {
                  setSettings((await updateSettings({ ownedOnly: e.target.checked })).settings);
                } catch (err) {
                  notify.error(err);
                }
              }}
              data-testid="owned-only"
            />
            Build and browse with owned cards only by default
          </label>
        )}
      </section>

      <section aria-label="By series">
        <div className="flex items-baseline justify-between">
          <h2 className="display text-[1.4rem]">By series</h2>
          {sum && <span className="text-[0.9rem]"><b>{sum.owned}</b> <span className="text-muted">of {sum.released} released cards owned</span></span>}
        </div>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel" data-testid="series-list">
          {sum?.bySeries.map((s) => (
            <li key={s.series} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-28 font-semibold">{s.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-line"><span className="block h-full bg-nov-variant" style={{ width: `${s.total ? (s.owned / s.total) * 100 : 0}%` }} /></span>
              <span className="w-16 text-right text-[0.85rem] text-muted">{s.owned} / {s.total}</span>
              <button type="button" className="btn btn-sm" onClick={() => toggleSeries(s.series, s.owned < s.total)}>{s.owned < s.total ? 'Own all' : 'Own none'}</button>
            </li>
          ))}
        </ul>
        {sum && sum.owned > 0 && (
          <button
            type="button"
            className="btn btn-quiet btn-sm mt-3"
            onClick={async () => {
              if (!window.confirm('Remove every card from the collection?')) return;
              try {
                setSum(await clearCollection());
                void refresh();
              } catch (e) {
                notify.error(e);
              }
            }}
          >
            Clear collection
          </button>
        )}
      </section>
    </div>
  );
}
