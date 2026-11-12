/**
 * Stages 4 and 5 — execution flows and semantic organisation.
 *
 * Everything produced here is a derived interpretation and is marked as such:
 * subsystem membership comes from repository layout, concept membership from
 * identifier and path evidence. Nothing in this stage alters verified facts.
 */
import { type GraphEdge, type GraphNode, edgeId, isSymbolType, nodeId } from '@vectora/graph-schema';
import { slugify } from '@vectora/shared';
import type { ManifestInfo } from './manifests';

export interface ExecutionFlow {
  id: string;
  name: string;
  kind: 'request' | 'startup';
  /** Ordered node ids from the entry to the deepest reached node. */
  steps: string[];
  reachesData: boolean;
}

export interface EntryPoint {
  path: string;
  nodeId: string;
  reason: string;
}

export interface OrganizeOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoints: EntryPoint[];
  flows: ExecutionFlow[];
}

const CONCEPTS: { key: string; name: string; terms: string[]; description: string }[] = [
  {
    key: 'authentication',
    name: 'Authentication',
    terms: [
      'auth',
      'authentication',
      'authorize',
      'authorization',
      'login',
      'logout',
      'signin',
      'signup',
      'session',
      'jwt',
      'oauth',
      'password',
      'credential',
      'credentials',
      'permission',
      'token',
    ],
    description: 'Identity, sessions and access control.',
  },
  {
    key: 'user-management',
    name: 'User management',
    terms: [
      'user',
      'users',
      'account',
      'accounts',
      'profile',
      'member',
      'role',
      'roles',
      'registration',
      'register',
    ],
    description: 'User accounts, profiles and roles.',
  },
  {
    key: 'payments',
    name: 'Payment processing',
    terms: [
      'payment',
      'payments',
      'billing',
      'invoice',
      'checkout',
      'stripe',
      'subscription',
      'cart',
      'order',
      'orders',
      'refund',
      'price',
      'pricing',
    ],
    description: 'Orders, billing and payment handling.',
  },
  {
    key: 'data-storage',
    name: 'Database management',
    terms: [
      'database',
      'db',
      'repository',
      'repositories',
      'model',
      'models',
      'schema',
      'migration',
      'migrations',
      'query',
      'orm',
      'sql',
      'sqlite',
      'postgres',
      'mongo',
      'persistence',
      'storage',
      'store',
      'entity',
      'entities',
    ],
    description: 'Persistence, models and data access.',
  },
  {
    key: 'api-layer',
    name: 'API layer',
    terms: [
      'api',
      'route',
      'routes',
      'router',
      'controller',
      'controllers',
      'endpoint',
      'endpoints',
      'handler',
      'handlers',
      'rest',
      'graphql',
      'middleware',
      'server',
      'http',
      'request',
      'response',
    ],
    description: 'Request handling and service interfaces.',
  },
  {
    key: 'interface',
    name: 'Frontend rendering',
    terms: [
      'component',
      'components',
      'view',
      'views',
      'page',
      'pages',
      'ui',
      'render',
      'layout',
      'widget',
      'template',
      'templates',
      'hook',
      'hooks',
      'screen',
      'theme',
      'style',
      'styles',
    ],
    description: 'User interface components and presentation.',
  },
  {
    key: 'configuration',
    name: 'Configuration',
    terms: ['config', 'configuration', 'settings', 'env', 'options', 'preferences'],
    description: 'Settings and environment configuration.',
  },
  {
    key: 'infrastructure',
    name: 'Infrastructure',
    terms: [
      'docker',
      'deploy',
      'deployment',
      'ci',
      'k8s',
      'kubernetes',
      'terraform',
      'infra',
      'infrastructure',
      'pipeline',
      'build',
      'release',
      'workflow',
      'workflows',
    ],
    description: 'Build, deployment and operations.',
  },
  {
    key: 'testing',
    name: 'Testing',
    terms: ['test', 'tests', 'spec', 'mock', 'mocks', 'fixture', 'fixtures', 'e2e', 'benchmark'],
    description: 'Automated tests and fixtures.',
  },
  {
    key: 'messaging',
    name: 'Messaging and events',
    terms: [
      'queue',
      'event',
      'events',
      'pubsub',
      'kafka',
      'email',
      'mail',
      'notification',
      'notifications',
      'webhook',
      'message',
      'broker',
      'worker',
      'job',
      'jobs',
    ],
    description: 'Asynchronous work, events and notifications.',
  },
  {
    key: 'search',
    name: 'Search',
    terms: ['search', 'index', 'indexer', 'indexing', 'lookup', 'ranking'],
    description: 'Indexing and retrieval.',
  },
  {
    key: 'caching',
    name: 'Caching',
    terms: ['cache', 'caching', 'redis', 'memo', 'memoize'],
    description: 'Caches and memoisation.',
  },
  {
    key: 'observability',
    name: 'Logging and monitoring',
    terms: ['log', 'logger', 'logging', 'telemetry', 'metrics', 'tracing', 'monitor', 'monitoring'],
    description: 'Logs, metrics and diagnostics.',
  },
  {
    key: 'parsing',
    name: 'Parsing and analysis',
    terms: [
      'parser',
      'parse',
      'ast',
      'lexer',
      'tokenizer',
      'compiler',
      'analyzer',
      'analysis',
      'adapter',
      'adapters',
      'grammar',
      'syntax',
    ],
    description: 'Parsing, syntax trees and static analysis.',
  },
  {
    key: 'visualization',
    name: 'Visualisation',
    terms: [
      'graph',
      'chart',
      'canvas',
      'visualization',
      'visualisation',
      'plot',
      'diagram',
      'scene',
      'camera',
      'atlas',
      'mindmap',
    ],
    description: 'Graphs, charts and visual rendering.',
  },
  {
    key: 'security',
    name: 'Security',
    terms: [
      'security',
      'crypto',
      'encrypt',
      'encryption',
      'decrypt',
      'hash',
      'sanitize',
      'csrf',
      'cors',
      'secret',
      'secrets',
      'redact',
    ],
    description: 'Cryptography and input protection.',
  },
  {
    key: 'import-export',
    name: 'Import and export',
    terms: [
      'import',
      'importer',
      'export',
      'exporter',
      'upload',
      'download',
      'archive',
      'zip',
      'serialize',
      'serializer',
    ],
    description: 'Moving data in and out of the system.',
  },
];

const tokenize = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);

const pretty = (s: string): string =>
  s
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/** Chooses the directory prefixes that act as subsystems. */
export function chooseSubsystemRoots(
  filePaths: string[],
  manifests: ManifestInfo,
): { key: string; name: string; dir: string }[] {
  const code = filePaths;
  const workspace = manifests.workspacePackages.filter(
    (p) => p.dir !== '' && code.some((f) => f.startsWith(`${p.dir}/`)),
  );
  if (workspace.length >= 2) {
    return workspace
      .filter((p, _, all) => !all.some((o) => o !== p && p.dir.startsWith(`${o.dir}/`)))
      .map((p) => ({ key: p.dir, name: pretty(p.dir.split('/').pop()!), dir: p.dir }));
  }
  // Descend through wrapper directories (`src/`, `lib/`, a single package dir) that hold nearly everything.
  let base = '';
  for (let depth = 0; depth < 4; depth++) {
    const counts = new Map<string, number>();
    let direct = 0;
    let total = 0;
    for (const f of code) {
      if (base && !f.startsWith(`${base}/`)) continue;
      total++;
      const rest = base ? f.slice(base.length + 1) : f;
      const i = rest.indexOf('/');
      if (i === -1) direct++;
      else counts.set(rest.slice(0, i), (counts.get(rest.slice(0, i)) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[1] >= total * 0.8 && direct <= total * 0.15 && counts.size <= 4)
      base = base ? `${base}/${dominant[0]}` : dominant[0];
    else break;
  }
  const groups = new Map<string, number>();
  for (const f of code) {
    if (base && !f.startsWith(`${base}/`)) {
      const top = f.includes('/') ? f.slice(0, f.indexOf('/')) : '';
      if (top) groups.set(top, (groups.get(top) ?? 0) + 1);
      continue;
    }
    const rest = base ? f.slice(base.length + 1) : f;
    const i = rest.indexOf('/');
    if (i !== -1) {
      const dir = base ? `${base}/${rest.slice(0, i)}` : rest.slice(0, i);
      groups.set(dir, (groups.get(dir) ?? 0) + 1);
    }
  }
  return [...groups.entries()]
    .filter(([dir]) => !dir.startsWith('.'))
    .map(([dir]) => ({ key: dir, name: pretty(dir.split('/').pop()!), dir }));
}

export function organize(
  repositoryId: string,
  repositoryName: string,
  baseNodes: GraphNode[],
  baseEdges: GraphEdge[],
  manifests: ManifestInfo,
): OrganizeOutput {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byId = new Map(baseNodes.map((n) => [n.id, n]));
  const fileNodes = baseNodes.filter((n) => n.type === 'File' || n.type === 'Configuration');
  const repoId = nodeId.repository();

  // ---- subsystems (structural grouping) ----------------------------------
  const roots = chooseSubsystemRoots(
    fileNodes.map((n) => n.filePath!),
    manifests,
  ).sort((a, b) => b.dir.length - a.dir.length);
  const subsystemOfFile = new Map<string, string>();
  const subsystemFiles = new Map<string, number>();
  const rootKey = '__root__';
  for (const f of fileNodes) {
    const p = f.filePath!;
    const root = roots.find((r) => p.startsWith(`${r.dir}/`));
    const key = root?.key ?? rootKey;
    subsystemOfFile.set(f.id, key);
    subsystemFiles.set(key, (subsystemFiles.get(key) ?? 0) + 1);
  }
  const subsystemIds = new Map<string, string>();
  for (const [key, count] of subsystemFiles) {
    const root = roots.find((r) => r.key === key);
    const id = nodeId.subsystem(key === rootKey ? 'root' : key);
    subsystemIds.set(key, id);
    nodes.push({
      id,
      name: root ? root.name : `${repositoryName} root`,
      type: 'Subsystem',
      repositoryId,
      filePath: root?.dir ?? '',
      location: null,
      language: null,
      description: root ? `Files under ${root.dir}/` : 'Files at the top level of the repository.',
      metadata: { files: count, derived: true, basis: 'directory layout' },
      extractionMethod: 'structural-grouping',
      confidence: 0.9,
      verified: true,
    });
    edges.push({
      id: edgeId('CONTAINS', repoId, id),
      source: repoId,
      target: id,
      type: 'CONTAINS',
      evidence: root ? `Directory ${root.dir}/ holds ${count} files` : `${count} top-level files`,
      location: null,
      extractionMethod: 'structural-grouping',
      confidence: 0.9,
      verified: true,
    });
  }
  for (const f of fileNodes) {
    const key = subsystemOfFile.get(f.id)!;
    const sid = subsystemIds.get(key)!;
    f.metadata.subsystem = sid;
    edges.push({
      id: edgeId('BELONGS_TO', f.id, sid),
      source: f.id,
      target: sid,
      type: 'BELONGS_TO',
      evidence: key === rootKey ? `${f.filePath} is a top-level file` : `${f.filePath} is under ${key}/`,
      location: null,
      extractionMethod: 'structural-grouping',
      confidence: 0.9,
      verified: true,
    });
  }
  // Symbols inherit the subsystem of their file (used for clustering in the views).
  const fileOf = (n: GraphNode): GraphNode | undefined =>
    n.filePath ? byId.get(nodeId.file(n.filePath)) : undefined;
  for (const n of baseNodes) if (isSymbolType(n.type)) n.metadata.subsystem = fileOf(n)?.metadata.subsystem;

  // ---- aggregated subsystem dependencies ---------------------------------
  const subOfNode = (id: string): string | undefined => {
    const n = byId.get(id);
    if (!n) return undefined;
    return (n.metadata.subsystem as string | undefined) ?? undefined;
  };
  const agg = new Map<string, { count: number; example: GraphEdge; kinds: Record<string, number> }>();
  for (const e of baseEdges) {
    if (
      ![
        'IMPORTS',
        'CALLS',
        'USES',
        'EXTENDS',
        'IMPLEMENTS',
        'INSTANTIATES',
        'READS_FROM',
        'WRITES_TO',
      ].includes(e.type)
    )
      continue;
    const a = subOfNode(e.source);
    const b = subOfNode(e.target);
    if (!a || !b || a === b) continue;
    e.metadata = { ...(e.metadata ?? {}), crossSubsystem: true };
    const key = `${a}|${b}`;
    const cur = agg.get(key);
    if (cur) {
      cur.count++;
      cur.kinds[e.type] = (cur.kinds[e.type] ?? 0) + 1;
    } else agg.set(key, { count: 1, example: e, kinds: { [e.type]: 1 } });
  }
  for (const [key, v] of agg) {
    const [a, b] = key.split('|') as [string, string];
    const ex = v.example;
    edges.push({
      id: edgeId('DEPENDS_ON', a, b),
      source: a,
      target: b,
      type: 'DEPENDS_ON',
      evidence: `${v.count} cross-subsystem relationship${v.count === 1 ? '' : 's'}, e.g. ${ex.location ? `${ex.location.path}:${ex.location.startLine}` : ex.source} — ${ex.evidence}`,
      location: ex.location,
      extractionMethod: 'aggregation',
      confidence: 1,
      verified: true,
      metadata: { count: v.count, kinds: v.kinds },
    });
  }

  // ---- concepts (keyword evidence) ---------------------------------------
  const symbolsByFile = new Map<string, GraphNode[]>();
  for (const n of baseNodes) {
    if (!isSymbolType(n.type) || !n.filePath) continue;
    const fid = nodeId.file(n.filePath);
    (symbolsByFile.get(fid) ?? symbolsByFile.set(fid, []).get(fid)!).push(n);
  }
  const importsByFile = new Map<string, string[]>();
  for (const e of baseEdges) {
    if (e.type !== 'IMPORTS' || !e.target.startsWith('pkg:')) continue;
    (importsByFile.get(e.source) ?? importsByFile.set(e.source, []).get(e.source)!).push(e.target.slice(4));
  }
  const termIndex = new Map<string, number[]>();
  CONCEPTS.forEach((c, i) =>
    c.terms.forEach((t) => (termIndex.get(t) ?? termIndex.set(t, []).get(t)!).push(i)),
  );
  const members: { fileId: string; score: number; evidence: string[] }[][] = CONCEPTS.map(() => []);

  for (const f of fileNodes) {
    const p = f.filePath!;
    const scores = new Map<number, { score: number; evidence: string[] }>();
    const hit = (ci: number, weight: number, ev: string) => {
      const s = scores.get(ci) ?? { score: 0, evidence: [] };
      s.score += weight;
      if (s.evidence.length < 6 && !s.evidence.includes(ev)) s.evidence.push(ev);
      scores.set(ci, s);
    };
    const segs = p.split('/');
    segs.forEach((seg, i) => {
      for (const t of new Set(tokenize(seg)))
        for (const ci of termIndex.get(t) ?? [])
          hit(ci, i === segs.length - 1 ? 2 : 3, `path segment "${seg}"`);
    });
    const seenSym = new Set<string>();
    for (const s of symbolsByFile.get(f.id) ?? []) {
      if (s.type === 'ApiEndpoint')
        hit(
          CONCEPTS.findIndex((c) => c.key === 'api-layer'),
          4,
          `defines endpoint ${s.name}`,
        );
      else if (s.type === 'DatabaseModel')
        hit(
          CONCEPTS.findIndex((c) => c.key === 'data-storage'),
          4,
          `defines model ${s.name}`,
        );
      else if (s.type === 'Component')
        hit(
          CONCEPTS.findIndex((c) => c.key === 'interface'),
          2,
          `defines component ${s.name}`,
        );
      for (const t of new Set(tokenize(s.name))) {
        for (const ci of termIndex.get(t) ?? []) {
          const k = `${ci}:${s.name}`;
          if (seenSym.has(k)) continue;
          seenSym.add(k);
          hit(ci, 1, `symbol ${s.name}`);
        }
      }
    }
    for (const pkg of importsByFile.get(f.id) ?? [])
      for (const t of new Set(tokenize(pkg)))
        for (const ci of termIndex.get(t) ?? []) hit(ci, 1, `imports ${pkg}`);
    if (f.metadata.test)
      hit(
        CONCEPTS.findIndex((c) => c.key === 'testing'),
        4,
        'test file naming convention',
      );
    for (const [ci, s] of scores)
      if (s.score >= 3) members[ci]!.push({ fileId: f.id, score: s.score, evidence: s.evidence });
  }

  const conceptOfFile = new Map<string, string[]>();
  CONCEPTS.forEach((c, i) => {
    const m = members[i]!;
    if (m.length < 2 && !(m.length === 1 && m[0]!.score >= 6)) return;
    const id = nodeId.concept(c.key);
    nodes.push({
      id,
      name: c.name,
      type: 'Concept',
      repositoryId,
      filePath: null,
      location: null,
      language: null,
      description: c.description,
      metadata: { files: m.length, derived: true, basis: 'identifier and path evidence', terms: c.terms },
      extractionMethod: 'keyword-evidence',
      confidence: 0.6,
      verified: false,
    });
    edges.push({
      id: edgeId('CONTAINS', repoId, id),
      source: repoId,
      target: id,
      type: 'CONTAINS',
      evidence: `${m.length} files carry evidence for "${c.name}"`,
      location: null,
      extractionMethod: 'keyword-evidence',
      confidence: 0.6,
      verified: false,
    });
    for (const mem of m) {
      const fn = byId.get(mem.fileId)!;
      (conceptOfFile.get(mem.fileId) ?? conceptOfFile.set(mem.fileId, []).get(mem.fileId)!).push(id);
      edges.push({
        id: edgeId('BELONGS_TO', mem.fileId, id),
        source: mem.fileId,
        target: id,
        type: 'BELONGS_TO',
        evidence: mem.evidence.join('; '),
        location: fn.location,
        extractionMethod: 'keyword-evidence',
        confidence: Math.min(0.9, 0.4 + mem.score * 0.05),
        verified: false,
        metadata: { score: mem.score },
      });
    }
  });
  for (const [fid, concepts] of conceptOfFile) byId.get(fid)!.metadata.concepts = concepts;

  // Concepts that reference each other through verified relationships.
  const conceptLinks = new Map<string, { count: number; example: GraphEdge }>();
  for (const e of baseEdges) {
    if (!['IMPORTS', 'CALLS', 'USES', 'INSTANTIATES', 'EXTENDS'].includes(e.type)) continue;
    const sf = byId.get(e.source)?.filePath;
    const tf = byId.get(e.target)?.filePath;
    if (!sf || !tf || sf === tf) continue;
    const sc = conceptOfFile.get(nodeId.file(sf));
    const tc = conceptOfFile.get(nodeId.file(tf));
    if (!sc || !tc) continue;
    for (const a of sc)
      for (const b of tc) {
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const cur = conceptLinks.get(key);
        if (cur) cur.count++;
        else conceptLinks.set(key, { count: 1, example: e });
      }
  }
  for (const [key, v] of conceptLinks) {
    if (v.count < 3) continue;
    const [a, b] = key.split('|') as [string, string];
    edges.push({
      id: edgeId('RELATED_TO', a, b),
      source: a,
      target: b,
      type: 'RELATED_TO',
      evidence: `${v.count} relationships connect files of both concepts, e.g. ${v.example.location ? `${v.example.location.path}:${v.example.location.startLine}` : ''} — ${v.example.evidence}`,
      location: v.example.location,
      extractionMethod: 'aggregation',
      confidence: 0.5,
      verified: false,
      metadata: { count: v.count },
    });
  }

  // ---- entry points -------------------------------------------------------
  const entryPoints: EntryPoint[] = [];
  const seenEntry = new Set<string>();
  const addEntry = (p: string, reason: string) => {
    const id = nodeId.file(p);
    const n = byId.get(id);
    if (!n || seenEntry.has(p)) return;
    seenEntry.add(p);
    n.metadata.entryPoint = reason;
    entryPoints.push({ path: p, nodeId: id, reason });
  };
  for (const e of manifests.declaredEntryPoints) addEntry(e.path, `declared in ${e.reason}`);
  const importers = new Map<string, number>();
  const importsOut = new Map<string, number>();
  for (const e of baseEdges) {
    if (e.type !== 'IMPORTS' || !e.target.startsWith('file:')) continue;
    importers.set(e.target, (importers.get(e.target) ?? 0) + 1);
    importsOut.set(e.source, (importsOut.get(e.source) ?? 0) + 1);
  }
  const ENTRY_NAME =
    /^(main|index|app|server|cli|__main__|manage|wsgi|asgi|program|application|start|run)\.(ts|tsx|js|mjs|cjs|py|go|rs|java|cs|c|cpp)$/i;
  for (const f of fileNodes) {
    if (f.metadata.test || !f.metadata.analyzed) continue;
    const p = f.filePath!;
    const base = p.slice(p.lastIndexOf('/') + 1);
    const depth = p.split('/').length;
    const hasMain = (symbolsByFile.get(f.id) ?? []).some(
      (s) => s.name === 'main' && !s.metadata.qualifiedName?.toString().includes('.'),
    );
    if (hasMain && /\.(go|rs|c|cpp|java|cs|py)$/.test(p)) addEntry(p, 'defines a main function');
    else if (ENTRY_NAME.test(base) && depth <= 4 && !importers.has(f.id) && (importsOut.get(f.id) ?? 0) > 0)
      addEntry(p, 'conventional entry file that nothing else imports');
  }

  // ---- execution flows ----------------------------------------------------
  const out = new Map<string, GraphEdge[]>();
  for (const e of baseEdges) {
    if (!['ROUTES_TO', 'CALLS', 'INSTANTIATES', 'READS_FROM', 'WRITES_TO'].includes(e.type)) continue;
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
  }
  const flows: ExecutionFlow[] = [];
  const trace = (start: string, maxDepth: number): { steps: string[]; reachesData: boolean } => {
    // Breadth-first search for the shortest chain that reaches data access;
    // falls back to the deepest chain found.
    const parent = new Map<string, string | null>([[start, null]]);
    let frontier = [start];
    let deepest = start;
    let dataHit: string | null = null;
    for (let d = 0; d < maxDepth && frontier.length && !dataHit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of out.get(id) ?? []) {
          if (parent.has(e.target)) continue;
          parent.set(e.target, id);
          next.push(e.target);
          deepest = e.target;
          if (
            e.type === 'READS_FROM' ||
            e.type === 'WRITES_TO' ||
            byId.get(e.target)?.type === 'DatabaseModel'
          ) {
            dataHit = e.target;
            break;
          }
        }
        if (dataHit) break;
      }
      frontier = next.slice(0, 400);
    }
    const steps: string[] = [];
    for (let cur: string | null = dataHit ?? deepest; cur; cur = parent.get(cur) ?? null) steps.unshift(cur);
    return { steps, reachesData: !!dataHit };
  };
  for (const n of baseNodes) {
    if (n.type !== 'ApiEndpoint') continue;
    const t = trace(n.id, 8);
    if (t.steps.length > 1)
      flows.push({
        id: `flow:${slugify(n.id)}`,
        name: n.name,
        kind: 'request',
        steps: t.steps,
        reachesData: t.reachesData,
      });
    n.metadata.flowSteps = t.steps.length;
  }
  for (const ep of entryPoints.slice(0, 20)) {
    const main = (symbolsByFile.get(ep.nodeId) ?? []).find(
      (s) => s.name === 'main' || s.name === 'start' || s.name === 'bootstrap' || s.name === 'run',
    );
    const start = main?.id ?? ep.nodeId;
    const t = trace(start, 6);
    if (t.steps.length > 1)
      flows.push({
        id: `flow:${slugify(start)}`,
        name: `Startup: ${ep.path}`,
        kind: 'startup',
        steps: t.steps,
        reachesData: t.reachesData,
      });
  }

  return { nodes, edges, entryPoints, flows };
}
