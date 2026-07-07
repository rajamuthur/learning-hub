import express from 'express';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, withTransaction } from './db.js';
import { sanitizeHtml, htmlToText } from './sanitize.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const EDIT_PASSCODE = process.env.EDIT_PASSCODE || '';

app.use(compression());
app.use(express.json({ limit: '5mb' }));

// ---- helpers ---------------------------------------------------------------

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'category';
}

// Gate write operations behind an optional passcode. If EDIT_PASSCODE is unset,
// the app is fully open (matches the "no login / no auth" request).
function requireEdit(req, res, next) {
  if (!EDIT_PASSCODE) return next();
  const provided = req.get('x-edit-passcode') || '';
  if (provided === EDIT_PASSCODE) return next();
  return res.status(401).json({ error: 'Edit passcode required or incorrect.' });
}

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

// ---- config ----------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({ editProtected: Boolean(EDIT_PASSCODE) });
});

// Verify a passcode (used by the frontend "unlock editing" prompt).
app.post('/api/verify-passcode', express.json(), (req, res) => {
  if (!EDIT_PASSCODE) return res.json({ ok: true });
  res.json({ ok: (req.body?.passcode || '') === EDIT_PASSCODE });
});

// ---- categories ------------------------------------------------------------

app.get(
  '/api/categories',
  asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*, COUNT(n.id)::int AS note_count
         FROM categories c
         LEFT JOIN notes n ON n.category_id = c.id
        GROUP BY c.id
        ORDER BY c.sort_order, c.name`
    );
    res.json(rows);
  })
);

app.post(
  '/api/categories',
  requireEdit,
  asyncH(async (req, res) => {
    const name = (req.body?.name || '').trim();
    const color = (req.body?.color || '#6366f1').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const slug = slugify(name);
    const { rows } = await query(
      `INSERT INTO categories (name, slug, color, sort_order)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order)+1, 0) FROM categories))
       RETURNING *`,
      [name, slug, color]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/categories/:id',
  requireEdit,
  asyncH(async (req, res) => {
    const { name, color } = req.body || {};
    const { rows } = await query(
      `UPDATE categories
          SET name = COALESCE($2, name),
              color = COALESCE($3, color)
        WHERE id = $1
        RETURNING *`,
      [req.params.id, name?.trim() || null, color || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/categories/:id',
  requireEdit,
  asyncH(async (req, res) => {
    await query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---- notes -----------------------------------------------------------------

// List notes (summaries). Supports ?category=<id>, ?q=<search>, ?planned=1
app.get(
  '/api/notes',
  asyncH(async (req, res) => {
    const { category, q, planned } = req.query;
    const params = [];
    const where = [];

    if (category) {
      params.push(category);
      where.push(`n.category_id = $${params.length}`);
    }
    if (planned === '1') where.push('n.is_planned = true');
    if (planned === '0') where.push('n.is_planned = false');
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      where.push(`(n.title ILIKE $${params.length} OR n.content_text ILIKE $${params.length})`);
    }

    const sql = `
      SELECT n.id, n.title, n.category_id, n.is_planned, n.updated_at,
             LEFT(n.content_text, 180) AS preview,
             c.name AS category_name, c.color AS category_color
        FROM notes n
        LEFT JOIN categories c ON c.id = n.category_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY n.updated_at DESC
       LIMIT 500`;
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// Single note with full content + linked notes.
app.get(
  '/api/notes/:id',
  asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT n.*, c.name AS category_name, c.color AS category_color
         FROM notes n LEFT JOIN categories c ON c.id = n.category_id
        WHERE n.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const note = rows[0];
    const { rows: links } = await query(
      `SELECT n.id, n.title, c.name AS category_name, c.color AS category_color
         FROM note_links l
         JOIN notes n ON n.id = l.related_note_id
         LEFT JOIN categories c ON c.id = n.category_id
        WHERE l.note_id = $1
        ORDER BY n.title`,
      [req.params.id]
    );
    note.related = links;
    res.json(note);
  })
);

async function saveLinks(client, noteId, relatedIds) {
  await client.query('DELETE FROM note_links WHERE note_id = $1', [noteId]);
  const clean = [...new Set((relatedIds || []).map(Number).filter((x) => x && x !== Number(noteId)))];
  for (const rid of clean) {
    // bidirectional link so relationships show from both sides
    await client.query(
      `INSERT INTO note_links (note_id, related_note_id) VALUES ($1,$2), ($2,$1)
       ON CONFLICT DO NOTHING`,
      [noteId, rid]
    );
  }
}

app.post(
  '/api/notes',
  requireEdit,
  asyncH(async (req, res) => {
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const html = sanitizeHtml(req.body?.content_html || '');
    const text = htmlToText(html);
    const categoryId = req.body?.category_id || null;
    const isPlanned = Boolean(req.body?.is_planned);
    const related = req.body?.related || [];

    const note = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO notes (title, content_html, content_text, category_id, is_planned)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [title, html, text, categoryId, isPlanned]
      );
      await saveLinks(client, rows[0].id, related);
      return rows[0];
    });
    res.status(201).json(note);
  })
);

app.put(
  '/api/notes/:id',
  requireEdit,
  asyncH(async (req, res) => {
    const id = req.params.id;
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const html = sanitizeHtml(req.body?.content_html || '');
    const text = htmlToText(html);
    const categoryId = req.body?.category_id ?? null;
    const isPlanned = Boolean(req.body?.is_planned);
    const related = req.body?.related || [];

    const note = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE notes
            SET title=$2, content_html=$3, content_text=$4,
                category_id=$5, is_planned=$6, updated_at=now()
          WHERE id=$1 RETURNING *`,
        [id, title, html, text, categoryId, isPlanned]
      );
      if (!rows.length) return null;
      await saveLinks(client, id, related);
      return rows[0];
    });
    if (!note) return res.status(404).json({ error: 'Not found' });
    res.json(note);
  })
);

app.delete(
  '/api/notes/:id',
  requireEdit,
  asyncH(async (req, res) => {
    await query('DELETE FROM notes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---- static frontend -------------------------------------------------------

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---- startup: ensure schema + default categories exist --------------------
// Idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING), so it is
// safe to run on every boot. This means a fresh Neon database is set up
// automatically on first deploy — no shell access required.

const DEFAULT_CATEGORIES = [
  { name: 'AI', slug: 'ai', color: '#8b5cf6' },
  { name: 'DevOps', slug: 'devops', color: '#0ea5e9' },
  { name: 'Kafka', slug: 'kafka', color: '#ef4444' },
  { name: 'General', slug: 'general', color: '#10b981' },
  { name: 'English', slug: 'english', color: '#f59e0b' },
];

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    await query(
      `INSERT INTO categories (name, slug, color, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [c.name, c.slug, c.color, i]
    );
  }
  console.log('[learning-hub] Schema ready (tables + default categories ensured).');
}

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error('[learning-hub] Schema init failed — is DATABASE_URL correct?', err.message);
  }
  app.listen(PORT, () => {
    console.log(`[learning-hub] listening on http://localhost:${PORT}`);
    if (!EDIT_PASSCODE) console.log('[learning-hub] Editing is OPEN (no passcode set).');
  });
}

start();
