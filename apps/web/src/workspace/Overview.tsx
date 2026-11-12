import { Empty, Loading, SectionHeading } from '@/components/ui';
import { useOverview } from '@/lib/api';
import { useWorkspace } from '@/lib/store';
import { useWs } from './context';

export function Overview() {
  const { repo, reveal, openView, settings } = useWs();
  const { data: o, isLoading, error } = useOverview(repo.id);
  const setFocus = useWorkspace((s) => s.setFocus);
  if (isLoading) return <Loading label="Reading analysis" />;
  if (error || !o)
    return <Empty title="The overview could not be loaded">{(error as Error | null)?.message}</Empty>;

  const show = (id: string, view: 'graph' | 'atlas' | 'mindmap' = settings.graph.defaultMode) => {
    reveal(id);
    openView(view);
  };
  const analysed = o.languages.filter((l) => l.tier > 0);
  const other = o.languages.filter((l) => l.tier === 0);
  const maxFiles = Math.max(1, ...analysed.map((l) => l.files));

  return (
    <div className="h-full overflow-y-auto" data-testid="overview">
      <div className="mx-auto grid max-w-[1180px] gap-x-16 gap-y-12 px-6 py-10 md:px-12 lg:grid-cols-12">
        {/* Lead column, deliberately narrow and offset */}
        <header className="lg:col-span-7">
          <p className="meta">{repo.sourceKind === 'sample' ? 'Bundled sample repository' : repo.origin}</p>
          <h2 className="font-editorial mt-2 text-(length:--text-page) leading-[1.15]">{repo.name}</h2>
          {o.description ? (
            <p className="mt-4 max-w-[60ch] text-[1.0625rem] leading-[1.7] text-ink-2">
              {o.description} <span className="meta">— {o.descriptionSource}</span>
            </p>
          ) : (
            <p className="label mt-4">No description was found in the manifests or the README.</p>
          )}
          <div className="mt-7 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => openView('graph')}>
              Open the Graph Explorer
            </button>
            <button className="btn" onClick={() => openView('atlas')}>
              Open the 3D Atlas
            </button>
            <button className="btn" onClick={() => openView('mindmap')}>
              Open the Mind Map
            </button>
          </div>
        </header>

        <aside className="lg:col-span-4 lg:col-start-9" aria-label="Index status">
          <dl className="m-0 grid grid-cols-2 gap-x-8 gap-y-4">
            {[
              ['Files', o.repository.fileCount],
              ['Symbols', o.repository.symbolCount],
              ['Relationships', o.repository.relationshipCount],
              ['Unresolved references', o.unresolved],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="label">{k}</dt>
                <dd className="m-0 font-mono text-[1.375rem] tabular-nums">
                  {(v as number).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <p className="meta mt-4">
            {o.summary
              ? `Last run: ${o.summary.analyzedFiles} files analysed, ${o.summary.reusedFiles} reused from cache, ${(o.summary.durationMs / 1000).toFixed(1)} s${o.summary.incremental ? ' (incremental)' : ''}.`
              : 'No indexing summary is stored.'}{' '}
            Graph checks: {o.validation.errors} errors, {o.validation.warnings} warnings.
          </p>
          {o.unresolved > 0 ? (
            <p className="label mt-2">
              Unresolved references are listed in the Dependency Explorer. They are never drawn as
              relationships.
            </p>
          ) : null}
        </aside>

        <section className="lg:col-span-7" aria-labelledby="ov-arch">
          <SectionHeading id="ov-arch">Architecture summary</SectionHeading>
          <ul className="m-0 list-none p-0">
            {o.architectureSummary.map((s, i) => (
              <li key={i} className="border-b border-line py-3">
                <p>
                  {s.statement} {!s.verified ? <span className="tag tag-derived ml-1">derived</span> : null}
                </p>
                <p className="meta mt-1 break-words">Evidence: {s.evidence}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lg:col-span-4 lg:col-start-9" aria-labelledby="ov-lang">
          <SectionHeading id="ov-lang">Languages</SectionHeading>
          <ul className="m-0 list-none p-0">
            {analysed.map((l) => (
              <li key={l.language} className="py-2">
                <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
                  <span>{l.language}</span>
                  <span className="meta">
                    {l.analyzedFiles}/{l.files} files, {l.symbols.toLocaleString()} symbols
                  </span>
                </div>
                <div className="mt-1 h-[3px] bg-line" role="presentation">
                  <div className="h-full bg-ink-2" style={{ width: `${(l.files / maxFiles) * 100}%` }} />
                </div>
                <p className="meta mt-1">
                  {l.adapter ?? 'not analysed'}
                  {l.parseErrors ? `, ${l.parseErrors} parse notes` : ''}
                </p>
              </li>
            ))}
          </ul>
          {other.length ? (
            <p className="label mt-3">
              Detected but not analysed at symbol level:{' '}
              {other.map((l) => `${l.language} (${l.files})`).join(', ')}.
            </p>
          ) : null}
          {o.frameworks.length ? (
            <>
              <h3 className="mb-2 mt-6 text-[0.8125rem] font-medium text-ink-2">Frameworks</h3>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {o.frameworks.map((f) => (
                  <li key={f.name} className="tag" title={f.evidence}>
                    {f.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="lg:col-span-6" aria-labelledby="ov-sub">
          <SectionHeading id="ov-sub" aside="from the repository layout">
            Major subsystems
          </SectionHeading>
          <table className="data-table">
            <thead>
              <tr>
                <th>Subsystem</th>
                <th className="num">Files</th>
                <th className="num">Symbols</th>
                <th className="num" title="Relationships leaving this subsystem">
                  Out
                </th>
                <th className="num" title="Relationships entering this subsystem">
                  In
                </th>
              </tr>
            </thead>
            <tbody>
              {o.subsystems.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-ink underline decoration-line underline-offset-4 hover:decoration-current"
                      onClick={() => {
                        setFocus(null);
                        show(s.id);
                      }}
                    >
                      {s.name}
                    </button>
                  </td>
                  <td className="num">{s.files}</td>
                  <td className="num">{s.symbols}</td>
                  <td className="num">{s.outbound}</td>
                  <td className="num">{s.inbound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="lg:col-span-5 lg:col-start-8" aria-labelledby="ov-entry">
          <SectionHeading id="ov-entry">Main entry points</SectionHeading>
          {o.entryPoints.length === 0 ? (
            <p className="label">No entry point could be identified from manifests or file conventions.</p>
          ) : null}
          {o.entryPoints.map((e) => (
            <button key={e.nodeId} className="link-row" onClick={() => show(e.nodeId)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[0.8125rem]">{e.path}</span>
                <span className="meta block">{e.reason}</span>
              </span>
            </button>
          ))}
          {o.concepts.length ? (
            <>
              <div className="mt-8">
                <SectionHeading aside="derived from names and paths">Concepts</SectionHeading>
              </div>
              {o.concepts.map((c) => (
                <button
                  key={c.id}
                  className="link-row"
                  onClick={() => show(c.id, 'mindmap')}
                  title={c.evidence.join('\n')}
                >
                  <span className="flex-1">{c.name}</span>
                  <span className="meta">{c.members} files</span>
                </button>
              ))}
            </>
          ) : null}
        </section>

        <section className="lg:col-span-6" aria-labelledby="ov-large">
          <SectionHeading id="ov-large">Largest modules</SectionHeading>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Symbols</th>
                <th className="num">Lines</th>
              </tr>
            </thead>
            <tbody>
              {o.largestModules.map((m) => (
                <tr key={m.id}>
                  <td className="max-w-0 w-full">
                    <button
                      className="block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-[0.8125rem] text-ink hover:text-indigo"
                      onClick={() => show(m.id)}
                      title={m.path}
                    >
                      {m.path}
                    </button>
                  </td>
                  <td className="num">{m.symbols}</td>
                  <td className="num">{m.lines.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="lg:col-span-5 lg:col-start-8" aria-labelledby="ov-deps">
          <SectionHeading id="ov-deps">Dependency statistics</SectionHeading>
          <dl className="m-0 grid grid-cols-3 gap-4">
            {[
              ['Declared', o.dependencies.declared],
              ['Imported', o.dependencies.imported],
              ['Internal imports', o.dependencies.internalImports],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="label">{k}</dt>
                <dd className="m-0 font-mono text-[1.125rem]">{(v as number).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <ul className="m-0 mt-4 list-none p-0">
            {o.dependencies.externalPackages
              .filter((p) => p.importers > 0)
              .slice(0, 8)
              .map((p) => (
                <li
                  key={p.name}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[0.8125rem]"
                >
                  <span className="truncate font-mono">{p.name}</span>
                  <span className="meta shrink-0">
                    {p.importers} file{p.importers === 1 ? '' : 's'}
                    {p.declared ? '' : ', not declared'}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-4">
            <button className="btn btn-sm" onClick={() => openView('dependencies')}>
              Open the Dependency Explorer
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}
