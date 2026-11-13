import { importDeck } from '@/server/io';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(importDeck(body.text, body.format));
  });
