# Project status

**Version:** 0.1.0
**Date:** 2026-11-12
**Branch:** `feat/vectora`
**State:** Feature complete for the first web release. All automated checks pass. Not yet released; no desktop artifact.

## Summary

VECTORA is a working application: a local engine that imports and indexes repositories into a persistent knowledge graph, and a web application that explores that graph in a 2D graph, a 3D atlas and a mind map with a shared selection, an inspector showing original source, search, question exploration with citations, a dependency explorer, exports and settings.

## Verification on 2026-11-12

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | No errors |
| Lint | `npm run lint` | No errors |
| Unit and integration | `npm test` | 79 passed, 0 failed |
| Coverage | `npm run test:coverage` | 83.6% lines, 80.5% statements, 65.5% branches |
| Browser journeys | `npm run build` then `npm run test:e2e` | 18 passed, 0 failed (desktop, tablet, mobile) |
| Production build | `npm run build` | `dist/web`, `dist/engine` produced and exercised by the browser tests |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Benchmarks | `npm run bench` | 1,000 / 5,000 / 10,000 files and a 50,000-symbol graph measured; see `docs/PERFORMANCE.md` |

Environment: Windows 11, Node.js 24.14.1, Python 3.13.2, Microsoft Edge.

## What works

Everything marked done in `IMPLEMENTATION_CHECKLIST.md`, including all sixteen items of the definition of done.

## What is incomplete

| Item | State |
|---|---|
| Rendering benchmarks, memory-leak and WebGL cleanup checks | Not done |
| Live test against github.com | Not done; a stand-in API is used in tests |
| Optional narrative provider with a real service | Implemented, not exercised |
| Desktop packaging (Tauri 2) | Plan only |
| Screenshots | None |
| Receiver-type inference outside TypeScript, mounted route prefixes, 2D node shapes | Not done |
| macOS, Linux, other browsers | Not tested |

Details and workarounds: `KNOWN_ISSUES.md`.

## Release artifacts

Produced by `npm run build` (not committed):

- `dist/web/` — the web application
- `dist/engine/server.mjs`, `dist/engine/analyze-worker.mjs`, `dist/engine/grammars/`, `dist/engine/python/` — the engine

Run with `npm start`. `node_modules` must be present. There is no installer and no desktop build.

## Next actions

1. Correct the `ComSpec` environment variable on the development machine (see `KNOWN_ISSUES.md`, item 35).
2. Try a real GitHub import, public and private, and record the result.
3. Add a browser rendering benchmark (frame times, memory) for the 5,000-file synthetic repository.
4. Reuse the TypeScript compiler program between runs to make single-file re-indexing fast.
5. Take screenshots for the README and the user guide.
6. Test on macOS and Linux, and in Firefox.
7. Decide on desktop packaging and settle the open question in the Tauri plan.
8. Merge `feat/vectora` into `main` and tag `v0.1.0`.

## Where things are

| Need | Location |
|---|---|
| How to run | `README.md` |
| How it is built | `docs/ARCHITECTURE.md` |
| Why it is built that way | `DECISIONS.md` |
| What is left | `IMPLEMENTATION_CHECKLIST.md`, `KNOWN_ISSUES.md`, `docs/ROADMAP.md` |
| Test and benchmark results | `docs/TESTING.md`, `docs/PERFORMANCE.md`, `docs/benchmarks/latest.json` |
