/**
 * Question-driven repository exploration.
 *
 * Questions are answered by querying the knowledge graph: the engine picks an
 * intent, locates the subject node, retrieves the relevant relationships and
 * returns statements that each cite files and lines. Anything the graph does
 * not establish is listed under `caveats` instead of being asserted.
 */
import {
  EDGE_TYPE_LABELS,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  NODE_TYPE_LABELS,
  isSymbolType,
} from '@vectora/graph-schema';
import type { EvidenceRef, ExplorationAnswer, ExplorationStatement } from '@vectora/shared';
import { type GraphIndex, containerChain, cyclePath, findCycles, impactOf, traverse } from './algorithms';
import type { RepositoryAnalysis } from './analysis';

export type NodeFinder = (query: string, limit?: number) => GraphNode[];

type Intent =
  'cycles' | 'startup' | 'callers' | 'dependents' | 'impact' | 'data-access' | 'trace' | 'explain';

const INTENTS: [Intent, RegExp][] = [
  ['cycles', /\b(circular|cycles?|cyclic)\b/i],
  ['startup', /\b(start[- ]?up|boot(strap)?|entry points?|application start|launch sequence)\b/i],
  [
    'callers',
    /\b(what|who|which)\b.*\bcalls?\b|\bcallers? of\b|\bcalled by\b|\bwhere is .* (called|used)\b/i,
  ],
  [
    'impact',
    /\b(affected|impact|break|breaks|ripple)\b|\bif i (change|modify|remove|delete|rename)\b|\bchang(e|ing)\b.*\b(affect|impact)/i,
  ],
  [
    'dependents',
    /\bdepend(s|ents?)? on\b|\bdependents of\b|\bwhich .* (use|uses|import|imports)\b|\bwho uses\b/i,
  ],
  ['data-access', /\b(database|data|db|storage)\b.*\b(access|path|flow|queries|reads?|writes?)\b/i],
  ['trace', /\b(trace|flow of|walk through|how does .* work|process|sequence|path from)\b/i],
  ['explain', /\b(explain|what is|what does|describe|tell me about|overview of|summari[sz]e)\b/i],
];

const STOP = new Set(
  (
    'a an the this that these those is are was were be been do does did what which who whom where when why how can could would should i me my we our you your it its of in on at to ' +
    'for from by with about into through and or if then than as so explain describe show tell trace identify list find give complete entire whole all any some ' +
    'calls call called caller callers depend depends dependents dependency dependencies on affected affect impact change changing changed modify remove delete rename ' +
    'break breaks module modules function functions class classes method methods service services file files process flow path access sequence overview work works ' +
    'happens happen use uses used using import imports there here please could'
  ).split(' '),
);

const ev = (n: GraphNode | undefined, e?: GraphEdge): EvidenceRef[] => {
  const out: EvidenceRef[] = [];
  if (e?.location)
    out.push({
      path: e.location.path,
      startLine: e.location.startLine,
      endLine: e.location.endLine,
      snippet: e.evidence,
      nodeId: e.source,
    });
  else if (n?.location)
    out.push({
      path: n.location.path,
      startLine: n.location.startLine,
      endLine: n.location.endLine,
      nodeId: n.id,
    });
  return out;
};
const where = (n: GraphNode | undefined): string =>
  n?.location ? ` (${n.location.path}:${n.location.startLine})` : n?.filePath ? ` (${n.filePath})` : '';
const label = (n: GraphNode): string => `${NODE_TYPE_LABELS[n.type].toLowerCase()} \`${n.name}\``;

export function detectIntent(question: string): Intent {
  for (const [intent, re] of INTENTS) if (re.test(question)) return intent;
  return 'explain';
}

/** Extracts the subject of a question: quoted or code-formatted text first, otherwise the remaining keywords. */
export function extractSubject(question: string): string {
  const quoted = /[`"'“]([^`"'”]{2,80})[`"'”]/.exec(question);
  if (quoted) return quoted[1]!.trim();
  const words = question
    .replace(/[?!.,;:()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  // Prefer tokens that look like identifiers or paths.
  const ident = words.filter((w) => /[A-Z].*[a-z]|[a-z][A-Z]|[_/.]|\d/.test(w));
  return (ident.length ? ident : words).join(' ').trim();
}

export function explore(
  question: string,
  index: GraphIndex,
  analysis: RepositoryAnalysis | null,
  find: NodeFinder,
): ExplorationAnswer {
  const intent = detectIntent(question);
  const subject = extractSubject(question);
  const answer: ExplorationAnswer = {
    question,
    intent,
    title: '',
    statements: [],
    nodeIds: [],
    edgeIds: [],
    caveats: [],
  };
  const say = (text: string, evidence: EvidenceRef[], verified = true) =>
    answer.statements.push({ text, verified, evidence } satisfies ExplorationStatement);
  const mark = (...ids: string[]) => {
    for (const id of ids)
      if (!answer.nodeIds.includes(id) && answer.nodeIds.length < 300) answer.nodeIds.push(id);
  };
  const markEdge = (e: GraphEdge) => {
    if (answer.edgeIds.length < 600) answer.edgeIds.push(e.id);
  };
  const node = (id: string) => index.nodes.get(id);

  const locate = (preferred?: (n: GraphNode) => boolean): GraphNode | null => {
    if (!subject) return null;
    const candidates = find(subject, 12);
    if (!candidates.length) {
      // Retry with individual words, longest first.
      for (const w of subject.split(/\s+/).sort((a, b) => b.length - a.length)) {
        const c = find(w, 8);
        if (c.length) return (preferred && c.find(preferred)) || c[0]!;
      }
      return null;
    }
    return (preferred && candidates.slice(0, 5).find(preferred)) || candidates[0]!;
  };
  const notFound = () => {
    answer.title = subject ? `No match for “${subject}”` : 'No subject found';
    answer.caveats.push(
      subject
        ? `Nothing in the indexed graph matches “${subject}”. Try an exact symbol name, a file path or a concept.`
        : 'The question does not name a symbol, file or concept that could be looked up.',
    );
    return answer;
  };

  switch (intent) {
    case 'cycles': {
      const cycles = findCycles(index, ['IMPORTS'], (n) => n.type === 'File');
      answer.title = 'Circular dependencies';
      if (!cycles.length) {
        say('No circular imports between files were found in the indexed graph.', []);
        answer.caveats.push(
          'Only import relationships that were resolved to files in this repository are considered.',
        );
        return answer;
      }
      say(
        `${cycles.length} group${cycles.length === 1 ? '' : 's'} of files import each other in a cycle.`,
        [],
      );
      for (const comp of cycles.slice(0, 8)) {
        const path = cyclePath(index, comp);
        mark(...comp);
        path.forEach(markEdge);
        say(
          `${comp.length} files: ${path.map((e) => node(e.source)?.filePath).join(' → ')} → ${node(path[0]?.source ?? comp[0]!)?.filePath}`,
          path.slice(0, 6).flatMap((e) => ev(undefined, e)),
        );
      }
      if (cycles.length > 8) answer.caveats.push(`${cycles.length - 8} further cycle groups are not listed.`);
      return answer;
    }

    case 'startup': {
      answer.title = 'Application startup';
      const entries = analysis?.entryPoints ?? [];
      if (!entries.length) {
        answer.caveats.push('No entry point could be identified from manifests or file conventions.');
        return answer;
      }
      for (const e of entries.slice(0, 6)) {
        const n = node(e.nodeId);
        mark(e.nodeId);
        say(`\`${e.path}\` is an entry point: ${e.reason}.`, ev(n));
        const imports = (index.out.get(e.nodeId) ?? []).filter(
          (x) => x.type === 'IMPORTS' && x.target.startsWith('file:'),
        );
        if (imports.length) {
          imports.slice(0, 12).forEach((x) => (markEdge(x), mark(x.target)));
          say(
            `It imports ${imports.length} internal file${imports.length === 1 ? '' : 's'}: ${imports
              .slice(0, 8)
              .map((x) => `\`${node(x.target)?.filePath}\``)
              .join(', ')}${imports.length > 8 ? ', ...' : ''}.`,
            imports.slice(0, 4).flatMap((x) => ev(undefined, x)),
          );
        }
      }
      for (const f of (analysis?.flows ?? []).filter((f) => f.kind === 'startup').slice(0, 4)) {
        mark(...f.steps);
        say(
          `Call chain from startup: ${f.steps.map((s) => `\`${node(s)?.name ?? s}\``).join(' → ')}.`,
          f.steps.slice(0, 5).flatMap((s) => ev(node(s))),
          false,
        );
      }
      answer.caveats.push(
        'Startup order is inferred from imports and resolved calls; runtime configuration can change it.',
      );
      return answer;
    }

    case 'callers': {
      const target = locate(
        (n) => n.type === 'Function' || n.type === 'Method' || n.type === 'Component' || n.type === 'Class',
      );
      if (!target) return notFound();
      answer.title = `Callers of ${target.name}`;
      mark(target.id);
      const ids = [
        target.id,
        ...(index.out.get(target.id) ?? []).filter((e) => e.type === 'CONTAINS').map((e) => e.target),
      ];
      const calls = ids.flatMap((id) =>
        (index.in.get(id) ?? []).filter((e) =>
          ['CALLS', 'INSTANTIATES', 'ROUTES_TO', 'USES'].includes(e.type),
        ),
      );
      say(
        `${label(target)} is defined at ${target.location?.path}:${target.location?.startLine}.`,
        ev(target),
      );
      if (!calls.length) {
        say('No resolved call, instantiation or route points to it.', []);
        answer.caveats.push(
          'Calls made through dynamic dispatch, reflection or unresolved references are not visible in the graph.',
        );
        return answer;
      }
      for (const e of calls.slice(0, 40)) {
        const src = node(e.source);
        mark(e.source);
        markEdge(e);
        say(
          `${src ? label(src) : e.source} ${EDGE_TYPE_LABELS[e.type]} \`${node(e.target)?.name}\`.`,
          ev(src, e),
          e.verified,
        );
      }
      if (calls.length > 40) answer.caveats.push(`${calls.length - 40} further references are not listed.`);
      return answer;
    }

    case 'dependents':
    case 'impact': {
      const target = locate();
      if (!target) return notFound();
      const r = impactOf(index, target.id, intent === 'impact' ? 5 : 2, 400);
      answer.title =
        intent === 'impact' ? `Impact of changing ${target.name}` : `What depends on ${target.name}`;
      mark(target.id);
      say(`${label(target)}${where(target)} is the subject.`, ev(target));
      const direct = [...r.distances.entries()].filter(([, d]) => d === 1).map(([id]) => id);
      const transitive = [...r.distances.entries()].filter(([, d]) => d > 1);
      if (!direct.length) {
        say('Nothing in the indexed graph depends on it.', []);
        answer.caveats.push('Unresolved or dynamic references cannot be ruled out.');
        return answer;
      }
      r.edges.forEach(markEdge);
      const byFile = new Map<string, GraphNode[]>();
      for (const id of direct) {
        const n = node(id);
        if (!n) continue;
        mark(id);
        const key = n.filePath ?? n.id;
        (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(n);
      }
      say(
        `${direct.length} node${direct.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'} depend on it directly.`,
        [],
      );
      for (const [file, list] of [...byFile.entries()].slice(0, 25)) {
        const e = r.edges.find((x) => list.some((n) => n.id === x.source));
        say(
          `\`${file}\`: ${list
            .slice(0, 6)
            .map((n) => `\`${n.name}\``)
            .join(', ')}${list.length > 6 ? ', ...' : ''}${e ? ` — ${EDGE_TYPE_LABELS[e.type]}` : ''}.`,
          e ? ev(undefined, e) : ev(list[0]),
          e?.verified ?? true,
        );
      }
      if (intent === 'impact' && transitive.length) {
        transitive.slice(0, 150).forEach(([id]) => mark(id));
        const files = new Set(transitive.map(([id]) => node(id)?.filePath).filter(Boolean));
        say(
          `${transitive.length} further node${transitive.length === 1 ? '' : 's'} across ${files.size} file${files.size === 1 ? '' : 's'} are reachable through those dependants (up to 5 steps).`,
          [],
          false,
        );
        const subs = new Set(
          [...r.distances.keys()]
            .map((id) => node(id)?.metadata.subsystem as string | undefined)
            .filter(Boolean),
        );
        if (subs.size > 1)
          say(
            `The change crosses ${subs.size} subsystems: ${[...subs].map((s) => node(s!)?.name).join(', ')}.`,
            [],
            false,
          );
      }
      if (r.truncated) answer.caveats.push('The result was truncated at 400 nodes.');
      answer.caveats.push(
        'Impact is computed from resolved relationships only; unresolved references and runtime wiring are not included.',
      );
      return answer;
    }

    case 'data-access': {
      answer.title = 'Database access paths';
      const dataEdges = [...index.edges.values()].filter(
        (e) => e.type === 'READS_FROM' || e.type === 'WRITES_TO',
      );
      const models = [...index.nodes.values()].filter((n) => n.type === 'DatabaseModel');
      if (!models.length && !dataEdges.length) {
        answer.caveats.push(
          'No database models or data-access relationships were detected in this repository.',
        );
        return answer;
      }
      for (const m of models.slice(0, 15)) {
        mark(m.id);
        const inc = (index.in.get(m.id) ?? []).filter(
          (e) => e.type === 'READS_FROM' || e.type === 'WRITES_TO',
        );
        say(
          `Model \`${m.name}\`${where(m)} — ${inc.filter((e) => e.type === 'READS_FROM').length} readers, ${inc.filter((e) => e.type === 'WRITES_TO').length} writers.`,
          ev(m),
        );
        for (const e of inc.slice(0, 6)) {
          mark(e.source);
          markEdge(e);
          say(
            `\`${node(e.source)?.name}\` ${EDGE_TYPE_LABELS[e.type]} \`${m.name}\`${e.metadata?.operation ? ` via \`${String(e.metadata.operation)}\`` : ''}.`,
            ev(node(e.source), e),
            e.verified,
          );
        }
      }
      for (const f of (analysis?.flows ?? []).filter((f) => f.reachesData).slice(0, 8)) {
        mark(...f.steps);
        say(
          `${f.name}: ${f.steps.map((s) => `\`${node(s)?.name ?? s}\``).join(' → ')}.`,
          f.steps.slice(0, 6).flatMap((s) => ev(node(s))),
          false,
        );
      }
      answer.caveats.push(
        'Read and write relationships are detected from call patterns on known models and are marked as derived.',
      );
      return answer;
    }

    case 'trace': {
      const target = locate((n) => n.type === 'ApiEndpoint' || n.type === 'Function' || n.type === 'Method');
      if (!target) return notFound();
      answer.title = `Trace: ${target.name}`;
      let starts: GraphNode[] = [target];
      if (
        target.type === 'Concept' ||
        target.type === 'Subsystem' ||
        target.type === 'File' ||
        target.type === 'Module' ||
        target.type === 'Directory'
      ) {
        const files = new Set(
          target.type === 'File'
            ? [target.id]
            : (index.in.get(target.id) ?? []).filter((e) => e.type === 'BELONGS_TO').map((e) => e.source),
        );
        const inFiles = [...index.nodes.values()].filter(
          (n) => n.filePath && files.has(`file:${n.filePath}`),
        );
        const endpoints = inFiles.filter((n) => n.type === 'ApiEndpoint');
        const tokens = subject.toLowerCase().split(/\s+/);
        const named = inFiles.filter(
          (n) =>
            (n.type === 'Function' || n.type === 'Method') &&
            tokens.some((t) => n.name.toLowerCase().includes(t)),
        );
        starts = (endpoints.length ? endpoints : named).slice(0, 4);
        say(
          `${label(target)} groups ${files.size} file${files.size === 1 ? '' : 's'}; tracing from ${starts.length ? starts.map((s) => `\`${s.name}\``).join(', ') : 'no callable entry'}.`,
          [],
          target.verified,
        );
        if (!starts.length) {
          answer.caveats.push('No endpoint or function inside this group could be used as a starting point.');
          return answer;
        }
      }
      for (const s of starts) {
        mark(s.id);
        say(`Starts at ${label(s)}${where(s)}.`, ev(s));
        const r = traverse(index, s.id, 'out', {
          types: ['ROUTES_TO', 'CALLS', 'INSTANTIATES', 'READS_FROM', 'WRITES_TO'],
          maxDepth: 6,
          maxNodes: 80,
        });
        if (r.distances.size === 1) {
          say('No outgoing calls were resolved from here.', []);
          continue;
        }
        const seen = new Set<string>();
        for (const e of r.edges) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (seen.size > 40) break;
          markEdge(e);
          mark(e.source, e.target);
          const depth = r.distances.get(e.source) ?? 0;
          say(
            `${'· '.repeat(depth)}\`${node(e.source)?.name}\` ${EDGE_TYPE_LABELS[e.type]} \`${node(e.target)?.name}\`${where(node(e.target))}.`,
            ev(node(e.source), e),
            e.verified,
          );
        }
        if (r.truncated || r.edges.length > 40)
          answer.caveats.push('The trace was shortened; expand nodes in the graph to follow it further.');
      }
      answer.caveats.push(
        'Only statically resolved calls are followed. Callbacks, events and framework wiring may add steps that are not shown.',
      );
      return answer;
    }

    case 'explain':
    default: {
      const target = locate((n) => n.type === 'Concept' || n.type === 'Subsystem');
      if (!target) return notFound();
      answer.title = target.name;
      mark(target.id);
      const outE = index.out.get(target.id) ?? [];
      const inE = index.in.get(target.id) ?? [];
      if (target.type === 'Concept' || target.type === 'Subsystem') {
        const members = inE
          .filter((e) => e.type === 'BELONGS_TO')
          .sort((a, b) => b.confidence - a.confidence);
        say(
          `${target.name} is a ${target.type === 'Concept' ? 'concept group derived from identifier and path evidence' : 'subsystem derived from the repository layout'} with ${members.length} file${members.length === 1 ? '' : 's'}.`,
          [],
          target.verified,
        );
        for (const m of members.slice(0, 12)) {
          const f = node(m.source);
          mark(m.source);
          markEdge(m);
          const syms = (index.out.get(m.source) ?? [])
            .filter((e) => e.type === 'CONTAINS')
            .map((e) => node(e.target))
            .filter((n): n is GraphNode => !!n && isSymbolType(n.type));
          say(
            `\`${f?.filePath}\` — ${m.evidence}${
              syms.length
                ? `. Defines ${syms
                    .slice(0, 6)
                    .map((s) => `\`${s.name}\``)
                    .join(', ')}${syms.length > 6 ? ', ...' : ''}`
                : ''
            }.`,
            ev(f),
            m.verified,
          );
        }
        const deps = [...outE, ...inE].filter((e) => e.type === 'DEPENDS_ON' || e.type === 'RELATED_TO');
        for (const d of deps.slice(0, 8)) {
          markEdge(d);
          mark(d.source, d.target);
          say(
            `${node(d.source)?.name} ${EDGE_TYPE_LABELS[d.type]} ${node(d.target)?.name}: ${d.evidence}`,
            ev(undefined, d),
            d.verified,
          );
        }
        if (members.length > 12)
          answer.caveats.push(`${members.length - 12} further member files are not listed.`);
        if (target.type === 'Concept')
          answer.caveats.push(
            'Concept membership is an interpretation based on names and paths, not a verified fact.',
          );
        return answer;
      }
      const chain = containerChain(index, target.id);
      say(
        `${label(target)} is defined at ${target.location ? `${target.location.path}:${target.location.startLine}–${target.location.endLine}` : (target.filePath ?? 'an unknown location')}${
          chain.length
            ? `, inside ${chain
                .slice(-2)
                .map((c) => c.name)
                .join(' / ')}`
            : ''
        }.`,
        ev(target),
      );
      if (target.description) say(`Documented as: ${target.description}`, ev(target));
      if (target.metadata.signature) say(`Signature: \`${String(target.metadata.signature)}\``, ev(target));
      const group = (edges: GraphEdge[], dir: 'out' | 'in') => {
        const byType = new Map<EdgeType, GraphEdge[]>();
        for (const e of edges) {
          if (e.type === 'CONTAINS' && dir === 'in') continue;
          if (e.type === 'DEFINED_IN' || e.type === 'BELONGS_TO') continue;
          (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e);
        }
        for (const [type, list] of byType) {
          list.slice(0, 15).forEach((e) => (markEdge(e), mark(dir === 'out' ? e.target : e.source)));
          const names = list
            .slice(0, 8)
            .map((e) => `\`${node(dir === 'out' ? e.target : e.source)?.name}\``)
            .join(', ');
          say(
            dir === 'out'
              ? `It ${EDGE_TYPE_LABELS[type]} ${names}${list.length > 8 ? ` and ${list.length - 8} more` : ''}.`
              : `${names}${list.length > 8 ? ` and ${list.length - 8} more` : ''} ${list.length === 1 ? EDGE_TYPE_LABELS[type] : EDGE_TYPE_LABELS[type].replace(/s\b/, '')} it.`,
            list.slice(0, 4).flatMap((e) => ev(node(e.source), e)),
            list.every((e) => e.verified),
          );
        }
      };
      group(outE, 'out');
      group(inE, 'in');
      const concepts =
        ((target.filePath ? node(`file:${target.filePath}`)?.metadata.concepts : null) as string[] | null) ??
        [];
      if (concepts.length)
        say(`Its file is associated with: ${concepts.map((c) => node(c)?.name).join(', ')}.`, [], false);
      if (outE.length + inE.length <= 1)
        answer.caveats.push(
          'Few relationships were resolved for this node; it may be used dynamically or not at all.',
        );
      return answer;
    }
  }
}
