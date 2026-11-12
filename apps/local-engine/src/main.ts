import { loadConfig } from './config';
import { buildServer } from './server';

const config = loadConfig();
const { app } = await buildServer(config);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `VECTORA engine ready at http://${config.host}:${config.port} (data: ${config.dataDir}${config.webDist ? ', serving web application' : ''})`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
