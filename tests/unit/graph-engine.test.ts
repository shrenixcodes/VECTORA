import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type GraphIndex,
  Store,
  buildIndex,
  buildOverview,
  cyclePath,
  detectIntent,
  explore,
  exportArchitectureDoc,
  exportGraphML,
  exportJson,
  exportMarkdownAnalysis,
  extractSubject,
  findCycles,
  impactOf,
  shortestPath,
  stripSource,
  traverse,
} from '@vectora/graph-engine';
import { layout3d, seed2d } from '@vectora/graph-layout';
import type { KnowledgeGraph } from '@vectora/graph-schema';
import type { IndexResult } from '@vectora/repository-indexer';
import { SearchIndex, searchDocuments, splitIdentifier } from '@vectora/search';
import {
  type RepositoryRecord,
  SettingsSchema,
  defaultSettings,
  mergeSettings,
  redactDeep,
  redactSecrets,
} from '@vectora/shared';
import { indexSample, tempDir } from '../helpers';

let result: IndexResult;
let graph: KnowledgeGraph;
let index: GraphIndex;
let search: SearchIndex;
const repo: RepositoryRecord = {
  id: 'sample',
  name: 'Orbit Notes',
  sourceKind: 'sample',
  origin: 'sample',
  branch: null,
  subdirectory: null,
  status: 'ready',
  createdAt: '',
  lastIndexedAt: '2026-01-01T00:00:00Z',
  fileCount: 0,
  symbolCount: 0,
  relationshipCount: 0,
  error: null,
};

beforeAll(async () => {
  result = await indexSample();
  graph = result.graph;
  index = buildIndex(graph);
  search = new SearchIndex(graph.nodes);
});

describe('graph algorithms', () => {
  it('finds circular imports and a concrete cycle path', () => {
    const cycles = findCycles(index, ['IMPORTS'], (n) => n.type === 'File');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.sort()).toEqual(['file:web/src/cycle/a.ts', 'file:web/src/cycle/b.ts']);
    const p = cyclePath(index, cycles[0]!);
    expect(p).toHaveLength(2);
    expect(p[p.length - 1]!.target).toBe(p[0]!.source);
  });

  it('traverses downstream and upstream dependencies', () => {
    const down = traverse(index, 'sym:web/src/routes/notes.ts#listNotes', 'out', { maxDepth: 4 });
    expect([...down.distances.keys()]).toEqual(
      expect.arrayContaining([
        'sym:web/src/services/noteService.ts#NoteService.list',
        'sym:web/src/db/noteRepository.ts#NoteRepository.findByOwner',
      ]),
    );
    const up = traverse(index, 'sym:web/src/auth/session.ts#verifyToken', 'in', { maxDepth: 1 });
    expect([...up.distances.keys()]).toContain('sym:web/src/auth/middleware.ts#requireAuth');
  });

  it('computes shortest paths and impact', () => {
    const p = shortestPath(
      index,
      'sym:web/src/routes/notes.ts#route:GET /notes',
      'sym:web/src/db/schema.ts#notes',
    );
    expect(p?.map((e) => e.type)).toEqual(['ROUTES_TO', 'CALLS', 'CALLS', 'READS_FROM']);
    expect(shortestPath(index, 'sym:web/src/db/schema.ts#notes', 'sym:web/src/server.ts#start')).toBeNull();
    const impact = impactOf(index, 'sym:web/src/db/noteRepository.ts#NoteRepository');
    expect([...impact.distances.keys()]).toEqual(
      expect.arrayContaining([
        'sym:web/src/services/noteService.ts#NoteService',
        'sym:web/src/routes/notes.ts#listNotes',
      ]),
    );
  });
});

describe('search', () => {
  it('ranks exact names first, then prefixes and partial matches', () => {
    expect(search.search('verifyToken')[0]!.node.id).toBe('sym:web/src/auth/session.ts#verifyToken');
    expect(search.search('verify')[0]!.node.name).toBe('verifyToken');
    expect(search.search('token').map((h) => h.node.name)).toContain('verifyToken');
    expect(search.search('NoteService.create')[0]!.node.id).toBe(
      'sym:web/src/services/noteService.ts#NoteService.create',
    );
  });

  it('matches file paths, concepts, descriptions and filters by type', () => {
    expect(search.search('web/src/server.ts')[0]!.node.id).toBe('file:web/src/server.ts');
    expect(search.search('authentication')[0]!.node.type).toBe('Concept');
    expect(search.search('usage reports').map((h) => h.node.name)).toContain('ReportService');
    expect(search.search('note', { types: ['Class'] }).every((h) => h.node.type === 'Class')).toBe(true);
    expect(search.search('express').some((h) => h.node.type === 'Package')).toBe(true);
    expect(search.search('zzzznotthere')).toEqual([]);
    expect(search.search('')).toEqual([]);
  });

  it('splits identifiers and searches documentation text', () => {
    expect(splitIdentifier('HTTPServerConfig_v2')).toEqual(['http', 'server', 'config', 'v2']);
    const hits = searchDocuments(
      [{ path: 'README.md', content: '# Title\n\nIntro\n\n## Setup\nRun the installer here.\n' }],
      'installer',
    );
    expect(hits).toEqual([
      { path: 'README.md', line: 6, snippet: 'Run the installer here.', heading: 'Setup' },
    ]);
  });
});

describe('persistence', () => {
  it('stores and reloads repositories, graphs, analysis, cached facts and sessions', () => {
    const file = path.join(tempDir('store'), 'test.db');
    let store = new Store(file);
    store.insertRepository({
      ...repo,
      rootPath: 'D:/x',
      managedSource: false,
      createdAt: new Date().toISOString(),
    });
    store.saveGraph(repo.id, graph);
    store.setAnalysis(repo.id, result.analysis);
    store.saveFacts(repo.id, result.facts);
    store.saveSession(repo.id, {
      view: 'graph',
      selectedIds: ['file:a'],
      focusId: null,
      expandedIds: [],
      hiddenNodeTypes: [],
      hiddenEdgeTypes: ['EXPORTS'],
      layouts: { graph: { 'file:a': [1, 2] } },
      savedAt: 'now',
    });
    store.updateRepository(repo.id, { status: 'ready', symbolCount: 79 });
    store.close();

    store = new Store(file); // a new process would see the same data
    expect(store.listRepositories()).toHaveLength(1);
    expect(store.getRepository(repo.id)).toMatchObject({
      status: 'ready',
      symbolCount: 79,
      rootPath: 'D:/x',
    });
    const loaded = store.loadGraph(repo.id);
    expect(loaded.nodes.length).toBe(graph.nodes.length);
    expect(loaded.edges.length).toBe(graph.edges.length);
    expect(loaded.edges.find((e) => e.id === graph.edges[40]!.id)).toEqual(graph.edges[40]);
    expect(loaded.stats.unresolvedCount).toBe(result.analysis.unresolvedCount);
    expect(store.loadGraph(repo.id, { types: ['File'] }).nodes.every((n) => n.type === 'File')).toBe(true);
    expect(store.loadNodesByFile(repo.id, 'web/src/config.ts').nodes.map((n) => n.name)).toEqual(
      expect.arrayContaining(['loadConfig', 'AppConfig']),
    );
    expect(store.loadFacts(repo.id).size).toBe(result.facts.length);
    expect(store.getSession(repo.id)?.layouts.graph).toEqual({ 'file:a': [1, 2] });
    expect(store.countGraph(repo.id)).toEqual({ nodes: graph.nodes.length, edges: graph.edges.length });

    store.deleteRepository(repo.id);
    expect(store.listRepositories()).toEqual([]);
    expect(store.countGraph(repo.id)).toEqual({ nodes: 0, edges: 0 });
    expect(store.getSession(repo.id)).toBeNull();
    store.close();
  });

  it('persists settings, validates them and deletes all data on request', () => {
    const store = new Store(path.join(tempDir('store2'), 'test.db'));
    expect(store.getSettings()).toEqual(defaultSettings());
    const next = mergeSettings(store.getSettings(), {
      appearance: { theme: 'dark' },
      performance: { workerConcurrency: 2 },
    });
    store.saveSettings(next);
    expect(store.getSettings().appearance.theme).toBe('dark');
    expect(store.getSettings().performance).toMatchObject({ workerConcurrency: 2, indexingCache: true });
    expect(() => mergeSettings(next, { performance: { workerConcurrency: 999 } })).toThrow();
    expect(SettingsSchema.safeParse({ appearance: { theme: 'neon' } }).success).toBe(false);
    store.setCredential('github', 'v1:x:y:z');
    expect(store.listCredentials().map((c) => c.name)).toEqual(['github']);
    store.insertRepository({ ...repo, rootPath: 'x', managedSource: false });
    store.deleteAllData();
    expect(store.listRepositories()).toEqual([]);
    expect(store.listCredentials()).toEqual([]);
    expect(store.getSettings().appearance.theme).toBe('dark');
    store.close();
  });
});

describe('export', () => {
  it('exports JSON that preserves every node id and relationship', () => {
    const out = JSON.parse(exportJson(repo, graph)) as {
      nodes: { id: string }[];
      edges: { id: string; source: string; target: string; evidence: string }[];
      includesSource: boolean;
    };
    expect(out.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    expect(out.edges.map((e) => `${e.id}>${e.source}>${e.target}`).sort()).toEqual(
      graph.edges.map((e) => `${e.id}>${e.source}>${e.target}`).sort(),
    );
    expect(out.includesSource).toBe(false);
  });

  it('leaves repository source text out of exports unless it is requested', () => {
    const secretLine = "const token = 'token-' + userId";
    const without = exportJson(repo, graph);
    expect(without).not.toContain(secretLine);
    expect(without).not.toContain('Returns the session for a token');
    expect(exportGraphML(repo, graph)).not.toContain('verifyToken(req.headers');
    const withSource = exportJson(repo, graph, { includeSource: true });
    expect(withSource).toContain('verifyToken(req.headers');
    const stripped = stripSource(graph);
    expect(stripped.edges.find((e) => e.type === 'CALLS')!.evidence).toMatch(/^[\w./-]+:\d+$/);
    expect(stripped.nodes.length).toBe(graph.nodes.length);
  });

  it('exports well-formed GraphML with one element per node and edge', () => {
    const xml = exportGraphML(repo, graph, { includeSource: true });
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml.match(/<node id=/g)).toHaveLength(graph.nodes.length);
    expect(xml.match(/<edge id=/g)).toHaveLength(graph.edges.length);
    expect(xml).not.toMatch(/<(?!\/?(graphml|key|graph|node|edge|data|!--|\?xml))/);
    expect(xml).toContain('&lt;');
  });

  it('exports Markdown analysis and architecture documentation from the graph', () => {
    const overview = buildOverview(repo, graph, result.analysis, index);
    const md = exportMarkdownAnalysis(overview, graph, result.analysis);
    expect(md).toContain('# Orbit Notes — repository analysis');
    expect(md).toContain('| TypeScript |');
    expect(md).toContain('Unresolved references');
    const arch = exportArchitectureDoc(overview, graph, result.analysis);
    expect(arch).toContain('## API endpoints');
    expect(arch).toContain('`GET /notes`');
    expect(arch).toContain('## Circular dependencies');
    expect(arch).toContain('web/src/cycle/a.ts');
    expect(overview.architectureSummary.every((s) => s.evidence.length > 0)).toBe(true);
    expect(overview.languages.find((l) => l.language === 'TypeScript')?.analyzedFiles).toBe(14);
  });
});

describe('question exploration', () => {
  const find = (q: string, limit = 10) => search.search(q, { limit }).map((h) => h.node);
  const ask = (q: string) => explore(q, index, result.analysis, find);

  it('recognises intents and subjects', () => {
    expect(detectIntent('What calls verifyToken?')).toBe('callers');
    expect(detectIntent('Identify circular dependencies')).toBe('cycles');
    expect(detectIntent('What could be affected if I change this class?')).toBe('impact');
    expect(detectIntent('Explain the application startup sequence')).toBe('startup');
    expect(detectIntent('Show the complete database access path')).toBe('data-access');
    expect(detectIntent('Trace the login process')).toBe('trace');
    expect(detectIntent('Explain authentication')).toBe('explain');
    expect(extractSubject('What calls `verifyToken`?')).toBe('verifyToken');
    expect(extractSubject('Which modules depend on NoteRepository?')).toBe('NoteRepository');
  });

  it('answers with statements that cite files and lines', () => {
    const a = ask('What calls verifyToken?');
    expect(a.intent).toBe('callers');
    const call = a.statements.find((s) => s.text.includes('requireAuth'))!;
    expect(call.verified).toBe(true);
    expect(call.evidence[0]).toMatchObject({ path: 'web/src/auth/middleware.ts', startLine: 9 });
    expect(a.nodeIds).toEqual(
      expect.arrayContaining([
        'sym:web/src/auth/session.ts#verifyToken',
        'sym:web/src/auth/middleware.ts#requireAuth',
      ]),
    );
  });

  it('covers cycles, impact, traces, data access, startup and concepts', () => {
    expect(
      ask('Identify circular dependencies').statements.some((s) => s.text.includes('web/src/cycle/a.ts')),
    ).toBe(true);
    const impact = ask('What could be affected if I change NoteRepository?');
    expect(impact.statements.some((s) => s.text.includes('noteService.ts'))).toBe(true);
    expect(impact.caveats.length).toBeGreaterThan(0);
    const trace = ask('Trace GET /notes');
    expect(trace.statements.some((s) => s.text.includes('routes to') && s.text.includes('listNotes'))).toBe(
      true,
    );
    expect(
      ask('Show the complete database access path').statements.some(
        (s) => s.text.includes('reads from') && !s.verified,
      ),
    ).toBe(true);
    expect(ask('Explain the application startup sequence').statements[0]!.text).toContain(
      'web/src/server.ts',
    );
    const concept = ask('Explain authentication');
    expect(concept.title).toBe('Authentication');
    expect(concept.statements[0]!.verified).toBe(false);
    expect(concept.caveats.join(' ')).toMatch(/interpretation/);
  });

  it('says so when something cannot be found instead of inventing an answer', () => {
    const a = ask('What calls frobnicateWidget?');
    expect(a.statements).toEqual([]);
    expect(a.nodeIds).toEqual([]);
    expect(a.caveats[0]).toMatch(/Nothing in the indexed graph matches/);
  });
});

describe('layout', () => {
  it('computes a finite, deterministic 3D layout with the repository at the centre', () => {
    const nodes = graph.nodes.map((n) => ({
      id: n.id,
      role:
        n.type === 'Repository'
          ? ('repository' as const)
          : n.type === 'Subsystem'
            ? ('subsystem' as const)
            : n.type === 'Concept'
              ? ('concept' as const)
              : n.type === 'Package'
                ? ('package' as const)
                : n.type === 'File' || n.type === 'Configuration'
                  ? ('file' as const)
                  : n.type === 'Directory' || n.type === 'Module'
                    ? ('container' as const)
                    : ('symbol' as const),
      subsystem: (n.metadata.subsystem as string | undefined) ?? null,
      parent: n.filePath ? `file:${n.filePath}` : null,
    }));
    const edges = graph.edges
      .filter((e) => e.type === 'IMPORTS')
      .map((e) => ({ source: e.source, target: e.target }));
    const a = layout3d(nodes, edges);
    const b = layout3d(nodes, edges);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions).every(Number.isFinite)).toBe(true);
    const at = (id: string) => {
      const i = nodes.findIndex((n) => n.id === id) * 3;
      return [a.positions[i]!, a.positions[i + 1]!, a.positions[i + 2]!] as const;
    };
    expect(at('repo:root')).toEqual([0, 0, 0]);
    const dist = (p: readonly number[], q: readonly number[]) =>
      Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    // Subsystems sit on the anchor sphere; a file stays nearer to its own subsystem than to another one.
    expect(dist(at('sub:web'), [0, 0, 0])).toBeGreaterThan(a.radius * 0.9);
    expect(dist(at('file:web/src/server.ts'), at('sub:web'))).toBeLessThan(
      dist(at('file:web/src/server.ts'), at('sub:tools')),
    );
    // A symbol orbits its file.
    expect(dist(at('sym:web/src/config.ts#loadConfig'), at('file:web/src/config.ts'))).toBeLessThan(6);
  });

  it('seeds 2D positions grouped by cluster', () => {
    const seeds = seed2d([
      { id: 'a', group: 'x' },
      { id: 'b', group: 'x' },
      { id: 'c', group: 'y' },
    ]);
    const d = (p: string, q: string) =>
      Math.hypot(seeds.get(p)![0] - seeds.get(q)![0], seeds.get(p)![1] - seeds.get(q)![1]);
    expect(d('a', 'b')).toBeLessThan(d('a', 'c'));
  });
});

describe('secret redaction', () => {
  it('removes tokens, keys and URL credentials from diagnostic text', () => {
    const token = `ghp_${'a1B2'.repeat(9)}`;
    expect(redactSecrets(`failed for ${token}`)).not.toContain(token);
    expect(redactSecrets('Authorization: Bearer abc.def.ghi-123')).not.toContain('abc.def.ghi-123');
    expect(redactSecrets('https://user:hunter2pass@example.com/repo.git')).not.toContain('hunter2pass');
    expect(redactSecrets('api_key=sk-test1234567890abcdefghij')).not.toContain('sk-test1234567890abcdefghij');
    expect(redactSecrets('plain message about tokens in general')).toBe(
      'plain message about tokens in general',
    );
    expect(
      redactDeep({ user: 'a', token: 'secret-value', nested: { password: 'p4ssw0rd!', note: 'ok' } }),
    ).toEqual({ user: 'a', token: '[redacted]', nested: { password: '[redacted]', note: 'ok' } });
  });
});
