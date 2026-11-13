import { cardLookup } from '@/server/context';
import { listDecks, sanitizeDeck, saveDeck } from '@/server/decks';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json({ decks: listDecks() }));

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const saved = saveDeck(sanitizeDeck(body.deck));
    if (!saved) throw new HttpError(500, 'The deck could not be saved.');
    return json({ ...saved, cards: cardLookup(saved.deck.cards.map((c) => c.defId)) }, 201);
  });
