import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './db';

/** `data/images/{defId}.webp`, one 512 px render per card (spec §6.1). */
export const imageDir = (): string => process.env.SNAP_FORGE_IMAGES ?? path.join(dataDir(), 'images');

/** `<defId>.webp`: a defId is letters and digits only (data §1.1). Nothing else reaches the file system. */
export const IMAGE_FILE = /^[A-Za-z0-9]{1,80}\.webp$/;

/**
 * Intrinsic width of the placeholder. Browsers draw an SVG body of a 404 without an error event, so
 * the UI tells a missing image from real art (512 px) by this width and draws a named tile instead.
 */
export const PLACEHOLDER_WIDTH = 510;

/** A plain card back, shown for images that are not on disk. The art is square with a transparent background. */
export const PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${PLACEHOLDER_WIDTH}" height="${PLACEHOLDER_WIDTH}" role="img" aria-label="Card image not available">` +
  '<rect x="96" y="40" width="320" height="432" rx="26" fill="#1b1c26" stroke="#4a4d66" stroke-width="6"/>' +
  '<path d="M256 150l28 76h80l-64 50 24 78-68-48-68 48 24-78-64-50h80z" fill="#4a4d66"/>' +
  '</svg>';

const text = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * GET /api/img/:file. A hit is cached for a day (art can change with a game build and keeps its
 * name). A miss is not cached: the image may arrive with the next sync.
 */
export async function serveImage(file: string): Promise<Response> {
  if (!IMAGE_FILE.test(file)) return text(400, 'file must be <defId>.webp');
  try {
    const bytes = await readFile(path.join(imageDir(), file));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response(PLACEHOLDER_SVG, {
      status: 404,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
