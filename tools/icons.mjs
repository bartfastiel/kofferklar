// Renders public/icon.svg once into PNGs (home screen icons) with Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  // full-bleed background: home screens apply their own mask
  await page.setContent(`<style>html,body{margin:0;background:#1f6f6b}svg{width:${size}px;height:${size}px;display:block}</style>${svg.replace('rx="112"', 'rx="0"')}`);
  await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, path: fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)) });
  await page.close();
}
await browser.close();
console.log('icons written');
