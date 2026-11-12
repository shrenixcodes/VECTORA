import { useMemo, useState } from 'react';
import { EDGE_TYPE_LABELS } from '@vectora/graph-schema';
import { Empty, SectionHeading, cx } from '@/components/ui';
import { useAnalysis } from '@/lib/api';
import { useWorkspace } from '@/lib/store';
import { useWs } from './context';

type Tab = 'packages' | 'subsystems' | 'cycles' | 'flows' | 'unresolved';

/** Finds groups of files that import each other (strongly connected components, Tarjan). */
function importCycles(nodes: string[], out: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { id: string; i: number }[] = [{ id: root, i: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    on.add(root);
    while (work.length) {
      const f = work[work.length - 1]!;
      const next = out.get(f.id) ?? [];
      if (f.i < next.length) {
        const w = next[f.i++]!;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          on.add(w);
          work.push({ id: w, i: 0 });
        } else if (on.has(w)) low.set(f.id, Math.min(low.get(f.id)!, index.get(w)!));
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(f.id)!));
        if (low.get(f.id) === index.get(f.id)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            on.delete(w);
            comp.push(w);
          } while (w !== f.id);
          if (comp.length > 1) result.push(comp);
        }
      }
    }
  }
  return result.sort((a, b) => b.length - a.length);
}

export function Dependencies() {
  const { repo, graph, adj, reveal, openView, settings } = useWs();
  const { data: analysis } = useAnalysis(repo.id);
  const setHighlight = useWorkspace((s) => s.setHighlight);
  const [tab, setTab] = useState<Tab>('packages');
  const [filter, setFilter] = useState('');

  const packages = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.type === 'Package')
        .map((p) => {
          const importers = (adj.in.get(p.id) ?? []).filter((e) => e.type === 'IMPORTS');
          const declaredBy = (adj.in.get(p.id) ?? []).filter((e) => e.type === 'DEPENDS_ON');
          return { node: p, importers, declaredBy, files: new Set(importers.map((e) => e.source)).size };
        })
        .sort((a, b) => b.files - a.files || (a.node.name < b.node.name ? -1 : 1)),
    [graph, adj],
  );
  const subsystemDeps = useMemo(
    () =>
      graph.edges
        .filter((e) => e.type === 'DEPENDS_ON' && e.source.startsWith('sub:'))
        .sort((a, b) => Number(b.metadata?.count ?? 0) - Number(a.metadata?.count ?? 0)),
    [graph],
  );
  const cycles = useMemo(() => {
    const out = new Map<string, string[]>();
    const files = new Set<string>();
    for (const e of graph.edges) {
      if (e.type !== 'IMPORTS' || !e.target.startsWith('file:') || e.source === e.target) continue;
      (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e.target);
      files.add(e.source);
      files.add(e.target);
    }
    return importCycles([...files], out);
  }, [graph]);

  const showIn = (label: string, nodeIds: string[], edgeIds: string[] = []) => {
    setHighlight({ label, nodeIds, edgeIds });
    useWorkspace.getState().clearSelection();
    openView(settings.graph.defaultMode === 'mindmap' ? 'graph' : settings.graph.defaultMode);
  };
  const q = filter.trim().toLowerCase();
  const tabs: [Tab, string, number][] = [
    ['packages', 'External packages', packages.length],
    ['subsystems', 'Between subsystems', subsystemDeps.length],
    ['cycles', 'Circular imports', cycles.length],
    ['flows', 'Execution flows', analysis?.flows.length ?? 0],
    ['unresolved', 'Unresolved references', analysis?.unresolvedCount ?? 0],
  ];

  return (
    <div className="flex h-full flex-col" data-testid="dependencies">
      <div className="border-b border-line px-6 pt-6 md:px-10">
        <h2 className="font-editorial text-[1.5rem]">Dependency Explorer</h2>
        <div role="tablist" aria-label="Dependency views" className="-mb-px mt-4 flex gap-6 overflow-x-auto">
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={cx(
                'cursor-pointer whitespace-nowrap border-0 border-b-2 bg-transparent px-0 pb-2 text-[0.875rem]',
                tab === id
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink',
              )}
              onClick={() => setTab(id)}
            >
              {label} <span className="meta">{count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10" role="tabpanel">
        {tab === 'packages' ? (
          packages.length === 0 ? (
            <Empty title="No external packages">
              No manifest declares a dependency and no source file imports one.
            </Empty>
          ) : (
            <div className="max-w-[980px]">
              <input
                type="search"
                className="field mb-4 max-w-[320px]"
                placeholder="Filter packages"
                aria-label="Filter packages"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Version</th>
                    <th>Declared in</th>
                    <th className="num">Importing files</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {packages
                    .filter((p) => !q || p.node.name.toLowerCase().includes(q))
                    .slice(0, 400)
                    .map((p) => (
                      <tr key={p.node.id}>
                        <td>
                          <button
                            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.8125rem] text-ink hover:text-indigo"
                            onClick={() => reveal(p.node.id)}
                          >
                            {p.node.name}
                          </button>
                          {p.node.metadata.dev ? <span className="tag ml-2">dev</span> : null}
                        </td>
                        <td className="meta">{(p.node.metadata.version as string | null) ?? ''}</td>
                        <td className="meta">
                          {p.declaredBy.length ? (
                            p.declaredBy.map((e) => `${e.location?.path}:${e.location?.startLine}`).join(', ')
                          ) : (
                            <span style={{ color: 'var(--warning)' }}>not declared in a manifest</span>
                          )}
                        </td>
                        <td className="num">{p.files || <span className="text-ink-3">not imported</span>}</td>
                        <td className="text-right">
                          {p.files ? (
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                showIn(
                                  `imports of ${p.node.name}`,
                                  [p.node.id, ...p.importers.map((e) => e.source)],
                                  p.importers.map((e) => e.id),
                                )
                              }
                            >
                              Show in graph
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === 'subsystems' ? (
          subsystemDeps.length === 0 ? (
            <Empty title="No dependencies between subsystems">
              Either the repository has a single subsystem or no relationship crosses a subsystem boundary.
            </Empty>
          ) : (
            <ul className="m-0 max-w-[900px] list-none p-0">
              {subsystemDeps.map((e) => (
                <li key={e.id} className="border-b border-line py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p>
                      <button
                        className="cursor-pointer border-0 bg-transparent p-0 font-medium text-ink hover:text-indigo"
                        onClick={() => reveal(e.source)}
                      >
                        {adj.nodes.get(e.source)?.name}
                      </button>{' '}
                      <span className="label">depends on</span>{' '}
                      <button
                        className="cursor-pointer border-0 bg-transparent p-0 font-medium text-ink hover:text-indigo"
                        onClick={() => reveal(e.target)}
                      >
                        {adj.nodes.get(e.target)?.name}
                      </button>
                    </p>
                    <span className="meta">
                      {Object.entries((e.metadata?.kinds as Record<string, number>) ?? {})
                        .map(([k, v]) => `${v} ${EDGE_TYPE_LABELS[k as keyof typeof EDGE_TYPE_LABELS]}`)
                        .join(', ')}
                    </span>
                  </div>
                  <p className="meta mt-1 break-words">{e.evidence}</p>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'cycles' ? (
          cycles.length === 0 ? (
            <Empty title="No circular imports">
              No group of files imports itself through resolved import relationships.
            </Empty>
          ) : (
            <ul className="m-0 max-w-[900px] list-none p-0">
              {cycles.map((c, i) => (
                <li key={i} className="border-b border-line py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{c.length} files import each other</p>
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        showIn(
                          `import cycle of ${c.length} files`,
                          c,
                          graph.edges
                            .filter(
                              (e) => e.type === 'IMPORTS' && c.includes(e.source) && c.includes(e.target),
                            )
                            .map((e) => e.id),
                        )
                      }
                    >
                      Show in graph
                    </button>
                  </div>
                  <ul className="m-0 mt-2 list-none p-0">
                    {c.slice(0, 12).map((id) => (
                      <li key={id}>
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.8125rem] text-ink-2 hover:text-indigo"
                          onClick={() => reveal(id)}
                        >
                          {adj.nodes.get(id)?.filePath}
                        </button>
                      </li>
                    ))}
                    {c.length > 12 ? <li className="meta">{c.length - 12} more</li> : null}
                  </ul>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'flows' ? (
          !analysis?.flows.length ? (
            <Empty title="No execution flows">
              No API endpoint or entry point with resolved outgoing calls was found.
            </Empty>
          ) : (
            <div className="max-w-[980px]">
              <p className="label mb-4 max-w-[70ch]">
                Flows follow route and call relationships from an endpoint or entry point. They are derived
                from static structure; callbacks and runtime wiring are not included.
              </p>
              <ul className="m-0 list-none p-0">
                {analysis.flows.map((f) => (
                  <li key={f.id} className="border-b border-line py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="font-mono text-[0.875rem]">
                        {f.name}{' '}
                        {f.reachesData ? <span className="tag ml-2">reaches data access</span> : null}
                      </p>
                      <button className="btn btn-sm" onClick={() => showIn(f.name, f.steps)}>
                        Show in graph
                      </button>
                    </div>
                    <ol className="m-0 mt-2 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0">
                      {f.steps.map((s, i) => (
                        <li key={s} className="flex items-center gap-2">
                          {i > 0 ? (
                            <span className="text-ink-3" aria-hidden="true">
                              ›
                            </span>
                          ) : null}
                          <button
                            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.75rem] text-ink-2 hover:text-indigo"
                            onClick={() => reveal(s)}
                          >
                            {adj.nodes.get(s)?.name ?? s}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}

        {tab === 'unresolved' ? (
          !analysis?.unresolvedCount ? (
            <Empty title="Nothing unresolved">
              Every reference the analysers found was tied to a definition.
            </Empty>
          ) : (
            <div className="max-w-[980px]">
              <p className="label mb-4 max-w-[72ch]">
                These references were found in the source but could not be tied to a definition with scope
                evidence. They are reported here and are not part of the graph.
              </p>
              <SectionHeading>By reason</SectionHeading>
              <ul className="m-0 mb-8 list-none p-0">
                {Object.entries(analysis.unresolvedByReason)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count]) => (
                    <li
                      key={reason}
                      className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[0.875rem]"
                    >
                      <span>{reason}</span>
                      <span className="meta">{count.toLocaleString()}</span>
                    </li>
                  ))}
              </ul>
              <SectionHeading aside={`first ${analysis.unresolvedSamples.length}`}>Samples</SectionHeading>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Kind</th>
                    <th>Location</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.unresolvedSamples.slice(0, 300).map((u, i) => (
                    <tr key={i}>
                      <td className="font-mono text-[0.75rem]">{u.name}</td>
                      <td className="meta">
                        {EDGE_TYPE_LABELS[u.kind as keyof typeof EDGE_TYPE_LABELS] ?? u.kind}
                      </td>
                      <td>
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.75rem] text-ink-2 hover:text-indigo"
                          onClick={() =>
                            openView('source', `path=${encodeURIComponent(u.fromPath)}&line=${u.line}`)
                          }
                        >
                          {u.fromPath}:{u.line}
                        </button>
                      </td>
                      <td className="meta whitespace-normal">{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
