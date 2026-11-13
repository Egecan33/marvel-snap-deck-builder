import type { Deck } from '@/engine/types';
import { cardDetail } from '@/server/browse';
import { engineContext } from '@/server/context';
import { getDeck, sanitizeDeck } from '@/server/decks';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** `?deck=` is a saved deck id or a comma-separated list of card ids. */
function deckParam(value: string | null): Deck | null {
  if (!value) return null;
  const saved = getDeck(value);
  if (saved) return saved.deck;
  return sanitizeDeck({ cards: value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40) });
}

export const GET = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const deck = deckParam(new URL(req.url).searchParams.get('deck'));
    return json(cardDetail(id, deck, engineContext()));
  });
