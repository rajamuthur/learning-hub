import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CATEGORIES = [
  { name: 'AI', slug: 'ai', color: '#8b5cf6' },
  { name: 'DevOps', slug: 'devops', color: '#0ea5e9' },
  { name: 'Kafka', slug: 'kafka', color: '#ef4444' },
  { name: 'General', slug: 'general', color: '#10b981' },
  { name: 'English', slug: 'english', color: '#f59e0b' },
];

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  console.log('[init-db] Applying schema...');
  await pool.query(schema);

  console.log('[init-db] Seeding default categories...');
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    await pool.query(
      `INSERT INTO categories (name, slug, color, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [c.name, c.slug, c.color, i]
    );
  }

  console.log('[init-db] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[init-db] Failed:', err);
  process.exit(1);
});
