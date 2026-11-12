/**
 * HTTP API of the local engine. Listens on the loopback interface only,
 * rejects cross-origin and DNS-rebinding requests, and never logs request
 * bodies or credentials.
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NODE_TYPES } from '@vectora/graph-schema';
import { SUPPORTED_LANGUAGES, findPython } from '@vectora/language-adapters';
import { APP_VERSION, type SessionState, redactSecrets } from '@vectora/shared';
import type { EngineConfig } from './config';
import { GitHubError } from './github';
import { Engine, EngineError } from './service';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const hostName = (header: string | undefined): string => {
  if (!header) return '';
  const h = header.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
};

export async function buildServer(config: EngineConfig): Promise<{ app: FastifyInstance; engine: Engine }> {
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Request bodies are never logged; headers that can carry secrets are removed.
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'], remove: true },
            serializers: {
              req: (req) => ({ method: req.method, url: redactSecrets(req.url.split('?')[0] ?? ''), id: req.id }),
              // Stack traces are kept out of release logs.
              err: (err: Error) => ({ type: err.name, message: redactSecrets(err.message), stack: config.production ? '' : redactSecrets(err.stack ?? '') }),
            },
          },
  });
  const engine = new Engine(config, {
    info: (m) => app.log.info(redactSecrets(m)),
    warn: (m) => app.log.warn(redactSecrets(m)),
    error: (m) => app.log.error(redactSecrets(m)),
  });
  app.addHook('onClose', async () => engine.close());

  const allowedOrigins = new Set(config.allowedOrigins);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: false,
  });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } });

  app.addHook('onRequest', async (req, reply) => {
    // DNS-rebinding protection: the Host header must name the loopback interface.
    const host = hostName(req.headers.host);
    if (!LOOPBACK_HOSTS.has(host) && host !== config.host) return reply.code(403).send({ error: 'Forbidden host' });
    // Cross-site request protection: browsers send Origin on cross-origin and state-changing requests.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        return reply.code(403).send({ error: 'Forbidden origin' });
      }
      if (originHost !== req.headers.host && !allowedOrigins.has(origin)) return reply.code(403).send({ error: 'Forbidden origin' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Forbidden origin' });
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof EngineError || err instanceof GitHubError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Internal error' });
  });

  const idParams = z.object({ id: z.string().uuid() });

  // ---- meta ---------------------------------------------------------------
  app.get('/api/health', async () => ({
    status: 'ok',
    version: APP_VERSION,
    node: process.version,
    python: !!findPython(process.env.VECTORA_PYTHON),
    sampleAvailable: !!config.sampleDir,
    languages: SUPPORTED_LANGUAGES.map((l) => ({ id: l.id, name: l.name, tier: l.tier, extensions: l.extensions })),
  }));

  // ---- repositories -------------------------------------------------------
  app.get('/api/repositories', async () => engine.listRepositories());
  app.get('/api/repositories/:id', async (req) => engine.getRepository(idParams.parse(req.params).id));
  app.delete('/api/repositories/:id', async (req, reply) => {
    engine.deleteRepository(idParams.parse(req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/repositories/:id/reindex', async (req) => {
    const body = z.object({ full: z.boolean().optional() }).parse(req.body ?? {});
    return engine.reindex(idParams.parse(req.params).id, body.full ?? false);
  });

  // ---- imports ------------------------------------------------------------
  app.post('/api/import/local', async (req) => {
    const body = z.object({ path: z.string().min(1).max(1024), name: z.string().max(120).optional() }).parse(req.body);
    return engine.importLocal(body.path, body.name);
  });
  app.post('/api/import/sample', async () => engine.importSample());
  app.get('/api/fs/list', async (req) => engine.listDirectory(z.object({ path: z.string().max(1024).optional() }).parse(req.query).path));

  app.post('/api/import/zip/inspect', async (req) => {
    const part = await req.file();
    if (!part) throw new EngineError('No file was uploaded', 400);
    const { id, file } = engine.newUploadPath();
    await pipeline(part.file, fs.createWriteStream(file, { flags: 'wx' }));
    if (part.file.truncated) {
      fs.rmSync(file, { force: true });
      throw new EngineError('The archive is larger than the 512 MB upload limit', 413);
    }
    return engine.registerUpload(id, file, part.filename ?? 'archive.zip');
  });
  app.post('/api/import/zip', async (req) => {
    const body = z.object({ uploadId: z.string().uuid(), root: z.string().max(512).optional(), name: z.string().max(120).optional() }).parse(req.body);
    return engine.importZip(body.uploadId, body.root, body.name);
  });

  const githubBody = z.object({
    url: z.string().min(1).max(500),
    branch: z.string().max(250).nullish(),
    subdirectory: z.string().max(500).nullish(),
    token: z.string().max(400).nullish(),
    rememberToken: z.boolean().optional(),
  });
  app.post('/api/import/github/validate', async (req) => {
    const body = githubBody.pick({ url: true, token: true }).parse(req.body);
    return engine.validateGitHub(body.url, body.token);
  });
  app.post('/api/import/github', async (req) => engine.importGitHub(githubBody.parse(req.body)));

  // ---- jobs ---------------------------------------------------------------
  app.get('/api/jobs', async () => engine.activeJobs());
  app.get('/api/jobs/:id', async (req) => engine.getJob(idParams.parse(req.params).id));

  // ---- graph and analysis -------------------------------------------------
  app.get('/api/repositories/:id/graph', async (req) => {
    const q = z.object({ detail: z.enum(['full', 'structure']).optional() }).parse(req.query);
    return engine.getGraph(idParams.parse(req.params).id, q.detail ?? 'full');
  });
  app.get('/api/repositories/:id/members', async (req) => {
    const q = z.object({ path: z.string().min(1).max(1024) }).parse(req.query);
    return engine.getFileMembers(idParams.parse(req.params).id, q.path);
  });
  app.get('/api/repositories/:id/overview', async (req) => engine.getOverview(idParams.parse(req.params).id));
  app.get('/api/repositories/:id/analysis', async (req) => engine.getAnalysis(idParams.parse(req.params).id));
  app.get('/api/repositories/:id/source', async (req) => {
    const q = z.object({ path: z.string().min(1).max(1024), start: z.coerce.number().int().min(1).optional(), end: z.coerce.number().int().min(1).optional() }).parse(req.query);
    return engine.getSource(idParams.parse(req.params).id, q.path, q.start, q.end);
  });
  app.get('/api/repositories/:id/docs', async (req) => engine.listDocs(idParams.parse(req.params).id));
  app.get('/api/repositories/:id/search', async (req) => {
    const q = z.object({ q: z.string().max(200), types: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
    const types = q.types?.split(',').filter((t) => (NODE_TYPES as readonly string[]).includes(t));
    return engine.search(idParams.parse(req.params).id, q.q, types?.length ? types : undefined, q.limit);
  });
  app.post('/api/repositories/:id/ask', async (req) => {
    const body = z.object({ question: z.string().min(2).max(500) }).parse(req.body);
    return engine.ask(idParams.parse(req.params).id, body.question);
  });
  app.get('/api/repositories/:id/export/:format', async (req, reply) => {
    const p = z.object({ id: z.string().uuid(), format: z.enum(['json', 'graphml', 'markdown', 'architecture']) }).parse(req.params);
    const q = z.object({ includeSource: z.enum(['true', 'false']).optional() }).parse(req.query);
    const out = engine.export(p.id, p.format, q.includeSource === 'true');
    return reply
      .header('Content-Type', `${out.contentType}; charset=utf-8`)
      .header('Content-Disposition', `attachment; filename="${out.fileName}"`)
      .send(out.body);
  });

  // ---- sessions -----------------------------------------------------------
  const sessionBody = z.object({
    view: z.string().max(40),
    selectedIds: z.array(z.string().max(1200)).max(500),
    focusId: z.string().max(1200).nullable(),
    expandedIds: z.array(z.string().max(1200)).max(5000),
    hiddenNodeTypes: z.array(z.string().max(40)).max(40),
    hiddenEdgeTypes: z.array(z.string().max(40)).max(40),
    layouts: z.record(z.string(), z.unknown()),
    savedAt: z.string().optional(),
  });
  app.get('/api/repositories/:id/session', async (req) => engine.getSession(idParams.parse(req.params).id) ?? null);
  app.put('/api/repositories/:id/session', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    engine.saveSession(idParams.parse(req.params).id, sessionBody.parse(req.body) as unknown as SessionState);
    return reply.code(204).send();
  });

  // ---- settings, credentials, local data ---------------------------------
  app.get('/api/settings', async () => engine.getSettings());
  app.put('/api/settings', async (req) => engine.updateSettings(req.body));
  app.get('/api/credentials', async () => engine.listCredentials());
  const credParams = z.object({ name: z.enum(['github', 'exploration-provider']) });
  app.put('/api/credentials/:name', async (req, reply) => {
    engine.setCredential(credParams.parse(req.params).name, z.object({ value: z.string().min(1).max(4096) }).parse(req.body).value);
    return reply.code(204).send();
  });
  app.delete('/api/credentials/:name', async (req, reply) => {
    engine.deleteCredential(credParams.parse(req.params).name);
    return reply.code(204).send();
  });
  app.get('/api/data', async () => engine.dataInfo());
  app.delete('/api/data', async (_req, reply) => {
    engine.deleteAllData();
    return reply.code(204).send();
  });
  app.delete('/api/cache', async (_req, reply) => {
    engine.clearCache();
    return reply.code(204).send();
  });

  // ---- web application ----------------------------------------------------
  if (config.webDist) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, maxAge: '1h', immutable: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return { app, engine };
}
