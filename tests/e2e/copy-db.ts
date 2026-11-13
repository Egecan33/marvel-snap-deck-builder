/**
 * Playwright web server prelude: copies the real synced database (data/forge.db) to
 * data/e2e-forge.db so the end-to-end flows (collection import, saved decks, settings) never
 * change the owner's own collection or decks. Images are read from data/images as usual.
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = process.env.SNAP_FORGE_DATA ?? path.join(process.cwd(), 'data');
const src = path.join(dataDir, 'forge.db');
const dst = process.env.SNAP_FORGE_DB ?? path.join(dataDir, 'e2e-forge.db');
if (!existsSync(src)) {
  console.error(`No synced database at ${src}. Run \`pnpm sync\` before \`pnpm e2e\`.`);
  process.exit(1);
}
for (const f of [dst, `${dst}-wal`, `${dst}-shm`]) rmSync(f, { force: true });
const db = new Database(src, { readonly: true });
db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
db.close();
console.log(`e2e database: ${dst}`);
