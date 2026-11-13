import { handle, json, readBody } from '@/server/http';
import { getSettings, updateSettings } from '@/server/settings';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json({ settings: getSettings() }));

export const PUT = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json({ settings: updateSettings(body.settings) });
  });
