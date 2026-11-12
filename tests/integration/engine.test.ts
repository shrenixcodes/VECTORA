import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/local-engine/src/config';
import { parseGitHubUrl } from '../../apps/local-engine/src/github';
import {
  CredentialVault,
  extractZip,
  inspectZip,
  isZipFile,
  resolveInside,
  unsafeEntryReason,
} from '../../apps/local-engine/src/security';
import { buildServer } from '../../apps/local-engine/src/server';
import type { Engine } from '../../apps/local-engine/src/service';
import { SAMPLE, copySample, tempDir } from '../helpers';

const HOST = { host: 'localhost:4317' };
const TOKEN = `ghp_${'Zx9'.repeat(12)}`;

/** Reads every file under the sample into a map suitable for building a ZIP. */
function sampleEntries(prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string, rel: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(abs, r);
      else out[prefix + r] = fs.readFileSync(abs);
    }
  };
  walk(SAMPLE, '');
  return out;
}

function multipart(fileName: string, data: Uint8Array): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----vectoraTestBoundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(data), tail]),
    headers: { ...HOST, 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('local engine', () => {
  let app: FastifyInstance;
  let engine: Engine;
  let dataDir: string;
  const githubRequests: { url: string; auth: string | null }[] = [];
  let logs = '';

  // Stand-in for api.github.com so the GitHub import can be exercised without network access.
  const fakeGitHub: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    githubRequests.push({ url: req.url, auth: req.headers.get('authorization') });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.hostname !== 'api.github.com') return json({ message: 'unexpected host' }, 500);
    const authed = req.headers.get('authorization')?.includes(TOKEN) ?? false;
    if (url.pathname.startsWith('/repos/acme/private-notes') && !authed)
      return json({ message: 'Not Found' }, 404);
    const m = /^\/repos\/acme\/(orbit-notes|private-notes)(.*)$/.exec(url.pathname);
    if (!m) return json({ message: 'Not Found' }, 404);
    const [, name, rest] = m;
    if (rest === '')
      return json({
        name,
        full_name: `acme/${name}`,
        owner: { login: 'acme' },
        description: 'Sample',
        default_branch: 'main',
        private: name === 'private-notes',
        size: 120,
        html_url: `https://github.com/acme/${name}`,
      });
    if (rest === '/branches') return json([{ name: 'main' }, { name: 'develop' }]);
    if (rest!.startsWith('/zipball/'))
      return new Response(zipSync(sampleEntries(`acme-${name}-abc1234/`)), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    return json({ message: 'Not Found' }, 404);
  };

  const call = async (
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: payload as object,
      headers: { ...HOST, ...headers },
    });
    const type = String(res.headers['content-type'] ?? '');
    // Response bodies are loosely typed on purpose: each test asserts the shape it needs.
    return {
      status: res.statusCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: (type.includes('json') ? res.json() : res.body) as any,
      headers: res.headers,
    };
  };
  const waitFor = async (jobId: string) => {
    await engine.idle();
    return (await call('GET', `/api/jobs/${jobId}`)).body as unknown as {
      status: string;
      error: string | null;
      repositoryId: string;
      summary: { analyzedFiles: number; reusedFiles: number; incremental: boolean };
    };
  };

  beforeAll(async () => {
    dataDir = tempDir('engine-data');
    const built = await buildServer(loadConfig({ dataDir, logLevel: 'silent', fetch: fakeGitHub }));
    app = built.app;
    engine = built.engine;
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logs += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports health and supported languages', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', sampleAvailable: true });
    expect((r.body.languages as unknown as { id: string }[]).map((l) => l.id)).toContain('typescript');
  });

  let localId = '';
  let localDir = '';
  it('imports a local folder, indexes it and serves the graph', async () => {
    localDir = copySample('engine-local');
    const job = await call('POST', '/api/import/local', { path: localDir });
    expect(job.status).toBe(200);
    const done = await waitFor(job.body.id);
    expect(done).toMatchObject({ status: 'completed', error: null });
    localId = done.repositoryId;

    const repo = await call('GET', `/api/repositories/${localId}`);
    expect(repo.body).toMatchObject({ status: 'ready', sourceKind: 'local' });
    expect(repo.body.symbolCount).toBeGreaterThan(50);
    expect(repo.body).not.toHaveProperty('rootPath');

    const graph = await call('GET', `/api/repositories/${localId}/graph`);
    expect(graph.body.partial).toBe(false);
    expect((graph.body.nodes as unknown as unknown[]).length).toBe(graph.body.stats.nodeCount);
    const structure = await call('GET', `/api/repositories/${localId}/graph?detail=structure`);
    expect(structure.body.partial).toBe(true);
    expect((structure.body.nodes as unknown as { type: string }[]).some((n) => n.type === 'Function')).toBe(
      false,
    );
    const members = await call('GET', `/api/repositories/${localId}/members?path=web/src/config.ts`);
    expect((members.body.nodes as unknown as { name: string }[]).map((n) => n.name)).toContain('loadConfig');

    const overview = await call('GET', `/api/repositories/${localId}/overview`);
    expect((overview.body.subsystems as unknown as { name: string }[]).map((s) => s.name)).toContain('Web');
    const search = await call('GET', `/api/repositories/${localId}/search?q=verifyToken`);
    expect((search.body.results as unknown as { id: string }[])[0]!.id).toBe(
      'sym:web/src/auth/session.ts#verifyToken',
    );
    const docs = await call('GET', `/api/repositories/${localId}/docs`);
    expect((docs.body as unknown as { path: string }[])[0]!.path).toBe('README.md');
    const docSearch = await call('GET', `/api/repositories/${localId}/search?q=onboarding`);
    expect((docSearch.body.documents as unknown as unknown[]).length).toBeGreaterThan(0);
    const ask = await call('POST', `/api/repositories/${localId}/ask`, {
      question: 'What calls verifyToken?',
    });
    expect(
      (ask.body.statements as unknown as { evidence: { path: string }[] }[]).some(
        (s) => s.evidence[0]?.path === 'web/src/auth/middleware.ts',
      ),
    ).toBe(true);
    expect(ask.body.narrative).toBeUndefined();
  });

  it('serves original source for indexed files only', async () => {
    const ok = await call(
      'GET',
      `/api/repositories/${localId}/source?path=web/src/auth/session.ts&start=19&end=19`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.content).toContain('export function verifyToken');
    expect(ok.body).toMatchObject({ startLine: 19, endLine: 19, language: 'typescript' });
    for (const p of [
      '../../package.json',
      '..%2F..%2Fpackage.json',
      'C:/Windows/win.ini',
      '/etc/passwd',
      'ignored/skip.ts',
      'web/src/../../../package.json',
    ]) {
      const r = await call('GET', `/api/repositories/${localId}/source?path=${p}`);
      expect([400, 404], p).toContain(r.status);
    }
  });

  it('re-indexes incrementally and reflects changes on disk', async () => {
    const again = await waitFor((await call('POST', `/api/repositories/${localId}/reindex`, {})).body.id);
    expect(again.summary).toMatchObject({ analyzedFiles: 0, incremental: true });
    fs.appendFileSync(
      path.join(localDir, 'web/src/config.ts'),
      '\nexport function addedLater(): number {\n  return DEFAULT_PORT;\n}\n',
    );
    const changed = await waitFor((await call('POST', `/api/repositories/${localId}/reindex`, {})).body.id);
    expect(changed.summary.analyzedFiles).toBeGreaterThanOrEqual(1);
    expect(changed.summary.reusedFiles).toBeGreaterThan(20);
    const search = await call('GET', `/api/repositories/${localId}/search?q=addedLater`);
    expect((search.body.results as unknown as { name: string }[])[0]!.name).toBe('addedLater');
    const full = await waitFor(
      (await call('POST', `/api/repositories/${localId}/reindex`, { full: true })).body.id,
    );
    expect(full.summary.reusedFiles).toBe(0);
  });

  it('exports JSON, GraphML and Markdown without source unless asked', async () => {
    const json = await call('GET', `/api/repositories/${localId}/export/json`);
    expect(json.headers['content-disposition']).toMatch(/attachment; filename=".*\.vectora\.json"/);
    expect(json.body.includesSource).toBe(false);
    expect(JSON.stringify(json.body)).not.toContain('verifyToken(req.headers');
    const withSource = await call('GET', `/api/repositories/${localId}/export/json?includeSource=true`);
    expect(JSON.stringify(withSource.body)).toContain('verifyToken(req.headers');
    expect((await call('GET', `/api/repositories/${localId}/export/graphml`)).body).toContain('<graphml');
    expect((await call('GET', `/api/repositories/${localId}/export/markdown`)).body).toContain(
      'repository analysis',
    );
    expect((await call('GET', `/api/repositories/${localId}/export/architecture`)).body).toContain(
      'architecture',
    );
    expect((await call('GET', `/api/repositories/${localId}/export/exe`)).status).toBe(400);
  });

  it('saves and restores the workspace session and settings across a restart', async () => {
    const session = {
      view: 'atlas',
      selectedIds: ['sym:web/src/auth/session.ts#verifyToken'],
      focusId: null,
      expandedIds: ['file:web/src/auth/session.ts'],
      hiddenNodeTypes: ['Package'],
      hiddenEdgeTypes: ['EXPORTS'],
      layouts: { graph: { 'file:web/src/server.ts': [3.5, -2] }, mindmapCollapsed: ['sub:tools'] },
    };
    expect((await call('PUT', `/api/repositories/${localId}/session`, session)).status).toBe(204);
    expect(
      (await call('PUT', '/api/settings', { appearance: { theme: 'dark' }, graph: { defaultMode: 'atlas' } }))
        .body.graph.defaultMode,
    ).toBe('atlas');
    expect((await call('PUT', '/api/settings', { performance: { workerConcurrency: 0 } })).status).toBe(400);

    await app.close();
    const rebuilt = await buildServer(loadConfig({ dataDir, logLevel: 'silent', fetch: fakeGitHub }));
    app = rebuilt.app;
    engine = rebuilt.engine;

    const restored = await call('GET', `/api/repositories/${localId}/session`);
    expect(restored.body).toMatchObject(session);
    expect(restored.body.savedAt).toBeTruthy();
    expect((await call('GET', '/api/settings')).body.appearance.theme).toBe('dark');
    expect((await call('GET', `/api/repositories/${localId}/graph`)).body.stats.nodeCount).toBeGreaterThan(
      100,
    );
  });

  it('imports a ZIP archive: detects the nested root, extracts safely and indexes', async () => {
    const zip = zipSync({
      ...sampleEntries('orbit-notes-main/'),
      'orbit-notes-main/node_modules/left-pad/index.js': strToU8('module.exports = 1;'),
      'orbit-notes-main/logo.png': new Uint8Array([137, 80, 78, 71]),
    });
    const up = multipart('C:\\fakepath\\..\\orbit notes.zip', zip);
    const inspect = await call('POST', '/api/import/zip/inspect', up.payload, up.headers);
    expect(inspect.status).toBe(200);
    expect(inspect.body.fileName).toBe('orbit notes.zip');
    expect((inspect.body.roots as unknown as { path: string; markers: string[] }[])[0]).toMatchObject({
      path: 'orbit-notes-main',
    });
    expect(
      (inspect.body.tree as unknown as { path: string }[]).some((t) => t.path === 'orbit-notes-main/web'),
    ).toBe(true);

    const done = await waitFor(
      (await call('POST', '/api/import/zip', { uploadId: inspect.body.uploadId, root: 'orbit-notes-main' }))
        .body.id,
    );
    expect(done).toMatchObject({ status: 'completed', error: null });
    const repo = await call('GET', `/api/repositories/${done.repositoryId}`);
    expect(repo.body).toMatchObject({ sourceKind: 'zip', status: 'ready', origin: 'orbit notes.zip' });
    const graph = await call('GET', `/api/repositories/${done.repositoryId}/graph`);
    const ids = (graph.body.nodes as unknown as { id: string }[]).map((n) => n.id);
    expect(ids).toContain('file:web/src/server.ts');
    expect(ids.some((i) => i.includes('node_modules') || i.includes('logo.png'))).toBe(false);
    // Uploads are removed once extracted, and the source copy lives inside the data directory.
    expect(fs.readdirSync(path.join(dataDir, 'uploads'))).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, 'sources', done.repositoryId, 'web', 'src', 'server.ts'))).toBe(
      true,
    );
    expect((await call('POST', '/api/import/zip', { uploadId: inspect.body.uploadId })).status).toBe(404);

    expect((await call('DELETE', `/api/repositories/${done.repositoryId}`)).status).toBe(204);
    expect(fs.existsSync(path.join(dataDir, 'sources', done.repositoryId))).toBe(false);
  });

  it('rejects files that are not ZIP archives', async () => {
    const up = multipart('notes.zip', strToU8('this is plain text, not an archive'));
    const r = await call('POST', '/api/import/zip/inspect', up.payload, up.headers);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not a ZIP archive/i);
    expect(fs.readdirSync(path.join(dataDir, 'uploads'))).toEqual([]);
  });

  it('imports a public GitHub repository with branch selection and a subdirectory', async () => {
    const info = await call('POST', '/api/import/github/validate', {
      url: 'https://github.com/acme/orbit-notes/tree/develop/web',
    });
    expect(info.body).toMatchObject({
      fullName: 'acme/orbit-notes',
      defaultBranch: 'main',
      private: false,
      requested: { branch: 'develop', subdirectory: 'web' },
    });
    expect(info.body.branches).toEqual(['main', 'develop']);
    const done = await waitFor(
      (
        await call('POST', '/api/import/github', {
          url: 'https://github.com/acme/orbit-notes',
          branch: 'develop',
          subdirectory: 'web',
        })
      ).body.id,
    );
    expect(done).toMatchObject({ status: 'completed', error: null });
    const repo = await call('GET', `/api/repositories/${done.repositoryId}`);
    expect(repo.body).toMatchObject({
      sourceKind: 'github',
      branch: 'develop',
      subdirectory: 'web',
      origin: 'https://github.com/acme/orbit-notes',
    });
    const ids = (
      (await call('GET', `/api/repositories/${done.repositoryId}/graph`)).body.nodes as unknown as {
        id: string;
      }[]
    ).map((n) => n.id);
    expect(ids).toContain('file:src/server.ts');
    expect(ids.some((i) => i.startsWith('file:analytics/'))).toBe(false);
    expect(githubRequests.some((r) => r.url.includes('/zipball/develop'))).toBe(true);
  });

  it('reads a private GitHub repository only with a credential, which never appears in URLs, logs or responses', async () => {
    const denied = await call('POST', '/api/import/github/validate', { url: 'acme/private-notes' });
    expect(denied.status).toBe(404);
    expect(denied.body.error).toMatch(/private/);
    expect(
      (
        await call('POST', '/api/import/github/validate', {
          url: `https://${TOKEN}@github.com/acme/private-notes`,
        })
      ).body.error,
    ).toMatch(/credentials in the URL/);

    const allowed = await call('POST', '/api/import/github/validate', {
      url: 'acme/private-notes',
      token: TOKEN,
    });
    expect(allowed.body).toMatchObject({ private: true, usingStoredCredential: false });
    const done = await waitFor(
      (
        await call('POST', '/api/import/github', {
          url: 'git@github.com:acme/private-notes.git',
          token: TOKEN,
          rememberToken: true,
        })
      ).body.id,
    );
    expect(done).toMatchObject({ status: 'completed', error: null });

    // The stored credential is now used without sending it again.
    expect(
      (await call('POST', '/api/import/github/validate', { url: 'acme/private-notes' })).body
        .usingStoredCredential,
    ).toBe(true);
    const creds = await call('GET', '/api/credentials');
    expect(JSON.stringify(creds.body)).not.toContain(TOKEN);
    expect((creds.body as unknown as { name: string }[]).map((c) => c.name)).toEqual(['github']);

    expect(githubRequests.every((r) => !r.url.includes(TOKEN))).toBe(true);
    expect(githubRequests.some((r) => r.auth?.includes(TOKEN))).toBe(true);
    expect(logs).not.toContain(TOKEN);
    const everything = JSON.stringify([
      (await call('GET', '/api/repositories')).body,
      (await call('GET', `/api/repositories/${done.repositoryId}/export/json?includeSource=true`)).body,
      (await call('GET', '/api/settings')).body,
    ]);
    expect(everything).not.toContain(TOKEN);
    // Encrypted at rest: the database file does not contain the token in clear text.
    for (const f of fs.readdirSync(dataDir).filter((n) => n.startsWith('vectora.db')))
      expect(fs.readFileSync(path.join(dataDir, f)).includes(TOKEN)).toBe(false);

    expect((await call('DELETE', '/api/credentials/github')).status).toBe(204);
    expect((await call('POST', '/api/import/github/validate', { url: 'acme/private-notes' })).status).toBe(
      404,
    );
  });

  it('refuses requests from other hosts and origins', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/repositories', headers: { host: 'evil.example' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/repositories',
          headers: { host: 'localhost.evil.example:4317' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('GET', '/api/repositories', undefined, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await call('POST', '/api/import/sample', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(
      403,
    );
    expect(
      (await call('GET', '/api/repositories', undefined, { origin: 'http://localhost:5173' })).status,
    ).toBe(200);
    expect(
      (await call('GET', '/api/repositories', undefined, { origin: 'http://localhost:4317' })).status,
    ).toBe(200);
    const res = await call('GET', '/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates input and has no debug endpoints', async () => {
    expect((await call('GET', '/api/repositories/not-a-uuid/graph')).status).toBe(400);
    expect((await call('GET', '/api/repositories/00000000-0000-4000-8000-000000000000/graph')).status).toBe(
      404,
    );
    expect((await call('POST', '/api/import/local', { path: path.join(dataDir, 'sources') })).status).toBe(
      400,
    );
    expect(
      (await call('POST', '/api/import/local', { path: 'D:/definitely/not/a/real/folder' })).status,
    ).toBe(404);
    expect((await call('PUT', '/api/credentials/other', { value: 'x' })).status).toBe(400);
    for (const p of [
      '/api/debug',
      '/api/env',
      '/api/config',
      '/api/internal/state',
      '/.env',
      '/package.json',
      '/api/../package.json',
    ])
      expect((await call('GET', p)).status, p).toBe(404);
    // Unknown page paths only ever return the static application shell (when a build is present).
    const page = await call('GET', '/debug');
    expect([200, 404]).toContain(page.status);
    if (page.status === 200) expect(String(page.headers['content-type'])).toContain('text/html');
  });

  it('deletes all local data on request', async () => {
    expect((await call('GET', '/api/data')).body.repositories).toBeGreaterThan(0);
    expect((await call('DELETE', '/api/data')).status).toBe(204);
    expect((await call('GET', '/api/repositories')).body).toEqual([]);
    expect(fs.readdirSync(path.join(dataDir, 'sources'))).toEqual([]);
    expect(fs.existsSync(localDir)).toBe(true); // the user's own folder is never touched
  });
});

describe('archive and path safety', () => {
  const makeZip = (entries: Parameters<typeof zipSync>[0]) => {
    const file = path.join(tempDir('zip'), 'a.zip');
    fs.writeFileSync(file, zipSync(entries));
    return file;
  };

  it('classifies unsafe entry names', () => {
    for (const bad of [
      '../evil.txt',
      'a/../../evil.txt',
      '/etc/passwd',
      'C:/Windows/x',
      'a\\..\\..\\b',
      'nul',
      'a/CON.txt',
      'a/b<c>.txt',
      'x\u0000y',
      '',
      'trailing./file',
      `${'a'.repeat(300)}/b`,
    ])
      expect(unsafeEntryReason(bad), JSON.stringify(bad)).not.toBeNull();
    for (const ok of [
      'src/index.ts',
      'a/b/c.d.ts',
      '.github/workflows/ci.yml',
      'weird name (1).txt',
      'src/[id]/page.tsx',
    ])
      expect(unsafeEntryReason(ok), ok).toBeNull();
  });

  it('never writes outside the destination, whatever the archive contains', async () => {
    const dest = tempDir('zip-dest');
    const marker = path.join(path.dirname(dest), 'evil.txt');
    fs.rmSync(marker, { force: true });
    const file = makeZip({
      'good/a.ts': strToU8('export const a = 1;'),
      '../evil.txt': strToU8('pwned'),
      'good/../../evil.txt': strToU8('pwned'),
    });
    // The archive is either rejected as a whole or the unsafe entries are skipped.
    const result = await extractZip(file, dest).catch((e: Error) => e);
    expect(fs.existsSync(marker)).toBe(false);
    if (!(result instanceof Error)) expect(result.skipped.unsafe).toBeGreaterThan(0);
    const all = fs.readdirSync(dest, { recursive: true }) as string[];
    expect(all.every((f) => !f.includes('evil'))).toBe(true);
  });

  it('skips symbolic links, binaries, ignored folders and oversized files', async () => {
    const dest = tempDir('zip-dest2');
    const file = makeZip({
      'src/a.ts': strToU8('export const a = 1;'),
      'src/huge.ts': strToU8('x'.repeat(4096)),
      'link-to-secrets': [strToU8('/etc/shadow'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
      'node_modules/x/index.js': strToU8('1'),
      'img/logo.png': new Uint8Array([1, 2, 3]),
    });
    const r = await extractZip(file, dest, { limits: { maxFileBytes: 1024 } });
    expect(r.files).toBe(1);
    expect(r.skipped).toMatchObject({ symlinks: 1, ignored: 1, binary: 1, oversized: 1 });
    expect(fs.existsSync(path.join(dest, 'src', 'a.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'link-to-secrets'))).toBe(false);
  });

  it('enforces entry-count and size limits and rejects invalid archives', async () => {
    const many = makeZip(
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.ts`, strToU8('x')])),
    );
    await expect(
      inspectZip(many, { maxEntries: 10, maxTotalBytes: 1e9, maxFileBytes: 1e6, maxRatio: 100 }),
    ).rejects.toMatchObject({ code: 'too-many-entries' });
    const big = makeZip({ 'a.ts': strToU8('y'.repeat(5000)), 'b.ts': strToU8('y'.repeat(5000)) });
    await expect(
      inspectZip(big, { maxEntries: 100, maxTotalBytes: 6000, maxFileBytes: 1e6, maxRatio: 100 }),
    ).rejects.toMatchObject({ code: 'too-large' });
    const notZip = path.join(tempDir('zip'), 'fake.zip');
    fs.writeFileSync(notZip, 'PK but not really a zip file at all');
    expect(isZipFile(notZip)).toBe(false);
    await expect(inspectZip(notZip)).rejects.toMatchObject({ code: 'invalid-archive' });
    const truncated = path.join(tempDir('zip'), 'cut.zip');
    fs.writeFileSync(truncated, fs.readFileSync(many).subarray(0, 200));
    await expect(inspectZip(truncated)).rejects.toMatchObject({ code: 'invalid-archive' });
    const empty = makeZip({});
    await expect(inspectZip(empty)).rejects.toMatchObject({ code: 'empty' });
  });

  it('keeps resolved paths inside their root', () => {
    const root = path.resolve('D:/data/repo');
    expect(resolveInside(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'));
    for (const bad of ['../x', '../../x', 'a/../../x', 'C:/Windows', '/etc/passwd', 'a\u0000b'])
      expect(resolveInside(root, bad), bad).toBeNull();
  });

  it('encrypts credentials with authenticated encryption', () => {
    const dir = tempDir('vault');
    const vault = new CredentialVault(dir);
    const stored = vault.encrypt(TOKEN);
    expect(stored).not.toContain(TOKEN);
    expect(vault.encrypt(TOKEN)).not.toBe(stored); // fresh nonce every time
    expect(new CredentialVault(dir).decrypt(stored)).toBe(TOKEN);
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => vault.decrypt(tampered)).toThrow();
    expect(() => new CredentialVault(tempDir('vault2')).decrypt(stored)).toThrow();
  });

  it('parses GitHub references and refuses credentials in URLs', () => {
    expect(parseGitHubUrl('https://github.com/acme/orbit-notes')).toEqual({
      owner: 'acme',
      repo: 'orbit-notes',
      branch: null,
      subdirectory: null,
    });
    expect(parseGitHubUrl('https://github.com/acme/orbit-notes.git')).toMatchObject({ repo: 'orbit-notes' });
    expect(parseGitHubUrl('git@github.com:acme/orbit-notes.git')).toMatchObject({
      owner: 'acme',
      repo: 'orbit-notes',
    });
    expect(parseGitHubUrl('acme/orbit-notes')).toMatchObject({ owner: 'acme', repo: 'orbit-notes' });
    expect(parseGitHubUrl('https://github.com/acme/orbit-notes/tree/dev/packages/core')).toMatchObject({
      branch: 'dev',
      subdirectory: 'packages/core',
    });
    for (const bad of [
      '',
      'https://gitlab.com/a/b',
      'https://github.com/only-owner',
      'https://user:pass@github.com/a/b',
      'https://github.com/a/..',
      'a/b c',
      'https://github.com.evil.example/a/b',
    ])
      expect(() => parseGitHubUrl(bad), bad).toThrow();
  });
});
