/**
 * Stage 1 — repository discovery: enumerate files, honour ignore rules, skip
 * binary / oversized / generated content and detect languages.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { detectLanguage, isBinaryPath, languageTier, looksGenerated } from '@vectora/language-adapters';
import { DEFAULT_IGNORE_PATTERNS } from '@vectora/shared';

export interface ScannedFile {
  path: string;
  absPath: string;
  size: number;
  language: string | null;
  hash: string;
  lineCount: number;
  /** True when the file is in a language with a symbol-level adapter. */
  analyzable: boolean;
}

export interface ScanOptions {
  ignorePatterns?: string[];
  maxFileSizeBytes?: number;
  maxFiles?: number;
  respectGitignore?: boolean;
  disabledLanguages?: string[];
  onProgress?: (processed: number, total: number) => void;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: {
    ignored: number;
    binary: number;
    oversized: number;
    generated: number;
    symlinks: number;
    unreadable: number;
    overLimit: number;
  };
  truncated: boolean;
}

/** Directories that are never worth descending into, regardless of ignore files. */
const HARD_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/.hg/**', '**/.svn/**'];

function loadGitignores(root: string, gitignorePaths: string[]): { dir: string; ig: Ignore }[] {
  const out: { dir: string; ig: Ignore }[] = [];
  for (const rel of gitignorePaths) {
    try {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      out.push({ dir, ig: ignore().add(content) });
    } catch {
      // unreadable ignore file: skip it
    }
  }
  // Parent rules first.
  return out.sort((a, b) => a.dir.length - b.dir.length);
}

export async function scanRepository(rootDir: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const root = path.resolve(rootDir);
  const maxSize = opts.maxFileSizeBytes ?? 512 * 1024;
  const maxFiles = opts.maxFiles ?? 20000;
  const skipped = {
    ignored: 0,
    binary: 0,
    oversized: 0,
    generated: 0,
    symlinks: 0,
    unreadable: 0,
    overLimit: 0,
  };

  const entries = await fg('**/*', {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    stats: true,
    suppressErrors: true,
    ignore: HARD_EXCLUDES,
  });

  const settingsIgnore = ignore().add(opts.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS);
  const gitignores =
    opts.respectGitignore === false
      ? []
      : loadGitignores(
          root,
          entries.map((e) => e.path).filter((p) => p === '.gitignore' || p.endsWith('/.gitignore')),
        );
  const disabled = new Set(opts.disabledLanguages ?? []);

  const isIgnored = (rel: string): boolean => {
    if (settingsIgnore.ignores(rel)) return true;
    for (const g of gitignores) {
      if (g.dir === '') {
        if (g.ig.ignores(rel)) return true;
      } else if (rel.startsWith(`${g.dir}/`)) {
        if (g.ig.ignores(rel.slice(g.dir.length + 1))) return true;
      }
    }
    return false;
  };

  const candidates: { rel: string; size: number }[] = [];
  for (const e of entries) {
    const rel = e.path;
    if (e.stats?.isSymbolicLink() || e.dirent.isSymbolicLink()) {
      skipped.symlinks++;
      continue;
    }
    if (isIgnored(rel)) {
      skipped.ignored++;
      continue;
    }
    if (isBinaryPath(rel)) {
      skipped.binary++;
      continue;
    }
    const size = e.stats?.size ?? 0;
    if (size > maxSize) {
      skipped.oversized++;
      continue;
    }
    candidates.push({ rel, size });
  }
  candidates.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  let truncated = false;
  let list = candidates;
  if (candidates.length > maxFiles) {
    truncated = true;
    skipped.overLimit = candidates.length - maxFiles;
    // Prefer analysable source files when the limit is hit.
    const score = (p: string) => (languageTier(detectLanguage(p) ?? '') > 0 ? 0 : 1);
    list = [...candidates]
      .sort((a, b) => score(a.rel) - score(b.rel) || (a.rel < b.rel ? -1 : 1))
      .slice(0, maxFiles);
    list.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  }

  const files: ScannedFile[] = [];
  let processed = 0;
  for (const c of list) {
    processed++;
    if (processed % 200 === 0) opts.onProgress?.(processed, list.length);
    const absPath = path.join(root, c.rel);
    let buf: Buffer;
    try {
      // lstat again: the listing may be stale and we never follow links out of the tree.
      if (fs.lstatSync(absPath).isSymbolicLink()) {
        skipped.symlinks++;
        continue;
      }
      buf = fs.readFileSync(absPath);
    } catch {
      skipped.unreadable++;
      continue;
    }
    // Binary content without a known binary extension: NUL byte in the first 8 KB.
    if (buf.subarray(0, 8192).includes(0)) {
      skipped.binary++;
      continue;
    }
    const language = detectLanguage(c.rel);
    const tier = language ? languageTier(language) : 0;
    if (tier > 0 && looksGenerated(c.rel, buf.subarray(0, 4096).toString('utf8'))) {
      skipped.generated++;
      continue;
    }
    let lineCount = 1;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lineCount++;
    files.push({
      path: c.rel,
      absPath,
      size: buf.length,
      language,
      hash: createHash('sha1').update(buf).digest('hex'),
      lineCount,
      analyzable: tier > 0 && !disabled.has(language ?? ''),
    });
  }
  opts.onProgress?.(list.length, list.length);
  return { files, skipped, truncated };
}
