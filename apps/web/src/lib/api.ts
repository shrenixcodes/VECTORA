import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@vectora/graph-schema';
import type { ExplorationAnswer, JobProgress, RepositoryOverview, RepositoryRecord, SessionState, Settings, SourceResponse } from '@vectora/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('The local engine is not reachable. Start it with “npm start” (or “npm run dev”).', 0);
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (!res.ok) {
    const body = isJson ? ((await res.json()) as { error?: string }) : null;
    throw new ApiError(body?.error ?? (res.status >= 500 ? 'The local engine is not reachable or failed to answer.' : `Request failed (${res.status})`), res.status);
  }
  return (isJson ? res.json() : res.text()) as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export interface Health {
  status: string;
  version: string;
  node: string;
  python: boolean;
  sampleAvailable: boolean;
  languages: { id: string; name: string; tier: number; extensions: string[] }[];
}
export interface GitHubInfo {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  branches: string[];
  private: boolean;
  sizeKb: number;
  requested: { branch: string | null; subdirectory: string | null };
  usingStoredCredential: boolean;
}
export interface ZipInspection {
  uploadId: string;
  fileName: string;
  entries: number;
  files: number;
  totalBytes: number;
  rejected: { path: string; reason: string }[];
  roots: { path: string; files: number; markers: string[] }[];
  tree: { path: string; size: number; directory: boolean }[];
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; repository: boolean }[];
  roots: string[];
}
export interface SearchResponse {
  query: string;
  results: { id: string; name: string; type: GraphNode['type']; filePath: string | null; line: number | null; description: string | null; score: number; match: string }[];
  documents: { path: string; line: number; snippet: string; heading: string | null }[];
}
export interface AnalysisResponse {
  generatedAt: string;
  flows: { id: string; name: string; kind: string; steps: string[]; reachesData: boolean }[];
  entryPoints: { path: string; nodeId: string; reason: string }[];
  declaredDependencies: { name: string; version: string | null; manifest: string; ecosystem: string; dev: boolean; line: number }[];
  unresolvedCount: number;
  unresolvedByReason: Record<string, number>;
  unresolvedSamples: { fromPath: string; fromSymbol: string | null; kind: string; name: string; line: number; reason: string }[];
  parseIssues: { path: string; message: string; line?: number; severity: string }[];
  skipped: Record<string, number>;
  truncated: boolean;
  validation: { errors: number; warnings: number };
  communities: number;
}
export type GraphResponse = KnowledgeGraph & { partial: boolean };

export const api = {
  health: () => request<Health>('/api/health'),
  repositories: () => request<RepositoryRecord[]>('/api/repositories'),
  repository: (id: string) => request<RepositoryRecord>(`/api/repositories/${id}`),
  deleteRepository: (id: string) => request<void>(`/api/repositories/${id}`, { method: 'DELETE' }),
  reindex: (id: string, full = false) => request<JobProgress>(`/api/repositories/${id}/reindex`, json('POST', { full })),
  job: (id: string) => request<JobProgress>(`/api/jobs/${id}`),
  importLocal: (path: string, name?: string) => request<JobProgress>('/api/import/local', json('POST', { path, name })),
  importSample: () => request<JobProgress>('/api/import/sample', json('POST')),
  listDir: (path?: string) => request<DirListing>(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  inspectZip: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ZipInspection>('/api/import/zip/inspect', { method: 'POST', body: form });
  },
  importZip: (uploadId: string, root?: string, name?: string) => request<JobProgress>('/api/import/zip', json('POST', { uploadId, root, name })),
  // The token travels in the request body over the loopback interface only; it is never put in a URL.
  validateGitHub: (url: string, token?: string) => request<GitHubInfo>('/api/import/github/validate', json('POST', { url, token: token || undefined })),
  importGitHub: (body: { url: string; branch?: string; subdirectory?: string; token?: string; rememberToken?: boolean }) => request<JobProgress>('/api/import/github', json('POST', body)),
  graph: (id: string, detail: 'full' | 'structure') => request<GraphResponse>(`/api/repositories/${id}/graph?detail=${detail}`),
  members: (id: string, path: string) => request<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/repositories/${id}/members?path=${encodeURIComponent(path)}`),
  overview: (id: string) => request<RepositoryOverview>(`/api/repositories/${id}/overview`),
  analysis: (id: string) => request<AnalysisResponse | null>(`/api/repositories/${id}/analysis`),
  source: (id: string, path: string, start?: number, end?: number) =>
    request<SourceResponse>(`/api/repositories/${id}/source?path=${encodeURIComponent(path)}${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}`),
  docs: (id: string) => request<{ path: string; title: string; lines: number }[]>(`/api/repositories/${id}/docs`),
  search: (id: string, q: string, types?: string[]) => request<SearchResponse>(`/api/repositories/${id}/search?q=${encodeURIComponent(q)}${types?.length ? `&types=${types.join(',')}` : ''}`),
  ask: (id: string, question: string) => request<ExplorationAnswer>(`/api/repositories/${id}/ask`, json('POST', { question })),
  session: (id: string) => request<SessionState | null>(`/api/repositories/${id}/session`),
  saveSession: (id: string, s: SessionState) => request<void>(`/api/repositories/${id}/session`, json('PUT', s)),
  settings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: unknown) => request<Settings>('/api/settings', json('PUT', patch)),
  credentials: () => request<{ name: string; updatedAt: string }[]>('/api/credentials'),
  setCredential: (name: string, value: string) => request<void>(`/api/credentials/${name}`, json('PUT', { value })),
  deleteCredential: (name: string) => request<void>(`/api/credentials/${name}`, { method: 'DELETE' }),
  dataInfo: () => request<{ dataDir: string; databaseBytes: number; sourcesBytes: number; repositories: number; credentials: number }>('/api/data'),
  deleteAllData: () => request<void>('/api/data', { method: 'DELETE' }),
  clearCache: () => request<void>('/api/cache', { method: 'DELETE' }),
  exportUrl: (id: string, format: string, includeSource: boolean) => `/api/repositories/${id}/export/${format}${includeSource ? '?includeSource=true' : ''}`,
};

// ---- hooks ---------------------------------------------------------------

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000, retry: 1 });
export const useRepositories = () => useQuery({ queryKey: ['repositories'], queryFn: api.repositories });
export const useRepository = (id: string) =>
  useQuery({ queryKey: ['repository', id], queryFn: () => api.repository(id), refetchInterval: (q) => (q.state.data?.status === 'indexing' || q.state.data?.status === 'pending' ? 1000 : false) });
export const useOverview = (id: string, enabled = true) => useQuery({ queryKey: ['overview', id], queryFn: () => api.overview(id), enabled });
export const useAnalysis = (id: string) => useQuery({ queryKey: ['analysis', id], queryFn: () => api.analysis(id) });
export const useSource = (id: string, path: string | null, start?: number, end?: number) =>
  useQuery({ queryKey: ['source', id, path, start, end], queryFn: () => api.source(id, path!, start, end), enabled: !!path, staleTime: 5 * 60_000 });
export const useJob = (jobId: string | null) =>
  useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId!), enabled: !!jobId, refetchInterval: (q) => (q.state.data && q.state.data.status !== 'running' ? false : 400) });

export function useSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: Infinity });
  const mutation = useMutation({
    mutationFn: api.updateSettings,
    onMutate: async (patch: Record<string, Record<string, unknown>>) => {
      // Optimistic: settings take effect immediately and are then confirmed by the engine.
      const prev = qc.getQueryData<Settings>(['settings']);
      if (prev) {
        const next = structuredClone(prev) as unknown as Record<string, Record<string, unknown>>;
        for (const [section, values] of Object.entries(patch)) next[section] = { ...next[section], ...values };
        qc.setQueryData(['settings'], next);
      }
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(['settings'], ctx.prev),
    onSuccess: (data) => qc.setQueryData(['settings'], data),
  });
  return { settings: query.data ?? null, update: mutation.mutate, error: mutation.error ?? query.error, saving: mutation.isPending };
}

/**
 * Loads the knowledge graph. Large repositories are loaded progressively:
 * the structural skeleton first, symbols of a file when it is expanded.
 */
export function useGraph(id: string, symbolCount: number, maxNodes: number, enabled = true) {
  const qc = useQueryClient();
  const detail: 'full' | 'structure' = symbolCount > maxNodes ? 'structure' : 'full';
  const query = useQuery({ queryKey: ['graph', id, detail], queryFn: () => api.graph(id, detail), enabled, staleTime: Infinity, gcTime: 10 * 60_000 });
  const loadMembers = async (path: string): Promise<void> => {
    const current = qc.getQueryData<GraphResponse>(['graph', id, detail]);
    if (!current?.partial) return;
    const extra = await qc.fetchQuery({ queryKey: ['members', id, path], queryFn: () => api.members(id, path), staleTime: Infinity });
    qc.setQueryData<GraphResponse>(['graph', id, detail], (g) => {
      if (!g) return g;
      const ids = new Set(g.nodes.map((n) => n.id));
      const nodes = [...g.nodes, ...extra.nodes.filter((n) => !ids.has(n.id))];
      const all = new Set(nodes.map((n) => n.id));
      const eids = new Set(g.edges.map((e) => e.id));
      const edges = [...g.edges, ...extra.edges.filter((e) => !eids.has(e.id) && all.has(e.source) && all.has(e.target))];
      return { ...g, nodes, edges };
    });
  };
  return { graph: query.data ?? null, isLoading: query.isLoading, error: query.error, partial: query.data?.partial ?? false, loadMembers };
}

export function downloadText(fileName: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadUrl(fileName, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function downloadUrl(fileName: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
