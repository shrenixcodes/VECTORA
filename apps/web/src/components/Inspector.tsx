import { ChevronRight, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  EDGE_TYPE_LABELS,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  isSymbolType,
} from '@vectora/graph-schema';
import { useSource } from '@/lib/api';
import { fileIdOf, relationsOf } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import { useWs } from '@/workspace/context';
import { CodePreview } from './CodePreview';
import { IconButton, TypeMark, cx } from './ui';

const METHOD_LABEL: Record<string, string> = {
  filesystem: 'file system structure',
  manifest: 'package manifest',
  'typescript-compiler': 'TypeScript compiler (syntax)',
  'typescript-checker': 'TypeScript type checker',
  'python-ast': 'Python syntax tree',
  'tree-sitter': 'Tree-sitter syntax tree',
  'scope-resolution': 'import and scope resolution',
  'name-resolution': 'name match within visible files',
  pattern: 'framework pattern',
  'structural-grouping': 'repository layout',
  'keyword-evidence': 'identifier and path evidence',
  aggregation: 'aggregated relationships',
};

function copy(text: string, done: (label: string) => void, label: string): void {
  void navigator.clipboard.writeText(text).then(
    () => done(label),
    () => done('Copy failed'),
  );
}

export function Inspector() {
  const { adj, repo, reveal, expandFile, openView } = useWs();
  const primaryId = useWorkspace((s) => s.primaryId);
  const selectedCount = useWorkspace((s) => s.selectedIds.length);
  const width = useWorkspace((s) => s.inspectorWidth);
  const setInspector = useWorkspace((s) => s.setInspector);
  const setFocus = useWorkspace((s) => s.setFocus);
  const focusId = useWorkspace((s) => s.focusId);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((label: string) => {
    setToast(label);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const node = primaryId ? adj.nodes.get(primaryId) : undefined;
  const rel = useMemo(() => (node ? relationsOf(node.id, adj) : null), [node, adj]);

  // Source range: the symbol itself, or the head of a file.
  const isFileLike = node?.type === 'File' || node?.type === 'Configuration';
  const loc = node?.location ?? null;
  const start = loc ? (isFileLike ? 1 : Math.max(1, loc.startLine - 2)) : undefined;
  const end = loc
    ? isFileLike
      ? Math.min(loc.endLine, 80)
      : Math.min(loc.endLine + 2, loc.startLine + 120)
    : undefined;
  const hasSource = !!node?.filePath && !!loc && (isFileLike || isSymbolType(node.type));
  const source = useSource(repo.id, hasSource ? node!.filePath : null, start, end);

  const onResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setInspector(true, Math.max(280, Math.min(720, startW + (startX - ev.clientX))));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  if (!node || !rel) return null;
  const dependencyText = () => {
    const lines = [
      `${node.name} (${node.type}) — ${node.filePath ?? ''}${loc ? `:${loc.startLine}` : ''}`,
      '',
      'Depends on:',
    ];
    for (const e of rel.outgoing)
      lines.push(
        `  ${e.type} ${adj.nodes.get(e.target)?.name ?? e.target}${e.location ? `  (${e.location.path}:${e.location.startLine})` : ''}`,
      );
    lines.push('', 'Used by:');
    for (const e of rel.incoming)
      lines.push(
        `  ${e.type} ${adj.nodes.get(e.source)?.name ?? e.source}${e.location ? `  (${e.location.path}:${e.location.startLine})` : ''}`,
      );
    return lines.join('\n');
  };
  const expandRelationships = () => {
    const files = new Set<string>();
    const self = fileIdOf(node);
    if (self) files.add(self);
    for (const e of [...rel.incoming, ...rel.outgoing]) {
      const other = adj.nodes.get(e.source === node.id ? e.target : e.source);
      const fid = other ? fileIdOf(other) : null;
      if (fid) files.add(fid);
    }
    for (const f of files) expandFile(f, true);
    notify(`${files.size} file${files.size === 1 ? '' : 's'} expanded`);
  };

  return (
    <aside
      aria-label="Inspector"
      data-testid="inspector"
      className="relative flex max-h-[52dvh] w-full shrink-0 flex-col border-t border-line bg-surface md:max-h-none md:w-(--inspector-w) md:border-l md:border-t-0"
      style={{ ['--inspector-w' as string]: `${width}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuenow={width}
        aria-valuemin={280}
        aria-valuemax={720}
        tabIndex={0}
        onPointerDown={onResize}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setInspector(true, Math.min(720, width + 24));
          if (e.key === 'ArrowRight') setInspector(true, Math.max(280, width - 24));
        }}
        className="absolute inset-y-0 -left-[3px] z-10 hidden w-[6px] cursor-col-resize hover:bg-indigo/30 focus-visible:bg-indigo/40 md:block"
      />
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <TypeMark node={node} />
          <h2
            className="mt-0.5 break-words font-mono text-[0.9375rem] font-medium"
            data-testid="inspector-name"
          >
            {node.name}
          </h2>
          {node.filePath ? (
            <p className="meta mt-1 break-all">
              {node.filePath}
              {loc && !isFileLike ? `:${loc.startLine}–${loc.endLine}` : ''}
            </p>
          ) : null}
          {selectedCount > 1 ? <p className="meta mt-1">{selectedCount} nodes selected</p> : null}
        </div>
        <IconButton
          label="Close inspector"
          className="btn-quiet shrink-0"
          onClick={() => setInspector(false)}
        >
          <X size={15} strokeWidth={1.5} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {node.description ? <p className="mb-4 text-[0.875rem] text-ink-2">{node.description}</p> : null}

        <div className="mb-5 flex flex-wrap gap-1.5">
          <button
            className="btn btn-sm"
            aria-pressed={focusId === node.id}
            onClick={() => setFocus(focusId === node.id ? null : node.id)}
          >
            {focusId === node.id ? 'Exit focus' : 'Focus in graph'}
          </button>
          <button className="btn btn-sm" onClick={expandRelationships}>
            Expand relationships
          </button>
          {node.filePath && loc ? (
            <button
              className="btn btn-sm"
              onClick={() =>
                openView('source', `path=${encodeURIComponent(node.filePath!)}&line=${loc.startLine}`)
              }
            >
              Open source location
            </button>
          ) : null}
          {node.filePath ? (
            <button className="btn btn-sm" onClick={() => copy(node.filePath!, notify, 'Path copied')}>
              Copy path
            </button>
          ) : null}
          <button
            className="btn btn-sm"
            onClick={() => copy(String(node.metadata.qualifiedName ?? node.name), notify, 'Name copied')}
          >
            Copy symbol name
          </button>
          <button
            className="btn btn-sm"
            onClick={() => copy(dependencyText(), notify, 'Dependencies copied')}
          >
            Copy dependency information
          </button>
        </div>
        <p role="status" aria-live="polite" className="meta -mt-3 mb-3 min-h-[1.4em]">
          {toast}
        </p>

        {hasSource ? (
          <Section title="Source">
            {source.isLoading ? (
              <p className="meta">Loading source…</p>
            ) : source.error ? (
              <p className="meta" style={{ color: 'var(--error)' }}>
                {(source.error as Error).message}
              </p>
            ) : source.data ? (
              <>
                <CodePreview
                  content={source.data.content}
                  language={source.data.language}
                  path={source.data.path}
                  firstLine={source.data.startLine}
                  highlight={isFileLike || !loc ? null : { start: loc.startLine, end: loc.endLine }}
                  maxHeight={300}
                />
                {source.data.endLine < source.data.totalLines &&
                (isFileLike || (loc && source.data.endLine < loc.endLine)) ? (
                  <p className="meta mt-1">
                    Lines {source.data.startLine}–{source.data.endLine} of {source.data.totalLines}. Open the
                    source location for the full file.
                  </p>
                ) : null}
              </>
            ) : null}
          </Section>
        ) : null}

        <Section title="Evidence">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.8125rem]">
            <dt className="text-ink-3">Found by</dt>
            <dd className="m-0">{METHOD_LABEL[node.extractionMethod] ?? node.extractionMethod}</dd>
            <dt className="text-ink-3">Status</dt>
            <dd className="m-0">{node.verified ? 'Verified from source' : 'Derived interpretation'}</dd>
            <dt className="text-ink-3">Confidence</dt>
            <dd className="m-0 font-mono text-[0.75rem]">{Math.round(node.confidence * 100)}%</dd>
            {node.language ? (
              <>
                <dt className="text-ink-3">Language</dt>
                <dd className="m-0">{node.language}</dd>
              </>
            ) : null}
            {node.metadata.signature ? (
              <>
                <dt className="text-ink-3">Signature</dt>
                <dd className="m-0 break-words font-mono text-[0.75rem]">
                  {String(node.metadata.signature)}
                </dd>
              </>
            ) : null}
            {node.metadata.entryPoint ? (
              <>
                <dt className="text-ink-3">Entry point</dt>
                <dd className="m-0">{String(node.metadata.entryPoint)}</dd>
              </>
            ) : null}
          </dl>
        </Section>

        {rel.parent ? (
          <Section title="Parent module">
            <NodeRow node={rel.parent} onClick={() => reveal(rel.parent!.id)} />
            {rel.subsystem && rel.subsystem.id !== rel.parent.id ? (
              <NodeRow node={rel.subsystem} onClick={() => reveal(rel.subsystem!.id)} />
            ) : null}
          </Section>
        ) : null}

        <Relationships
          title="Outgoing relationships"
          hint="what this node depends on"
          edges={rel.outgoing}
          side="target"
        />
        <Relationships
          title="Incoming relationships"
          hint="what depends on this node"
          edges={rel.incoming}
          side="source"
        />

        {rel.children.length ? (
          <Section title="Contains" count={rel.children.length}>
            {rel.children.slice(0, 40).map((c) => (
              <NodeRow key={c.id} node={c} onClick={() => reveal(c.id)} />
            ))}
            {rel.children.length > 40 ? <p className="meta mt-1">{rel.children.length - 40} more</p> : null}
          </Section>
        ) : null}

        {node.type === 'Concept' || node.type === 'Subsystem' ? (
          <Section
            title="Member files"
            count={(adj.in.get(node.id) ?? []).filter((e) => e.type === 'BELONGS_TO').length}
          >
            {(adj.in.get(node.id) ?? [])
              .filter((e) => e.type === 'BELONGS_TO')
              .slice(0, 40)
              .map((e) => {
                const f = adj.nodes.get(e.source);
                return f ? (
                  <div key={e.id} title={e.evidence}>
                    <NodeRow node={f} onClick={() => reveal(f.id)} derived={!e.verified} />
                  </div>
                ) : null;
              })}
          </Section>
        ) : null}

        {rel.concepts.length ? (
          <Section title="Related concepts">
            {rel.concepts.map((c) => (
              <NodeRow key={c.id} node={c} onClick={() => reveal(c.id)} derived />
            ))}
          </Section>
        ) : null}
      </div>
    </aside>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 flex items-baseline justify-between text-[0.8125rem] font-medium text-ink-2">
        {title}
        {count !== undefined ? <span className="meta">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function NodeRow({ node, onClick, derived }: { node: GraphNode; onClick: () => void; derived?: boolean }) {
  return (
    <button type="button" className="link-row" onClick={onClick}>
      <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">{node.name}</span>
      {derived ? <span className="tag tag-derived">derived</span> : null}
      <TypeMark node={node} />
    </button>
  );
}

function Relationships({
  title,
  hint,
  edges,
  side,
}: {
  title: string;
  hint: string;
  edges: GraphEdge[];
  side: 'source' | 'target';
}) {
  const { adj, reveal } = useWs();
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<EdgeType, GraphEdge[]>();
    for (const e of edges) (m.get(e.type) ?? m.set(e.type, []).get(e.type)!).push(e);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [edges]);
  return (
    <Section title={title} count={edges.length}>
      {edges.length === 0 ? <p className="meta">None resolved — {hint}.</p> : null}
      {groups.map(([type, list]) => (
        <div key={type} className="mb-2">
          <p className="meta mb-0.5">
            {EDGE_TYPE_LABELS[type]} <span className="text-ink-3">({list.length})</span>
          </p>
          <ul className="m-0 list-none p-0">
            {list.slice(0, 30).map((e) => {
              const other = adj.nodes.get(e[side]);
              const isOpen = open === e.id;
              return (
                <li key={e.id} className="border-b border-line">
                  <div className="flex items-baseline gap-2 py-1.5">
                    <button
                      type="button"
                      className="btn-quiet -ml-1 cursor-pointer border-0 bg-transparent p-1 text-ink-3"
                      aria-expanded={isOpen}
                      aria-label={`Evidence for ${other?.name ?? e[side]}`}
                      onClick={() => setOpen(isOpen ? null : e.id)}
                    >
                      <ChevronRight
                        size={12}
                        className={cx('transition-transform duration-200', isOpen && 'rotate-90')}
                      />
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-[0.8125rem] text-ink hover:text-indigo"
                      onClick={() => other && reveal(other.id)}
                    >
                      {other?.name ?? e[side]}
                    </button>
                    {!e.verified ? <span className="tag tag-derived">derived</span> : null}
                    {other ? <TypeMark node={other} showLabel={false} /> : null}
                  </div>
                  {isOpen ? (
                    <div className="mb-2 ml-5 border-l border-line pl-3 text-[0.75rem]">
                      <p className="break-words font-mono text-ink-2">{e.evidence}</p>
                      <p className="meta mt-1">
                        {e.location ? `${e.location.path}:${e.location.startLine}` : 'no single location'} —{' '}
                        {METHOD_LABEL[e.extractionMethod] ?? e.extractionMethod},{' '}
                        {Math.round(e.confidence * 100)}%
                        {e.metadata?.occurrences ? `, ${String(e.metadata.occurrences)} occurrences` : ''}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {list.length > 30 ? <p className="meta mt-1">{list.length - 30} more not shown</p> : null}
        </div>
      ))}
    </Section>
  );
}
