import { listGems } from '@/server/browse';
import { engineContext } from '@/server/context';
import { handle, intParam, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => {
    const p = new URL(req.url).searchParams;
    return json(listGems(p.get('q') ?? '', intParam(p.get('limit'), 50, 1, 500), engineContext()));
  });
