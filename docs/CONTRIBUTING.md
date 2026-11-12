# Contributing

## Setup

Requirements: Node.js 22.13 or newer, npm, and Python 3.8 or newer if you work on Python analysis.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts the engine on port 4317 (restarting on changes) and the Vite dev server on port 5173, which proxies `/api` to the engine. Open <http://localhost:5173>.

Data is written to `.vectora-data` in the repository folder; test and benchmark scratch files go to `.bench-tmp`. Both are ignored by git.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Engine and web application with reloading |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production build |
| `npm run typecheck` | TypeScript, strict mode, whole repository |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Unit and integration tests |
| `npm run test:coverage` | The same with coverage |
| `npm run test:e2e` | Browser journeys against the production build |
| `npm run bench` | Performance benchmarks |
| `npm run licenses` | Regenerate `docs/LICENSES.md` |
| `npx tsx scripts/index-cli.ts <dir> --edges --unresolved` | Index a folder from the command line and print the result |

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md). Packages export TypeScript source (`"exports": "./src/index.ts"`); there is no per-package build step.

## Guidelines

- **Evidence.** A relationship needs a source location and evidence text. Do not add resolution that guesses: if scope evidence is missing, report the reference as unresolved. New heuristics must set `verified: false` and an honest confidence.
- **Facts and interpretation stay apart.** Derived information goes into separate nodes, edges or metadata with its own extraction method.
- **Tests come with the change.** Add a fixture to `samples/sample-repo` or a temporary tree in the test, and assert both what is found and what must not be found.
- **No execution of repository content.** No scripts, no hooks, no dependency installation, no importing analysed modules.
- **Privacy.** No network request without a user action. Never log request bodies or credentials. New exports must respect the source-inclusion setting.
- **Interface.** Follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): tokens only, sentence case, no decoration, visible focus, accessible names, colour never the only signal. User-facing text describes the product as a code intelligence and repository analysis platform.
- **Dependencies.** Justify each new one, check its licence, run `npm run licenses` and `npm audit --omit=dev`.
- **Before a pull request:** `npm run typecheck`, `npm run lint`, `npm test`, and for interface changes `npm run build` followed by `npm run test:e2e`.

## Adding a language

See “Adding a language” in [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md).

## Commit messages

Imperative mood, a short subject line, and a body that says what changed and why.

## Project records

Update [../IMPLEMENTATION_CHECKLIST.md](../IMPLEMENTATION_CHECKLIST.md), [../DECISIONS.md](../DECISIONS.md) and [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) when your change affects them, and add an entry to [CHANGELOG.md](CHANGELOG.md).
