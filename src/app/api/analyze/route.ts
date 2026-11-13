import { analyzeDeck } from '@/server/context';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(analyzeDeck(sanitizeDeck(body.deck)));
  });
