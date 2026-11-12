/**
 * Graph exports: JSON, GraphML, Markdown analysis and architecture
 * documentation. Node ids and relationships are always preserved. Source
 * text (evidence lines, signatures, doc comments) is only included when the
 * caller explicitly asks for it.
 */
import { EDGE_TYPE_LABELS, type GraphEdge, type GraphNode, type KnowledgeGraph, NODE_TYPE_LABELS, isSymbolType } from '@vectora/graph-schema';
import { APP_VERSION, type RepositoryOverview, type RepositoryRecord } from '@vectora/shared';
import { buildIndex, cyclePath, findCycles } from './algorithms';
import type { RepositoryAnalysis } from './analysis';

export interface ExportOptions {
  includeSource?: boolean;
}

const SOURCE_METADATA_KEYS = ['signature', 'attributes', 'hash'];

/** Removes source text from a graph so it can be shared without repository contents. */
export function stripSource(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes.map((n) => {
    const metadata = { ...n.metadata };
    for (const k of SOURCE_METADATA_KEYS) delete metadata[k];
    const out: GraphNode = { ...n, metadata };
    // Descriptions of symbols are doc comments, i.e. repository content.
    if (isSymbolType(n.type) || n.type === 'Repository') delete out.description;
    return out;
  });
  const edges = graph.edges.map((e) => ({
    ...e,
    evidence: e.location ? `${e.location.path}:${e.location.startLine}` : e.extractionMethod,
  }));
  return { nodes, edges };
}

export function exportJson(repository: RepositoryRecord, graph: KnowledgeGraph, opts: ExportOptions = {}): string {
  const { nodes, edges } = opts.includeSource ? graph : stripSource(graph);
  return JSON.stringify(
    {
      format: 'vectora-graph',
      schemaVersion: graph.schemaVersion,
      exportedAt: new Date().toISOString(),
      generator: `VECTORA ${APP_VERSION}`,
      includesSource: !!opts.includeSource,
      repository: { id: repository.id, name: repository.name, sourceKind: repository.sourceKind, branch: repository.branch, lastIndexedAt: repository.lastIndexedAt },
      stats: graph.stats,
      nodes,
      edges,
    },
    null,
    2,
  );
}

const xml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function exportGraphML(repository: RepositoryRecord, graph: KnowledgeGraph, opts: ExportOptions = {}): string {
  const { nodes, edges } = opts.includeSource ? graph : stripSource(graph);
  const nodeKeys: [string, string, (n: GraphNode) => unknown][] = [
    ['name', 'string', (n) => n.name],
    ['type', 'string', (n) => n.type],
    ['filePath', 'string', (n) => n.filePath ?? ''],
    ['startLine', 'int', (n) => n.location?.startLine ?? ''],
    ['endLine', 'int', (n) => n.location?.endLine ?? ''],
    ['language', 'string', (n) => n.language ?? ''],
    ['extractionMethod', 'string', (n) => n.extractionMethod],
    ['confidence', 'double', (n) => n.confidence],
    ['verified', 'boolean', (n) => n.verified],
  ];
  const edgeKeys: [string, string, (e: GraphEdge) => unknown][] = [
    ['relationship', 'string', (e) => e.type],
    ['evidence', 'string', (e) => e.evidence],
    ['evidencePath', 'string', (e) => e.location?.path ?? ''],
    ['evidenceLine', 'int', (e) => e.location?.startLine ?? ''],
    ['edgeExtractionMethod', 'string', (e) => e.extractionMethod],
    ['edgeConfidence', 'double', (e) => e.confidence],
    ['edgeVerified', 'boolean', (e) => e.verified],
  ];
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
    `  <!-- VECTORA ${APP_VERSION} export of ${xml(repository.name)} -->`,
  ];
  for (const [k, t] of nodeKeys) out.push(`  <key id="${k}" for="node" attr.name="${k}" attr.type="${t}"/>`);
  for (const [k, t] of edgeKeys) out.push(`  <key id="${k}" for="edge" attr.name="${k}" attr.type="${t}"/>`);
  out.push(`  <graph id="${xml(repository.id)}" edgedefault="directed">`);
  for (const n of nodes) {
    out.push(`    <node id="${xml(n.id)}">`);
    for (const [k, , get] of nodeKeys) {
      const v = get(n);
      if (v !== '' && v !== null && v !== undefined) out.push(`      <data key="${k}">${xml(v)}</data>`);
    }
    out.push('    </node>');
  }
  for (const e of edges) {
    out.push(`    <edge id="${xml(e.id)}" source="${xml(e.source)}" target="${xml(e.target)}">`);
    for (const [k, , get] of edgeKeys) {
      const v = get(e);
      if (v !== '' && v !== null && v !== undefined) out.push(`      <data key="${k}">${xml(v)}</data>`);
    }
    out.push('    </edge>');
  }
  out.push('  </graph>', '</graphml>', '');
  return out.join('\n');
}

const mdEscape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function exportMarkdownAnalysis(overview: RepositoryOverview, graph: KnowledgeGraph, analysis: RepositoryAnalysis | null): string {
  const r = overview.repository;
  const L: string[] = [];
  L.push(`# ${r.name} — repository analysis`, '');
  L.push(`Generated by VECTORA ${APP_VERSION} on ${new Date().toISOString().slice(0, 10)}.`, '');
  if (overview.description) L.push(`> ${overview.description}`, '', `Source: \`${overview.descriptionSource}\``, '');
  L.push('## Index', '');
  L.push(`| | |`, `|---|---|`);
  L.push(`| Source | ${r.sourceKind} |`);
  if (r.branch) L.push(`| Branch | ${r.branch} |`);
  L.push(`| Last indexed | ${r.lastIndexedAt ?? 'never'} |`);
  L.push(`| Files | ${graph.stats.fileCount} |`, `| Symbols | ${graph.stats.symbolCount} |`, `| Relationships | ${graph.stats.edgeCount} |`);
  L.push(`| Verified relationships | ${graph.stats.verifiedEdges} |`, `| Derived relationships | ${graph.stats.unverifiedEdges} |`, `| Unresolved references | ${overview.unresolved} |`, '');

  L.push('## Languages', '', '| Language | Files | Analysed | Symbols | Technique |', '|---|---:|---:|---:|---|');
  for (const l of overview.languages) L.push(`| ${l.language} | ${l.files} | ${l.analyzedFiles} | ${l.symbols} | ${l.adapter ?? 'not analysed at symbol level'} |`);
  L.push('');
  if (overview.frameworks.length) {
    L.push('## Frameworks', '');
    for (const f of overview.frameworks) L.push(`- **${f.name}** — ${f.evidence}`);
    L.push('');
  }
  L.push('## Architecture summary', '');
  for (const s of overview.architectureSummary) L.push(`- ${s.statement}${s.verified ? '' : ' _(derived)_'}  \n  Evidence: ${s.evidence}`);
  L.push('');
  if (overview.entryPoints.length) {
    L.push('## Entry points', '');
    for (const e of overview.entryPoints) L.push(`- \`${e.path}\` — ${e.reason}`);
    L.push('');
  }
  if (overview.subsystems.length) {
    L.push('## Subsystems', '', '| Subsystem | Files | Symbols | Outbound | Inbound |', '|---|---:|---:|---:|---:|');
    for (const s of overview.subsystems) L.push(`| ${mdEscape(s.name)} | ${s.files} | ${s.symbols} | ${s.outbound} | ${s.inbound} |`);
    L.push('');
  }
  if (overview.concepts.length) {
    L.push('## Concepts', '', 'Concept groups are derived from identifier and path evidence; they are interpretations, not verified facts.', '');
    for (const c of overview.concepts) L.push(`- **${c.name}** — ${c.members} files`);
    L.push('');
  }
  L.push('## Largest modules', '', '| File | Symbols | Lines |', '|---|---:|---:|');
  for (const m of overview.largestModules) L.push(`| \`${m.path}\` | ${m.symbols} | ${m.lines} |`);
  L.push('');
  L.push('## Dependencies', '');
  L.push(`${overview.dependencies.declared} declared in manifests, ${overview.dependencies.imported} imported by source files, ${overview.dependencies.internalImports} internal imports.`, '');
  const top = overview.dependencies.externalPackages.filter((p) => p.importers > 0).slice(0, 30);
  if (top.length) {
    L.push('| Package | Importing files | Declared | Version |', '|---|---:|---|---|');
    for (const p of top) L.push(`| ${mdEscape(p.name)} | ${p.importers} | ${p.declared ? 'yes' : 'no'} | ${p.version ?? ''} |`);
    L.push('');
  }
  if (analysis && analysis.unresolvedCount) {
    L.push('## Unresolved references', '');
    for (const [reason, count] of Object.entries(analysis.unresolvedByReason)) L.push(`- ${count} × ${reason}`);
    L.push('');
  }
  return L.join('\n');
}

export function exportArchitectureDoc(overview: RepositoryOverview, graph: KnowledgeGraph, analysis: RepositoryAnalysis | null): string {
  const idx = buildIndex(graph);
  const name = (id: string) => idx.nodes.get(id)?.name ?? id;
  const L: string[] = [];
  L.push(`# ${overview.repository.name} — architecture`, '');
  L.push(`Generated by VECTORA ${APP_VERSION} from the knowledge graph (${graph.stats.nodeCount} nodes, ${graph.stats.edgeCount} relationships).`, '');
  L.push('Statements marked _derived_ are interpretations built on top of verified structure.', '');
  L.push('## Subsystems', '');
  for (const s of overview.subsystems) {
    const node = idx.nodes.get(s.id);
    L.push(`### ${s.name}`, '');
    L.push(`${node?.description ?? ''} ${s.files} files, ${s.symbols} symbols.`.trim(), '');
    const deps = (idx.out.get(s.id) ?? []).filter((e) => e.type === 'DEPENDS_ON');
    if (deps.length) {
      L.push('Depends on:', '');
      for (const d of deps.sort((a, b) => Number(b.metadata?.count ?? 0) - Number(a.metadata?.count ?? 0))) L.push(`- **${name(d.target)}** — ${d.metadata?.count} relationships (${d.location ? `\`${d.location.path}:${d.location.startLine}\`` : 'aggregated'})`);
      L.push('');
    }
    const users = (idx.in.get(s.id) ?? []).filter((e) => e.type === 'DEPENDS_ON');
    if (users.length) L.push(`Used by: ${users.map((u) => name(u.source)).join(', ')}.`, '');
  }
  const deps = graph.edges.filter((e) => e.type === 'DEPENDS_ON' && e.source.startsWith('sub:'));
  if (deps.length) {
    L.push('## Subsystem dependency diagram', '', '```mermaid', 'graph LR');
    const mid = (id: string) => `n${[...idx.nodes.keys()].indexOf(id)}`;
    const ids = new Set<string>();
    for (const d of deps) {
      ids.add(d.source);
      ids.add(d.target);
    }
    for (const id of ids) L.push(`  ${mid(id)}["${name(id).replace(/"/g, "'")}"]`);
    for (const d of deps) L.push(`  ${mid(d.source)} -->|${d.metadata?.count ?? ''}| ${mid(d.target)}`);
    L.push('```', '');
  }
  if (overview.entryPoints.length) {
    L.push('## Entry points', '');
    for (const e of overview.entryPoints) L.push(`- \`${e.path}\` — ${e.reason}`);
    L.push('');
  }
  const endpoints = graph.nodes.filter((n) => n.type === 'ApiEndpoint');
  if (endpoints.length) {
    L.push('## API endpoints', '', '| Endpoint | Defined at | Handler |', '|---|---|---|');
    for (const e of endpoints.slice(0, 200)) {
      const h = (idx.out.get(e.id) ?? []).find((x) => x.type === 'ROUTES_TO');
      L.push(`| \`${mdEscape(e.name)}\` | \`${e.filePath}:${e.location?.startLine}\` | ${h ? `\`${mdEscape(name(h.target))}\`` : 'inline'} |`);
    }
    L.push('');
  }
  const models = graph.nodes.filter((n) => n.type === 'DatabaseModel');
  if (models.length) {
    L.push('## Database models', '', '| Model | Defined at | Readers | Writers |', '|---|---|---:|---:|');
    for (const m of models) {
      const inc = idx.in.get(m.id) ?? [];
      L.push(`| \`${mdEscape(m.name)}\` | \`${m.filePath}:${m.location?.startLine}\` | ${inc.filter((e) => e.type === 'READS_FROM').length} | ${inc.filter((e) => e.type === 'WRITES_TO').length} |`);
    }
    L.push('');
  }
  if (analysis?.flows.length) {
    L.push('## Execution flows', '', '_Derived by following route and call relationships._', '');
    for (const f of analysis.flows.slice(0, 40)) L.push(`- **${f.name}**${f.reachesData ? ' (reaches data access)' : ''}: ${f.steps.map((s) => `\`${name(s)}\``).join(' → ')}`);
    L.push('');
  }
  const cycles = findCycles(idx, ['IMPORTS'], (n) => n.type === 'File');
  L.push('## Circular dependencies', '');
  if (!cycles.length) L.push('No circular imports between files were found.', '');
  for (const c of cycles.slice(0, 20)) {
    const path = cyclePath(idx, c);
    L.push(`- ${c.length} files: ${path.map((e) => `\`${idx.nodes.get(e.source)?.filePath}\``).join(' → ')} → \`${idx.nodes.get(path[0]?.source ?? c[0]!)?.filePath}\``);
  }
  L.push('');
  L.push('## Relationship legend', '');
  for (const [k, v] of Object.entries(EDGE_TYPE_LABELS)) L.push(`- \`${k}\` — ${v} (${graph.stats.edgesByType[k as keyof typeof EDGE_TYPE_LABELS] ?? 0})`);
  L.push('', '## Node types', '');
  for (const [k, v] of Object.entries(NODE_TYPE_LABELS)) {
    const c = graph.stats.nodesByType[k as keyof typeof NODE_TYPE_LABELS] ?? 0;
    if (c) L.push(`- ${v}: ${c}`);
  }
  L.push('');
  return L.join('\n');
}
