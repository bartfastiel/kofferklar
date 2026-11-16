import { expect, test, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:4175';
const env = { ...process.env, DATA_DIR: 'test-results/e2e-data', ORIGIN: BASE };
const cli = (...args: string[]) => execFileSync('node', ['dist-server/cli.mjs', ...args], { env }).toString();
const shots = 'test-results/shots/';

async function signUp(browser: Browser, name: string, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
  const viewport = { width: 412, height: 892 };
  const context = await browser.newContext({ viewport, screen: viewport, colorScheme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errors.push(m.text()));
  (page as Page & { errors: string[] }).errors = errors;
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  const link = cli('invite', '--name', name).split('\n')[0];
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Hallo ${name}!` })).toBeVisible();
  await page.getByRole('button', { name: 'Passkey einrichten' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}

async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

const errorsOf = (page: Page) => (page as Page & { errors: string[] }).errors;

test.describe.configure({ mode: 'serial' });

test('without a session only the sign-in page is reachable', async ({ page }) => {
  await page.goto(BASE + '/#/dinge');
  await expect(page).toHaveURL(/\/login\//);
  await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
  await page.screenshot({ path: shots + 'login.png' });
});

test('configurator → packing list → pack → something was missing → learned for the next trip', async ({ browser }) => {
  const page = await signUp(browser, 'Daniel');
  await expect(page.getByText('Noch keine Reise')).toBeVisible();
  await page.screenshot({ path: shots + 'home-empty.png' });

  // a fishing holiday in Norway by plane, 7 nights
  await page.getByRole('link', { name: '+ Neue Reise packen' }).click();
  await page.getByRole('radio', { name: 'Urlaub' }).click();
  await expect(page.getByRole('heading', { name: 'Wie viele Nächte?' })).toBeVisible();
  await page.getByRole('button', { name: 'Eine Nacht mehr' }).click();
  await expect(page.locator('.nights-value')).toHaveText('2 Nächte');
  await page.getByRole('button', { name: '7', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wie kommst du hin?' })).toBeVisible();
  await page.getByRole('button', { name: 'Flugzeug' }).click();
  await page.screenshot({ path: shots + 'wizard-travel.png' });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: /Außerhalb der EU/ }).click();
  await page.getByRole('button', { name: /Mild/ }).click();
  await page.getByRole('button', { name: /Regen/ }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Angeln' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: 'Ferienwohnung' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByLabel('Name der Reise')).toHaveValue('Urlaub · 7 Nächte · Angeln');
  await page.getByLabel('Name der Reise').fill('Norwegen');
  await page.getByRole('button', { name: 'Packliste zeigen' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Norwegen' })).toBeVisible();
  const list = page.locator('.list');
  for (const x of ['Reisepass', 'Zahnbürste', 'Köder', 'Abhakmatte', 'Feuerzeug', 'Regenjacke', 'Reiseadapter für Steckdosen']) await expect(list.getByText(x, { exact: true })).toBeVisible();
  await expect(list.getByText('Sturmfeuerzeug', { exact: true })).toHaveCount(0);
  await expect(list.locator('.line', { hasText: 'Socken' }).locator('.qty')).toHaveText(' × 8');
  await noOverflow(page);
  await page.screenshot({ path: shots + 'trip.png' });
  await page.screenshot({ path: shots + 'trip-full.png', fullPage: true });

  // pack: tap the line; progress follows; packed lines can be hidden
  const text = page.locator('.progress-text');
  const before = await text.textContent();
  await list.getByRole('checkbox', { name: /Reisepass/ }).click();
  await expect(list.getByRole('checkbox', { name: /Reisepass/ })).toHaveAttribute('aria-checked', 'true');
  await expect(text).not.toHaveText(before as string);
  await page.getByLabel('Eingepacktes ausblenden').check();
  await expect(list.getByText('Reisepass', { exact: true })).toHaveCount(0);
  await page.getByLabel('Eingepacktes ausblenden').uncheck();

  // not needed this time
  await list.getByRole('button', { name: 'Mehr zu Wathose' }).click();
  await list.getByRole('button', { name: 'Diesmal nicht nötig' }).click();
  await expect(list.locator('.lines').getByText('Wathose', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Diesmal nicht nötig (1)')).toBeVisible();

  // something was missing: a bite alarm, needed when fishing
  await page.getByRole('link', { name: '+ Etwas fehlt?' }).click();
  await page.getByLabel('Gegenstand').fill('Bissanzeiger');
  await page.getByLabel('Kategorie').fill('Angeln');
  await expect(page.getByRole('button', { name: 'Angeln' })).toHaveAttribute('aria-pressed', 'true');
  await noOverflow(page);
  await page.screenshot({ path: shots + 'missing.png', fullPage: true });
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gemerkt: Bissanzeiger – bei Angeln')).toBeVisible();
  await expect(list.getByText('Bissanzeiger', { exact: true })).toBeVisible();

  // the answers can change later: hand luggage only removes the Leatherman, packed stays packed
  await expect(list.getByText('Leatherman', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Angaben ändern' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: /Nur Handgepäck/ }).click();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(list.getByText('Leatherman', { exact: true })).toHaveCount(0);
  await expect(list.getByRole('checkbox', { name: /Reisepass/ })).toHaveAttribute('aria-checked', 'true');

  // a day of fishing by car: the learned item is there, the toothbrush is not
  await page.goto(BASE + '/#/');
  await expect(page.getByRole('link', { name: /Norwegen/ })).toBeVisible();
  await page.getByRole('link', { name: '+ Neue Reise packen' }).click();
  await page.getByRole('radio', { name: /Ausflug/ }).click();
  await expect(page.locator('.nights-value')).toHaveText('Ohne Übernachtung');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Auto' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: 'Deutschland' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Angeln' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Packliste zeigen' }).click();
  await expect(list.getByText('Bissanzeiger', { exact: true })).toBeVisible();
  await expect(list.getByText('Sturmfeuerzeug', { exact: true })).toBeVisible();
  await expect(list.getByText('Zahnbürste', { exact: true })).toHaveCount(0);

  // the items: search and edit
  await page.goto(BASE + '/#/dinge');
  await page.getByRole('searchbox').fill('feuerzeug');
  await expect(page.locator('.line')).toHaveCount(2);
  await page.screenshot({ path: shots + 'items.png' });
  await page.getByRole('link', { name: /^Sturmfeuerzeug/ }).click();
  await expect(page.getByText('Außer bei … (Flugzeug)')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: shots + 'item-edit.png', fullPage: true });

  // the server has it all (agents can read the list)
  await expect.poll(() => cli('items'), { timeout: 10000 }).toContain('Bissanzeiger | 2 | angeln');
  expect(cli('trips')).toContain('Norwegen');
  expect(errorsOf(page)).toEqual([]);
});

test('dark mode, settings, import as text', async ({ browser }) => {
  const page = await signUp(browser, 'Zweit', 'dark');
  await page.goto(BASE + '/#/einstellungen');
  await page.locator('textarea').fill('# Angeln\nKöderbox mit Spinnern | 1 | angeln\nZahnbürste | 1 | nacht');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('1 neu, 1 schon vorhanden.')).toBeVisible();
  await page.screenshot({ path: shots + 'settings-dark.png', fullPage: true });
  await page.goto(BASE + '/#/');
  await page.screenshot({ path: shots + 'home-dark.png' });
  await page.getByRole('link', { name: /Norwegen/ }).click();
  await expect(page.locator('.list').getByText('Köderbox mit Spinnern')).toBeVisible();
  await page.screenshot({ path: shots + 'trip-dark.png' });
  expect(errorsOf(page)).toEqual([]);
});
