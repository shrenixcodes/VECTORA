import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { NoteService } from '../services/noteService';

const service = new NoteService();
export const router = Router();

export async function listNotes(req: AuthedRequest, res: { json(body: unknown): void }): Promise<void> {
  res.json(await service.list(req.session!.userId));
}

router.get('/notes', requireAuth, listNotes);

router.post('/notes', requireAuth, async (req: AuthedRequest & { body: { title: string; body: string } }, res: { status(c: number): { end(): void } }) => {
  await service.create(req.session!.userId, req.body.title, req.body.body);
  res.status(201).end();
});
