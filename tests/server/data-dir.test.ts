import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dataDir, defaultDbPath } from '@/server/db';
import { imageDir } from '@/server/images';

const KEYS = ['SNAP_FORGE_DATA', 'SNAP_FORGE_BUNDLE', 'SNAP_FORGE_DB', 'SNAP_FORGE_IMAGES'] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

const clear = () => { for (const k of KEYS) delete process.env[k]; };

describe('dataDir', () => {
  it('is ./data from source', () => {
    clear();
    expect(dataDir()).toBe(path.join(process.cwd(), 'data'));
    expect(defaultDbPath()).toBe(path.join(process.cwd(), 'data', 'forge.db'));
    expect(imageDir()).toBe(path.join(process.cwd(), 'data', 'images'));
  });

  it('is next to the app in a portable bundle', () => {
    clear();
    const bundle = path.join(path.sep, 'somewhere', 'SnapForge-0.1.0-macos-arm64');
    process.env.SNAP_FORGE_BUNDLE = bundle;
    expect(dataDir()).toBe(path.join(bundle, 'data'));
    expect(defaultDbPath()).toBe(path.join(bundle, 'data', 'forge.db'));
    expect(imageDir()).toBe(path.join(bundle, 'data', 'images'));
  });

  it('SNAP_FORGE_DATA wins over the bundle folder', () => {
    clear();
    process.env.SNAP_FORGE_BUNDLE = path.join(path.sep, 'bundle');
    process.env.SNAP_FORGE_DATA = path.join(path.sep, 'elsewhere');
    expect(dataDir()).toBe(path.join(path.sep, 'elsewhere'));
  });
});
