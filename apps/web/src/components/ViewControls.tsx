import { SlidersHorizontal, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { type ReactNode, useMemo } from 'react';
import { EDGE_TYPES, EDGE_TYPE_LABELS, NODE_TYPES, NODE_TYPE_LABELS, type NodeType } from '@vectora/graph-schema';
import { useWorkspace } from '@/lib/store';
import { FAMILY_GLYPH, NODE_FAMILY, nodeColor } from '@/lib/tokens';
import { useWs } from '@/workspace/context';
import { cx } from './ui';

/** Toolbar shown above every exploration view: filters, legend, focus and highlight state. */
export function ViewToolbar({ children, status }: { children?: ReactNode; status?: ReactNode }) {
  const { adj, view } = useWs();
  const focusId = useWorkspace((s) => s.focusId);
  const setFocus = useWorkspace((s) => s.setFocus);
  const highlight = useWorkspace((s) => s.highlight);
  const setHighlight = useWorkspace((s) => s.setHighlight);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
        <FilterPopover />
        {children}
        {focusId ? (
          <button className="btn btn-sm bg-elevated" onClick={() => setFocus(null)} data-testid="exit-focus">
            <X size={13} strokeWidth={1.5} aria-hidden="true" />
            Exit focus on {adj.nodes.get(focusId)?.name ?? 'node'}
          </button>
        ) : null}
        {highlight ? (
          <button className="btn btn-sm bg-elevated" onClick={() => setHighlight(null)}>
            <X size={13} strokeWidth={1.5} aria-hidden="true" />
            Clear highlight: {highlight.label}
          </button>
        ) : null}
      </div>
      <p className="meta pointer-events-auto bg-canvas/80 px-2 py-1" role="status">
        {view.nodes.length.toLocaleString()} nodes, {view.edges.length.toLocaleString()} relationships
        {view.collapsedSymbols ? `, ${view.collapsedSymbols.toLocaleString()} symbols folded into their files` : ''}
        {view.truncated ? ' (limited by the node limit in Settings)' : ''}
        {status ? <> — {status}</> : null}
      </p>
    </div>
  );
}

function FilterPopover() {
  const { graph, palette } = useWs();
  const hiddenNodeTypes = useWorkspace((s) => s.hiddenNodeTypes);
  const hiddenEdgeTypes = useWorkspace((s) => s.hiddenEdgeTypes);
  const setHiddenNodeTypes = useWorkspace((s) => s.setHiddenNodeTypes);
  const setHiddenEdgeTypes = useWorkspace((s) => s.setHiddenEdgeTypes);
  const counts = useMemo(() => ({ nodes: graph.stats.nodesByType, edges: graph.stats.edgesByType }), [graph]);
  const toggle = (list: string[], v: string, set: (l: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const nodeTypes = NODE_TYPES.filter((t) => (counts.nodes[t] ?? 0) > 0 && t !== 'Repository');
  const edgeTypes = EDGE_TYPES.filter((t) => (counts.edges[t] ?? 0) > 0);
  const active = hiddenNodeTypes.length + hiddenEdgeTypes.length;
  return (
    <Popover.Root>
      <Popover.Trigger className="btn btn-sm bg-elevated" data-testid="filters-button">
        <SlidersHorizontal size={13} strokeWidth={1.5} aria-hidden="true" />
        Filters and legend
        {active ? <span className="meta">({active} hidden)</span> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-40 max-h-[70vh] w-[min(520px,calc(100vw-24px))] overflow-y-auto border border-line bg-elevated p-5 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.5)]">
          <div className="grid gap-6 sm:grid-cols-2">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-[0.8125rem] font-medium">Node types</legend>
              {nodeTypes.map((t) => (
                <FilterRow
                  key={t}
                  checked={!hiddenNodeTypes.includes(t)}
                  onChange={() => toggle(hiddenNodeTypes, t, setHiddenNodeTypes)}
                  label={NODE_TYPE_LABELS[t]}
                  count={counts.nodes[t] ?? 0}
                  swatch={
                    <span aria-hidden="true" style={{ color: nodeColor(t as NodeType, palette) }} className="inline-block w-4 text-center">
                      {FAMILY_GLYPH[NODE_FAMILY[t]]}
                    </span>
                  }
                />
              ))}
            </fieldset>
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-[0.8125rem] font-medium">Relationships</legend>
              {edgeTypes.map((t) => (
                <FilterRow key={t} checked={!hiddenEdgeTypes.includes(t)} onChange={() => toggle(hiddenEdgeTypes, t, setHiddenEdgeTypes)} label={EDGE_TYPE_LABELS[t]} count={counts.edges[t] ?? 0} />
              ))}
            </fieldset>
          </div>
          <div className="label mt-5 border-t border-line pt-3">
            <p className="flex items-center gap-3">
              <svg width="44" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="44" y2="4" stroke="var(--relation-active)" strokeWidth="1.5" />
              </svg>
              Solid line: relationship verified from source
            </p>
            <p className="mt-1 flex items-center gap-3">
              <svg width="44" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="44" y2="4" stroke="var(--relation-unverified)" strokeWidth="1.5" strokeDasharray="4 4" />
              </svg>
              Dashed or thin line: derived, not verified
            </p>
            <p className="mt-2">Each node type has its own glyph and size; names are shown as you zoom in.</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterRow({ checked, onChange, label, count, swatch }: { checked: boolean; onChange: () => void; label: string; count: number; swatch?: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2 py-[3px] text-[0.8125rem]', !checked && 'text-ink-3')}>
      <input type="checkbox" className="accent-(--indigo)" checked={checked} onChange={onChange} />
      {swatch}
      <span className="flex-1">{label}</span>
      <span className="meta">{count.toLocaleString()}</span>
    </label>
  );
}
