import { Router } from 'express';
import { createSession } from '../auth/session';

export const loginRouter = Router();

loginRouter.post('/login', (req: { body: { userId: number } }, res: { json(body: unknown): void }) => {
  res.json({ token: createSession(req.body.userId) });
});
