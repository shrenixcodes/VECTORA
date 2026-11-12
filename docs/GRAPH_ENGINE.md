# Graph engine

`packages/graph-engine` holds persistence, graph algorithms, exports and question exploration.

## Persistence (`store.ts`)

VECTORA uses the SQLite engine that ships inside Node.js (`node:sqlite`). No native module is compiled or downloaded. The database is one file, `vectora.db`, in the data directory, opened in WAL mode.

| Table | Contents |
|---|---|
| `repositories` | One row per repository: name, source kind, origin, branch, root path, status, counts, error, analysis JSON |
| `nodes` | `repo_id, id, type, name, file_path, data` — `data` is the full node as JSON |
| `edges` | `repo_id, id, source, target, type, data` |
| `file_facts` | Cached adapter output per file with its content hash |
| `sessions` | One saved workspace session per repository |
| `settings` | A single validated settings document |
| `credentials` | Encrypted values (see [SECURITY.md](SECURITY.md)) |
| `meta` | Database version |

Indexes: `nodes(repo_id, type)`, `nodes(repo_id, file_path)`, `edges(repo_id, source)`, `edges(repo_id, target)`.

Saving a graph replaces the repository's rows inside one transaction, using multi-row inserts. Loading returns the whole graph, or only chosen node types with the edges between them (`loadGraph(id, { types })`), or the symbols of one file with every edge touching them (`loadNodesByFile`).

The engine keeps at most two loaded repositories in memory, each with its adjacency index and search index.

### Migrations

`meta.db_version` records the schema version (currently 2). Version 1 used `WITHOUT ROWID` tables for graph rows; on opening such a database those tables are rebuilt and the affected repositories are marked for re-indexing.

## Algorithms (`algorithms.ts`)

| Function | Purpose |
|---|---|
| `buildIndex` | Maps of nodes, edges, outgoing and incoming edges |
| `traverse` | Breadth-first search over chosen relationship types in either direction, bounded by depth and node count |
| `shortestPath` | Shortest directed path between two nodes |
| `findCycles` | Strongly connected components (iterative Tarjan); used for circular imports |
| `cyclePath` | One concrete cycle inside a component |
| `impactOf` | Reverse reachability from a node and its members: what depends on it |
| `containerChain` | The chain of containers above a node |
| `assignCommunities` | Louvain communities on the undirected dependency projection, fixed seed |

## Overview (`analysis.ts`)

`buildOverview` derives the workspace overview from the graph and the analysis record: languages, frameworks, entry points, subsystems with inbound and outbound counts, concepts with their strongest evidence, largest modules, dependency statistics, and an architecture summary. Each summary statement carries an evidence string and a `verified` flag.

## Exports (`exports.ts`)

| Format | Function | Notes |
|---|---|---|
| JSON | `exportJson` | All nodes and edges with ids, locations, methods and confidence |
| GraphML | `exportGraphML` | For Gephi, yEd, Cytoscape; attributes declared as keys |
| Markdown analysis | `exportMarkdownAnalysis` | Index, languages, summary, subsystems, dependencies, unresolved |
| Architecture document | `exportArchitectureDoc` | Subsystem dependencies with a Mermaid diagram, endpoints, models, flows, cycles |

By default `stripSource` removes source text before a graph export: edge evidence becomes `path:line`, signatures and doc comments are dropped. Source text is included only when requested explicitly. Node ids and relationships are identical either way.

## Question exploration (`explore.ts`)

`explore(question, index, analysis, find)` answers from the graph only.

1. **Intent** is detected by pattern: callers, dependents, impact, cycles, startup, data access, trace, explain.
2. **Subject** is taken from quoted or code-formatted text, otherwise from the words that look like identifiers.
3. The subject is located with the search index.
4. The relevant relationships are retrieved with the algorithms above.
5. The answer is a list of statements. Each has `verified` and a list of evidence references (`path`, `startLine`, `endLine`, snippet).
6. Anything the graph cannot establish goes into `caveats`. When the subject is not found, the answer has no statements at all.

The engine can optionally pass the finished statements to an external narrative provider (`apps/local-engine/src/provider.ts`) to be rewritten as prose. That is off by default; the statements and evidence shown to the user always come from the graph.
