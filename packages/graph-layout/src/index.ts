/**
 * Layout engines for the visualisations. Pure functions over plain data so
 * they can run inside Web Workers.
 *
 * The 3D layout is hierarchical: the repository sits at the centre, each
 * subsystem anchors a region on a sphere around it, files settle near their
 * subsystem under a force simulation, and symbols orbit their file. Concepts
 * and external packages get their own layers above and below.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimNode } from 'd3-force-3d';

export type LayoutRole = 'repository' | 'subsystem' | 'concept' | 'package' | 'container' | 'file' | 'symbol';

export interface LayoutNode {
  id: string;
  role: LayoutRole;
  /** Subsystem node id this node belongs to. */
  subsystem?: string | null;
  /** For symbols: the node they orbit (file or enclosing symbol). */
  parent?: string | null;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Layout3DOptions {
  /** Simulation effort, 0–1. Lower values are faster and coarser. */
  quality?: number;
}

export interface Layout3DResult {
  /** x, y, z per node, in the order of the input nodes. */
  positions: Float32Array;
  /** Radius of the sphere that holds the subsystem anchors. */
  radius: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Evenly distributed point `i` of `n` on a sphere of radius `r`. */
export function fibonacciPoint(i: number, n: number, r: number): [number, number, number] {
  if (n <= 1) return [r, 0, 0];
  const y = 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * i;
  return [Math.cos(theta) * rad * r, y * r, Math.sin(theta) * rad * r];
}

interface Sim extends SimNode {
  i: number;
  ax: number;
  ay: number;
  az: number;
}

export function layout3d(nodes: LayoutNode[], edges: LayoutEdge[], opts: Layout3DOptions = {}): Layout3DResult {
  const n = nodes.length;
  const positions = new Float32Array(n * 3);
  const indexOf = new Map<string, number>();
  nodes.forEach((node, i) => indexOf.set(node.id, i));
  const set = (i: number, x: number, y: number, z: number) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  };

  const subsystems = nodes.filter((x) => x.role === 'subsystem');
  const members = new Map<string, number>();
  for (const node of nodes) if ((node.role === 'file' || node.role === 'container') && node.subsystem) members.set(node.subsystem, (members.get(node.subsystem) ?? 0) + 1);
  const largest = Math.max(1, ...members.values());
  const structural = nodes.filter((x) => x.role === 'file' || x.role === 'container').length;
  // Regions must be far enough apart for the largest cluster to fit.
  const clusterRadius = (count: number) => 6 + Math.cbrt(count) * 5.5;
  const radius = Math.max(42, clusterRadius(largest) * 1.6 + Math.sqrt(subsystems.length) * 16);

  // Fixed anchors -------------------------------------------------------------
  const anchor = new Map<string, [number, number, number]>();
  subsystems.forEach((s, k) => {
    // The equatorial band keeps subsystems clear of the concept and package layers.
    // A handful of subsystems reads best as a ring around the centre; many are spread over a sphere.
    let p: [number, number, number];
    if (subsystems.length <= 7) {
      const a = (k / subsystems.length) * Math.PI * 2 + Math.PI / 6;
      p = [Math.cos(a) * radius, (k % 2 === 0 ? 1 : -1) * radius * (subsystems.length > 2 ? 0.14 : 0), Math.sin(a) * radius];
    } else {
      p = fibonacciPoint(k, subsystems.length, radius);
      p[1] *= 0.62;
    }
    anchor.set(s.id, p);
    set(indexOf.get(s.id)!, p[0], p[1], p[2]);
  });
  const ring = (role: LayoutRole, y: number, r: number) => {
    const list = nodes.filter((x) => x.role === role);
    list.forEach((node, k) => {
      const a = (k / Math.max(1, list.length)) * Math.PI * 2;
      const rr = r * (list.length > 24 ? 0.7 + 0.3 * ((k % 3) / 2) : 1);
      set(indexOf.get(node.id)!, Math.cos(a) * rr, y + (list.length > 24 ? ((k % 3) - 1) * 5 : 0), Math.sin(a) * rr);
    });
  };
  ring('concept', radius * 0.78, radius * 0.5);
  ring('package', -radius * 0.8, radius * 0.7);

  // Files and directories: force simulation pulled towards the subsystem anchor.
  const sims: Sim[] = [];
  const simIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    if (node.role !== 'file' && node.role !== 'container') continue;
    const a = (node.subsystem && anchor.get(node.subsystem)) || [0, 0, 0];
    const k = sims.length;
    const spread = clusterRadius(members.get(node.subsystem ?? '') ?? 1);
    const p = fibonacciPoint(k % 97, 97, spread * (0.35 + ((k * 0.618) % 1) * 0.65));
    simIndex.set(node.id, k);
    sims.push({ i, ax: a[0], ay: a[1], az: a[2], x: a[0] + p[0], y: a[1] + p[1], z: a[2] + p[2] });
  }
  if (sims.length) {
    const links: { source: number; target: number }[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const s = simIndex.get(e.source);
      const t = simIndex.get(e.target);
      if (s === undefined || t === undefined || s === t) continue;
      const key = s < t ? `${s}:${t}` : `${t}:${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: s, target: t });
    }
    const quality = opts.quality ?? 0.6;
    const ticks = Math.round((structural > 6000 ? 30 : structural > 2000 ? 60 : structural > 600 ? 110 : 170) * (0.5 + quality));
    const sim = forceSimulation(sims, 3)
      .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
      .velocityDecay(0.45)
      .force('link', forceLink(links).distance(9).strength(0.12))
      .force('charge', forceManyBody().strength(-26).distanceMax(70).theta(1.1))
      .force('collide', structural <= 4000 ? forceCollide(2.6).strength(0.7).iterations(1) : null)
      .force('x', forceX<Sim>((d) => d.ax).strength(0.34))
      .force('y', forceY<Sim>((d) => d.ay).strength(0.34))
      .force('z', forceZ<Sim>((d) => d.az).strength(0.34))
      .stop();
    sim.tick(ticks);
    for (const s of sims) set(s.i, s.x ?? 0, s.y ?? 0, s.z ?? 0);
  }

  // Symbols orbit their parent. Parents are placed before children (two passes handle nesting).
  const children = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    if (node.role !== 'symbol' || !node.parent) continue;
    (children.get(node.parent) ?? children.set(node.parent, []).get(node.parent)!).push(i);
  }
  const placeChildren = (parentId: string, depth: number): void => {
    const list = children.get(parentId);
    const pi = indexOf.get(parentId);
    if (!list || pi === undefined || depth > 4) return;
    const px = positions[pi * 3]!;
    const py = positions[pi * 3 + 1]!;
    const pz = positions[pi * 3 + 2]!;
    const r = (depth === 0 ? 1.7 : 0.9) + Math.sqrt(list.length) * (depth === 0 ? 0.42 : 0.25);
    list.forEach((ci, k) => {
      const p = fibonacciPoint(k, Math.max(list.length, 4), r);
      set(ci, px + p[0], py + p[1], pz + p[2]);
      placeChildren(nodes[ci]!.id, depth + 1);
    });
  };
  for (const node of nodes) if (node.role === 'file') placeChildren(node.id, 0);
  // Symbols whose parent is not in the layout stay near their subsystem.
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    if (node.role === 'symbol' && (!node.parent || !indexOf.has(node.parent))) {
      const a = (node.subsystem && anchor.get(node.subsystem)) || [0, 0, 0];
      const p = fibonacciPoint(i % 61, 61, 10);
      set(i, a[0] + p[0], a[1] + p[1], a[2] + p[2]);
    }
  }
  return { positions, radius };
}

/**
 * Deterministic starting positions for the 2D layout: one disc per group,
 * discs arranged on a circle. Force-directed refinement starts from here.
 */
export function seed2d(nodes: { id: string; group: string | number | null }[]): Map<string, [number, number]> {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const g = String(node.group ?? '∅');
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(node.id);
  }
  const out = new Map<string, [number, number]>();
  const keys = [...groups.keys()];
  const total = nodes.length;
  const R = 40 + Math.sqrt(total) * 9;
  keys.forEach((g, gi) => {
    const ids = groups.get(g)!;
    const a = (gi / keys.length) * Math.PI * 2;
    const cx = keys.length === 1 ? 0 : Math.cos(a) * R;
    const cy = keys.length === 1 ? 0 : Math.sin(a) * R;
    const r = 6 + Math.sqrt(ids.length) * 5;
    ids.forEach((id, k) => {
      const t = k * GOLDEN;
      const rr = r * Math.sqrt((k + 0.5) / ids.length);
      out.set(id, [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
    });
  });
  return out;
}
