/**
 * Tree-sitter adapter for Java, Go, Rust, C, C++ and C#.
 *
 * Extracts declarations, imports, inheritance and call sites from the syntax
 * tree. References are emitted by name only; the indexer decides whether a
 * name can be tied to a definition (same file, imported file or same package)
 * and otherwise reports it as unresolved.
 */
import fs from 'node:fs';
import { Language, type Node, Parser } from 'web-tree-sitter';
import type { EdgeType, NodeType, SourceLocation } from '@vectora/graph-schema';
import { assetPath } from './assets';
import {
  type AnalyzeContext,
  type FileFacts,
  type LanguageAdapter,
  type SourceFileInput,
  emptyFacts,
  evidenceLine,
  uniqueLocalId,
} from './types';

const GRAMMAR_FILES: Record<string, string> = {
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Promise<Language>>();

async function loadLanguage(lang: string): Promise<Language> {
  initPromise ??= Parser.init();
  await initPromise;
  let p = languageCache.get(lang);
  if (!p) {
    const file = GRAMMAR_FILES[lang];
    if (!file) throw new Error(`No grammar for ${lang}`);
    p = Language.load(fs.readFileSync(assetPath('grammars', file)));
    languageCache.set(lang, p);
  }
  return p;
}

const SPRING_MAPPINGS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
  RequestMapping: 'ANY',
};
const ASPNET_ATTRS: Record<string, string> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpDelete: 'DELETE',
  HttpPatch: 'PATCH',
};
const GO_ROUTE_FUNCS = new Set([
  'HandleFunc',
  'Handle',
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'Get',
  'Post',
  'Put',
  'Delete',
  'Patch',
]);

class FileExtractor {
  facts: FileFacts;
  private used = new Set<string>();
  private seen = new Set<string>();
  private lines: string[];

  constructor(
    private file: SourceFileInput,
    private source: string,
  ) {
    this.lines = source.split(/\r?\n/);
    this.facts = emptyFacts(file, 'tree-sitter', this.lines.length);
  }

  loc(n: Node): SourceLocation {
    return {
      path: this.file.path,
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      startColumn: n.startPosition.column,
    };
  }
  evidence(n: Node): string {
    return evidenceLine(this.lines[n.startPosition.row] ?? '');
  }
  /** Leading `//`, `///` or block comment directly above a declaration. */
  doc(n: Node): string | undefined {
    const prev = n.previousNamedSibling;
    if (!prev || !/comment/.test(prev.type) || n.startPosition.row - prev.endPosition.row > 1)
      return undefined;
    const text = prev.text
      .replace(/^\/\*+|\*+\/$/g, '')
      .split('\n')
      .map((l) => l.replace(/^\s*(\/\/[/!]?|\*|#)\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
    if (!text) return undefined;
    return text.length > 300 ? `${text.slice(0, 297)}...` : text;
  }
  symbol(
    n: Node,
    name: string,
    kind: NodeType,
    parent: string | null,
    exported: boolean,
    metadata: Record<string, unknown> = {},
  ): string {
    const localId = uniqueLocalId(this.used, parent ? `${parent}.${name}` : name);
    const description = this.doc(n);
    this.facts.symbols.push({
      localId,
      name,
      kind,
      parent,
      location: this.loc(n),
      exported,
      metadata,
      ...(description ? { description } : {}),
    });
    return localId;
  }
  endpoint(
    n: Node,
    method: string,
    routePath: string,
    handler: string | null,
    handlerName?: { name: string; receiver?: string },
  ): void {
    const p = routePath.startsWith('/') ? routePath : `/${routePath}`;
    const localId = uniqueLocalId(this.used, `route:${method} ${p}`);
    this.facts.symbols.push({
      localId,
      name: `${method} ${p}`,
      kind: 'ApiEndpoint',
      parent: null,
      location: this.loc(n),
      exported: false,
      metadata: { httpMethod: method, routePath: p },
    });
    if (handler) {
      this.facts.references.push({
        kind: 'ROUTES_TO',
        from: localId,
        target: { resolved: { path: this.file.path, localId: handler } },
        location: this.loc(n),
        evidence: this.evidence(n),
        method: 'pattern',
        confidence: 0.95,
        verified: true,
      });
    } else if (handlerName) {
      this.ref('ROUTES_TO', localId, handlerName.name, n, handlerName.receiver);
    }
  }
  ref(
    kind: EdgeType,
    from: string | null,
    name: string,
    n: Node,
    receiver?: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (!name) return;
    const key = `${kind}|${from}|${receiver ?? ''}|${name}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.facts.references.push({
      kind,
      from,
      target: receiver ? { name, receiver } : { name },
      location: this.loc(n),
      evidence: this.evidence(n),
      method: 'tree-sitter',
      confidence: 0,
      verified: false,
      ...(metadata ? { metadata } : {}),
    });
  }
  import(
    n: Node,
    specifier: string,
    names: { imported: string; local: string }[],
    kind: 'static' | 'include' = 'static',
  ): void {
    this.facts.imports.push({ specifier, names, kind, location: this.loc(n), evidence: this.evidence(n) });
  }
}

const field = (n: Node, name: string): Node | null => n.childForFieldName(name);
const named = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c);
const stripQuotes = (s: string): string => s.replace(/^[<"'`]|[>"'`]$/g, '');
const lastSegment = (s: string, sep: string | RegExp): string => s.split(sep).filter(Boolean).pop() ?? s;
const firstString = (n: Node): string | null => {
  const hit = n
    .descendantsOfType([
      'string_literal',
      'interpreted_string_literal',
      'raw_string_literal',
      'string_content',
      'string_literal_content',
    ])
    .find((x) => !!x);
  return hit ? stripQuotes(hit.text) : null;
};

type Walker = (ex: FileExtractor, root: Node) => void;

// ---------------------------------------------------------------------------
// Call collection shared by all languages
// ---------------------------------------------------------------------------

interface CallSpec {
  /** node type -> how to read callee name and receiver */
  calls: Record<string, (n: Node) => { name: string; receiver?: string } | null>;
  news: Record<string, (n: Node) => string | null>;
  /** node types that start a nested declaration handled elsewhere */
  stop: Set<string>;
}

function collectCalls(ex: FileExtractor, body: Node | null, owner: string | null, spec: CallSpec): void {
  if (!body) return;
  const walk = (n: Node, top: boolean) => {
    if (!top && spec.stop.has(n.type)) return;
    const call = spec.calls[n.type];
    if (call) {
      const c = call(n);
      if (c?.name) ex.ref('CALLS', owner, c.name, n, c.receiver);
    }
    const nw = spec.news[n.type];
    if (nw) {
      const t = nw(n);
      if (t) ex.ref('INSTANTIATES', owner, t, n);
    }
    for (const c of n.namedChildren) if (c) walk(c, false);
  };
  walk(body, true);
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

const javaCalls: CallSpec = {
  calls: {
    method_invocation: (n) => {
      const name = field(n, 'name')?.text ?? '';
      const obj = field(n, 'object');
      return { name, receiver: obj ? obj.text.slice(0, 60) : undefined };
    },
  },
  news: {
    object_creation_expression: (n) => lastSegment(field(n, 'type')?.text.replace(/<.*$/, '') ?? '', '.'),
  },
  stop: new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']),
};

function javaAnnotations(n: Node): { name: string; node: Node }[] {
  const mods = named(n).find((c) => c.type === 'modifiers');
  if (!mods) return [];
  return named(mods)
    .filter((c) => c.type === 'marker_annotation' || c.type === 'annotation')
    .map((c) => ({ name: lastSegment(field(c, 'name')?.text ?? '', '.'), node: c }));
}
const javaIsPublic = (n: Node): boolean =>
  !/\bprivate\b/.test(named(n).find((c) => c.type === 'modifiers')?.text ?? '');

const walkJava: Walker = (ex, root) => {
  const visitType = (n: Node, parent: string | null) => {
    const name = field(n, 'name')?.text;
    if (!name) return;
    const ann = javaAnnotations(n);
    const kindBase: NodeType =
      n.type === 'interface_declaration' ? 'Interface' : n.type === 'enum_declaration' ? 'Type' : 'Class';
    const kind: NodeType = ann.some((a) => a.name === 'Entity' || a.name === 'Table' || a.name === 'Document')
      ? 'DatabaseModel'
      : kindBase;
    const id = ex.symbol(n, name, kind, parent, javaIsPublic(n), { annotations: ann.map((a) => a.name) });
    const sup = field(n, 'superclass');
    if (sup)
      for (const t of sup.descendantsOfType('type_identifier')) if (t) ex.ref('EXTENDS', id, t.text, t);
    const ifs = field(n, 'interfaces') ?? named(n).find((c) => c.type === 'extends_interfaces');
    if (ifs)
      for (const t of ifs.descendantsOfType('type_identifier'))
        if (t && t.parent?.type !== 'type_arguments')
          ex.ref(n.type === 'interface_declaration' ? 'EXTENDS' : 'IMPLEMENTS', id, t.text, t);
    const classMapping = ann.find((a) => a.name === 'RequestMapping');
    const basePath = classMapping ? (firstString(classMapping.node) ?? '') : '';
    const body = field(n, 'body');
    if (!body) return;
    for (const m of named(body)) {
      if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
        const mname = field(m, 'name')?.text ?? 'constructor';
        const mann = javaAnnotations(m);
        const mid = ex.symbol(m, mname, 'Method', id, javaIsPublic(m), {
          annotations: mann.map((a) => a.name),
        });
        for (const a of mann) {
          const http = SPRING_MAPPINGS[a.name];
          if (http)
            ex.endpoint(
              a.node,
              http,
              `${basePath}/${firstString(a.node) ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
              mid,
            );
        }
        const params = field(m, 'parameters');
        if (params)
          for (const t of params.descendantsOfType('type_identifier'))
            if (t) ex.ref('USES', mid, t.text, t, undefined, { typeOnly: true });
        collectCalls(ex, field(m, 'body'), mid, javaCalls);
      } else if (m.type === 'field_declaration') {
        const t = field(m, 'type');
        if (t)
          for (const ti of [t, ...t.descendantsOfType('type_identifier')])
            if (ti && ti.type === 'type_identifier')
              ex.ref('USES', id, ti.text, ti, undefined, { typeOnly: true });
        collectCalls(ex, m, id, javaCalls);
      } else if (/_declaration$/.test(m.type) && field(m, 'name')) {
        visitType(m, id);
      }
    }
  };
  for (const n of named(root)) {
    if (n.type === 'package_declaration') {
      ex.facts.moduleName = named(n).find(
        (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
      )?.text;
    } else if (n.type === 'import_declaration') {
      const path =
        named(n).find((c) => c.type === 'scoped_identifier' || c.type === 'identifier')?.text ?? '';
      const wildcard = n.text.includes('*');
      const name = lastSegment(path, '.');
      ex.import(n, wildcard ? `${path}.*` : path, [
        { imported: wildcard ? '*' : name, local: wildcard ? '*' : name },
      ]);
    } else if (/_declaration$/.test(n.type)) {
      visitType(n, null);
    }
  }
};

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

const goCalls: CallSpec = {
  calls: {
    call_expression: (n) => {
      const fn = field(n, 'function');
      if (!fn) return null;
      if (fn.type === 'identifier') return { name: fn.text };
      if (fn.type === 'selector_expression')
        return { name: field(fn, 'field')?.text ?? '', receiver: field(fn, 'operand')?.text };
      return null;
    },
  },
  news: {
    composite_literal: (n) => {
      const t = field(n, 'type');
      return t?.type === 'type_identifier'
        ? t.text
        : t?.type === 'qualified_type'
          ? (field(t, 'name')?.text ?? null)
          : null;
    },
  },
  stop: new Set(),
};
const goExported = (name: string): boolean => /^[A-Z]/.test(name);

const walkGo: Walker = (ex, root) => {
  const goRoutes = (body: Node | null) => {
    if (!body) return;
    for (const call of body.descendantsOfType('call_expression')) {
      if (!call) continue;
      const fn = field(call, 'function');
      if (fn?.type !== 'selector_expression') continue;
      const fname = field(fn, 'field')?.text ?? '';
      if (!GO_ROUTE_FUNCS.has(fname)) continue;
      const args = named(field(call, 'arguments') ?? call);
      const a0 = args[0];
      if (!a0 || !/string_literal/.test(a0.type)) continue;
      const route = stripQuotes(a0.text);
      if (!route.startsWith('/') && !/^[A-Z]+ \//.test(route)) continue;
      const h = args[args.length - 1];
      const method = /^(GET|POST|PUT|DELETE|PATCH)$/i.test(fname) ? fname.toUpperCase() : 'ANY';
      const handlerName =
        h && h !== a0
          ? h.type === 'identifier'
            ? { name: h.text }
            : h.type === 'selector_expression'
              ? { name: field(h, 'field')?.text ?? '', receiver: field(h, 'operand')?.text }
              : undefined
          : undefined;
      ex.endpoint(call, method, route, null, handlerName);
    }
  };
  for (const n of named(root)) {
    switch (n.type) {
      case 'package_clause':
        ex.facts.moduleName = named(n)[0]?.text;
        break;
      case 'import_declaration':
        for (const spec of n.descendantsOfType('import_spec')) {
          if (!spec) continue;
          const p = stripQuotes(field(spec, 'path')?.text ?? '');
          const alias = field(spec, 'name')?.text;
          ex.import(spec, p, [
            { imported: '*', local: alias && alias !== '_' && alias !== '.' ? alias : lastSegment(p, '/') },
          ]);
        }
        break;
      case 'function_declaration': {
        const name = field(n, 'name')?.text;
        if (!name) break;
        const id = ex.symbol(n, name, 'Function', null, goExported(name));
        collectCalls(ex, field(n, 'body'), id, goCalls);
        goRoutes(field(n, 'body'));
        break;
      }
      case 'method_declaration': {
        const name = field(n, 'name')?.text;
        if (!name) break;
        const recv = field(n, 'receiver')?.descendantsOfType('type_identifier')[0]?.text ?? null;
        // Methods are attached to their receiver type when it is declared in this file.
        const parent = recv && ex.facts.symbols.some((s) => s.localId === recv) ? recv : null;
        const id = ex.symbol(n, name, 'Method', parent, goExported(name), { receiver: recv });
        collectCalls(ex, field(n, 'body'), id, goCalls);
        goRoutes(field(n, 'body'));
        break;
      }
      case 'type_declaration':
        for (const spec of named(n)) {
          if (spec.type !== 'type_spec' && spec.type !== 'type_alias') continue;
          const name = field(spec, 'name')?.text;
          if (!name) continue;
          const t = field(spec, 'type');
          const kind: NodeType =
            t?.type === 'interface_type' ? 'Interface' : t?.type === 'struct_type' ? 'Class' : 'Type';
          const tags = t?.type === 'struct_type' && /`[^`]*(gorm|db|bson):/.test(t.text);
          const id = ex.symbol(
            n.namedChildCount === 1 ? n : spec,
            name,
            tags ? 'DatabaseModel' : kind,
            null,
            goExported(name),
            { goKind: t?.type },
          );
          if (t?.type === 'struct_type')
            for (const f of t.descendantsOfType('field_declaration')) {
              if (!f) continue;
              const ft = field(f, 'type');
              const tid = ft?.type === 'type_identifier' ? ft : ft?.descendantsOfType('type_identifier')[0];
              // An embedded field (no name) is Go's form of composition/inheritance.
              if (tid)
                ex.ref(
                  field(f, 'name') ? 'USES' : 'EXTENDS',
                  id,
                  tid.text,
                  tid,
                  undefined,
                  field(f, 'name') ? { typeOnly: true } : { embedded: true },
                );
            }
        }
        break;
      case 'const_declaration':
      case 'var_declaration':
        for (const spec of n.descendantsOfType(n.type === 'const_declaration' ? 'const_spec' : 'var_spec')) {
          if (!spec) continue;
          const name = field(spec, 'name')?.text;
          if (name && name !== '_') {
            const id = ex.symbol(
              spec,
              name,
              n.type === 'const_declaration' ? 'Constant' : 'Variable',
              null,
              goExported(name),
            );
            collectCalls(ex, field(spec, 'value'), id, goCalls);
          }
        }
        break;
      default:
        break;
    }
  }
};

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

const rustCalls: CallSpec = {
  calls: {
    call_expression: (n) => {
      const fn = field(n, 'function');
      if (!fn) return null;
      if (fn.type === 'identifier') return { name: fn.text };
      if (fn.type === 'scoped_identifier')
        return { name: field(fn, 'name')?.text ?? '', receiver: field(fn, 'path')?.text };
      if (fn.type === 'field_expression')
        return { name: field(fn, 'field')?.text ?? '', receiver: field(fn, 'value')?.text.slice(0, 60) };
      return null;
    },
  },
  news: {
    struct_expression: (n) => {
      const t = field(n, 'name');
      return t ? lastSegment(t.text, '::') : null;
    },
  },
  stop: new Set(),
};
const rustPub = (n: Node): boolean => named(n).some((c) => c.type === 'visibility_modifier');

const walkRust: Walker = (ex, root) => {
  const useNames = (n: Node, prefix: string, out: { path: string; name: string; local: string }[]) => {
    switch (n.type) {
      case 'identifier':
      case 'crate':
      case 'self':
      case 'super':
        out.push({ path: prefix ? `${prefix}::${n.text}` : n.text, name: n.text, local: n.text });
        break;
      case 'scoped_identifier':
        out.push({
          path: prefix ? `${prefix}::${n.text}` : n.text,
          name: field(n, 'name')?.text ?? '',
          local: field(n, 'name')?.text ?? '',
        });
        break;
      case 'use_as_clause': {
        const p = field(n, 'path');
        const alias = field(n, 'alias')?.text ?? '';
        if (p)
          out.push({
            path: prefix ? `${prefix}::${p.text}` : p.text,
            name: lastSegment(p.text, '::'),
            local: alias,
          });
        break;
      }
      case 'use_wildcard': {
        const inner = named(n)[0]?.text ?? '';
        out.push({ path: [prefix, inner].filter(Boolean).join('::'), name: '*', local: '*' });
        break;
      }
      case 'scoped_use_list': {
        const p = field(n, 'path')?.text ?? '';
        const list = field(n, 'list');
        if (list) for (const c of named(list)) useNames(c, [prefix, p].filter(Boolean).join('::'), out);
        break;
      }
      case 'use_list':
        for (const c of named(n)) useNames(c, prefix, out);
        break;
      default:
        break;
    }
  };
  const attrsBefore = (n: Node): string[] => {
    const out: string[] = [];
    let p = n.previousNamedSibling;
    while (p && (p.type === 'attribute_item' || /comment/.test(p.type))) {
      if (p.type === 'attribute_item') out.push(p.text);
      p = p.previousNamedSibling;
    }
    return out;
  };
  const visitFn = (n: Node, parent: string | null, kind: NodeType) => {
    const name = field(n, 'name')?.text;
    if (!name) return;
    const attrs = attrsBefore(n);
    const id = ex.symbol(
      n,
      name,
      kind,
      parent,
      rustPub(n),
      attrs.length ? { attributes: attrs.map((a) => a.slice(0, 80)) } : {},
    );
    for (const a of attrs) {
      const m = /#\[\s*(get|post|put|delete|patch)\s*\(\s*"([^"]+)"/i.exec(a);
      if (m) ex.endpoint(n, m[1]!.toUpperCase(), m[2]!, id);
    }
    collectCalls(ex, field(n, 'body'), id, rustCalls);
  };
  const visitItems = (items: Node[], prefix: string | null) => {
    for (const n of items) {
      switch (n.type) {
        case 'use_declaration': {
          const arg = field(n, 'argument');
          if (!arg) break;
          const out: { path: string; name: string; local: string }[] = [];
          useNames(arg, '', out);
          for (const u of out) ex.import(n, u.path, [{ imported: u.name, local: u.local }]);
          break;
        }
        case 'mod_item': {
          const name = field(n, 'name')?.text;
          const body = field(n, 'body');
          if (name && !body) ex.import(n, `self::${name}`, [{ imported: '*', local: name }]);
          else if (name && body) visitItems(named(body), prefix ? `${prefix}.${name}` : name);
          break;
        }
        case 'function_item':
          visitFn(n, prefix, 'Function');
          break;
        case 'struct_item':
        case 'enum_item':
        case 'union_item': {
          const name = field(n, 'name')?.text;
          if (!name) break;
          const attrs = attrsBefore(n).join(' ');
          const model =
            /derive\([^)]*(Queryable|Insertable|FromRow|Model|Entity)/.test(attrs) ||
            /#\[\s*(table_name|sea_orm|diesel)/.test(attrs);
          const id = ex.symbol(
            n,
            name,
            model ? 'DatabaseModel' : n.type === 'struct_item' ? 'Class' : 'Type',
            prefix,
            rustPub(n),
            { rustKind: n.type.replace('_item', '') },
          );
          const body = field(n, 'body');
          if (body)
            for (const t of body.descendantsOfType('type_identifier'))
              if (t) ex.ref('USES', id, t.text, t, undefined, { typeOnly: true });
          break;
        }
        case 'trait_item': {
          const name = field(n, 'name')?.text;
          if (!name) break;
          const id = ex.symbol(n, name, 'Interface', prefix, rustPub(n));
          const body = field(n, 'body');
          if (body)
            for (const f of named(body))
              if (f.type === 'function_item' || f.type === 'function_signature_item')
                visitFn(f, id, 'Method');
          break;
        }
        case 'impl_item': {
          const typeNode = field(n, 'type');
          const typeName = typeNode ? lastSegment(typeNode.text.replace(/<.*$/, ''), '::') : null;
          const traitNode = field(n, 'trait');
          const owner =
            typeName &&
            ex.facts.symbols.some((s) => s.localId === (prefix ? `${prefix}.${typeName}` : typeName))
              ? prefix
                ? `${prefix}.${typeName}`
                : typeName
              : null;
          if (traitNode && typeName) {
            const traitName = lastSegment(traitNode.text.replace(/<.*$/, ''), '::');
            if (owner) ex.ref('IMPLEMENTS', owner, traitName, traitNode);
          }
          const body = field(n, 'body');
          if (body)
            for (const f of named(body))
              if (f.type === 'function_item') visitFn(f, owner, owner ? 'Method' : 'Function');
          break;
        }
        case 'const_item':
        case 'static_item': {
          const name = field(n, 'name')?.text;
          if (name) ex.symbol(n, name, 'Constant', prefix, rustPub(n));
          break;
        }
        case 'type_item': {
          const name = field(n, 'name')?.text;
          if (name) ex.symbol(n, name, 'Type', prefix, rustPub(n));
          break;
        }
        default:
          break;
      }
    }
  };
  visitItems(named(root), null);
};

// ---------------------------------------------------------------------------
// C / C++
// ---------------------------------------------------------------------------

const cCalls: CallSpec = {
  calls: {
    call_expression: (n) => {
      const fn = field(n, 'function');
      if (!fn) return null;
      if (fn.type === 'identifier') return { name: fn.text };
      if (fn.type === 'field_expression')
        return { name: field(fn, 'field')?.text ?? '', receiver: field(fn, 'argument')?.text.slice(0, 60) };
      if (fn.type === 'qualified_identifier')
        return { name: lastSegment(fn.text, '::'), receiver: fn.text.split('::').slice(0, -1).join('::') };
      if (fn.type === 'template_function') return { name: field(fn, 'name')?.text ?? '' };
      return null;
    },
  },
  news: {
    new_expression: (n) => {
      const t = field(n, 'type');
      return t ? lastSegment(t.text.replace(/<.*$/, ''), '::') : null;
    },
  },
  stop: new Set(['class_specifier', 'struct_specifier']),
};

/** Finds the declared name inside nested declarators (pointers, references, functions). */
function declaratorName(d: Node | null): { name: string; scope: string | null; isFunction: boolean } | null {
  let cur = d;
  let isFunction = false;
  for (let i = 0; cur && i < 8; i++) {
    if (cur.type === 'function_declarator') isFunction = true;
    if (
      cur.type === 'identifier' ||
      cur.type === 'field_identifier' ||
      cur.type === 'type_identifier' ||
      cur.type === 'destructor_name' ||
      cur.type === 'operator_name'
    )
      return { name: cur.text, scope: null, isFunction };
    if (cur.type === 'qualified_identifier') {
      const parts = cur.text.split('::');
      return { name: parts.pop() ?? cur.text, scope: parts.join('::') || null, isFunction };
    }
    cur = field(cur, 'declarator') ?? named(cur).find((c) => /declarator|identifier/.test(c.type)) ?? null;
  }
  return null;
}

const walkC: Walker = (ex, root) => {
  const isHeader = /\.(h|hh|hpp|hxx)$/.test(ex.facts.path);
  const visit = (items: Node[], parent: string | null, ns: string | null) => {
    for (const n of items) {
      switch (n.type) {
        case 'preproc_include': {
          const p = field(n, 'path');
          if (p) ex.import(n, stripQuotes(p.text), [{ imported: '*', local: '*' }], 'include');
          if (p && p.type === 'system_lib_string')
            ex.facts.imports[ex.facts.imports.length - 1]!.externalPackage = stripQuotes(p.text);
          break;
        }
        case 'preproc_def': {
          const name = field(n, 'name')?.text;
          if (name && field(n, 'value')) ex.symbol(n, name, 'Constant', parent, true, { macro: true });
          break;
        }
        case 'preproc_function_def': {
          const name = field(n, 'name')?.text;
          if (name) ex.symbol(n, name, 'Function', parent, true, { macro: true });
          break;
        }
        case 'preproc_ifdef':
        case 'preproc_if':
        case 'preproc_else':
        case 'preproc_elif':
        case 'linkage_specification':
        case 'declaration_list':
          visit(named(n), parent, ns);
          break;
        case 'namespace_definition': {
          const name = field(n, 'name')?.text ?? null;
          const body = field(n, 'body');
          if (body) visit(named(body), parent, name ? (ns ? `${ns}::${name}` : name) : ns);
          if (name) ex.facts.moduleName ??= name;
          break;
        }
        case 'template_declaration':
          visit(
            named(n).filter((c) => c.type !== 'template_parameter_list'),
            parent,
            ns,
          );
          break;
        case 'function_definition': {
          const d = declaratorName(field(n, 'declarator'));
          if (!d) break;
          // `Foo::bar` defined out of line belongs to class Foo when Foo is declared in this file.
          const owner = d.scope ? lastSegment(d.scope, '::') : null;
          const ownerId = owner && ex.facts.symbols.some((s) => s.localId === owner) ? owner : parent;
          const id = ex.symbol(
            n,
            d.name,
            ownerId || d.scope ? 'Method' : 'Function',
            ownerId,
            !/\bstatic\b/.test(n.text.slice(0, 40)),
            d.scope ? { scope: d.scope } : {},
          );
          collectCalls(ex, field(n, 'body'), id, cCalls);
          break;
        }
        case 'class_specifier':
        case 'struct_specifier':
        case 'union_specifier': {
          const name = field(n, 'name')?.text;
          const body = field(n, 'body');
          if (!name || !body) break;
          const id = ex.symbol(n, name, 'Class', parent, true, {
            cKind: n.type.replace('_specifier', ''),
            ...(ns ? { namespace: ns } : {}),
          });
          const bases = named(n).find((c) => c.type === 'base_class_clause');
          if (bases)
            for (const b of named(bases))
              if (
                b.type === 'type_identifier' ||
                b.type === 'qualified_identifier' ||
                b.type === 'template_type'
              )
                ex.ref('EXTENDS', id, lastSegment(b.text.replace(/<.*$/, ''), '::'), b);
          for (const m of named(body)) {
            if (m.type === 'function_definition') {
              const d = declaratorName(field(m, 'declarator'));
              if (d) {
                const mid = ex.symbol(m, d.name, 'Method', id, true);
                collectCalls(ex, field(m, 'body'), mid, cCalls);
              }
            } else if (m.type === 'declaration' || m.type === 'field_declaration') {
              const d = declaratorName(field(m, 'declarator'));
              if (d?.isFunction) ex.symbol(m, d.name, 'Method', id, true, { declarationOnly: true });
              const t = field(m, 'type');
              if (t?.type === 'type_identifier') ex.ref('USES', id, t.text, t, undefined, { typeOnly: true });
            } else if (/_specifier$/.test(m.type)) {
              visit([m], id, ns);
            }
          }
          break;
        }
        case 'enum_specifier': {
          const name = field(n, 'name')?.text;
          if (name && field(n, 'body')) ex.symbol(n, name, 'Type', parent, true, { enum: true });
          break;
        }
        case 'type_definition': {
          const d = declaratorName(field(n, 'declarator'));
          const t = field(n, 'type');
          if (t && /_specifier$/.test(t.type) && field(t, 'body') && field(t, 'name')) visit([t], parent, ns);
          else if (d)
            ex.symbol(
              n,
              d.name,
              t && /struct|union/.test(t.type) && field(t, 'body') ? 'Class' : 'Type',
              parent,
              true,
            );
          break;
        }
        case 'alias_declaration': {
          const name = field(n, 'name')?.text;
          if (name) ex.symbol(n, name, 'Type', parent, true);
          break;
        }
        case 'declaration': {
          const t = field(n, 'type');
          if (t && /_specifier$/.test(t.type) && field(t, 'body')) visit([t], parent, ns);
          const d = declaratorName(field(n, 'declarator'));
          if (!d) break;
          if (d.isFunction) {
            // Prototypes are recorded for headers only; the definition carries the body.
            if (isHeader) ex.symbol(n, d.name, 'Function', parent, true, { declarationOnly: true });
          } else if (!parent) {
            const id = ex.symbol(
              n,
              d.name,
              /\bconst\b/.test(n.text.slice(0, 60)) ? 'Constant' : 'Variable',
              parent,
              !/\bstatic\b/.test(n.text.slice(0, 40)),
            );
            collectCalls(ex, n, id, cCalls);
          }
          break;
        }
        default:
          break;
      }
    }
  };
  visit(named(root), null, null);
};

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

const csCalls: CallSpec = {
  calls: {
    invocation_expression: (n) => {
      const fn = field(n, 'function');
      if (!fn) return null;
      if (fn.type === 'identifier') return { name: fn.text };
      if (fn.type === 'generic_name') return { name: named(fn)[0]?.text ?? '' };
      if (fn.type === 'member_access_expression') {
        const nm = field(fn, 'name');
        return {
          name: nm?.type === 'generic_name' ? (named(nm)[0]?.text ?? '') : (nm?.text ?? ''),
          receiver: field(fn, 'expression')?.text.slice(0, 60),
        };
      }
      return null;
    },
  },
  news: {
    object_creation_expression: (n) => {
      const t = field(n, 'type');
      return t ? lastSegment(t.text.replace(/<.*$/, ''), '.') : null;
    },
  },
  stop: new Set(['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration']),
};

function csAttributes(n: Node): { name: string; node: Node }[] {
  return named(n)
    .filter((c) => c.type === 'attribute_list')
    .flatMap((l) => named(l).filter((a) => a.type === 'attribute'))
    .map((a) => ({
      name: lastSegment(field(a, 'name')?.text ?? '', '.').replace(/Attribute$/, ''),
      node: a,
    }));
}
const csPublic = (n: Node): boolean =>
  named(n).some((c) => c.type === 'modifier' && /public|internal/.test(c.text));

const walkCSharp: Walker = (ex, root) => {
  const visit = (items: Node[], parent: string | null) => {
    for (const n of items) {
      switch (n.type) {
        case 'using_directive': {
          const nm = named(n).find((c) => c.type === 'qualified_name' || c.type === 'identifier');
          if (nm) ex.import(n, nm.text, [{ imported: '*', local: '*' }]);
          break;
        }
        case 'namespace_declaration':
        case 'file_scoped_namespace_declaration': {
          ex.facts.moduleName ??= field(n, 'name')?.text;
          const body = field(n, 'body');
          visit(body ? named(body) : named(n), parent);
          break;
        }
        case 'class_declaration':
        case 'struct_declaration':
        case 'interface_declaration':
        case 'record_declaration':
        case 'enum_declaration': {
          const name = field(n, 'name')?.text;
          if (!name) break;
          const attrs = csAttributes(n);
          const baseList = named(n).find((c) => c.type === 'base_list');
          const bases = baseList
            ? named(baseList).map((b) => lastSegment(b.text.replace(/<.*$/, ''), '.'))
            : [];
          let kind: NodeType =
            n.type === 'interface_declaration'
              ? 'Interface'
              : n.type === 'enum_declaration'
                ? 'Type'
                : 'Class';
          if (attrs.some((a) => a.name === 'Table' || a.name === 'Entity') || bases.includes('DbContext'))
            kind = 'DatabaseModel';
          const id = ex.symbol(n, name, kind, parent, csPublic(n), { attributes: attrs.map((a) => a.name) });
          if (baseList)
            named(baseList).forEach((b, i) => {
              const bn = lastSegment(b.text.replace(/<.*$/, ''), '.');
              // By convention interface names start with `I` followed by an upper-case letter.
              const isInterface = /^I[A-Z]/.test(bn);
              ex.ref(
                n.type === 'interface_declaration' || (!isInterface && i === 0) ? 'EXTENDS' : 'IMPLEMENTS',
                id,
                bn,
                b,
              );
            });
          const routeAttr = attrs.find((a) => a.name === 'Route');
          const basePath = routeAttr ? (firstString(routeAttr.node) ?? '') : '';
          const body = field(n, 'body');
          if (!body) break;
          for (const m of named(body)) {
            if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
              const mname = field(m, 'name')?.text ?? 'constructor';
              const mattrs = csAttributes(m);
              const mid = ex.symbol(m, mname, 'Method', id, csPublic(m), {
                attributes: mattrs.map((a) => a.name),
              });
              for (const a of mattrs) {
                const http = ASPNET_ATTRS[a.name];
                if (http)
                  ex.endpoint(
                    a.node,
                    http,
                    `${basePath}/${firstString(a.node) ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
                    mid,
                  );
              }
              collectCalls(ex, field(m, 'body') ?? m, mid, csCalls);
            } else if (m.type === 'property_declaration' || m.type === 'field_declaration') {
              const t =
                field(m, 'type') ??
                m.descendantsOfType('variable_declaration')[0]?.childForFieldName('type') ??
                null;
              if (t && (t.type === 'identifier' || t.type === 'generic_name'))
                for (const idn of t.type === 'identifier' ? [t] : t.descendantsOfType('identifier'))
                  if (idn) ex.ref('USES', id, idn.text, idn, undefined, { typeOnly: true });
              collectCalls(ex, m, id, csCalls);
            } else if (/_declaration$/.test(m.type)) {
              visit([m], id);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  };
  visit(named(root), null);
};

const WALKERS: Record<string, Walker> = {
  java: walkJava,
  go: walkGo,
  rust: walkRust,
  c: walkC,
  cpp: walkC,
  csharp: walkCSharp,
};

export function createTreeSitterAdapter(): LanguageAdapter {
  return {
    id: 'tree-sitter',
    technique: 'Tree-sitter syntax trees',
    scope: 'file',
    languages: [
      { id: 'java', name: 'Java', tier: 2, extensions: ['.java'] },
      { id: 'go', name: 'Go', tier: 2, extensions: ['.go'] },
      { id: 'rust', name: 'Rust', tier: 2, extensions: ['.rs'] },
      { id: 'c', name: 'C', tier: 2, extensions: ['.c', '.h'] },
      { id: 'cpp', name: 'C++', tier: 2, extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'] },
      { id: 'csharp', name: 'C#', tier: 2, extensions: ['.cs'] },
    ],
    async analyze(files: SourceFileInput[], ctx: AnalyzeContext): Promise<FileFacts[]> {
      const out: FileFacts[] = [];
      const parsers = new Map<string, Parser>();
      let done = 0;
      for (const file of files) {
        let facts = emptyFacts(file, 'tree-sitter');
        try {
          const walker = WALKERS[file.language];
          if (!walker) throw new Error(`Unsupported language ${file.language}`);
          let parser = parsers.get(file.language);
          if (!parser) {
            const language = await loadLanguage(file.language);
            parser = new Parser();
            parser.setLanguage(language);
            parsers.set(file.language, parser);
          }
          const source = fs.readFileSync(file.absPath, 'utf8');
          const tree = parser.parse(source);
          if (!tree) throw new Error('Parser returned no tree');
          try {
            const ex = new FileExtractor(file, source);
            walker(ex, tree.rootNode);
            facts = ex.facts;
            if (tree.rootNode.hasError) {
              const err = tree.rootNode.descendantsOfType('ERROR')[0];
              facts.errors.push({
                path: file.path,
                message: 'Syntax errors found; extraction may be incomplete',
                line: err ? err.startPosition.row + 1 : undefined,
                severity: 'warning',
              });
            }
          } finally {
            tree.delete();
          }
        } catch (err) {
          facts.errors.push({
            path: file.path,
            message: `Analysis failed: ${(err as Error).message}`,
            severity: 'error',
          });
        }
        out.push(facts);
        done++;
        if (done % 50 === 0 || done === files.length) ctx.onProgress?.(done, files.length);
      }
      for (const p of parsers.values()) p.delete();
      return out;
    },
  };
}
