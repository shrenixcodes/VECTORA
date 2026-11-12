/**
 * Types and helpers shared by the local engine and the web application:
 * settings schema, API contracts, log redaction.
 */
import { z } from 'zod';

export const APP_VERSION = '0.1.0';
export const DEFAULT_ENGINE_PORT = 4317;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'out/',
  'target/',
  'coverage/',
  'vendor/',
  '.next/',
  '.nuxt/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.idea/',
  '.vscode/',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
];

export const SettingsSchema = z.object({
  appearance: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).default('system'),
    })
    .prefault({}),
  graph: z
    .object({
      defaultMode: z.enum(['graph', 'atlas', 'mindmap']).default('graph'),
      /** Share of symbol-level nodes shown before expansion. */
      nodeDensity: z.enum(['structure', 'balanced', 'full']).default('balanced'),
      hiddenRelationships: z.array(z.string()).default(['DEFINED_IN']),
      showUnverified: z.boolean().default(true),
      animationIntensity: z.enum(['none', 'subtle', 'standard']).default('subtle'),
      labelDensity: z.enum(['low', 'medium', 'high']).default('medium'),
      focusBehavior: z.enum(['neighbourhood', 'node', 'none']).default('neighbourhood'),
    })
    .prefault({}),
  performance: z
    .object({
      workerConcurrency: z.number().int().min(1).max(16).default(4),
      indexingCache: z.boolean().default(true),
      renderingQuality: z.enum(['low', 'balanced', 'high']).default('balanced'),
      reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
      maxFiles: z.number().int().min(100).max(200000).default(20000),
      maxGraphNodes: z.number().int().min(500).max(200000).default(8000),
    })
    .prefault({}),
  repository: z
    .object({
      ignorePatterns: z.array(z.string()).default(DEFAULT_IGNORE_PATTERNS),
      maxFileSizeKb: z.number().int().min(16).max(8192).default(512),
      disabledLanguages: z.array(z.string()).default([]),
      incrementalIndexing: z.boolean().default(true),
    })
    .prefault({}),
  privacy: z
    .object({
      includeSourceInExports: z.boolean().default(false),
    })
    .prefault({}),
  exploration: z
    .object({
      /** Optional external narrative provider. Disabled by default. */
      providerEnabled: z.boolean().default(false),
      providerEndpoint: z.string().default(''),
      providerModel: z.string().default(''),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings = (): Settings => SettingsSchema.parse({});

/** Deep-merges a partial settings patch into existing settings and validates. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return SettingsSchema.parse(merge(current, patch));
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export type RepositorySourceKind = 'github' | 'zip' | 'local' | 'sample';
export type IndexStatus = 'pending' | 'indexing' | 'ready' | 'failed';

export interface RepositoryRecord {
  id: string;
  name: string;
  sourceKind: RepositorySourceKind;
  /** Display origin: GitHub URL, archive file name or local path. Never contains credentials. */
  origin: string;
  branch: string | null;
  subdirectory: string | null;
  status: IndexStatus;
  createdAt: string;
  lastIndexedAt: string | null;
  fileCount: number;
  symbolCount: number;
  relationshipCount: number;
  error: string | null;
}

export const INDEX_STAGES = [
  'acquire',
  'discover',
  'analyze',
  'resolve',
  'flows',
  'organize',
  'graph',
  'persist',
] as const;
export type IndexStage = (typeof INDEX_STAGES)[number];

export const INDEX_STAGE_LABELS: Record<IndexStage, string> = {
  acquire: 'Acquiring source',
  discover: 'Discovering files',
  analyze: 'Analysing syntax',
  resolve: 'Resolving relationships',
  flows: 'Tracing execution flows',
  organize: 'Organising subsystems and concepts',
  graph: 'Generating knowledge graph',
  persist: 'Saving workspace',
};

export interface JobProgress {
  id: string;
  repositoryId: string | null;
  status: 'running' | 'completed' | 'failed';
  stage: IndexStage;
  stageIndex: number;
  message: string;
  processed: number;
  total: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  summary: IndexSummary | null;
}

export interface IndexSummary {
  files: number;
  analyzedFiles: number;
  reusedFiles: number;
  symbols: number;
  relationships: number;
  unresolved: number;
  parseErrors: number;
  durationMs: number;
  incremental: boolean;
}

export interface OverviewEntryPoint {
  path: string;
  reason: string;
  nodeId: string;
}

export interface RepositoryOverview {
  repository: RepositoryRecord;
  description: string | null;
  descriptionSource: string | null;
  languages: {
    language: string;
    tier: number;
    files: number;
    analyzedFiles: number;
    symbols: number;
    parseErrors: number;
    adapter: string | null;
    lines: number;
  }[];
  frameworks: { name: string; evidence: string }[];
  entryPoints: OverviewEntryPoint[];
  subsystems: {
    id: string;
    name: string;
    files: number;
    symbols: number;
    inbound: number;
    outbound: number;
  }[];
  concepts: { id: string; name: string; members: number; evidence: string[] }[];
  largestModules: { id: string; path: string; symbols: number; lines: number }[];
  dependencies: {
    declared: number;
    imported: number;
    internalImports: number;
    externalPackages: { name: string; importers: number; declared: boolean; version: string | null }[];
  };
  architectureSummary: { statement: string; evidence: string; verified: boolean }[];
  unresolved: number;
  validation: { errors: number; warnings: number };
  summary: IndexSummary | null;
}

export interface EvidenceRef {
  path: string;
  startLine: number;
  endLine: number;
  nodeId?: string;
  snippet?: string;
}

export interface ExplorationStatement {
  text: string;
  verified: boolean;
  evidence: EvidenceRef[];
}

export interface ExplorationAnswer {
  question: string;
  intent: string;
  title: string;
  statements: ExplorationStatement[];
  /** Node ids to highlight in the visualisations. */
  nodeIds: string[];
  edgeIds: string[];
  /** Things the engine could not establish from the graph. */
  caveats: string[];
  narrative?: string | null;
  narrativeSource?: string | null;
}

export interface SourceResponse {
  path: string;
  language: string | null;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface SessionState {
  view: string;
  selectedIds: string[];
  focusId: string | null;
  expandedIds: string[];
  hiddenNodeTypes: string[];
  hiddenEdgeTypes: string[];
  layouts: {
    graph?: Record<string, [number, number]>;
    mindmap?: Record<string, [number, number]>;
    mindmapCollapsed?: string[];
    atlasCamera?: { position: [number, number, number]; target: [number, number, number] };
  };
  savedAt: string;
}

// ---------------------------------------------------------------------------
// Secret redaction for diagnostic logs
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<=(?:authorization|x-api-key|api-key)["']?\s*[:=]\s*["']?)(?:bearer\s+|basic\s+|token\s+)?[^\s"',}]+/gi,
  /(?<=(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',}&]{6,}/gi,
  /(?<=:\/\/[^/\s:@]+:)[^@\s/]+(?=@)/g, // credentials embedded in URLs
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Replaces anything that looks like a credential with a placeholder. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        /token|secret|password|authorization|api[_-]?key|credential/i.test(k) && typeof v === 'string'
          ? '[redacted]'
          : redactDeep(v);
    }
    return out as T;
  }
  return value;
}

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
