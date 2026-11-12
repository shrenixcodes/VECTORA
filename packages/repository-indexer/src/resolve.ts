/**
 * Stage 3 — relationship resolution.
 *
 * Turns per-file facts into graph nodes and edges. A name is only tied to a
 * definition when there is scope evidence for it (same file, an import that
 * leads to the defining file, or a language-defined visibility rule such as
 * "same package"). Everything else is reported as unresolved, never guessed.
 */
import path from 'node:path';
import {
  type EdgeType,
  type ExtractionMethod,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type SourceLocation,
  type UnresolvedReference,
  edgeId,
  nodeId,
} from '@vectora/graph-schema';
import type { FileFacts, ImportFact, ReferenceFact, SymbolFact } from '@vectora/language-adapters';
import { type ManifestInfo, isConfigFile, isTestFile } from './manifests';
import type { ScannedFile } from './scan';

export interface ResolveInput {
  repositoryId: string;
  repositoryName: string;
  files: ScannedFile[];
  facts: Map<string, FileFacts>;
  manifests: ManifestInfo;
}

export interface ResolveOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
  unresolvedCount: number;
  unresolvedByReason: Record<string, number>;
}

interface Binding {
  /** Candidate files (one for a module, several for a package / namespace). */
  files: string[];
  /** Symbol inside the first file, or null when the binding is the module itself. */
  localId: string | null;
}

interface FileCtx {
  facts: FileFacts;
  top: Map<string, string>;
  byLocal: Map<string, SymbolFact>;
  bindings: Map<string, Binding>;
  visible: string[];
  /** Local names bound to something outside the repository (external package or standard library). */
  external: Set<string>;
}

interface Target {
  path: string;
  localId: string | null;
  kind: NodeType | null;
  method: ExtractionMethod;
  confidence: number;
  verified: boolean;
}

const MAX_UNRESOLVED_SAMPLES = 2000;
const CLASS_KINDS: ReadonlySet<NodeType> = new Set(['Class', 'DatabaseModel', 'Component', 'Interface', 'Type']);
const SELF_NAMES = new Set(['self', 'this', 'cls', 'Self', 'super', 'base']);
const PY_STDLIB = new Set(
  ('abc argparse array ast asyncio base64 bisect builtins calendar collections concurrent configparser contextlib copy csv ctypes dataclasses datetime ' +
    'decimal difflib dis email enum errno functools gc getpass glob gzip hashlib heapq hmac html http importlib inspect io ipaddress itertools json ' +
    'logging math mimetypes multiprocessing operator os pathlib pickle platform pprint queue random re secrets select shlex shutil signal socket ' +
    'sqlite3 ssl stat string struct subprocess sys tempfile textwrap threading time timeit tkinter traceback types typing unittest urllib uuid ' +
    'warnings weakref xml zipfile zlib zoneinfo __future__ typing_extensions').split(' '),
);

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p: string): string => p.replace(/\.[^./]+$/, '');

export function resolveGraph(input: ResolveInput): ResolveOutput {
  const { repositoryId, files, facts, manifests } = input;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const unresolved: UnresolvedReference[] = [];
  const unresolvedByReason: Record<string, number> = {};
  let unresolvedCount = 0;

  const addNode = (n: Omit<GraphNode, 'repositoryId'>): void => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push({ ...n, repositoryId });
  };
  const addEdge = (
    type: EdgeType,
    source: string,
    target: string,
    evidence: string,
    location: SourceLocation | null,
    method: ExtractionMethod,
    confidence = 1,
    verified = true,
    metadata?: Record<string, unknown>,
  ): void => {
    edges.push({ id: edgeId(type, source, target), source, target, type, evidence, location, extractionMethod: method, confidence, verified, ...(metadata ? { metadata } : {}) });
  };
  const reportUnresolved = (fromPath: string, fromSymbol: string | null, kind: EdgeType, name: string, line: number, reason: string): void => {
    unresolvedCount++;
    unresolvedByReason[reason] = (unresolvedByReason[reason] ?? 0) + 1;
    if (unresolved.length < MAX_UNRESOLVED_SAMPLES) unresolved.push({ fromPath, fromSymbol, kind, name, line, reason });
  };

  // ---- structure: repository, directories, files -------------------------
  const repoId = nodeId.repository();
  addNode({
    id: repoId,
    name: input.repositoryName,
    type: 'Repository',
    filePath: null,
    location: null,
    language: null,
    description: manifests.description ?? undefined,
    metadata: { files: files.length },
    extractionMethod: 'filesystem',
    confidence: 1,
    verified: true,
  });

  const fileSet = new Set(files.map((f) => f.path));
  const filesByDir = new Map<string, string[]>();
  const filesByBase = new Map<string, string[]>();
  const packageDirs = new Set<string>([
    ...manifests.workspacePackages.map((p) => p.dir),
    ...manifests.goModules.map((m) => m.dir),
    ...manifests.cargoCrates.map((c) => c.dir),
  ]);
  for (const f of files) {
    const d = dirOf(f.path);
    (filesByDir.get(d) ?? filesByDir.set(d, []).get(d)!).push(f.path);
    const b = baseOf(f.path);
    (filesByBase.get(b) ?? filesByBase.set(b, []).get(b)!).push(f.path);
    if (/^(__init__\.py|mod\.rs|index\.[cm]?[jt]sx?)$/.test(b)) packageDirs.add(d);
  }

  const ensureDir = (dir: string): string => {
    if (dir === '') return repoId;
    const id = nodeId.directory(dir);
    if (nodeIds.has(id)) return id;
    const isModule = packageDirs.has(dir);
    addNode({
      id,
      name: baseOf(dir),
      type: isModule ? 'Module' : 'Directory',
      filePath: dir,
      location: null,
      language: null,
      metadata: {},
      extractionMethod: 'filesystem',
      confidence: 1,
      verified: true,
    });
    const parent = ensureDir(dirOf(dir));
    addEdge('CONTAINS', parent, id, `${dir}/`, null, 'filesystem');
    return id;
  };

  for (const f of files) {
    const ff = facts.get(f.path);
    const config = isConfigFile(f.path);
    const id = nodeId.file(f.path);
    addNode({
      id,
      name: baseOf(f.path),
      type: config ? 'Configuration' : 'File',
      filePath: f.path,
      location: { path: f.path, startLine: 1, endLine: Math.max(1, f.lineCount) },
      language: f.language,
      metadata: {
        size: f.size,
        lines: f.lineCount,
        hash: f.hash,
        analyzed: !!ff && !ff.errors.some((e) => e.severity === 'error'),
        adapter: ff?.adapter ?? null,
        parseErrors: ff?.errors.length ?? 0,
        ...(ff?.moduleName ? { moduleName: ff.moduleName } : {}),
        ...(isTestFile(f.path) ? { test: true } : {}),
      },
      extractionMethod: 'filesystem',
      confidence: 1,
      verified: true,
    });
    addEdge('CONTAINS', ensureDir(dirOf(f.path)), id, f.path, null, 'filesystem');
  }

  // ---- symbols ------------------------------------------------------------
  const ctxs = new Map<string, FileCtx>();
  const byModuleName = new Map<string, string[]>();
  const pySuffix = new Map<string, string[]>();
  for (const [p, ff] of facts) {
    if (!fileSet.has(p)) continue;
    const top = new Map<string, string>();
    const byLocal = new Map<string, SymbolFact>();
    const fileId = nodeId.file(p);
    for (const s of ff.symbols) {
      byLocal.set(s.localId, s);
      if (!s.parent && s.kind !== 'ApiEndpoint' && !top.has(s.name)) top.set(s.name, s.localId);
    }
    for (const s of ff.symbols) {
      const id = nodeId.symbol(p, s.localId);
      addNode({
        id,
        name: s.name,
        type: s.kind,
        filePath: p,
        location: s.location,
        language: ff.language,
        description: s.description,
        metadata: { ...(s.metadata ?? {}), qualifiedName: s.localId, exported: s.exported },
        extractionMethod: ff.adapter === 'typescript' ? 'typescript-compiler' : ff.adapter === 'python' ? 'python-ast' : 'tree-sitter',
        confidence: 1,
        verified: true,
      });
      const parentId = s.parent && byLocal.has(s.parent) ? nodeId.symbol(p, s.parent) : fileId;
      const ev = `${s.name} declared at ${p}:${s.location.startLine}`;
      addEdge('CONTAINS', parentId, id, ev, s.location, 'filesystem');
      if (parentId !== fileId) addEdge('DEFINED_IN', id, fileId, ev, s.location, 'filesystem');
      else if (s.exported && s.kind !== 'ApiEndpoint') addEdge('EXPORTS', fileId, id, `${s.name} is exported from ${p}`, s.location, nodes[nodes.length - 1]!.extractionMethod);
    }
    ctxs.set(p, { facts: ff, top, byLocal, bindings: new Map(), visible: [], external: new Set() });
    if (ff.moduleName) {
      (byModuleName.get(`${ff.language}:${ff.moduleName}`) ?? byModuleName.set(`${ff.language}:${ff.moduleName}`, []).get(`${ff.language}:${ff.moduleName}`)!).push(p);
      if (ff.language === 'python') {
        const parts = ff.moduleName.split('.');
        for (let i = 0; i < parts.length; i++) {
          const suffix = parts.slice(i).join('.');
          (pySuffix.get(suffix) ?? pySuffix.set(suffix, []).get(suffix)!).push(p);
        }
      }
    }
  }

  // ---- packages -----------------------------------------------------------
  const declared = new Map<string, (typeof manifests.dependencies)[number]>();
  for (const d of manifests.dependencies) if (!declared.has(d.name)) declared.set(d.name, d);
  const ensurePackage = (name: string, ecosystem: string): string => {
    const id = nodeId.pkg(name);
    if (!nodeIds.has(id)) {
      const dep = declared.get(name) ?? declared.get(name.replace(/_/g, '-'));
      addNode({
        id,
        name,
        type: 'Package',
        filePath: null,
        location: null,
        language: null,
        metadata: { external: true, declared: !!dep, version: dep?.version ?? null, ecosystem: dep?.ecosystem ?? ecosystem, dev: dep?.dev ?? false },
        extractionMethod: dep ? 'manifest' : 'filesystem',
        confidence: 1,
        verified: true,
      });
    }
    return id;
  };
  for (const d of manifests.dependencies) {
    const pkgId = ensurePackage(d.name, d.ecosystem);
    const manifestId = nodeId.file(d.manifest);
    if (nodeIds.has(manifestId))
      addEdge('DEPENDS_ON', manifestId, pkgId, d.evidence, { path: d.manifest, startLine: d.line, endLine: d.line }, 'manifest', 1, true, { dev: d.dev, version: d.version });
  }

  // ---- imports ------------------------------------------------------------
  const bind = (ctx: FileCtx, local: string, b: Binding) => {
    if (local && local !== '*' && !ctx.bindings.has(local)) ctx.bindings.set(local, b);
  };
  const symbolIn = (filesList: string[], name: string): { path: string; localId: string } | null => {
    let hit: { path: string; localId: string } | null = null;
    for (const f of filesList) {
      const l = ctxs.get(f)?.top.get(name);
      if (l) {
        if (hit) return null; // ambiguous
        hit = { path: f, localId: l };
      }
    }
    return hit;
  };
  const closest = (from: string, candidates: string[]): string | null => {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    const fromParts = dirOf(from).split('/');
    let best: string | null = null;
    let bestScore = -1;
    let tie = false;
    for (const c of candidates) {
      const parts = dirOf(c).split('/');
      let i = 0;
      while (i < parts.length && i < fromParts.length && parts[i] === fromParts[i]) i++;
      if (i > bestScore) {
        best = c;
        bestScore = i;
        tie = false;
      } else if (i === bestScore) tie = true;
    }
    return tie ? null : best;
  };

  const importEdge = (from: string, target: string, imp: ImportFact, method: ExtractionMethod, confidence = 1, verified = true) => {
    const targetId = fileSet.has(target) ? nodeId.file(target) : nodeIds.has(nodeId.directory(target)) ? nodeId.directory(target) : null;
    if (!targetId) return;
    addEdge('IMPORTS', nodeId.file(from), targetId, imp.evidence, imp.location, method, confidence, verified, { specifier: imp.specifier, kind: imp.kind });
  };
  const externalImport = (from: string, pkg: string, ecosystem: string, imp: ImportFact, method: ExtractionMethod) => {
    markExternal(from, imp);
    addEdge('IMPORTS', nodeId.file(from), ensurePackage(pkg, ecosystem), imp.evidence, imp.location, method, 1, true, { specifier: imp.specifier, external: true });
  };
  const fileNodeIndex = new Map<string, GraphNode>();
  for (const n of nodes) if (n.type === 'File' || n.type === 'Configuration') fileNodeIndex.set(n.id, n);
  const markExternal = (from: string, imp: ImportFact) => {
    const c = ctxs.get(from);
    if (!c) return;
    for (const n of imp.names) if (n.local && n.local !== '*') c.external.add(n.local);
    // `import a.b.c` binds the top-level name `a`.
    if (c.facts.language === 'python' && !imp.specifier.startsWith('.')) c.external.add(imp.specifier.split('.')[0]!);
  };
  const noteBuiltinFast = (from: string, name: string, imp?: ImportFact) => {
    if (imp) markExternal(from, imp);
    const node = fileNodeIndex.get(nodeId.file(from));
    if (!node) return;
    const list = ((node.metadata.builtinImports as string[] | undefined) ??= []);
    if (!list.includes(name) && list.length < 50) list.push(name);
  };

  const rustCrateRoot = (file: string): string | null => {
    let best: string | null = null;
    for (const c of manifests.cargoCrates) if ((c.dir === '' || file.startsWith(`${c.dir}/`)) && (best === null || c.dir.length > best.length)) best = c.dir;
    if (best !== null) return best === '' ? 'src' : `${best}/src`;
    const i = file.lastIndexOf('/src/');
    return i === -1 ? (file.startsWith('src/') ? 'src' : null) : file.slice(0, i + 4);
  };
  const rustFile = (root: string, segs: string[]): string | null => {
    if (segs.length === 0) return [`${root}/lib.rs`, `${root}/main.rs`].find((f) => fileSet.has(f)) ?? null;
    const base = `${root}/${segs.join('/')}`;
    return [`${base}.rs`, `${base}/mod.rs`].find((f) => fileSet.has(f)) ?? null;
  };

  for (const [p, ctx] of ctxs) {
    const lang = ctx.facts.language;
    for (const imp of ctx.facts.imports) {
      // --- TypeScript / JavaScript: the adapter already resolved the import
      if (ctx.facts.adapter === 'typescript') {
        if (imp.resolvedPath) {
          importEdge(p, imp.resolvedPath, imp, 'typescript-compiler');
          if (imp.kind === 'reexport') {
            const tctx = ctxs.get(imp.resolvedPath);
            for (const n of imp.names) {
              const l = n.imported !== '*' ? tctx?.top.get(n.imported) : undefined;
              if (l) addEdge('EXPORTS', nodeId.file(p), nodeId.symbol(imp.resolvedPath, l), imp.evidence, imp.location, 'typescript-compiler', 1, true, { reexport: true });
            }
          }
        } else if (imp.externalPackage) {
          if (imp.builtin) noteBuiltinFast(p, imp.externalPackage, imp);
          else externalImport(p, imp.externalPackage, 'npm', imp, 'typescript-compiler');
        } else reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'import target not found in repository');
        continue;
      }

      if (lang === 'python') {
        const level = /^\.*/.exec(imp.specifier)![0].length;
        const rest = imp.specifier.slice(level);
        const moduleFile = (dotted: string): string | null => {
          if (level > 0) {
            let dir = dirOf(p);
            for (let i = 1; i < level; i++) dir = dirOf(dir);
            const base = dotted ? path.posix.join(dir, dotted.replace(/\./g, '/')) : dir;
            return [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`].find((f) => fileSet.has(f)) ?? null;
          }
          return dotted ? closest(p, pySuffix.get(dotted) ?? []) : null;
        };
        const mod = moduleFile(rest);
        let linked = false;
        for (const n of imp.names) {
          if (n.imported === '*' && !imp.specifier.startsWith('.') && imp.names.length === 1 && n.local !== '*') {
            // `import a.b.c [as x]`
            if (mod) {
              bind(ctx, n.local === rest.split('.')[0] ? rest : n.local, { files: [mod], localId: null });
              bind(ctx, rest, { files: [mod], localId: null });
            }
            continue;
          }
          if (n.imported === '*') {
            if (mod) ctx.visible.push(mod);
            continue;
          }
          const sub = moduleFile(rest ? `${rest}.${n.imported}` : n.imported);
          if (sub) {
            bind(ctx, n.local, { files: [sub], localId: null });
            importEdge(p, sub, imp, 'scope-resolution');
            linked = true;
          } else if (mod) {
            const l = ctxs.get(mod)?.top.get(n.imported) ?? null;
            bind(ctx, n.local, { files: [mod], localId: l });
          }
        }
        if (mod) importEdge(p, mod, imp, 'scope-resolution');
        else if (!linked) {
          const topName = rest.split('.')[0] ?? '';
          if (level > 0 || !topName) reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'import target not found in repository');
          else if (PY_STDLIB.has(topName)) noteBuiltinFast(p, topName, imp);
          else externalImport(p, declared.has(topName.toLowerCase()) ? topName.toLowerCase() : topName, 'pypi', imp, 'python-ast');
        }
        continue;
      }

      if (lang === 'java') {
        const wildcard = imp.specifier.endsWith('.*');
        const full = wildcard ? imp.specifier.slice(0, -2) : imp.specifier;
        const pkg = wildcard ? full : full.slice(0, full.lastIndexOf('.'));
        const name = wildcard ? '*' : full.slice(full.lastIndexOf('.') + 1);
        let pkgFiles = byModuleName.get(`java:${pkg}`) ?? [];
        let symName = name;
        if (pkgFiles.length === 0 && !wildcard && pkg.includes('.')) {
          // static import `a.b.C.member`
          pkgFiles = byModuleName.get(`java:${pkg.slice(0, pkg.lastIndexOf('.'))}`) ?? [];
          symName = pkg.slice(pkg.lastIndexOf('.') + 1);
        }
        if (pkgFiles.length) {
          if (wildcard) {
            ctx.visible.push(...pkgFiles);
            for (const f of pkgFiles.slice(0, 25)) importEdge(p, f, imp, 'scope-resolution');
          } else {
            const hit = symbolIn(pkgFiles, symName);
            if (hit) {
              bind(ctx, symName, { files: [hit.path], localId: hit.localId });
              importEdge(p, hit.path, imp, 'scope-resolution');
            } else reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'imported name not found in package');
          }
        } else if (/^(java|javax|jdk|sun)\./.test(full)) noteBuiltinFast(p, full.split('.').slice(0, 2).join('.'), imp);
        else externalImport(p, full.split('.').slice(0, 2).join('.'), 'maven', imp, 'tree-sitter');
        continue;
      }

      if (lang === 'go') {
        const mod = manifests.goModules.find((m) => imp.specifier === m.module || imp.specifier.startsWith(`${m.module}/`));
        if (mod) {
          const dir = path.posix.join(mod.dir, imp.specifier.slice(mod.module.length)).replace(/^\/|\/$/g, '');
          const pkgFiles = (filesByDir.get(dir) ?? []).filter((f) => f.endsWith('.go'));
          if (pkgFiles.length) {
            for (const n of imp.names) bind(ctx, n.local, { files: pkgFiles, localId: null });
            importEdge(p, dir, imp, 'scope-resolution');
          } else reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'import target not found in repository');
        } else if (!imp.specifier.split('/')[0]!.includes('.')) noteBuiltinFast(p, imp.specifier, imp);
        else externalImport(p, imp.specifier.split('/').slice(0, 3).join('/'), 'go', imp, 'tree-sitter');
        continue;
      }

      if (lang === 'rust') {
        const segs = imp.specifier.split('::').filter(Boolean);
        const root = rustCrateRoot(p);
        const n = imp.names[0] ?? { imported: '*', local: '*' };
        if (!root || segs.length === 0) continue;
        const rel = p.slice(root.length + 1).replace(/\.rs$/, '').split('/');
        const cur = ['lib', 'main', 'mod'].includes(rel[rel.length - 1]!) ? rel.slice(0, -1) : rel;
        let abs: string[] | null = null;
        if (segs[0] === 'crate') abs = segs.slice(1);
        else if (segs[0] === 'self') abs = [...cur, ...segs.slice(1)];
        else if (segs[0] === 'super') {
          let base = cur.slice(0, -1);
          let i = 1;
          while (segs[i] === 'super') {
            base = base.slice(0, -1);
            i++;
          }
          abs = [...base, ...segs.slice(i)];
        } else if (rustFile(root, [...cur, segs[0]!])) abs = [...cur, ...segs];
        else if (rustFile(root, [segs[0]!])) abs = segs;
        if (abs) {
          const path0 = n.imported === '*' ? abs : abs;
          let done = false;
          for (let k = path0.length; k >= 0 && !done; k--) {
            const file = rustFile(root, path0.slice(0, k));
            if (!file) continue;
            const remaining = path0.slice(k);
            if (n.imported === '*' && imp.specifier.endsWith('*')) ctx.visible.push(file);
            else if (remaining.length === 0) bind(ctx, n.local, { files: [file], localId: null });
            else bind(ctx, n.local, { files: [file], localId: ctxs.get(file)?.top.get(remaining[0]!) ?? null });
            if (file !== p) importEdge(p, file, imp, 'scope-resolution');
            done = true;
          }
          if (!done) reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'import target not found in repository');
        } else if (['std', 'core', 'alloc'].includes(segs[0]!)) noteBuiltinFast(p, segs[0]!, imp);
        else {
          const crate = segs[0]!;
          externalImport(p, declared.has(crate) ? crate : declared.has(crate.replace(/_/g, '-')) ? crate.replace(/_/g, '-') : crate, 'cargo', imp, 'tree-sitter');
        }
        continue;
      }

      if (lang === 'c' || lang === 'cpp') {
        if (imp.externalPackage) {
          noteBuiltinFast(p, imp.externalPackage, imp);
          continue;
        }
        const rel = path.posix.normalize(path.posix.join(dirOf(p), imp.specifier));
        let target = fileSet.has(rel) ? rel : null;
        if (!target) {
          const cands = (filesByBase.get(baseOf(imp.specifier)) ?? []).filter((f) => f.endsWith(imp.specifier.replace(/^(\.\.?\/)+/, '')));
          target = closest(p, cands) ?? (cands.length === 1 ? cands[0]! : null);
        }
        if (target) {
          ctx.visible.push(target);
          importEdge(p, target, imp, 'scope-resolution');
        } else reportUnresolved(p, null, 'IMPORTS', imp.specifier, imp.location.startLine, 'included file not found in repository');
        continue;
      }

      if (lang === 'csharp') {
        const nsFiles = byModuleName.get(`csharp:${imp.specifier}`) ?? [];
        if (nsFiles.length) {
          ctx.visible.push(...nsFiles);
          for (const f of nsFiles.slice(0, 25)) if (f !== p) importEdge(p, f, imp, 'scope-resolution');
        } else if (/^(System|Microsoft)(\.|$)/.test(imp.specifier)) noteBuiltinFast(p, imp.specifier, imp);
        else externalImport(p, imp.specifier.split('.').slice(0, 2).join('.'), 'nuget', imp, 'tree-sitter');
      }
    }

    // Language visibility rules: same package (Java, Go) or namespace (C#).
    if ((lang === 'java' || lang === 'csharp') && ctx.facts.moduleName) ctx.visible.push(...(byModuleName.get(`${lang}:${ctx.facts.moduleName}`) ?? []).filter((f) => f !== p));
    if (lang === 'go') ctx.visible.push(...(filesByDir.get(dirOf(p)) ?? []).filter((f) => f !== p && f.endsWith('.go') && ctxs.get(f)?.facts.moduleName === ctx.facts.moduleName));
  }

  // ---- references ---------------------------------------------------------
  const kindOf = (pth: string, localId: string | null): NodeType | null => (localId ? (ctxs.get(pth)?.byLocal.get(localId)?.kind ?? null) : null);
  const mk = (pth: string, localId: string | null, method: ExtractionMethod, confidence: number, verified: boolean): Target => ({
    path: pth,
    localId,
    kind: kindOf(pth, localId),
    method,
    confidence,
    verified,
  });

  /** Resolves an unqualified name from the point of view of one file. */
  const lookupName = (p: string, ctx: FileCtx, name: string): Target | { reason: string } => {
    const own = ctx.top.get(name);
    if (own) return mk(p, own, 'scope-resolution', 0.95, true);
    const b = ctx.bindings.get(name);
    if (b) {
      if (b.localId) return mk(b.files[0]!, b.localId, 'scope-resolution', 0.9, true);
      if (b.files.length === 1) return mk(b.files[0]!, null, 'scope-resolution', 0.9, true);
    }
    if (ctx.visible.length) {
      const matches: { path: string; localId: string }[] = [];
      for (const f of ctx.visible) {
        const l = ctxs.get(f)?.top.get(name);
        if (l) matches.push({ path: f, localId: l });
      }
      if (matches.length > 1) {
        // A prototype in a header and its definition are the same entity: prefer the definition.
        const defs = matches.filter((m) => !ctxs.get(m.path)?.byLocal.get(m.localId)?.metadata?.declarationOnly);
        if (defs.length === 1) return mk(defs[0]!.path, defs[0]!.localId, 'name-resolution', 0.7, false);
        return { reason: 'ambiguous name (several visible definitions)' };
      }
      if (matches.length === 1) {
        let m = matches[0]!;
        const sym = ctxs.get(m.path)?.byLocal.get(m.localId);
        if (sym?.metadata?.declarationOnly) {
          // Look for the definition next to the header (util.h -> util.c / util.cpp).
          const stem = stemOf(m.path);
          const impl = ['.c', '.cc', '.cpp', '.cxx'].map((e) => stem + e).find((f) => ctxs.get(f)?.top.has(name));
          if (impl) m = { path: impl, localId: ctxs.get(impl)!.top.get(name)! };
        }
        return mk(m.path, m.localId, 'name-resolution', 0.7, false);
      }
    }
    return { reason: 'no definition found in scope (external, built-in or dynamic)' };
  };

  /** Resolves `a.b.c` / `a::b` to a symbol or module by walking imports. */
  const lookupDotted = (p: string, ctx: FileCtx, dotted: string): Target | null => {
    const whole = ctx.bindings.get(dotted);
    if (whole) return whole.localId ? mk(whole.files[0]!, whole.localId, 'scope-resolution', 0.9, true) : whole.files.length === 1 ? mk(whole.files[0]!, null, 'scope-resolution', 0.9, true) : null;
    const parts = dotted.split(/\.|::/).filter(Boolean);
    if (parts.length === 0) return null;
    let cur: Target | null = null;
    let files: string[] | null = null;
    const first = lookupName(p, ctx, parts[0]!);
    if ('reason' in first) {
      const b = ctx.bindings.get(parts[0]!);
      if (!b) return null;
      files = b.files;
    } else cur = first;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      if (cur && cur.localId === null) files = [cur.path];
      if (files) {
        const hit = symbolIn(files, part);
        if (!hit) return null;
        cur = mk(hit.path, hit.localId, 'scope-resolution', 0.9, true);
        files = null;
      } else if (cur?.localId) {
        const member = `${cur.localId}.${part}`;
        if (!ctxs.get(cur.path)?.byLocal.has(member)) return null;
        cur = mk(cur.path, member, cur.method, cur.confidence, cur.verified);
      } else return null;
    }
    if (!cur && files) return files.length === 1 ? mk(files[0]!, null, 'scope-resolution', 0.9, true) : ({ path: files[0]!, localId: null, kind: null, method: 'scope-resolution', confidence: 0.9, verified: true, files } as Target & { files: string[] });
    return cur;
  };

  const IMPLICIT_THIS = new Set(['java', 'csharp', 'cpp']);
  const enclosingType = (ctx: FileCtx, from: string | null): string | null => {
    let cls = from ? (ctx.byLocal.get(from)?.parent ?? null) : null;
    while (cls && !CLASS_KINDS.has(ctx.byLocal.get(cls)?.kind ?? 'Function')) cls = ctx.byLocal.get(cls)?.parent ?? null;
    return cls;
  };
  const resolveNamed = (p: string, ctx: FileCtx, ref: ReferenceFact, name: string, receiver: string | undefined): Target | { reason: string } | { external: true } => {
    if (!receiver) {
      // Languages with an implicit receiver: an unqualified call may be a member of the enclosing type.
      if (IMPLICIT_THIS.has(ctx.facts.language) && ref.kind === 'CALLS') {
        const cls = enclosingType(ctx, ref.from);
        if (cls && ctx.byLocal.has(`${cls}.${name}`)) return mk(p, `${cls}.${name}`, 'scope-resolution', 0.9, true);
      }
      const r = lookupName(p, ctx, name);
      if ('reason' in r && ctx.external.has(name)) return { external: true };
      return r;
    }
    const head = receiver.split(/\.|::/)[0]!;
    if (ctx.external.has(head) && !ctx.top.has(head)) return { external: true };
    if (SELF_NAMES.has(head)) {
      if (receiver !== head) return { reason: 'receiver type unknown' };
      const cls = enclosingType(ctx, ref.from);
      if (cls && ctx.byLocal.has(`${cls}.${name}`)) return mk(p, `${cls}.${name}`, 'scope-resolution', 0.9, true);
      return { reason: 'member not found on enclosing type (inherited or dynamic)' };
    }
    const recv = lookupDotted(p, ctx, receiver);
    if (!recv) return { reason: 'receiver type unknown' };
    const multi = (recv as Target & { files?: string[] }).files;
    if (recv.localId === null) {
      const hit = symbolIn(multi ?? [recv.path], name);
      return hit ? mk(hit.path, hit.localId, 'scope-resolution', 0.9, true) : { reason: 'member not found in imported module' };
    }
    if (recv.kind && CLASS_KINDS.has(recv.kind)) {
      const member = `${recv.localId}.${name}`;
      if (ctxs.get(recv.path)?.byLocal.has(member)) return mk(recv.path, member, recv.method, Math.min(recv.confidence, 0.9), recv.verified);
      return { reason: 'member not found on type' };
    }
    return { reason: 'receiver type unknown' };
  };

  for (const [p, ctx] of ctxs) {
    const fileId = nodeId.file(p);
    for (const ref of ctx.facts.references) {
      const fromId = ref.from && ctx.byLocal.has(ref.from) ? nodeId.symbol(p, ref.from) : fileId;
      if ('resolved' in ref.target) {
        const t = ref.target.resolved;
        const targetId = t.localId ? nodeId.symbol(t.path, t.localId) : nodeId.file(t.path);
        if (nodeIds.has(targetId)) addEdge(ref.kind, fromId, targetId, ref.evidence, ref.location, ref.method, ref.confidence, ref.verified, ref.metadata);
        else reportUnresolved(p, ref.from, ref.kind, t.localId ?? t.path, ref.location.startLine, 'declaration is outside the indexed files');
        continue;
      }
      const { name, receiver } = ref.target;
      const speculative = ref.metadata?.typeOnly === true || ref.metadata?.argument === true;
      if (ctx.facts.adapter === 'typescript') {
        reportUnresolved(p, ref.from, ref.kind, name, ref.location.startLine, 'no declaration found by the type checker');
        continue;
      }
      const result = resolveNamed(p, ctx, ref, name, receiver);

      // Data access heuristics: a call on (or passing) a known database model.
      if (ref.kind === 'CALLS' && (ref.metadata?.db === 'read' || ref.metadata?.db === 'write')) {
        const models = new Map<string, Target>();
        if (receiver) {
          const parts = receiver.split('.');
          for (let i = 1; i <= parts.length; i++) {
            const t = lookupDotted(p, ctx, parts.slice(0, i).join('.'));
            if (t?.kind === 'DatabaseModel') models.set(`${t.path}#${t.localId}`, t);
          }
        }
        for (const a of (ref.metadata.args as string[] | undefined) ?? []) {
          const t = lookupDotted(p, ctx, a);
          if (t?.kind === 'DatabaseModel') models.set(`${t.path}#${t.localId}`, t);
        }
        for (const t of models.values())
          addEdge(ref.metadata.db === 'read' ? 'READS_FROM' : 'WRITES_TO', fromId, nodeId.symbol(t.path, t.localId!), ref.evidence, ref.location, 'pattern', 0.7, false, { operation: name });
      }

      if ('external' in result) continue;
      if ('reason' in result) {
        if (!speculative) reportUnresolved(p, ref.from, ref.kind, receiver ? `${receiver}.${name}` : name, ref.location.startLine, result.reason);
        continue;
      }
      if (speculative && result.localId === null) continue;
      let kind = ref.kind;
      if (kind === 'CALLS' && result.kind && (result.kind === 'Class' || result.kind === 'DatabaseModel')) kind = 'INSTANTIATES';
      if (kind === 'CALLS' && result.localId === null) continue; // a module is not callable
      const targetId = result.localId ? nodeId.symbol(result.path, result.localId) : nodeId.file(result.path);
      if (targetId === fromId && kind !== 'CALLS') continue;
      if (!nodeIds.has(targetId)) continue;
      addEdge(kind, fromId, targetId, ref.evidence, ref.location, result.method, result.confidence, result.verified, ref.metadata);
    }
  }

  return { nodes, edges, unresolved, unresolvedCount, unresolvedByReason };
}
