/**
 * Captures the screenshots used in the README from the real application:
 * the production build, the bundled sample repository, nothing staged.
 *
 *   npm run build
 *   npx tsx scripts/screenshots.ts
 *
 * Output: docs/screenshots/*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type Page, chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const dataDir = path.join(root, '.bench-tmp', 'screenshots-data');
const PORT = 4398;
const base = `http://localhost:${PORT}`;

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const engine = spawn(process.execPath, [path.join(root, 'dist', 'engine', 'server.mjs')], {
  cwd: root,
  stdio: 'ignore',
  env: {
    ...process.env,
    VECTORA_PORT: String(PORT),
    VECTORA_DATA_DIR: dataDir,
    VECTORA_LOG_LEVEL: 'warn',
    NODE_ENV: 'production',
  },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    await sleep(250);
  }
}

const api = async (method: string, url: string, body?: unknown) =>
  (
    await fetch(`${base}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  )
    .json()
    .catch(() => null);
const setTheme = (theme: 'light' | 'dark') =>
  api('PUT', '/api/settings', {
    appearance: { theme },
    graph: { nodeDensity: 'full', labelDensity: 'high' },
  });

const job = (await api('POST', '/api/import/sample')) as { id: string };
let repoId = '';
for (let i = 0; i < 120 && !repoId; i++) {
  const j = (await (await fetch(`${base}/api/jobs/${job.id}`)).json()) as {
    status: string;
    repositoryId: string;
  };
  if (j.status === 'completed') repoId = j.repositoryId;
  else await sleep(300);
}
if (!repoId) throw new Error('The sample repository was not indexed');

const browser = await chromium.launch({ channel: process.env.VECTORA_E2E_CHANNEL ?? 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const shot = async (name: string) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  ${name}.png`);
};
const select = async (p: Page, query: string) => {
  await p.keyboard.press('Control+k');
  await p.getByTestId('palette-input').fill(query);
  await p.getByTestId('palette-result').first().waitFor();
  await p.keyboard.press('Enter');
  await p.getByTestId('inspector-name').waitFor();
};
const w = (view: string) => `${base}/w/${repoId}/${view}`;

try {
  // ---- light theme -------------------------------------------------------
  await setTheme('light');
  await page.goto(base);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await sleep(1200);
  await shot('landing');

  await page.goto(w(''));
  await page.getByTestId('overview').waitFor();
  await sleep(600);
  await shot('overview');

  await page.goto(w('mindmap'));
  const map = page.getByTestId('mindmap');
  await map.getByTestId('mind-node').first().waitFor();
  await map.getByRole('button', { name: /^Expand Web/ }).click();
  await sleep(500);
  await map.getByRole('button', { name: /^Expand src,/ }).click();
  await sleep(500);
  await map.getByRole('button', { name: /^Expand auth,/ }).click();
  await sleep(500);
  await map.getByRole('button', { name: /^Expand session\.ts/ }).click();
  await sleep(700);
  await map.getByTestId('mind-node').filter({ hasText: 'verifyToken' }).click();
  await page.getByTestId('inspector-name').waitFor();
  await sleep(900);
  await shot('mind-map');

  await page.goto(w('search?mode=questions'));
  await page.getByTestId('ask-input').fill('What calls verifyToken?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByTestId('answer').waitFor();
  await sleep(400);
  await shot('questions');

  await page.goto(w('dependencies'));
  await page.getByTestId('dependencies').waitFor();
  await page.getByRole('tab', { name: /Execution flows/ }).click();
  await sleep(400);
  await shot('dependency-explorer');

  // ---- dark theme --------------------------------------------------------
  await setTheme('dark');
  await page.goto(w('graph'));
  await page.getByTestId('graph-explorer').locator('canvas').first().waitFor();
  await sleep(4500); // let the layout settle
  await select(page, 'NoteService');
  await sleep(2200);
  await shot('graph-explorer');

  await page.goto(w('atlas'));
  await page.getByTestId('atlas').locator('canvas').waitFor();
  // Start from the whole structure with nothing selected.
  await page.getByRole('button', { name: 'Global view' }).click();
  await sleep(3500);
  await shot('atlas');
  await select(page, 'NoteRepository');
  await sleep(2600);
  await shot('atlas-focus');

  // ---- recorded tour: frames for docs/screenshots/tour.gif ----------------
  if (process.argv.includes('--record')) {
    const frames = path.join(root, '.bench-tmp', 'tour-frames');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    let n = 0;
    // `hold` repeats a frame so that a still moment stays on screen for a while.
    const frame = async (hold = 1) => {
      const file = path.join(frames, `${String(n++).padStart(4, '0')}-${hold}.png`);
      await page.screenshot({ path: file });
    };
    const burst = async (count: number, gap = 70) => {
      for (let i = 0; i < count; i++) {
        await frame();
        await sleep(gap);
      }
    };
    await page.goto(w('atlas'));
    await page.getByRole('button', { name: 'Global view' }).click();
    const canvas = page.getByTestId('atlas').locator('canvas');
    await canvas.waitFor();
    await sleep(3000);
    await frame(8);
    // Orbit the whole structure.
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 220, cy);
    await page.mouse.down();
    for (let i = 1; i <= 26; i++) {
      await page.mouse.move(cx - 220 + i * 17, cy + Math.sin(i / 5) * 26);
      await sleep(40);
      await frame();
    }
    await page.mouse.up();
    await frame(5);
    // Search for a symbol and fly to it.
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').waitFor();
    await frame(3);
    for (const part of ['Note', 'NoteServ', 'NoteService']) {
      await page.getByTestId('palette-input').fill(part);
      await sleep(260);
      await frame(2);
    }
    await page.getByTestId('palette-result').first().waitFor();
    await frame(6);
    await page.keyboard.press('Enter');
    await burst(14);
    await frame(12);
    // The same selection in the 2D graph.
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByRole('link', { name: 'Graph Explorer', exact: true })
      .click();
    await page.getByTestId('graph-explorer').locator('canvas').first().waitFor();
    await burst(22, 110);
    await frame(12);
    // And in the mind map.
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByRole('link', { name: 'Mind Map', exact: true })
      .click();
    await page.getByTestId('mindmap').getByTestId('mind-node').first().waitFor();
    await burst(8, 90);
    await frame(14);
    console.log(`  ${n} tour frames in ${path.relative(root, frames)}`);
  }
} finally {
  await browser.close();
  engine.kill();
}
console.log(`Screenshots written to ${path.relative(root, out)}`);
