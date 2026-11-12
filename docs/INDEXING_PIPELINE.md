# Indexing pipeline

`indexRepository` in `packages/repository-indexer/src/pipeline.ts` runs the stages below and reports progress per stage. The engine shows these stages on the import screen: acquire, discover, analyse, resolve, flows, organise, graph, persist.

Nothing in the analysed repository is ever executed, and its dependencies are never installed.

## Stage 1 — Discovery (`scan.ts`, `manifests.ts`)

1. All files are listed with `fast-glob`. `node_modules` and version-control folders are never entered. Symbolic links are not followed and are skipped.
2. Ignore rules are applied: the patterns from Settings and every `.gitignore` in the tree, each relative to its own folder.
3. Files are skipped, and counted by reason, when they have a binary extension, contain a NUL byte in the first 8 KB, exceed the size limit (512 KB by default), or look generated or minified.
4. Each remaining file is read once to compute a SHA-1 content hash and a line count. The language is detected from the extension or file name.
5. If the repository exceeds the file limit, analysable source files are kept in preference to others and the result is marked as truncated.
6. Manifests are parsed as data: `package.json`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `*.csproj`. They yield declared dependencies (with manifest line), workspace packages, frameworks, declared entry points and a description. Without a manifest description the first paragraph of the root README is used.

## Stage 2 — Syntax analysis (`workers.ts`, language adapters)

Files are grouped by adapter.

- **File-scope adapters** (Python, Tree-sitter): a file whose hash matches the cache reuses its cached facts. The rest are batched (150 files) and analysed in worker threads; Python batches run in a separate, isolated interpreter process.
- **Project-scope adapter** (TypeScript/JavaScript): one task builds a `ts.Program` over all TypeScript and JavaScript files. Module resolution is done by VECTORA against the list of indexed files only (relative paths, `tsconfig` path aliases, workspace packages), so the compiler never reads outside the repository except for its own library definitions.

Workers are bounded by the *Indexing workers* setting. If a worker cannot start, analysis falls back to the main process. A file that fails to parse is reported under parse issues and remains in the graph as a file without symbols.

### What is extracted

Classes, functions, methods, interfaces, types, enums, variables, constants, components, database models, API endpoints; imports and re-exports; calls, instantiations, inheritance, interface implementation, type and value uses; decorators, annotations and attributes; doc comments and signatures.

Framework patterns recognised:

| Kind | Patterns |
|---|---|
| API endpoints | `app.get('/x', …)` style router calls, `@Get()`/`@Controller()` decorators, Next.js `app/**/route.ts` exports, Flask/FastAPI decorators, Django `urlpatterns`, Spring `@GetMapping` etc., ASP.NET `[HttpGet]`, Go `HandleFunc`/router methods, Rust `#[get("/x")]` |
| Database models | Classes extending model bases or carrying entity decorators, Drizzle table factories, Mongoose/Sequelize definitions, SQLAlchemy/Django models, `@Entity`, GORM struct tags, Diesel/SeaORM derives, `[Table]`/`DbContext` |
| Components | Capitalised functions that return JSX, wrapped components (`memo`, `forwardRef`), classes extending `Component` |

## Stage 3 — Relationship resolution (`resolve.ts`)

Facts become nodes and edges.

**TypeScript and JavaScript.** The adapter has already resolved references with the type checker. An identifier becomes an edge only when the checker ties it to a declaration inside the repository. Imports of external packages become edges to Package nodes. A call the checker cannot tie to anything is recorded as unresolved.

**Other languages.** The resolver builds, per file, a table of import bindings and a list of files visible without qualification, using each language's own rules:

| Language | Import resolution | Visible without import |
|---|---|---|
| Python | Relative imports exactly; absolute imports by dotted-path suffix, nearest match | `from x import *` targets |
| Java | Package declaration plus class name | Same package, wildcard imports |
| Go | `go.mod` module path plus directory | Same directory and package |
| Rust | `crate::`, `self::`, `super::` paths to `x.rs` or `x/mod.rs` | Glob imports |
| C, C++ | `#include "x"` relative, else a unique path suffix | Included files |
| C# | `using` namespace to files declaring it | Same namespace |

A name is then resolved in this order: a symbol in the same file (`scope-resolution`, 0.95); an import binding that leads to a file containing the symbol (`scope-resolution`, 0.9); a unique symbol among the visible files (`name-resolution`, 0.7, marked unverified). For languages with an implicit receiver, an unqualified call may resolve to a member of the enclosing type. `self.x()` / `this.x()` resolve to a member of the enclosing class if it exists.

**What is never done:** a name is not resolved merely because a symbol with that name exists somewhere in the repository. If several visible definitions match, the reference is ambiguous and stays unresolved. Calls on receivers whose type is unknown stay unresolved. Calls into imported external packages are known to be external and are not counted.

**Data access.** A call on, or passing, a symbol that resolved to a database model, with a method name that reads or writes, produces `READS_FROM` or `WRITES_TO`. These are always marked unverified.

## Stage 4 — Execution flows (`organize.ts`)

- **Entry points:** files named by manifests (`main`, `bin`, start scripts), files defining a `main` function, and conventional entry files that nothing imports.
- **Flows:** from each API endpoint and each entry point, route and call relationships are followed breadth-first (up to 8 steps) to the first data access, or otherwise to the deepest reachable symbol. Flows are stored with the analysis and marked as derived.
- Relationships that cross a subsystem boundary are flagged.

## Stage 5 — Semantic organisation (`organize.ts`)

- **Subsystems** come from layout: workspace packages when there are at least two, otherwise the folders below the source root (wrapper folders such as `src/` that hold nearly everything are descended into). Every file belongs to exactly one subsystem. Dependencies between subsystems are aggregated into `DEPENDS_ON` edges whose evidence names the count and one concrete example.
- **Concepts** come from evidence in path segments, symbol names and imported package names, matched against a fixed vocabulary (authentication, data storage, API layer, and so on), plus structural evidence such as “defines an endpoint”. A file joins a concept when its evidence score reaches a threshold; a concept exists when at least two files join it. Concept nodes and memberships are marked unverified and carry their evidence text.
- **Communities** are computed with the Louvain method on the dependency graph with a fixed seed, and stored as `metadata.community`.

Interpretations are never mixed into facts: subsystem, concept and community information is additional nodes, edges and metadata, each labelled with its extraction method.

## Stage 6 — Graph generation

`normalizeGraph` removes duplicate nodes, merges duplicate edges and drops edges with a missing endpoint. `validateGraph` checks integrity. Statistics and language coverage are computed. The analysis record stores everything a user may want to audit: skipped files by reason, parse issues, unresolved references by reason with samples, validation and normalisation results.

## Stage 7 — Persistence

The engine writes the graph, the analysis and the per-file facts to SQLite. See [GRAPH_ENGINE.md](GRAPH_ENGINE.md).

## Incremental indexing

On re-index, the cached facts of the previous run are passed in.

- File-scope adapters re-analyse only files whose hash changed.
- For TypeScript and JavaScript, the files to re-analyse are: changed files; files whose cached imports or resolved references point into a changed or deleted file; and, when files were added, files with unresolved imports or references (a new file may now satisfy them). If that set is empty the compiler is not started at all. Otherwise a program is still created over all files, because the checker needs every declaration, but only the files in the set are walked.
- Resolution, organisation and graph generation always run over the full set of facts, so the graph never contains relationships left over from an earlier state of a file.

The cache can be switched off or cleared in Settings, and a full re-index can be requested through the API (`{ "full": true }`).

## Adding a language

Implement `LanguageAdapter` (`id`, `technique`, `languages`, `scope`, `analyze`) and register it in `createAdapters`. If the adapter emits unresolved names, add the language's import and visibility rules to `resolve.ts`. Add fixture files to the sample repository and assertions to `tests/unit/indexing.test.ts`.
