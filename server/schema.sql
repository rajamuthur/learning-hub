-- Learning Hub schema
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  -- Rich HTML produced by the editor (sanitized on the client + server).
  content_html TEXT NOT NULL DEFAULT '',
  -- Plain text mirror of the content, used for fast search.
  content_text TEXT NOT NULL DEFAULT '',
  is_planned   BOOLEAN NOT NULL DEFAULT false,  -- "future learning" flag
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes(updated_at DESC);

-- Full text search index over title + content.
CREATE INDEX IF NOT EXISTS idx_notes_search
  ON notes USING gin (to_tsvector('english', title || ' ' || content_text));

-- Many-to-many cross references between notes ("relate this section to others").
CREATE TABLE IF NOT EXISTS note_links (
  note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, related_note_id),
  CHECK (note_id <> related_note_id)
);

CREATE INDEX IF NOT EXISTS idx_note_links_related ON note_links(related_note_id);
