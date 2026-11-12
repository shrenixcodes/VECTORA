# Product

**VECTORA** — Understand what connects.

VECTORA is a codebase intelligence platform that transforms software repositories into structured, interactive knowledge maps. It reveals how components, modules, dependencies and concepts connect, giving developers a new way to understand complex software systems.

## Who it is for

- A developer joining a project who needs to understand an unfamiliar repository without reading hundreds of files.
- A maintainer assessing what a change will affect.
- A reviewer or architect who wants to see dependencies between parts of a system, circular imports, and where requests reach data.

## Principles

Local-first. Privacy-conscious. Evidence-based. Fast and resource-efficient. Language-aware. Incrementally indexable. Visually restrained. Accessible. Modular. Extensible.

## Features in version 0.1

| Area | Feature |
|---|---|
| Import | GitHub repository (public; private with a token), ZIP archive, local folder, bundled sample |
| Indexing | Eight-stage pipeline; TypeScript, JavaScript, Python (tier 1); Java, Go, Rust, C, C++, C# (tier 2); incremental re-indexing; worker threads |
| Graph | 18 node types, 15 relationship types, evidence and confidence on each, validation, unresolved-reference reporting |
| Exploration | Graph Explorer (2D), 3D Atlas, Mind Map, with shared selection |
| Inspection | Inspector with original source, relationships and their evidence |
| Search | Command palette, search page, documentation search |
| Questions | Callers, dependents, impact, traces, data access, cycles, startup, explanations — all with citations |
| Dependencies | Packages, subsystem dependencies, circular imports, flows, unresolved references |
| Export | JSON, GraphML, Markdown analysis, architecture document, SVG, PNG |
| Workspace | Saved and restored automatically |
| Settings | Appearance, graph, performance, repository, privacy |
| Themes | Light and dark |

## User journeys

1. **First look.** Open VECTORA → Explore a repository → index the sample → read the overview → open the Graph Explorer.
2. **Understand a function.** Ctrl+K → type its name → Enter → read its source and relationships in the inspector → follow a caller.
3. **Assess a change.** Search → Ask “What could be affected if I change X?” → highlight the result in the graph.
4. **Follow a request.** Ask “Trace GET /notes” or open Dependency Explorer → Execution flows → show in graph.
5. **See the shape.** 3D Atlas → global view → click a subsystem → show connected neighbourhood.
6. **Document.** Export the architecture document and the mind map.
7. **Return later.** Reopen the repository: selection, layout and filters are as you left them. Re-index after pulling changes.

## In scope

Static analysis of source text; structure and relationships that can be shown with evidence; local storage; single-user use on one machine.

## Out of scope for 0.1

- Running or building the analysed code, dynamic analysis, test coverage.
- Hosted or multi-user operation, authentication, sharing links.
- Git history, blame, diffs between commits.
- Editing code.
- A packaged desktop application (planned; see [ROADMAP.md](ROADMAP.md)).
- Languages other than the nine listed. Other files are indexed as files only.

## What VECTORA does not claim

- It does not claim to support every language or framework.
- It does not claim that derived groupings (concepts, flows, data-access relationships) are facts; they are marked as derived.
- It does not claim that the absence of a relationship means no relationship exists: dynamic dispatch, reflection and unresolved references are outside what static structure shows. Unresolved references are counted and listed.
- Benchmark figures describe one machine and are not promises.
