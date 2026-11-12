/**
 * Security helpers: credential encryption at rest, safe archive extraction
 * and path containment checks.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import ignore from 'ignore';
import yauzl from 'yauzl';
import { isBinaryPath } from '@vectora/language-adapters';

// ---------------------------------------------------------------------------
// Credentials: AES-256-GCM with a key file kept in the data directory.
// ---------------------------------------------------------------------------

export class CredentialVault {
  private key: Buffer;

  constructor(dataDir: string) {
    const file = path.join(dataDir, 'vault.key');
    if (fs.existsSync(file)) {
      this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
      if (this.key.length !== 32) throw new Error('Credential key file is corrupt');
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      this.key = randomBytes(32);
      fs.writeFileSync(file, this.key.toString('base64'), { mode: 0o600 });
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported credential format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/** Resolves `rel` under `root` and guarantees the result does not escape it. */
export function resolveInside(root: string, rel: string): string | null {
  if (rel.includes('\0')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

// ---------------------------------------------------------------------------
// ZIP handling
// ---------------------------------------------------------------------------

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  /** Uncompressed / compressed ratio above which an entry is rejected as a decompression bomb. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 100_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxRatio: 200,
};

export class ArchiveError extends Error {
  constructor(
    message: string,
    public code: 'invalid-archive' | 'too-many-entries' | 'too-large' | 'empty',
  ) {
    super(message);
  }
}

export interface ZipEntryInfo {
  path: string;
  size: number;
  directory: boolean;
}

/** Why an archive entry is not safe to extract, or null when it is. */
export function unsafeEntryReason(name: string): string | null {
  if (!name || name.includes('\0')) return 'empty or NUL in name';
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return 'absolute path';
  const parts = n.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '..')) return 'parent directory traversal';
  if (parts.some((p) => /[<>:"|?*\u0000-\u001f]/.test(p))) return 'characters not allowed in file names';
  if (parts.some((p) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p))) return 'reserved device name';
  if (parts.some((p) => p.length > 255) || n.length > 1024) return 'name too long';
  if (parts.some((p) => /[. ]$/.test(p) && p !== '.')) return 'trailing dot or space';
  return null;
}

const isSymlinkEntry = (entry: yauzl.Entry): boolean => ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // strictFileNames rejects backslashes; decodeStrings + validateEntrySizes are yauzl defaults.
    yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) reject(new ArchiveError(`Not a readable ZIP archive: ${err?.message ?? 'unknown error'}`, 'invalid-archive'));
      else resolve(zip);
    });
  });
}

export function isZipFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Local file header, or end-of-central-directory for an empty archive.
    return buf[0] === 0x50 && buf[1] === 0x4b && ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6));
  } catch {
    return false;
  }
}

export interface ZipInspection {
  entries: number;
  files: number;
  totalBytes: number;
  rejected: { path: string; reason: string }[];
  /** Candidate project roots inside the archive ('' is the archive root). */
  roots: { path: string; files: number; markers: string[] }[];
  tree: ZipEntryInfo[];
}

const ROOT_MARKERS = new Set([
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'cmakelists.txt', 'makefile', '.gitignore', 'readme.md', 'tsconfig.json',
]);

/** Lists an archive without extracting it and suggests project roots. */
export async function inspectZip(file: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ZipInspection> {
  if (!isZipFile(file)) throw new ArchiveError('The file is not a ZIP archive', 'invalid-archive');
  const zip = await openZip(file);
  const result: ZipInspection = { entries: 0, files: 0, totalBytes: 0, rejected: [], roots: [], tree: [] };
  const dirFiles = new Map<string, number>();
  const dirMarkers = new Map<string, Set<string>>();
  const top = new Map<string, ZipEntryInfo>();
  await new Promise<void>((resolve, reject) => {
    zip.on('error', (e) => reject(new ArchiveError(`Archive is damaged: ${(e as Error).message}`, 'invalid-archive')));
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      result.entries++;
      if (result.entries > limits.maxEntries) {
        zip.close();
        return reject(new ArchiveError(`Archive has more than ${limits.maxEntries} entries`, 'too-many-entries'));
      }
      const name = entry.fileName.replace(/\\/g, '/');
      const directory = name.endsWith('/');
      const reason = unsafeEntryReason(name) ?? (isSymlinkEntry(entry) ? 'symbolic link' : null);
      if (reason) {
        if (result.rejected.length < 50) result.rejected.push({ path: name.slice(0, 200), reason });
      } else if (!directory) {
        result.files++;
        result.totalBytes += entry.uncompressedSize;
        if (result.totalBytes > limits.maxTotalBytes) {
          zip.close();
          return reject(new ArchiveError('Archive is larger than the allowed uncompressed size', 'too-large'));
        }
        const parts = name.split('/');
        const base = parts[parts.length - 1]!.toLowerCase();
        for (let d = 0; d < Math.min(parts.length, 4); d++) {
          const dir = parts.slice(0, d).join('/');
          dirFiles.set(dir, (dirFiles.get(dir) ?? 0) + 1);
        }
        const dir = parts.slice(0, -1).join('/');
        if (ROOT_MARKERS.has(base) && parts.length <= 4) (dirMarkers.get(dir) ?? dirMarkers.set(dir, new Set()).get(dir)!).add(parts[parts.length - 1]!);
        // Two-level preview of the structure.
        const key = parts.slice(0, 2).join('/');
        if (top.size < 300 && !top.has(key)) top.set(key, { path: key, size: parts.length <= 2 ? entry.uncompressedSize : 0, directory: parts.length > 2 });
        if (parts.length > 1 && !top.has(parts[0]!)) top.set(parts[0]!, { path: parts[0]!, size: 0, directory: true });
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
  if (result.files === 0) throw new ArchiveError('The archive contains no files', 'empty');
  // A single wrapping directory (as produced by GitHub and most tools) is the natural root.
  const topDirs = [...dirFiles.keys()].filter((d) => d && !d.includes('/'));
  const rootFiles = dirFiles.get('') ?? 0;
  const nested = topDirs.length === 1 && dirFiles.get(topDirs[0]!) === rootFiles ? topDirs[0]! : '';
  const candidates = new Set<string>([nested, ...dirMarkers.keys()]);
  result.roots = [...candidates]
    .map((p) => ({ path: p, files: dirFiles.get(p) ?? 0, markers: [...(dirMarkers.get(p) ?? [])].sort() }))
    .filter((r) => r.files > 0)
    .sort((a, b) => (a.path === nested ? -1 : b.path === nested ? 1 : b.markers.length - a.markers.length || a.path.length - b.path.length))
    .slice(0, 12);
  result.tree = [...top.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  return result;
}

export interface ExtractOptions {
  /** Only extract entries under this archive path; it is stripped from the output paths. */
  root?: string;
  ignorePatterns?: string[];
  limits?: Partial<ZipLimits>;
}

export interface ExtractResult {
  files: number;
  bytes: number;
  skipped: { unsafe: number; symlinks: number; ignored: number; binary: number; oversized: number };
}

/**
 * Extracts an archive into `destDir`. Entries that would escape the
 * destination, symbolic links, ignored paths, binary files and oversized
 * files are skipped and counted — they are never written to disk.
 */
export async function extractZip(file: string, destDir: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  if (!isZipFile(file)) throw new ArchiveError('The file is not a ZIP archive', 'invalid-archive');
  const limits = { ...DEFAULT_ZIP_LIMITS, ...opts.limits };
  const root = (opts.root ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const ig = ignore().add(['node_modules/', '.git/', ...(opts.ignorePatterns ?? [])]);
  const dest = path.resolve(destDir);
  fs.mkdirSync(dest, { recursive: true });
  const zip = await openZip(file);
  const result: ExtractResult = { files: 0, bytes: 0, skipped: { unsafe: 0, symlinks: 0, ignored: 0, binary: 0, oversized: 0 } };
  let entries = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (e: Error) => {
      zip.close();
      reject(e);
    };
    zip.on('error', (e) => reject(new ArchiveError(`Archive is damaged: ${(e as Error).message}`, 'invalid-archive')));
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      if (++entries > limits.maxEntries) return fail(new ArchiveError(`Archive has more than ${limits.maxEntries} entries`, 'too-many-entries'));
      const name = entry.fileName.replace(/\\/g, '/');
      const next = () => zip.readEntry();
      if (name.endsWith('/')) return next();
      if (unsafeEntryReason(name)) return result.skipped.unsafe++, next();
      if (isSymlinkEntry(entry)) return result.skipped.symlinks++, next();
      if (root && !name.startsWith(`${root}/`)) return next();
      const rel = root ? name.slice(root.length + 1) : name;
      if (!rel) return next();
      if (ig.ignores(rel)) return result.skipped.ignored++, next();
      if (isBinaryPath(rel)) return result.skipped.binary++, next();
      const tooBig = entry.uncompressedSize > limits.maxFileBytes;
      const bomb = entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxRatio && entry.uncompressedSize > 1024 * 1024;
      if (tooBig || bomb) return result.skipped.oversized++, next();
      if (result.bytes + entry.uncompressedSize > limits.maxTotalBytes) return fail(new ArchiveError('Archive is larger than the allowed uncompressed size', 'too-large'));
      const target = resolveInside(dest, rel);
      if (!target) return result.skipped.unsafe++, next();
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(new ArchiveError(`Archive entry could not be read: ${err?.message ?? ''}`, 'invalid-archive'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // `wx`: never overwrite; an entry listed twice cannot replace an earlier one.
        pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o644 }))
          .then(() => {
            result.files++;
            result.bytes += entry.uncompressedSize;
            next();
          })
          .catch((e: NodeJS.ErrnoException) => (e.code === 'EEXIST' ? next() : fail(new ArchiveError(`Extraction failed: ${e.message}`, 'invalid-archive'))));
      });
    });
    zip.readEntry();
  });
  if (result.files === 0) throw new ArchiveError('No source files could be extracted from the archive', 'empty');
  return result;
}
