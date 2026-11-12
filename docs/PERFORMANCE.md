# Performance

VECTORA is meant to stay usable on ordinary computers and does not assume a powerful GPU. This page records what was measured, where the time goes, and which design decisions keep resource use bounded.

## Benchmarks

Run with `npm run bench` (`scripts/bench.ts`). The raw results are in [benchmarks/latest.json](benchmarks/latest.json).

**These numbers describe one machine on one day. They are measurements, not promises**; other hardware, other repositories and other disks will differ.

- Machine: 12th Gen Intel Core i5-12450H (12 logical cores), 7.7 GB RAM, Windows 11, Node.js 24.14.1, SSD.
- Date: 2026-11-12. Indexing workers: 4.
- Repositories are synthetic: 70% TypeScript and 30% Python files, each with a class, several functions and constants, importing and calling two or three other files. Real repositories have larger and more varied files.
- Peak memory is the resident set size of the engine process, which includes its worker threads. The separate Python interpreter process is not included.
- CPU is process CPU time divided by wall time across all 12 logical cores (8.3% equals one core fully used).

### Indexing

| Files | Nodes | Symbols | Relationships | Full index | Peak memory | CPU | Re-index, nothing changed | Re-index, one TypeScript file changed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 7,948 | 6,700 | 26,949 | 5.6 s | 488 MB | 8.8% | 1.1 s | 5.7 s |
| 5,000 | 39,033 | 33,500 | 134,053 | 22.3 s | 706 MB | 6.1% | 5.1 s | 17.5 s |
| 10,000 | 77,758 | 67,000 | 267,793 | 31.3 s | 995 MB | 6.8% | 10.6 s | 27.2 s |

All three runs finished with 0 validation errors and 0 unresolved references (the synthetic code is fully resolvable). An earlier run of the 10,000-file case on a cold file cache took 54 s; the figure above is from a warm cache.

In the one-file case 9 files were re-analysed (the changed file and its dependants) and all others reused.

### Storing and loading the graph

| Files | Rows (nodes + relationships) | Save to SQLite | Load from SQLite | Database size |
|---:|---:|---:|---:|---:|
| 1,000 | 34,897 | 0.8 s | 0.2 s | 29 MB |
| 5,000 | 173,086 | 4.4 s | 1.3 s | 150 MB |
| 10,000 | 345,551 | 8.9 s | 2.5 s | 304 MB |

### Graph of 50,000 symbols and 100,000 relationships

A graph generated directly (52,521 nodes including 2,500 files and 20 subsystems; 152,500 relationships in total including containment).

| Operation | Time |
|---|---:|
| Validate | 0.54 s |
| Build adjacency index | 0.17 s |
| Community detection (Louvain) | 0.86 s |
| Cycle detection | 0.12 s |
| Build search index | 0.10 s |
| 50 search queries | 2.8 s (about 56 ms each) |
| 3D layout of all 52,521 nodes | 3.9 s |
| Save to SQLite | 8.0 s |
| Load from SQLite | 1.3 s |
| Load structure only (no symbols) | 0.7 s |
| Export JSON (58 MB) | 0.16 s |

This pass ran in the same process straight after indexing, so its memory figures (about 1.1 GB) include what the earlier runs left behind and are not reported as a separate measurement.

### What was not measured

- **Initial graph rendering time and interaction responsiveness in the browser.** There is no automated rendering benchmark yet. The browser tests confirm that the three views render and respond for the sample repository; they do not measure frame times.
- **Memory growth over long sessions and release of WebGL resources.** Geometries created by hand are disposed when replaced and React Three Fiber disposes the rest on unmount, but this has not been verified with a memory profiler.
- **Repositories larger than 10,000 files**, and repositories that are 100% TypeScript at that size.

These gaps are listed in [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md).

## Where the time goes

Measured stage by stage on the 1,000-file repository (3.6 s in this run): discovery 0.6 s, syntax analysis 2.6 s, resolution 0.09 s, flows and organisation 0.07 s, graph generation and validation 0.2 s. With every file reused from the cache the whole pipeline takes 0.7 s.

1. **TypeScript analysis** is the largest cost. One compiler program covers all TypeScript and JavaScript files and runs in a single worker, which is why CPU use stays near one core. The type checker cannot be split across threads.
2. **One changed TypeScript file costs almost as much as a full index.** The cache avoids walking unchanged files, but the compiler program is created again from scratch, and that dominates. Changes to Python and tier-2 files do not have this cost: only the changed files are parsed. Reusing the compiler program between runs is on the roadmap.
3. **Reading and hashing files** dominates the unchanged case (10.6 s for 10,000 files on this machine, where every file read passes through real-time antivirus scanning).
4. **Saving** takes about 25 microseconds per row; the JSON of each node and relationship is stored whole.

## Optimisation decisions

### Indexing

- **Bounded concurrency.** A worker pool sized by the *Indexing workers* setting; jobs run one at a time, so two imports never compete for memory.
- **Worker threads** for Tree-sitter batches and the TypeScript program; a separate interpreter process for Python. The engine's main thread stays free to answer requests.
- **Per-file cache keyed by content hash.** Unchanged files are not analysed again.
- **Unchanged fast path.** A fingerprint over every file's path and hash lets a re-index of an unchanged repository return right after the scan, keeping the stored graph.
- **Limits.** Maximum file size (512 KB), maximum files per repository (20,000), both configurable. Binary, generated and minified files are skipped.
- **No dependency installation, no script execution**, so indexing cost depends only on the source text.
- **The compiler reads only indexed files.** Module resolution is done against the list of indexed files, so `node_modules` is never parsed.

### Storage and memory

- SQLite in WAL mode, multi-row inserts inside one transaction per table, ordinary row-id tables (an earlier `WITHOUT ROWID` layout was measurably slower for large JSON rows and was replaced).
- At most two repositories are held in memory by the engine.
- **Progressive loading.** When a repository has more symbols than *Maximum nodes on screen* (8,000 by default), the browser first loads the structural graph (repository, subsystems, folders, files, packages, concepts) and fetches the symbols of a file when it is unfolded.

### Rendering

- **Node density.** *Structure* shows files only; *Balanced* adds the prominent symbol kinds; *Full* shows everything up to the node limit.
- **2D:** WebGL rendering through Sigma; labels by zoom and density, never all at once; edges and labels hidden while moving above 5,000 elements; layout in a Web Worker.
- **3D:** one instanced mesh per shape family; relationships in two buffer geometries; no React component per node or edge; no per-frame React state; on-demand rendering so an idle scene costs nothing; cross-file relationships only when viewed from far away; a label budget with frustum and distance culling; lower geometry detail, no antialiasing and no labels at *Low* quality; pointer hover disabled above 20,000 nodes; layout in a Web Worker.
- **Mind map:** only expanded branches exist as elements; off-screen elements are culled above 600 visible nodes.
- **Fallback.** Without WebGL the Atlas offers the 2D view; the Mind Map, search and inspector need no WebGL.
- **Reduced motion** removes animated layout settling and camera transitions.
- **No background work.** No polling outside an active indexing job, no file watching, no network requests except those the user starts.

### Loading the application

The main bundle is about 690 kB (209 kB compressed). The three renderers and the source editor are separate chunks loaded when first used. Fonts are bundled as Latin subsets.

## If VECTORA feels slow

See “Indexing is slow or uses a lot of memory” and “The graph is crowded or slow to draw” in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
