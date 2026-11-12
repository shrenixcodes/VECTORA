import type { NoteRecord } from '../db/noteRepository';

export function NoteList({ notes }: { notes: NoteRecord[] }) {
  return (
    <ul>
      {notes.map((n) => (
        <li key={n.id}>{n.title}</li>
      ))}
    </ul>
  );
}
