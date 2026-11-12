import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import Markdown from 'react-markdown';
import { useSearchParams } from 'react-router';
import { CodePreview } from '@/components/CodePreview';
import { Empty, Loading, cx } from '@/components/ui';
import { api, useSource } from '@/lib/api';
import { useWs } from './context';

/** Documentation files found in the repository, plus documents generated from the graph. */
export function Documentation() {
  const { repo } = useWs();
  const [params, setParams] = useSearchParams();
  const docs = useQuery({ queryKey: ['docs', repo.id], queryFn: () => api.docs(repo.id) });
  const generated = params.get('generated');
  const path = params.get('path');
  useEffect(() => {
    if (!path && !generated && docs.data)
      setParams(docs.data[0] ? { path: docs.data[0].path } : { generated: 'architecture' }, {
        replace: true,
      });
  }, [path, generated, docs.data, setParams]);
  const source = useSource(repo.id, path);
  const gen = useQuery({
    queryKey: ['generated-doc', repo.id, generated],
    queryFn: async () => (await fetch(api.exportUrl(repo.id, generated!, false))).text(),
    enabled: !!generated,
  });
  const content = generated ? gen.data : source.data?.content;
  const isMarkdown = !!generated || /\.(md|mdx|markdown)$/i.test(path ?? '');

  return (
    <div className="flex h-full flex-col md:flex-row" data-testid="documentation">
      <nav
        aria-label="Documents"
        className="max-h-[32dvh] shrink-0 overflow-y-auto border-b border-line px-6 py-6 md:max-h-none md:w-[280px] md:border-b-0 md:border-r"
      >
        <h2 className="font-editorial text-[1.25rem]">Documentation</h2>
        <h3 className="mb-1 mt-5 text-[0.8125rem] font-medium text-ink-2">Generated from the graph</h3>
        {(
          [
            ['architecture', 'Architecture'],
            ['markdown', 'Repository analysis'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={cx('link-row text-[0.875rem]', generated === id && 'font-medium')}
            aria-current={generated === id ? 'page' : undefined}
            onClick={() => setParams({ generated: id })}
          >
            {label}
          </button>
        ))}
        <h3 className="mb-1 mt-6 text-[0.8125rem] font-medium text-ink-2">In the repository</h3>
        {docs.isLoading ? <p className="meta">Loading…</p> : null}
        {docs.data?.length === 0 ? <p className="label">No documentation files were found.</p> : null}
        {docs.data?.map((d) => (
          <button
            key={d.path}
            className={cx('link-row', path === d.path && 'font-medium')}
            aria-current={path === d.path ? 'page' : undefined}
            onClick={() => setParams({ path: d.path })}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem]">{d.title}</span>
              <span className="meta block truncate">{d.path}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-12">
        {(generated ? gen.isLoading : source.isLoading) ? (
          <Loading label="Loading document" />
        ) : (generated ? gen.error : source.error) ? (
          <Empty title="This document could not be opened">
            {((generated ? gen.error : source.error) as Error).message}
          </Empty>
        ) : content === undefined ? null : isMarkdown ? (
          <article className="prose-doc">
            {generated ? (
              <p className="meta mb-6">
                Generated from the knowledge graph. Download it from Export in the header.
              </p>
            ) : (
              <p className="meta mb-6">{path}</p>
            )}
            {/* react-markdown renders to React elements and ignores raw HTML, so repository text cannot inject markup. */}
            <Markdown
              urlTransform={(url) => (/^(https?:|mailto:|#)/i.test(url) ? url : '')}
              components={{
                a: ({ href, children }) =>
                  href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
                img: ({ alt }) => <span className="meta">[image: {alt || 'no description'}]</span>,
              }}
            >
              {content}
            </Markdown>
          </article>
        ) : (
          <div className="max-w-[980px]">
            <p className="meta mb-3">{path}</p>
            <CodePreview
              content={content}
              language={source.data?.language ?? null}
              path={path ?? ''}
              maxHeight="70vh"
            />
          </div>
        )}
        {!generated && source.data?.truncated ? (
          <p className="meta mt-4">The file is larger than the preview limit and was shortened.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Full-file source viewer, opened from “Open source location”. */
export function SourceView() {
  const { repo, adj, reveal, openView, settings } = useWs();
  const [params] = useSearchParams();
  const path = params.get('path');
  const line = Number(params.get('line') ?? 1) || 1;
  const { data, isLoading, error } = useSource(repo.id, path);
  if (!path) return <Empty title="No file selected">Open a source location from the inspector.</Empty>;
  if (isLoading) return <Loading label="Loading source" />;
  if (error || !data)
    return <Empty title="The file could not be opened">{(error as Error | null)?.message}</Empty>;
  const fileId = `file:${data.path}`;
  return (
    <div className="flex h-full flex-col" data-testid="source-view">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4 md:px-10">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[0.9375rem] font-medium">{data.path}</h2>
          <p className="meta">
            {data.totalLines.toLocaleString()} lines{data.language ? `, ${data.language}` : ''}
            {data.truncated ? ', shortened to the preview limit' : ''} — line {line}
          </p>
        </div>
        {adj.nodes.has(fileId) ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              reveal(fileId);
              openView(settings.graph.defaultMode);
            }}
          >
            Show this file in the graph
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 md:p-6">
        <CodePreview
          content={data.content}
          language={data.language}
          path={data.path}
          maxHeight="calc(100dvh - 190px)"
          highlight={{ start: line, end: line }}
          scrollToLine={line}
        />
      </div>
    </div>
  );
}
