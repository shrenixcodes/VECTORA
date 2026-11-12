import { db } from './client';
import { notes } from './schema';

export interface NoteRecord {
  id: number;
  ownerId: number;
  title: string;
  body: string;
}

/** Data access for notes. */
export class NoteRepository {
  async findByOwner(ownerId: number): Promise<NoteRecord[]> {
    const rows = await db.select().from(notes);
    return rows.filter((r: NoteRecord) => r.ownerId === ownerId);
  }

  async insert(note: Omit<NoteRecord, 'id'>): Promise<void> {
    await db.insert(notes).values(note);
  }
}
