/**
 * Development helper: index a directory and print a summary.
 * Usage: tsx scripts/index-cli.ts <dir> [--workers] [--edges] [--unresolved] [--verbose]
 */
import path from 'node:path';
import { indexRepository } from '@vectora/repository-indexer';

const dir = process.argv[2] ?? 'samples/sample-repo';
const result = await indexRepository({
  repositoryId: 'cli',
  repositoryName: path.basename(path.resolve(dir)),
  rootDir: dir,
  inProcess: !process.argv.includes('--workers'),
  onProgress: process.argv.includes('--verbose') ? (s, m, p, t) => console.log(`[${s}] ${m} ${p}/${t}`) : undefined,
});
const { graph, analysis } = result;
console.log(
  JSON.stringify(
    {
      stats: graph.stats,
      summary: analysis.summary,
      validation: { errors: analysis.validation.errors, warnings: analysis.validation.warnings },
      unresolved: analysis.unresolvedByReason,
      languages: analysis.languages.filter((l) => l.tier > 0).map((l) => `${l.name}: ${l.analyzedFiles}/${l.files} files, ${l.symbols} symbols, ${l.parseErrors} issues`),
      entryPoints: analysis.entryPoints.map((e) => `${e.path} (${e.reason})`),
      flows: analysis.flows.map((f) => `${f.name}: ${f.steps.join(' -> ')}`),
      frameworks: analysis.frameworks.map((f) => f.name),
      parseIssues: analysis.parseIssues,
    },
    null,
    1,
  ),
);
if (process.argv.includes('--edges'))
  for (const e of graph.edges)
    if (!['CONTAINS', 'DEFINED_IN', 'BELONGS_TO', 'EXPORTS'].includes(e.type))
      console.log(`${e.type}  ${e.source} -> ${e.target}  [${e.extractionMethod} ${e.confidence}${e.verified ? '' : ' unverified'}]`);
if (process.argv.includes('--unresolved')) console.log(analysis.unresolvedSamples);
if (analysis.validation.errors) console.log(analysis.validation.issues);
