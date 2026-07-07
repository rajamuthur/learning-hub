/* Learning Hub — single-file front-end SPA (no build step). */

const API = '/api';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  categories: [],
  notes: [],
  editProtected: false,
  passcode: sessionStorage.getItem('lh_pass') || '',
  editingId: null,
  editingCat: null,
  relatedSelected: new Set(),
};

let quill;

/* ---------- API helpers ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.passcode) headers['x-edit-passcode'] = state.passcode;
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------- editing gate ---------- */
function canEditNow() {
  return !state.editProtected || Boolean(state.passcode);
}
function ensureCanEdit() {
  if (canEditNow()) return true;
  openPass();
  return false;
}

/* ---------- data ---------- */
async function loadConfig() {
  const cfg = await api('/config');
  state.editProtected = cfg.editProtected;
  updateLockState();
}
async function loadCategories() {
  state.categories = await api('/categories');
  renderCategories();
}
async function loadNotes(params = '') {
  state.notes = await api('/notes' + params);
}

/* ---------- rendering: sidebar ---------- */
function renderCategories() {
  const el = $('#categoryList');
  el.innerHTML = '';
  state.categories.forEach((c) => {
    const a = document.createElement('a');
    a.className = 'cat-item';
    a.href = `#/category/${c.id}`;
    a.dataset.cat = c.id;
    a.innerHTML = `<span class="dot" style="background:${c.color}"></span>
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="count">${c.note_count}</span>
      <span class="edit-cat" title="Edit">✎</span>`;
    a.querySelector('.edit-cat').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (ensureCanEdit()) openCatModal(c);
    });
    el.appendChild(a);
  });
  // populate category select in editor
  const sel = $('#noteCategorySelect');
  sel.innerHTML = '<option value="">— No category —</option>' +
    state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  highlightActive();
}

function highlightActive() {
  $$('.cat-item').forEach((a) => a.classList.remove('active'));
  const h = location.hash || '#/';
  let match;
  if (h.startsWith('#/category/')) match = $(`.cat-item[data-cat="${h.split('/')[2]}"]`);
  else if (h.startsWith('#/planned')) match = $('.cat-item[data-view="planned"]');
  else if (h === '#/' || h === '') match = $('.cat-item[data-view="all"]');
  if (match) match.classList.add('active');
}

/* ---------- rendering: list ---------- */
function noteCard(n) {
  const div = document.createElement('div');
  div.className = 'note-card';
  const color = n.category_color || '#64748b';
  const tag = n.category_name
    ? `<span class="tag" style="background:${color}">${escapeHtml(n.category_name)}</span>`
    : `<span class="tag" style="background:#94a3b8">Uncategorised</span>`;
  const planned = n.is_planned ? `<span class="planned-badge">🎯 To learn</span> · ` : '';
  div.innerHTML = `${tag}
    <h3>${escapeHtml(n.title)}</h3>
    <p class="preview">${escapeHtml(n.preview || '')}</p>
    <div class="meta">${planned}Updated ${fmtDate(n.updated_at)}</div>`;
  div.addEventListener('click', () => { location.hash = `#/note/${n.id}`; });
  return div;
}

function renderList(title, notes) {
  showView('list');
  $('#listTitle').textContent = title;
  $('#listCount').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  const grid = $('#noteGrid');
  grid.innerHTML = '';
  const empty = $('#emptyState');
  if (!notes.length) {
    empty.textContent = 'No notes here yet. Click “+ Note” to add one.';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    notes.forEach((n) => grid.appendChild(noteCard(n)));
  }
}

/* ---------- rendering: single note ---------- */
async function renderNote(id) {
  const n = await api('/notes/' + id);
  showView('note');
  const color = n.category_color || '#64748b';
  const related = (n.related || []).map((r) =>
    `<span class="chip" data-goto="${r.id}"><span class="dot" style="background:${r.category_color || '#94a3b8'}"></span>${escapeHtml(r.title)}</span>`
  ).join('');
  const el = $('#noteView');
  el.innerHTML = `
    <span class="back">← Back</span>
    ${n.category_name ? `<span class="tag" style="background:${color};color:#fff;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;">${escapeHtml(n.category_name)}</span>` : ''}
    ${n.is_planned ? '<span class="planned-badge"> 🎯 Future learning</span>' : ''}
    <h1>${escapeHtml(n.title)}</h1>
    <div class="art-meta muted">Updated ${fmtDate(n.updated_at)}
      <button class="btn" id="editThisBtn">Edit</button></div>
    <div class="note-content ql-snow"><div class="ql-editor">${n.content_html || '<p class="muted">No content yet.</p>'}</div></div>
    ${relatedBox(related)}
  `;
  el.querySelector('.back').addEventListener('click', () => history.back());
  el.querySelector('#editThisBtn').addEventListener('click', () => {
    if (ensureCanEdit()) openEditor(n);
  });
  el.querySelectorAll('.chip[data-goto]').forEach((c) =>
    c.addEventListener('click', () => { location.hash = `#/note/${c.dataset.goto}`; })
  );
  window.scrollTo(0, 0);
}
function relatedBox(relatedHtml) {
  if (!relatedHtml) return '';
  return `<div class="related-box"><h3>Related notes</h3><div class="related-chips">${relatedHtml}</div></div>`;
}

/* ---------- views ---------- */
function showView(which) {
  $('#listView').classList.toggle('hidden', which !== 'list');
  $('#noteView').classList.toggle('hidden', which !== 'note');
}

/* ---------- router ---------- */
async function route() {
  const h = location.hash || '#/';
  closeSidebar();
  highlightActive();
  try {
    if (h.startsWith('#/note/')) {
      await renderNote(h.split('/')[2]);
    } else if (h.startsWith('#/category/')) {
      const id = h.split('/')[2];
      await loadNotes(`?category=${id}`);
      const cat = state.categories.find((c) => String(c.id) === id);
      renderList(cat ? cat.name : 'Category', state.notes);
    } else if (h.startsWith('#/planned')) {
      await loadNotes('?planned=1');
      renderList('🎯 Future learning', state.notes);
    } else if (h.startsWith('#/search/')) {
      const q = decodeURIComponent(h.split('/')[2] || '');
      await loadNotes('?q=' + encodeURIComponent(q));
      renderList(`Search: “${q}”`, state.notes);
    } else {
      await loadNotes('');
      renderList('All notes', state.notes);
    }
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- editor ---------- */
function initQuill() {
  quill = new Quill('#quillEditor', {
    theme: 'snow',
    placeholder: 'Write your notes… paste images by URL, add links, code blocks, lists…',
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: {
          image: imageByUrlHandler,
        },
      },
    },
  });
}

// Insert images by URL (keeps the DB tiny — matches your existing notes which
// already reference external image URLs).
function imageByUrlHandler() {
  const url = prompt('Image URL (https://…):');
  if (url && /^https?:\/\//i.test(url)) {
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, 'image', url, 'user');
    quill.setSelection(range.index + 1);
  } else if (url) {
    toast('Please enter a valid http(s) image URL.');
  }
}

function openEditor(note) {
  state.editingId = note ? note.id : null;
  $('#editorTitle').textContent = note ? 'Edit note' : 'New note';
  $('#noteTitleInput').value = note ? note.title : '';
  $('#noteCategorySelect').value = note && note.category_id ? note.category_id : '';
  $('#notePlanned').checked = note ? note.is_planned : false;
  quill.root.innerHTML = note ? (note.content_html || '') : '';
  $('#deleteNoteBtn').classList.toggle('hidden', !note);

  state.relatedSelected = new Set((note?.related || []).map((r) => r.id));
  renderRelatedPicker();
  openModal('#editorModal');
  setTimeout(() => $('#noteTitleInput').focus(), 50);
}

function renderRelatedPicker() {
  const box = $('#relatedPicker');
  const others = state.notes.length ? state.notes : null;
  // Always fetch a full list for the picker.
  api('/notes').then((all) => {
    box.innerHTML = '';
    all.filter((n) => n.id !== state.editingId).forEach((n) => {
      const t = document.createElement('span');
      t.className = 'rel-tag' + (state.relatedSelected.has(n.id) ? ' on' : '');
      t.textContent = n.title;
      t.addEventListener('click', () => {
        if (state.relatedSelected.has(n.id)) state.relatedSelected.delete(n.id);
        else state.relatedSelected.add(n.id);
        t.classList.toggle('on');
      });
      box.appendChild(t);
    });
    if (!box.children.length) box.innerHTML = '<span class="muted">No other notes yet.</span>';
  });
}

async function saveNote() {
  const title = $('#noteTitleInput').value.trim();
  if (!title) return toast('Please enter a title.');
  const payload = {
    title,
    content_html: quill.root.innerHTML,
    category_id: $('#noteCategorySelect').value || null,
    is_planned: $('#notePlanned').checked,
    related: [...state.relatedSelected],
  };
  try {
    let saved;
    if (state.editingId) {
      saved = await api('/notes/' + state.editingId, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      saved = await api('/notes', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('#editorModal');
    toast('Saved.');
    await loadCategories();
    location.hash = `#/note/${saved.id}`;
    if ((location.hash === `#/note/${saved.id}`)) route();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteNote() {
  if (!state.editingId) return;
  if (!confirm('Delete this note permanently?')) return;
  try {
    await api('/notes/' + state.editingId, { method: 'DELETE' });
    closeModal('#editorModal');
    toast('Deleted.');
    await loadCategories();
    location.hash = '#/';
    route();
  } catch (e) { toast(e.message); }
}

/* ---------- category modal ---------- */
function openCatModal(cat) {
  state.editingCat = cat || null;
  $('#catModalTitle').textContent = cat ? 'Edit category' : 'New category';
  $('#catNameInput').value = cat ? cat.name : '';
  $('#catColorInput').value = cat ? cat.color : '#6366f1';
  $('#deleteCatBtn').classList.toggle('hidden', !cat);
  openModal('#catModal');
  setTimeout(() => $('#catNameInput').focus(), 50);
}
async function saveCat() {
  const name = $('#catNameInput').value.trim();
  const color = $('#catColorInput').value;
  if (!name) return toast('Enter a category name.');
  try {
    if (state.editingCat) {
      await api('/categories/' + state.editingCat.id, { method: 'PUT', body: JSON.stringify({ name, color }) });
    } else {
      await api('/categories', { method: 'POST', body: JSON.stringify({ name, color }) });
    }
    closeModal('#catModal');
    await loadCategories();
    toast('Saved.');
  } catch (e) { toast(e.message); }
}
async function deleteCat() {
  if (!state.editingCat) return;
  if (!confirm('Delete this category? Its notes become uncategorised.')) return;
  try {
    await api('/categories/' + state.editingCat.id, { method: 'DELETE' });
    closeModal('#catModal');
    await loadCategories();
    if (location.hash.startsWith('#/category/')) location.hash = '#/';
    else route();
    toast('Deleted.');
  } catch (e) { toast(e.message); }
}

/* ---------- passcode ---------- */
function openPass() { openModal('#passModal'); setTimeout(() => $('#passInput').focus(), 50); }
async function submitPass() {
  const pass = $('#passInput').value;
  const res = await api('/verify-passcode', { method: 'POST', body: JSON.stringify({ passcode: pass }) });
  if (res.ok) {
    state.passcode = pass;
    sessionStorage.setItem('lh_pass', pass);
    closeModal('#passModal');
    updateLockState();
    toast('Editing unlocked.');
  } else {
    toast('Incorrect passcode.');
  }
}
function updateLockState() {
  const el = $('#lockState');
  if (!state.editProtected) { el.textContent = '🔓 Editing open'; return; }
  if (state.passcode) { el.textContent = '🔓 Editing unlocked'; el.onclick = null; }
  else { el.textContent = '🔒 Unlock editing'; el.onclick = openPass; }
}

/* ---------- modal helpers ---------- */
function openModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

/* ---------- sidebar (mobile) ---------- */
function openSidebar() { $('#sidebar').classList.add('open'); $('#overlay').classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#overlay').classList.remove('show'); }

/* ---------- utils ---------- */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ---------- events ---------- */
function bindEvents() {
  $('#menuBtn').addEventListener('click', () =>
    $('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar());
  $('#overlay').addEventListener('click', closeSidebar);

  $('#newNoteBtn').addEventListener('click', () => { if (ensureCanEdit()) openEditor(null); });
  $('#addCatBtn').addEventListener('click', () => { if (ensureCanEdit()) openCatModal(null); });

  $('#saveNoteBtn').addEventListener('click', saveNote);
  $('#deleteNoteBtn').addEventListener('click', deleteNote);
  $('#saveCatBtn').addEventListener('click', saveCat);
  $('#deleteCatBtn').addEventListener('click', deleteCat);
  $('#passSubmit').addEventListener('click', submitPass);

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal('#editorModal')));
  $$('[data-close-cat]').forEach((b) => b.addEventListener('click', () => closeModal('#catModal')));
  $$('[data-close-pass]').forEach((b) => b.addEventListener('click', () => closeModal('#passModal')));

  let searchTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => {
      location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
    }, 300);
  });

  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ['#editorModal', '#catModal', '#passModal'].forEach(closeModal); }
  });
}

/* ---------- boot ---------- */
async function boot() {
  initQuill();
  bindEvents();
  try {
    await loadConfig();
    await loadCategories();
    await route();
  } catch (e) {
    toast('Could not reach the server. Is the database configured? ' + e.message);
  }
}
boot();
