import { NoteRepository, type NoteRecord } from '../db/noteRepository';

export class ValidationError extends Error {}

/** Business rules for notes. */
export class NoteService {
  private repository = new NoteRepository();

  async list(ownerId: number): Promise<NoteRecord[]> {
    return this.repository.findByOwner(ownerId);
  }

  async create(ownerId: number, title: string, body: string): Promise<void> {
    if (!title.trim()) throw new ValidationError('A note needs a title');
    await this.repository.insert({ ownerId, title, body });
  }
}
