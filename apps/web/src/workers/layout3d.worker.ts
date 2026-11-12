/// <reference lib="webworker" />
import { type LayoutEdge, type LayoutNode, layout3d } from '@vectora/graph-layout';

export interface Layout3DRequest {
  requestId: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  quality: number;
}
export interface Layout3DResponse {
  requestId: number;
  positions: Float32Array;
  radius: number;
}

self.onmessage = (e: MessageEvent<Layout3DRequest>) => {
  const { requestId, nodes, edges, quality } = e.data;
  const result = layout3d(nodes, edges, { quality });
  (self as unknown as Worker).postMessage(
    { requestId, positions: result.positions, radius: result.radius } satisfies Layout3DResponse,
    [result.positions.buffer],
  );
};
