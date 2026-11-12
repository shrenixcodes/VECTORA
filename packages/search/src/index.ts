/**
 * Search over knowledge-graph nodes: exact names, partial matches, file
 * paths, qualified symbol names and descriptions. Runs in the engine and in
 * the browser.
 */
import type { GraphNode, NodeType } from '@vectora/graph-schema';

export interface SearchHit {
  node: GraphNode;
  score: number;
  /** Which field matched, for display. */
  match: 'name' | 'qualified' | 'path' | 'description' | 'fuzzy';
}

export interface SearchOptions {
  types?: readonly NodeType[];
  limit?: number;
}

interface Entry {
  node: GraphNode;
  name: string;
  qualified: string;
  path: string;
  description: string;
  tokens: string[];
}

export const splitIdentifier = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const TYPE_WEIGHT: Partial<Record<NodeType, number>> = {
  Concept: 6,
  Subsystem: 6,
  Class: 5,
  DatabaseModel: 5,
  Component: 5,
  Interface: 4,
  ApiEndpoint: 4,
  Function: 4,
  Method: 3,
  Module: 3,
  File: 3,
  Type: 2,
  Package: 2,
  Configuration: 1,
  Directory: 1,
  Constant: 1,
  Variable: 0,
};

/** True when every character of `needle` appears in `hay` in order. */
function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

export class SearchIndex {
  private entries: Entry[];

  constructor(nodes: GraphNode[]) {
    this.entries = nodes.map((node) => {
      const qualified = String(node.metadata.qualifiedName ?? node.name);
      return {
        node,
        name: node.name.toLowerCase(),
        qualified: qualified.toLowerCase(),
        path: (node.filePath ?? '').toLowerCase(),
        description: (node.description ?? '').toLowerCase(),
        tokens: splitIdentifier(`${node.name} ${qualified}`),
      };
    });
  }

  get size(): number {
    return this.entries.length;
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const raw = query.trim();
    if (!raw) return [];
    const q = raw.toLowerCase();
    const qTokens = splitIdentifier(raw);
    const types = opts.types ? new Set(opts.types) : null;
    const limit = opts.limit ?? 30;
    const pathLike = q.includes('/') || /\.[a-z]{1,4}$/.test(q);
    const hits: SearchHit[] = [];
    for (const e of this.entries) {
      if (types && !types.has(e.node.type)) continue;
      let score = 0;
      let match: SearchHit['match'] = 'name';
      if (e.node.name === raw) score = 100;
      else if (e.name === q) score = 92;
      else if (e.qualified === q) (score = 90), (match = 'qualified');
      else if (e.name.startsWith(q)) score = 75 - Math.min(15, e.name.length - q.length);
      else if (e.name.includes(q)) score = 58 - Math.min(15, (e.name.length - q.length) / 2);
      else if (e.qualified.includes(q)) (score = 50), (match = 'qualified');
      else if (qTokens.length > 1 && qTokens.every((t) => e.tokens.some((et) => et.startsWith(t)))) score = 48;
      if (score < 60 && e.path) {
        // A path names a file: the file itself ranks above the symbols defined in it.
        const fileLike = e.node.type === 'File' || e.node.type === 'Configuration' || e.node.type === 'Directory' || e.node.type === 'Module';
        if (e.path === q) (score = Math.max(score, fileLike ? 88 : 34)), (match = 'path');
        else if (pathLike && e.path.endsWith(q)) (score = Math.max(score, fileLike ? 70 : 28)), (match = 'path');
        else if (e.path.includes(q) && score < 40) {
          // Path-only matches favour the file itself over its symbols.
          score = e.node.type === 'File' || e.node.type === 'Configuration' || e.node.type === 'Directory' || e.node.type === 'Module' ? 40 : 18;
          match = 'path';
        }
      }
      if (score === 0 && e.description && e.description.includes(q)) (score = 22), (match = 'description');
      if (score === 0 && qTokens.length && qTokens.every((t) => e.description.includes(t) || e.tokens.some((et) => et.startsWith(t)))) (score = 16), (match = 'description');
      if (score === 0 && q.length >= 3 && q.length <= 24 && !q.includes(' ') && subsequence(q, e.name)) (score = 10), (match = 'fuzzy');
      if (score === 0) continue;
      hits.push({ node: e.node, score: score + (TYPE_WEIGHT[e.node.type] ?? 0), match });
    }
    hits.sort((a, b) => b.score - a.score || a.node.name.length - b.node.name.length || (a.node.id < b.node.id ? -1 : 1));
    return hits.slice(0, limit);
  }
}

export function searchNodes(nodes: GraphNode[], query: string, opts: SearchOptions = {}): SearchHit[] {
  return new SearchIndex(nodes).search(query, opts);
}

export interface DocumentHit {
  path: string;
  line: number;
  snippet: string;
  heading: string | null;
}

/** Plain-text search inside documentation files. */
export function searchDocuments(docs: { path: string; content: string }[], query: string, limit = 20): DocumentHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: DocumentHit[] = [];
  for (const d of docs) {
    const lines = d.content.split(/\r?\n/);
    let heading: string | null = null;
    let perDoc = 0;
    for (let i = 0; i < lines.length && hits.length < limit && perDoc < 3; i++) {
      const line = lines[i]!;
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) heading = h[1]!.trim();
      if (line.toLowerCase().includes(q)) {
        const text = line.trim();
        hits.push({ path: d.path, line: i + 1, snippet: text.length > 200 ? `${text.slice(0, 197)}...` : text, heading });
        perDoc++;
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}
