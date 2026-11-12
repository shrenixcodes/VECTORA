/**
 * TypeScript / JavaScript adapter.
 *
 * Builds one `ts.Program` for all TypeScript and JavaScript files in the
 * repository and uses the type checker to resolve references to their
 * declarations. A relationship is only emitted as resolved when the checker
 * ties the identifier to a declaration inside the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { EdgeType, NodeType, SourceLocation } from '@vectora/graph-schema';
import { normalizePath } from '@vectora/graph-schema';
import {
  type AnalyzeContext,
  type FileFacts,
  type ImportFact,
  type LanguageAdapter,
  type ReferenceFact,
  type SourceFileInput,
  type SymbolFact,
  emptyFacts,
  evidenceLine,
  uniqueLocalId,
} from './types';

const CODE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLVE_EXTS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const ROUTE_RECEIVER = /(^|[a-z_])(app|router|server|fastify|api|routes?|instance)$/i;
const NEST_HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All']);
const MODEL_BASES = new Set(['Model', 'BaseEntity', 'Document', 'Entity']);
const MODEL_DECORATORS = new Set(['Entity', 'Table', 'Schema', 'ObjectType']);
const TABLE_FACTORIES = new Set(['sqliteTable', 'pgTable', 'mysqlTable', 'defineTable', 'model', 'define']);
const DB_READ = /^(find|get|select|query|count|all|where|aggregate|first|exists|list|fetch|load|search|paginate)/i;
const DB_WRITE = /^(create|insert|update|delete|save|remove|upsert|destroy|bulk|truncate|increment|decrement|set|add|put|drop)/i;
const KNOWN_GLOBALS = new Set([
  'require', 'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'jest', 'vi',
  'process', 'Buffer', 'setImmediate', 'clearImmediate', 'define', '$', 'jQuery', 'suite', 'before', 'after', 'gc',
]);
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events',
  'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

interface SymRef {
  path: string;
  localId: string;
  kind: NodeType;
}

interface TsconfigScope {
  dir: string; // repository-relative, '' for root
  baseUrl: string; // repository-relative
  paths: Record<string, string[]>;
}

const isWin = process.platform === 'win32';
const canon = (p: string): string => {
  const n = p.replace(/\\/g, '/');
  return isWin ? n.toLowerCase() : n;
};

function scriptKindFor(file: string): ts.ScriptKind {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function extensionFor(file: string): ts.Extension {
  const lower = file.toLowerCase();
  if (lower.endsWith('.d.ts')) return ts.Extension.Dts;
  const ext = path.extname(lower);
  switch (ext) {
    case '.tsx':
      return ts.Extension.Tsx;
    case '.jsx':
      return ts.Extension.Jsx;
    case '.js':
      return ts.Extension.Js;
    case '.mjs':
      return ts.Extension.Mjs;
    case '.cjs':
      return ts.Extension.Cjs;
    case '.mts':
      return ts.Extension.Mts;
    case '.cts':
      return ts.Extension.Cts;
    default:
      return ts.Extension.Ts;
  }
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) ? (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false) : false;

function decoratorNames(node: ts.Node): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map((d) => {
    const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
    return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : e.getText();
  });
}

function decoratorCall(node: ts.Node, names: Set<string>): { name: string; arg: string | null } | null {
  if (!ts.canHaveDecorators(node)) return null;
  for (const d of ts.getDecorators(node) ?? []) {
    const call = ts.isCallExpression(d.expression) ? d.expression : null;
    const e = call ? call.expression : d.expression;
    const name = ts.isIdentifier(e) ? e.text : null;
    if (name && names.has(name)) {
      const a = call?.arguments[0];
      return { name, arg: a && ts.isStringLiteralLike(a) ? a.text : null };
    }
  }
  return null;
}

function containsJsx(node: ts.Node | undefined): boolean {
  if (!node) return false;
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

const isFunctionLike = (n: ts.Node | undefined): n is ts.ArrowFunction | ts.FunctionExpression =>
  !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** Unwraps `memo(fn)`, `forwardRef(fn)` and similar wrappers to the inner function. */
function wrappedFunction(init: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!init) return null;
  if (isFunctionLike(init)) return init;
  if (ts.isCallExpression(init)) {
    for (const a of init.arguments) {
      const inner = wrappedFunction(a);
      if (inner) return inner;
    }
  }
  return null;
}

function jsDocOf(node: ts.Node): string | undefined {
  const host = ts.isVariableDeclaration(node) ? node.parent?.parent : node;
  const docs = (host as { jsDoc?: ts.JSDoc[] } | undefined)?.jsDoc;
  const text = docs?.length ? ts.getTextOfJSDocComment(docs[docs.length - 1]!.comment) : undefined;
  if (!text) return undefined;
  const first = text.trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ');
  return first.length > 300 ? `${first.slice(0, 297)}...` : first;
}

function routeCallInfo(call: ts.CallExpression): { method: string; routePath: string } | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (!HTTP_METHODS.has(method) || call.arguments.length < 2) return null;
  const first = call.arguments[0]!;
  if (!ts.isStringLiteralLike(first) || !first.text.startsWith('/')) return null;
  const recv = callee.expression;
  const recvName = ts.isIdentifier(recv) ? recv.text : ts.isPropertyAccessExpression(recv) ? recv.name.text : null;
  if (!recvName || !ROUTE_RECEIVER.test(recvName)) return null;
  return { method: method.toUpperCase(), routePath: first.text };
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

class Resolver {
  private scopes: TsconfigScope[] = [];
  private cache = new Map<string, string | null>();

  constructor(
    private ctx: AnalyzeContext,
    private codeFiles: Set<string>,
  ) {
    for (const f of ctx.allFiles) {
      const base = f.slice(f.lastIndexOf('/') + 1);
      if (base !== 'tsconfig.json' && base !== 'jsconfig.json') continue;
      try {
        const abs = path.join(ctx.rootDir, f);
        const parsed = ts.parseConfigFileTextToJson(abs, fs.readFileSync(abs, 'utf8'));
        const co = parsed.config?.compilerOptions;
        if (!co?.paths && !co?.baseUrl) continue;
        const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
        const baseUrl = normalizePath(path.posix.join(dir, co.baseUrl ?? '.'));
        this.scopes.push({ dir, baseUrl: baseUrl === '.' ? '' : baseUrl, paths: co.paths ?? {} });
      } catch {
        // Unreadable config: aliases from it simply stay unresolved.
      }
    }
    this.scopes.sort((a, b) => b.dir.length - a.dir.length);
  }

  /** Finds an indexed file for a path without extension. */
  tryFile(base: string, codeOnly = true): string | null {
    const b = normalizePath(path.posix.normalize(base));
    if (b.startsWith('..')) return null;
    const has = (p: string) => (codeOnly ? this.codeFiles.has(p) : this.ctx.allFiles.has(p));
    if (has(b) && (!codeOnly || CODE_EXTS.some((e) => b.endsWith(e)))) return b;
    // `./x.js` written in TypeScript sources refers to `./x.ts`.
    const m = /\.(js|jsx|mjs|cjs)$/.exec(b);
    if (m) {
      const stem = b.slice(0, -m[0].length);
      for (const e of ['.ts', '.tsx', '.mts', '.cts']) if (this.codeFiles.has(stem + e)) return stem + e;
    }
    for (const e of RESOLVE_EXTS) if (this.codeFiles.has(b + e)) return b + e;
    for (const e of RESOLVE_EXTS) if (this.codeFiles.has(`${b}/index${e}`)) return `${b}/index${e}`;
    return null;
  }

  resolve(specifier: string, fromFile: string): { path: string | null; asset: string | null; external: string | null; builtin: boolean } {
    const key = `${fromFile}\0${specifier}`;
    const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
    const none = { path: null, asset: null, external: null, builtin: false };
    if (specifier.startsWith('.')) {
      const target = path.posix.join(dir, specifier);
      const hit = this.cache.get(key) ?? this.tryFile(target);
      this.cache.set(key, hit);
      if (hit) return { ...none, path: hit };
      const asset = this.ctx.allFiles.has(normalizePath(target)) ? normalizePath(target) : null;
      return { ...none, asset };
    }
    if (specifier.startsWith('node:') || NODE_BUILTINS.has(packageNameOf(specifier)))
      return { ...none, external: `node:${specifier.replace(/^node:/, '').split('/')[0]}`, builtin: true };
    if (this.cache.has(key)) {
      const c = this.cache.get(key)!;
      return c ? { ...none, path: c } : { ...none, external: packageNameOf(specifier) };
    }
    let hit: string | null = null;
    // tsconfig path aliases, nearest config first
    for (const scope of this.scopes) {
      if (scope.dir && !(fromFile === scope.dir || fromFile.startsWith(`${scope.dir}/`))) continue;
      for (const [pattern, targets] of Object.entries(scope.paths)) {
        const star = pattern.indexOf('*');
        let capture: string | null = null;
        if (star === -1) {
          if (pattern === specifier) capture = '';
        } else if (specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))) {
          capture = specifier.slice(star, specifier.length - (pattern.length - star - 1));
        }
        if (capture === null) continue;
        for (const t of targets) {
          hit = this.tryFile(path.posix.join(scope.baseUrl, t.replace('*', capture)));
          if (hit) break;
        }
        if (hit) break;
      }
      if (hit) break;
      // bare baseUrl-relative import
      hit = this.tryFile(path.posix.join(scope.baseUrl, specifier));
      if (hit) break;
    }
    // workspace packages
    if (!hit) {
      const pkgName = packageNameOf(specifier);
      const pkg = this.ctx.workspacePackages.find((p) => p.name === pkgName);
      if (pkg) {
        const sub = specifier.slice(pkgName.length).replace(/^\//, '');
        hit = sub
          ? (this.tryFile(path.posix.join(pkg.dir, sub)) ?? this.tryFile(path.posix.join(pkg.dir, 'src', sub)))
          : ((pkg.entry && this.codeFiles.has(pkg.entry) ? pkg.entry : null) ??
            this.tryFile(path.posix.join(pkg.dir, 'src/index')) ??
            this.tryFile(path.posix.join(pkg.dir, 'index')));
      }
    }
    this.cache.set(key, hit);
    return hit ? { ...none, path: hit } : { ...none, external: packageNameOf(specifier) };
  }
}

export function createTypeScriptAdapter(): LanguageAdapter {
  return {
    id: 'typescript',
    technique: 'TypeScript Compiler API with type-checker symbol resolution',
    scope: 'project',
    languages: [
      { id: 'typescript', name: 'TypeScript', tier: 1, extensions: ['.ts', '.tsx', '.mts', '.cts'] },
      { id: 'javascript', name: 'JavaScript', tier: 1, extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
    ],
    async analyze(files, ctx) {
      return analyzeProject(files, ctx);
    },
  };
}

function analyzeProject(files: SourceFileInput[], ctx: AnalyzeContext): FileFacts[] {
  if (files.length === 0) return [];
  const rootAbs = canon(path.resolve(ctx.rootDir));
  const relByAbs = new Map<string, string>();
  const inputByRel = new Map<string, SourceFileInput>();
  for (const f of files) {
    relByAbs.set(canon(path.resolve(f.absPath)), f.path);
    inputByRel.set(f.path, f);
  }
  const codeFiles = new Set(files.map((f) => f.path));
  const resolver = new Resolver(ctx, codeFiles);
  const absOf = (rel: string) => path.resolve(ctx.rootDir, rel).replace(/\\/g, '/');
  const relOf = (abs: string): string | null => relByAbs.get(canon(abs)) ?? null;

  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    experimentalDecorators: true,
    types: [],
    strict: false,
    maxNodeModuleJsDepth: 0,
  };
  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const rel = relOf(fileName);
    if (rel) {
      try {
        const text = fs.readFileSync(inputByRel.get(rel)!.absPath, 'utf8');
        return ts.createSourceFile(fileName, text, languageVersion, true, scriptKindFor(fileName));
      } catch {
        return undefined;
      }
    }
    // Only the compiler's own library files may be read from outside the repository.
    if (!canon(fileName).startsWith(`${rootAbs}/`)) return defaultGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    return undefined;
  };
  host.resolveModuleNameLiterals = (literals, containingFile) => {
    const from = relOf(containingFile);
    return literals.map((lit) => {
      if (!from) return { resolvedModule: undefined };
      const r = resolver.resolve(lit.text, from);
      if (!r.path) return { resolvedModule: undefined };
      const abs = absOf(r.path);
      return { resolvedModule: { resolvedFileName: abs, extension: extensionFor(abs), isExternalLibraryImport: false } };
    });
  };
  host.resolveTypeReferenceDirectiveReferences = (refs) => refs.map(() => ({ resolvedTypeReferenceDirective: undefined }));

  const program = ts.createProgram({ rootNames: files.map((f) => absOf(f.path)), options, host });
  const checker = program.getTypeChecker();

  // ---- Pass 1: declarations of every file --------------------------------
  const declMap = new Map<ts.Node, SymRef>();
  const endpointCalls = new Map<ts.Node, string>();
  const perFile = new Map<string, { sf: ts.SourceFile; facts: FileFacts; extraRefs: ReferenceFact[] }>();

  for (const f of files) {
    const sf = program.getSourceFile(absOf(f.path));
    if (!sf) {
      const facts = emptyFacts(f, 'typescript');
      facts.errors.push({ path: f.path, message: 'File could not be read', severity: 'error' });
      perFile.set(f.path, { sf: undefined as unknown as ts.SourceFile, facts, extraRefs: [] });
      continue;
    }
    const facts = emptyFacts(f, 'typescript', sf.getLineStarts().length);
    const extraRefs: ReferenceFact[] = [];
    collectSymbols(sf, f.path, facts, declMap, endpointCalls, extraRefs);
    perFile.set(f.path, { sf, facts, extraRefs });
  }

  // ---- Pass 2: references of the files that need analysis ----------------
  const targets = files.filter((f) => !ctx.analyzeOnly || ctx.analyzeOnly.has(f.path));
  let done = 0;
  for (const f of targets) {
    const entry = perFile.get(f.path)!;
    if (entry.sf) {
      try {
        collectReferences(entry.sf, f.path, entry.facts, checker, declMap, endpointCalls, resolver);
        entry.facts.references.push(...entry.extraRefs);
        const diags = (program.getSyntacticDiagnostics(entry.sf) ?? []).slice(0, 5);
        for (const d of diags) {
          const line = d.start !== undefined ? entry.sf.getLineAndCharacterOfPosition(d.start).line + 1 : undefined;
          entry.facts.errors.push({
            path: f.path,
            line,
            message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
            severity: 'warning',
          });
        }
      } catch (err) {
        entry.facts.errors.push({ path: f.path, message: `Analysis failed: ${(err as Error).message}`, severity: 'error' });
      }
    }
    done++;
    if (done % 25 === 0 || done === targets.length) ctx.onProgress?.(done, targets.length);
  }
  return targets.map((f) => perFile.get(f.path)!.facts);
}

// ---------------------------------------------------------------------------
// Pass 1 — symbols
// ---------------------------------------------------------------------------

function collectSymbols(
  sf: ts.SourceFile,
  rel: string,
  facts: FileFacts,
  declMap: Map<ts.Node, SymRef>,
  endpointCalls: Map<ts.Node, string>,
  extraRefs: ReferenceFact[],
): void {
  const used = new Set<string>();
  const isJsxFile = /\.(tsx|jsx|js)$/.test(rel);
  const exportedNames = new Set<string>();
  let defaultExportName: string | null = null;

  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) exportedNames.add((el.propertyName ?? el.name).text);
    } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
      defaultExportName = st.expression.text;
    }
  }

  const loc = (node: ts.Node): SourceLocation => {
    const s = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const e = sf.getLineAndCharacterOfPosition(node.getEnd());
    return { path: rel, startLine: s.line + 1, endLine: e.line + 1, startColumn: s.character, endColumn: e.character };
  };
  const signature = (node: ts.Node, body: ts.Node | undefined): string => {
    const end = body ? body.getStart(sf) : node.getEnd();
    const text = sf.text.slice(node.getStart(sf), end).replace(/\s+/g, ' ').trim().replace(/\s*=>?\s*$/, '');
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  };
  const add = (
    node: ts.Node,
    name: string,
    kind: NodeType,
    parent: string | null,
    exported: boolean,
    metadata: Record<string, unknown> = {},
    mapNode: ts.Node = node,
  ): string => {
    const localId = uniqueLocalId(used, parent ? `${parent}.${name}` : name);
    const decorators = decoratorNames(node);
    if (decorators.length) metadata.decorators = decorators;
    const sym: SymbolFact = { localId, name, kind, parent, location: loc(node), exported, metadata };
    const doc = jsDocOf(mapNode);
    if (doc) sym.description = doc;
    facts.symbols.push(sym);
    declMap.set(mapNode, { path: rel, localId, kind });
    return localId;
  };
  const isExported = (node: ts.Node, name: string): boolean =>
    hasModifier(node, ts.SyntaxKind.ExportKeyword) || exportedNames.has(name) || defaultExportName === name;

  const classKind = (node: ts.ClassLikeDeclaration): NodeType => {
    const decs = decoratorNames(node);
    if (decs.some((d) => MODEL_DECORATORS.has(d))) return 'DatabaseModel';
    for (const h of node.heritageClauses ?? []) {
      if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const t of h.types) {
        const e = t.expression;
        const base = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
        if (MODEL_BASES.has(base)) return 'DatabaseModel';
        if (base === 'Component' || base === 'PureComponent') return 'Component';
      }
    }
    return 'Class';
  };

  const addEndpoint = (node: ts.Node, method: string, routePath: string, extra: Record<string, unknown> = {}): string => {
    const localId = uniqueLocalId(used, `route:${method} ${routePath}`);
    facts.symbols.push({
      localId,
      name: `${method} ${routePath}`,
      kind: 'ApiEndpoint',
      parent: null,
      location: loc(node),
      exported: false,
      metadata: { httpMethod: method, routePath, ...extra },
    });
    return localId;
  };

  const visitClass = (node: ts.ClassLikeDeclaration, name: string, parent: string | null, exported: boolean, mapNode: ts.Node = node) => {
    const kind = classKind(node);
    const id = add(node, name, kind, parent, exported, { abstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword) || undefined }, mapNode);
    if (mapNode !== node) declMap.set(node, { path: rel, localId: id, kind });
    const controller = decoratorCall(node, new Set(['Controller']));
    for (const m of node.members) {
      let mid: string | null = null;
      if (ts.isMethodDeclaration(m) && m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name))) {
        mid = add(m, m.name.text, 'Method', id, false, {
          signature: signature(m, m.body),
          async: hasModifier(m, ts.SyntaxKind.AsyncKeyword) || undefined,
          static: hasModifier(m, ts.SyntaxKind.StaticKeyword) || undefined,
          visibility: hasModifier(m, ts.SyntaxKind.PrivateKeyword) ? 'private' : hasModifier(m, ts.SyntaxKind.ProtectedKeyword) ? 'protected' : 'public',
        });
        const http = decoratorCall(m, NEST_HTTP);
        if (http) {
          const base = controller?.arg ?? '';
          const full = `/${[base, http.arg ?? ''].join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          const ep = addEndpoint(m, http.name.toUpperCase(), full, { framework: 'decorator' });
          extraRefs.push({
            kind: 'ROUTES_TO',
            from: ep,
            target: { resolved: { path: rel, localId: mid } },
            location: loc(m),
            evidence: evidenceLine(sf.text.slice(m.getStart(sf))),
            method: 'pattern',
            confidence: 0.95,
            verified: true,
          });
        }
      } else if (ts.isConstructorDeclaration(m)) {
        mid = add(m, 'constructor', 'Method', id, false, { signature: signature(m, m.body) });
      } else if ((ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && ts.isIdentifier(m.name)) {
        mid = add(m, m.name.text, 'Method', id, false, { accessor: ts.isGetAccessorDeclaration(m) ? 'get' : 'set' });
      } else if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && isFunctionLike(m.initializer)) {
        mid = add(m, m.name.text, 'Method', id, false, { signature: signature(m, m.initializer.body) });
      }
      void mid;
    }
  };

  const visitStatement = (st: ts.Node, parent: string | null) => {
    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text ?? 'default';
      const kind: NodeType = isJsxFile && /^[A-Z]/.test(name) && containsJsx(st.body) ? 'Component' : 'Function';
      const id = add(st, name, kind, parent, isExported(st, name), {
        signature: signature(st, st.body),
        async: hasModifier(st, ts.SyntaxKind.AsyncKeyword) || undefined,
        generator: st.asteriskToken ? true : undefined,
      });
      // Next.js route handlers: app/**/route.ts exporting GET, POST, ...
      const m = /(?:^|\/)app\/(.*\/)?route\.(ts|js|tsx|jsx)$/.exec(rel);
      if (m && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
        const routePath = `/${(m[1] ?? '').replace(/\/$/, '').replace(/\([^)]*\)\/?/g, '')}`.replace(/\/$/, '') || '/';
        const ep = addEndpoint(st, name, routePath, { framework: 'file-route' });
        extraRefs.push({
          kind: 'ROUTES_TO',
          from: ep,
          target: { resolved: { path: rel, localId: id } },
          location: loc(st),
          evidence: `${rel} exports ${name}`,
          method: 'pattern',
          confidence: 0.9,
          verified: true,
        });
      }
    } else if (ts.isClassDeclaration(st)) {
      const name = st.name?.text ?? 'default';
      visitClass(st, name, parent, isExported(st, name));
    } else if (ts.isInterfaceDeclaration(st)) {
      add(st, st.name.text, 'Interface', parent, isExported(st, st.name.text), { members: st.members.length });
    } else if (ts.isTypeAliasDeclaration(st)) {
      add(st, st.name.text, 'Type', parent, isExported(st, st.name.text));
    } else if (ts.isEnumDeclaration(st)) {
      add(st, st.name.text, 'Type', parent, isExported(st, st.name.text), { enum: true, members: st.members.length });
    } else if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name) && st.body && ts.isModuleBlock(st.body)) {
      const prefix = parent ? `${parent}.${st.name.text}` : st.name.text;
      for (const inner of st.body.statements) visitStatement(inner, prefix);
    } else if (ts.isVariableStatement(st)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword) || exportedNames.has(name) || defaultExportName === name;
        const init = d.initializer;
        const fn = wrappedFunction(init);
        if (init && ts.isClassExpression(init)) {
          visitClass(init, name, parent, exported, d);
        } else if (fn) {
          const kind: NodeType = isJsxFile && /^[A-Z]/.test(name) && containsJsx(fn.body) ? 'Component' : 'Function';
          add(d, name, kind, parent, exported, {
            signature: signature(d, fn.body),
            async: hasModifier(fn, ts.SyntaxKind.AsyncKeyword) || undefined,
            wrapped: fn !== init || undefined,
          });
        } else {
          let kind: NodeType = isConst ? 'Constant' : 'Variable';
          const meta: Record<string, unknown> = {};
          if (init && ts.isCallExpression(init)) {
            const c = init.expression;
            const callee = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '';
            const recv = ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) ? c.expression.text : '';
            const tableLike =
              (TABLE_FACTORIES.has(callee) && callee !== 'model' && callee !== 'define') ||
              (callee === 'model' && /mongoose|models?/i.test(recv)) ||
              (callee === 'define' && /sequelize|db/i.test(recv));
            if (tableLike) {
              kind = 'DatabaseModel';
              const a0 = init.arguments[0];
              if (a0 && ts.isStringLiteralLike(a0)) meta.table = a0.text;
              meta.factory = callee;
            }
          }
          add(d, name, kind, parent, exported, meta);
        }
      }
    } else if (ts.isExportAssignment(st)) {
      const e = st.expression;
      if (isFunctionLike(e)) add(st, 'default', isJsxFile && containsJsx(e.body) ? 'Component' : 'Function', parent, true, { signature: signature(st, e.body) });
      else if (ts.isClassExpression(e)) visitClass(e, e.name?.text ?? 'default', parent, true, st);
    }
  };
  for (const st of sf.statements) visitStatement(st, null);

  // Route registrations can appear anywhere (module level or inside setup functions).
  const findRoutes = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const info = routeCallInfo(n);
      if (info) endpointCalls.set(n, addEndpoint(n, info.method, info.routePath, { framework: 'router-call' }));
    }
    ts.forEachChild(n, findRoutes);
  };
  findRoutes(sf);
}

// ---------------------------------------------------------------------------
// Pass 2 — imports and references
// ---------------------------------------------------------------------------

function collectReferences(
  sf: ts.SourceFile,
  rel: string,
  facts: FileFacts,
  checker: ts.TypeChecker,
  declMap: Map<ts.Node, SymRef>,
  endpointCalls: Map<ts.Node, string>,
  resolver: Resolver,
): void {
  const seen = new Set<string>();
  const loc = (node: ts.Node): SourceLocation => {
    const s = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const e = sf.getLineAndCharacterOfPosition(node.getEnd());
    return { path: rel, startLine: s.line + 1, endLine: e.line + 1, startColumn: s.character };
  };
  const lineText = (node: ts.Node): string => {
    const pos = node.getStart(sf);
    const starts = sf.getLineStarts();
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return evidenceLine(sf.text.slice(starts[line], starts[line + 1] ?? sf.text.length));
  };

  const addImport = (specNode: ts.Node, specifier: string, names: ImportFact['names'], kind: ImportFact['kind'], stmt: ts.Node) => {
    const r = resolver.resolve(specifier, rel);
    const fact: ImportFact = { specifier, names, kind, location: loc(stmt), evidence: lineText(stmt) };
    if (r.path) fact.resolvedPath = r.path;
    else if (r.asset) fact.resolvedPath = r.asset;
    else if (r.external) {
      fact.externalPackage = r.external;
      fact.builtin = r.builtin;
    } else fact.resolvedPath = null;
    facts.imports.push(fact);
    void specNode;
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteralLike(st.moduleSpecifier)) {
      const names: ImportFact['names'] = [];
      const c = st.importClause;
      if (c?.name) names.push({ imported: 'default', local: c.name.text });
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) names.push({ imported: '*', local: c.namedBindings.name.text });
        else for (const el of c.namedBindings.elements) names.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
      }
      addImport(st.moduleSpecifier, st.moduleSpecifier.text, names, 'static', st);
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier)) {
      const names: ImportFact['names'] = [];
      if (st.exportClause && ts.isNamedExports(st.exportClause))
        for (const el of st.exportClause.elements) names.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
      else names.push({ imported: '*', local: '*' });
      addImport(st.moduleSpecifier, st.moduleSpecifier.text, names, 'reexport', st);
    }
  }

  const resolveSymbol = (node: ts.Node, depth = 0): SymRef | 'unknown' | 'other' => {
    let sym: ts.Symbol | undefined;
    try {
      sym =
        ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
      if (sym && sym.flags & ts.SymbolFlags.Alias) {
        sym = checker.getAliasedSymbol(sym);
        // An import that leads outside the repository is external, not unresolved.
        if (!sym.declarations?.length) return 'other';
      }
    } catch {
      return 'other';
    }
    if (!sym || !sym.declarations?.length) return 'unknown';
    for (const d of sym.declarations) {
      const direct = declMap.get(d);
      if (direct) return direct;
    }
    for (const d of sym.declarations) {
      if (ts.isExportAssignment(d) && depth < 2) {
        const inner = resolveSymbol(d.expression, depth + 1);
        if (typeof inner === 'object') return inner;
      }
      // Members of interfaces / classes that are not symbols themselves resolve to their container.
      if (d.parent) {
        const container = declMap.get(d.parent);
        if (container && (ts.isPropertySignature(d) || ts.isMethodSignature(d) || ts.isPropertyDeclaration(d) || ts.isEnumMember(d)))
          return { ...container, kind: container.kind, localId: container.localId, path: container.path, member: true } as SymRef & { member: true };
      }
    }
    return 'other';
  };

  const push = (kind: EdgeType, from: string | null, target: SymRef, node: ts.Node, extra?: Record<string, unknown>, confidence = 1, verified = true) => {
    if (target.path === rel) {
      if (kind !== 'CALLS' && (from === target.localId || (from && from.startsWith(`${target.localId}.`)))) return;
    }
    const key = `${kind}|${from}|${target.path}#${target.localId}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.references.push({
      kind,
      from,
      target: { resolved: { path: target.path, localId: target.localId } },
      location: loc(node),
      evidence: lineText(node),
      method: kind === 'READS_FROM' || kind === 'WRITES_TO' ? 'pattern' : 'typescript-checker',
      confidence,
      verified,
      ...(extra ? { metadata: extra } : {}),
    });
  };

  const classify = (id: ts.Node): { kind: EdgeType; extra?: Record<string, unknown> } => {
    let cur: ts.Node = id;
    let p = cur.parent;
    // climb through `a.b.c` so that the outermost access is classified
    while (p && ts.isPropertyAccessExpression(p) && p.name === cur) {
      cur = p;
      p = p.parent;
    }
    if (!p) return { kind: 'USES' };
    if (ts.isCallExpression(p) && p.expression === cur) return { kind: 'CALLS' };
    if (ts.isNewExpression(p) && p.expression === cur) return { kind: 'INSTANTIATES' };
    if (ts.isExpressionWithTypeArguments(p) && p.expression === cur && p.parent && ts.isHeritageClause(p.parent)) {
      const clause = p.parent;
      return { kind: clause.token === ts.SyntaxKind.ImplementsKeyword ? 'IMPLEMENTS' : 'EXTENDS' };
    }
    if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === cur) return { kind: 'USES', extra: { renders: true } };
    if (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p)) return { kind: 'USES', extra: { typeOnly: true } };
    if (ts.isDecorator(p) || (ts.isCallExpression(p) && p.parent && ts.isDecorator(p.parent))) return { kind: 'USES', extra: { decorator: true } };
    return { kind: 'USES' };
  };

  const rootIdentifier = (e: ts.Expression): ts.Identifier | null => {
    let cur: ts.Expression = e;
    while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur))
      cur = cur.expression;
    return ts.isIdentifier(cur) ? cur : null;
  };

  const visit = (node: ts.Node, enclosing: string | null): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
    if (ts.isExportDeclaration(node)) return;

    const own = declMap.get(node);
    if (own && own.path === rel) enclosing = own.localId;

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // require('x') / import('x')
      const a0 = node.arguments[0];
      if (a0 && ts.isStringLiteralLike(a0)) {
        if (ts.isIdentifier(callee) && callee.text === 'require' && node.arguments.length === 1) addImport(a0, a0.text, [{ imported: '*', local: '*' }], 'require', node);
        else if (callee.kind === ts.SyntaxKind.ImportKeyword) addImport(a0, a0.text, [{ imported: '*', local: '*' }], 'dynamic', node);
      }
      // Route registration
      const endpoint = endpointCalls.get(node);
      if (endpoint) {
        visit(callee, enclosing);
        for (const arg of node.arguments.slice(1)) {
          if (ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg)) {
            const nameNode = ts.isIdentifier(arg) ? arg : arg.name;
            const r = resolveSymbol(nameNode);
            if (typeof r === 'object') push('ROUTES_TO', endpoint, r, arg);
            else
              facts.references.push({
                kind: 'ROUTES_TO',
                from: endpoint,
                target: { name: arg.getText(sf) },
                location: loc(arg),
                evidence: lineText(arg),
                method: 'typescript-checker',
                confidence: 0,
                verified: false,
              });
          }
          visit(arg, endpoint);
        }
        return;
      }
      // Data access against a known model
      if (ts.isPropertyAccessExpression(callee)) {
        const m = callee.name.text;
        const root = rootIdentifier(callee.expression);
        const rootRef = root ? resolveSymbol(root) : 'other';
        if (typeof rootRef === 'object' && rootRef.kind === 'DatabaseModel') {
          if (DB_WRITE.test(m)) push('WRITES_TO', enclosing, rootRef, node, { operation: m }, 0.8, false);
          else if (DB_READ.test(m)) push('READS_FROM', enclosing, rootRef, node, { operation: m }, 0.8, false);
        }
        if (/^(from|into|insert|update|delete|join|leftJoin|innerJoin)$/.test(m) && a0 && ts.isIdentifier(a0)) {
          const argRef = resolveSymbol(a0);
          if (typeof argRef === 'object' && argRef.kind === 'DatabaseModel')
            push(/^(from|join|leftJoin|innerJoin)$/.test(m) ? 'READS_FROM' : 'WRITES_TO', enclosing, argRef, node, { operation: m }, 0.8, false);
        }
      }
    }

    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const isDeclName =
        p &&
        (p as { name?: ts.Node }).name === node &&
        (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) ||
          ts.isEnumDeclaration(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) ||
          ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isPropertyAssignment(p) || ts.isEnumMember(p) || ts.isModuleDeclaration(p) ||
          ts.isBindingElement(p) || ts.isTypeParameterDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) ||
          ts.isFunctionExpression(p) || ts.isJsxAttribute(p) || ts.isLabeledStatement(p) || ts.isNamedTupleMember(p));
      if (isDeclName) return;
      const r = resolveSymbol(node);
      const { kind, extra } = classify(node);
      if (typeof r === 'object') {
        const member = (r as SymRef & { member?: boolean }).member;
        push(member && kind === 'CALLS' ? 'USES' : kind, enclosing, r, node, extra);
      } else if (r === 'unknown' && kind === 'CALLS' && p && ts.isCallExpression(p) && p.expression === node && !KNOWN_GLOBALS.has(node.text)) {
        const key = `unresolved|${enclosing}|${node.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          facts.references.push({
            kind: 'CALLS',
            from: enclosing,
            target: { name: node.text },
            location: loc(node),
            evidence: lineText(node),
            method: 'typescript-checker',
            confidence: 0,
            verified: false,
          });
        }
      }
      return;
    }
    ts.forEachChild(node, (c) => visit(c, enclosing));
  };
  visit(sf, null);
}
