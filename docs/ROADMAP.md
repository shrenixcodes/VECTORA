# Roadmap

Items are grouped by intent, not by date. Nothing here is a commitment.

## Next

- **Operating-system credential store.** Keep the vault key in Windows Credential Manager, macOS Keychain or the Secret Service instead of a file.
- **Faster incremental TypeScript indexing.** Reuse the previous compiler program between runs inside a long-lived worker so that unchanged files are not parsed again.
- **Receiver type inference for Python and tier-2 languages**, so that calls on local variables with an evident type (`x = Foo(); x.bar()`) can be resolved.
- **Watch mode** for local folders, off by default, re-indexing after changes settle.
- **Node shapes in the 2D view** to match the 3D shapes.
- **Screenshots** in the README and the user guide.
- **Mounted routers and route prefixes** (`app.use('/api', router)`) reflected in endpoint paths.
- **Rendering benchmarks** measured in a browser (frame times while panning and zooming large graphs).

## Later

- More languages through Tree-sitter: Kotlin, Swift, Ruby, PHP.
- Git awareness: changed-since, ownership, comparison between two indexed states.
- Search inside source text, not only names and documentation.
- Saved, named views and annotations on nodes.
- Import from other hosts (GitLab, Bitbucket).

## Desktop packaging plan (Tauri 2)

The first release is a web application served by the local engine. A desktop build is planned as an optional distribution and is **not built yet**; no desktop artifact exists.

**Approach.** A Tauri 2 shell with the engine as a sidecar process.

1. **Sidecar.** Package the engine bundle (`dist/engine`) together with a Node.js runtime as a sidecar binary, or compile it to a single executable with the single-executable-application support in Node.js. `typescript` and `web-tree-sitter` load files from disk at run time, so they are shipped as resources next to the sidecar. Open question to settle first: single-executable packaging with those two packages has not been tried.
2. **Shell.** `src-tauri` with one window loading the built web application (`dist/web`). On start the shell picks a free loopback port, launches the sidecar with `VECTORA_PORT` and a data directory under the per-user application data folder, waits for `/api/health`, then opens the window at `http://127.0.0.1:<port>`.
3. **Permissions.** Tauri capabilities limited to: starting the sidecar, the dialog plugin for a native folder picker (replacing the built-in folder browser), and opening external links. No general file-system or shell access for the web content.
4. **Engine origin checks.** Add the Tauri origin to `VECTORA_ALLOWED_ORIGINS` for the sidecar only.
5. **Python.** Keep using the system interpreter and show the existing notice when none is found; do not bundle one.
6. **Updates and signing.** Tauri updater with signed releases; Windows code signing and macOS notarisation are prerequisites for distribution.
7. **Verification.** Reuse the Playwright journeys against the packaged application through the WebDriver support of Tauri.

**Prerequisites on the build machine.** Rust toolchain, the platform webview (WebView2 on Windows) and the Tauri CLI. The repository does not contain `src-tauri` yet.
