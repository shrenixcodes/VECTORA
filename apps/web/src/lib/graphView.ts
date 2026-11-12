/**
 * Derives what the visualisations show from the full knowledge graph and the
 * current filters. All three views call this with the same inputs, so they
 * always present the same underlying graph.
 */
import { type EdgeType, type GraphEdge, type GraphNode, type KnowledgeGraph, type NodeType, isSymbolType } from '@vectora/graph-schema';

export interface ViewOptions {
  density: 'structure' | 'balanced' | 'full';
  expandedIds: readonly string[];
  hiddenNodeTypes: readonly string[];
  hiddenEdgeTypes: readonly string[];
  showUnverified: boolean;
  focusId: string | null;
  focusDepth?: number;
  maxNodes: number;
  /** Nodes that must stay visible (selection, highlights). */
  pinnedIds?: readonly string[];
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Symbols left out by the density setting (they appear when their file is expanded). */
  collapsedSymbols: number;
  truncated: boolean;
}

export interface Adjacency {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export function buildAdjacency(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Adjacency {
  const nodes = new Map<string, GraphNode>();
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const n of graph.nodes) nodes.set(n.id, n);
  for (const e of graph.edges) {
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (inn.get(e.target) ?? inn.set(e.target, []).get(e.target)!).push(e);
  }
  return { nodes, out, in: inn };
}

const PROMINENT: ReadonlySet<NodeType> = new Set(['Class', 'DatabaseModel', 'ApiEndpoint', 'Component', 'Interface']);
const BALANCED_LIMIT = 1200;

export const fileIdOf = (n: GraphNode): string | null => (n.filePath ? `file:${n.filePath}` : null);

export function deriveView(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>, adj: Adjacency, o: ViewOptions): GraphView {
  const hiddenTypes = new Set(o.hiddenNodeTypes);
  const hiddenEdges = new Set(o.hiddenEdgeTypes);
  const expanded = new Set(o.expandedIds);
  const pinned = new Set(o.pinnedIds ?? []);
  const symbolTotal = graph.nodes.reduce((a, n) => a + (isSymbolType(n.type) ? 1 : 0), 0);

  let focusSet: Set<string> | null = null;
  if (o.focusId && adj.nodes.has(o.focusId)) {
    focusSet = new Set([o.focusId]);
    let frontier = [o.focusId];
    for (let d = 0; d < (o.focusDepth ?? 1); d++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const e of [...(adj.out.get(id) ?? []), ...(adj.in.get(id) ?? [])]) {
          if (hiddenEdges.has(e.type)) continue;
          const other = e.source === id ? e.target : e.source;
          if (!focusSet.has(other)) {
            focusSet.add(other);
            next.push(other);
          }
        }
      frontier = next;
    }
    // Keep the containing file of every focused symbol for context.
    for (const id of [...focusSet]) {
      const f = adj.nodes.get(id);
      const fid = f ? fileIdOf(f) : null;
      if (fid && adj.nodes.has(fid)) focusSet.add(fid);
    }
  }

  let collapsedSymbols = 0;
  const visible: GraphNode[] = [];
  for (const n of graph.nodes) {
    if (focusSet) {
      if (focusSet.has(n.id)) visible.push(n);
      continue;
    }
    if (pinned.has(n.id)) {
      visible.push(n);
      continue;
    }
    if (hiddenTypes.has(n.type)) continue;
    if (isSymbolType(n.type)) {
      const fid = fileIdOf(n);
      const fileExpanded = !!fid && expanded.has(fid);
      const show =
        fileExpanded ||
        o.density === 'full' ||
        (o.density === 'balanced' && (symbolTotal <= BALANCED_LIMIT || PROMINENT.has(n.type)));
      if (!show) {
        collapsedSymbols++;
        continue;
      }
    }
    visible.push(n);
  }

  let truncated = false;
  let nodes = visible;
  if (nodes.length > o.maxNodes) {
    truncated = true;
    // Keep structure first, then the best-connected symbols.
    const degree = (id: string) => (adj.out.get(id)?.length ?? 0) + (adj.in.get(id)?.length ?? 0);
    const rank = (n: GraphNode) => (pinned.has(n.id) ? 0 : isSymbolType(n.type) ? 2 : 1);
    nodes = [...nodes].sort((a, b) => rank(a) - rank(b) || degree(b.id) - degree(a.id)).slice(0, o.maxNodes);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    if (hiddenEdges.has(e.type)) continue;
    if (!o.showUnverified && !e.verified) continue;
    if (ids.has(e.source) && ids.has(e.target)) edges.push(e);
  }
  return { nodes, edges, collapsedSymbols, truncated };
}

/** Node ids within one hop of `id` over the given edges (the node itself included). */
export function neighbourhood(id: string, edges: readonly GraphEdge[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([id]);
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (e.source === id || e.target === id) {
      nodes.add(e.source);
      nodes.add(e.target);
      edgeIds.add(e.id);
    }
  }
  return { nodes, edges: edgeIds };
}

export interface Relations {
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
  parent: GraphNode | null;
  children: GraphNode[];
  concepts: GraphNode[];
  subsystem: GraphNode | null;
}

const HIERARCHY: ReadonlySet<EdgeType> = new Set<EdgeType>(['CONTAINS', 'DEFINED_IN', 'BELONGS_TO']);

export function relationsOf(id: string, adj: Adjacency): Relations {
  const node = adj.nodes.get(id);
  const out = adj.out.get(id) ?? [];
  const inn = adj.in.get(id) ?? [];
  const parentEdge = inn.find((e) => e.type === 'CONTAINS');
  const fileNode = node && isSymbolType(node.type) ? adj.nodes.get(fileIdOf(node) ?? '') : node;
  const conceptIds = (fileNode?.metadata.concepts as string[] | undefined) ?? [];
  const subsystemId = (node?.metadata.subsystem as string | undefined) ?? (fileNode?.metadata.subsystem as string | undefined);
  return {
    incoming: inn.filter((e) => !HIERARCHY.has(e.type)),
    outgoing: out.filter((e) => !HIERARCHY.has(e.type)),
    parent: parentEdge ? (adj.nodes.get(parentEdge.source) ?? null) : null,
    children: out.filter((e) => e.type === 'CONTAINS').map((e) => adj.nodes.get(e.target)).filter((n): n is GraphNode => !!n),
    concepts: conceptIds.map((c) => adj.nodes.get(c)).filter((n): n is GraphNode => !!n),
    subsystem: subsystemId ? (adj.nodes.get(subsystemId) ?? null) : null,
  };
}
