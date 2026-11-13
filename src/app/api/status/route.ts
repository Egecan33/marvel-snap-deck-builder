import { handle, json } from '@/server/http';
import { status } from '@/server/status';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(status()));
