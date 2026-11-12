/**
 * Workspace state shared by all three exploration views: selection, focus,
 * expansion and filters live here so that selecting a node in one view shows
 * it selected in the others.
 */
import { create } from 'zustand';
import type { SessionState } from '@vectora/shared';

export interface Highlight {
  label: string;
  nodeIds: string[];
  edgeIds: string[];
}

interface WorkspaceState {
  repoId: string | null;
  selectedIds: string[];
  /** Most recently selected node — the one shown in the inspector. */
  primaryId: string | null;
  hoverId: string | null;
  /** Focus mode: only this node and its neighbourhood are shown. */
  focusId: string | null;
  /** Files whose symbols are shown. */
  expandedIds: string[];
  hiddenNodeTypes: string[];
  hiddenEdgeTypes: string[];
  highlight: Highlight | null;
  inspectorOpen: boolean;
  inspectorWidth: number;
  paletteOpen: boolean;
  layouts: SessionState['layouts'];
  /** Bumped whenever a view should re-centre on the primary selection. */
  revealTick: number;
  sessionLoaded: boolean;

  select: (id: string, opts?: { additive?: boolean; reveal?: boolean }) => void;
  clearSelection: () => void;
  setHover: (id: string | null) => void;
  setFocus: (id: string | null) => void;
  toggleExpanded: (id: string, force?: boolean) => void;
  setHiddenNodeTypes: (t: string[]) => void;
  setHiddenEdgeTypes: (t: string[]) => void;
  setHighlight: (h: Highlight | null) => void;
  setInspector: (open: boolean, width?: number) => void;
  setPaletteOpen: (open: boolean) => void;
  setLayout: <K extends keyof SessionState['layouts']>(key: K, value: SessionState['layouts'][K]) => void;
  hydrate: (repoId: string, session: SessionState | null, defaults: { hiddenEdgeTypes: string[] }) => void;
  snapshot: (view: string) => SessionState;
}

export const DEFAULT_HIDDEN_NODE_TYPES = ['Directory', 'Module', 'Package', 'Configuration'];

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  repoId: null,
  selectedIds: [],
  primaryId: null,
  hoverId: null,
  focusId: null,
  expandedIds: [],
  hiddenNodeTypes: DEFAULT_HIDDEN_NODE_TYPES,
  hiddenEdgeTypes: ['DEFINED_IN', 'EXPORTS'],
  highlight: null,
  inspectorOpen: true,
  inspectorWidth: 380,
  paletteOpen: false,
  layouts: {},
  revealTick: 0,
  sessionLoaded: false,

  select: (id, opts) =>
    set((s) => {
      if (opts?.additive) {
        const has = s.selectedIds.includes(id);
        const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
        return {
          selectedIds,
          primaryId: has ? (selectedIds[selectedIds.length - 1] ?? null) : id,
          inspectorOpen: true,
        };
      }
      return {
        selectedIds: [id],
        primaryId: id,
        inspectorOpen: true,
        revealTick: opts?.reveal ? s.revealTick + 1 : s.revealTick,
      };
    }),
  clearSelection: () => set({ selectedIds: [], primaryId: null }),
  setHover: (hoverId) => set((s) => (s.hoverId === hoverId ? s : { hoverId })),
  setFocus: (focusId) => set((s) => ({ focusId, revealTick: s.revealTick + 1 })),
  toggleExpanded: (id, force) =>
    set((s) => {
      const has = s.expandedIds.includes(id);
      const want = force ?? !has;
      if (want === has) return s;
      return { expandedIds: want ? [...s.expandedIds, id] : s.expandedIds.filter((x) => x !== id) };
    }),
  setHiddenNodeTypes: (hiddenNodeTypes) => set({ hiddenNodeTypes }),
  setHiddenEdgeTypes: (hiddenEdgeTypes) => set({ hiddenEdgeTypes }),
  setHighlight: (highlight) => set({ highlight }),
  setInspector: (inspectorOpen, width) =>
    set((s) => ({ inspectorOpen, inspectorWidth: width ?? s.inspectorWidth })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setLayout: (key, value) => set((s) => ({ layouts: { ...s.layouts, [key]: value } })),
  hydrate: (repoId, session, defaults) =>
    set({
      repoId,
      selectedIds: session?.selectedIds ?? [],
      primaryId: session?.selectedIds?.[session.selectedIds.length - 1] ?? null,
      focusId: session?.focusId ?? null,
      expandedIds: session?.expandedIds ?? [],
      hiddenNodeTypes: session?.hiddenNodeTypes ?? DEFAULT_HIDDEN_NODE_TYPES,
      hiddenEdgeTypes: session?.hiddenEdgeTypes ?? defaults.hiddenEdgeTypes,
      layouts: session?.layouts ?? {},
      highlight: null,
      hoverId: null,
      sessionLoaded: true,
    }),
  snapshot: (view) => {
    const s = get();
    return {
      view,
      selectedIds: s.selectedIds.slice(0, 200),
      focusId: s.focusId,
      expandedIds: s.expandedIds.slice(0, 2000),
      hiddenNodeTypes: s.hiddenNodeTypes,
      hiddenEdgeTypes: s.hiddenEdgeTypes,
      layouts: s.layouts,
      savedAt: new Date().toISOString(),
    };
  },
}));
