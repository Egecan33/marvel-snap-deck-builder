import { clearCollection, collectionSummary, importCollection, setSeries } from '@/server/collection';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(collectionSummary()));

/** `{ text, mode }` imports the box input; `{ series, owned }` is a per-series bulk toggle. */
export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    if ('series' in body) return json({ summary: setSeries(body.series, body.owned) });
    return json(importCollection(body.text, body.mode ?? 'add'));
  });

export const DELETE = () => handle(() => json(clearCollection()));
