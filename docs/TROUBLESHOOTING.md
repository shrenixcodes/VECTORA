# Troubleshooting

## The page says the local engine is not reachable

The web application needs the engine. Start it with `npm start` (after `npm run build`) or `npm run dev`, then reload. If port 4317 is taken, set `VECTORA_PORT` to another port before starting.

## `npm start` cannot find the server file

Run `npm run build` first. `npm start` runs `dist/engine/server.mjs`.

## A blank page after rebuilding

The application shell is served without caching, but a browser tab opened before a rebuild may still hold old script files. Reload the tab; if it persists, do a hard reload (Ctrl+Shift+R).

## Python files show no symbols

VECTORA analyses Python with a Python 3 interpreter found as `python3`, `python` or `py -3`. Settings → Repository shows a notice when none is found. Install Python 3.8 or newer, or set `VECTORA_PYTHON` to the path of the interpreter, restart the engine and re-index.

## Many references are “unresolved”

That is expected for calls on values whose type cannot be known from the syntax alone (for example `client.send()` where `client` is a parameter) in Python and the tier-2 languages. VECTORA lists them instead of guessing. Dependency Explorer → Unresolved references groups them by reason. TypeScript and JavaScript resolve far more because the type checker is used.

## A file or folder is missing from the graph

Check, in order: your ignore patterns (Settings → Repository) and the `.gitignore` files of the repository; the maximum file size; whether the file is binary, generated or minified; and the file limit (Settings → Performance). The number of files skipped for each reason is part of the analysis (`/api/repositories/<id>/analysis`, field `skipped`).

## Indexing is slow or uses a lot of memory

- TypeScript analysis builds one compiler program for the whole repository in a single worker; it is the main cost for large TypeScript repositories. See [PERFORMANCE.md](PERFORMANCE.md) for measured figures.
- Lower *Maximum files per repository*, add ignore patterns for folders you do not need (fixtures, generated code, vendored code), or import a subdirectory.
- Keep *Indexing cache* and *Incremental indexing* on so later runs reuse earlier work.

## The graph is crowded or slow to draw

Set *Node density* to *Structure* (files only; unfold a file to see its symbols), hide relationship types in *Filters and legend*, use focus mode on a node, lower *Rendering quality* and *Label density*. Above the *Maximum nodes on screen* limit the graph loads progressively.

## The 3D Atlas says 3D rendering is not available

The browser has no WebGL (often a remote desktop session, a virtual machine, or hardware acceleration switched off). Use the 2D Graph Explorer, which shows the same graph, or enable hardware acceleration in the browser.

## The 3D Atlas says it lost its graphics context

The browser reclaimed graphics memory, usually under memory pressure or after the display driver restarted. Choose *Start the 3D view again*. Your selection and filters are kept.

## A GitHub import fails

| Message | Cause |
|---|---|
| Repository not found. If it is private, add an access token | The repository does not exist, or it is private |
| GitHub rejected the access token | The token is wrong or expired |
| GitHub refused the request (rate limit…) | Unauthenticated requests are limited per hour; add a token |
| Do not put credentials in the URL | Remove the token from the URL and use the token field |
| The folder “…” does not exist on branch … | The subdirectory is not on that branch |

## A ZIP import is rejected

The file is not a ZIP archive, is damaged, has more than 100,000 entries, or expands to more than 2 GB. Entries with unsafe names and symbolic links are skipped rather than failing the whole import; the import screen lists them.

## “Indexing was interrupted. Re-index to continue.”

The engine was stopped during indexing. Open the repository and choose the refresh button.

## “The graph store was upgraded. Re-index this repository.”

The database layout changed between versions. Re-index; nothing else is needed.

## Tools fail with “spawn … ENOENT” on Windows

Some tools start a shell through the `ComSpec` environment variable. If it does not point at `C:\Windows\System32\cmd.exe`, they fail. The scripts in this repository (`npm run build`, `npm run dev`, `npm run test:e2e`) do not use a shell for this reason, but other tools may. Check the variable in *System Properties → Environment Variables*.

## Starting over

Settings → Privacy → *Delete all VECTORA data*, or stop the engine and delete the data folder (`.vectora-data` by default).
