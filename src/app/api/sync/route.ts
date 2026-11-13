import { HttpError, handle, intParam, json, readBody } from '@/server/http';
import { startSync, SyncError, syncState } from '@/server/sync-runner';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => json(syncState(intParam(new URL(req.url).searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER))));

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    try {
      return json(startSync(body.step), 202);
    } catch (err) {
      if (err instanceof SyncError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });
