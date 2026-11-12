/**
 * VECTORA knowledge graph schema.
 *
 * Every node and edge carries the evidence it was derived from: where in the
 * source it was found, which extraction method produced it, and how confident
 * the extractor is. Structural facts (`verified: true`) are kept apart from
 * derived interpretations (`verified: false`).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const NODE_TYPES = [
  'Repository',
  'Directory',
  'File',
  'Package',
  'Module',
  'Class',
  'Function',
  'Method',
  'Interface',
  'Type',
  'Variable',
  'Constant',
  'ApiEndpoint',
  'DatabaseModel',
  'Component',
  'Concept',
  'Subsystem',
  'Configuration',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'CONTAINS',
  'IMPORTS',
  'EXPORTS',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
  'USES',
  'INSTANTIATES',
  'DEPENDS_ON',
  'READS_FROM',
  'WRITES_TO',
  'ROUTES_TO',
  'DEFINED_IN',
  'BELONGS_TO',
  'RELATED_TO',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** How a fact was obtained. Ordered roughly from most to least precise. */
export const EXTRACTION_METHODS = [
  'filesystem', // directory / file structure
  'manifest', // package manifests (package.json, pyproject.toml, go.mod, ...)
  'typescript-compiler', // TypeScript Compiler API, syntax level
  'typescript-checker', // TypeScript Compiler API, type-checker symbol resolution
  'python-ast', // Python `ast` module
  'tree-sitter', // Tree-sitter syntax tree
  'scope-resolution', // name resolved through imports / same-file scope
  'name-resolution', // unique-name resolution limited to imported or same-package files
  'pattern', // framework pattern (routes, models, components)
  'structural-grouping', // subsystem grouping from repository layout
  'keyword-evidence', // concept grouping from identifiers and paths
  'aggregation', // derived by aggregating other edges
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/** Node types that represent a source-code symbol. */
export const SYMBOL_TYPES: readonly NodeType[] = [
  'Class',
  'Function',
  'Method',
  'Interface',
  'Type',
  'Variable',
  'Constant',
  'ApiEndpoint',
  'DatabaseModel',
  'Component',
];
/** Node types that form the structural skeleton of a repository. */
export const STRUCTURAL_TYPES: readonly NodeType[] = [
  'Repository',
  'Subsystem',
  'Module',
  'Directory',
  'File',
  'Package',
  'Concept',
  'Configuration',
];

export const isSymbolType = (t: NodeType): boolean => SYMBOL_TYPES.includes(t);

export const SourceLocationSchema = z.object({
  path: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  startColumn: z.number().int().min(0).optional(),
  endColumn: z.number().int().min(0).optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(NODE_TYPES),
  repositoryId: z.string().min(1),
  filePath: z.string().nullable(),
  location: SourceLocationSchema.nullable(),
  description: z.string().optional(),
  language: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  extractionMethod: z.enum(EXTRACTION_METHODS),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(EDGE_TYPES),
  /** Source text or statement that justifies this relationship. */
  evidence: z.string(),
  location: SourceLocationSchema.nullable(),
  extractionMethod: z.enum(EXTRACTION_METHODS),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/** A reference the indexer found but could not tie to a definition. */
export interface UnresolvedReference {
  fromPath: string;
  fromSymbol: string | null;
  kind: EdgeType;
  name: string;
  line: number;
  reason: string;
}

export interface LanguageCoverage {
  language: string;
  tier: 1 | 2 | 0;
  files: number;
  analyzedFiles: number;
  symbols: number;
  parseErrors: number;
  adapter: string | null;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  symbolCount: number;
  fileCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  edgesByType: Partial<Record<EdgeType, number>>;
  unresolvedCount: number;
  verifiedEdges: number;
  unverifiedEdges: number;
}

export interface KnowledgeGraph {
  schemaVersion: number;
  repositoryId: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export const KnowledgeGraphSchema = z.object({
  schemaVersion: z.number().int(),
  repositoryId: z.string(),
  generatedAt: z.string(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

// ---------------------------------------------------------------------------
// Identifier helpers. IDs are deterministic so that re-indexing an unchanged
// repository yields the same graph and exports stay comparable.
// ---------------------------------------------------------------------------

export const normalizePath = (p: string): string =>
  p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');

export const nodeId = {
  repository: (): string => 'repo:root',
  directory: (path: string): string => `dir:${normalizePath(path)}`,
  file: (path: string): string => `file:${normalizePath(path)}`,
  symbol: (path: string, localId: string): string => `sym:${normalizePath(path)}#${localId}`,
  pkg: (name: string): string => `pkg:${name}`,
  module: (path: string): string => `mod:${normalizePath(path)}`,
  subsystem: (key: string): string => `sub:${key}`,
  concept: (key: string): string => `concept:${key}`,
  config: (path: string): string => `cfg:${normalizePath(path)}`,
};

export const edgeId = (type: EdgeType, source: string, target: string): string => `${type}|${source}|${target}`;

// ---------------------------------------------------------------------------
// Validation and normalization
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code:
    | 'duplicate-node'
    | 'duplicate-edge'
    | 'dangling-edge'
    | 'self-loop'
    | 'invalid-node'
    | 'invalid-edge'
    | 'missing-evidence'
    | 'orphan-node';
  message: string;
  id?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

/** Edge types where a node pointing at itself is meaningful (recursion). */
const SELF_LOOP_ALLOWED: ReadonlySet<EdgeType> = new Set(['CALLS', 'USES']);

/**
 * Checks graph integrity: schema conformance, unique IDs, no dangling edges,
 * evidence present on every non-structural edge.
 */
export function validateGraph(
  graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>,
  opts: { checkSchema?: boolean; maxIssues?: number } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const max = opts.maxIssues ?? 500;
  const push = (i: ValidationIssue) => {
    if (issues.length < max) issues.push(i);
  };
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) push({ severity: 'error', code: 'duplicate-node', message: `Duplicate node id ${n.id}`, id: n.id });
    ids.add(n.id);
    if (opts.checkSchema) {
      const r = GraphNodeSchema.safeParse(n);
      if (!r.success)
        push({ severity: 'error', code: 'invalid-node', message: `${n.id}: ${r.error.issues[0]?.message ?? 'invalid'}`, id: n.id });
    }
  }
  const edgeIds = new Set<string>();
  const connected = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) push({ severity: 'error', code: 'duplicate-edge', message: `Duplicate edge id ${e.id}`, id: e.id });
    edgeIds.add(e.id);
    if (!ids.has(e.source) || !ids.has(e.target)) {
      push({
        severity: 'error',
        code: 'dangling-edge',
        message: `Edge ${e.id} references a missing node`,
        id: e.id,
      });
      continue;
    }
    connected.add(e.source);
    connected.add(e.target);
    if (e.source === e.target && !SELF_LOOP_ALLOWED.has(e.type))
      push({ severity: 'warning', code: 'self-loop', message: `Self-referencing ${e.type} edge on ${e.source}`, id: e.id });
    if (!e.evidence) push({ severity: 'warning', code: 'missing-evidence', message: `Edge ${e.id} has no evidence`, id: e.id });
    if (opts.checkSchema) {
      const r = GraphEdgeSchema.safeParse(e);
      if (!r.success)
        push({ severity: 'error', code: 'invalid-edge', message: `${e.id}: ${r.error.issues[0]?.message ?? 'invalid'}`, id: e.id });
    }
  }
  for (const n of graph.nodes) {
    if (!connected.has(n.id) && n.type !== 'Repository')
      push({ severity: 'warning', code: 'orphan-node', message: `Node ${n.id} has no relationships`, id: n.id });
  }
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  return { valid: errorCount === 0, issues, errorCount, warningCount: issues.length - errorCount };
}

/**
 * Removes duplicate nodes (first wins), merges duplicate edges (keeping the
 * first evidence and counting occurrences) and drops edges whose endpoints do
 * not exist. Returns what was changed so callers can report it.
 */
export function normalizeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[]; removedNodes: number; mergedEdges: number; droppedEdges: number } {
  const nodeMap = new Map<string, GraphNode>();
  let removedNodes = 0;
  for (const n of nodes) {
    if (nodeMap.has(n.id)) removedNodes++;
    else nodeMap.set(n.id, { ...n, filePath: n.filePath ? normalizePath(n.filePath) : n.filePath });
  }
  const edgeMap = new Map<string, GraphEdge>();
  let mergedEdges = 0;
  let droppedEdges = 0;
  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) {
      droppedEdges++;
      continue;
    }
    const existing = edgeMap.get(e.id);
    if (existing) {
      mergedEdges++;
      const meta = (existing.metadata ??= {});
      meta.occurrences = ((meta.occurrences as number | undefined) ?? 1) + 1;
      const lines = (meta.lines as number[] | undefined) ?? (existing.location ? [existing.location.startLine] : []);
      if (e.location && lines.length < 20 && !lines.includes(e.location.startLine)) lines.push(e.location.startLine);
      meta.lines = lines;
      // Keep the strongest claim when the same relationship is found twice.
      if (e.confidence > existing.confidence) {
        existing.confidence = e.confidence;
        existing.extractionMethod = e.extractionMethod;
        existing.verified = e.verified;
      }
    } else {
      edgeMap.set(e.id, { ...e, metadata: e.metadata ? { ...e.metadata } : undefined });
    }
  }
  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()], removedNodes, mergedEdges, droppedEdges };
}

export function computeStats(nodes: GraphNode[], edges: GraphEdge[], unresolvedCount = 0): GraphStats {
  const nodesByType: Partial<Record<NodeType, number>> = {};
  const edgesByType: Partial<Record<EdgeType, number>> = {};
  let symbolCount = 0;
  let fileCount = 0;
  for (const n of nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
    if (isSymbolType(n.type)) symbolCount++;
    if (n.type === 'File' || n.type === 'Configuration') fileCount++;
  }
  let verifiedEdges = 0;
  for (const e of edges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
    if (e.verified) verifiedEdges++;
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    symbolCount,
    fileCount,
    nodesByType,
    edgesByType,
    unresolvedCount,
    verifiedEdges,
    unverifiedEdges: edges.length - verifiedEdges,
  };
}

/** Human-readable labels used across the interface and exports. */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  Repository: 'Repository',
  Directory: 'Directory',
  File: 'File',
  Package: 'Package',
  Module: 'Module',
  Class: 'Class',
  Function: 'Function',
  Method: 'Method',
  Interface: 'Interface',
  Type: 'Type',
  Variable: 'Variable',
  Constant: 'Constant',
  ApiEndpoint: 'API endpoint',
  DatabaseModel: 'Database model',
  Component: 'Component',
  Concept: 'Concept',
  Subsystem: 'Subsystem',
  Configuration: 'Configuration',
};

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  CONTAINS: 'contains',
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  CALLS: 'calls',
  EXTENDS: 'extends',
  IMPLEMENTS: 'implements',
  USES: 'uses',
  INSTANTIATES: 'instantiates',
  DEPENDS_ON: 'depends on',
  READS_FROM: 'reads from',
  WRITES_TO: 'writes to',
  ROUTES_TO: 'routes to',
  DEFINED_IN: 'defined in',
  BELONGS_TO: 'belongs to',
  RELATED_TO: 'related to',
};
