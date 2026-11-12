/** Development smoke test: start the engine in-process, import the sample and query it. */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../apps/local-engine/src/config';
import { buildServer } from '../apps/local-engine/src/server';

const dataDir = path.resolve('.bench-tmp/smoke-data');
fs.rmSync(dataDir, { recursive: true, force: true });
const { app, engine } = await buildServer(loadConfig({ dataDir, logLevel: 'silent' }));
const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { host: 'localhost:4317' } });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body };
};
const job = await call('POST', '/api/import/sample');
console.log('import', job.status, job.body.stage);
await engine.idle();
const done = await call('GET', `/api/jobs/${job.body.id}`);
console.log('job', done.body.status, done.body.error, done.body.summary);
const id = done.body.repositoryId;
const ov = await call('GET', `/api/repositories/${id}/overview`);
console.log('overview', ov.status, ov.body.architectureSummary?.map((s: { statement: string }) => s.statement));
const s = await call('GET', `/api/repositories/${id}/search?q=verifyToken`);
console.log('search', s.body.results?.slice(0, 3).map((r: { id: string }) => r.id));
for (const q of ['What calls verifyToken?', 'Identify circular dependencies', 'Explain authentication', 'What could be affected if I change NoteRepository?', 'Trace GET /notes', 'Show the complete database access path', 'Explain the application startup sequence', 'What is frobnicate?']) {
  const a = await call('POST', `/api/repositories/${id}/ask`, { question: q });
  console.log(`\nQ: ${q}\n  [${a.body.intent}] ${a.body.title}`);
  for (const st of a.body.statements.slice(0, 5)) console.log(`   - ${st.text}  ${st.evidence[0] ? `<${st.evidence[0].path}:${st.evidence[0].startLine}>` : ''}`);
  if (a.body.caveats.length) console.log(`   ! ${a.body.caveats[0]}`);
}
const src = await call('GET', `/api/repositories/${id}/source?path=web/src/auth/session.ts&start=12&end=14`);
console.log('\nsource', src.status, JSON.stringify(src.body.content));
console.log('traversal', (await call('GET', `/api/repositories/${id}/source?path=../../package.json`)).status);
console.log('bad host', (await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example' } })).statusCode);
console.log('bad origin', (await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost:4317', origin: 'https://evil.example' } })).statusCode);
for (const f of ['json', 'graphml', 'markdown', 'architecture']) console.log('export', f, (await call('GET', `/api/repositories/${id}/export/${f}`)).body.length);
const re = await call('POST', `/api/repositories/${id}/reindex`, {});
await engine.idle();
console.log('reindex', (await call('GET', `/api/jobs/${re.body.id}`)).body.summary);
await app.close();
