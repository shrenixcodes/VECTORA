# Testing

All figures on this page come from runs on the development machine on 2026-11-12 (Windows 11, Node.js 24.14.1, Python 3.13, Microsoft Edge). Re-run the commands to get current results.

## Commands

| Command | What it runs |
|---|---|
| `npm run typecheck` | TypeScript in strict mode over every package, both applications, scripts and tests |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | The same, with V8 coverage |
| `npm run build` then `npm run test:e2e` | Browser journeys (Playwright) against the production build |
| `npm run bench` | Performance benchmarks (see [PERFORMANCE.md](PERFORMANCE.md)) |
| `npm audit --omit=dev` | Known vulnerabilities in production dependencies |

## Latest results

| Suite | Result |
|---|---|
| Type check | No errors |
| Lint | No errors, no warnings |
| Unit and integration (`npm test`) | 79 passed, 0 failed, 4 files |
| Browser journeys (`npm run test:e2e`) | 18 passed, 0 failed: 10 at desktop width, 4 at tablet width, 4 at mobile width |
| Dependency audit | 0 known vulnerabilities |

### Coverage

From `npm run test:coverage`, over `packages/*/src`, `apps/local-engine/src` and `apps/web/src/lib`:

| Metric | Covered |
|---|---|
| Statements | 80.5% |
| Branches | 65.5% |
| Functions | 79.3% |
| Lines | 83.6% |

React components and the three renderers are not part of this figure; they are exercised by the browser journeys.

## What is tested

### Unit tests — `tests/unit/indexing.test.ts` (26 tests)

- **File scanning and ignore handling:** `.gitignore`, custom patterns, size limits, binary and generated detection, symbolic links not followed, file limit with preference for source files, language and configuration detection, manifests.
- **Syntax and symbol extraction:** symbols, kinds, locations and doc comments in TypeScript; symbols in Python, Java, Go, Rust, C and C#; syntax errors reported without failing the index.
- **Relationship resolution:** calls, imports, inheritance and routes through the type checker; evidence and location on every edge; pattern-based data access marked as derived; resolution through imports and scope in other languages; **no relationship invented for an undefined name; no resolution by name coincidence**.
- **Graph validation:** the produced graph passes integrity checks; duplicates, dangling edges and missing evidence are detected; normalisation behaviour.
- **Clustering:** subsystems, subsystem roots, concepts with evidence, entry points and flows, deterministic communities.
- **Incremental indexing:** unchanged files reused; a renamed export re-analyses its dependants and leaves no stale relationship; worker threads give the same graph as in-process analysis.

### Unit tests — `tests/unit/graph-engine.test.ts` (19 tests)

Algorithms (cycles, traversal, shortest path, impact), search ranking and filters, **persistence** (round trip through SQLite across a reopen, settings validation, deletion), **export** (ids and relationships preserved; no source text unless requested; GraphML structure; Markdown documents), question exploration (intents, citations, “not found” instead of invention), layout (finite, deterministic, hierarchical), secret redaction.

### Unit tests — `tests/unit/web.test.tsx` (14 tests, jsdom)

Design tokens match the specified palette and the stylesheet; **WCAG contrast** of text and semantic colours in both themes; glyph, size and colour for every node type; `deriveView` (density, expansion, filters, focus, limits); inspector relations; the mind-map hierarchy built from the same graph; the shared selection store; form controls; the landing and About pages; user-facing copy free of excluded terminology.

### Integration tests — `tests/integration/engine.test.ts` (20 tests)

The engine is started in-process and driven through its HTTP interface.

- **Local import**, full indexing, graph, structure-only graph, lazy members, overview, search, documentation, questions.
- **Source access** for indexed files only, with traversal attempts refused.
- **Incremental re-index**, including the unchanged fast path and a forced full run.
- **Exports** in all formats.
- **Workspace persistence:** session and settings survive an engine restart.
- **ZIP import** through a multipart upload: nested root detection, ignored and binary entries left out, cleanup of uploads and of managed sources on removal; non-archives rejected.
- **GitHub import** against a stand-in for `api.github.com` (no network access is used): public repository with branch and subdirectory; private repository refused without a credential and read with one.
- **Security:** traversal and malicious names, symbolic links, oversized and invalid archives, entry and size limits, path containment, host and origin checks, no debug endpoints, credentials absent from URLs, logs, responses, exports and from the database in clear text; authenticated encryption of stored credentials; deletion of all data.

### Browser journeys — `tests/e2e/journeys.spec.ts`

Run against the production bundle with the installed Microsoft Edge (`channel: 'msedge'`; set `VECTORA_E2E_CHANNEL` to use another browser). Every journey also asserts that there were no console errors and no server errors.

| Journey | Widths |
|---|---|
| Landing page, About, call to action | desktop, tablet, mobile |
| Import screen: validation messages for all three methods, folder browser, sample import | desktop, tablet, mobile |
| Workspace navigation to every view | desktop, tablet, mobile |
| Search, graph selection, inspector with original source and evidence, focus mode, source view, filters | desktop |
| Shared selection across Graph Explorer, 3D Atlas (orbit, zoom, reset, breadcrumb, neighbourhood, global view) and Mind Map | desktop |
| Mind Map: expand, collapse, select, find, relationship overlay, SVG export | desktop |
| Search view, questions with evidence links, Dependency Explorer, Documentation | desktop |
| Settings persist and take effect, light and dark themes, JSON export contents, saved workspace restored | desktop |
| Accessibility: skip link, landmarks, one `h1`, accessible names for all controls, labels for all fields, dialog focus, visible focus | desktop, tablet, mobile |
| Reduced-motion preference | desktop |

## What is not covered by automated tests

- A live request to GitHub. The integration test uses a local stand-in; a real import depends on network access and on GitHub.
- The optional narrative provider against a real service.
- Screen-reader behaviour beyond names, roles and landmarks.
- Visual regression (no screenshot comparison).
- Rendering frame rates, memory growth over long sessions and WebGL resource release. Indexing and graph operations are benchmarked; rendering is not measured automatically.
- Browsers other than Chromium-based Edge.
- macOS and Linux. Development and all test runs were on Windows 11.

These are listed in [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md).

## Notes for running the tests

- Tests write only inside the repository folder (`.bench-tmp/`), never to the system drive.
- The browser journeys need `npm run build` first; the setup stops with a clear message otherwise. The engine is started directly, without a shell, on port 4399 with its own empty data directory.
- The sample repository in `samples/sample-repo` is the fixture for most tests. Changing it changes expected values in the tests.
