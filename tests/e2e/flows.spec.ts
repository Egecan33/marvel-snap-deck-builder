/**
 * End-to-end flows of spec §17 against a copy of the real synced database (see copy-db.ts and
 * playwright.config.ts). Card names used here are only search inputs: whether a build works
 * around them is read from the app, not assumed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = path.join(process.cwd(), 'test-results', 'e2e-shots');
const BUILD_TIMEOUT = 90_000;

/** Every card image inside `scope` has loaded from data/images (512 px art, not the 510 px placeholder). */
async function expectArtLoaded(scope: Locator, n: number): Promise<void> {
  const imgs = scope.locator('[data-testid="card-art"] img');
  await expect(imgs).toHaveCount(n);
  await expect.poll(async () => imgs.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 510).length), { timeout: 20_000 }).toBe(n);
}

const num = async (l: Locator): Promise<number> => Number((await l.innerText()).replace(/[^\d.-]/g, ''));

async function pickBuildAround(page: Page, name: string): Promise<void> {
  const hit = page.locator(`[data-testid="brew-hit"][title^="${name}:"]`);
  // A cold `next dev` can reload the page once after its first compile, dropping the typed text,
  // so the search is retyped until the hit shows.
  await expect(async () => {
    await page.getByTestId('brew-search').fill(name);
    await expect(hit).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  await hit.click();
  await expect(page.getByTestId('locks').getByTestId('card-art')).toHaveCount(1);
}

async function waitAnalysed(page: Page): Promise<void> {
  await expect(page.getByTestId('legal-chip')).not.toHaveText('…', { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

// A cold `next dev` compiles each route on first use and loads the CardDb; warm the routes the
// flows hit first so the first flow does not spend its time budget on compilation.
test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  const deck = { id: null, name: 'warm', format: 'ranked', cards: [], themes: [], buildMode: 'brew' };
  expect((await request.get('/api/status', { timeout: 120_000 })).ok()).toBe(true);
  expect((await request.post('/api/cards', { data: { deck, pageSize: 24, filters: { maxPlayRate: 0.01 } }, timeout: 120_000 })).ok()).toBe(true);
  await request.get('/new', { timeout: 120_000 });
});

test('1. brew around a card, open a result: 12 images, rating, novelty and a legal chip', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/new');
  await pickBuildAround(page, 'Man-Spider');
  await page.getByTestId('brew-go').click();
  const first = page.getByTestId('brew-result').first();
  await expect(first).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(page.getByTestId('brew-refused')).toHaveCount(0);
  const rating = await num(first.getByTestId('result-rating-value'));
  const novelty = await num(first.getByTestId('result-novelty-value'));
  expect(rating).toBeGreaterThan(0);
  expect(novelty).toBeGreaterThanOrEqual(60);      // brew requirement (builder), measured by the app
  await first.getByRole('button', { name: 'Why each card' }).click();
  await expect(first.getByTestId('picks')).toContainText('Man-Spider');
  await page.screenshot({ path: path.join(SHOTS, '1-brew.png') });

  await first.getByTestId('open-result').click();
  await page.waitForURL(/\/deck\//);
  await expect(page.getByTestId('deck-card')).toHaveCount(12);
  await expectArtLoaded(page.locator('[data-testid="deck-card"]'), 12);
  await waitAnalysed(page);
  await expect(page.getByTestId('legal-chip')).toHaveText(/^Legal/);
  expect(await num(page.getByTestId('rating-gauge-value'))).toBe(rating);
  expect(await num(page.getByTestId('novelty-gauge-value'))).toBe(novelty);
  await expect(page.locator('[data-testid="deck-card"][data-id="ManSpider"]')).toHaveAttribute('data-locked', 'true');
  await page.screenshot({ path: path.join(SHOTS, '1-builder.png') });
});

test('2. build by hand: removing a card changes the numbers and the chip', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/new');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-text').fill(readFileSync(path.join(process.cwd(), 'tests/fixtures/decks/kluh.txt'), 'utf8'));
  await page.getByTestId('import-go').click();
  await page.waitForURL(/\/deck\//);
  await expect(page.getByTestId('deck-card')).toHaveCount(12);
  await waitAnalysed(page);
  await expect(page.getByTestId('legal-chip')).toHaveText(/^Legal/);
  const before = await num(page.getByTestId('rating-gauge-value'));

  const victim = page.getByTestId('deck-card').first();
  await victim.hover();
  await victim.getByTestId('deck-remove').click();
  await expect(page.getByTestId('deck-card')).toHaveCount(11);
  await expect(page.getByTestId('legal-chip')).toHaveText('11 of 12', { timeout: 30_000 });
  await expect.poll(async () => num(page.getByTestId('rating-gauge-value')), { timeout: 30_000 }).not.toBe(before);
  await page.screenshot({ path: path.join(SHOTS, '2-removed.png') });

  // Add a card back from the browser: the deck is complete again.
  await page.getByTestId('browser-card').first().hover();
  await page.getByTestId('browser-add').first().click();
  await expect(page.getByTestId('deck-card')).toHaveCount(12);
  await expect(page.getByTestId('legal-chip')).toHaveText(/^Legal/, { timeout: 30_000 });
});

test('3. improve an imported deck code: proposals with deltas, accept one', async ({ page }) => {
  test.setTimeout(180_000);
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/decks/magneto.txt'), 'utf8');
  const code = text.split('\n').find((l) => l.length > 40 && !l.startsWith('#'))!;
  await page.goto('/new');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-text').fill(code);
  await page.getByTestId('import-go').click();
  await page.waitForURL(/\/deck\//);
  await expect(page.getByTestId('deck-card')).toHaveCount(12);
  await waitAnalysed(page);

  await page.getByTestId('tab-improve').click();
  await page.getByTestId('improve-original').click();
  const swap = page.getByTestId('swap').first();
  await expect(swap).toBeVisible({ timeout: BUILD_TIMEOUT });
  await page.screenshot({ path: path.join(SHOTS, '3-improve.png') });
  const ids = async () => page.getByTestId('deck-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort().join(','));
  const before = await ids();
  await swap.getByTestId('swap-accept').click();
  await expect.poll(ids, { timeout: 15_000 }).not.toBe(before);
  await expect(page.getByTestId('deck-card')).toHaveCount(12);
  await waitAnalysed(page);
  await expect(page.getByTestId('legal-chip')).toHaveText(/^Legal/, { timeout: 30_000 });
});

test('4. import a collection and build owned-only', async ({ page, request }) => {
  test.setTimeout(180_000);
  // The e2e database is a copy: start from an empty collection.
  expect((await request.delete('/api/collection')).ok()).toBe(true);
  const lists = ['zombie', 'arthur', 'magneto', 'fantomex', 'patriot', 'kluh']
    .map((d) => readFileSync(path.join(process.cwd(), `tests/fixtures/decks/${d}.txt`), 'utf8').split('\n').filter((l) => /^# \(\d+\)/.test(l)).join('\n'));
  await page.goto('/collection');
  await page.getByTestId('collection-text').fill(lists.join('\n'));
  await page.getByTestId('collection-add').click();
  await expect(page.getByTestId('collection-report')).toContainText('cards added', { timeout: 20_000 });
  const owned = new Set<string>((await (await request.get('/api/collection')).json()).ownedIds);
  await page.screenshot({ path: path.join(SHOTS, '4-collection.png') });

  await page.goto('/new');
  await page.getByTestId('mode-tuned').click();
  await page.getByText(/Only cards in my collection/).click();
  await pickBuildAround(page, 'Zombie Giant-Man');
  await page.getByTestId('brew-go').click();
  const first = page.getByTestId('brew-result').first();
  await expect(first).toBeVisible({ timeout: BUILD_TIMEOUT });
  const shown = await first.getByTestId('card-art').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-id')))]);
  expect(shown.length).toBeGreaterThanOrEqual(12);
  expect(owned.size).toBeGreaterThan(30);
  for (const id of shown) expect(owned.has(id!), `${id} is owned`).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '4-owned-build.png') });
});

test('5. discover a gem and theorycraft: brew from a pair, read the lines', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/discover');
  const gem = page.getByTestId('gem').first();
  await expect(gem).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, '5-discover.png') });
  await gem.getByTestId('gem-brew').click();
  await page.waitForURL(/\/new\?cards=/);
  await expect(page.getByTestId('locks').getByTestId('card-art')).toHaveCount(2);
  await page.getByTestId('brew-go').click();
  await expect(page.getByTestId('brew-result').or(page.getByTestId('brew-refused')).first()).toBeVisible({ timeout: BUILD_TIMEOUT });

  // Theorycraft on a known list: lines name the deck's cards.
  await page.goto('/new');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-text').fill(readFileSync(path.join(process.cwd(), 'tests/fixtures/decks/patriot.txt'), 'utf8'));
  await page.getByTestId('import-go').click();
  await page.waitForURL(/\/deck\//);
  await waitAnalysed(page);
  await page.getByTestId('tab-lines').click();
  const turns = page.getByTestId('lines-turns');
  await expect(turns.locator('li')).toHaveCount(6, { timeout: 20_000 });
  await expect(turns).toContainText('Turn 1');
  await expect(page.getByTestId('lines-turns').locator('..')).toContainText('Patriot');
  await page.screenshot({ path: path.join(SHOTS, '5-lines.png') });
});
