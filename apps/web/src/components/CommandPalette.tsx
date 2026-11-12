import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/store';
import { useWs } from '@/workspace/context';
import { TypeMark } from './ui';

const VIEWS: { view: Parameters<ReturnType<typeof useWs>['openView']>[0]; label: string }[] = [
  { view: 'overview', label: 'Overview' },
  { view: 'mindmap', label: 'Mind Map' },
  { view: 'graph', label: 'Graph Explorer' },
  { view: 'atlas', label: '3D Atlas' },
  { view: 'dependencies', label: 'Dependency Explorer' },
  { view: 'search', label: 'Search' },
  { view: 'docs', label: 'Documentation' },
  { view: 'settings', label: 'Settings' },
];

const itemClass =
  'flex cursor-pointer items-baseline gap-3 border-l-2 border-transparent px-5 py-2 text-[0.875rem] data-[selected=true]:border-ink data-[selected=true]:bg-surface';

/** Global search (Ctrl/Cmd + K). Enter opens the selected result and highlights it in the graph. */
export function CommandPalette() {
  const { repo, reveal, openView, settings } = useWs();
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  const location = useLocation();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 140);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    if (!open) setInput('');
  }, [open]);
  const { data, isFetching } = useQuery({ queryKey: ['search', repo.id, query], queryFn: () => api.search(repo.id, query), enabled: open && query.length >= 2, staleTime: 30_000, placeholderData: (p) => p });

  const current = location.pathname.split('/')[3] ?? 'overview';
  const openNode = (id: string) => {
    setOpen(false);
    reveal(id);
    // Stay in the current exploration view; otherwise open the default one.
    if (!['graph', 'atlas', 'mindmap'].includes(current)) openView(settings.graph.defaultMode);
  };
  const results = query.length >= 2 ? (data?.results ?? []) : [];
  const documents = query.length >= 2 ? (data?.documents ?? []) : [];
  const views = VIEWS.filter((v) => !query || v.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Search the repository" shouldFilter={false} overlayClassName="overlay" contentClassName="dialog" loop>
      <div className="flex items-center gap-3 border-b border-line px-5">
        <Command.Input
          value={input}
          onValueChange={setInput}
          placeholder="Search files, symbols, concepts and documentation"
          className="h-[52px] w-full border-0 bg-transparent font-sans text-[0.9375rem] text-ink outline-none placeholder:text-ink-3"
          data-testid="palette-input"
        />
        <kbd className="meta shrink-0">Esc</kbd>
      </div>
      <Command.List className="max-h-[56vh] overflow-y-auto py-2" aria-busy={isFetching}>
        {query.length >= 2 && !isFetching ? <Command.Empty className="label px-5 py-6">Nothing in this repository matches “{query}”. Try a file path or part of a symbol name.</Command.Empty> : null}
        {results.length ? (
          <Command.Group heading="Graph" className="[&_[cmdk-group-heading]]:meta [&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-1.5">
            {results.map((r) => (
              <Command.Item key={r.id} value={r.id} onSelect={() => openNode(r.id)} className={itemClass} data-testid="palette-result">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.8125rem]">{r.name}</span>
                  {r.filePath ? (
                    <span className="meta block truncate">
                      {r.filePath}
                      {r.line && r.type !== 'File' ? `:${r.line}` : ''}
                    </span>
                  ) : r.description ? (
                    <span className="meta block truncate">{r.description}</span>
                  ) : null}
                </span>
                <TypeMark node={r} />
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {documents.length ? (
          <Command.Group heading="Documentation" className="[&_[cmdk-group-heading]]:meta [&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-1.5">
            {documents.map((d) => (
              <Command.Item
                key={`${d.path}:${d.line}`}
                value={`doc:${d.path}:${d.line}`}
                onSelect={() => {
                  setOpen(false);
                  openView('docs', `path=${encodeURIComponent(d.path)}`);
                }}
                className={itemClass}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.snippet}</span>
                  <span className="meta block truncate">
                    {d.path}:{d.line}
                    {d.heading ? ` — ${d.heading}` : ''}
                  </span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {views.length ? (
          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:meta [&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-1.5">
            {views.map((v) => (
              <Command.Item
                key={v.view}
                value={`view:${v.view}`}
                onSelect={() => {
                  setOpen(false);
                  openView(v.view);
                }}
                className={itemClass}
              >
                {v.label}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
      <p className="meta border-t border-line px-5 py-2">Enter opens the selected result. Arrow keys move through the list.</p>
    </Command.Dialog>
  );
}
