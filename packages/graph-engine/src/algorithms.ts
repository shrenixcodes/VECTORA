/**
 * Graph algorithms over the knowledge graph: adjacency index, traversal,
 * cycle detection, impact analysis and community detection.
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { EdgeType, GraphEdge, GraphNode, KnowledgeGraph } from '@vectora/graph-schema';

export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export function buildIndex(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): GraphIndex {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const n of graph.nodes) nodes.set(n.id, n);
  for (const e of graph.edges) {
    edges.set(e.id, e);
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (inn.get(e.target) ?? inn.set(e.target, []).get(e.target)!).push(e);
  }
  return { nodes, edges, out, in: inn };
}

/** Relationship types that express "A needs B to work". */
export const DEPENDENCY_EDGES: readonly EdgeType[] = ['IMPORTS', 'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'INSTANTIATES', 'READS_FROM', 'WRITES_TO', 'ROUTES_TO', 'DEPENDS_ON'];
const HIERARCHY_EDGES: readonly EdgeType[] = ['CONTAINS', 'DEFINED_IN', 'BELONGS_TO', 'EXPORTS'];

export interface TraversalResult {
  /** node id -> distance from the start */
  distances: Map<string, number>;
  edges: GraphEdge[];
  truncated: boolean;
}

export function traverse(
  index: GraphIndex,
  start: string,
  direction: 'out' | 'in',
  opts: { types?: readonly EdgeType[]; maxDepth?: number; maxNodes?: number } = {},
): TraversalResult {
  const types = new Set(opts.types ?? DEPENDENCY_EDGES);
  const maxDepth = opts.maxDepth ?? 4;
  const maxNodes = opts.maxNodes ?? 500;
  const distances = new Map<string, number>([[start, 0]]);
  const edges: GraphEdge[] = [];
  let frontier = [start];
  let truncated = false;
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of (direction === 'out' ? index.out : index.in).get(id) ?? []) {
        if (!types.has(e.type)) continue;
        const other = direction === 'out' ? e.target : e.source;
        edges.push(e);
        if (distances.has(other)) continue;
        if (distances.size >= maxNodes) {
          truncated = true;
          continue;
        }
        distances.set(other, d);
        next.push(other);
      }
    }
    frontier = next;
  }
  return { distances, edges, truncated };
}

/** Shortest directed path between two nodes over dependency edges. */
export function shortestPath(index: GraphIndex, from: string, to: string, types: readonly EdgeType[] = DEPENDENCY_EDGES, maxDepth = 12): GraphEdge[] | null {
  if (from === to) return [];
  const allowed = new Set(types);
  const prev = new Map<string, GraphEdge>();
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.out.get(id) ?? []) {
        if (!allowed.has(e.type) || seen.has(e.target)) continue;
        seen.add(e.target);
        prev.set(e.target, e);
        if (e.target === to) {
          const path: GraphEdge[] = [];
          for (let cur = to; cur !== from; ) {
            const pe = prev.get(cur)!;
            path.unshift(pe);
            cur = pe.source;
          }
          return path;
        }
        next.push(e.target);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Strongly connected components (Tarjan, iterative) over the given edge
 * types. Components with more than one node are dependency cycles.
 */
export function findCycles(index: GraphIndex, types: readonly EdgeType[] = ['IMPORTS'], nodeFilter?: (n: GraphNode) => boolean): string[][] {
  const allowed = new Set(types);
  const ids = [...index.nodes.values()].filter((n) => !nodeFilter || nodeFilter(n)).map((n) => n.id);
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;
  const succ = (id: string): string[] => {
    const out: string[] = [];
    for (const e of index.out.get(id) ?? []) {
      if (!allowed.has(e.type) || e.target === id) continue;
      const t = index.nodes.get(e.target);
      if (t && (!nodeFilter || nodeFilter(t))) out.push(e.target);
    }
    return out;
  };
  for (const root of ids) {
    if (idx.has(root)) continue;
    const work: { id: string; next: string[]; i: number }[] = [{ id: root, next: succ(root), i: 0 }];
    idx.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1]!;
      if (frame.i < frame.next.length) {
        const w = frame.next[frame.i++]!;
        if (!idx.has(w)) {
          idx.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: succ(w), i: 0 });
        } else if (onStack.has(w)) low.set(frame.id, Math.min(low.get(frame.id)!, idx.get(w)!));
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        if (low.get(frame.id) === idx.get(frame.id)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== frame.id);
          if (comp.length > 1) result.push(comp.reverse());
        }
      }
    }
  }
  return result.sort((a, b) => b.length - a.length);
}

/** One concrete cycle path inside a strongly connected component. */
export function cyclePath(index: GraphIndex, component: string[], types: readonly EdgeType[] = ['IMPORTS']): GraphEdge[] {
  const set = new Set(component);
  const start = component[0]!;
  const allowed = new Set(types);
  const prev = new Map<string, GraphEdge>();
  let frontier = [start];
  const seen = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.out.get(id) ?? []) {
        if (!allowed.has(e.type) || !set.has(e.target)) continue;
        if (e.target === start) {
          const path = [e];
          for (let cur = id; cur !== start; ) {
            const pe = prev.get(cur)!;
            path.unshift(pe);
            cur = pe.source;
          }
          return path;
        }
        if (seen.has(e.target)) continue;
        seen.add(e.target);
        prev.set(e.target, e);
        next.push(e.target);
      }
    }
    frontier = next;
  }
  return [];
}

/** Everything that directly or transitively depends on `id` (reverse reachability). */
export function impactOf(index: GraphIndex, id: string, maxDepth = 5, maxNodes = 400): TraversalResult {
  // A change to a container affects dependants of its members too.
  const seeds = [id];
  for (const e of index.out.get(id) ?? []) if (e.type === 'CONTAINS') seeds.push(e.target);
  const merged: TraversalResult = { distances: new Map([[id, 0]]), edges: [], truncated: false };
  const edgeSeen = new Set<string>();
  for (const s of seeds) {
    const r = traverse(index, s, 'in', { maxDepth, maxNodes });
    for (const [k, v] of r.distances) if (!merged.distances.has(k) || merged.distances.get(k)! > v) merged.distances.set(k, v);
    for (const e of r.edges) {
      if (edgeSeen.has(e.id)) continue;
      edgeSeen.add(e.id);
      merged.edges.push(e);
    }
    merged.truncated ||= r.truncated;
  }
  return merged;
}

/** The file (or the node itself) that owns a symbol. */
export function containerChain(index: GraphIndex, id: string): GraphNode[] {
  const chain: GraphNode[] = [];
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent: GraphEdge | undefined = (index.in.get(cur) ?? []).find((e) => e.type === 'CONTAINS' && e.extractionMethod === 'filesystem');
    if (!parent) break;
    const n = index.nodes.get(parent.source);
    if (n) chain.unshift(n);
    cur = parent.source;
  }
  return chain;
}

/**
 * Louvain community detection on the undirected projection of dependency
 * edges. Writes `metadata.community` on each node and returns the count.
 */
export function assignCommunities(nodes: GraphNode[], edges: GraphEdge[]): number {
  const g = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n.id);
  const skip = new Set<EdgeType>(HIERARCHY_EDGES.filter((t) => t !== 'CONTAINS'));
  for (const e of edges) {
    if (skip.has(e.type) || e.source === e.target) continue;
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    // Containment keeps symbols near their file; dependencies pull related files together.
    const w = e.type === 'CONTAINS' ? 1.5 : 1;
    if (g.hasEdge(e.source, e.target)) g.updateEdgeAttribute(e.source, e.target, 'weight', (x: number | undefined) => (x ?? 0) + w);
    else g.addEdge(e.source, e.target, { weight: w });
  }
  if (g.size === 0) {
    for (const n of nodes) n.metadata.community = 0;
    return nodes.length ? 1 : 0;
  }
  // A fixed seed keeps community ids stable between runs on the same graph.
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const communities = louvain(g, { getEdgeWeight: 'weight', rng, resolution: 1 });
  const remap = new Map<number, number>();
  for (const n of nodes) {
    const c = communities[n.id] ?? -1;
    if (!remap.has(c)) remap.set(c, remap.size);
    n.metadata.community = remap.get(c)!;
  }
  return remap.size;
}

export { HIERARCHY_EDGES };
