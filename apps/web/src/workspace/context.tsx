import { createContext, useContext } from 'react';
import type { KnowledgeGraph } from '@vectora/graph-schema';
import type { RepositoryRecord, Settings } from '@vectora/shared';
import type { Adjacency, GraphView } from '@/lib/graphView';
import type { Palette } from '@/lib/tokens';

export interface WorkspaceContextValue {
  repo: RepositoryRecord;
  graph: KnowledgeGraph;
  adj: Adjacency;
  /** The filtered graph that the 2D and 3D views render. */
  view: GraphView;
  partial: boolean;
  settings: Settings;
  palette: Palette;
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  /** Shows the symbols of a file, loading them first when the graph was loaded progressively. */
  expandFile: (fileId: string, force?: boolean) => void;
  /** Selects a node and makes sure it is visible in the current view. */
  reveal: (nodeId: string) => void;
  openView: (view: 'graph' | 'atlas' | 'mindmap' | 'overview' | 'dependencies' | 'search' | 'docs' | 'settings' | 'source', query?: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWs(): WorkspaceContextValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error('useWs must be used inside a workspace');
  return v;
}
