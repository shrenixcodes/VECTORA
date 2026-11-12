/**
 * Design tokens — the single source of truth for colour. `styles.css` mirrors
 * these values as CSS custom properties (a unit test keeps the two in step);
 * WebGL renderers read them from here because they cannot use CSS variables.
 */
import type { EdgeType, NodeType } from '@vectora/graph-schema';

export interface Palette {
  canvas: string;
  surface: string;
  elevated: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  line: string;
  indigo: string;
  clay: string;
  ash: string;
  success: string;
  warning: string;
  error: string;
  selection: string;
  relationActive: string;
  relationUnverified: string;
}

export const LIGHT: Palette = {
  canvas: '#F8F7F2',
  surface: '#F3F1EA', // Washi
  elevated: '#FBFAF6',
  text: '#20211F', // Sumi
  textSecondary: '#5F5D55',
  textMuted: '#8C897F', // Stone
  line: '#DCD8CE',
  indigo: '#34445C',
  clay: '#A18C72',
  ash: '#B8B3A7',
  success: '#55704F',
  warning: '#7D5C1B',
  error: '#964436',
  selection: '#34445C',
  relationActive: '#34445C',
  relationUnverified: '#A18C72',
};

export const DARK: Palette = {
  canvas: '#171816',
  surface: '#20211F',
  elevated: '#272824',
  text: '#ECEAE2',
  textSecondary: '#A7A499',
  textMuted: '#77766D',
  line: '#373832',
  indigo: '#8292AD',
  clay: '#B39A7A',
  ash: '#5C5B54',
  success: '#8FAE8A',
  warning: '#C9A566',
  error: '#D08C7C',
  selection: '#8292AD',
  relationActive: '#8292AD',
  relationUnverified: '#B39A7A',
};

export const paletteFor = (theme: 'light' | 'dark'): Palette => (theme === 'dark' ? DARK : LIGHT);

/** Visual family of a node type. Colour is always paired with shape (3D), size and a text label. */
export type NodeFamily =
  'structure' | 'file' | 'type' | 'callable' | 'data' | 'endpoint' | 'concept' | 'external' | 'value';

export const NODE_FAMILY: Record<NodeType, NodeFamily> = {
  Repository: 'structure',
  Subsystem: 'structure',
  Module: 'structure',
  Directory: 'structure',
  File: 'file',
  Configuration: 'file',
  Package: 'external',
  Class: 'type',
  Interface: 'type',
  Type: 'type',
  Component: 'type',
  Function: 'callable',
  Method: 'callable',
  Variable: 'value',
  Constant: 'value',
  ApiEndpoint: 'endpoint',
  DatabaseModel: 'data',
  Concept: 'concept',
};

export const FAMILY_LABEL: Record<NodeFamily, string> = {
  structure: 'Structure',
  file: 'Files',
  type: 'Types and classes',
  callable: 'Functions and methods',
  data: 'Database models',
  endpoint: 'API endpoints',
  concept: 'Concepts',
  external: 'External packages',
  value: 'Variables and constants',
};

/** Single-character glyph shown next to labels so type never depends on colour alone. */
export const FAMILY_GLYPH: Record<NodeFamily, string> = {
  structure: '◼',
  file: '▫',
  type: '◆',
  callable: '●',
  data: '▤',
  endpoint: '▶',
  concept: '◎',
  external: '○',
  value: '·',
};

export function familyColor(family: NodeFamily, p: Palette): string {
  switch (family) {
    case 'structure':
      return p.text;
    case 'file':
      return p.textMuted;
    case 'type':
      return p.indigo;
    case 'callable':
      return p.textSecondary;
    case 'data':
      return p.clay;
    case 'endpoint':
      return p.warning;
    case 'concept':
      return p.success;
    case 'external':
      return p.ash;
    case 'value':
      return p.ash;
  }
}

export const nodeColor = (type: NodeType, p: Palette): string => familyColor(NODE_FAMILY[type], p);

/** Relative node size by type: repository largest, functions smallest. */
export const NODE_SIZE: Record<NodeType, number> = {
  Repository: 10,
  Subsystem: 7,
  Concept: 6,
  Module: 4.5,
  Directory: 3.5,
  Package: 3.5,
  File: 3.2,
  Configuration: 2.8,
  Class: 2.8,
  DatabaseModel: 2.8,
  Component: 2.6,
  Interface: 2.4,
  ApiEndpoint: 2.4,
  Type: 2,
  Function: 1.8,
  Method: 1.6,
  Constant: 1.3,
  Variable: 1.3,
};

/** Relationship types whose direction expresses a dependency (drawn with arrows). */
export const STRUCTURE_EDGES: readonly EdgeType[] = ['CONTAINS', 'DEFINED_IN', 'BELONGS_TO', 'EXPORTS'];

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const withAlpha = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
/** Blends `hex` towards `bg` — used to dim unrelated nodes without transparency sorting issues. */
export const mix = (hex: string, bg: string, t: number): string => {
  const a = hexToRgb(hex);
  const b = hexToRgb(bg);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
