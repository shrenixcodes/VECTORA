import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import { ChevronRight, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  EDGE_TYPES,
  EDGE_TYPE_LABELS,
  type EdgeType,
  type GraphNode,
  isSymbolType,
} from '@vectora/graph-schema';
import { ViewToolbar } from '@/components/ViewControls';
import { cx } from '@/components/ui';
import { downloadUrl } from '@/lib/api';
import { type Adjacency, fileIdOf } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import { FAMILY_GLYPH, NODE_FAMILY } from '@/lib/tokens';
import { useWs } from './context';

interface TreeItem {
  /** Tree-unique key. A graph node can appear under several branches (e.g. a file under a subsystem and a concept). */
  key: string;
  nodeId: string | null;
  label: string;
  node: GraphNode | null;
  children: TreeItem[];
  derived?: boolean;
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Builds the conceptual hierarchy from the knowledge graph:
 * repository → subsystems → folders → files → symbols, plus a branch of concepts.
 */
export function buildTree(adj: Adjacency, hiddenTypes: ReadonlySet<string>): TreeItem | null {
  const repo = adj.nodes.get('repo:root');
  if (!repo) return null;
  const symbolChildren = (parentId: string, prefix: string, depth = 0): TreeItem[] =>
    depth > 3
      ? []
      : (adj.out.get(parentId) ?? [])
          .filter((e) => e.type === 'CONTAINS')
          .map((e) => adj.nodes.get(e.target))
          .filter((n): n is GraphNode => !!n && isSymbolType(n.type) && !hiddenTypes.has(n.type))
          .sort((a, b) => (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0))
          .map((n) => ({
            key: `${prefix}>${n.id}`,
            nodeId: n.id,
            label: n.name,
            node: n,
            children: symbolChildren(n.id, prefix, depth + 1),
          }));
  const fileItem = (f: GraphNode, prefix: string): TreeItem => ({
    key: `${prefix}>${f.id}`,
    nodeId: f.id,
    label: f.name,
    node: f,
    children: symbolChildren(f.id, prefix),
  });

  const subsystems = [...adj.nodes.values()]
    .filter((n) => n.type === 'Subsystem')
    .sort((a, b) => Number(b.metadata.files ?? 0) - Number(a.metadata.files ?? 0));
  const subsystemItems: TreeItem[] = subsystems.map((s) => {
    const base = String(s.filePath ?? '');
    const files = (adj.in.get(s.id) ?? [])
      .filter((e) => e.type === 'BELONGS_TO')
      .map((e) => adj.nodes.get(e.source))
      .filter((n): n is GraphNode => !!n && !hiddenTypes.has(n.type));
    // Group files by folder below the subsystem root.
    const root: TreeItem = { key: s.id, nodeId: s.id, label: s.name, node: s, children: [] };
    const folders = new Map<string, TreeItem>([['', root]]);
    const folder = (rel: string): TreeItem => {
      const existing = folders.get(rel);
      if (existing) return existing;
      const parent = folder(dirOf(rel));
      const full = base ? `${base}/${rel}` : rel;
      const dirNode = adj.nodes.get(`dir:${full}`) ?? null;
      const item: TreeItem = {
        key: `${s.id}>dir:${full}`,
        nodeId: dirNode?.id ?? null,
        label: rel.slice(rel.lastIndexOf('/') + 1),
        node: dirNode,
        children: [],
      };
      folders.set(rel, item);
      parent.children.push(item);
      return item;
    };
    for (const f of files.sort((a, b) => (a.filePath! < b.filePath! ? -1 : 1))) {
      const rel =
        base && f.filePath!.startsWith(`${base}/`) ? f.filePath!.slice(base.length + 1) : f.filePath!;
      folder(dirOf(rel)).children.push(fileItem(f, s.id));
    }
    // A folder that only holds one folder is merged into it (`src/app` instead of `src` → `app`).
    const squash = (item: TreeItem): TreeItem => {
      item.children = item.children.map(squash);
      if (
        item !== root &&
        item.node?.type !== 'File' &&
        item.children.length === 1 &&
        item.children[0]!.children.length &&
        !item.children[0]!.node?.location
      ) {
        const only = item.children[0]!;
        return { ...only, label: `${item.label}/${only.label}` };
      }
      return item;
    };
    return squash(root);
  });

  const concepts = [...adj.nodes.values()].filter((n) => n.type === 'Concept');
  const conceptBranch: TreeItem | null = concepts.length
    ? {
        key: 'branch:concepts',
        nodeId: null,
        label: 'Concepts',
        node: null,
        derived: true,
        children: concepts
          .map((c) => ({
            key: c.id,
            nodeId: c.id,
            label: c.name,
            node: c,
            derived: true,
            children: (adj.in.get(c.id) ?? [])
              .filter((e) => e.type === 'BELONGS_TO')
              .sort((a, b) => b.confidence - a.confidence)
              .map((e) => adj.nodes.get(e.source))
              .filter((n): n is GraphNode => !!n)
              .map((f) => fileItem(f, c.id)),
          }))
          .sort((a, b) => b.children.length - a.children.length),
      }
    : null;
  return {
    key: repo.id,
    nodeId: repo.id,
    label: repo.name,
    node: repo,
    children: [...subsystemItems, ...(conceptBranch ? [conceptBranch] : [])],
  };
}

interface MindData extends Record<string, unknown> {
  item: TreeItem;
  collapsed: boolean;
  depth: number;
  selected: boolean;
  dimmed: boolean;
  matched: boolean;
  onToggle: (key: string) => void;
}

const MindNode = memo(function MindNode({ data }: NodeProps<Node<MindData>>) {
  const { item, collapsed, depth, selected, dimmed, matched } = data;
  const count = item.children.length;
  return (
    <div
      className={cx(
        'flex items-center gap-2 border bg-elevated px-3 py-1.5 transition-opacity duration-200',
        selected ? 'border-indigo outline outline-1 outline-indigo' : matched ? 'border-clay' : 'border-line',
        item.derived && 'border-dashed',
        dimmed && 'opacity-35',
      )}
      style={{ width: '100%', height: '100%', boxSizing: 'border-box' }}
      data-testid="mind-node"
      data-key={item.key}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1 !w-1 !border-0 !bg-transparent"
        isConnectable={false}
      />
      {item.node ? (
        <span className="meta shrink-0" aria-hidden="true">
          {FAMILY_GLYPH[NODE_FAMILY[item.node.type]]}
        </span>
      ) : null}
      <span
        className={cx(
          'truncate',
          depth === 0
            ? 'font-editorial text-[1.0625rem]'
            : depth === 1
              ? 'text-[0.875rem] font-medium'
              : 'font-mono text-[0.75rem]',
        )}
        title={item.node?.filePath ?? item.label}
      >
        {item.label}
      </span>
      {count ? (
        <button
          type="button"
          className="nodrag meta -mr-1 ml-auto flex shrink-0 cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0.5 hover:text-ink"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${item.label}, ${count} items`}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(item.key);
          }}
        >
          {count}
          <ChevronRight
            size={12}
            className={cx('transition-transform duration-200', !collapsed && 'rotate-90')}
          />
        </button>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1 !w-1 !border-0 !bg-transparent"
        isConnectable={false}
      />
    </div>
  );
});

const nodeTypes = { mind: MindNode };
const NODE_H = 34;
const widthOf = (item: TreeItem, depth: number) =>
  Math.min(300, Math.max(128, item.label.length * (depth === 0 ? 10.5 : depth === 1 ? 9 : 7.6) + 84));

function MindMapInner() {
  const { adj, graph, palette, reveal, reducedMotion } = useWs();
  const flow = useReactFlow();
  const selectedIds = useWorkspace((s) => s.selectedIds);
  const hiddenNodeTypes = useWorkspace((s) => s.hiddenNodeTypes);
  const revealTick = useWorkspace((s) => s.revealTick);
  const layouts = useWorkspace((s) => s.layouts);
  const setLayout = useWorkspace((s) => s.setLayout);
  const [query, setQuery] = useState('');
  const [relation, setRelation] = useState<EdgeType | ''>('');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  // Folders are part of the hierarchy here even when hidden in the other views.
  const hidden = useMemo(
    () =>
      new Set(hiddenNodeTypes.filter((t) => t !== 'Directory' && t !== 'Module' && t !== 'Configuration')),
    [hiddenNodeTypes],
  );
  const tree = useMemo(() => buildTree(adj, hidden), [adj, hidden]);

  // Collapsed state: everything below the second level starts collapsed.
  const defaultCollapsed = useMemo(() => {
    const out: string[] = [];
    const walk = (item: TreeItem, depth: number) => {
      if (depth >= 1 && item.children.length) out.push(item.key);
      item.children.forEach((c) => walk(c, depth + 1));
    };
    if (tree) walk(tree, 0);
    return out;
  }, [tree]);
  const childKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    const walk = (item: TreeItem) => {
      m.set(
        item.key,
        item.children.map((c) => c.key),
      );
      item.children.forEach(walk);
    };
    if (tree) walk(tree);
    return m;
  }, [tree]);
  const collapsedList = layouts.mindmapCollapsed ?? defaultCollapsed;
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(useWorkspace.getState().layouts.mindmapCollapsed ?? defaultCollapsed);
      const expanding = next.has(key);
      if (expanding) next.delete(key);
      else next.add(key);
      setLayout('mindmapCollapsed', [...next]);
      // Keep a newly opened branch on screen: pan (and zoom out if needed) to show it with its children.
      if (expanding)
        setTimeout(() => {
          const ids = [key, ...(childKeys.get(key) ?? []).slice(0, 60)].filter((id) => flow.getNode(id));
          void flow.fitView({
            nodes: ids.map((id) => ({ id })),
            padding: 0.25,
            maxZoom: flow.getZoom(),
            duration: reducedMotion ? 0 : 380,
          });
        }, 80);
    },
    [defaultCollapsed, setLayout, childKeys, flow, reducedMotion],
  );

  // Paths from the root to every tree item, for search and reveal.
  const index = useMemo(() => {
    const pathTo = new Map<string, string[]>();
    const byNode = new Map<string, string[]>();
    const walk = (item: TreeItem, path: string[]) => {
      pathTo.set(item.key, path);
      if (item.nodeId)
        (byNode.get(item.nodeId) ?? byNode.set(item.nodeId, []).get(item.nodeId)!).push(item.key);
      item.children.forEach((c) => walk(c, [...path, item.key]));
    };
    if (tree) walk(tree, []);
    return { pathTo, byNode };
  }, [tree]);

  const expandTo = useCallback(
    (key: string) => {
      const path = index.pathTo.get(key);
      if (!path) return;
      const next = new Set(useWorkspace.getState().layouts.mindmapCollapsed ?? defaultCollapsed);
      path.forEach((k) => next.delete(k));
      setLayout('mindmapCollapsed', [...next]);
    },
    [index, defaultCollapsed, setLayout],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !tree) return [] as string[];
    const out: string[] = [];
    const walk = (item: TreeItem) => {
      if (item.label.toLowerCase().includes(q) || item.node?.filePath?.toLowerCase().includes(q))
        out.push(item.key);
      item.children.forEach(walk);
    };
    walk(tree);
    return out.slice(0, 200);
  }, [query, tree]);

  // ---- visible items and layout ------------------------------------------
  const { nodes, edges } = useMemo(() => {
    if (!tree) return { nodes: [] as Node<MindData>[], edges: [] as Edge[] };
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 56, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    const visible: { item: TreeItem; depth: number; parent: string | null }[] = [];
    const walk = (item: TreeItem, depth: number, parent: string | null) => {
      visible.push({ item, depth, parent });
      g.setNode(item.key, { width: widthOf(item, depth), height: depth === 0 ? 42 : NODE_H });
      if (parent) g.setEdge(parent, item.key);
      if (!collapsed.has(item.key)) item.children.slice(0, 250).forEach((c) => walk(c, depth + 1, item.key));
    };
    walk(tree, 0, null);
    dagre.layout(g);
    const selected = new Set(selectedIds);
    const matchSet = new Set(matches);
    const overrides = layouts.mindmap ?? {};
    const rfNodes: Node<MindData>[] = visible.map(({ item, depth }) => {
      const p = g.node(item.key);
      const o = overrides[item.key];
      return {
        id: item.key,
        type: 'mind',
        position: o ? { x: o[0], y: o[1] } : { x: p.x - p.width / 2, y: p.y - p.height / 2 },
        data: {
          item,
          collapsed: collapsed.has(item.key),
          depth,
          selected: !!item.nodeId && selected.has(item.nodeId),
          dimmed: matchSet.size > 0 && !matchSet.has(item.key),
          matched: matchSet.has(item.key),
          onToggle: toggle,
        },
        width: p.width,
        height: p.height,
      };
    });
    const rfEdges: Edge[] = visible
      .filter((v) => v.parent)
      .map((v) => ({
        id: `tree:${v.parent}>${v.item.key}`,
        source: v.parent!,
        target: v.item.key,
        type: 'smoothstep',
        selectable: false,
        style: { stroke: palette.ash, strokeWidth: 1, strokeDasharray: v.item.derived ? '4 4' : undefined },
      }));

    // Relationship overlay: draw the chosen relationship between visible items,
    // lifting each end to its nearest visible ancestor.
    if (relation) {
      const visibleByNode = new Map<string, string>();
      for (const v of visible)
        if (v.item.nodeId && !visibleByNode.has(v.item.nodeId)) visibleByNode.set(v.item.nodeId, v.item.key);
      const lift = (id: string): string | null => {
        let cur: GraphNode | undefined = adj.nodes.get(id);
        for (let i = 0; cur && i < 6; i++) {
          const k = visibleByNode.get(cur.id);
          if (k) return k;
          const parentEdge = (adj.in.get(cur.id) ?? []).find((e) => e.type === 'CONTAINS');
          cur = parentEdge
            ? adj.nodes.get(parentEdge.source)
            : cur.filePath && cur.id !== fileIdOf(cur)
              ? adj.nodes.get(fileIdOf(cur)!)
              : undefined;
        }
        return null;
      };
      const seen = new Map<string, { count: number; verified: boolean }>();
      for (const e of graph.edges) {
        if (e.type !== relation) continue;
        const a = lift(e.source);
        const b = lift(e.target);
        if (!a || !b || a === b) continue;
        const k = `${a}|${b}`;
        const cur = seen.get(k);
        if (cur) cur.count++;
        else seen.set(k, { count: 1, verified: e.verified });
        if (seen.size > 400) break;
      }
      for (const [k, v] of seen) {
        const [a, b] = k.split('|') as [string, string];
        rfEdges.push({
          id: `rel:${k}`,
          source: a,
          target: b,
          type: 'default',
          selectable: false,
          label: v.count > 1 ? `${EDGE_TYPE_LABELS[relation]} ×${v.count}` : EDGE_TYPE_LABELS[relation],
          labelStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fill: palette.textSecondary },
          labelBgStyle: { fill: palette.canvas },
          style: {
            stroke: v.verified ? palette.relationActive : palette.relationUnverified,
            strokeWidth: 1.2,
            strokeDasharray: v.verified ? undefined : '5 4',
          },
          markerEnd: {
            type: 'arrowclosed' as never,
            color: v.verified ? palette.relationActive : palette.relationUnverified,
            width: 14,
            height: 14,
          },
          zIndex: 5,
        });
      }
    }
    return { nodes: rfNodes, edges: rfEdges };
  }, [tree, collapsed, selectedIds, matches, layouts.mindmap, palette, relation, adj, graph.edges, toggle]);

  // While a branch is being dragged only its position changes; the layout is not recomputed.
  const displayNodes = useMemo(
    () =>
      drag ? nodes.map((n) => (n.id === drag.id ? { ...n, position: { x: drag.x, y: drag.y } } : n)) : nodes,
    [nodes, drag],
  );

  // ---- focus: bring a node into view -------------------------------------
  const centreOn = useCallback(
    (key: string) => {
      expandTo(key);
      setTimeout(() => {
        const n = flow.getNode(key);
        if (n)
          void flow.setCenter(n.position.x + (n.width ?? 120) / 2, n.position.y + NODE_H / 2, {
            zoom: Math.max(flow.getZoom(), 0.9),
            duration: reducedMotion ? 0 : 420,
          });
      }, 60);
    },
    [expandTo, flow, reducedMotion],
  );
  useEffect(() => {
    if (revealTick === 0) return;
    const id = useWorkspace.getState().primaryId;
    const key = id ? index.byNode.get(id)?.[0] : null;
    if (key) centreOn(key);
  }, [revealTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportImage = async (kind: 'png' | 'svg') => {
    const el = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!el) return;
    const bounds = getNodesBounds(flow.getNodes());
    const width = Math.min(8000, Math.max(800, bounds.width + 160));
    const height = Math.min(8000, Math.max(500, bounds.height + 160));
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.05);
    const options = {
      backgroundColor: palette.canvas,
      width,
      height,
      // Fonts are bundled with the application; skipping remote font inlining keeps the export offline.
      skipFonts: true,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    };
    const url = kind === 'png' ? await toPng(el, options) : await toSvg(el, options);
    downloadUrl(`vectora-mindmap.${kind}`, url);
  };

  if (!tree) return null;
  return (
    <div className="relative h-full w-full" data-testid="mindmap">
      <ViewToolbar>
        <input
          type="search"
          className="field h-[28px] min-h-0 w-[200px] bg-elevated py-0 text-[0.75rem]"
          placeholder="Find in the mind map"
          aria-label="Find in the mind map"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              centreOn(matches[0]);
              const item = nodes.find((n) => n.id === matches[0])?.data.item;
              if (item?.nodeId) useWorkspace.getState().select(item.nodeId);
            }
          }}
        />
        {query.trim().length >= 2 ? (
          <span className="meta bg-canvas/80 px-1">{matches.length} found — Enter focuses the first</span>
        ) : null}
        <label className="btn btn-sm bg-elevated gap-1 pr-1">
          Show relationship
          <select
            className="cursor-pointer border-0 bg-transparent text-[0.75rem] text-ink outline-none"
            value={relation}
            onChange={(e) => setRelation(e.target.value as EdgeType | '')}
            data-testid="mind-relation"
          >
            <option value="">none</option>
            {EDGE_TYPES.filter(
              (t) =>
                !['CONTAINS', 'DEFINED_IN', 'BELONGS_TO', 'EXPORTS'].includes(t) &&
                (graph.stats.edgesByType[t] ?? 0) > 0,
            ).map((t) => (
              <option key={t} value={t}>
                {EDGE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm bg-elevated" onClick={() => setLayout('mindmapCollapsed', [])}>
          Expand all
        </button>
        <button
          className="btn btn-sm bg-elevated"
          onClick={() => {
            setLayout('mindmapCollapsed', undefined);
            setLayout('mindmap', undefined);
            setTimeout(() => void flow.fitView({ duration: reducedMotion ? 0 : 400 }), 60);
          }}
        >
          <RotateCcw size={13} strokeWidth={1.5} aria-hidden="true" />
          Reset layout
        </button>
        <button
          className="btn btn-sm bg-elevated"
          onClick={() => void exportImage('svg')}
          data-testid="mind-export-svg"
        >
          <ImageIcon size={13} strokeWidth={1.5} aria-hidden="true" />
          SVG
        </button>
        <button className="btn btn-sm bg-elevated" onClick={() => void exportImage('png')}>
          PNG
        </button>
      </ViewToolbar>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.05}
        maxZoom={2}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements={nodes.length > 600}
        proOptions={{ hideAttribution: false }}
        onNodeClick={(e, n) => {
          const item = (n.data as MindData).item;
          if (item.nodeId)
            useWorkspace.getState().select(item.nodeId, { additive: e.ctrlKey || e.metaKey || e.shiftKey });
        }}
        onNodeDoubleClick={(_e, n) => {
          const item = (n.data as MindData).item;
          if (item.children.length) toggle(item.key);
          else if (item.nodeId) reveal(item.nodeId);
        }}
        onNodeDrag={(_e, n) => setDrag({ id: n.id, x: n.position.x, y: n.position.y })}
        onNodeDragStop={(_e, n) => {
          setDrag(null);
          // Rearranged branches keep their position for this workspace.
          setLayout('mindmap', {
            ...(useWorkspace.getState().layouts.mindmap ?? {}),
            [n.id]: [Math.round(n.position.x), Math.round(n.position.y)],
          });
        }}
        onNodesChange={() => undefined}
        onPaneClick={() => useWorkspace.getState().clearSelection()}
        aria-label="Hierarchical mind map of the repository"
      >
        <Background gap={24} size={1} color={palette.line} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          nodeColor={palette.ash}
          nodeStrokeWidth={0}
          position="bottom-right"
          className="!hidden sm:!block"
          ariaLabel="Mind map overview"
        />
      </ReactFlow>
    </div>
  );
}

export function MindMap() {
  return (
    <ReactFlowProvider>
      <MindMapInner />
    </ReactFlowProvider>
  );
}
