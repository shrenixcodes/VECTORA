declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...rest: unknown[]) => void;
  }
  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    alpha(value: number): this;
    alphaDecay(value: number): this;
    velocityDecay(value: number): this;
    force(name: string, force: unknown): this;
    nodes(): N[];
  }
  export function forceSimulation<N extends SimNode>(nodes: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink<N extends SimNode>(
    links: { source: number | N; target: number | N }[],
  ): {
    distance(d: number | ((l: unknown) => number)): ReturnType<typeof forceLink<N>>;
    strength(s: number | ((l: unknown) => number)): ReturnType<typeof forceLink<N>>;
    iterations(n: number): ReturnType<typeof forceLink<N>>;
  };
  export function forceManyBody(): {
    strength(s: number | ((n: unknown) => number)): ReturnType<typeof forceManyBody>;
    distanceMax(d: number): ReturnType<typeof forceManyBody>;
    theta(t: number): ReturnType<typeof forceManyBody>;
  };
  export function forceCollide(radius?: number | ((n: unknown) => number)): {
    strength(s: number): ReturnType<typeof forceCollide>;
    iterations(n: number): ReturnType<typeof forceCollide>;
  };
  export function forceX<N>(x?: number | ((n: N) => number)): {
    strength(s: number | ((n: N) => number)): ReturnType<typeof forceX<N>>;
  };
  export function forceY<N>(y?: number | ((n: N) => number)): {
    strength(s: number | ((n: N) => number)): ReturnType<typeof forceY<N>>;
  };
  export function forceZ<N>(z?: number | ((n: N) => number)): {
    strength(s: number | ((n: N) => number)): ReturnType<typeof forceZ<N>>;
  };
}
