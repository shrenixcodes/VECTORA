# Known issues and limitations

Version 0.1.0, 2026-11-12. Each item says what the limitation is and, where there is one, the workaround.

## Analysis

1. **Calls on values of unknown type are not resolved in Python and the tier-2 languages.** `x.method()` is resolved only when `x` is `self`/`this`, an imported module or package, or a class name. Such calls are listed as unresolved rather than guessed. TypeScript and JavaScript are not affected (the type checker is used).
2. **Inherited members are not followed** for `self.x()` / `this.x()` outside TypeScript: a method defined on a base class is reported as “member not found on enclosing type”.
3. **Data-access relationships are pattern based** (`READS_FROM`, `WRITES_TO`). They depend on recognising a model and a method name, and are always marked as derived. ORMs that hide models behind generated clients (for example a `prisma.user` accessor) are not recognised.
4. **Route prefixes from mounted routers are not applied.** `app.use('/api', router)` does not prefix the endpoints of `router`.
5. **CommonJS exports are not marked as exported.** `module.exports = …` and `exports.x = …` are analysed for calls and imports, but the symbols do not get the `exported` flag or an `EXPORTS` edge.
6. **Concepts come from a fixed vocabulary.** Domain concepts that are not in it are not found, and a file can match on a name that means something else. Every membership shows its evidence and is marked as derived.
7. **Vue and Svelte single-file components, and languages other than the nine supported, are indexed as files only.**
8. **C and C++ preprocessing is not performed.** Code inside conditional compilation is analysed as written; macros that generate declarations are not expanded. `.h` files are treated as C++ when the repository contains C++ sources.
9. **Nested functions are not separate nodes.** Calls made inside a nested function are attributed to the enclosing top-level function or method.
10. **Entry points are found by manifest fields and naming conventions**, not by build configuration. Python `if __name__ == "__main__":` blocks are not used as evidence.
11. **Go standard-library detection is by import path shape** (no dot in the first segment).

## Performance

12. **A change to one TypeScript or JavaScript file costs almost as much as a full index**, because the compiler program is created again (see `docs/PERFORMANCE.md`). Python and tier-2 changes are fast.
13. **TypeScript analysis uses one thread.**
14. **No rendering benchmark.** Initial render time, frame times while interacting, memory growth over long sessions and WebGL resource release were not measured. Indexing and graph operations were.
15. **Repositories above 10,000 files were not benchmarked**, and the 10,000-file run was 70% TypeScript. A much larger all-TypeScript repository may exceed the worker's 3 GB heap limit; analysis of that language then fails with a reported error and the files remain as file nodes. Workaround: import a subdirectory or add ignore patterns.
16. **Search over 50,000 nodes takes about 56 ms per query** on the test machine: a linear scan, fine for interactive use, not indexed.

## Interface

17. **Node shapes differ by type only in 3D.** In the 2D view types are distinguished by glyph, size and label, not by shape.
18. **“Open source location” opens the file inside VECTORA**, not in an external editor.
19. **The 2D canvas is keyboard operable but nodes are not individually exposed to assistive technology.** The Mind Map, the Search page and the inspector lists present the same content as ordinary focusable elements.
20. **PNG export captures the current view**, not the whole graph. The Mind Map exports the whole map.
21. **No screenshots** in the README or the user guide yet.
22. **A browser tab that was open during a rebuild may need a reload** to pick up new script files.

## Security

23. **The credential key is stored in the data directory** next to the database. It protects against disclosure of the database alone, not against someone who can read the whole data directory. An operating-system keystore is planned.
24. **Owner-only file permissions on the key file are not enforced on Windows.**
25. **The engine has no authentication** because it listens on the loopback interface only. Do not expose its port to a network.

## Platform and dependencies

26. **`node:sqlite` is labelled experimental by Node.js.** Its warning is suppressed at start-up. A change in a future Node.js version could require an update to `packages/graph-engine/src/store.ts`.
27. **Developed and tested on Windows 11 only**, with Node.js 24.14.1 and Microsoft Edge. macOS, Linux, Firefox and Safari were not tested.
28. **`jsdom` 31 (test dependency) declares support for Node.js 24.15 or newer**; on 24.14.1 npm prints an engine warning. The tests pass.
29. **`webgl-constants` (a transitive dependency of the 3D stack) declares no licence in its package metadata.** Flagged in `docs/LICENSES.md` for manual review.
30. **`typescript` and `web-tree-sitter` are not bundled into the engine**; `node_modules` must be present beside `dist` at run time.

## Not verified

31. **A live GitHub import.** GitHub access is tested against a local stand-in for the API, not against github.com.
32. **The optional narrative provider against a real service.** The adapter is implemented and off by default; it has not been exercised with a live endpoint.
33. **Desktop packaging.** Not built; `docs/ROADMAP.md` holds the plan.
34. **Symbolic-link handling in the scanner on Windows** is covered by a test that skips itself when the account may not create links.

## Environment note for this machine

35. The `ComSpec` environment variable on the development machine points at a MySQL folder instead of `cmd.exe`. Tools that start a shell fail with `spawn … ENOENT`. The project's own scripts avoid shells, but the variable should be corrected in the system settings.
