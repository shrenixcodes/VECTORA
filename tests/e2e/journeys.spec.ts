import fs from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

/** Console errors and failed requests collected per test; a journey must finish with none. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`http ${r.status()} ${r.url()}`);
  });
  return problems;
}

let repoPath = '';

/** Opens the sample workspace, importing the sample the first time. */
async function openWorkspace(page: Page): Promise<void> {
  if (repoPath) {
    await page.goto(repoPath);
    await expect(page.getByTestId('overview')).toBeVisible();
    return;
  }
  await page.goto('/import');
  const existing = page.getByTestId('repo-link').first();
  await expect(page.getByTestId('import-sample')).toBeVisible();
  if (await existing.isVisible().catch(() => false)) await existing.click();
  else await page.getByTestId('import-sample').click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(page.getByTestId('overview')).toBeVisible();
  repoPath = new URL(page.url()).pathname;
}

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name, exact: true });

async function selectBySearch(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.getByTestId('palette-input').fill(query);
  await expect(page.getByTestId('palette-result').first()).toContainText(query);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette-input')).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test('landing page presents the brand and leads to the import screen @responsive', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/VECTORA/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Understand what connects.');
  await expect(page.getByText('Explore the hidden architecture of software.')).toBeVisible();
  for (const h of [
    'How it works',
    'One graph, three ways to read it',
    'Supported sources',
    'Your code stays on your machine',
  ])
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  // No horizontal scrolling at any width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Learn about VECTORA' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'Privacy principles' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: 'Explore a repository' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByRole('tab', { name: 'GitHub repository' })).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
});

test('repository import: three methods, validation messages and the sample import @responsive', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/import');
  // GitHub: a malformed reference is explained without leaving the page.
  await page.getByLabel('Repository URL').fill('https://gitlab.com/someone/project');
  await page.getByRole('button', { name: 'Check repository' }).click();
  await expect(page.getByRole('alert')).toContainText('Only github.com repositories are supported');
  // ZIP: a file that is not an archive is rejected with a reason.
  await page.getByRole('tab', { name: 'ZIP archive' }).click();
  await page
    .locator('#zip-file')
    .setInputFiles({
      name: 'notes.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('plain text pretending to be an archive'),
    });
  await expect(page.getByRole('alert')).toContainText('not a ZIP archive');
  // Local: a missing folder is reported.
  await page.getByRole('tab', { name: 'Local folder' }).click();
  await page.getByLabel('Folder on this machine').fill('D:\\this\\folder\\does\\not\\exist');
  await page.getByRole('button', { name: 'Index this folder' }).click();
  await expect(page.getByRole('alert')).toContainText('does not exist');
  await page.getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a folder' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await openWorkspace(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orbit Notes (sample)');
  const status = page.getByLabel('Repository status');
  await expect(status).toContainText('ready');
  await expect(status).toContainText('symbols');
  await expect(status).toContainText('relationships');
  await expect(page.getByText('Architecture summary')).toBeVisible();
  await expect(page.getByText(/circular import group found/)).toBeVisible();
  // The three failed attempts above answered with 4xx by design; nothing else may have gone wrong.
  expect(problems.filter((p) => !/status of 4\d\d/.test(p))).toEqual([]);
});

test('workspace navigation reaches every view @responsive', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);
  const views: [string, string][] = [
    ['Mind Map', 'mindmap'],
    ['Graph Explorer', 'graph-explorer'],
    ['3D Atlas', 'atlas'],
    ['Dependency Explorer', 'dependencies'],
    ['Search', 'search-view'],
    ['Documentation', 'documentation'],
    ['Settings', 'settings'],
    ['Overview', 'overview'],
  ];
  for (const [label, testId] of views) {
    await nav(page, label).click();
    await expect(page.getByTestId(testId).or(page.getByTestId('atlas-fallback')).first()).toBeVisible();
    await expect(nav(page, label)).toHaveAttribute('aria-current', 'page');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(problems).toEqual([]);
});

test('search, graph selection and node inspection with original source', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);
  await nav(page, 'Graph Explorer').click();
  await expect(page.getByTestId('graph-explorer').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();

  await selectBySearch(page, 'verifyToken');
  const inspector = page.getByTestId('inspector');
  await expect(inspector.getByTestId('inspector-name')).toHaveText('verifyToken');
  await expect(inspector).toContainText('web/src/auth/session.ts:19');
  await expect(inspector).toContainText('TypeScript compiler');
  await expect(inspector).toContainText('Verified from source');
  // The original source is shown, read from the repository.
  await expect(inspector.getByTestId('code-preview')).toContainText(
    'export function verifyToken(token: string): Session | null',
  );
  // Relationships with their evidence.
  await expect(inspector).toContainText('Incoming relationships');
  await inspector.getByRole('button', { name: 'Evidence for requireAuth' }).click();
  await expect(inspector).toContainText('const session = verifyToken(req.headers.authorization');
  await expect(inspector).toContainText('web/src/auth/middleware.ts:9');
  await expect(inspector).toContainText('Authentication'); // related concept

  // Tracing a relationship: follow the caller.
  await inspector.getByRole('button', { name: 'requireAuth', exact: true }).click();
  await expect(inspector.getByTestId('inspector-name')).toHaveText('requireAuth');

  // Focus mode and its exit.
  await inspector.getByRole('button', { name: 'Focus in graph' }).click();
  await expect(page.getByTestId('exit-focus')).toContainText('requireAuth');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('exit-focus')).toBeHidden();

  // Open the full source location.
  await inspector.getByRole('button', { name: 'Open source location' }).click();
  await expect(page.getByTestId('source-view')).toContainText('web/src/auth/middleware.ts');
  await expect(page.getByTestId('source-view').getByTestId('code-preview')).toContainText(
    'export function requireAuth',
  );

  // Filters: hiding a node type changes the node count shown in the toolbar.
  await nav(page, 'Graph Explorer').click();
  const count = async () =>
    Number(
      /([\d,]+) nodes/
        .exec((await page.getByRole('status').filter({ hasText: 'nodes' }).first().textContent()) ?? '')?.[1]
        ?.replace(/,/g, ''),
    );
  const before = await count();
  await page.getByTestId('filters-button').click();
  await page.getByRole('checkbox', { name: /^.?\s*Function/ }).uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(count).toBeLessThan(before);
  await page.getByTestId('filters-button').click();
  await page.getByRole('checkbox', { name: /^.?\s*Function/ }).check();
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('the three views share one graph and one selection', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);
  await nav(page, 'Graph Explorer').click();
  await selectBySearch(page, 'NoteRepository');
  await expect(page.getByTestId('inspector-name')).toHaveText('NoteRepository');
  const graphCount = await page.getByRole('status').filter({ hasText: 'nodes' }).first().textContent();

  // 3D Atlas: same selection, same graph size, breadcrumb to the selected node.
  await nav(page, '3D Atlas').click();
  await expect(page.getByTestId('inspector-name')).toHaveText('NoteRepository');
  const atlas = page.getByTestId('atlas');
  await expect(atlas.or(page.getByTestId('atlas-fallback')).first()).toBeVisible();
  if (await atlas.isVisible().catch(() => false)) {
    await expect(atlas.locator('canvas')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'nodes' }).first()).toHaveText(
      graphCount!.replace(/ — arranging$/, ''),
      { timeout: 20_000 },
    );
    const crumb = page.getByTestId('atlas-breadcrumb');
    await expect(crumb).toContainText('Orbit Notes (sample)');
    await expect(crumb).toContainText('Web');
    await expect(crumb).toContainText('noteRepository.ts');
    await expect(crumb.getByRole('button', { name: 'NoteRepository', exact: true })).toHaveAttribute(
      'aria-current',
      'location',
    );
    // Camera interaction: orbit by dragging, zoom with the wheel, then reset.
    const box = (await atlas.locator('canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await page.getByTestId('atlas-reset').click();
    // Selecting through a breadcrumb moves the shared selection.
    await crumb.getByRole('button', { name: 'noteRepository.ts', exact: true }).click();
    await expect(page.getByTestId('inspector-name')).toHaveText('noteRepository.ts');
    await page.getByRole('button', { name: 'Show connected neighbourhood' }).click();
    await expect(page.getByTestId('exit-focus')).toBeVisible();
    await page.getByRole('button', { name: 'Global view' }).click();
    await expect(page.getByTestId('exit-focus')).toBeHidden();
  } else {
    // Without WebGL the Atlas offers the 2D view instead of failing.
    await expect(page.getByTestId('atlas-fallback')).toContainText('2D Graph Explorer');
  }

  // Mind Map: the selection made elsewhere is revealed in the hierarchy.
  await selectBySearch(page, 'createSession');
  await nav(page, 'Mind Map').click();
  await expect(page.getByTestId('inspector-name')).toHaveText('createSession');
  const map = page.getByTestId('mindmap');
  await expect(
    map.getByTestId('mind-node').filter({ hasText: 'Orbit Notes (sample)' }).first(),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('mind map: expand, collapse, select, relationship overlay and SVG export', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);
  await nav(page, 'Mind Map').click();
  const map = page.getByTestId('mindmap');
  const nodes = map.getByTestId('mind-node');
  await expect(nodes.filter({ hasText: 'Analytics' })).toBeVisible();
  await map.getByRole('button', { name: 'Reset layout' }).click();
  await expect(nodes.filter({ hasText: 'models.py' })).toHaveCount(0);

  await map.getByRole('button', { name: /^Expand Analytics/ }).click();
  await map.getByRole('button', { name: /^Expand app,/ }).click();
  await expect(nodes.filter({ hasText: 'models.py' })).toBeVisible();
  await map.getByRole('button', { name: /^Expand models\.py/ }).click();
  await expect(nodes.filter({ hasText: /^.?\s*Event/ })).toBeVisible();

  await nodes.filter({ hasText: /^.?\s*Event/ }).click();
  await expect(page.getByTestId('inspector-name')).toHaveText('Event');
  await expect(page.getByTestId('inspector')).toContainText('Database model');

  // The branch root has scrolled out of view; its control still works from the keyboard.
  await map.getByRole('button', { name: /^Collapse Analytics/ }).press('Enter');
  await expect(nodes.filter({ hasText: 'models.py' })).toHaveCount(0);

  // Find and focus through the map's own search.
  await map.getByRole('searchbox', { name: 'Find in the mind map' }).fill('noteService');
  await page.keyboard.press('Enter');
  await expect(nodes.filter({ hasText: 'noteService.ts' })).toBeVisible();
  await map.getByRole('searchbox', { name: 'Find in the mind map' }).fill('');

  // Relationship overlay draws edges between the visible branches.
  const edgesBefore = await map.locator('.react-flow__edge').count();
  await map.getByTestId('mind-relation').selectOption('IMPORTS');
  await expect.poll(() => map.locator('.react-flow__edge').count()).toBeGreaterThan(edgesBefore);
  await map.getByTestId('mind-relation').selectOption('');

  const download = page.waitForEvent('download');
  await map.getByTestId('mind-export-svg').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('vectora-mindmap.svg');
  expect(problems).toEqual([]);
});

test('search view and questions answered with evidence', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);
  await nav(page, 'Search').click();
  await page.getByTestId('search-input').fill('session');
  const results = page.getByTestId('search-result');
  await expect(results.first()).toBeVisible();
  await expect(page.getByTestId('search-view')).toContainText('web/src/auth/session.ts');
  await page.getByTestId('search-input').fill('zzqqxx');
  await expect(page.getByTestId('search-view')).toContainText('Nothing matches');

  await page.getByRole('tab', { name: 'Ask about the repository' }).click();
  await page.getByTestId('ask-input').fill('What calls verifyToken?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = page.getByTestId('answer');
  await expect(answer).toContainText('Callers of verifyToken');
  await expect(answer).toContainText('requireAuth');
  await expect(answer.getByRole('button', { name: 'web/src/auth/middleware.ts:9' })).toBeVisible();

  await page.getByRole('button', { name: 'Identify circular dependencies' }).click();
  await expect(answer).toContainText('web/src/cycle/a.ts');
  // Something that does not exist is reported as not found, not answered.
  await page.getByTestId('ask-input').fill('What calls launchRocket?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(answer).toContainText('Nothing in the indexed graph matches');

  // Evidence links open the cited line.
  await page.getByTestId('ask-input').fill('What calls verifyToken?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await answer.getByRole('button', { name: 'web/src/auth/middleware.ts:9' }).click();
  await expect(page.getByTestId('source-view')).toContainText('line 9');

  // Dependency explorer lists cycles and unresolved references.
  await nav(page, 'Dependency Explorer').click();
  await expect(page.getByTestId('dependencies')).toContainText('express');
  await page.getByRole('tab', { name: /Circular imports/ }).click();
  await expect(page.getByTestId('dependencies')).toContainText('web/src/cycle/a.ts');
  await page.getByRole('tab', { name: /Unresolved references/ }).click();
  await expect(page.getByTestId('dependencies')).toContainText('undefined_function');

  await nav(page, 'Documentation').click();
  await expect(page.getByTestId('documentation')).toContainText('This is not a real product.');
  await page.getByRole('button', { name: 'Architecture', exact: true }).click();
  await expect(page.getByTestId('documentation')).toContainText('API endpoints');
  expect(problems).toEqual([]);
});

test('settings persist and take effect; themes; export; saved workspace is restored', async ({ page }) => {
  const problems = watch(page);
  await openWorkspace(page);

  // Theme: explicit dark, then light, each surviving a reload.
  await nav(page, 'Settings').click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(23, 24, 22)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(248, 247, 242)');

  // Node density changes what the graph shows.
  await page.getByLabel('Node density').selectOption('structure');
  await nav(page, 'Graph Explorer').click();
  await expect(page.getByRole('status').filter({ hasText: 'nodes' }).first()).toContainText(
    'symbols folded into their files',
  );
  await nav(page, 'Settings').click();
  await page.getByLabel('Node density').selectOption('full');
  await nav(page, 'Graph Explorer').click();
  await expect(page.getByRole('status').filter({ hasText: 'nodes' }).first()).not.toContainText('folded');

  // Reduced motion is applied to the document.
  await nav(page, 'Settings').click();
  await page.getByLabel('Reduced motion').selectOption('on');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByLabel('Reduced motion').selectOption('system');
  await page.getByLabel('Node density').selectOption('balanced');
  await expect(page.getByTestId('settings')).toContainText('Data folder');

  // Export: JSON graph keeps ids and leaves source text out by default.
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.vectora\.json$/);
  const exported = JSON.parse(fs.readFileSync((await file.path())!, 'utf8')) as {
    nodes: { id: string }[];
    edges: unknown[];
    includesSource: boolean;
  };
  expect(exported.includesSource).toBe(false);
  expect(exported.nodes.map((n) => n.id)).toContain('sym:web/src/auth/session.ts#verifyToken');
  expect(exported.edges.length).toBeGreaterThan(300);
  expect(JSON.stringify(exported)).not.toContain('verifyToken(req.headers');
  await page.keyboard.press('Escape');

  // Session: selection and expansion survive leaving and reopening the workspace.
  await nav(page, 'Graph Explorer').click();
  await selectBySearch(page, 'ReportService');
  await expect(page.getByTestId('inspector-name')).toHaveText('ReportService');
  await page.waitForResponse((r) => r.url().includes('/session') && r.request().method() === 'PUT');
  await page.goto('/import');
  await page.getByTestId('repo-link').first().click();
  await nav(page, 'Graph Explorer').click();
  await expect(page.getByTestId('inspector-name')).toHaveText('ReportService');
  expect(problems).toEqual([]);
});

test('keyboard access, landmarks and accessible names @responsive', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  // The first Tab stop is the skip link, and it moves focus to the content.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

  await openWorkspace(page);
  for (const view of ['', 'graph', 'mindmap', 'dependencies', 'search', 'settings']) {
    await page.goto(`${repoPath}/${view}`);
    await page.waitForLoadState('networkidle');
    const audit = await page.evaluate(() => {
      const name = (el: Element) =>
        (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim() ||
        (el.getAttribute('aria-labelledby') || (el as HTMLButtonElement).labels?.length ? 'labelled' : '');
      const unnamed = [...document.querySelectorAll('button, a[href], [role="tab"]')]
        .filter((el) => !name(el))
        .map((el) => el.outerHTML.slice(0, 120));
      const unlabelled = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
        .filter(
          (el) =>
            !(el as HTMLInputElement).labels?.length &&
            !el.getAttribute('aria-label') &&
            !el.getAttribute('aria-labelledby') &&
            !el.closest('label'),
        )
        .map((el) => el.outerHTML.slice(0, 120));
      return {
        unnamed,
        unlabelled,
        h1: document.querySelectorAll('h1').length,
        main: document.querySelectorAll('main').length,
        imagesWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      };
    });
    expect(audit, `view "${view}"`).toEqual({
      unnamed: [],
      unlabelled: [],
      h1: 1,
      main: 1,
      imagesWithoutAlt: 0,
    });
  }

  // Command palette: opens with the shortcut, traps focus, closes with Escape and returns to the page.
  await page.goto(`${repoPath}/search`);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search the repository' })).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Focus is visible on interactive elements.
  await nav(page, 'Overview').focus();
  const outline = await nav(page, 'Overview').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline === 'solid' || outline === 'auto').toBe(true);
  expect(problems).toEqual([]);
});

test('respects the reduced-motion preference of the system', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto('/');
  // With no stored choice the system colour scheme is followed.
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const duration = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--duration-ui').trim(),
  );
  expect(duration).toMatch(/^0(ms|s)$/);
  await page.goto(`${repoPath}/graph`);
  await expect(page.getByTestId('graph-explorer').locator('canvas').first()).toBeVisible();
  // The layout is computed in one step instead of settling on screen.
  await expect(page.getByRole('status').filter({ hasText: 'nodes' }).first()).not.toContainText('arranging');
  expect(problems).toEqual([]);
  await context.close();
});
