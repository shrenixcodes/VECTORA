# User guide

## Starting VECTORA

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open <http://localhost:4317>. The engine and the application run on your machine; nothing else is needed.

## Importing a repository

Choose **Explore a repository**. There are three ways to import, and a sample to try first.

### The sample

Under *Your repositories*, choose **Index the sample repository**. “Orbit Notes” is a small multi-language repository bundled with VECTORA for onboarding and tests. It is not a real product.

### GitHub repository

1. Paste the URL (`https://github.com/owner/name`, an SSH address, or `owner/name`). A URL that points at a branch or folder is understood.
2. Choose **Check repository**. VECTORA shows the repository, its size and its branches.
3. Pick a branch and, if you only want part of the repository, a subdirectory.
4. Choose **Download and index**.

For a private repository, open *Private repository* and paste an access token with read access to repository contents. Tick *Store this token* to keep it, encrypted, for later imports. Never put a token in the URL; VECTORA refuses URLs that contain credentials.

### ZIP archive

Drop the archive or choose a file (up to 512 MB). VECTORA checks it first and shows the number of files, the folders that look like project roots, and anything it will skip as unsafe. Pick the project root and choose **Extract and index**. Ignored folders such as `node_modules`, binary files and symbolic links are not extracted.

### Local folder

Type the path or choose **Browse**, then **Index this folder**. The folder is read in place: nothing is copied or changed. `.gitignore` files and the ignore patterns from Settings are respected.

### While indexing

Progress is shown in stages: acquiring source, discovering files, analysing syntax, resolving relationships, tracing execution flows, organising subsystems and concepts, generating the graph, saving the workspace. The workspace opens when indexing finishes.

## The workspace

The header shows the repository name, branch, indexing status, when it was last indexed, and the number of symbols and relationships. The buttons on the right open search, re-index the repository, open exports, switch the theme and show or hide the inspector.

### Overview

Description, languages with coverage, frameworks, an architecture summary in which every statement lists its evidence, entry points, subsystems, concepts, the largest modules and dependency statistics. Names are links into the graph.

### Graph Explorer

A two-dimensional map of the repository.

- Drag to pan, scroll to zoom, **Fit** to see everything.
- Click a node to select it: its neighbours stay lit, the rest dims, and the inspector opens.
- Ctrl-click (or Shift-click) adds to the selection.
- Double-click a file to unfold its symbols. Double-click any other node to unfold the files around it.
- Drag a node to rearrange. **Rearrange** computes a new layout; **Group by** arranges by subsystem or by community.
- The minimap in the corner shows where you are; click it to jump.
- **Filters and legend** hides node types and relationship types and explains the glyphs and line styles.
- **PNG** saves the current view.

Keyboard: arrows pan, `+` and `-` zoom, `0` fits, `N` and `P` step through nodes, Enter selects.

### 3D Atlas

The same graph in space: the repository in the centre, subsystems around it, files and symbols inside their subsystem, concepts above, external packages below.

- Drag to orbit, right-drag to pan, scroll to zoom.
- Click a node to select it and fly to it. Double-click to unfold.
- The breadcrumb at the bottom shows where the selection sits; each part is a link.
- **Reset camera** returns to the starting view. **Focus subsystem** flies to the subsystem of the selection. **Show connected neighbourhood** shows only the selection and what it connects to. **Global view** clears focus and selection.

If your browser has no WebGL, the Atlas says so and offers the 2D Graph Explorer.

### Mind Map

The repository as a tree: subsystems, folders, files, symbols, and a branch of concepts.

- Use the number and arrow on a node to expand or collapse it. Double-clicking does the same.
- Click a node to select it; the inspector shows it.
- Drag nodes to reorganise. **Reset layout** undoes this.
- **Find in the mind map** highlights matches; Enter focuses the first.
- **Show relationship** draws one relationship type, such as *imports* or *calls*, between the visible nodes.
- **SVG** and **PNG** export the whole map.

### Selection is shared

Whatever you select in one view is selected in the others. Select a function in the Graph Explorer, open the 3D Atlas, and the camera goes to the same function.

### Inspector

For the selected node: type, path and lines, description, the original source, how it was found and with what confidence, its parent, what it depends on, what depends on it, and related concepts. Open the arrow beside a relationship to see the line of code that proves it.

Buttons: **Focus in graph**, **Expand relationships**, **Open source location**, **Copy path**, **Copy symbol name**, **Copy dependency information**. Drag the left edge to resize; the header button hides it.

### Verified and derived

Structure read directly from source is *verified*. Interpretations — concept groups, data-access relationships found by pattern, flows — are *derived*, drawn dashed or thin, and tagged “derived”. References that could not be tied to a definition are not drawn at all; they are listed under Dependency Explorer → Unresolved references.

### Dependency Explorer

- **External packages**: where each is declared and how many files import it; packages imported but not declared are flagged.
- **Between subsystems**: which subsystem depends on which, with counts and an example.
- **Circular imports**: groups of files that import each other.
- **Execution flows**: chains from an endpoint or entry point to what it calls.
- **Unresolved references**: by reason, with samples.

**Show in graph** highlights the items in the graph views.

### Search

Press **Ctrl + K** (Cmd + K on macOS) anywhere in a workspace. Type part of a name, a path, a concept or a phrase from documentation. Arrow keys move, Enter opens the result and highlights it in the graph, Escape closes.

The Search page offers the same search with filters by type, and **Ask about the repository**, where you can ask questions such as:

- What calls verifyToken?
- Which modules depend on NoteRepository?
- What could be affected if I change NoteService?
- Trace GET /notes
- Show the complete database access path
- Identify circular dependencies
- Explain the application startup sequence
- Explain authentication

Answers are lists of statements. Each cites files and lines you can open, and a section called *Not established* says what the graph cannot tell you. If nothing matches, VECTORA says so rather than guessing.

### Documentation

Documentation files found in the repository, and two documents generated from the graph: *Architecture* and *Repository analysis*.

## Exporting

Choose the download button in the header.

| Export | Format |
|---|---|
| Graph | JSON, GraphML |
| Repository analysis | Markdown |
| Architecture documentation | Markdown |
| Mind map | SVG, PNG (from the Mind Map toolbar) |
| Graph Explorer, 3D Atlas | PNG (from their toolbars) |

Graph exports keep every node id and relationship. They contain names, paths and line numbers but no lines of code, unless you tick *Include source text in graph exports*.

## Saved workspaces

Your selection, unfolded files, filters, graph layout, mind-map arrangement and current view are saved automatically and restored when you reopen the repository.

## Re-indexing

Choose the refresh button in the header. Only changed files, and files that depend on them, are analysed again.

## Settings

| Section | What you can change |
|---|---|
| Appearance | Light, dark or system theme |
| Graph | Default view, node density, label density, animation intensity, focus behaviour, derived relationships, relationship visibility |
| Performance | Indexing workers, indexing cache, rendering quality, reduced motion, file and node limits |
| Repository | Ignore patterns, maximum file size, languages to analyse, incremental indexing |
| Privacy | Where data is kept, stored credentials, export defaults, the optional narrative service, deleting all data |

## Removing data

Remove one repository from *Your repositories*. Remove everything from Settings → Privacy → **Delete all VECTORA data**. Folders you imported from your own disk are never touched.
