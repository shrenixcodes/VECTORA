# Implementation checklist

Status against the master directive. `[x]` done and verified, `[~]` partly done (see note), `[ ]` not done. Notes point to `KNOWN_ISSUES.md` (K) and `DECISIONS.md` (D).

## Phase 0 — Research and architecture

- [x] Inspect workspace and toolchain (empty repository; Node 24.14.1, Python 3.13, no pnpm)
- [x] Check current versions and compatibility of every dependency (D2, D3, D11)
- [x] Validate licences (`docs/LICENSES.md`; one package without declared licence, K29)
- [x] Architecture, design system, decisions documented

## Phase 1 — Foundation

- [x] Monorepo, strict TypeScript, ESLint, Prettier
- [x] Vite, Tailwind CSS 4, React 19, React Router, TanStack Query, Zustand
- [x] Typography: Zen Kaku Gothic New, Shippori Mincho, IBM Plex Mono, bundled
- [x] Light, dark and system themes with centralised tokens
- [x] Routing and application shell
- [~] shadcn/ui: Radix primitives used directly with hand-written components (D13)

## Phase 2 — Repository ingestion

- [x] GitHub import: public, private with token, validation, branch selection, subdirectory
- [x] ZIP import: format validation, nested root detection, structure preview, exclusions
- [x] Local folder import with folder browser, `.gitignore` and configurable exclusions
- [x] Import progress with stages
- [x] File scanning, language detection, manifest and framework detection, entry points
- [x] Bundled, labelled sample repository

## Phase 3 — Code intelligence

- [x] Tree-sitter (Java, Go, Rust, C, C++, C#)
- [x] TypeScript Compiler API with type checker (TypeScript, JavaScript)
- [x] Python `ast`
- [x] Language-adapter interface: parsing, symbols, relationships, locations, errors, metadata
- [x] Symbols: classes, functions, methods, interfaces, types, variables, constants, decorators, components, endpoints, models
- [x] Relationships: IMPORTS, EXPORTS, CALLS, EXTENDS, IMPLEMENTS, USES, INSTANTIATES, ROUTES_TO, READS_FROM, WRITES_TO, DEFINED_IN, BELONGS_TO, CONTAINS, DEPENDS_ON, RELATED_TO
- [x] Unresolved references reported, never guessed
- [x] Execution flows: entry points, route handlers, data-access paths, cross-subsystem calls
- [x] Graph validation, duplicate detection, normalisation, integrity checks
- [x] Unsupported files do not fail indexing; language coverage displayed
- [~] Receiver-type inference outside TypeScript (K1, K2); mounted route prefixes (K4)

## Phase 4 — Knowledge graph

- [x] Typed schema: 18 node types, 15 relationship types, evidence, method, confidence
- [x] Graph engine: adjacency, traversal, shortest path, cycles, impact
- [x] Persistence in SQLite
- [x] Community detection (Louvain), subsystems, concepts
- [x] Incremental indexing with cache and unchanged fast path
- [x] Search: names, partial matches, paths, qualified names, descriptions, documentation

## Phase 5 — 2D Graph Explorer

- [x] Sigma.js with Graphology, ForceAtlas2 in a worker, no-overlap pass
- [x] Pan, zoom, fit, minimap, node drag
- [x] Selection, multi-selection, neighbour highlighting, dimming, inspector
- [x] Filtering, focus mode, neighbour expansion, community grouping, zoom-dependent labels
- [x] Search integration
- [~] Node shapes by type in 2D (glyph, size and label instead; K17)

## Phase 6 — 3D Atlas

- [x] Real 3D scene (Three.js, React Three Fiber, drei)
- [x] Spatial clusters: repository centre, subsystem regions, files and symbols within, concepts and packages in layers
- [x] Orbit, pan, zoom, click, double-click, hover, search-to-focus, breadcrumb, reset, focus subsystem, neighbourhood, global view
- [x] Smooth camera transitions with reduced-motion alternative; exit from focus mode
- [x] InstancedMesh, BufferGeometry, worker layout, level of detail, label culling, on-demand rendering
- [x] WebGL context loss handling and 2D fallback
- [~] Performance verified by measurement in the browser (not measured; K14)

## Phase 7 — Mind Map

- [x] Hierarchy generated from the same graph
- [x] Expand, collapse, reorganise, search, focus, navigate to graph nodes, inspect source
- [x] Filter by relationship (overlay)
- [x] Export SVG and PNG

## Phase 8 — Exploration and documentation

- [x] Inspector: all twelve items, CodeMirror 6 preview, copy actions, focus, expand, resize, collapse
- [x] Command palette: Ctrl/Cmd+K, Escape, Enter
- [x] Question exploration with file and line evidence; says so when it cannot verify
- [x] Provider-independent adapter for optional narrative, off by default (not exercised live; K32)
- [x] About page: philosophy, how it works, languages, privacy, credits, version, licence, changelog and documentation references
- [x] Settings: appearance, graph, performance, repository, privacy — persisted and effective
- [x] Exports: JSON, GraphML, SVG, PNG, Markdown analysis, architecture document; layouts and sessions saved and restored
- [x] No source text in exports unless requested
- [x] User-facing copy free of excluded terminology (checked by a test)

## Phase 9 — Testing

- [x] Unit tests: scanning, ignore handling, extraction, resolution, validation, clustering, search, persistence, export
- [x] Integration tests: ZIP, GitHub (stand-in API), local import, full indexing, graph generation, incremental indexing, workspace persistence
- [x] Browser tests: landing, import, navigation, graph selection, inspection, mind map, 3D camera, search, settings, export — at desktop, tablet and mobile widths
- [x] Accessibility checks: keyboard, names and labels, focus visibility, contrast, reduced motion, landmarks, dialogs
- [x] Security tests: traversal, malicious names, oversized files, invalid archives, credential leakage
- [x] Benchmarks: 1,000 / 5,000 / 10,000 files; 50,000 symbols and 100,000 relationships
- [ ] Rendering stress tests, memory-leak checks, WebGL cleanup verification (K14)
- [ ] Live GitHub import test (K31)

## Phase 10 — Release

- [x] Production build (`dist/web`, `dist/engine`) verified by the browser tests
- [x] Environment configuration (`.env.example`)
- [x] Installation and development instructions
- [x] Versioning, changelog, licence, dependency licence inventory
- [x] Security notes, error handling, production logging with redaction
- [x] Dependency audit clean
- [~] Desktop packaging: plan written, not built (K33)
- [x] Screenshots and a recorded tour in the README, captured from the real application
- [x] Continuous integration workflow (type check, lint, tests, build, audit)

## Definition of done

| # | Requirement | Status |
|---|---|---|
| 1 | Open VECTORA | Done |
| 2 | Import an actual repository | Done (local and ZIP verified by tests; GitHub against a stand-in) |
| 3 | Index its source files | Done |
| 4 | Extract symbols and dependencies | Done |
| 5 | Persistent knowledge graph | Done |
| 6 | Hierarchical mind map | Done |
| 7 | Functional 2D graph | Done |
| 8 | Functional 3D graph | Done |
| 9 | Select nodes | Done |
| 10 | Inspect original source | Done |
| 11 | Trace relationships | Done |
| 12 | Search the repository | Done |
| 13 | Navigate between the three views | Done |
| 14 | Save and restore the workspace | Done |
| 15 | Export the graph | Done |
| 16 | Light and dark themes | Done |
