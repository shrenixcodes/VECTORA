# Architecture

VECTORA is a TypeScript monorepo (npm workspaces) with two applications and seven packages. Packages are consumed as TypeScript source; the engine is bundled with esbuild for release and the web application with Vite.

```
browser ──HTTP (loopback)──► local engine ──► repository indexer ──► language adapters
   │                              │                    │
   │                              ├──► graph engine (SQLite store, algorithms, exports, explorer)
   │                              └──► search
   └── graph-layout (Web Worker), search, graph-schema, shared
```

## Components

### `packages/graph-schema`

The data model: node types, relationship types, extraction methods, source locations, deterministic identifiers, and the functions `validateGraph`, `normalizeGraph` and `computeStats`. Everything else depends on it; it depends only on Zod. See [DATA_MODEL.md](DATA_MODEL.md).

### `packages/language-adapters`

One interface, `LanguageAdapter`, with three implementations:

| Adapter | Languages | Scope | Technique |
|---|---|---|---|
| `typescript` | TypeScript, JavaScript | project | One `ts.Program` for all files; the type checker resolves each identifier to its declaration |
| `python` | Python | file | A helper script using the standard-library `ast` module, run in an isolated interpreter (`python -I`) |
| `tree-sitter` | Java, Go, Rust, C, C++, C# | file | `web-tree-sitter` with grammar WASM files vendored in `grammars/` |

An adapter returns `FileFacts` per file: symbols, imports, references (either resolved to a definition or carrying only a name), and parse issues. A *project* adapter needs every file of its languages at once; a *file* adapter analyses files independently, which makes its results trivially cacheable.

### `packages/repository-indexer`

The pipeline (`pipeline.ts`) and its stages: `scan.ts` (discovery), `manifests.ts` (package manifests, frameworks, declared entry points), `workers.ts` and `analyze-worker.ts` (bounded worker pool), `resolve.ts` (relationship resolution), `organize.ts` (subsystems, concepts, entry points, execution flows). See [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md).

### `packages/graph-engine`

- `store.ts` — SQLite persistence through `node:sqlite`: repositories, nodes, edges, cached per-file facts, sessions, settings, encrypted credentials.
- `algorithms.ts` — adjacency index, traversal, shortest path, Tarjan strongly connected components, impact analysis, Louvain communities.
- `analysis.ts` — the repository analysis record and the overview built from it.
- `exports.ts` — JSON, GraphML, Markdown analysis, architecture documentation.
- `explore.ts` — question exploration over the graph.

See [GRAPH_ENGINE.md](GRAPH_ENGINE.md).

### `packages/graph-layout`

Pure layout functions: `layout3d` (hierarchical, force-refined) and `seed2d`. They take plain data so they can run in a Web Worker. See [VISUALIZATION.md](VISUALIZATION.md).

### `packages/search`

`SearchIndex` ranks nodes by exact name, prefix, partial match, qualified name, path and description, and `searchDocuments` searches documentation text. Used by the engine; importable in the browser.

### `packages/shared`

The settings schema (Zod) with defaults, the API contracts shared by engine and web application, index stage names, and secret redaction for logs.

### `apps/local-engine`

A Fastify server bound to `127.0.0.1`.

- `config.ts` — environment configuration; the data directory defaults to `.vectora-data` inside the installation folder.
- `server.ts` — routes, host and origin checks, security headers, static serving of the built web application.
- `service.ts` — the `Engine` class: imports, a single-file job queue, graph access, source access, exports, sessions, settings, credentials, data deletion.
- `security.ts` — ZIP inspection and extraction, path containment, credential vault.
- `github.ts` — GitHub REST access through Octokit; repositories are downloaded as source archives.
- `provider.ts` — the optional narrative provider adapter.

### `apps/web`

A React 19 single-page application built with Vite and Tailwind CSS 4.

- `lib/api.ts` — typed fetch wrappers and TanStack Query hooks, including progressive graph loading.
- `lib/store.ts` — the Zustand workspace store: selection, hover, focus, expansion, filters, saved layouts.
- `lib/graphView.ts` — `deriveView`, which turns the full graph plus the current filters into what the views render.
- `lib/tokens.ts` and `styles.css` — design tokens.
- `workspace/` — the workspace shell and its views; `components/` — inspector, source preview, command palette, export dialog; `pages/` — landing, import, About.

## How the three views stay in step

1. `useGraph` loads the knowledge graph once per repository into the TanStack Query cache.
2. `WorkspaceLayout` builds one adjacency index and calls `deriveView` with the settings and the workspace store. The result is provided through `WorkspaceContext`.
3. The Graph Explorer and the 3D Atlas render `view.nodes` and `view.edges`. The Mind Map builds its hierarchy from the same adjacency index.
4. Selection, hover, focus and expansion live in the workspace store. Any view that changes them changes them for all views, and the inspector reads the same store.
5. `revealTick` in the store tells whichever view is mounted to bring the primary selection into view.

## Request flow for an import

1. The browser posts to `/api/import/{local|zip|github}` and receives a job.
2. The engine queues the job. Jobs run one at a time so that indexing never competes with itself for memory.
3. The job acquires the source (reads a folder in place, extracts an archive, or downloads one from GitHub), then calls `indexRepository`.
4. The result — graph, analysis, per-file facts — is written to SQLite in one transaction per table.
5. The browser polls `/api/jobs/:id` and opens the workspace when the job completes.

## Build and release layout

`npm run build` produces:

```
dist/web/                    static web application
dist/engine/server.mjs       engine bundle
dist/engine/analyze-worker.mjs
dist/engine/grammars/        Tree-sitter grammars
dist/engine/python/          Python helper
```

`typescript` and `web-tree-sitter` stay external to the bundle because they load files from their own package folders at run time, so `node_modules` must be present next to `dist`.

## Technology decisions

The reasoning behind the main choices (SQLite engine, Sigma version, archive-based GitHub import, vendored grammars, package layout) is recorded in [../DECISIONS.md](../DECISIONS.md).
