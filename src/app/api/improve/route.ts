import { runImprove } from '@/server/build';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(runImprove(sanitizeDeck(body.deck), body.direction, body.options));
  });
