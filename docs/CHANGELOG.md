# Changelog

All notable changes to VECTORA are recorded here. Versions follow semantic versioning.

## 0.1.0 — 2026-11-12

First version.

### Added

- Repository import from GitHub (public, and private with an access token), ZIP archives and local folders, plus a bundled sample repository.
- Indexing pipeline: discovery with ignore rules, syntax analysis, relationship resolution, execution flows, subsystem and concept organisation, graph validation.
- Language adapters: TypeScript and JavaScript (TypeScript Compiler API with type-checked resolution), Python (`ast`), Java, Go, Rust, C, C++ and C# (Tree-sitter).
- Knowledge graph with 18 node types and 15 relationship types, each carrying evidence, extraction method and confidence. Unresolved references are reported, not drawn.
- Incremental indexing with a per-file cache and an unchanged-repository fast path; analysis in worker threads.
- SQLite persistence using the engine built into Node.js.
- Graph Explorer (2D), 3D Atlas and Mind Map with shared selection, focus mode, filters and saved layouts.
- Inspector with source preview and evidence for each relationship.
- Command palette, search page, documentation search and question exploration with file and line citations.
- Dependency Explorer: packages, subsystem dependencies, circular imports, execution flows, unresolved references.
- Exports: JSON, GraphML, Markdown analysis, architecture document, SVG and PNG.
- Settings for appearance, graph, performance, repository and privacy; light and dark themes; reduced-motion support.
- Local engine bound to the loopback interface with host and origin checks, safe archive handling and encrypted credential storage.
- Unit, integration and browser tests; performance benchmarks; documentation.
