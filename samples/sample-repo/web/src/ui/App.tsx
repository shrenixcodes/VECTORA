import { NoteList } from './NoteList';

export const App = () => {
  return (
    <main>
      <h1>Orbit Notes</h1>
      <NoteList notes={[]} />
    </main>
  );
};
