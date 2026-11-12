// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '@vectora/graph-schema';
import { Notice, NumberField, SelectField, Toggle, TypeMark } from '@/components/ui';
import { buildAdjacency, deriveView, neighbourhood, relationsOf } from '@/lib/graphView';
import { useWorkspace } from '@/lib/store';
import { DARK, FAMILY_GLYPH, LIGHT, NODE_FAMILY, NODE_SIZE, mix, nodeColor } from '@/lib/tokens';
import { About } from '@/pages/About';
import { Landing } from '@/pages/Landing';
import { buildTree } from '@/workspace/MindMap';
import { ROOT, indexSample } from '../helpers';

let graph: KnowledgeGraph;
beforeAll(async () => {
  graph = (await indexSample()).graph;
  // jsdom has no layout or canvas; the components under test only need these to exist.
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"offline"}', { status: 503, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => cleanup());

const page = (el: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );

describe('design tokens', () => {
  it('uses the specified palette', () => {
    expect(LIGHT).toMatchObject({ surface: '#F3F1EA', text: '#20211F', textMuted: '#8C897F', ash: '#B8B3A7', indigo: '#34445C', clay: '#A18C72', line: '#DCD8CE', canvas: '#F8F7F2' });
    expect(DARK).toMatchObject({ canvas: '#171816', surface: '#20211F', elevated: '#272824', text: '#ECEAE2', textSecondary: '#A7A499', textMuted: '#77766D', line: '#373832', indigo: '#8292AD', clay: '#B39A7A' });
  });

  it('keeps the stylesheet in step with the token source', () => {
    const css = fs.readFileSync(path.join(ROOT, 'apps/web/src/styles.css'), 'utf8').toLowerCase();
    const light = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"));
    const dark = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf(":root[data-motion='reduced']"));
    const names: Record<string, string> = { canvas: 'canvas', surface: 'surface', elevated: 'elevated', text: 'text', textSecondary: 'text-secondary', textMuted: 'text-muted', line: 'line', indigo: 'indigo', clay: 'clay', ash: 'ash', success: 'success', warning: 'warning', error: 'error', selection: 'selection', relationActive: 'relation-active', relationUnverified: 'relation-unverified' };
    for (const [key, cssName] of Object.entries(names)) {
      expect(light, `light ${key}`).toContain(`--${cssName}: ${LIGHT[key as keyof typeof LIGHT].toLowerCase()};`);
      expect(dark, `dark ${key}`).toContain(`--${cssName}: ${DARK[key as keyof typeof DARK].toLowerCase()};`);
    }
    for (const font of ['zen kaku gothic new', 'shippori mincho', 'ibm plex mono']) expect(css).toContain(font);
  });

  it('meets WCAG AA contrast for text on its backgrounds in both themes', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const p of [LIGHT, DARK]) {
      for (const bg of [p.canvas, p.surface, p.elevated]) {
        expect(ratio(p.text, bg)).toBeGreaterThanOrEqual(7);
        expect(ratio(p.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
        for (const c of [p.indigo, p.success, p.warning, p.error]) expect(ratio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        // Muted text is used for metadata at small sizes: it must stay above the 3:1 floor for non-essential text.
        expect(ratio(p.textMuted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('gives every node type a glyph, a size and a colour, with the repository largest', () => {
    for (const type of Object.keys(NODE_FAMILY) as (keyof typeof NODE_FAMILY)[]) {
      expect(FAMILY_GLYPH[NODE_FAMILY[type]]).toBeTruthy();
      expect(nodeColor(type, LIGHT)).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(NODE_SIZE.Repository).toBeGreaterThan(NODE_SIZE.Subsystem);
    expect(NODE_SIZE.Subsystem).toBeGreaterThan(NODE_SIZE.File);
    expect(NODE_SIZE.File).toBeGreaterThan(NODE_SIZE.Function);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('shared graph view', () => {
  const base = { density: 'full' as const, expandedIds: [], hiddenNodeTypes: [], hiddenEdgeTypes: [], showUnverified: true, focusId: null, maxNodes: 10000 };

  it('shows the whole graph at full density and only edges between visible nodes', () => {
    const adj = buildAdjacency(graph);
    const v = deriveView(graph, adj, base);
    expect(v.nodes.length).toBe(graph.nodes.length);
    expect(v.edges.length).toBe(graph.edges.length);
    const hidden = deriveView(graph, adj, { ...base, hiddenNodeTypes: ['Package'], hiddenEdgeTypes: ['CONTAINS'] });
    const ids = new Set(hidden.nodes.map((n) => n.id));
    expect(hidden.nodes.some((n) => n.type === 'Package')).toBe(false);
    expect(hidden.edges.every((e) => e.type !== 'CONTAINS' && ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('folds symbols into files at structure density until the file is expanded', () => {
    const adj = buildAdjacency(graph);
    const folded = deriveView(graph, adj, { ...base, density: 'structure' });
    expect(folded.nodes.some((n) => n.type === 'Function')).toBe(false);
    expect(folded.collapsedSymbols).toBe(graph.stats.symbolCount);
    const open = deriveView(graph, adj, { ...base, density: 'structure', expandedIds: ['file:web/src/config.ts'] });
    expect(open.nodes.filter((n) => n.filePath === 'web/src/config.ts').map((n) => n.name)).toEqual(expect.arrayContaining(['loadConfig', 'AppConfig', 'DEFAULT_PORT']));
    const pinned = deriveView(graph, adj, { ...base, density: 'structure', pinnedIds: ['sym:web/src/auth/session.ts#verifyToken'] });
    expect(pinned.nodes.some((n) => n.name === 'verifyToken')).toBe(true);
  });

  it('hides derived relationships on request, limits nodes and supports focus mode', () => {
    const adj = buildAdjacency(graph);
    expect(deriveView(graph, adj, { ...base, showUnverified: false }).edges.every((e) => e.verified)).toBe(true);
    const limited = deriveView(graph, adj, { ...base, maxNodes: 40 });
    expect(limited.nodes).toHaveLength(40);
    expect(limited.truncated).toBe(true);
    expect(limited.nodes.some((n) => n.type === 'Repository')).toBe(true);
    const focus = deriveView(graph, adj, { ...base, focusId: 'sym:web/src/auth/session.ts#verifyToken', focusDepth: 1 });
    const names = focus.nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['verifyToken', 'requireAuth', 'session.ts']));
    expect(names).not.toContain('NoteRepository');
  });

  it('describes a node: parent, relationships, concepts and neighbourhood', () => {
    const adj = buildAdjacency(graph);
    const r = relationsOf('sym:web/src/auth/session.ts#verifyToken', adj);
    expect(r.parent?.id).toBe('file:web/src/auth/session.ts');
    expect(r.incoming.map((e) => e.source)).toContain('sym:web/src/auth/middleware.ts#requireAuth');
    expect(r.outgoing.map((e) => e.target)).toContain('sym:web/src/auth/session.ts#Session');
    expect(r.concepts.map((c) => c.name)).toContain('Authentication');
    expect(r.subsystem?.name).toBe('Web');
    const nb = neighbourhood('sym:web/src/auth/session.ts#verifyToken', graph.edges);
    expect(nb.nodes.has('sym:web/src/auth/middleware.ts#requireAuth')).toBe(true);
  });

  it('builds the mind map hierarchy from the same graph', () => {
    const adj = buildAdjacency(graph);
    const tree = buildTree(adj, new Set())!;
    expect(tree.nodeId).toBe('repo:root');
    const labels = tree.children.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['Web', 'Analytics', 'Tools', 'Concepts']));
    const find = (item: typeof tree, label: string): typeof tree | undefined => (item.label === label ? item : item.children.map((c) => find(c, label)).find(Boolean));
    const session = find(tree.children.find((c) => c.label === 'Web')!, 'session.ts')!;
    expect(session.nodeId).toBe('file:web/src/auth/session.ts');
    expect(session.children.map((c) => c.label)).toEqual(['Session', 'sessions', 'createSession', 'verifyToken']);
    const service = find(tree, 'NoteService')!;
    expect(service.children.map((c) => c.label)).toEqual(expect.arrayContaining(['list', 'create']));
    const concepts = tree.children.find((c) => c.label === 'Concepts')!;
    expect(concepts.derived).toBe(true);
    expect(find(concepts, 'Authentication')!.children.map((c) => c.label)).toContain('session.ts');
    // Every tree item that represents a graph node points at a node that exists.
    const walk = (i: typeof tree): void => {
      if (i.nodeId) expect(adj.nodes.has(i.nodeId), i.key).toBe(true);
      i.children.forEach(walk);
    };
    walk(tree);
  });
});

describe('workspace selection state', () => {
  it('shares selection, multi-selection, focus and session snapshots', () => {
    const s = useWorkspace.getState();
    s.hydrate('r1', null, { hiddenEdgeTypes: ['DEFINED_IN'] });
    s.select('a');
    s.select('b', { additive: true });
    expect(useWorkspace.getState()).toMatchObject({ selectedIds: ['a', 'b'], primaryId: 'b', inspectorOpen: true });
    s.select('b', { additive: true });
    expect(useWorkspace.getState()).toMatchObject({ selectedIds: ['a'], primaryId: 'a' });
    const tick = useWorkspace.getState().revealTick;
    s.select('c', { reveal: true });
    expect(useWorkspace.getState().revealTick).toBe(tick + 1);
    s.setFocus('c');
    s.toggleExpanded('file:x');
    s.setLayout('graph', { c: [1, 2] });
    const snap = useWorkspace.getState().snapshot('atlas');
    expect(snap).toMatchObject({ view: 'atlas', selectedIds: ['c'], focusId: 'c', expandedIds: ['file:x'], hiddenEdgeTypes: ['DEFINED_IN'], layouts: { graph: { c: [1, 2] } } });
    useWorkspace.getState().hydrate('r1', snap, { hiddenEdgeTypes: [] });
    expect(useWorkspace.getState()).toMatchObject({ selectedIds: ['c'], primaryId: 'c', focusId: 'c', expandedIds: ['file:x'] });
    s.clearSelection();
    expect(useWorkspace.getState().primaryId).toBeNull();
  });
});

describe('components and pages', () => {
  it('renders form controls with accessible names and reports changes', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const onNumber = vi.fn();
    render(
      <>
        <Toggle label="Indexing cache" hint="Keeps analysis" checked={false} onChange={onToggle} />
        <SelectField label="Theme" value="light" onChange={onSelect} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <NumberField label="Indexing workers" value={4} min={1} max={16} onChange={onNumber} />
        <Notice tone="error">Something failed</Notice>
        <TypeMark node={{ type: 'ApiEndpoint' }} />
      </>,
    );
    fireEvent.click(screen.getByRole('switch', { name: /Indexing cache/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(onSelect).toHaveBeenCalledWith('dark');
    fireEvent.change(screen.getByLabelText('Indexing workers'), { target: { value: '99' } });
    expect(onNumber).not.toHaveBeenCalled(); // out of range is ignored
    fireEvent.change(screen.getByLabelText('Indexing workers'), { target: { value: '2' } });
    expect(onNumber).toHaveBeenCalledWith(2);
    expect(screen.getByRole('alert').textContent).toContain('Something failed');
    expect(screen.getByText('API endpoint')).toBeTruthy();
  });

  it('renders the landing page with the brand, headline and all sections', () => {
    page(<Landing />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Understand what connects.');
    expect(screen.getByText(/Explore the hidden architecture of software\. Transform repositories into structured, interactive knowledge maps\./)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Explore a repository' })[0]!.getAttribute('href')).toBe('/import');
    expect(screen.getByRole('link', { name: 'Learn about VECTORA' }).getAttribute('href')).toBe('/about');
    for (const h of ['How it works', 'One graph, three ways to read it', 'Supported sources', 'Your code stays on your machine', 'About']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Illustration/ })).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('Understand what connects.');
    expect(document.querySelectorAll('main').length).toBe(1);
  });

  it('renders the About page with every required section', async () => {
    page(<About />);
    expect(screen.getByText(/VECTORA is a codebase intelligence platform that transforms software repositories/)).toBeTruthy();
    for (const h of ['Product philosophy', 'How VECTORA works', 'Supported languages', 'Privacy principles', 'Technology credits', 'Version and licence', 'Documentation']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.getByText('docs/CHANGELOG.md')).toBeTruthy();
    // The language table falls back to the built-in list when the engine is offline.
    await waitFor(() => expect(screen.getAllByRole('cell', { name: 'TypeScript' }).length).toBeGreaterThan(0));
  });

  it('keeps user-facing copy free of the excluded terminology', () => {
    const dir = path.join(ROOT, 'apps/web/src');
    const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(tsx|html)$/.test(f));
    const banned = /\b(AI|A\.I\.|artificial intelligence|LLM|GPT|machine learning|neural|chatbot|copilot)\b/;
    for (const f of [...files.map((x) => path.join(dir, x)), path.join(ROOT, 'apps/web/index.html'), path.join(ROOT, 'docs/USER_GUIDE.md'), path.join(ROOT, 'README.md')]) {
      if (!fs.existsSync(f)) continue;
      // Strip code comments and import lines; what remains includes all text shown to users.
      const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^import .*$/gm, '');
      expect(banned.exec(text)?.[0], f).toBeUndefined();
    }
  });
});
