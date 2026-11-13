// Snap Forge portable launcher. Run by "Snap Forge.command" (macOS) and "Snap Forge.bat" (Windows)
// with the bundled Node. One script for both platforms so they behave the same.
//
// 1. Tells the app it runs from a bundle (SNAP_FORGE_BUNDLE): the app then keeps its data in the
//    `data` folder next to `app`, decided by dataDir() in src/server/db.ts.
// 2. Starts the app on 127.0.0.1, first free port of 3230-3239, and opens the browser once it answers.
//    With an empty database the app opens its Data page, where you start the sync yourself.
// Ctrl+C stops everything.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const SYNC = path.join(APP, 'dist', 'sync.mjs');
const NODE = process.execPath;
const DATA = process.env.SNAP_FORGE_DATA || path.join(ROOT, 'data');

const env = { ...process.env, SNAP_FORGE_BUNDLE: ROOT, SNAP_FORGE_SYNC_CLI: SYNC, NODE_ENV: 'production' };

const children = new Set();
function stopAll(code = 0) {
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => { console.log('\nStopping Snap Forge.'); stopAll(0); });
process.on('SIGTERM', () => stopAll(0));

function portFree(port) {
  return new Promise((resolve) => {
    // Something already answering on the port (any address family) means it is taken.
    const probe = net.connect({ host: '127.0.0.1', port });
    probe.once('connect', () => { probe.destroy(); resolve(false); });
    probe.once('error', () => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
  });
}

async function waitForApp(url, server) {
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function openBrowser(url) {
  if (process.env.SNAP_FORGE_NO_BROWSER) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* user can open it by hand */ }
}

async function main() {
  console.log('Snap Forge');
  console.log(`Data folder: ${DATA}\n`);

  let port = 0;
  const first = Number(process.env.PORT) || 3230;
  for (let p = first; p < first + 10; p++) {
    if (await portFree(p)) { port = p; break; }
  }
  if (!port) {
    console.error(`Ports ${first}-${first + 9} are all in use. Close another Snap Forge window and try again.`);
    stopAll(1);
  }
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(NODE, [path.join(APP, 'server.js')], {
    cwd: APP, env: { ...env, PORT: String(port), HOSTNAME: '127.0.0.1' }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.add(server);
  server.on('exit', (code) => { children.delete(server); console.log(`The app stopped (exit code ${code}).`); stopAll(code ?? 1); });

  if (await waitForApp(url, server)) {
    console.log(`\nSnap Forge is running at ${url}`);
    console.log('First run: the Data page opens. Press "Sync everything" there (about 10-15 minutes, mostly card images).');
    console.log('Keep this window open while you use it. Press Ctrl+C to stop.\n');
    openBrowser(url);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopAll(1);
});
