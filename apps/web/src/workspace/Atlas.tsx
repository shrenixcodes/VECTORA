import { OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { ChevronRight, Globe, Image as ImageIcon, RotateCcw } from 'lucide-react';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { LayoutNode, LayoutRole } from '@vectora/graph-layout';
import { type GraphEdge, type GraphNode, NODE_TYPE_LABELS, isSymbolType } from '@vectora/graph-schema';
import { ViewToolbar } from '@/components/ViewControls';
import { Loading } from '@/components/ui';
import { downloadUrl } from '@/lib/api';
import { fileIdOf, neighbourhood } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import {
  FAMILY_GLYPH,
  NODE_FAMILY,
  NODE_SIZE,
  type NodeFamily,
  type Palette,
  mix,
  nodeColor,
} from '@/lib/tokens';
import type { Layout3DRequest, Layout3DResponse } from '@/workers/layout3d.worker';
import { useWs } from './context';

type Quality = 'low' | 'balanced' | 'high';

interface AtlasApi {
  reset: () => void;
  focusOn: (id: string) => void;
  capture: () => string | null;
}

const roleOf = (n: GraphNode): LayoutRole => {
  switch (n.type) {
    case 'Repository':
      return 'repository';
    case 'Subsystem':
      return 'subsystem';
    case 'Concept':
      return 'concept';
    case 'Package':
      return 'package';
    case 'Directory':
    case 'Module':
      return 'container';
    case 'File':
    case 'Configuration':
      return 'file';
    default:
      return 'symbol';
  }
};

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Runs the 3D layout in a Web Worker and returns positions aligned with `nodes`. */
function useLayout3d(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentOf: (n: GraphNode) => string | null,
  quality: Quality,
) {
  const [result, setResult] = useState<{ positions: Float32Array; radius: number; ids: string[] } | null>(
    null,
  );
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const worker = new Worker(new URL('../workers/layout3d.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++requestId.current;
    const ids = nodes.map((n) => n.id);
    const layoutNodes: LayoutNode[] = nodes.map((n) => ({
      id: n.id,
      role: roleOf(n),
      subsystem: (n.metadata.subsystem as string | undefined) ?? null,
      parent: parentOf(n),
    }));
    const layoutEdges = edges
      .filter((e) => e.type === 'IMPORTS' || e.type === 'CALLS' || e.type === 'USES' || e.type === 'EXTENDS')
      .map((e) => ({ source: e.source, target: e.target }));
    worker.onmessage = (e: MessageEvent<Layout3DResponse>) => {
      if (e.data.requestId === requestId.current)
        setResult({ positions: e.data.positions, radius: e.data.radius, ids });
    };
    worker.postMessage({
      requestId: id,
      nodes: layoutNodes,
      edges: layoutEdges,
      quality: quality === 'low' ? 0.2 : quality === 'high' ? 1 : 0.6,
    } satisfies Layout3DRequest);
  }, [nodes, edges, parentOf, quality]);
  return result;
}

const FAMILIES: NodeFamily[] = [
  'structure',
  'file',
  'type',
  'callable',
  'data',
  'endpoint',
  'concept',
  'external',
  'value',
];

function FamilyGeometry({ family, quality }: { family: NodeFamily; quality: Quality }) {
  const d = quality === 'low' ? 0 : 1;
  switch (family) {
    case 'structure':
      return <icosahedronGeometry args={[1, d]} />;
    case 'file':
      return <boxGeometry args={[1.3, 1.3, 1.3]} />;
    case 'type':
      return <octahedronGeometry args={[1.15, 0]} />;
    case 'data':
      return <cylinderGeometry args={[0.95, 0.95, 1.2, quality === 'low' ? 6 : 12]} />;
    case 'endpoint':
      return <coneGeometry args={[1, 1.7, quality === 'low' ? 4 : 8]} />;
    case 'concept':
      return <dodecahedronGeometry args={[1.1, 0]} />;
    case 'external':
      return <tetrahedronGeometry args={[1.25, 0]} />;
    default:
      return <sphereGeometry args={[1, quality === 'low' ? 6 : 10, quality === 'low' ? 4 : 8]} />;
  }
}

interface SceneProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Float32Array;
  radius: number;
  palette: Palette;
  quality: Quality;
  labelBudget: number;
  reducedMotion: boolean;
  focusBehavior: 'neighbourhood' | 'node' | 'none';
  apiRef: MutableRefObject<AtlasApi | null>;
  onExpand: (id: string) => void;
  onLabels: (items: LabelItem[]) => void;
  labelEls: MutableRefObject<Map<string, HTMLSpanElement>>;
}

interface LabelItem {
  id: string;
  text: string;
  glyph: string;
  major: boolean;
  root: boolean;
  on: boolean;
  dim: boolean;
  detail: string | null;
}

function AtlasScene({
  nodes,
  edges,
  positions,
  radius,
  palette,
  quality,
  labelBudget,
  reducedMotion,
  focusBehavior,
  apiRef,
  onExpand,
  onLabels,
  labelEls,
}: SceneProps) {
  const { camera, invalidate, gl, scene } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const selectedIds = useWorkspace((s) => s.selectedIds);
  const primaryId = useWorkspace((s) => s.primaryId);
  const hoverId = useWorkspace((s) => s.hoverId);
  const highlight = useWorkspace((s) => s.highlight);
  const revealTick = useWorkspace((s) => s.revealTick);
  const [far, setFar] = useState(false);
  const [nearLabels, setNearLabels] = useState<string[]>([]);

  const indexOf = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const pos = useCallback(
    (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
    [positions],
  );
  const byFamily = useMemo(() => {
    const m = new Map<NodeFamily, number[]>();
    nodes.forEach((n, i) => {
      const f = NODE_FAMILY[n.type];
      (m.get(f) ?? m.set(f, []).get(f)!).push(i);
    });
    return m;
  }, [nodes]);

  // ---- which nodes and edges are emphasised ------------------------------
  const active = useMemo(() => {
    const centre = hoverId ?? primaryId;
    if (centre && indexOf.has(centre)) {
      const nb = neighbourhood(centre, edges);
      for (const id of selectedIds) nb.nodes.add(id);
      return nb;
    }
    if (highlight) return { nodes: new Set(highlight.nodeIds), edges: new Set(highlight.edgeIds) };
    return null;
  }, [hoverId, primaryId, selectedIds, highlight, edges, indexOf]);

  // ---- instanced nodes ----------------------------------------------------
  const meshes = useRef(new Map<NodeFamily, THREE.InstancedMesh>());
  useLayoutEffect(() => {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const selected = new Set(selectedIds);
    for (const [family, list] of byFamily) {
      const mesh = meshes.current.get(family);
      if (!mesh) continue;
      list.forEach((ni, k) => {
        const n = nodes[ni]!;
        const emphasised = selected.has(n.id) || n.id === hoverId;
        const s = NODE_SIZE[n.type] * 0.42 * (emphasised ? 1.5 : 1);
        m4.compose(pos(ni), q, new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(k, m4);
        const base = emphasised ? palette.selection : nodeColor(n.type, palette);
        color.set(active && !active.nodes.has(n.id) && !emphasised ? mix(base, palette.canvas, 0.72) : base);
        mesh.setColorAt(k, color);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [byFamily, nodes, pos, palette, selectedIds, hoverId, active, invalidate]);

  // ---- edges: two buffered line sets (verified solid, derived dashed) ------
  const edgeSets = useMemo(() => {
    const build = (list: GraphEdge[]) => {
      // Cross-file relationships first, so symbol-level detail can be cut with a draw range when far away.
      const coarse: GraphEdge[] = [];
      const fine: GraphEdge[] = [];
      for (const e of list) {
        const a = nodes[indexOf.get(e.source)!]!;
        const b = nodes[indexOf.get(e.target)!]!;
        if (
          (isSymbolType(a.type) && isSymbolType(b.type) && a.filePath === b.filePath) ||
          e.type === 'CONTAINS'
        )
          fine.push(e);
        else coarse.push(e);
      }
      const ordered = [...coarse, ...fine];
      const geometry = new THREE.BufferGeometry();
      const p = new Float32Array(ordered.length * 6);
      ordered.forEach((e, k) => {
        const a = indexOf.get(e.source)! * 3;
        const b = indexOf.get(e.target)! * 3;
        p.set(
          [
            positions[a]!,
            positions[a + 1]!,
            positions[a + 2]!,
            positions[b]!,
            positions[b + 1]!,
            positions[b + 2]!,
          ],
          k * 6,
        );
      });
      geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ordered.length * 6), 3));
      return { geometry, ordered, coarseCount: coarse.length };
    };
    const usable = edges.filter((e) => indexOf.has(e.source) && indexOf.has(e.target));
    return {
      verified: build(usable.filter((e) => e.verified)),
      derived: build(usable.filter((e) => !e.verified)),
    };
  }, [edges, nodes, indexOf, positions]);
  useEffect(
    () => () => {
      edgeSets.verified.geometry.dispose();
      edgeSets.derived.geometry.dispose();
    },
    [edgeSets],
  );
  const derivedLine = useRef<THREE.LineSegments>(null);
  useLayoutEffect(() => {
    const c = new THREE.Color();
    for (const [set, baseHex] of [
      [edgeSets.verified, palette.textMuted],
      [edgeSets.derived, palette.relationUnverified],
    ] as const) {
      const attr = set.geometry.getAttribute('color') as THREE.BufferAttribute;
      set.ordered.forEach((e, k) => {
        const on = active?.edges.has(e.id);
        c.set(
          on
            ? e.verified
              ? palette.relationActive
              : palette.relationUnverified
            : mix(baseHex, palette.canvas, active ? 0.88 : e.type === 'CONTAINS' || !e.verified ? 0.72 : 0.5),
        );
        attr.setXYZ(k * 2, c.r, c.g, c.b);
        attr.setXYZ(k * 2 + 1, c.r, c.g, c.b);
      });
      attr.needsUpdate = true;
      // Level of detail: from far away only cross-file relationships are drawn.
      set.geometry.setDrawRange(0, (far && !active ? set.coarseCount : set.ordered.length) * 2);
    }
    derivedLine.current?.computeLineDistances();
    invalidate();
  }, [edgeSets, palette, active, far, invalidate]);

  // ---- camera transitions -------------------------------------------------
  const anim = useRef<{
    fromP: THREE.Vector3;
    fromT: THREE.Vector3;
    toP: THREE.Vector3;
    toT: THREE.Vector3;
    start: number;
    duration: number;
  } | null>(null);
  const flyTo = useCallback(
    (toP: THREE.Vector3, toT: THREE.Vector3) => {
      const fromT = controls ? controls.target.clone() : new THREE.Vector3();
      anim.current = {
        fromP: camera.position.clone(),
        fromT,
        toP,
        toT,
        start: performance.now(),
        duration: reducedMotion ? 0 : 820,
      };
      invalidate();
    },
    [camera, controls, invalidate, reducedMotion],
  );
  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const t = a.duration === 0 ? 1 : Math.min(1, (performance.now() - a.start) / a.duration);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(a.fromP, a.toP, k);
    if (controls) {
      controls.target.lerpVectors(a.fromT, a.toT, k);
      controls.update();
    } else camera.lookAt(a.toT);
    if (t >= 1) anim.current = null;
    else invalidate();
  });
  const home = useCallback(
    () => flyTo(new THREE.Vector3(0, radius * 1.25, radius * 3.3), new THREE.Vector3(0, 0, 0)),
    [flyTo, radius],
  );
  const focusOn = useCallback(
    (id: string) => {
      const i = indexOf.get(id);
      if (i === undefined) return;
      const n = nodes[i]!;
      const target = pos(i);
      const dist =
        n.type === 'Repository'
          ? radius * 2.6
          : n.type === 'Subsystem'
            ? radius * 1.3
            : n.type === 'Concept' || n.type === 'Package'
              ? radius * 0.7
              : isSymbolType(n.type)
                ? 13
                : 26;
      // Look at the node from outside the structure, keeping the current side when the node is central.
      const dir =
        target.lengthSq() > 4 ? target.clone().normalize() : camera.position.clone().sub(target).normalize();
      dir.y += 0.25;
      flyTo(target.clone().add(dir.normalize().multiplyScalar(dist)), target);
    },
    [indexOf, nodes, pos, radius, camera, flyTo],
  );
  useEffect(() => {
    apiRef.current = {
      reset: home,
      focusOn,
      capture: () => {
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, home, focusOn, gl, scene, camera]);
  // Frame the whole structure whenever a new layout arrives.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    // Runs again once the controls exist, so the first frame is drawn from the home position.
    const key = `${radius}:${controls ? 1 : 0}`;
    if (framed.current === key) return;
    framed.current = key;
    camera.position.set(0, radius * 1.25, radius * 3.3);
    controls?.target.set(0, 0, 0);
    controls?.update();
    invalidate();
  }, [radius, camera, controls, invalidate]);
  // With on-demand rendering nothing is drawn until a frame is requested: ask for one whenever the
  // scene content is (re)created, and once more after the browser has laid the canvas out.
  useEffect(() => {
    invalidate();
    const t = setTimeout(() => invalidate(), 150);
    return () => clearTimeout(t);
  }, [controls, positions, invalidate]);
  useEffect(() => {
    if (revealTick === 0 || focusBehavior === 'none') return;
    const s = useWorkspace.getState();
    const id = s.primaryId ?? s.focusId;
    if (id) focusOn(id);
    else home();
  }, [revealTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- level of detail and label culling, recomputed when the camera rests --
  const updateDetail = useCallback(() => {
    const d = camera.position.length();
    setFar(d > radius * 2.1 && edges.length > 600);
    if (labelBudget === 0) return setNearLabels([]);
    const scored: [number, string][] = [];
    const v = new THREE.Vector3();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.type === 'Repository' || n.type === 'Subsystem' || n.type === 'Concept') continue;
      v.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      if (!frustum.containsPoint(v)) continue;
      // Larger nodes earn a label from further away.
      scored.push([v.distanceTo(camera.position) / (NODE_SIZE[n.type] + 1), n.id]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    const limit = (isSymbol: boolean) => (isSymbol ? 18 : 60);
    setNearLabels(
      scored
        .filter(
          ([s, id]) =>
            s * (NODE_SIZE[nodes[indexOf.get(id)!]!.type] + 1) <
            limit(isSymbolType(nodes[indexOf.get(id)!]!.type)) * 1.4,
        )
        .slice(0, labelBudget)
        .map(([, id]) => id),
    );
  }, [camera, radius, edges.length, labelBudget, nodes, positions, indexOf]);
  useEffect(() => {
    const t = setTimeout(updateDetail, 80);
    return () => clearTimeout(t);
  }, [updateDetail]);

  // ---- pointer interaction ------------------------------------------------
  const idAt = (family: NodeFamily, instanceId: number | undefined) =>
    instanceId === undefined ? null : (nodes[byFamily.get(family)?.[instanceId] ?? -1]?.id ?? null);
  const handlers = (family: NodeFamily) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const id = idAt(family, e.instanceId);
      if (!id) return;
      const additive = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
      useWorkspace.getState().select(id, { additive });
      if (!additive && focusBehavior !== 'none') focusOn(id);
    },
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const id = idAt(family, e.instanceId);
      if (id) onExpand(id);
    },
    ...(nodes.length <= 20000
      ? {
          onPointerMove: (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            useWorkspace.getState().setHover(idAt(family, e.instanceId));
            gl.domElement.style.cursor = 'pointer';
          },
          onPointerOut: () => {
            useWorkspace.getState().setHover(null);
            gl.domElement.style.cursor = '';
          },
        }
      : {}),
  });

  // ---- labels -------------------------------------------------------------
  const labels = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nodes)
      if (n.type === 'Repository' || n.type === 'Subsystem' || n.type === 'Concept') ids.add(n.id);
    for (const id of selectedIds) ids.add(id);
    if (hoverId) ids.add(hoverId);
    if (active) [...active.nodes].slice(0, 28).forEach((id) => ids.add(id));
    for (const id of nearLabels) ids.add(id);
    return [...ids].filter((id) => indexOf.has(id));
  }, [nodes, selectedIds, hoverId, active, nearLabels, indexOf]);

  // Labels are plain DOM elements in an overlay owned by the parent. The parent renders them;
  // this scene only moves them, once per rendered frame, by projecting their node to the screen.
  const labelItems = useMemo<LabelItem[]>(
    () =>
      labels.map((id) => {
        const n = nodes[indexOf.get(id)!]!;
        const major = n.type === 'Repository' || n.type === 'Subsystem' || n.type === 'Concept';
        const on = id === hoverId || selectedIds.includes(id);
        return {
          id,
          text: n.name,
          glyph: FAMILY_GLYPH[NODE_FAMILY[n.type]],
          major,
          root: n.type === 'Repository',
          on,
          dim: !!active && !active.nodes.has(id) && !on,
          detail: id === hoverId && !major ? NODE_TYPE_LABELS[n.type] : null,
        };
      }),
    [labels, nodes, indexOf, hoverId, selectedIds, active],
  );
  useEffect(() => {
    onLabels(labelItems);
    invalidate();
    const t = setTimeout(() => invalidate(), 40);
    return () => clearTimeout(t);
  }, [labelItems, onLabels, invalidate]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ size }) => {
    for (const item of labelItems) {
      const el = labelEls.current.get(item.id);
      const i = indexOf.get(item.id);
      if (!el || i === undefined) continue;
      projected
        .set(
          positions[i * 3]!,
          positions[i * 3 + 1]! + NODE_SIZE[nodes[i]!.type] * 0.42 + 0.6,
          positions[i * 3 + 2]!,
        )
        .project(camera);
      // Behind the camera or outside the view: hide instead of drawing at a mirrored position.
      if (projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${((projected.x + 1) / 2) * size.width}px, ${((1 - projected.y) / 2) * size.height}px) translate(-50%, -120%)`;
    }
  });

  return (
    <>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.14}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minDistance={4}
        maxDistance={radius * 9}
        onEnd={updateDetail}
      />
      {FAMILIES.map((family) => {
        const count = byFamily.get(family)?.length ?? 0;
        if (!count) return null;
        return (
          <instancedMesh
            key={`${family}:${count}`}
            ref={(m) => {
              if (m) meshes.current.set(family, m);
              else meshes.current.delete(family);
            }}
            args={[undefined, undefined, count]}
            frustumCulled={false}
            {...handlers(family)}
          >
            <FamilyGeometry family={family} quality={quality} />
            <meshLambertMaterial flatShading={family !== 'callable' && family !== 'value'} />
          </instancedMesh>
        );
      })}
      <lineSegments geometry={edgeSets.verified.geometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} />
      </lineSegments>
      <lineSegments ref={derivedLine} geometry={edgeSets.derived.geometry} frustumCulled={false}>
        <lineDashedMaterial vertexColors dashSize={0.9} gapSize={0.7} transparent opacity={0.9} />
      </lineSegments>
    </>
  );
}

export function Atlas() {
  const { view, adj, palette, settings, reducedMotion, expandFile, openView, theme } = useWs();
  const primaryId = useWorkspace((s) => s.primaryId);
  const focusId = useWorkspace((s) => s.focusId);
  const [gl, setGl] = useState<'ok' | 'unsupported' | 'lost'>(() =>
    webglAvailable() ? 'ok' : 'unsupported',
  );
  const [attempt, setAttempt] = useState(0);
  const apiRef = useRef<AtlasApi | null>(null);
  const [labelItems, setLabelItems] = useState<LabelItem[]>([]);
  const labelEls = useRef(new Map<string, HTMLSpanElement>());
  const quality = settings.performance.renderingQuality;

  const parentOf = useCallback(
    (n: GraphNode): string | null => {
      if (!isSymbolType(n.type)) return null;
      const parentEdge = (adj.in.get(n.id) ?? []).find((e) => e.type === 'CONTAINS');
      return parentEdge?.source ?? fileIdOf(n);
    },
    [adj],
  );
  const layout = useLayout3d(view.nodes, view.edges, parentOf, quality);
  const current =
    layout &&
    layout.ids.length === view.nodes.length &&
    layout.ids[0] === view.nodes[0]?.id &&
    layout.ids[layout.ids.length - 1] === view.nodes[view.nodes.length - 1]?.id
      ? layout
      : null;

  // The scene keeps showing the previous arrangement until the next one is ready, so changing a
  // filter or entering focus mode never blanks the view or tears down the renderer.
  const [shown, setShown] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    positions: Float32Array;
    radius: number;
  } | null>(null);
  useEffect(() => {
    if (current)
      setShown({
        nodes: view.nodes,
        edges: view.edges,
        positions: current.positions,
        radius: current.radius,
      });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onExpand = useCallback(
    (id: string) => {
      const n = adj.nodes.get(id);
      if (!n) return;
      if (n.type === 'File' || n.type === 'Configuration') return expandFile(id);
      if (n.type === 'Subsystem' || n.type === 'Concept') {
        // Unfold the files of a region.
        (adj.in.get(id) ?? [])
          .filter((e) => e.type === 'BELONGS_TO')
          .slice(0, 60)
          .forEach((e) => expandFile(e.source, true));
        return;
      }
      const fid = fileIdOf(n);
      if (fid) expandFile(fid, true);
    },
    [adj, expandFile],
  );

  const primary = primaryId ? adj.nodes.get(primaryId) : undefined;
  const crumbs = useMemo(() => {
    const out: GraphNode[] = [];
    const repo = adj.nodes.get('repo:root');
    if (repo) out.push(repo);
    if (!primary || primary.type === 'Repository') return out;
    const sub = adj.nodes.get((primary.metadata.subsystem as string | undefined) ?? '');
    if (sub && sub.id !== primary.id) out.push(sub);
    const file = isSymbolType(primary.type) ? adj.nodes.get(fileIdOf(primary) ?? '') : undefined;
    if (file) out.push(file);
    const parent = isSymbolType(primary.type)
      ? adj.nodes.get((adj.in.get(primary.id) ?? []).find((e) => e.type === 'CONTAINS')?.source ?? '')
      : undefined;
    if (parent && isSymbolType(parent.type)) out.push(parent);
    out.push(primary);
    return out;
  }, [primary, adj]);
  const subsystemId =
    (primary?.metadata.subsystem as string | undefined) ??
    (primary?.type === 'Subsystem' ? primary.id : undefined);
  const labelBudget = quality === 'low' ? 0 : { low: 6, medium: 16, high: 40 }[settings.graph.labelDensity];

  if (gl !== 'ok')
    return (
      <div className="mx-auto max-w-[56ch] px-6 py-16" data-testid="atlas-fallback">
        <h2 className="font-editorial text-[1.375rem]">
          {gl === 'lost' ? 'The 3D view lost its graphics context' : '3D rendering is not available here'}
        </h2>
        <p className="label mt-3 text-[0.9375rem]">
          {gl === 'lost'
            ? 'The browser reclaimed the graphics memory used by the Atlas. Your selection and filters are kept.'
            : 'This browser or device does not provide WebGL. The same graph is available in two dimensions.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => openView('graph')}>
            Open the 2D Graph Explorer
          </button>
          {gl === 'lost' ? (
            <button
              className="btn"
              onClick={() => {
                setAttempt((a) => a + 1);
                setGl('ok');
              }}
            >
              Start the 3D view again
            </button>
          ) : null}
        </div>
      </div>
    );

  return (
    <div className="relative h-full w-full" data-testid="atlas">
      <ViewToolbar status={current ? undefined : 'arranging'}>
        <button
          className="btn btn-sm bg-elevated"
          onClick={() => apiRef.current?.reset()}
          data-testid="atlas-reset"
        >
          <RotateCcw size={13} strokeWidth={1.5} aria-hidden="true" />
          Reset camera
        </button>
        {subsystemId ? (
          <button className="btn btn-sm bg-elevated" onClick={() => apiRef.current?.focusOn(subsystemId)}>
            Focus subsystem
          </button>
        ) : null}
        {primary && focusId !== primary.id ? (
          <button
            className="btn btn-sm bg-elevated"
            onClick={() => useWorkspace.getState().setFocus(primary.id)}
          >
            Show connected neighbourhood
          </button>
        ) : null}
        <button
          className="btn btn-sm bg-elevated"
          onClick={() => {
            useWorkspace.getState().setFocus(null);
            useWorkspace.getState().clearSelection();
            apiRef.current?.reset();
          }}
        >
          <Globe size={13} strokeWidth={1.5} aria-hidden="true" />
          Global view
        </button>
        <button
          className="btn btn-sm bg-elevated"
          onClick={() => {
            const url = apiRef.current?.capture();
            if (url) downloadUrl('vectora-atlas.png', url);
          }}
        >
          <ImageIcon size={13} strokeWidth={1.5} aria-hidden="true" />
          PNG
        </button>
      </ViewToolbar>
      {shown ? (
        <Canvas
          key={attempt}
          frameloop="demand"
          dpr={quality === 'low' ? 1 : quality === 'high' ? [1, 2] : [1, 1.5]}
          camera={{ fov: 42, near: 0.5, far: 6000, position: [0, shown.radius * 1.25, shown.radius * 3.3] }}
          gl={{ antialias: quality !== 'low', powerPreference: 'default', alpha: false }}
          onCreated={({ gl: renderer }) => {
            const canvas = renderer.domElement;
            canvas.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              // Disposing the renderer on the way out also reports a lost context; only a loss
              // while the view is on screen is a real one.
              if (alive.current && canvas.isConnected) setGl('lost');
            });
          }}
          onPointerMissed={(e) => {
            if (e.type === 'click') useWorkspace.getState().clearSelection();
          }}
          aria-label="3D knowledge atlas. Drag to orbit, right-drag to pan, scroll to zoom. Use Search to move to a node."
          role="application"
        >
          <color attach="background" args={[palette.canvas]} key={theme} />
          <fog attach="fog" args={[palette.canvas, shown.radius * 2.4, shown.radius * 9]} />
          <ambientLight intensity={theme === 'dark' ? 1.5 : 2.1} />
          <directionalLight
            position={[shown.radius, shown.radius * 2, shown.radius]}
            intensity={theme === 'dark' ? 1.4 : 1.1}
          />
          <AtlasScene
            nodes={shown.nodes}
            edges={shown.edges}
            positions={shown.positions}
            radius={shown.radius}
            palette={palette}
            quality={quality}
            labelBudget={labelBudget}
            reducedMotion={reducedMotion}
            focusBehavior={settings.graph.focusBehavior}
            apiRef={apiRef}
            onExpand={onExpand}
            onLabels={setLabelItems}
            labelEls={labelEls}
          />
        </Canvas>
      ) : (
        <Loading label="Arranging the atlas" />
      )}
      {shown ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {labelItems.map((l) => (
            <span
              key={l.id}
              ref={(el) => {
                if (el) labelEls.current.set(l.id, el);
                else labelEls.current.delete(l.id);
              }}
              className={l.major ? 'font-editorial' : 'font-mono'}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                visibility: 'hidden',
                whiteSpace: 'nowrap',
                fontSize: l.major ? (l.root ? 15 : 13) : 10.5,
                color: l.on || l.major ? palette.text : palette.textSecondary,
                opacity: l.dim ? 0.25 : 1,
                background: l.on ? palette.elevated : 'transparent',
                border: l.on ? `1px solid ${palette.line}` : 'none',
                padding: l.on ? '1px 6px' : 0,
                zIndex: l.on ? 2 : 1,
              }}
            >
              {l.glyph} {l.text}
              {l.detail ? <span style={{ color: palette.textMuted }}> — {l.detail}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      <nav
        aria-label="Location in the atlas"
        className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 bg-canvas/85 px-2 py-1"
        data-testid="atlas-breadcrumb"
      >
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight size={11} className="text-ink-3" aria-hidden="true" /> : null}
            <button
              className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.75rem] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
              aria-current={i === crumbs.length - 1 ? 'location' : undefined}
              onClick={() => {
                if (c.type === 'Repository') {
                  useWorkspace.getState().clearSelection();
                  apiRef.current?.reset();
                } else {
                  useWorkspace.getState().select(c.id);
                  apiRef.current?.focusOn(c.id);
                }
              }}
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <p className="meta pointer-events-none absolute bottom-3 right-3 hidden bg-canvas/80 px-2 py-1 lg:block">
        Drag to orbit, right-drag to pan, scroll to zoom, double-click to unfold
      </p>
    </div>
  );
}
