/**
 * SQLite persistence for repositories, knowledge graphs, cached per-file
 * analysis, sessions and settings. Uses the SQLite engine built into Node.js
 * (`node:sqlite`), so no native module has to be compiled or downloaded.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type GraphEdge, type GraphNode, type KnowledgeGraph, type NodeType, SCHEMA_VERSION, computeStats } from '@vectora/graph-schema';
import { type RepositoryRecord, type SessionState, type Settings, SettingsSchema, defaultSettings } from '@vectora/shared';

const DB_VERSION = 1;

export interface StoredRepository extends RepositoryRecord {
  /** Absolute path of the indexed source tree on this machine. */
  rootPath: string;
  /** True when VECTORA owns the source copy (GitHub / ZIP imports) and may delete it. */
  managedSource: boolean;
}

export interface CachedFacts<T = unknown> {
  path: string;
  hash: string;
  facts: T;
}

function openDatabase(file: string): DatabaseSync {
  // `node:sqlite` prints an ExperimentalWarning on first load; it is expected here.
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite is an experimental feature/.test(text)) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const require = createRequire(import.meta.url);
    const sqlite = require('node:sqlite') as typeof import('node:sqlite');
    return new sqlite.DatabaseSync(file);
  } finally {
    process.emitWarning = original;
  }
}

type Row = Record<string, unknown>;

export class Store {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();

  constructor(public readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = openDatabase(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source_kind TEXT NOT NULL, origin TEXT NOT NULL,
        branch TEXT, subdirectory TEXT, root_path TEXT NOT NULL, managed_source INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, created_at TEXT NOT NULL, last_indexed_at TEXT,
        file_count INTEGER NOT NULL DEFAULT 0, symbol_count INTEGER NOT NULL DEFAULT 0, relationship_count INTEGER NOT NULL DEFAULT 0,
        error TEXT, analysis TEXT
      );
      CREATE TABLE IF NOT EXISTS nodes (
        repo_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT, data TEXT NOT NULL,
        PRIMARY KEY (repo_id, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS nodes_type ON nodes (repo_id, type);
      CREATE INDEX IF NOT EXISTS nodes_path ON nodes (repo_id, file_path);
      CREATE TABLE IF NOT EXISTS edges (
        repo_id TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (repo_id, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS edges_source ON edges (repo_id, source);
      CREATE INDEX IF NOT EXISTS edges_target ON edges (repo_id, target);
      CREATE TABLE IF NOT EXISTS file_facts (
        repo_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, facts TEXT NOT NULL,
        PRIMARY KEY (repo_id, path)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS sessions (repo_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const v = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('db_version') as Row | undefined;
    if (!v) this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('db_version', String(DB_VERSION));
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  // ---- repositories -------------------------------------------------------

  private toRepo(r: Row): StoredRepository {
    return {
      id: r.id as string,
      name: r.name as string,
      sourceKind: r.source_kind as StoredRepository['sourceKind'],
      origin: r.origin as string,
      branch: (r.branch as string | null) ?? null,
      subdirectory: (r.subdirectory as string | null) ?? null,
      rootPath: r.root_path as string,
      managedSource: !!r.managed_source,
      status: r.status as StoredRepository['status'],
      createdAt: r.created_at as string,
      lastIndexedAt: (r.last_indexed_at as string | null) ?? null,
      fileCount: Number(r.file_count),
      symbolCount: Number(r.symbol_count),
      relationshipCount: Number(r.relationship_count),
      error: (r.error as string | null) ?? null,
    };
  }

  listRepositories(): StoredRepository[] {
    return (this.stmt('SELECT * FROM repositories ORDER BY created_at DESC').all() as Row[]).map((r) => this.toRepo(r));
  }

  getRepository(id: string): StoredRepository | null {
    const r = this.stmt('SELECT * FROM repositories WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toRepo(r) : null;
  }

  insertRepository(repo: StoredRepository): void {
    this.stmt(
      `INSERT INTO repositories (id, name, source_kind, origin, branch, subdirectory, root_path, managed_source, status, created_at, last_indexed_at, file_count, symbol_count, relationship_count, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      repo.id, repo.name, repo.sourceKind, repo.origin, repo.branch, repo.subdirectory, repo.rootPath, repo.managedSource ? 1 : 0, repo.status,
      repo.createdAt, repo.lastIndexedAt, repo.fileCount, repo.symbolCount, repo.relationshipCount, repo.error,
    );
  }

  updateRepository(id: string, patch: Partial<Pick<StoredRepository, 'status' | 'lastIndexedAt' | 'fileCount' | 'symbolCount' | 'relationshipCount' | 'error' | 'name' | 'branch'>>): void {
    const map: Record<string, string> = {
      status: 'status', lastIndexedAt: 'last_indexed_at', fileCount: 'file_count', symbolCount: 'symbol_count',
      relationshipCount: 'relationship_count', error: 'error', name: 'name', branch: 'branch',
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !map[k]) continue;
      sets.push(`${map[k]} = ?`);
      values.push(v as string | number | null);
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE repositories SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  }

  deleteRepository(id: string): void {
    this.transaction(() => {
      for (const t of ['nodes', 'edges', 'file_facts']) this.db.prepare(`DELETE FROM ${t} WHERE repo_id = ?`).run(id);
      this.db.prepare('DELETE FROM sessions WHERE repo_id = ?').run(id);
      this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
    });
  }

  getAnalysis<T>(id: string): T | null {
    const r = this.stmt('SELECT analysis FROM repositories WHERE id = ?').get(id) as Row | undefined;
    return r?.analysis ? (JSON.parse(r.analysis as string) as T) : null;
  }

  setAnalysis(id: string, analysis: unknown): void {
    this.stmt('UPDATE repositories SET analysis = ? WHERE id = ?').run(JSON.stringify(analysis), id);
  }

  // ---- graph --------------------------------------------------------------

  saveGraph(repoId: string, graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): void {
    this.transaction(() => {
      this.stmt('DELETE FROM nodes WHERE repo_id = ?').run(repoId);
      this.stmt('DELETE FROM edges WHERE repo_id = ?').run(repoId);
      const insNode = this.stmt('INSERT INTO nodes (repo_id, id, type, name, file_path, data) VALUES (?, ?, ?, ?, ?, ?)');
      for (const n of graph.nodes) insNode.run(repoId, n.id, n.type, n.name, n.filePath, JSON.stringify(n));
      const insEdge = this.stmt('INSERT INTO edges (repo_id, id, source, target, type, data) VALUES (?, ?, ?, ?, ?, ?)');
      for (const e of graph.edges) insEdge.run(repoId, e.id, e.source, e.target, e.type, JSON.stringify(e));
    });
  }

  /**
   * Loads a graph. With `types`, only nodes of those types are returned and
   * edges are limited to those between returned nodes (progressive loading).
   */
  loadGraph(repoId: string, opts: { types?: readonly NodeType[] } = {}): KnowledgeGraph {
    let nodes: GraphNode[];
    if (opts.types?.length) {
      const marks = opts.types.map(() => '?').join(',');
      nodes = (this.db.prepare(`SELECT data FROM nodes WHERE repo_id = ? AND type IN (${marks})`).all(repoId, ...opts.types) as Row[]).map(
        (r) => JSON.parse(r.data as string) as GraphNode,
      );
    } else {
      nodes = (this.stmt('SELECT data FROM nodes WHERE repo_id = ?').all(repoId) as Row[]).map((r) => JSON.parse(r.data as string) as GraphNode);
    }
    let edges = (this.stmt('SELECT data FROM edges WHERE repo_id = ?').all(repoId) as Row[]).map((r) => JSON.parse(r.data as string) as GraphEdge);
    if (opts.types?.length) {
      const ids = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }
    const analysis = this.getAnalysis<{ unresolvedCount?: number; generatedAt?: string }>(repoId);
    return {
      schemaVersion: SCHEMA_VERSION,
      repositoryId: repoId,
      generatedAt: analysis?.generatedAt ?? new Date().toISOString(),
      nodes,
      edges,
      stats: computeStats(nodes, edges, analysis?.unresolvedCount ?? 0),
    };
  }

  /** Nodes whose members were left out by a typed load, e.g. the symbols of one file. */
  loadNodesByFile(repoId: string, filePath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = (this.stmt('SELECT data FROM nodes WHERE repo_id = ? AND file_path = ?').all(repoId, filePath) as Row[]).map(
      (r) => JSON.parse(r.data as string) as GraphNode,
    );
    const edges = new Map<string, GraphEdge>();
    const bySource = this.stmt('SELECT data FROM edges WHERE repo_id = ? AND source = ?');
    const byTarget = this.stmt('SELECT data FROM edges WHERE repo_id = ? AND target = ?');
    for (const n of nodes) {
      for (const r of [...(bySource.all(repoId, n.id) as Row[]), ...(byTarget.all(repoId, n.id) as Row[])]) {
        const e = JSON.parse(r.data as string) as GraphEdge;
        edges.set(e.id, e);
      }
    }
    return { nodes, edges: [...edges.values()] };
  }

  countGraph(repoId: string): { nodes: number; edges: number } {
    const n = this.stmt('SELECT COUNT(*) AS c FROM nodes WHERE repo_id = ?').get(repoId) as Row;
    const e = this.stmt('SELECT COUNT(*) AS c FROM edges WHERE repo_id = ?').get(repoId) as Row;
    return { nodes: Number(n.c), edges: Number(e.c) };
  }

  // ---- cached per-file analysis ------------------------------------------

  saveFacts(repoId: string, entries: CachedFacts[]): void {
    this.transaction(() => {
      this.stmt('DELETE FROM file_facts WHERE repo_id = ?').run(repoId);
      const ins = this.stmt('INSERT INTO file_facts (repo_id, path, hash, facts) VALUES (?, ?, ?, ?)');
      for (const e of entries) ins.run(repoId, e.path, e.hash, JSON.stringify(e.facts));
    });
  }

  loadFacts<T = unknown>(repoId: string): Map<string, CachedFacts<T>> {
    const out = new Map<string, CachedFacts<T>>();
    for (const r of this.stmt('SELECT path, hash, facts FROM file_facts WHERE repo_id = ?').all(repoId) as Row[])
      out.set(r.path as string, { path: r.path as string, hash: r.hash as string, facts: JSON.parse(r.facts as string) as T });
    return out;
  }

  clearFacts(repoId?: string): void {
    if (repoId) this.stmt('DELETE FROM file_facts WHERE repo_id = ?').run(repoId);
    else this.db.exec('DELETE FROM file_facts');
  }

  // ---- sessions, settings, credentials -----------------------------------

  getSession(repoId: string): SessionState | null {
    const r = this.stmt('SELECT data FROM sessions WHERE repo_id = ?').get(repoId) as Row | undefined;
    return r ? (JSON.parse(r.data as string) as SessionState) : null;
  }

  saveSession(repoId: string, session: SessionState): void {
    this.stmt('INSERT INTO sessions (repo_id, data) VALUES (?, ?) ON CONFLICT(repo_id) DO UPDATE SET data = excluded.data').run(repoId, JSON.stringify(session));
  }

  getSettings(): Settings {
    const r = this.stmt('SELECT data FROM settings WHERE id = 1').get() as Row | undefined;
    if (!r) return defaultSettings();
    const parsed = SettingsSchema.safeParse(JSON.parse(r.data as string));
    return parsed.success ? parsed.data : defaultSettings();
  }

  saveSettings(settings: Settings): void {
    this.stmt('INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(JSON.stringify(settings));
  }

  getCredential(name: string): string | null {
    const r = this.stmt('SELECT value FROM credentials WHERE name = ?').get(name) as Row | undefined;
    return r ? (r.value as string) : null;
  }

  setCredential(name: string, encryptedValue: string): void {
    this.stmt('INSERT INTO credentials (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(
      name, encryptedValue, new Date().toISOString(),
    );
  }

  deleteCredential(name: string): void {
    this.stmt('DELETE FROM credentials WHERE name = ?').run(name);
  }

  listCredentials(): { name: string; updatedAt: string }[] {
    return (this.stmt('SELECT name, updated_at FROM credentials ORDER BY name').all() as Row[]).map((r) => ({ name: r.name as string, updatedAt: r.updated_at as string }));
  }

  /** Removes every repository, graph, cache, session and credential. Settings are kept unless asked. */
  deleteAllData(includeSettings = false): void {
    this.transaction(() => {
      for (const t of ['nodes', 'edges', 'file_facts', 'sessions', 'repositories', 'credentials']) this.db.exec(`DELETE FROM ${t}`);
      if (includeSettings) this.db.exec('DELETE FROM settings');
    });
    this.db.exec('VACUUM');
  }
}
