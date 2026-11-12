import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FolderGit2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatBytes } from '@vectora/shared';
import { SitePage } from '@/components/Site';
import { Dialog, Notice, cx } from '@/components/ui';
import {
  ApiError,
  type GitHubInfo,
  type ZipInspection,
  api,
  useHealth,
  useJob,
  useRepositories,
} from '@/lib/api';
import { IndexingProgress } from '@/workspace/WorkspaceLayout';

type Method = 'github' | 'zip' | 'local';

export function ImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const health = useHealth();
  const repos = useRepositories();
  const [method, setMethod] = useState<Method>('github');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId).data;

  useEffect(() => {
    if (!job || job.status === 'running') return;
    void qc.invalidateQueries({ queryKey: ['repositories'] });
    if (job.status === 'completed' && job.repositoryId) navigate(`/w/${job.repositoryId}`);
    else if (job.status === 'failed') {
      setError(job.error ?? 'Indexing failed');
      setJobId(null);
    }
  }, [job, navigate, qc]);

  const start = async (fn: () => Promise<{ id: string }>) => {
    setError(null);
    try {
      setJobId((await fn()).id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const offline = health.error && (health.error as ApiError).status === 0;

  if (jobId)
    return (
      <SitePage>
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:px-12">
          <IndexingProgress
            stageIndex={job?.stageIndex ?? 0}
            message={job?.message ?? 'Starting'}
            processed={job?.processed ?? 0}
            total={job?.total ?? 0}
          />
        </div>
      </SitePage>
    );

  return (
    <SitePage>
      <div className="mx-auto grid max-w-[1180px] gap-x-16 gap-y-12 px-6 pt-8 md:px-12 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-labelledby="import-title">
          <h1 id="import-title" className="font-editorial text-(length:--text-page)">
            Explore a repository
          </h1>
          <p className="label mt-2 max-w-[56ch] text-[0.9375rem]">
            The source is analysed on this machine. Nothing in the repository is installed or run.
          </p>

          {offline ? (
            <div className="mt-6">
              <Notice tone="error">
                The local engine is not running, so repositories cannot be imported. Start it with{' '}
                <code>npm start</code> in the VECTORA folder and reload this page.
              </Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-6">
              <Notice
                tone="error"
                action={
                  <button className="btn btn-sm" onClick={() => setError(null)}>
                    Dismiss
                  </button>
                }
              >
                {error}
              </Notice>
            </div>
          ) : null}

          <div role="tablist" aria-label="Import method" className="mt-8 flex gap-8 border-b border-line">
            {(
              [
                ['github', 'GitHub repository'],
                ['zip', 'ZIP archive'],
                ['local', 'Local folder'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                id={`tab-${id}`}
                aria-selected={method === id}
                aria-controls={`panel-${id}`}
                className={cx(
                  '-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-0 pb-2.5 text-[0.9375rem]',
                  method === id
                    ? 'border-ink font-medium text-ink'
                    : 'border-transparent text-ink-2 hover:text-ink',
                )}
                onClick={() => setMethod(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${method}`} aria-labelledby={`tab-${method}`} className="pt-6">
            {method === 'github' ? (
              <GitHubForm onStart={start} />
            ) : method === 'zip' ? (
              <ZipForm onStart={start} />
            ) : (
              <LocalForm onStart={start} />
            )}
          </div>
        </section>

        <aside className="lg:col-span-4 lg:col-start-9" aria-labelledby="library-title">
          <h2 id="library-title" className="font-editorial border-b border-line pb-2 text-[1.25rem]">
            Your repositories
          </h2>
          {repos.isLoading ? <p className="meta mt-3">Loading…</p> : null}
          {repos.data?.length === 0 ? (
            <p className="label mt-3">
              Nothing imported yet. Repositories you index appear here and reopen with their saved workspace.
            </p>
          ) : null}
          <ul className="m-0 list-none p-0">
            {repos.data?.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 border-b border-line py-3">
                <button
                  className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-ink hover:text-indigo"
                  onClick={() => navigate(`/w/${r.id}`)}
                  data-testid="repo-link"
                >
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="meta block truncate">
                    {r.sourceKind}
                    {r.branch ? `, ${r.branch}` : ''} —{' '}
                    {r.status === 'ready'
                      ? `${r.symbolCount.toLocaleString()} symbols, ${r.relationshipCount.toLocaleString()} relationships`
                      : r.status}
                  </span>
                </button>
                <button
                  className="btn btn-sm btn-quiet shrink-0"
                  aria-label={`Remove ${r.name}`}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Remove “${r.name}” from VECTORA? Its graph and saved workspace are deleted.${r.sourceKind === 'local' || r.sourceKind === 'sample' ? ' The folder itself is not touched.' : ''}`,
                      )
                    )
                      return;
                    await api.deleteRepository(r.id);
                    void qc.invalidateQueries({ queryKey: ['repositories'] });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {health.data?.sampleAvailable ? (
            <div className="mt-8 border-l-2 border-clay pl-4">
              <p className="text-[0.9375rem]">New here? Try the bundled sample.</p>
              <p className="label mt-1">
                “Orbit Notes” is a small, clearly labelled multi-language repository included for onboarding
                and tests. It is not a real product.
              </p>
              <button
                className="btn btn-sm mt-3"
                onClick={() => void start(api.importSample)}
                data-testid="import-sample"
              >
                Index the sample repository
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </SitePage>
  );
}

type Start = (fn: () => Promise<{ id: string }>) => Promise<void>;

function GitHubForm({ onStart }: { onStart: Start }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [info, setInfo] = useState<GitHubInfo | null>(null);
  const [branch, setBranch] = useState('');
  const [subdir, setSubdir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validate = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const i = await api.validateGitHub(url, token);
      setInfo(i);
      setBranch(
        i.requested.branch && i.branches.includes(i.requested.branch) ? i.requested.branch : i.defaultBranch,
      );
      setSubdir(i.requested.subdirectory ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (info)
          void onStart(() =>
            api.importGitHub({
              url,
              branch,
              subdirectory: subdir || undefined,
              token: token || undefined,
              rememberToken: remember,
            }),
          );
        else void validate();
      }}
      className="grid gap-5"
    >
      <div>
        <label htmlFor="gh-url" className="block text-[0.875rem] font-medium">
          Repository URL
        </label>
        <input
          id="gh-url"
          className="field mt-1 font-mono text-[0.8125rem]"
          placeholder="https://github.com/owner/repository"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setInfo(null);
          }}
          required
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <details className="text-[0.875rem]">
        <summary className="cursor-pointer text-ink-2">Private repository</summary>
        <div className="mt-3 grid gap-2 border-l border-line pl-4">
          <label htmlFor="gh-token" className="block">
            Access token
          </label>
          <input
            id="gh-token"
            type="password"
            className="field font-mono text-[0.8125rem]"
            autoComplete="off"
            spellCheck={false}
            placeholder="Leave empty to use a stored token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="label max-w-[60ch]">
            A fine-grained token with read-only access to repository contents is enough. It is sent to
            api.github.com in a request header and never placed in a URL or a log.
          </p>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-(--indigo)"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Store this token encrypted on this machine
          </label>
        </div>
      </details>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? (
        <div className="grid gap-4 border border-line bg-surface p-5">
          <div>
            <p className="font-mono text-[0.9375rem] font-medium">
              {info.fullName} {info.private ? <span className="tag ml-2">private</span> : null}
            </p>
            {info.description ? <p className="label mt-1">{info.description}</p> : null}
            <p className="meta mt-1">
              about {formatBytes(info.sizeKb * 1024)}
              {info.usingStoredCredential ? ', using the stored access token' : ''}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[0.875rem]">
              Branch
              <select className="field mt-1" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {info.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === info.defaultBranch ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[0.875rem]">
              Subdirectory (optional)
              <input
                className="field mt-1 font-mono text-[0.8125rem]"
                placeholder="packages/core"
                value={subdir}
                onChange={(e) => setSubdir(e.target.value)}
              />
            </label>
          </div>
        </div>
      ) : null}
      <div>
        <button className="btn btn-primary" disabled={busy || !url.trim()}>
          {info ? 'Download and index' : busy ? 'Checking' : 'Check repository'}
        </button>
      </div>
    </form>
  );
}

function ZipForm({ onStart }: { onStart: Start }) {
  const input = useRef<HTMLInputElement>(null);
  const [inspection, setInspection] = useState<ZipInspection | null>(null);
  const [root, setRoot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setInspection(null);
    if (!/\.zip$/i.test(file.name)) return setError('Choose a file that ends in .zip.');
    setBusy(true);
    try {
      const r = await api.inspectZip(file);
      setInspection(r);
      setRoot(r.roots[0]?.path ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={cx(
          'border border-dashed px-6 py-10 text-center transition-colors duration-200',
          over ? 'border-indigo bg-surface' : 'border-ash',
        )}
      >
        <p className="text-[0.9375rem]">Drop a ZIP archive here</p>
        <p className="label mt-1">up to 512 MB. The archive is checked before anything is extracted.</p>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          id="zip-file"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <label htmlFor="zip-file" className="btn mt-4 cursor-pointer">
          {busy ? 'Checking archive' : 'Choose a file'}
        </label>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {inspection ? (
        <div className="grid gap-4 border border-line bg-surface p-5">
          <div>
            <p className="font-mono text-[0.9375rem] font-medium">{inspection.fileName}</p>
            <p className="meta mt-1">
              {inspection.files.toLocaleString()} files, {formatBytes(inspection.totalBytes)} uncompressed
            </p>
          </div>
          {inspection.rejected.length ? (
            <Notice tone="warning">
              {inspection.rejected.length} entr{inspection.rejected.length === 1 ? 'y' : 'ies'} will be
              skipped as unsafe ({[...new Set(inspection.rejected.map((r) => r.reason))].join(', ')}).
            </Notice>
          ) : null}
          <fieldset className="m-0 border-0 p-0">
            <legend className="text-[0.875rem] font-medium">Project root</legend>
            {inspection.roots.map((r) => (
              <label
                key={r.path || '/'}
                className="flex cursor-pointer items-baseline gap-2 border-b border-line py-2 text-[0.875rem]"
              >
                <input
                  type="radio"
                  name="zip-root"
                  className="accent-(--indigo)"
                  checked={root === r.path}
                  onChange={() => setRoot(r.path)}
                />
                <span className="font-mono text-[0.8125rem]">{r.path || '(archive root)'}</span>
                <span className="meta ml-auto">
                  {r.files.toLocaleString()} files{r.markers.length ? ` — ${r.markers.join(', ')}` : ''}
                </span>
              </label>
            ))}
          </fieldset>
          <details>
            <summary className="cursor-pointer text-[0.875rem] text-ink-2">Detected structure</summary>
            <ul className="m-0 mt-2 max-h-[220px] list-none overflow-y-auto p-0 font-mono text-[0.75rem] text-ink-2">
              {inspection.tree.slice(0, 200).map((t) => (
                <li key={t.path} style={{ paddingLeft: `${(t.path.split('/').length - 1) * 16}px` }}>
                  {t.path.split('/').pop()}
                  {t.directory ? '/' : ''}
                </li>
              ))}
            </ul>
          </details>
          <div>
            <button
              className="btn btn-primary"
              onClick={() => void onStart(() => api.importZip(inspection.uploadId, root))}
            >
              Extract and index
            </button>
          </div>
        </div>
      ) : null}
      <p className="label max-w-[60ch]">
        Ignored folders such as node_modules, binary files, symbolic links and entries that point outside the
        archive are never extracted.
      </p>
    </div>
  );
}

function LocalForm({ onStart }: { onStart: Start }) {
  const [path, setPath] = useState('');
  const [browse, setBrowse] = useState(false);
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (path.trim()) void onStart(() => api.importLocal(path.trim()));
      }}
    >
      <div>
        <label htmlFor="local-path" className="block text-[0.875rem] font-medium">
          Folder on this machine
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="local-path"
            className="field font-mono text-[0.8125rem]"
            placeholder="D:\projects\my-repository"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="btn shrink-0" onClick={() => setBrowse(true)}>
            Browse
          </button>
        </div>
        <p className="label mt-2 max-w-[60ch]">
          The folder is read in place by the local engine. .gitignore files and the ignore patterns from
          Settings are respected; nothing is copied or changed.
        </p>
      </div>
      <div>
        <button className="btn btn-primary" disabled={!path.trim()}>
          Index this folder
        </button>
      </div>
      <FolderBrowser open={browse} onOpenChange={setBrowse} initial={path} onPick={setPath} />
    </form>
  );
}

function FolderBrowser({
  open,
  onOpenChange,
  initial,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: string;
  onPick: (p: string) => void;
}) {
  const [dir, setDir] = useState<string | undefined>(initial || undefined);
  const list = useQuery({
    queryKey: ['fs', dir],
    queryFn: () => api.listDir(dir),
    enabled: open,
    retry: false,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a folder"
      description="Folders on this machine, listed by the local engine."
    >
      <div className="flex flex-wrap items-center gap-2">
        {list.data?.roots.map((r) => (
          <button key={r} type="button" className="btn btn-sm" onClick={() => setDir(r)}>
            {r}
          </button>
        ))}
        {list.data?.parent ? (
          <button type="button" className="btn btn-sm" onClick={() => setDir(list.data!.parent!)}>
            Up one level
          </button>
        ) : null}
      </div>
      <p className="mt-3 break-all font-mono text-[0.8125rem]">{list.data?.path ?? dir ?? ''}</p>
      {list.error ? (
        <div className="mt-3">
          <Notice
            tone="error"
            action={
              <button type="button" className="btn btn-sm" onClick={() => setDir(undefined)}>
                Start over
              </button>
            }
          >
            {(list.error as Error).message}
          </Notice>
        </div>
      ) : null}
      <ul className="m-0 mt-2 max-h-[38vh] list-none overflow-y-auto border-t border-line p-0">
        {list.data?.entries.length === 0 ? <li className="label py-3">No folders here.</li> : null}
        {list.data?.entries.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              className="link-row items-center"
              onDoubleClick={() => setDir(e.path)}
              onClick={() => setDir(e.path)}
            >
              {e.repository ? (
                <FolderGit2 size={15} strokeWidth={1.5} className="shrink-0 text-indigo" aria-hidden="true" />
              ) : (
                <Folder size={15} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-[0.875rem]">{e.name}</span>
              {e.repository ? <span className="meta">looks like a project</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!list.data}
          onClick={() => {
            if (list.data) onPick(list.data.path);
            onOpenChange(false);
          }}
        >
          Use this folder
        </button>
      </div>
    </Dialog>
  );
}
