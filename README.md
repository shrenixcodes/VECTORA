# VECTORA

**Understand what connects.**

VECTORA is a codebase intelligence platform that transforms software repositories into structured, interactive knowledge maps. It reveals how components, modules, dependencies and concepts connect, giving developers a new way to understand complex software systems.

You give it a repository — a GitHub URL, a ZIP archive or a folder on your machine. It parses the source, resolves relationships between symbols, and builds a knowledge graph that you explore in three connected views: a 2D graph, a 3D atlas and a hierarchical mind map. Everything runs locally.

> Screenshots are not included in this repository yet. Run the application and open the bundled sample to see it; `docs/USER_GUIDE.md` describes each screen.

## Features

- **Three views of one graph.** Graph Explorer (2D, Sigma.js), 3D Atlas (Three.js) and Mind Map (React Flow) share the same data and the same selection.
- **Evidence for every relationship.** Each node and edge records the file, line, extraction method and confidence. Verified structure and derived interpretation are kept apart and drawn differently.
- **Honest resolution.** A reference is tied to a definition only with scope evidence. Everything else is listed as unresolved, never guessed.
- **Inspector with original source.** Select any node to see its code, incoming and outgoing relationships, parent module and related concepts.
- **Search and questions.** A command palette (Ctrl/Cmd + K) over files, symbols, concepts and documentation, and questions such as “What calls verifyToken?” answered with file and line citations.
- **Dependency explorer.** External packages, dependencies between subsystems, circular imports, execution flows and unresolved references.
- **Incremental indexing.** Unchanged files are reused from a cache; changed files are re-analysed together with the files that depend on them.
- **Exports.** Graph as JSON or GraphML, mind map as SVG or PNG, graph views as PNG, repository analysis and architecture documentation as Markdown.
- **Light and dark themes**, keyboard access, reduced-motion support.

## Requirements

- Node.js 22.13 or newer (24 recommended). VECTORA uses the SQLite engine built into Node.js; nothing native is compiled.
- Python 3.8 or newer on the `PATH`, only if you want Python repositories analysed.
- A browser with WebGL for the 2D and 3D views. The Mind Map, search and inspector work without it.

## Installation

```bash
git clone <this repository>
```

```bash
cd VECTORA
```

```bash
npm install
```

## Quick start

Build once and start the engine, which also serves the application:

```bash
npm run build
```

```bash
npm start
```

Open <http://localhost:4317>, choose **Explore a repository**, and either import your own repository or index the bundled sample (“Orbit Notes”, a small, clearly labelled multi-language repository that exists only for onboarding and tests).

For development, with reloading of both the engine and the web application:

```bash
npm run dev
```

and open <http://localhost:5173>.

## Where data is kept

Everything VECTORA stores — its database, copies of GitHub and ZIP imports, uploads and the credential key — lives in one folder: `.vectora-data` inside the VECTORA folder by default. Set `VECTORA_DATA_DIR` to move it. Local folders you import are read in place and never copied or modified. See `.env.example` for all settings.

## Supported languages

| Language | Tier | Analysis |
|---|---|---|
| TypeScript, JavaScript | 1 | TypeScript Compiler API; references resolved by the type checker |
| Python | 1 | Standard-library `ast`; imports and scope resolved by the indexer |
| Java, Go, Rust, C, C++, C# | 2 | Tree-sitter syntax trees; imports and scope resolved by the indexer |

Files in other languages are indexed as files (and are searchable) but not analysed at symbol level. Each repository shows its own language coverage. VECTORA does not claim to support every language.

## Architecture

```
apps/
  local-engine/        Fastify service: imports, indexing jobs, graph API, exports
  web/                 React application: landing, import, workspace, three views
packages/
  graph-schema/        Node and relationship types, validation, normalisation
  language-adapters/   TypeScript, Python and Tree-sitter adapters behind one interface
  repository-indexer/  Scanning, manifests, resolution, organisation, pipeline, workers
  graph-engine/        Algorithms, SQLite store, exports, question exploration
  graph-layout/        3D and 2D layout engines (run in Web Workers)
  search/              Search index used by the engine and the browser
  shared/              Settings schema, API contracts, secret redaction
samples/sample-repo/   Labelled sample repository for tests and onboarding
docs/                  Documentation
```

The pipeline: discovery → syntax analysis → relationship resolution → execution flows → semantic organisation → graph generation → persistence → visualisation. `docs/ARCHITECTURE.md` explains each part.

## Privacy

- Source code is analysed on your machine. It is not uploaded.
- Repository scripts are never executed and repository dependencies are never installed.
- The engine listens on the loopback interface only and rejects requests from other origins.
- Access tokens are stored encrypted, sent only to GitHub in a request header, and never written to logs, URLs or exports.
- Exports leave out source text unless you ask for it.
- The only optional external service (a narrative summary for answers) is off by default.

Details are in `docs/SECURITY.md`.

## Testing

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs the unit and integration tests (Vitest). `npm run test:e2e` runs the browser journeys (Playwright) against the production build, so run `npm run build` first. See `docs/TESTING.md`.

## Documentation

| Document | Contents |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Importing, exploring and exporting |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Features, user journeys and scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components and how they interact |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every node and relationship type |
| [docs/INDEXING_PIPELINE.md](docs/INDEXING_PIPELINE.md) | Scanning, parsing, resolution, organisation |
| [docs/GRAPH_ENGINE.md](docs/GRAPH_ENGINE.md) | Persistence and algorithms |
| [docs/VISUALIZATION.md](docs/VISUALIZATION.md) | 2D, 3D and mind map rendering |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Typography, colour, spacing, motion |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and protections |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Benchmarks and optimisation decisions |
| [docs/TESTING.md](docs/TESTING.md) | Test commands and coverage |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems and fixes |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Setup and contribution guidelines |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Planned work, including desktop packaging |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Changes by version |
| [docs/LICENSES.md](docs/LICENSES.md) | Dependency licence inventory |

Project status files: [PROJECT_STATUS.md](PROJECT_STATUS.md), [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md), [DECISIONS.md](DECISIONS.md), [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## License

MIT. See [LICENSE](LICENSE). Third-party licences are listed in [docs/LICENSES.md](docs/LICENSES.md).

---

VECTORA
Understand what connects.
