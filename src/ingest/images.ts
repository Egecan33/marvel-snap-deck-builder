import { existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { classOf, type UntappedCardRow } from '@/engine/carddb';
import { writeSyncState, type Db } from '@/server/db';
import { imageDir } from '@/server/images';
import type { Log } from './cards';
import { downloadToFile, HttpStatusError, type HttpOptions } from './http';

/** Full card render without cost and power; the UI draws those (data §2). */
export const imageUrl = (defId: string): string => `https://snapjson.untapped.gg/art/render/framebreak/common/512/${defId}.webp`;
export const imagePath = (defId: string, dir: string = imageDir()): string => path.join(dir, `${defId}.webp`);

/** True when the file starts with a RIFF....WEBP container header. */
export async function isWebp(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await fh.read(head, 0, 12, 0);
    return bytesRead === 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  } finally {
    await fh.close();
  }
}

const present = (file: string): boolean => existsSync(file) && statSync(file).size > 0;

/**
 * defIds that need art: released cards first, then the tokens that released and upcoming cards
 * create, then upcoming cards. Mode copies, augments and unreferenced rows are left out.
 */
export function imageTargets(rows: readonly UntappedCardRow[], now: number): string[] {
  const byId = new Map(rows.map((r) => [r.defId, r]));
  const byName = (a: UntappedCardRow, b: UntappedCardRow) => String(a.name).localeCompare(String(b.name), 'en') || (a.defId < b.defId ? -1 : 1);
  const released = rows.filter((r) => classOf(r, now) === 'released').sort(byName);
  const upcoming = rows.filter((r) => classOf(r, now) === 'upcoming').sort(byName);
  const tokens: string[] = [];
  for (const r of [...released, ...upcoming]) {
    const links = r.attributes?.cards ?? {};
    for (const id of [...(links.Card_Token ?? []), ...(links.Hidden_Card_Token ?? [])]) if (byId.has(id)) tokens.push(id);
  }
  const valid = (id: string) => /^[A-Za-z0-9]+$/.test(id);
  return [...new Set([...released.map((r) => r.defId), ...tokens, ...upcoming.map((r) => r.defId)])].filter(valid);
}

export interface ImageOptions {
  limit?: number;          // number of cards, released first
  concurrency?: number;    // requests to one host are serial whatever this is (http.ts)
  dir?: string;
  now?: number;
  http?: HttpOptions;
}

export interface ImageResult { wanted: number; downloaded: number; skipped: number; noArt: string[]; failures: string[]; onDisk: number }

export async function syncImages(db: Db, log: Log, opts: ImageOptions = {}): Promise<ImageResult> {
  const dir = opts.dir ?? imageDir();
  const now = opts.now ?? Date.now();
  await mkdir(dir, { recursive: true });

  const rows = (db.prepare('SELECT json FROM cards').all() as { json: string }[]).map((r) => JSON.parse(r.json) as UntappedCardRow);
  if (rows.length === 0) log('images: no cards in the database; run `pnpm sync cards` first');
  let ids = imageTargets(rows, now);
  if (opts.limit !== undefined) ids = ids.slice(0, opts.limit);

  const failures: string[] = [];
  const noArt: string[] = [];
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  const tick = () => {
    if (++done % 50 === 0 || done === ids.length) log(`images ${done}/${ids.length} (${downloaded} downloaded, ${skipped} on disk)`);
  };

  const runJob = async (defId: string) => {
    const dest = imagePath(defId, dir);
    if (present(dest)) {
      skipped++;
      return tick();
    }
    const tmp = `${dest}.tmp`;
    try {
      await downloadToFile(imageUrl(defId), tmp, opts.http); // writes tmp.part, then tmp
      if (!(await isWebp(tmp))) throw new Error('not a WebP file');
      await rename(tmp, dest);
      downloaded++;
    } catch (err) {
      await rm(tmp, { force: true });
      // 403/404 on the art host means "no art yet", which is normal for upcoming cards (data §2).
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 403)) noArt.push(defId);
      else failures.push(`${defId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    tick();
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 1, ids.length)) }, async () => {
      while (next < ids.length) await runJob(ids[next++]);
    }),
  );

  const onDisk = ids.filter((id) => present(imagePath(id, dir))).length;
  const info = { wanted: ids.length, downloaded, skipped, onDisk, noArt, failed: failures.length, limit: opts.limit ?? null };
  writeSyncState(db, 'images', info);
  for (const f of failures.slice(0, 50)) log(`images failed ${f}`);
  if (failures.length > 50) log(`images failed ... and ${failures.length - 50} more`);
  if (noArt.length > 0) log(`images: no art yet for ${noArt.join(', ')}`);
  log(`images finished ${JSON.stringify({ ...info, noArt: noArt.length })}`);
  return { wanted: ids.length, downloaded, skipped, noArt, failures, onDisk };
}
