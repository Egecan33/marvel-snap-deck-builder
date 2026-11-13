'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createDeck, importDeck } from '../lib/api';
import { errText } from '../lib/ui';
import { Overlay } from './card';
import { useNotify } from './Shell';

/** Paste a deck code or a list; the deck is saved and opened in the builder. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const notify = useNotify();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await importDeck(text);
      if (res.deck.cards.length === 0) {
        setProblem(`No card was recognised.${res.unresolved.length ? ` Unresolved lines: ${res.unresolved.map((u) => `${u.line}: ${u.text}`).join('; ')}` : ''}`);
        return;
      }
      const saved = await createDeck({ ...res.deck, buildMode: 'tuned' });
      if (res.unresolved.length) notify.error(`Not recognised: ${res.unresolved.map((u) => `line ${u.line} "${u.text}"`).join(', ')}`);
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay onClose={onClose} label="Import a deck">
      <div className="space-y-3 p-6">
        <h2 className="display text-[1.5rem]">Import a deck</h2>
        <p className="text-[0.85rem] text-muted">Paste a deck code (long or short, with or without the &ldquo;# (1) Card&rdquo; block) or a card list, one card per line.</p>
        <textarea className="field h-56 w-full" value={text} onChange={(e) => setText(e.target.value)} aria-label="Deck code or list" data-testid="import-text" autoFocus />
        {problem && <p className="text-[0.85rem] text-r-low">{problem}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={go} data-testid="import-go">{busy ? 'Importing…' : 'Import and open'}</button>
        </div>
      </div>
    </Overlay>
  );
}

