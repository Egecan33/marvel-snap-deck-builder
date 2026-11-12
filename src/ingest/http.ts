import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Generic on purpose: nothing in a request identifies the owner (AGENTS.md hard rule 9). */
export const USER_AGENT = 'SnapForge/0.1';

/** Minimum time between two requests to one host. Requests to a host never overlap. */
export const HOST_GAP_MS: Record<string, number> = {
  'api.snap.untapped.gg': 2000,   // analytics API: 2 s apart (meta §4)
  'snapjson.untapped.gg': 1000,   // card data and art: 1 s apart (data §6)
};
export const DEFAULT_GAP_MS = 1000;

/** Hosts the sync must not call: robots.txt disallows the API paths (meta §2.3). */
const REFUSED = [/(^|\.)marvelsnapzone\.com$/i];

export interface HttpOptions {
  /** Wait after a 429 before retrying. */
  retryWaitMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Overrides the per-host gap (tests pass 0). */
  gapMs?: number;
  /** Extra request headers, for example If-None-Match. Never put personal data here. */
  headers?: Record<string, string>;
  accept?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One queue per host: a request starts only after the previous one to that host has returned
// its headers and the gap has passed.
const queues = new Map<string, Promise<void>>();
const lastStart = new Map<string, number>();

function inTurn<T>(host: string, gapMs: number, run: () => Promise<T>): Promise<T> {
  const prev = queues.get(host) ?? Promise.resolve();
  const result = prev.then(async () => {
    const wait = (lastStart.get(host) ?? -Infinity) + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await run();
    } finally {
      lastStart.set(host, Date.now());
    }
  });
  queues.set(host, result.then(() => undefined, () => undefined));
  return result;
}

/**
 * GET with the required headers: generic User-Agent, no cookies (Node's fetch keeps none), serial
 * per host with a gap. Waits and retries on 429; other statuses are returned as-is.
 */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { retryWaitMs = 60_000, maxAttempts = 3, fetchImpl = fetch } = opts;
  const host = new URL(url).host;
  if (REFUSED.some((re) => re.test(host))) throw new Error(`refusing to fetch ${host}: its robots.txt disallows automated access`);
  const gapMs = opts.gapMs ?? HOST_GAP_MS[host] ?? DEFAULT_GAP_MS;
  const headers = { 'User-Agent': USER_AGENT, Accept: opts.accept ?? '*/*', ...opts.headers };
  for (let attempt = 1; ; attempt++) {
    const res = await inTurn(host, gapMs, () => fetchImpl(url, { headers, redirect: 'follow', credentials: 'omit' }));
    if (res.status !== 429 || attempt >= maxAttempts) return res;
    await res.body?.cancel().catch(() => undefined);
    console.log(`http 429 from ${host}; waiting ${Math.round(retryWaitMs / 1000)} s (attempt ${attempt})`);
    await sleep(retryWaitMs);
  }
}

/** GET a JSON document. `url` in the result is the final URL after redirects. */
export async function getJson<T = unknown>(url: string, opts?: HttpOptions): Promise<{ data: T; url: string; etag: string | null; lastModified: string | null }> {
  const res = await httpGet(url, { accept: 'application/json', ...opts });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  const body = await res.text();
  if (!body.trim()) throw new Error(`GET ${url} -> HTTP ${res.status} with an empty body`);
  return { data: JSON.parse(body) as T, url: res.url || url, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
}

export class HttpStatusError extends Error {
  constructor(public readonly url: string, public readonly status: number) {
    super(`GET ${url} -> HTTP ${status}`);
  }
}

/**
 * Streams a URL to `dest` through `dest.part`, renaming only when the body completed.
 * Returns the number of bytes written.
 */
export async function downloadToFile(url: string, dest: string, opts?: HttpOptions): Promise<number> {
  const res = await httpGet(url, opts);
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpStatusError(url, res.status);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>), out);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  await rename(part, dest);
  return out.bytesWritten;
}
