/**
 * Repository analysis record (persisted next to the graph) and the overview
 * derived from it. Every summary statement carries the evidence it is based on.
 */
import { type GraphNode, type KnowledgeGraph, type UnresolvedReference, type ValidationIssue, isSymbolType } from '@vectora/graph-schema';
import type { IndexSummary, RepositoryOverview, RepositoryRecord } from '@vectora/shared';
import { type GraphIndex, buildIndex, findCycles } from './algorithms';

export interface ExecutionFlow {
  id: string;
  name: string;
  kind: 'request' | 'startup';
  steps: string[];
  reachesData: boolean;
}

export interface RepositoryAnalysis {
  generatedAt: string;
  description: string | null;
  descriptionSource: string | null;
  languages: { language: string; name: string; tier: number; files: number; analyzedFiles: number; symbols: number; parseErrors: number; adapter: string | null; lines: number }[];
  frameworks: { name: string; evidence: string }[];
  entryPoints: { path: string; nodeId: string; reason: string }[];
  flows: ExecutionFlow[];
  declaredDependencies: { name: string; version: string | null; manifest: string; ecosystem: string; dev: boolean; line: number }[];
  unresolvedCount: number;
  unresolvedByReason: Record<string, number>;
  unresolvedSamples: UnresolvedReference[];
  validation: { errors: number; warnings: number; issues: ValidationIssue[] };
  normalization: { removedNodes: number; mergedEdges: number; droppedEdges: number };
  skipped: Record<string, number>;
  truncated: boolean;
  parseIssues: { path: string; message: string; line?: number; severity: string }[];
  communities: number;
  summary: IndexSummary;
}

export function buildOverview(repository: RepositoryRecord, graph: KnowledgeGraph, analysis: RepositoryAnalysis | null, index?: GraphIndex): RepositoryOverview {
  const idx = index ?? buildIndex(graph);
  const fileNodes = graph.nodes.filter((n) => n.type === 'File' || n.type === 'Configuration');

  const symbolsPerFile = new Map<string, number>();
  for (const n of graph.nodes) if (isSymbolType(n.type) && n.filePath) symbolsPerFile.set(n.filePath, (symbolsPerFile.get(n.filePath) ?? 0) + 1);

  const subsystems = graph.nodes
    .filter((n) => n.type === 'Subsystem')
    .map((s) => {
      const files = (idx.in.get(s.id) ?? []).filter((e) => e.type === 'BELONGS_TO');
      let symbols = 0;
      for (const e of files) symbols += symbolsPerFile.get(idx.nodes.get(e.source)?.filePath ?? '') ?? 0;
      const dep = (list: typeof graph.edges | undefined) => (list ?? []).filter((e) => e.type === 'DEPENDS_ON').reduce((a, e) => a + Number(e.metadata?.count ?? 1), 0);
      return { id: s.id, name: s.name, files: files.length, symbols, inbound: dep(idx.in.get(s.id)), outbound: dep(idx.out.get(s.id)) };
    })
    .sort((a, b) => b.files - a.files);

  const concepts = graph.nodes
    .filter((n) => n.type === 'Concept')
    .map((c) => {
      const members = (idx.in.get(c.id) ?? []).filter((e) => e.type === 'BELONGS_TO').sort((a, b) => b.confidence - a.confidence);
      return { id: c.id, name: c.name, members: members.length, evidence: members.slice(0, 3).map((e) => `${idx.nodes.get(e.source)?.filePath ?? e.source}: ${e.evidence}`) };
    })
    .sort((a, b) => b.members - a.members);

  const largestModules = fileNodes
    .filter((f) => f.type === 'File')
    .map((f) => ({ id: f.id, path: f.filePath!, symbols: symbolsPerFile.get(f.filePath!) ?? 0, lines: Number(f.metadata.lines ?? 0) }))
    .sort((a, b) => b.symbols - a.symbols || b.lines - a.lines)
    .slice(0, 12);

  const packages = graph.nodes.filter((n) => n.type === 'Package');
  const externalPackages = packages
    .map((p) => ({
      name: p.name,
      importers: new Set((idx.in.get(p.id) ?? []).filter((e) => e.type === 'IMPORTS').map((e) => e.source)).size,
      declared: !!p.metadata.declared,
      version: (p.metadata.version as string | null) ?? null,
    }))
    .sort((a, b) => b.importers - a.importers || (a.name < b.name ? -1 : 1));
  const internalImports = graph.edges.filter((e) => e.type === 'IMPORTS' && !e.target.startsWith('pkg:')).length;

  // ---- architecture summary: statements with evidence ---------------------
  const summary: RepositoryOverview['architectureSummary'] = [];
  const langs = analysis?.languages ?? [];
  const analysed = langs.filter((l) => l.tier > 0 && l.files > 0).sort((a, b) => b.files - a.files);
  if (analysed.length) {
    const top = analysed[0]!;
    summary.push({
      statement: `${fileNodes.length} files indexed; the primary language is ${top.name} (${top.files} files, ${top.symbols} symbols).`,
      evidence: `File extensions and ${top.adapter ?? 'syntax'} analysis`,
      verified: true,
    });
  }
  if (subsystems.length > 1) {
    summary.push({
      statement: `The repository is organised into ${subsystems.length} subsystems; the largest are ${subsystems.slice(0, 3).map((s) => `${s.name} (${s.files} files)`).join(', ')}.`,
      evidence: 'Directory layout and workspace manifests',
      verified: true,
    });
    const deps = graph.edges.filter((e) => e.type === 'DEPENDS_ON' && e.source.startsWith('sub:')).sort((a, b) => Number(b.metadata?.count ?? 0) - Number(a.metadata?.count ?? 0));
    for (const d of deps.slice(0, 4))
      summary.push({
        statement: `${idx.nodes.get(d.source)?.name} depends on ${idx.nodes.get(d.target)?.name} through ${d.metadata?.count} relationships.`,
        evidence: d.evidence,
        verified: true,
      });
  }
  const endpoints = graph.nodes.filter((n) => n.type === 'ApiEndpoint');
  if (endpoints.length)
    summary.push({
      statement: `${endpoints.length} API endpoint${endpoints.length === 1 ? ' is' : 's are'} defined, for example ${endpoints.slice(0, 3).map((e) => e.name).join(', ')}.`,
      evidence: endpoints.slice(0, 3).map((e) => `${e.filePath}:${e.location?.startLine}`).join(', '),
      verified: true,
    });
  const models = graph.nodes.filter((n) => n.type === 'DatabaseModel');
  if (models.length)
    summary.push({
      statement: `${models.length} database model${models.length === 1 ? '' : 's'} detected: ${models.slice(0, 5).map((m) => m.name).join(', ')}${models.length > 5 ? ', ...' : ''}.`,
      evidence: models.slice(0, 3).map((m) => `${m.filePath}:${m.location?.startLine}`).join(', '),
      verified: true,
    });
  const dataFlows = (analysis?.flows ?? []).filter((f) => f.reachesData);
  if (dataFlows.length)
    summary.push({
      statement: `${dataFlows.length} request flow${dataFlows.length === 1 ? '' : 's'} can be traced from an endpoint to data access.`,
      evidence: `e.g. ${dataFlows[0]!.name}: ${dataFlows[0]!.steps.map((s) => idx.nodes.get(s)?.name ?? s).join(' → ')}`,
      verified: false,
    });
  const cycles = findCycles(idx, ['IMPORTS'], (n: GraphNode) => n.type === 'File');
  if (cycles.length)
    summary.push({
      statement: `${cycles.length} circular import group${cycles.length === 1 ? '' : 's'} found; the largest involves ${cycles[0]!.length} files.`,
      evidence: cycles[0]!.slice(0, 4).map((id) => idx.nodes.get(id)?.filePath).join(' → '),
      verified: true,
    });
  if (analysis && analysis.unresolvedCount > 0)
    summary.push({
      statement: `${analysis.unresolvedCount} references could not be tied to a definition and are not shown as relationships.`,
      evidence: Object.entries(analysis.unresolvedByReason).map(([r, c]) => `${c} × ${r}`).join('; '),
      verified: true,
    });

  return {
    repository,
    description: analysis?.description ?? null,
    descriptionSource: analysis?.descriptionSource ?? null,
    languages: (analysis?.languages ?? []).map((l) => ({ ...l, language: l.name })),
    frameworks: analysis?.frameworks ?? [],
    entryPoints: analysis?.entryPoints ?? [],
    subsystems,
    concepts,
    largestModules,
    dependencies: {
      declared: analysis?.declaredDependencies.length ?? 0,
      imported: externalPackages.filter((p) => p.importers > 0).length,
      internalImports,
      externalPackages: externalPackages.slice(0, 200),
    },
    architectureSummary: summary,
    unresolved: analysis?.unresolvedCount ?? 0,
    validation: { errors: analysis?.validation.errors ?? 0, warnings: analysis?.validation.warnings ?? 0 },
    summary: analysis?.summary ?? null,
  };
}
