import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import noverlap from 'graphology-layout-noverlap';
import { Image as ImageIcon, Maximize, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import { seed2d } from '@vectora/graph-layout';
import { EDGE_TYPE_LABELS, type GraphNode, isSymbolType } from '@vectora/graph-schema';
import { ViewToolbar } from '@/components/ViewControls';
import { downloadUrl } from '@/lib/api';
import { fileIdOf, neighbourhood } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import {
  FAMILY_GLYPH,
  NODE_FAMILY,
  NODE_SIZE,
  STRUCTURE_EDGES,
  type Palette,
  mix,
  nodeColor,
} from '@/lib/tokens';
import { useWs } from './context';

type Grouping = 'subsystem' | 'community';

interface RenderState {
  selected: Set<string>;
  primary: string | null;
  hover: string | null;
  activeNodes: Set<string> | null;
  activeEdges: Set<string> | null;
  palette: Palette;
}

const LABEL_THRESHOLD = { low: 11, medium: 7.5, high: 4.5 } as const;
const LABEL_DENSITY = { low: 0.4, medium: 0.9, high: 1.8 } as const;

export function GraphExplorer() {
  const { view, adj, palette, settings, reducedMotion, expandFile, theme } = useWs();
  const selectedIds = useWorkspace((s) => s.selectedIds);
  const primaryId = useWorkspace((s) => s.primaryId);
  const hoverId = useWorkspace((s) => s.hoverId);
  const highlight = useWorkspace((s) => s.highlight);
  const revealTick = useWorkspace((s) => s.revealTick);
  const container = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<{ stop: () => void } | null>(null);
  const stateRef = useRef<RenderState>({
    selected: new Set(),
    primary: null,
    hover: null,
    activeNodes: null,
    activeEdges: null,
    palette,
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [grouping, setGrouping] = useState<Grouping>('subsystem');
  const [arranging, setArranging] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const groupingRef = useRef(grouping);
  groupingRef.current = grouping;

  const saveLayout = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const out: Record<string, [number, number]> = { ...(useWorkspace.getState().layouts.graph ?? {}) };
    g.forEachNode((id, a) => {
      out[id] = [Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100];
    });
    const entries = Object.entries(out);
    useWorkspace
      .getState()
      .setLayout('graph', entries.length > 20000 ? Object.fromEntries(entries.slice(-20000)) : out);
  }, []);

  const runLayout = useCallback(
    (fromScratch: boolean) => {
      const g = graphRef.current;
      if (!g || g.order === 0) return;
      layoutRef.current?.stop();
      if (fromScratch) {
        const seeds = seed2d(
          viewRef.current.nodes.map((n) => ({
            id: n.id,
            group:
              groupingRef.current === 'community'
                ? ((n.metadata.community as number | undefined) ?? null)
                : ((n.metadata.subsystem as string | undefined) ?? n.type),
          })),
        );
        g.forEachNode((id) => {
          const p = seeds.get(id);
          if (p) g.mergeNodeAttributes(id, { x: p[0], y: p[1] });
        });
      }
      const fa2 = {
        ...forceAtlas2.inferSettings(g),
        barnesHutOptimize: g.order > 1200,
        gravity: 0.5,
        scalingRatio: 8,
        slowDown: 6 + Math.log(g.order + 1),
        strongGravityMode: false,
      };
      const finish = () => {
        noverlap.assign(g, { maxIterations: g.order > 3000 ? 15 : 60, settings: { margin: 2, ratio: 1.1 } });
        setArranging(false);
        saveLayout();
      };
      if (reducedMotion) {
        // No animated settling: compute the arrangement in one step.
        forceAtlas2.assign(g, { iterations: g.order > 3000 ? 40 : g.order > 800 ? 100 : 220, settings: fa2 });
        finish();
        return;
      }
      const layout = new FA2Layout(g, { settings: fa2 });
      layout.start();
      setArranging(true);
      const base = settings.graph.animationIntensity === 'standard' ? 4200 : 2400;
      const timer = setTimeout(() => stop(), base * (g.order > 3000 ? 1.8 : 1));
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        layout.kill();
        if (graphRef.current === g) finish();
      };
      layoutRef.current = { stop };
    },
    [reducedMotion, settings.graph.animationIntensity, saveLayout],
  );

  // ---- create the renderer once ------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const g = new Graph({ multi: true, type: 'directed' });
    graphRef.current = g;
    let sigma: Sigma;
    try {
      sigma = new Sigma(g, container.current, {
        allowInvalidContainer: true,
        defaultEdgeType: 'arrow',
        renderEdgeLabels: true,
        zIndex: true,
        labelFont: '"Zen Kaku Gothic New", system-ui, sans-serif',
        labelSize: 12,
        labelWeight: '400',
        edgeLabelFont: '"IBM Plex Mono", monospace',
        edgeLabelSize: 10,
        minCameraRatio: 0.015,
        maxCameraRatio: 6,
        stagePadding: 60,
        nodeReducer: (id, data) => {
          const s = stateRef.current;
          const res = { ...data };
          const isSelected = s.selected.has(id);
          if (s.activeNodes && !s.activeNodes.has(id) && !isSelected) {
            res.color = mix(data.color as string, s.palette.canvas, 0.8);
            res.label = '';
            res.zIndex = 0;
          } else if (s.activeNodes) {
            res.zIndex = 1;
            if (s.activeNodes.size <= 60) res.forceLabel = true;
          }
          if (isSelected || id === s.hover) {
            res.highlighted = true;
            res.forceLabel = true;
            res.zIndex = 2;
            res.size = (data.size as number) * 1.35;
          }
          return res;
        },
        edgeReducer: (id, data) => {
          const s = stateRef.current;
          const res = { ...data };
          if (s.activeEdges) {
            if (s.activeEdges.has(id)) {
              res.color = data.verified ? s.palette.relationActive : s.palette.relationUnverified;
              res.size = data.verified ? 1.8 : 1;
              res.label = `${data.relation as string}${data.verified ? '' : ' (derived)'}`;
              res.forceLabel = s.activeEdges.size <= 40;
              res.zIndex = 2;
            } else {
              res.color = mix(data.color as string, s.palette.canvas, 0.75);
              res.label = '';
              res.zIndex = 0;
            }
          } else res.label = '';
          return res;
        },
        // Hover label drawn with theme colours instead of the library's white box.
        defaultDrawNodeHover: (ctx, data, st) => {
          const p = stateRef.current.palette;
          const size = st.labelSize;
          ctx.font = `${st.labelWeight} ${size}px ${st.labelFont}`;
          const label = typeof data.label === 'string' ? data.label : '';
          const w = label ? ctx.measureText(label).width + 12 : 0;
          ctx.beginPath();
          ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
          ctx.strokeStyle = p.selection;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (!label) return;
          ctx.fillStyle = p.elevated;
          ctx.strokeStyle = p.line;
          ctx.lineWidth = 1;
          const x = data.x + data.size + 6;
          ctx.fillRect(x, data.y - size / 2 - 4, w, size + 8);
          ctx.strokeRect(x, data.y - size / 2 - 4, w, size + 8);
          ctx.fillStyle = p.text;
          ctx.fillText(label, x + 6, data.y + size / 3);
        },
      });
    } catch (err) {
      setFailed((err as Error).message);
      return;
    }
    sigmaRef.current = sigma;
    const ws = useWorkspace.getState;

    sigma.on('clickNode', (e) => {
      const ev = e.event.original as MouseEvent;
      ws().select(e.node, { additive: ev.ctrlKey || ev.metaKey || ev.shiftKey });
    });
    sigma.on('doubleClickNode', (e) => {
      e.preventSigmaDefault();
      expandRef.current(e.node);
    });
    sigma.on('enterNode', (e) => {
      ws().setHover(e.node);
      if (container.current) container.current.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      ws().setHover(null);
      if (container.current) container.current.style.cursor = '';
    });
    sigma.on('clickStage', () => ws().clearSelection());

    // Dragging nodes to rearrange the layout.
    let dragged: string | null = null;
    let moved = false;
    sigma.on('downNode', (e) => {
      dragged = e.node;
      moved = false;
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!dragged) return;
      moved = true;
      layoutRef.current?.stop();
      const pos = sigma.viewportToGraph(e);
      g.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y });
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    const release = () => {
      if (dragged && moved) saveLayout();
      dragged = null;
    };
    sigma.getMouseCaptor().on('mouseup', release);

    // Minimap, redrawn at most every 120 ms.
    let pending = false;
    const drawMinimap = () => {
      pending = false;
      const c = minimap.current;
      if (!c || g.order === 0) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const p = stateRef.current.palette;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      g.forEachNode((_, a) => {
        if (a.x < minX) minX = a.x;
        if (a.x > maxX) maxX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.y > maxY) maxY = a.y;
      });
      const pad = 8;
      const sx = (c.width - pad * 2) / Math.max(1e-6, maxX - minX);
      const sy = (c.height - pad * 2) / Math.max(1e-6, maxY - minY);
      const k = Math.min(sx, sy);
      const ox = (c.width - (maxX - minX) * k) / 2;
      const oy = (c.height - (maxY - minY) * k) / 2;
      const map = (x: number, y: number): [number, number] => [
        ox + (x - minX) * k,
        c.height - (oy + (y - minY) * k),
      ];
      ctx.clearRect(0, 0, c.width, c.height);
      const step = Math.max(1, Math.floor(g.order / 2500));
      let i = 0;
      g.forEachNode((id, a) => {
        if (i++ % step) return;
        const [x, y] = map(a.x, a.y);
        ctx.fillStyle = stateRef.current.selected.has(id) ? p.selection : p.textMuted;
        const r = stateRef.current.selected.has(id) ? 2.5 : 1;
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      });
      const dims = sigma.getDimensions();
      const a = sigma.viewportToGraph({ x: 0, y: 0 });
      const b = sigma.viewportToGraph({ x: dims.width, y: dims.height });
      const [x1, y1] = map(a.x, a.y);
      const [x2, y2] = map(b.x, b.y);
      ctx.strokeStyle = p.selection;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      (c as HTMLCanvasElement & { _unmap?: (px: number, py: number) => { x: number; y: number } })._unmap = (
        px,
        py,
      ) => ({ x: minX + (px - ox) / k, y: minY + (c.height - py - oy) / k });
    };
    sigma.on('afterRender', () => {
      if (pending) return;
      pending = true;
      setTimeout(drawMinimap, 120);
    });

    return () => {
      layoutRef.current?.stop();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Double-click: a file unfolds its symbols; any other node unfolds the files around it. */
  const expandAround = (id: string) => {
    const n = adj.nodes.get(id);
    if (!n) return;
    if (n.type === 'File' || n.type === 'Configuration') return expandFile(id);
    const files = new Set<string>();
    const own = fileIdOf(n);
    if (own) files.add(own);
    for (const e of [...(adj.out.get(id) ?? []), ...(adj.in.get(id) ?? [])]) {
      const other = adj.nodes.get(e.source === id ? e.target : e.source);
      if (!other) continue;
      if (other.type === 'File') files.add(other.id);
      else if (isSymbolType(other.type)) {
        const fid = fileIdOf(other);
        if (fid) files.add(fid);
      }
    }
    [...files].slice(0, 40).forEach((f) => expandFile(f, true));
  };
  const expandRef = useRef(expandAround);
  expandRef.current = expandAround;

  // ---- sync graph data ----------------------------------------------------
  useEffect(() => {
    const g = graphRef.current;
    const sigma = sigmaRef.current;
    if (!g || !sigma) return;
    const saved = useWorkspace.getState().layouts.graph ?? {};
    const wanted = new Set(view.nodes.map((n) => n.id));
    g.forEachNode((id) => {
      if (!wanted.has(id)) g.dropNode(id);
    });
    const fresh: GraphNode[] = [];
    const scale = view.nodes.length > 4000 ? 0.75 : view.nodes.length > 1500 ? 0.9 : 1.15;
    for (const n of view.nodes) {
      const attrs = {
        label: `${FAMILY_GLYPH[NODE_FAMILY[n.type]]} ${n.name}`,
        size: NODE_SIZE[n.type] * scale + 1.2,
        color: nodeColor(n.type, palette),
        nodeType: n.type,
      };
      if (g.hasNode(n.id)) g.mergeNodeAttributes(n.id, attrs);
      else {
        const s = saved[n.id];
        if (!s) fresh.push(n);
        g.addNode(n.id, { ...attrs, x: s?.[0] ?? 0, y: s?.[1] ?? 0 });
      }
    }
    // New nodes start next to something they belong to, so expansion grows outwards from the parent.
    const firstRun = fresh.length === view.nodes.length;
    if (fresh.length && !firstRun) {
      fresh.forEach((n, i) => {
        const anchor = [fileIdOf(n), n.metadata.subsystem as string | undefined].find(
          (a) => a && a !== n.id && g.hasNode(a) && !fresh.some((f) => f.id === a),
        );
        const a = anchor ? g.getNodeAttributes(anchor) : { x: 0, y: 0 };
        const t = i * 2.399963;
        const r = 2 + Math.sqrt(i + 1) * 1.6;
        g.mergeNodeAttributes(n.id, { x: a.x + Math.cos(t) * r, y: a.y + Math.sin(t) * r });
      });
    }
    g.clearEdges();
    for (const e of view.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      const structural = STRUCTURE_EDGES.includes(e.type);
      g.addEdgeWithKey(e.id, e.source, e.target, {
        size: !e.verified ? 0.5 : structural ? 0.6 : 1,
        color: mix(
          e.verified ? palette.textMuted : palette.relationUnverified,
          palette.canvas,
          structural ? 0.55 : 0.3,
        ),
        type: structural ? 'line' : 'arrow',
        relation: EDGE_TYPE_LABELS[e.type],
        verified: e.verified,
        weight: structural ? 2 : 1,
      });
    }
    sigma.setSetting('hideEdgesOnMove', view.edges.length > 5000);
    sigma.setSetting('hideLabelsOnMove', view.nodes.length > 5000);
    if (sigma.getCustomBBox()) sigma.setCustomBBox(null);
    if (firstRun) runLayout(true);
    else if (fresh.length) runLayout(false);
    else sigma.refresh();
  }, [view, palette, runLayout]);

  // ---- settings and theme -------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting('labelColor', { color: palette.text });
    sigma.setSetting('edgeLabelColor', { color: palette.textSecondary });
    sigma.setSetting('labelRenderedSizeThreshold', LABEL_THRESHOLD[settings.graph.labelDensity]);
    sigma.setSetting('labelDensity', LABEL_DENSITY[settings.graph.labelDensity]);
    stateRef.current.palette = palette;
    sigma.refresh();
  }, [palette, theme, settings.graph.labelDensity]);

  // ---- selection, hover and highlight ------------------------------------
  useEffect(() => {
    const s = stateRef.current;
    s.selected = new Set(selectedIds);
    s.primary = primaryId;
    s.hover = hoverId;
    const centre = hoverId ?? primaryId;
    if (centre && graphRef.current?.hasNode(centre)) {
      const nb = neighbourhood(centre, view.edges);
      for (const id of selectedIds)
        if (id !== centre) for (const x of neighbourhood(id, view.edges).nodes) nb.nodes.add(x);
      s.activeNodes = nb.nodes;
      s.activeEdges = nb.edges;
    } else if (highlight) {
      s.activeNodes = new Set(highlight.nodeIds);
      s.activeEdges = new Set(highlight.edgeIds);
    } else {
      s.activeNodes = null;
      s.activeEdges = null;
    }
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [selectedIds, primaryId, hoverId, highlight, view]);

  // ---- bring the selection into view -------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    const id = useWorkspace.getState().primaryId ?? useWorkspace.getState().focusId;
    if (!sigma || revealTick === 0) return;
    const t = setTimeout(() => {
      if (id && graphRef.current?.hasNode(id) && settings.graph.focusBehavior !== 'none') {
        const d = sigma.getNodeDisplayData(id);
        if (d)
          void sigma
            .getCamera()
            .animate(
              { x: d.x, y: d.y, ratio: Math.min(sigma.getCamera().ratio, 0.4) },
              { duration: reducedMotion ? 0 : 700 },
            );
      } else if (!id) void sigma.getCamera().animatedReset({ duration: reducedMotion ? 0 : 600 });
    }, 60);
    return () => clearTimeout(t);
  }, [revealTick, reducedMotion, settings.graph.focusBehavior]);

  const fit = () => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setCustomBBox(null);
    void sigma.getCamera().animatedReset({ duration: reducedMotion ? 0 : 500 });
  };
  const exportPng = () => {
    const sigma = sigmaRef.current;
    if (!sigma || !container.current) return;
    sigma.once('afterRender', () => {
      const { width, height } = sigma.getDimensions();
      const ratio = window.devicePixelRatio || 1;
      const out = document.createElement('canvas');
      out.width = width * ratio;
      out.height = height * ratio;
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = palette.canvas;
      ctx.fillRect(0, 0, out.width, out.height);
      container.current!.querySelectorAll('canvas').forEach((c) => {
        if (c !== minimap.current) ctx.drawImage(c, 0, 0, out.width, out.height);
      });
      downloadUrl('vectora-graph.png', out.toDataURL('image/png'));
    });
    sigma.refresh();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const cam = sigma.getCamera();
    const step = 0.12 * cam.ratio;
    const dur = { duration: reducedMotion ? 0 : 160 };
    if (e.key === '+' || e.key === '=') void cam.animatedZoom(dur);
    else if (e.key === '-') void cam.animatedUnzoom(dur);
    else if (e.key === '0') fit();
    else if (e.key === 'ArrowLeft') void cam.animate({ x: cam.x - step }, dur);
    else if (e.key === 'ArrowRight') void cam.animate({ x: cam.x + step }, dur);
    else if (e.key === 'ArrowUp') void cam.animate({ y: cam.y + step }, dur);
    else if (e.key === 'ArrowDown') void cam.animate({ y: cam.y - step }, dur);
    else if (e.key === 'n' || e.key === 'p') {
      // Step through the neighbours of the selection (or all nodes) without a pointer.
      const ws = useWorkspace.getState();
      const pool = ws.primaryId
        ? [...neighbourhood(ws.primaryId, view.edges).nodes]
        : view.nodes.map((n) => n.id);
      if (!pool.length) return;
      const i = pool.indexOf(ws.hoverId ?? ws.primaryId ?? '');
      ws.setHover(pool[(i + (e.key === 'n' ? 1 : -1) + pool.length) % pool.length]!);
    } else if (e.key === 'Enter') {
      const ws = useWorkspace.getState();
      if (ws.hoverId) ws.select(ws.hoverId, { reveal: true });
    } else return;
    e.preventDefault();
  };

  if (failed)
    return (
      <div className="p-8">
        <p className="font-editorial text-[1.25rem]">The graph renderer could not start</p>
        <p className="label mt-2">
          WebGL is not available in this browser ({failed}). The Mind Map and Search views work without it.
        </p>
      </div>
    );

  return (
    <div className="relative h-full w-full" data-testid="graph-explorer">
      <ViewToolbar status={arranging ? 'arranging' : undefined}>
        <button className="btn btn-sm bg-elevated" onClick={fit} title="Fit to view (0)">
          <Maximize size={13} strokeWidth={1.5} aria-hidden="true" />
          Fit
        </button>
        <label className="btn btn-sm bg-elevated gap-1 pr-1">
          Group by
          <select
            className="cursor-pointer border-0 bg-transparent font-inherit text-[0.75rem] text-ink outline-none"
            value={grouping}
            onChange={(e) => {
              groupingRef.current = e.target.value as Grouping;
              setGrouping(e.target.value as Grouping);
              runLayout(true);
            }}
          >
            <option value="subsystem">subsystem</option>
            <option value="community">community</option>
          </select>
        </label>
        <button className="btn btn-sm bg-elevated" onClick={() => runLayout(true)}>
          <RotateCw size={13} strokeWidth={1.5} aria-hidden="true" />
          Rearrange
        </button>
        <button className="btn btn-sm bg-elevated" onClick={exportPng}>
          <ImageIcon size={13} strokeWidth={1.5} aria-hidden="true" />
          PNG
        </button>
      </ViewToolbar>
      <div
        ref={container}
        className="sigma-container h-full w-full"
        tabIndex={0}
        role="application"
        aria-label="Graph explorer. Arrow keys pan, plus and minus zoom, 0 fits the graph, N and P step through nodes, Enter selects."
        onKeyDown={onKeyDown}
      />
      <canvas
        ref={minimap}
        width={176}
        height={120}
        className="absolute bottom-3 left-3 hidden cursor-crosshair border border-line bg-elevated/90 sm:block"
        aria-label="Minimap"
        data-testid="minimap"
        onClick={(e) => {
          const sigma = sigmaRef.current;
          const c = minimap.current as
            (HTMLCanvasElement & { _unmap?: (px: number, py: number) => { x: number; y: number } }) | null;
          if (!sigma || !c?._unmap) return;
          const r = c.getBoundingClientRect();
          const gp = c._unmap(
            ((e.clientX - r.left) / r.width) * c.width,
            ((e.clientY - r.top) / r.height) * c.height,
          );
          const framed = sigma.viewportToFramedGraph(sigma.graphToViewport(gp));
          void sigma.getCamera().animate({ x: framed.x, y: framed.y }, { duration: reducedMotion ? 0 : 400 });
        }}
      />
      <p className="meta pointer-events-none absolute bottom-3 right-3 hidden bg-canvas/80 px-2 py-1 lg:block">
        Click to inspect, double-click to unfold, Ctrl-click to add to the selection, drag to rearrange
      </p>
    </div>
  );
}
