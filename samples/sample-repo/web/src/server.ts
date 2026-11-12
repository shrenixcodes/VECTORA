import express from 'express';
import { loadConfig } from './config';
import { loginRouter } from './routes/login';
import { router as notesRouter } from './routes/notes';

export function start(): void {
  const config = loadConfig();
  const app = express();
  app.use(loginRouter);
  app.use(notesRouter);
  app.listen(config.port);
}

start();
