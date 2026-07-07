# 📚 Learning Hub

A personal, cross-linked knowledge base for your learning notes — built so you can
refresh everything in one place before an interview.

- **Categories** — AI, DevOps, Kafka, General, English out of the box, and you can add your own with a colour.
- **Rich notes** — headings, bold/italic, lists, quotes, **code blocks**, links, and **images by URL**.
- **Cross-links** — relate any note to others; links show on both notes.
- **Future learning** — flag topics you still want to study (🎯) and browse them separately.
- **Search** — instant search across every note's title and content.
- **Responsive** — works on phone, tablet and desktop. Light/dark follows your system.
- **No login** — fully open by default (an optional edit passcode is available).

---

## Tech stack

| Layer     | Choice                                             |
|-----------|----------------------------------------------------|
| Backend   | Node.js + Express                                  |
| Database  | PostgreSQL (**Neon** free tier — persistent)       |
| Frontend  | Vanilla JS SPA + [Quill](https://quilljs.com) editor (no build step) |
| Hosting   | **Render** free web service                        |

> **Why Neon and not Render's database?** Render's free PostgreSQL is deleted 30 days
> after creation. Neon's free tier is persistent (it just scales to zero when idle),
> so your notes survive. The web app itself runs on Render's free tier.

---

## Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Configure your database connection
cp .env.example .env
#    then edit .env and paste your Neon DATABASE_URL

# 3. Create tables + seed the default categories
npm run init-db

# 4. (Optional) Import your existing Learning.md notes
npm run import          # reads ./data/Learning.md

# 5. Run
npm start               # http://localhost:3000
```

---

## Deploy for free (Neon + Render)

### Step 1 — Create the database on Neon (free, persistent)

1. Go to <https://neon.tech> and sign up (free, no card).
2. Create a project. Neon gives you a **connection string** that looks like:
   `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`
3. Copy it — you'll paste it into Render as `DATABASE_URL`.

### Step 2 — Push this project to GitHub

```bash
git init
git add .
git commit -m "Learning Hub"
git branch -M main
git remote add origin https://github.com/<you>/learning-hub.git
git push -u origin main
```

### Step 3 — Create the web service on Render (free)

1. Go to <https://render.com> and sign up.
2. **New → Web Service** and connect your GitHub repo. (Render will detect
   `render.yaml`; you can also configure manually.)
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
4. Add environment variables:
   - `DATABASE_URL` → your Neon connection string (mark as secret).
   - `EDIT_PASSCODE` → optional; leave blank for open editing.
5. Click **Create Web Service** and wait for the first deploy.

### Step 4 — Initialise the database (one time)

From the Render dashboard open the service's **Shell** tab and run:

```bash
npm run init-db      # creates tables + default categories
npm run import       # optional: imports data/Learning.md
```

That's it — open your Render URL and your hub is live.

> **Free-tier note:** Render free web services sleep after ~15 minutes of inactivity,
> so the first request after idle takes ~30–60s to wake. Perfectly fine for a
> personal knowledge base.

---

## Using it

- **+ Note** (top right) — create a note: title, category, content, related notes, and a "future learning" flag.
- **Images** — in the editor toolbar click the image icon and paste an `https://…` image URL. (Storing images by URL keeps the database tiny.)
- **+ next to Categories** — add a new category with its own colour. The pencil on hover edits/deletes one.
- **Related notes** — pick other notes at the bottom of the editor to cross-link them.
- **🎯 Future learning** — the sidebar view lists everything you've flagged to study next.
- **Search** — the top bar searches all notes.

### Optional: lock down editing

Set `EDIT_PASSCODE` (locally in `.env`, or in Render's env vars) to any value.
Reading stays open to everyone; creating/editing/deleting then requires the passcode
(entered once per browser session via "🔒 Unlock editing" in the sidebar).

---

## Re-importing / updating from Learning.md

The importer splits `data/Learning.md` by `#` headings into individual notes and
auto-tags them into categories using keyword rules (editable in
`server/scripts/import-learning.js`). Running `npm run import` **adds** notes — run it
on a fresh database (after `init-db`) to avoid duplicates, or clear the `notes` table first.

---

## Project structure

```
learning-hub/
├── server/
│   ├── index.js              # Express app + REST API
│   ├── db.js                 # Postgres pool
│   ├── schema.sql            # tables + indexes
│   ├── sanitize.js           # HTML sanitising + text extraction
│   └── scripts/
│       ├── init-db.js        # apply schema + seed categories
│       └── import-learning.js# parse & import Learning.md
├── public/                   # frontend (served statically)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/Learning.md          # your source notes
├── render.yaml               # Render blueprint
└── .env.example
```
