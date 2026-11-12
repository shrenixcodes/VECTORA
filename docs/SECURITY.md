# Security and privacy

Repository contents can be confidential. VECTORA is designed so that analysing a repository does not expose it, and so that a hostile repository or archive cannot harm the machine that analyses it.

## What stays local, what leaves

| Data | Where it goes |
|---|---|
| Source code, graph, analysis, search index, sessions, settings | Stays on this machine, in the data directory |
| Access tokens | Stored encrypted in the data directory. Sent only to `api.github.com`, in the `Authorization` header |
| GitHub imports | The engine requests repository metadata, branches and a source archive from `api.github.com`. Only when you start a GitHub import |
| Optional narrative service (off by default) | When enabled: the question and the findings already shown on screen (symbol names, file paths, one short evidence line per finding) are sent to the endpoint you configured. Whole files are never sent |
| Fonts, scripts, styles | Bundled. The application makes no requests to third-party hosts |

There is no telemetry and no account.

## Threat model

| Threat | Protection |
|---|---|
| A web page in the user's browser calls the local engine | The engine binds to `127.0.0.1`. Requests whose `Host` is not a loopback name are refused (DNS rebinding). Requests with an `Origin` other than the engine's own or an allowed development origin are refused, as are state-changing requests marked cross-site. CORS allows only those origins |
| A malicious ZIP archive (path traversal, absolute paths, symlinks, decompression bomb, device names, overlong names) | Archives are inspected before extraction. Entries with unsafe names are rejected; symbolic-link entries are skipped; each write is checked to stay inside the destination; files are created with exclusive-create so an entry cannot overwrite another; limits apply to entry count (100,000), total uncompressed size (2 GB), per-file size and compression ratio; uploads are limited to 512 MB |
| A file that is not an archive | The signature is checked; the upload is deleted and the reason reported |
| A repository that tries to run code during analysis | Nothing from the repository is executed. No scripts, no hooks, no dependency installation. Git is never invoked: GitHub repositories arrive as archives and a local branch name is read from `.git/HEAD` as a text file. Python sources are parsed, not imported, by an interpreter started in isolated mode |
| Symbolic links pointing outside the repository | Not followed during scanning; link entries are skipped |
| Reading arbitrary files through the source API | Only paths that are file nodes in the indexed graph are served; the resolved real path must stay inside the repository root; reads are capped at 2 MB |
| Credential leakage | Tokens are accepted only in request bodies, never in URLs (a URL containing credentials is rejected with an explanation). Stored values are encrypted with AES-256-GCM. The credentials API returns names and dates only. Request bodies are never logged; authorization headers are removed from logs; log text passes through secret redaction. Exports and repository records contain no credentials |
| Source text rendered as markup | Source and documentation are rendered as text. The Markdown renderer ignores raw HTML and only allows `http`, `https` and `mailto` links; images in repository documents are not loaded |
| Private code leaving through an export | Graph exports omit evidence lines, signatures and doc comments unless source inclusion is requested explicitly; the export dialog warns when it is on |
| Debug access in release builds | The engine has no debug, environment or configuration endpoints. Error responses carry a message only; stack traces are not logged in production mode |

Response headers on every reply: a Content Security Policy restricted to the engine's own origin, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.

## Credential storage

The key is 32 random bytes in `vault.key` inside the data directory, created with owner-only permissions where the file system supports them. Each value is encrypted with AES-256-GCM and a fresh nonce.

Limitation: the key is stored next to the database. This protects stored tokens against casual disclosure (a copied database file, a backup of the database alone, a log) but not against someone who can read the whole data directory as your user. Integration with the operating system's credential store is on the roadmap. On Windows the owner-only file mode is not enforced by the file system; rely on the permissions of your user profile or data folder.

## Local engine exposure

The folder browser used by the local import dialog lists directory names on this machine. It is reachable only through the loopback interface and is subject to the host and origin checks above. Do not expose the engine's port to a network: it has no authentication because it is meant to be reachable only from the same machine. Setting `VECTORA_HOST` to a non-loopback address is not supported.

## Dependencies

- `npm audit --omit=dev` reports no known vulnerabilities at the time of writing. An advisory in the static-file plugin found during development was resolved by upgrading it.
- `npm run licenses` writes `docs/LICENSES.md`, the licence inventory of the production dependency closure.

## Verification

The checks above are covered by automated tests in `tests/integration/engine.test.ts`: traversal and unsafe names, symbolic links, oversized and invalid archives, entry and size limits, path containment, host and origin checks, absence of debug endpoints, credential handling (not in URLs, logs, responses, exports or in clear text in the database), and source-free exports.

## Reporting a problem

Open an issue describing the behaviour and how to reproduce it. Do not include private source code or tokens in the report.
