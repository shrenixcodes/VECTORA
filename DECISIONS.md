# Technical decisions

Decisions made while building VECTORA 0.1, with the reasoning. Newest last.

## D1 — npm workspaces, TypeScript source exports, one `tsconfig`

pnpm and yarn were not installed; npm workspaces need nothing extra. Packages export their TypeScript source (`"exports": "./src/index.ts"`), so there is no per-package build: `tsx` runs the engine in development, Vite and esbuild bundle for release, and one strict `tsconfig.json` type-checks everything.

## D2 — TypeScript 5.9, not 7

The latest `typescript` on the registry is 7.x, the native rewrite, whose programmatic API differs from the Compiler API that the TypeScript adapter depends on (`ts.createProgram`, the type checker, custom module resolution). TypeScript is pinned to `~5.9.3`, the last line with the classic API. Revisit when the 7.x API is stable and documented.

## D3 — `web-tree-sitter` with vendored grammar WASM files

Native Tree-sitter bindings need a compiler toolchain on Windows. `web-tree-sitter` runs everywhere. The widely used `tree-sitter-wasms` package was tested and does **not** load with `web-tree-sitter` 0.27 (ABI mismatch); the WASM files shipped inside the official grammar packages do. Those six files are vendored in `packages/language-adapters/grammars` (MIT, versions listed in `docs/LICENSES.md`) so installation runs no native build scripts.

## D4 — TypeScript Compiler API with the type checker for TypeScript and JavaScript

The brief asks for precise symbol analysis and forbids assuming a call is resolved because a similarly named symbol exists. The type checker gives exactly that: an identifier becomes a relationship only when the checker ties it to a declaration in the repository. Cost: one compiler program per repository, single-threaded (see `docs/PERFORMANCE.md`). Module resolution is implemented by VECTORA against the indexed file list so the compiler never reads `node_modules`.

## D5 — Python analysed by a helper script, not a JavaScript parser

The brief names the Python AST. A small script using the standard-library `ast` module is run with the system interpreter in isolated mode. Trade-off: Python files are not analysed on machines without Python 3; this is detected and shown.

## D6 — Name-based references resolved only with scope evidence

For Python and the Tree-sitter languages there is no type information. The resolver uses, in order: same-file definitions, import bindings, and language visibility rules (same package, included header), and marks the last kind as unverified at confidence 0.7. Ambiguous names and calls on receivers of unknown type are reported as unresolved. This under-reports relationships on purpose; a wrong edge is worse than a missing one.

## D7 — SQLite through `node:sqlite`, no ORM

`better-sqlite3` needs a native binary; `node:sqlite` ships with Node.js 22.13 and later. It is still labelled experimental by Node.js, which is a risk recorded in `KNOWN_ISSUES.md`; the store is one file behind a small class, so swapping the driver is contained. Drizzle was not added: the schema is eight tables with JSON payloads and a handful of statements, and an ORM would add a dependency without removing code.

## D8 — GitHub repositories downloaded as archives; no git commands

Cloning runs git, and git in an untrusted repository can execute configured programs. Downloading the source archive through the REST API (Octokit) avoids executing anything, keeps the token in a header, and reuses the hardened ZIP path. `simple-git` was therefore not needed and was removed. For local folders the branch name is read from `.git/HEAD` as text.

## D9 — Engine serves the web application; loopback only; host and origin checks instead of a token

One process, one origin, so CORS is not needed in production. Because a local service can be reached by any web page in the user's browser, the engine checks `Host` (DNS rebinding) and `Origin`/`Sec-Fetch-Site` (cross-site requests) on every request.

## D10 — Data directory inside the installation folder by default

At the owner's request nothing is written to the system drive. The database, imported sources, uploads and the credential key default to `.vectora-data` in the VECTORA folder; tests and benchmarks use `.bench-tmp`; the npm cache for this project is `.npm-cache`. `VECTORA_DATA_DIR` overrides the location.

## D11 — Sigma.js 3, not 4

Sigma 4 replaced the reducer-based API (node and edge reducers, settings) that the selection, dimming and label behaviour rely on, and its documentation was not sufficient to build against with confidence. Sigma 3.0.3 is the last release of the documented line and works with Graphology 0.26.

## D12 — Visualisation code lives in `apps/web`, not in separate packages

The brief suggests `visualization-2d`, `visualization-3d`, `mindmap` and `ui` packages. The three views are React components tied to the application's store, context and styling; separate packages would add build configuration without a second consumer. The layout engines, which are pure and reusable, are a package (`graph-layout`).

## D13 — Radix primitives and hand-written components instead of generated shadcn/ui components

shadcn/ui is a set of copied components built on Radix. Its default look (rounded cards, soft shadows) is what the design brief rules out, so the components are written directly on Radix (`Dialog`, `Switch`, `Popover`) and `cmdk`, styled with the project's tokens.

## D14 — Custom 3D layout: anchors plus force refinement

A plain 3D force layout does not produce a readable hierarchy. Subsystems are fixed anchors, files are simulated with `d3-force-3d` under a pull towards their anchor, and symbols are placed analytically around their file. This is deterministic, fast for large symbol counts (symbols need no simulation) and gives the centre → regions → contents structure the brief asks for.

## D15 — Labels in 3D as one projected overlay

drei's `Html` creates a React root per label and logged warnings when labels came and went. Labels are plain elements in one overlay, positioned by projecting node positions during rendered frames.

## D16 — Concepts from a fixed vocabulary with evidence

Concept grouping must be based on source evidence and kept apart from facts. Matching path segments, symbol names and imported packages against a fixed vocabulary is transparent: every membership lists exactly why. It is deliberately simple; it will miss domain concepts outside the vocabulary.

## D17 — Question exploration is deterministic

Questions are answered by intent detection and graph queries, so the basic application needs no external service and every statement has a citation. An optional provider adapter (chat-completions format) can rewrite the finished findings as prose; it is off by default and cannot add findings.

## D18 — Credentials encrypted with a key file

AES-256-GCM with a key stored in the data directory. An operating-system keystore would be stronger but needs a native module or platform commands; that is on the roadmap. The limitation is documented in `docs/SECURITY.md`.

## D19 — Not used from the suggested stack

- **chokidar**: no file watching in 0.1; the brief also rules out continuous background work. Re-indexing is on demand.
- **Comlink**: the two Web Workers have one message type each.
- **p-limit**: the worker pool bounds concurrency itself.
- **Drizzle, simple-git**: see D7 and D8.
- **ELK**: dagre is enough for the tree layout.
- **Tauri**: plan only, in `docs/ROADMAP.md`.

## D20 — Browser tests use the installed Edge and start the engine without a shell

No browser download is needed (`channel: 'msedge'`). The engine is started from the Playwright global setup with a direct process spawn, because shell-based start-up failed on a machine whose `ComSpec` variable was misconfigured. `npm run build` is a Node script for the same reason.

## D21 — Row-id tables for graph rows

The first schema used `WITHOUT ROWID` tables. Benchmarks showed slow bulk inserts with large JSON rows; ordinary tables with a unique index and multi-row inserts are faster. A migration rebuilds old tables.
