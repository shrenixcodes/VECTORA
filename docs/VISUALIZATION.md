# Visualisation

All three views render the same knowledge graph and share one selection. `deriveView` (`apps/web/src/lib/graphView.ts`) decides what is shown from: node density, expanded files, hidden node and relationship types, whether derived relationships are shown, focus mode, the node limit, and pinned nodes (the selection and any highlight).

## Not by colour alone

Every relationship and node type is distinguishable without colour:

- Node types have a glyph shown before every label, a size by type, and in 3D a distinct shape (icosahedron for structure, box for files, octahedron for types, sphere for functions, cylinder for database models, cone for endpoints, dodecahedron for concepts, tetrahedron for external packages).
- Derived relationships are drawn dashed (3D, mind map) or thin (2D) and are labelled “(derived)”; in lists they carry a dashed “derived” tag.
- Selected relationships show their type as text along the edge.

## Graph Explorer — 2D (`workspace/GraphExplorer.tsx`)

Sigma.js 3 renders a Graphology multigraph with WebGL.

- **Layout.** Nodes start on deterministic discs, one per subsystem (or per community, chosen with *Group by*). ForceAtlas2 then runs in a Web Worker for a few seconds, followed by a no-overlap pass. With reduced motion the layout is computed in one step instead of settling on screen. Positions are saved with the session and restored.
- **Selection.** Selecting a node highlights it and its neighbours, dims everything else by blending towards the background, labels the connecting relationships, and opens the inspector. Ctrl/Shift-click adds to the selection.
- **Labels.** Labels appear by zoom level and density (`labelRenderedSizeThreshold`, `labelDensity`); neighbours of a selection are always labelled when there are few.
- **Expansion.** Double-click a file to unfold its symbols; double-click another node to unfold the files around it. New nodes appear next to their parent.
- **Navigation.** Pan, zoom, fit to view, a minimap with the current viewport, node dragging, focus mode, and keyboard control (arrows, plus/minus, 0, N/P to step through nodes, Enter to select).
- **Large graphs.** Edges and labels are hidden while moving above 5,000 elements; the node limit and progressive loading keep the element count bounded.
- **Export.** PNG of the current view.

## 3D Atlas (`workspace/Atlas.tsx`)

Three.js through React Three Fiber, with a real perspective camera and orbit controls.

- **Spatial design** (`packages/graph-layout`). The repository sits at the origin. Subsystems are anchors on a ring (up to seven) or a sphere around it. Files and folders are pulled towards their subsystem by a 3D force simulation (`d3-force-3d`) that also links files that import each other. Symbols orbit their file on a small shell; members orbit their class. Concepts form a layer above and external packages a layer below. The layout runs in a Web Worker.
- **Rendering.** One `InstancedMesh` per shape family; relationships are two `LineSegments` objects with buffer geometry (verified solid, derived dashed) and per-vertex colour. There is no React component per node or edge. Lighting is one ambient and one directional light with light fog for depth. No bloom, particles or decorative effects.
- **Interaction.** Click to inspect, double-click to unfold, hover for a preview label, orbit, pan, zoom. Selecting a node flies the camera to it over about 0.8 s with eased motion; with reduced motion the camera jumps. A breadcrumb shows repository › subsystem › file › symbol and each part is clickable. Buttons: reset camera, focus subsystem, show connected neighbourhood, global view.
- **Level of detail.** From far away only cross-file relationships are drawn (a draw range over a pre-sorted buffer). Labels are plain elements in one overlay, positioned by projecting their node each rendered frame; besides structural labels and the selection, only the nearest nodes in view get a label, up to a budget set by label density. Geometry detail, antialiasing and pixel ratio follow *Rendering quality*.
- **Idle.** The canvas renders on demand (`frameloop="demand"`): nothing is drawn while the scene is still.
- **Robustness.** While a new layout is computed the previous scene stays on screen. If WebGL is unavailable, or the context is lost, the Atlas explains this and offers the 2D Graph Explorer and, for a lost context, a restart.
- **Export.** PNG of the current view.

## Mind Map (`workspace/MindMap.tsx`)

React Flow with a dagre left-to-right layout.

- **Hierarchy.** Built from the graph: repository → subsystems → folders → files → symbols → members, plus a *Concepts* branch whose children are concept groups and their member files. Folders that contain only one folder are merged.
- **Expand and collapse** per node; everything below the second level starts collapsed. Opening a branch pans to keep it and its children in view.
- **Reorganise** by dragging nodes; positions and collapsed state are saved with the session. *Reset layout* returns to the computed layout.
- **Find** highlights matches and focuses the first one. Selecting elsewhere and opening the Mind Map reveals the selection in the tree.
- **Show relationship** overlays one relationship type between the visible nodes, lifting each end to its nearest visible ancestor and counting how many relationships each line stands for.
- **Export.** SVG and PNG of the whole map.

## Inspector (`components/Inspector.tsx`)

A resizable, collapsible panel beside the view. It shows name, type, path and line range, description, source preview (CodeMirror 6, read-only, with the symbol's lines marked), how the node was found and with what confidence, parent module, outgoing and incoming relationships grouped by type (each expandable to its evidence line and location), contained symbols, member files of a concept or subsystem, and related concepts. Actions: focus in graph, expand relationships, open source location, copy path, copy symbol name, copy dependency information.

## Performance notes

See [PERFORMANCE.md](PERFORMANCE.md) for measurements and the list of optimisations.
