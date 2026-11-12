import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Moon, PanelRight, RefreshCw, Search, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { INDEX_STAGES, INDEX_STAGE_LABELS } from '@vectora/shared';
import { CommandPalette } from '@/components/CommandPalette';
import { ExportDialog } from '@/components/ExportDialog';
import { Inspector } from '@/components/Inspector';
import { Empty, IconButton, Loading, Notice, Wordmark, cx } from '@/components/ui';
import { ApiError, api, useGraph, useJob, useRepository, useSettings } from '@/lib/api';
import { buildAdjacency, deriveView, fileIdOf } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import { usePalette, useReducedMotion, useTheme } from '@/lib/theme';
import { WorkspaceContext, type WorkspaceContextValue } from './context';

const NAV: { to: string; label: string }[] = [
  { to: '', label: 'Overview' },
  { to: 'mindmap', label: 'Mind Map' },
  { to: 'graph', label: 'Graph Explorer' },
  { to: 'atlas', label: '3D Atlas' },
  { to: 'dependencies', label: 'Dependency Explorer' },
  { to: 'search', label: 'Search' },
  { to: 'docs', label: 'Documentation' },
  { to: 'settings', label: 'Settings' },
];

const formatTime = (iso: string | null): string => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

export function WorkspaceLayout() {
  const { repoId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { settings, update } = useSettings();
  const theme = useTheme(settings?.appearance.theme);
  const palette = usePalette(theme);
  const reducedMotion = useReducedMotion(settings);
  const repoQuery = useRepository(repoId);
  const repo = repoQuery.data;
  const ready = repo?.status === 'ready';
  const { graph, partial, loadMembers, error: graphError } = useGraph(repoId, repo?.symbolCount ?? 0, settings?.performance.maxGraphNodes ?? 8000, !!repo && ready && !!settings);

  const ws = useWorkspace();
  const [jobId, setJobId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const job = useJob(jobId).data;
  const viewName = location.pathname.split('/')[3] ?? 'overview';

  // ---- session restore and autosave --------------------------------------
  const sessionQuery = useQuery({ queryKey: ['session', repoId], queryFn: () => api.session(repoId), enabled: !!repo && !!settings, staleTime: Infinity, gcTime: 0 });
  const hydrated = ws.sessionLoaded && ws.repoId === repoId;
  useEffect(() => {
    if (sessionQuery.isSuccess && settings && !(useWorkspace.getState().sessionLoaded && useWorkspace.getState().repoId === repoId))
      useWorkspace.getState().hydrate(repoId, sessionQuery.data, { hiddenEdgeTypes: [...new Set([...settings.graph.hiddenRelationships, 'EXPORTS'])] });
  }, [sessionQuery.isSuccess, sessionQuery.data, settings, repoId]);
  useEffect(() => () => useWorkspace.setState({ sessionLoaded: false, repoId: null }), [repoId]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void api.saveSession(repoId, useWorkspace.getState().snapshot(viewName)).catch(() => undefined), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [hydrated, repoId, viewName, ws.selectedIds, ws.focusId, ws.expandedIds, ws.hiddenNodeTypes, ws.hiddenEdgeTypes, ws.layouts]);

  // ---- re-index -----------------------------------------------------------
  useEffect(() => {
    if (job && job.status !== 'running') {
      void qc.invalidateQueries({ queryKey: ['repository', repoId] });
      for (const key of ['graph', 'overview', 'analysis', 'members', 'source']) void qc.invalidateQueries({ queryKey: [key, repoId] });
      if (job.status === 'completed') setJobId(null);
    }
  }, [job, qc, repoId]);
  const reindex = async () => {
    try {
      setJobId((await api.reindex(repoId)).id);
      void qc.invalidateQueries({ queryKey: ['repository', repoId] });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useWorkspace.getState().setPaletteOpen(!useWorkspace.getState().paletteOpen);
      } else if (e.key === 'Escape') {
        const s = useWorkspace.getState();
        if (s.paletteOpen) return; // the dialog closes itself
        if (document.querySelector('[role="dialog"]')) return;
        if (s.focusId) s.setFocus(null);
        else if (s.highlight) s.setHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- shared graph view --------------------------------------------------
  const adj = useMemo(() => (graph ? buildAdjacency(graph) : null), [graph]);
  const view = useMemo(() => {
    if (!graph || !adj || !settings) return null;
    return deriveView(graph, adj, {
      density: settings.graph.nodeDensity,
      expandedIds: ws.expandedIds,
      hiddenNodeTypes: ws.hiddenNodeTypes,
      hiddenEdgeTypes: ws.hiddenEdgeTypes,
      showUnverified: settings.graph.showUnverified,
      focusId: ws.focusId,
      focusDepth: settings.graph.focusBehavior === 'node' ? 1 : 2,
      maxNodes: settings.performance.maxGraphNodes,
      pinnedIds: [...ws.selectedIds, ...(ws.highlight?.nodeIds ?? [])],
    });
  }, [graph, adj, settings, ws.expandedIds, ws.hiddenNodeTypes, ws.hiddenEdgeTypes, ws.focusId, ws.selectedIds, ws.highlight]);

  const expandFile = useCallback(
    (fileId: string, force?: boolean) => {
      const node = adj?.nodes.get(fileId);
      if (node?.filePath && partial) void loadMembers(node.filePath);
      useWorkspace.getState().toggleExpanded(fileId, force);
    },
    [adj, partial, loadMembers],
  );
  const openView = useCallback<WorkspaceContextValue['openView']>((v, query) => navigate(`/w/${repoId}/${v === 'overview' ? '' : v}${query ? `?${query}` : ''}`), [navigate, repoId]);
  const reveal = useCallback(
    (nodeId: string) => {
      const n = adj?.nodes.get(nodeId);
      const fid = n ? fileIdOf(n) : null;
      if (n && fid && fid !== nodeId) expandFile(fid, true);
      useWorkspace.getState().select(nodeId, { reveal: true });
    },
    [adj, expandFile],
  );

  // ---- render -------------------------------------------------------------
  if (repoQuery.error)
    return (
      <Shell>
        <Empty title={(repoQuery.error as ApiError).status === 404 ? 'This repository is no longer in VECTORA' : 'The workspace could not be opened'}>
          <p>{(repoQuery.error as Error).message}</p>
          <p>
            <Link to="/import">Open another repository</Link>
          </p>
        </Empty>
      </Shell>
    );
  if (!repo || !settings) return <Loading label="Opening workspace" />;

  const indexing = repo.status === 'indexing' || repo.status === 'pending' || job?.status === 'running';
  const value: WorkspaceContextValue | null =
    graph && adj && view ? { repo, graph, adj, view, partial, settings, palette, theme, reducedMotion, expandFile, reveal, openView } : null;
  const showInspector = ws.inspectorOpen && !!ws.primaryId && viewName !== 'settings' && viewName !== 'docs' && !!value;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <a href="#workspace-main" className="skip-link">
        Skip to content
      </a>
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-4 py-2 md:px-6">
        <Link to="/" className="no-underline" aria-label="VECTORA home">
          <Wordmark className="text-[0.75rem]" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-0.5">
          <h1 className="font-editorial truncate text-[1.125rem]" title={repo.origin}>
            {repo.name}
          </h1>
          <dl className="meta flex flex-wrap items-baseline gap-x-5 gap-y-0.5" aria-label="Repository status">
            {repo.branch ? <Stat k="branch" v={repo.branch} /> : null}
            <Stat k="status" v={indexing ? 'indexing' : repo.status} tone={repo.status === 'failed' ? 'error' : indexing ? 'warning' : undefined} />
            <Stat k="indexed" v={formatTime(repo.lastIndexedAt)} />
            <Stat k="symbols" v={repo.symbolCount.toLocaleString()} />
            <Stat k="relationships" v={repo.relationshipCount.toLocaleString()} />
          </dl>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-sm" onClick={() => ws.setPaletteOpen(true)} aria-keyshortcuts="Control+K Meta+K">
            <Search size={14} strokeWidth={1.5} aria-hidden="true" />
            Search
            <kbd className="meta ml-1 hidden sm:inline">Ctrl K</kbd>
          </button>
          <IconButton label="Re-index repository" onClick={() => void reindex()} disabled={indexing} className="btn-quiet">
            <RefreshCw size={15} strokeWidth={1.5} className={indexing && !reducedMotion ? 'animate-spin' : ''} />
          </IconButton>
          <IconButton label="Export" onClick={() => setExportOpen(true)} disabled={!ready} className="btn-quiet">
            <Download size={15} strokeWidth={1.5} />
          </IconButton>
          <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => update({ appearance: { theme: theme === 'dark' ? 'light' : 'dark' } })} className="btn-quiet">
            {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
          </IconButton>
          {ws.primaryId ? (
            <IconButton label={ws.inspectorOpen ? 'Hide inspector' : 'Show inspector'} onClick={() => ws.setInspector(!ws.inspectorOpen)} aria-pressed={ws.inspectorOpen} className="btn-quiet">
              <PanelRight size={15} strokeWidth={1.5} />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Workspace" className="shrink-0 border-b border-line md:w-[188px] md:border-b-0 md:border-r">
          <ul className="m-0 flex list-none gap-1 overflow-x-auto p-2 md:flex-col md:gap-0 md:overflow-visible md:p-0 md:py-4">
            {NAV.map((n) => (
              <li key={n.label}>
                <NavLink
                  to={n.to}
                  end={n.to === ''}
                  className={({ isActive }) =>
                    cx(
                      'block whitespace-nowrap border-l-2 px-3 py-1.5 text-[0.875rem] no-underline transition-colors duration-200 md:px-6 md:py-[7px]',
                      isActive ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink',
                    )
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="workspace-main" className="relative min-h-0 min-w-0 flex-1 overflow-hidden" tabIndex={-1}>
          {job?.status === 'running' || (indexing && !value) ? (
            <IndexingProgress stageIndex={job?.stageIndex ?? 0} message={job?.message ?? 'Indexing'} processed={job?.processed ?? 0} total={job?.total ?? 0} overlay={!!value} />
          ) : null}
          {job?.status === 'failed' ? (
            <div className="absolute inset-x-0 top-0 z-20 p-4">
              <Notice tone="error" action={<button className="btn btn-sm" onClick={() => setJobId(null)}>Dismiss</button>}>
                Indexing failed: {job.error}
              </Notice>
            </div>
          ) : null}
          {repo.status === 'failed' && !value && !indexing ? (
            <Empty title="Indexing did not finish">
              <p>{repo.error ?? 'An unknown error stopped the indexer.'}</p>
              <p>
                <button className="btn btn-primary" onClick={() => void reindex()}>
                  Index again
                </button>
              </p>
            </Empty>
          ) : graphError ? (
            <Empty title="The graph could not be loaded">
              <p>{(graphError as Error).message}</p>
            </Empty>
          ) : value ? (
            <WorkspaceContext.Provider value={value}>
              <div className="flex h-full min-h-0 flex-col md:flex-row">
                <div className="relative min-h-0 min-w-0 flex-1">
                  <Outlet />
                </div>
                {showInspector ? <Inspector /> : null}
              </div>
              <CommandPalette />
              <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
            </WorkspaceContext.Provider>
          ) : indexing ? null : (
            <Loading label="Loading graph" />
          )}
        </main>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line px-6 py-4">
        <Link to="/" className="no-underline">
          <Wordmark className="text-[0.75rem]" />
        </Link>
      </header>
      {children}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'error' | 'warning' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-ink-3">{k}</dt>
      <dd className="m-0" style={{ color: tone === 'error' ? 'var(--error)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)' }}>
        {v}
      </dd>
    </div>
  );
}

export function IndexingProgress({ stageIndex, message, processed, total, overlay }: { stageIndex: number; message: string; processed: number; total: number; overlay?: boolean }) {
  return (
    <div className={cx('z-30 flex items-center justify-center', overlay ? 'absolute inset-0 bg-canvas/85 backdrop-blur-[1px]' : 'h-full')} role="status" aria-live="polite">
      <div className="w-[min(420px,calc(100vw-48px))]">
        <p className="font-editorial text-[1.375rem]">Indexing</p>
        <ol className="m-0 mt-5 list-none p-0">
          {INDEX_STAGES.map((s, i) => {
            const state = i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'pending';
            return (
              <li key={s} className={cx('flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[0.875rem]', state === 'pending' && 'text-ink-3', state === 'active' && 'font-medium')} aria-current={state === 'active' ? 'step' : undefined}>
                <span>
                  <span className="meta mr-3 inline-block w-4">{state === 'done' ? '✓' : i + 1}</span>
                  {INDEX_STAGE_LABELS[s]}
                </span>
                {state === 'active' ? <span className="meta">{total > 0 ? `${processed.toLocaleString()} / ${total.toLocaleString()}` : ''}</span> : null}
              </li>
            );
          })}
        </ol>
        <p className="meta mt-3 min-h-[1.5em]">{message}</p>
      </div>
    </div>
  );
}
