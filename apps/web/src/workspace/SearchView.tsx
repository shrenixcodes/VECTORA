import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { NODE_TYPES, NODE_TYPE_LABELS, type NodeType } from '@vectora/graph-schema';
import type { ExplorationAnswer } from '@vectora/shared';
import { Notice, TypeMark, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/store';
import { useWs } from './context';

const EXAMPLES = [
  'Explain authentication',
  'Identify circular dependencies',
  'Explain the application startup sequence',
  'Show the complete database access path',
];

export function SearchView() {
  const { repo, graph, reveal, openView, settings } = useWs();
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'questions' ? 'questions' : 'search';
  const [input, setInput] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(input.trim());
  const [types, setTypes] = useState<NodeType[]>([]);
  const [question, setQuestion] = useState('');
  const setHighlight = useWorkspace((s) => s.setHighlight);
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 180);
    return () => clearTimeout(t);
  }, [input]);
  const search = useQuery({ queryKey: ['search', repo.id, query, types.join(',')], queryFn: () => api.search(repo.id, query, types), enabled: mode === 'search' && query.length >= 2, placeholderData: (p) => p });
  const ask = useMutation({ mutationFn: (q: string) => api.ask(repo.id, q) });
  const answer: ExplorationAnswer | undefined = ask.data;

  const present = NODE_TYPES.filter((t) => (graph.stats.nodesByType[t] ?? 0) > 0 && t !== 'Repository');
  const open = (id: string) => {
    reveal(id);
    openView(settings.graph.defaultMode);
  };
  const submit = (q: string) => {
    const text = q.trim();
    if (text.length < 2) return;
    setQuestion(text);
    ask.mutate(text);
  };

  return (
    <div className="flex h-full flex-col" data-testid="search-view">
      <div className="border-b border-line px-6 pt-6 md:px-10">
        <h2 className="font-editorial text-[1.5rem]">Search</h2>
        <div role="tablist" aria-label="Search mode" className="-mb-px mt-4 flex gap-6">
          {(
            [
              ['search', 'Find by name or path'],
              ['questions', 'Ask about the repository'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              className={cx('cursor-pointer border-0 border-b-2 bg-transparent px-0 pb-2 text-[0.875rem]', mode === id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink')}
              onClick={() => setParams(id === 'questions' ? { mode: 'questions' } : {})}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'search' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10" role="tabpanel">
          <div className="max-w-[860px]">
            <input
              type="search"
              className="field h-[44px] text-[0.9375rem]"
              placeholder="A symbol, file path, concept or phrase from a description"
              aria-label="Search the repository"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              data-testid="search-input"
            />
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Limit to node types">
              {present.map((t) => (
                <button key={t} className="btn btn-sm" aria-pressed={types.includes(t)} onClick={() => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>
                  {NODE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {search.error ? (
              <div className="mt-4">
                <Notice tone="error">{(search.error as Error).message}</Notice>
              </div>
            ) : null}
            {query.length < 2 ? (
              <p className="label mt-8">Type at least two characters. Exact names rank first, then prefixes, partial matches, paths and descriptions.</p>
            ) : search.data ? (
              <>
                <p className="meta mt-6" role="status">
                  {search.data.results.length} graph results{search.data.documents.length ? `, ${search.data.documents.length} documentation matches` : ''} for “{search.data.query}”
                </p>
                <ul className="m-0 mt-2 list-none p-0">
                  {search.data.results.map((r) => (
                    <li key={r.id}>
                      <button className="link-row" onClick={() => open(r.id)} data-testid="search-result">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[0.875rem]">{r.name}</span>
                          <span className="meta block truncate">
                            {r.filePath ? `${r.filePath}${r.line && r.type !== 'File' ? `:${r.line}` : ''}` : (r.description ?? '')}
                            {r.match !== 'name' ? ` — matched on ${r.match}` : ''}
                          </span>
                        </span>
                        <TypeMark node={r} />
                      </button>
                    </li>
                  ))}
                </ul>
                {search.data.results.length === 0 && search.data.documents.length === 0 ? <p className="label mt-6">Nothing matches. Check the spelling, or search for part of a file path.</p> : null}
                {search.data.documents.length ? (
                  <>
                    <h3 className="mb-1 mt-8 text-[0.8125rem] font-medium text-ink-2">Documentation</h3>
                    <ul className="m-0 list-none p-0">
                      {search.data.documents.map((d) => (
                        <li key={`${d.path}:${d.line}`}>
                          <button className="link-row" onClick={() => openView('docs', `path=${encodeURIComponent(d.path)}`)}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.875rem]">{d.snippet}</span>
                              <span className="meta block truncate">
                                {d.path}:{d.line}
                                {d.heading ? ` — ${d.heading}` : ''}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10" role="tabpanel">
          <div className="max-w-[860px]">
            <p className="label max-w-[68ch]">
              Questions are answered from the knowledge graph. Every statement cites the file and line it comes from, and anything the graph cannot establish is listed separately.
            </p>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit(new FormData(e.currentTarget).get('question') as string);
              }}
            >
              <input name="question" className="field h-[44px] text-[0.9375rem]" placeholder="What calls verifyToken?" aria-label="Question about the repository" maxLength={500} data-testid="ask-input" />
              <button className="btn btn-primary h-[44px]" disabled={ask.isPending}>
                {ask.isPending ? 'Looking' : 'Ask'}
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => (
                <button key={e} className="btn btn-sm" onClick={() => submit(e)}>
                  {e}
                </button>
              ))}
            </div>
            {ask.error ? (
              <div className="mt-6">
                <Notice tone="error">{(ask.error as Error).message}</Notice>
              </div>
            ) : null}
            {answer ? (
              <article className="mt-8" aria-live="polite" data-testid="answer">
                <p className="meta">{question}</p>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-editorial text-[1.375rem]">{answer.title}</h3>
                  {answer.nodeIds.length ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setHighlight({ label: answer.title, nodeIds: answer.nodeIds, edgeIds: answer.edgeIds });
                        useWorkspace.getState().clearSelection();
                        openView(settings.graph.defaultMode === 'mindmap' ? 'graph' : settings.graph.defaultMode);
                      }}
                    >
                      Highlight {answer.nodeIds.length} nodes in the graph
                    </button>
                  ) : null}
                </div>
                {answer.narrative ? (
                  <div className="mt-4 border-l-2 border-clay pl-4">
                    <p className="whitespace-pre-wrap text-[0.9375rem] leading-[1.7]">{answer.narrative}</p>
                    <p className="meta mt-2">Summary written by the optional narrative service at {answer.narrativeSource}. The evidence below comes from the graph.</p>
                  </div>
                ) : null}
                <ol className="m-0 mt-4 list-none p-0">
                  {answer.statements.map((s, i) => (
                    <li key={i} className="border-b border-line py-2.5">
                      <p className="text-[0.9375rem]">
                        <Formatted text={s.text} /> {!s.verified ? <span className="tag tag-derived ml-1">derived</span> : null}
                      </p>
                      {s.evidence.length ? (
                        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                          {s.evidence.slice(0, 4).map((ev, j) => (
                            <button
                              key={j}
                              className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.75rem] text-ink-3 underline decoration-line underline-offset-2 hover:text-indigo"
                              title={ev.snippet}
                              onClick={() => openView('source', `path=${encodeURIComponent(ev.path)}&line=${ev.startLine}`)}
                            >
                              {ev.path}:{ev.startLine}
                            </button>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {answer.caveats.length ? (
                  <div className="mt-5">
                    <h4 className="mb-1 text-[0.8125rem] font-medium text-ink-2">Not established</h4>
                    <ul className="label m-0 list-none space-y-1 p-0">
                      {answer.caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders `code` spans from statement text. The text is inserted as text nodes only. */
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="text-[0.84em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
