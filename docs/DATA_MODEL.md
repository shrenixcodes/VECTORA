# Data model

The knowledge graph is defined in `packages/graph-schema/src/index.ts`. Schema version: 1.

## Node

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Deterministic identifier, unique in the repository |
| `name` | string | Display name |
| `type` | NodeType | One of the types below |
| `repositoryId` | string | Owning repository |
| `filePath` | string or null | Repository-relative path, POSIX separators |
| `location` | SourceLocation or null | `path`, `startLine`, `endLine`, optional columns |
| `description` | string, optional | Doc comment or manifest description |
| `language` | string or null | Language id |
| `metadata` | object | Type-specific details (see below) |
| `extractionMethod` | ExtractionMethod | How the node was found |
| `confidence` | number 0–1 | Extractor confidence |
| `verified` | boolean | `true` for structural facts, `false` for derived interpretations |

### Node types

| Type | What it represents | Identifier |
|---|---|---|
| Repository | The repository root | `repo:root` |
| Directory | A folder containing indexed files | `dir:<path>` |
| Module | A folder that is a package (has `package.json`, `__init__.py`, `mod.rs`, `index.*`, `go.mod`, `Cargo.toml`) | `dir:<path>` |
| File | A source or text file | `file:<path>` |
| Configuration | A file recognised as configuration (manifests, tool configs, CI files) | `file:<path>` |
| Package | An external package, declared in a manifest or imported | `pkg:<name>` |
| Class | Class, struct, record | `sym:<path>#<qualified name>` |
| Interface | Interface, trait | `sym:…` |
| Type | Type alias, enum | `sym:…` |
| Function | Function | `sym:…` |
| Method | Method, constructor, accessor | `sym:…` |
| Variable | Mutable module-level binding | `sym:…` |
| Constant | Constant, macro constant | `sym:…` |
| Component | UI component (a capitalised function returning JSX, or a class extending a component base) | `sym:…` |
| ApiEndpoint | A registered route | `sym:<path>#route:<METHOD> <path>` |
| DatabaseModel | An ORM model or table definition | `sym:…` |
| Subsystem | A group of files derived from the repository layout | `sub:<key>` |
| Concept | A group of files derived from identifier and path evidence | `concept:<key>` |

Qualified names join parent and child with a dot (`NoteService.create`). A second declaration with the same qualified name in one file gets the suffix `~2`.

### Common metadata

- Files: `size`, `lines`, `hash`, `analyzed`, `adapter`, `parseErrors`, `subsystem`, `concepts`, `entryPoint`, `builtinImports`, `test`.
- Symbols: `qualifiedName`, `exported`, `signature`, `decorators`, `async`, `subsystem`.
- Endpoints: `httpMethod`, `routePath`, `framework`, `flowSteps`.
- Packages: `declared`, `version`, `ecosystem`, `dev`.
- Every node: `community` (Louvain community number).

## Relationship (edge)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `<TYPE>|<source>|<target>` |
| `source`, `target` | string | Node ids |
| `type` | EdgeType | One of the types below |
| `evidence` | string | The source line or statement that justifies the relationship |
| `location` | SourceLocation or null | Where the evidence is |
| `extractionMethod` | ExtractionMethod | How it was found |
| `confidence` | number 0–1 | |
| `verified` | boolean | |
| `metadata` | object, optional | e.g. `occurrences`, `lines`, `operation`, `count`, `kinds`, `crossSubsystem` |

The same relationship found several times is one edge; `metadata.occurrences` counts them and `metadata.lines` lists up to 20 line numbers. The first evidence is kept.

### Relationship types

| Type | From → to | Produced by |
|---|---|---|
| CONTAINS | repository → directory/subsystem/concept; directory → file; file → symbol; class → method | file system, grouping |
| DEFINED_IN | nested symbol → its file | file system |
| EXPORTS | file → exported top-level symbol; file → re-exported symbol | adapters |
| IMPORTS | file → file, file → directory (Go package), file → package | adapters and import resolution |
| CALLS | symbol → function or method | type checker, scope resolution, name resolution |
| INSTANTIATES | symbol → class | same |
| EXTENDS | class → class, interface → interface, struct → embedded struct | same |
| IMPLEMENTS | class → interface, type → trait | same |
| USES | symbol → symbol it references without calling (types, values, rendered components) | same |
| ROUTES_TO | endpoint → handler | framework patterns |
| READS_FROM, WRITES_TO | symbol → database model | call patterns on known models; always `verified: false` |
| DEPENDS_ON | manifest → declared package; subsystem → subsystem (aggregated) | manifest, aggregation |
| BELONGS_TO | file → subsystem; file → concept | structural grouping, keyword evidence |
| RELATED_TO | concept ↔ concept | aggregation; `verified: false` |

### Extraction methods

| Method | Meaning | Typical confidence |
|---|---|---|
| `filesystem` | Directory and file structure | 1 |
| `manifest` | Package manifest | 1 |
| `typescript-compiler` | TypeScript syntax (declarations, import statements) | 1 |
| `typescript-checker` | Identifier resolved to its declaration by the type checker | 1 |
| `python-ast`, `tree-sitter` | Syntax tree | 1 for declarations |
| `scope-resolution` | Name resolved through an import or same-file scope | 0.9–0.95 |
| `name-resolution` | Unique name among files visible by language rules (same package, included header) | 0.7, unverified |
| `pattern` | Framework or data-access pattern | 0.7–0.95 |
| `structural-grouping` | Subsystem from layout | 0.9 |
| `keyword-evidence` | Concept from names and paths | 0.4–0.9, unverified |
| `aggregation` | Derived from other edges | varies |

## Unresolved references

A reference that cannot be tied to a definition never becomes an edge. It is recorded as `{ fromPath, fromSymbol, kind, name, line, reason }`, counted in `stats.unresolvedCount`, grouped by reason, and up to 500 samples are stored with the analysis.

## Integrity rules

`validateGraph` checks: unique node ids, unique edge ids, no edge whose endpoints are missing, evidence present on every edge, schema conformance, and reports self-loops (other than recursion) and orphan nodes as warnings. `normalizeGraph` runs before validation: the first node with an id wins, duplicate edges merge, edges with a missing endpoint are dropped, and paths are normalised. The numbers of removed, merged and dropped items are stored with the analysis.

## Persistence

SQLite tables: `repositories`, `nodes (repo_id, id, type, name, file_path, data)`, `edges (repo_id, id, source, target, type, data)`, `file_facts (repo_id, path, hash, facts)`, `sessions`, `settings`, `credentials`, `meta`. The `data` column holds the full JSON of the node or edge; the other columns exist for filtering.
