import { queryCards } from '@/server/browse';
import { engineContext } from '@/server/context';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const deck = sanitizeDeck(body.deck ?? {});
    return json(queryCards(body, deck, engineContext()));
  });
