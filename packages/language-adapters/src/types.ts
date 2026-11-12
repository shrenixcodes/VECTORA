import type { EdgeType, ExtractionMethod, NodeType, SourceLocation } from '@vectora/graph-schema';

/** A source file handed to an adapter. Paths are repository-relative, POSIX style. */
export interface SourceFileInput {
  path: string;
  absPath: string;
  language: string;
}

export interface SymbolFact {
  /** Qualified name, unique within its file (e.g. `UserService.login`). */
  localId: string;
  name: string;
  kind: NodeType;
  parent: string | null;
  location: SourceLocation;
  exported: boolean;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportFact {
  specifier: string;
  /** `imported` is `*` for namespace/module imports and `default` for default imports. */
  names: { imported: string; local: string }[];
  kind: 'static' | 'dynamic' | 'require' | 'include' | 'reexport';
  location: SourceLocation;
  evidence: string;
  /** Repository-relative path when the adapter resolved the import itself. */
  resolvedPath?: string | null;
  /** External package name when the specifier does not point into the repository. */
  externalPackage?: string | null;
  builtin?: boolean;
}

export type ReferenceTarget =
  /** The adapter resolved the reference to a definition. */
  | { resolved: { path: string; localId: string | null } }
  /** Only a name is known; the indexer resolves it through imports and scope. */
  | { name: string; receiver?: string };

export interface ReferenceFact {
  kind: EdgeType;
  /** Enclosing symbol (localId) or null for module-level code. */
  from: string | null;
  target: ReferenceTarget;
  location: SourceLocation;
  evidence: string;
  method: ExtractionMethod;
  confidence: number;
  verified: boolean;
  metadata?: Record<string, unknown>;
}

export interface ParseIssue {
  path: string;
  message: string;
  line?: number;
  severity: 'error' | 'warning';
}

/** Everything an adapter learned about one file. Cached per content hash. */
export interface FileFacts {
  path: string;
  language: string;
  adapter: string;
  lineCount: number;
  /** Package / namespace / module the file declares, when the language has one. */
  moduleName?: string;
  symbols: SymbolFact[];
  imports: ImportFact[];
  references: ReferenceFact[];
  errors: ParseIssue[];
}

export interface WorkspacePackage {
  name: string;
  /** Repository-relative directory of the package. */
  dir: string;
  /** Repository-relative entry file, when it could be determined. */
  entry: string | null;
}

export interface AnalyzeContext {
  rootDir: string;
  /** All repository-relative file paths that are part of the index. */
  allFiles: ReadonlySet<string>;
  /** Paths that must be (re)analysed. Other files only provide declarations. */
  analyzeOnly?: ReadonlySet<string>;
  workspacePackages: WorkspacePackage[];
  pythonCommand?: string;
  onProgress?: (processed: number, total: number) => void;
}

export interface LanguageMeta {
  id: string;
  name: string;
  tier: 1 | 2;
  extensions: string[];
}

/**
 * Common contract for every language adapter: parse files, extract symbols and
 * relationships with source locations, and report parsing errors.
 */
export interface LanguageAdapter {
  id: string;
  /** Human-readable description of the analysis technique. */
  technique: string;
  languages: LanguageMeta[];
  /**
   * `project` adapters need every file of their languages at once (cross-file
   * type resolution); `file` adapters can analyse files independently.
   */
  scope: 'project' | 'file';
  analyze(files: SourceFileInput[], ctx: AnalyzeContext): Promise<FileFacts[]>;
}

export const emptyFacts = (file: SourceFileInput, adapter: string, lineCount = 0): FileFacts => ({
  path: file.path,
  language: file.language,
  adapter,
  lineCount,
  symbols: [],
  imports: [],
  references: [],
  errors: [],
});

export const evidenceLine = (text: string): string => {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  const t = line.trim();
  return t.length > 200 ? `${t.slice(0, 197)}...` : t;
};

/** Makes `base` unique within `used` by appending `~2`, `~3`, ... */
export function uniqueLocalId(used: Set<string>, base: string): string {
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}~${i++}`;
  used.add(id);
  return id;
}
