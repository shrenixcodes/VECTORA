import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { EDGE_TYPES, EDGE_TYPE_LABELS } from '@vectora/graph-schema';
import { DEFAULT_IGNORE_PATTERNS, type Settings, formatBytes } from '@vectora/shared';
import { Dialog, Loading, Notice, NumberField, SelectField, Toggle } from '@/components/ui';
import { api, useHealth, useSettings } from '@/lib/api';
import { useWorkspace } from '@/lib/store';

function Group({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-3 border-t border-line py-8 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <h3 id={id} className="font-editorial text-[1.25rem]">
          {title}
        </h3>
        {intro ? <p className="label mt-2 max-w-[38ch]">{intro}</p> : null}
      </div>
      <div className="lg:col-span-8">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const { settings, update, error } = useSettings();
  const health = useHealth();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['data-info'], queryFn: api.dataInfo });
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: api.credentials });
  const [ignoreText, setIgnoreText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);
  if (!settings) return <Loading label="Loading settings" />;

  const set = <K extends keyof Settings>(section: K, values: Partial<Settings[K]>) =>
    update({ [section]: values } as Record<string, Record<string, unknown>>);
  const hasCredential = (name: string) => credentials.data?.some((c) => c.name === name) ?? false;
  const saveCredential = async (name: string, value: string) => {
    await api.setCredential(name, value);
    await qc.invalidateQueries({ queryKey: ['credentials'] });
    setMessage('Credential saved. It is stored encrypted on this machine and is never shown again.');
  };
  const removeCredential = async (name: string) => {
    await api.deleteCredential(name);
    await qc.invalidateQueries({ queryKey: ['credentials'] });
    setMessage('Credential removed.');
  };
  const toggleRelationship = (t: string) => {
    const hidden = settings.graph.hiddenRelationships.includes(t)
      ? settings.graph.hiddenRelationships.filter((x) => x !== t)
      : [...settings.graph.hiddenRelationships, t];
    set('graph', { hiddenRelationships: hidden });
    // Apply to the open workspace as well, so the change is visible straight away.
    const ws = useWorkspace.getState();
    if (ws.repoId)
      ws.setHiddenEdgeTypes(
        hidden.includes(t)
          ? [...new Set([...ws.hiddenEdgeTypes, t])]
          : ws.hiddenEdgeTypes.filter((x) => x !== t),
      );
  };
  const ignoreValue = ignoreText ?? settings.repository.ignorePatterns.join('\n');

  return (
    <div className="h-full overflow-y-auto" data-testid="settings">
      <div className="mx-auto max-w-[1040px] px-6 py-10 md:px-12">
        <h2 className="font-editorial text-(length:--text-page)">Settings</h2>
        <p className="label mt-2">Changes are saved as you make them and are kept by the local engine.</p>
        <div className="mt-4 min-h-[44px]" aria-live="polite">
          {error ? (
            <Notice tone="error">{(error as Error).message}</Notice>
          ) : message ? (
            <Notice tone="success">{message}</Notice>
          ) : null}
        </div>

        <Group title="Appearance">
          <SelectField
            label="Theme"
            value={settings.appearance.theme}
            onChange={(theme) => set('appearance', { theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Follow the system' },
            ]}
          />
        </Group>

        <Group title="Graph" intro="How the three exploration views present the knowledge graph.">
          <SelectField
            label="Default graph mode"
            hint="Opened when you choose a search result or a link from the overview."
            value={settings.graph.defaultMode}
            onChange={(defaultMode) => set('graph', { defaultMode })}
            options={[
              { value: 'graph', label: 'Graph Explorer (2D)' },
              { value: 'atlas', label: '3D Atlas' },
              { value: 'mindmap', label: 'Mind Map' },
            ]}
          />
          <SelectField
            label="Node density"
            hint="Structure shows files only; symbols appear when a file is unfolded. Balanced adds classes, models, endpoints and components. Full shows every symbol."
            value={settings.graph.nodeDensity}
            onChange={(nodeDensity) => set('graph', { nodeDensity })}
            options={[
              { value: 'structure', label: 'Structure' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'full', label: 'Full' },
            ]}
          />
          <SelectField
            label="Label density"
            value={settings.graph.labelDensity}
            onChange={(labelDensity) => set('graph', { labelDensity })}
            options={[
              { value: 'low', label: 'Few labels' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'Many labels' },
            ]}
          />
          <SelectField
            label="Animation intensity"
            hint="Controls how long layouts settle on screen. None arranges the graph in one step."
            value={settings.graph.animationIntensity}
            onChange={(animationIntensity) => set('graph', { animationIntensity })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'subtle', label: 'Subtle' },
              { value: 'standard', label: 'Standard' },
            ]}
          />
          <SelectField
            label="Default focus behaviour"
            hint="What the camera does when a node is selected, and how much focus mode shows."
            value={settings.graph.focusBehavior}
            onChange={(focusBehavior) => set('graph', { focusBehavior })}
            options={[
              { value: 'neighbourhood', label: 'Move to the node, focus shows two steps' },
              { value: 'node', label: 'Move to the node, focus shows one step' },
              { value: 'none', label: 'Do not move the camera' },
            ]}
          />
          <Toggle
            label="Show derived relationships"
            hint="Relationships that are interpretations rather than verified facts, drawn dashed or thin."
            checked={settings.graph.showUnverified}
            onChange={(showUnverified) => set('graph', { showUnverified })}
          />
          <fieldset className="m-0 mt-3 border-0 p-0">
            <legend className="text-[0.9375rem]">Relationship visibility</legend>
            <p className="label mb-2">
              Unchecked relationships are hidden by default in new workspaces and in the open one.
            </p>
            <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {EDGE_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 py-1 text-[0.8125rem]">
                  <input
                    type="checkbox"
                    className="accent-(--indigo)"
                    checked={!settings.graph.hiddenRelationships.includes(t)}
                    onChange={() => toggleRelationship(t)}
                  />
                  {EDGE_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
        </Group>

        <Group
          title="Performance"
          intro="VECTORA is meant to stay usable on ordinary computers. Lower these if indexing or rendering feels heavy."
        >
          <NumberField
            label="Indexing workers"
            hint="Worker threads used for syntax analysis."
            value={settings.performance.workerConcurrency}
            min={1}
            max={16}
            onChange={(workerConcurrency) => set('performance', { workerConcurrency })}
          />
          <Toggle
            label="Indexing cache"
            hint="Keeps per-file analysis so unchanged files are not analysed again."
            checked={settings.performance.indexingCache}
            onChange={(indexingCache) => set('performance', { indexingCache })}
          />
          <SelectField
            label="Rendering quality"
            hint="Low disables antialiasing and labels in 3D and uses simpler shapes."
            value={settings.performance.renderingQuality}
            onChange={(renderingQuality) => set('performance', { renderingQuality })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'high', label: 'High' },
            ]}
          />
          <SelectField
            label="Reduced motion"
            value={settings.performance.reducedMotion}
            onChange={(reducedMotion) => set('performance', { reducedMotion })}
            options={[
              { value: 'system', label: 'Follow the system' },
              { value: 'on', label: 'Always reduce motion' },
              { value: 'off', label: 'Allow motion' },
            ]}
          />
          <NumberField
            label="Maximum files per repository"
            hint="Source files are preferred when a repository exceeds this limit."
            value={settings.performance.maxFiles}
            min={100}
            max={200000}
            step={500}
            onChange={(maxFiles) => set('performance', { maxFiles })}
          />
          <NumberField
            label="Maximum nodes on screen"
            hint="Above this number of symbols the graph loads progressively: structure first, symbols as files are unfolded."
            value={settings.performance.maxGraphNodes}
            min={500}
            max={200000}
            step={500}
            onChange={(maxGraphNodes) => set('performance', { maxGraphNodes })}
          />
          <button
            className="btn btn-sm mt-3"
            onClick={async () => {
              await api.clearCache();
              setMessage('Indexing cache cleared. The next index of each repository analyses every file.');
            }}
          >
            Clear the indexing cache
          </button>
        </Group>

        <Group title="Repository" intro="Applied the next time a repository is indexed.">
          <label htmlFor="ignore-patterns" className="block text-[0.9375rem]">
            Ignore patterns
          </label>
          <p className="label mb-2">
            One pattern per line, in .gitignore syntax. Each repository's own .gitignore files are always
            respected as well.
          </p>
          <textarea
            id="ignore-patterns"
            className="field"
            rows={8}
            spellCheck={false}
            value={ignoreValue}
            onChange={(e) => setIgnoreText(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn btn-sm"
              disabled={ignoreText === null}
              onClick={() => {
                set('repository', {
                  ignorePatterns: ignoreValue
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean),
                });
                setIgnoreText(null);
                setMessage('Ignore patterns saved.');
              }}
            >
              Save patterns
            </button>
            <button
              className="btn btn-sm btn-quiet"
              onClick={() => {
                set('repository', { ignorePatterns: DEFAULT_IGNORE_PATTERNS });
                setIgnoreText(null);
              }}
            >
              Restore defaults
            </button>
          </div>
          <div className="mt-4">
            <NumberField
              label="Maximum file size"
              hint="Larger files are skipped."
              value={settings.repository.maxFileSizeKb}
              min={16}
              max={8192}
              step={16}
              unit="KB"
              onChange={(maxFileSizeKb) => set('repository', { maxFileSizeKb })}
            />
            <Toggle
              label="Incremental indexing"
              hint="Only changed files, and files that depend on them, are analysed again."
              checked={settings.repository.incrementalIndexing}
              onChange={(incrementalIndexing) => set('repository', { incrementalIndexing })}
            />
          </div>
          <fieldset className="m-0 mt-3 border-0 p-0">
            <legend className="text-[0.9375rem]">Languages to analyse</legend>
            <p className="label mb-2">
              Unchecked languages are still listed as files but not analysed at symbol level.
            </p>
            <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {(health.data?.languages ?? []).map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2 py-1 text-[0.8125rem]">
                  <input
                    type="checkbox"
                    className="accent-(--indigo)"
                    checked={!settings.repository.disabledLanguages.includes(l.id)}
                    onChange={() =>
                      set('repository', {
                        disabledLanguages: settings.repository.disabledLanguages.includes(l.id)
                          ? settings.repository.disabledLanguages.filter((x) => x !== l.id)
                          : [...settings.repository.disabledLanguages, l.id],
                      })
                    }
                  />
                  {l.name}
                </label>
              ))}
            </div>
            {health.data && !health.data.python ? (
              <p className="label mt-2" style={{ color: 'var(--warning)' }}>
                No Python 3 interpreter was found, so Python files cannot be analysed on this machine.
              </p>
            ) : null}
          </fieldset>
        </Group>

        <Group
          title="Privacy"
          intro="Source code is analysed on this machine. Nothing is uploaded unless you turn on an optional service below."
        >
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[0.875rem]">
            <dt className="text-ink-3">Data folder</dt>
            <dd className="m-0 break-all font-mono text-[0.8125rem]">{data.data?.dataDir ?? '…'}</dd>
            <dt className="text-ink-3">Database</dt>
            <dd className="m-0">{data.data ? formatBytes(data.data.databaseBytes) : '…'}</dd>
            <dt className="text-ink-3">Imported sources</dt>
            <dd className="m-0">
              {data.data
                ? `${formatBytes(data.data.sourcesBytes)} (copies of GitHub and ZIP imports; local folders are read in place)`
                : '…'}
            </dd>
            <dt className="text-ink-3">Repositories</dt>
            <dd className="m-0">{data.data?.repositories ?? '…'}</dd>
          </dl>

          <h4 className="mb-1 mt-6 text-[0.9375rem] font-medium">Credential management</h4>
          <CredentialRow
            label="GitHub access token"
            hint="Used only to read private repositories you import. Sent to api.github.com in a request header, never in a URL."
            stored={hasCredential('github')}
            onSave={(v) => saveCredential('github', v)}
            onRemove={() => removeCredential('github')}
          />

          <h4 className="mb-1 mt-6 text-[0.9375rem] font-medium">Export settings</h4>
          <Toggle
            label="Include source text in graph exports by default"
            hint="Off: JSON and GraphML exports contain names, paths and line numbers but no lines of code."
            checked={settings.privacy.includeSourceInExports}
            onChange={(includeSourceInExports) => set('privacy', { includeSourceInExports })}
          />

          <h4 className="mb-1 mt-6 text-[0.9375rem] font-medium">Optional narrative service</h4>
          <p className="label max-w-[64ch]">
            Off by default. When on, answers in “Ask about the repository” are additionally rewritten as prose
            by an external service you choose. Only the findings already shown to you (symbol names, file
            paths and short evidence lines) are sent — never whole files.
          </p>
          <Toggle
            label="Use an external narrative service"
            checked={settings.exploration.providerEnabled}
            onChange={(providerEnabled) => set('exploration', { providerEnabled })}
          />
          {settings.exploration.providerEnabled ? (
            <div className="mt-2 grid gap-3">
              <label className="block text-[0.875rem]">
                Endpoint (HTTPS, chat-completions format)
                <input
                  className="field mt-1 font-mono text-[0.8125rem]"
                  placeholder="https://example.com/v1/chat/completions"
                  value={endpoint ?? settings.exploration.providerEndpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  onBlur={() =>
                    endpoint !== null && set('exploration', { providerEndpoint: endpoint.trim() })
                  }
                />
              </label>
              <label className="block text-[0.875rem]">
                Model name
                <input
                  className="field mt-1 font-mono text-[0.8125rem]"
                  value={model ?? settings.exploration.providerModel}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() => model !== null && set('exploration', { providerModel: model.trim() })}
                />
              </label>
              <CredentialRow
                label="Service key"
                hint="Stored encrypted on this machine."
                stored={hasCredential('exploration-provider')}
                onSave={(v) => saveCredential('exploration-provider', v)}
                onRemove={() => removeCredential('exploration-provider')}
              />
            </div>
          ) : null}

          <h4 className="mb-1 mt-8 text-[0.9375rem] font-medium">Data deletion</h4>
          <p className="label max-w-[64ch]">
            Removes every repository, graph, cached analysis, saved session, stored credential and imported
            source copy from this machine. Your own local folders are not touched.
          </p>
          <button
            className="btn mt-3"
            style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
            onClick={() => setConfirmDelete(true)}
            data-testid="delete-all"
          >
            Delete all VECTORA data
          </button>
        </Group>
      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete all VECTORA data?"
        description="This cannot be undone."
      >
        <p className="text-[0.9375rem]">
          {data.data?.repositories ?? 0} repositories, their graphs and sessions,{' '}
          {data.data?.credentials ?? 0} stored credentials and all imported source copies will be removed from{' '}
          <code>{data.data?.dataDir}</code>.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            Keep my data
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--error)', borderColor: 'var(--error)' }}
            data-testid="confirm-delete-all"
            onClick={async () => {
              try {
                await api.deleteAllData();
                await qc.invalidateQueries();
                setConfirmDelete(false);
                window.location.assign('/import');
              } catch (e) {
                setConfirmDelete(false);
                setMessage((e as Error).message);
              }
            }}
          >
            Delete all data
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function CredentialRow({
  label,
  hint,
  stored,
  onSave,
  onRemove,
}: {
  label: string;
  hint: string;
  stored: boolean;
  onSave: (v: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const id = `cred-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="py-2">
      <label htmlFor={id} className="block text-[0.875rem]">
        {label}{' '}
        {stored ? <span className="tag ml-2">stored</span> : <span className="meta ml-2">not set</span>}
      </label>
      <p className="label mb-2 max-w-[64ch]">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {/* The value is write-only: it is never read back from the engine. */}
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="field max-w-[340px] font-mono text-[0.8125rem]"
          placeholder={stored ? 'Replace the stored value' : 'Paste the value'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn btn-sm h-[36px]"
          disabled={!value.trim()}
          onClick={async () => {
            await onSave(value.trim());
            setValue('');
          }}
        >
          Save
        </button>
        {stored ? (
          <button className="btn btn-sm btn-quiet h-[36px]" onClick={() => void onRemove()}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
