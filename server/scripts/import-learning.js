import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { pool, withTransaction } from '../db.js';
import { htmlToText } from '../sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plain "divider" headings in the source doc that mark a section, not a note.
const SECTION_HEADINGS = new Set([
  'common', 'llm learn plan', 'rag', 'general', 'english', 'pkce',
]);

// Map a divider section to a fallback category slug.
const SECTION_TO_CATEGORY = {
  common: 'general',
  'llm learn plan': 'ai',
  rag: 'ai',
  general: 'general',
  english: 'english',
  pkce: 'devops',
};

// Keyword → category. First match wins (checked against title + body text).
// Order matters: infra/auth (devops) is checked before AI so that auth notes
// mentioning "token" aren't mistaken for LLM notes. Keywords are kept specific
// to avoid generic false positives ("model", "agent", "token" on their own).
const KEYWORD_RULES = [
  ['kafka', /\b(kafka|zookeeper|consumer group|topic partition)\b/i],
  ['devops', /\b(elk|elasticsearch|logstash|kibana|beats|ldap|keycloak|kubernetes|docker|ci\/cd|jenkins|\bdns\b|oauth|pkce|\bjwt\b|\btls\b|certificate|nameserver|observability|prometheus|grafana|authorization code|code[_ ]?verifier|code[_ ]?challenge)\b/i],
  ['ai', /\b(llm|large language model|\brag\b|retrieval[- ]augmented|guardrail|embedding|vector (db|database|store)|prompt(ing|s)?|langgraph|langchain|agentic|multi-agent|transformer|fine[- ]?tun|hallucinat|openai|gpt-|generative ai|chatbot)\b/i],
  ['english', /\b(vocabulary|grammar|preposition|adjective|synonym|acronym|plural noun|tamil|noun:|verb:)\b/i],
];

function cleanTitle(raw) {
  let t = raw.replace(/^#+\s*/, '');
  // strip reference/inline image markdown embedded in headings
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');
  t = t.replace(/\*\*/g, '').replace(/[`_]/g, '');
  t = t.replace(/\\([.\-])/g, '$1'); // unescape "1\." -> "1."
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function categoryFor(title, bodyText, sectionSlug) {
  const hay = (title + ' ' + bodyText.slice(0, 800)).toLowerCase();
  for (const [slug, re] of KEYWORD_RULES) {
    if (re.test(hay)) return slug;
  }
  return SECTION_TO_CATEGORY[sectionSlug] || 'general';
}

function splitNotes(md) {
  const lines = md.split('\n');
  // Pull out reference-style image/link definitions so marked can resolve them
  // in every note (they're defined once, often far from where they're used).
  const defs = [];
  const kept = [];
  const defRe = /^\[[^\]]+\]:\s*<?.*>?\s*$/;
  for (const line of lines) {
    if (defRe.test(line) && /^\[[^\]]+\]:/.test(line)) defs.push(line);
    kept.push(line);
  }
  const defBlock = defs.join('\n');

  const notes = [];
  let current = null;
  let sectionSlug = 'general';

  for (const line of kept) {
    if (/^#\s+/.test(line)) {
      // flush previous
      if (current) notes.push(current);
      const title = cleanTitle(line);
      const key = title.toLowerCase();
      if (SECTION_HEADINGS.has(key)) {
        sectionSlug = key;
        current = null; // section divider — don't emit as its own note yet
        // but still start a note so any content directly under it isn't lost
        current = { title, section: sectionSlug, body: [], isSectionRoot: true };
        continue;
      }
      current = { title, section: sectionSlug, body: [], isSectionRoot: false };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) notes.push(current);

  return notes
    .map((n) => {
      const bodyMd = n.body.join('\n').trim();
      // section-root notes with negligible content are skipped
      if (n.isSectionRoot && bodyMd.replace(/\s/g, '').length < 40) return null;
      const fullMd = bodyMd + (defBlock ? '\n\n' + defBlock : '');
      const html = marked.parse(fullMd, { mangle: false, headerIds: false });
      const text = htmlToText(html);
      return { title: n.title, section: n.section, html, text };
    })
    .filter(Boolean);
}

async function main() {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'Learning.md');
  if (!fs.existsSync(file)) {
    console.error(`[import] File not found: ${file}`);
    process.exit(1);
  }
  const md = fs.readFileSync(file, 'utf8');
  const notes = splitNotes(md);
  console.log(`[import] Parsed ${notes.length} notes from ${path.basename(file)}`);

  // Look up category ids by slug.
  const { rows: cats } = await pool.query('SELECT id, slug FROM categories');
  const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c.id]));
  if (!catBySlug.general) {
    console.error('[import] Categories not found. Run "npm run init-db" first.');
    process.exit(1);
  }

  let inserted = 0;
  await withTransaction(async (client) => {
    for (const n of notes) {
      const slug = categoryFor(n.title, n.text, n.section);
      const catId = catBySlug[slug] || catBySlug.general;
      await client.query(
        `INSERT INTO notes (title, content_html, content_text, category_id)
         VALUES ($1, $2, $3, $4)`,
        [n.title.slice(0, 300), n.html, n.text, catId]
      );
      inserted++;
    }
  });

  // Report distribution.
  const { rows: dist } = await pool.query(
    `SELECT c.name, COUNT(n.id)::int AS n
       FROM categories c LEFT JOIN notes n ON n.category_id = c.id
      GROUP BY c.name ORDER BY n DESC`
  );
  console.log(`[import] Inserted ${inserted} notes.`);
  console.table(dist);
  await pool.end();
}

main().catch((err) => {
  console.error('[import] Failed:', err);
  process.exit(1);
});
