package store

// Note is a stored note.
type Note struct {
	Title string
	Body  string
}

// Store keeps notes in memory.
type Store struct {
	notes []Note
}

// New creates an empty store.
func New() *Store {
	return &Store{}
}

// Add appends a note.
func (s *Store) Add(n Note) {
	s.notes = append(s.notes, n)
}

// Count returns the number of notes.
func Count(s *Store) int {
	return len(s.notes)
}
