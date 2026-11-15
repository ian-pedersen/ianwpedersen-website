// Case Prep: study guide + spaced-repetition flashcards. Static, single-user, no server.
import { esc, inline, renderMarkdown, parseDeck, parseCSV, deckToMarkdown, derivedId, splitTags, slugify } from './md.js';
import { schedule, previewLabel, dayStr, addDays, stage, isDue } from './srs.js';
import * as store from './store.js';

const BASE = 'case-prep/content/';
const app = document.getElementById('cp-app');
const dialog = document.getElementById('cp-dialog');

// ---------- Content ----------
const content = { categories: [], decks: new Map(), fileCards: [], guides: new Map() };
let decks = new Map(); // merged: file decks + local decks
let cards = new Map(); // merged: file cards + edits + local cards, minus deletions
let searchIndex = null;
let session = null;
let lastSummary = null;

const S = () => store.data;
const today = () => dayStr();
const catTitle = (id) => (content.categories.find((c) => c.id === id) || { title: id }).title;
const deckTitle = (id) => (decks.get(id) || { title: id }).title;
const cardsInDeck = (deckId) => [...cards.values()].filter((c) => c.deck === deckId);
const frontHTML = (s) => (/\n/.test(s) ? renderMarkdown(s).html : inline(s));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function fetchText(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

function prepareGuide(src) {
  const rendered = renderMarkdown(src);
  // Split the source at headings so search can point to a section.
  const sections = [];
  let cur = { heading: '', id: '', lines: [] };
  let h = 0;
  let fence = false;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (m && rendered.headings[h]) {
      sections.push(cur);
      cur = { heading: m[1], id: rendered.headings[h].id, lines: [] };
      h++;
    } else cur.lines.push(line);
  }
  sections.push(cur);
  return {
    src,
    html: rendered.html,
    headings: rendered.headings,
    sections: sections
      .map((s) => ({ heading: s.heading, id: s.id, text: s.lines.join('\n') }))
      .filter((s) => s.heading || s.text.trim()),
  };
}

async function loadContent() {
  const manifest = JSON.parse(await fetchText('manifest.json'));
  content.categories = manifest.categories;
  const srcs = await Promise.all(manifest.decks.map(fetchText));
  manifest.decks.forEach((path, i) => {
    const id = path.split('/').pop().replace(/\.md$/i, '');
    const { meta, cards: parsed } = parseDeck(srcs[i], id);
    const category = meta.category || 'frameworks';
    if (!content.categories.some((c) => c.id === category)) content.categories.push({ id: category, title: category });
    content.decks.set(id, { id, title: meta.title || id, category, guide: meta.guide || null, description: meta.description || '' });
    content.fileCards.push(...parsed);
  });
  const withGuides = [...content.decks.values()].filter((d) => d.guide);
  const guideSrcs = await Promise.all(withGuides.map((d) => fetchText(d.guide).catch(() => null)));
  withGuides.forEach((d, i) => {
    if (guideSrcs[i] != null) content.guides.set(d.id, prepareGuide(guideSrcs[i]));
  });
}

function buildCards() {
  const L = S().local;
  decks = new Map(content.decks);
  for (const d of Object.values(L.decks)) if (!decks.has(d.id)) decks.set(d.id, { ...d, local: true });
  for (const [id, o] of Object.entries(L.deckEdits || {})) if (decks.has(id)) decks.set(id, { ...decks.get(id), ...o, edited: true });
  cards = new Map();
  for (const c of content.fileCards) {
    if (L.deleted[c.id]) continue;
    const o = L.overrides[c.id];
    cards.set(c.id, o ? { ...c, ...o, edited: true } : c);
  }
  for (const c of Object.values(L.cards)) if (!L.deleted[c.id]) cards.set(c.id, { ...c, local: true });
  for (const c of cards.values()) {
    if (!decks.has(c.deck)) decks.set(c.deck, { id: c.deck, title: c.deck, category: 'frameworks', local: true });
  }
  searchIndex = null;
}

// Decks in manifest order, grouped by category.
function decksByCategory() {
  return content.categories
    .map((cat) => ({ cat, decks: [...decks.values()].filter((d) => d.category === cat.id) }))
    .filter((g) => g.decks.length);
}

// ---------- Progress helpers ----------
function midnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function newIntroducedToday() {
  const t0 = midnight();
  let n = 0;
  for (let i = S().log.length - 1; i >= 0 && S().log[i][0] >= t0; i--) if (S().log[i][3]) n++;
  return n;
}

function dueInfo() {
  const t = today();
  const reviews = [];
  const freshByDeck = new Map();
  for (const c of cards.values()) {
    const st = S().srs[c.id];
    if (!st || st.s === 'new') {
      if (!freshByDeck.has(c.deck)) freshByDeck.set(c.deck, []);
      freshByDeck.get(c.deck).push(c.id);
    } else if (isDue(st, t)) reviews.push(c.id);
  }
  // Round-robin across decks so new cards arrive mixed.
  const lists = [...freshByDeck.values()];
  const fresh = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) fresh.push(l[i]);
  const allow = Math.max(0, (S().settings.newPerDay | 0) - newIntroducedToday());
  return { reviews, fresh, newToday: fresh.slice(0, allow) };
}

function retention(ids, minIvl = 1, days = 30) {
  const cutoff = Date.now() - days * 864e5;
  let total = 0;
  let good = 0;
  for (const [t, id, r, , ivlBefore] of S().log) {
    if (t < cutoff || ivlBefore < minIvl || (ids && !ids.has(id))) continue;
    total++;
    if (r >= 3) good++;
  }
  return total ? { pct: Math.round((100 * good) / total), total } : null;
}

function deckStats(deckId) {
  const t = today();
  const out = { total: 0, new: 0, learning: 0, mature: 0, due: 0 };
  const ids = new Set();
  for (const c of cards.values()) {
    if (c.deck !== deckId) continue;
    ids.add(c.id);
    const st = S().srs[c.id];
    out.total++;
    out[stage(st)]++;
    if (isDue(st, t)) out.due++;
  }
  out.retention = retention(ids);
  return out;
}

function streak() {
  const days = S().days;
  let d = today();
  const doneToday = !!days[d];
  if (!doneToday) d = addDays(d, -1);
  let n = 0;
  while (days[d]) {
    n++;
    d = addDays(d, -1);
  }
  return { n, doneToday };
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- Routing ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', arg: parts[1], params: new URLSearchParams(qs || '') };
}

const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

function setNav(name) {
  document.querySelectorAll('.cp-nav a[data-nav]').forEach((a) => {
    a.classList.toggle('current', a.dataset.nav === name);
  });
}

function render() {
  const r = parseHash();
  document.body.classList.toggle('cp-studying', r.name === 'study');
  if (r.name !== 'study' && session) endSession(false);
  const views = {
    home: viewHome,
    deck: viewDeck,
    guide: viewGuide,
    custom: viewCustom,
    study: viewStudy,
    summary: viewSummary,
    search: viewSearch,
    flagged: viewFlagged,
    progress: viewProgress,
    manage: viewManage,
    edit: viewEdit,
    new: viewEdit,
  };
  (views[r.name] || viewHome)(r);
  setNav(r.name);
  if (r.name !== 'study') window.scrollTo(0, 0);
}

// ---------- Views ----------
function deckRow(d) {
  const st = deckStats(d.id);
  return `<a class="cp-deck" href="#/deck/${encodeURIComponent(d.id)}">
    <span class="cp-deck-title">${esc(d.title)}</span>
    <span class="cp-deck-meta mono">${plural(st.total, 'card')}${st.due ? ` · <b>${st.due} due</b>` : ''}${st.new ? ` · ${st.new} new` : ''}</span>
  </a>`;
}

function viewHome() {
  const due = dueInfo();
  const total = due.reviews.length + due.newToday.length;
  const sk = streak();
  app.innerHTML = `
  <section class="cp-hero">
    <div>
      <p class="cp-eyebrow mono">Due today</p>
      <p class="cp-due"><span class="cp-due-num">${total}</span> ${total === 1 ? 'card' : 'cards'}</p>
      <p class="cp-sub mono">${plural(due.reviews.length, 'review')} · ${due.newToday.length} new</p>
      <div class="cp-row-btns">
        <button type="button" class="cp-btn cp-btn-primary cp-btn-lg" data-act="start-review" ${total ? '' : 'disabled'}>Start review</button>
        <a class="cp-btn" href="#/custom">Custom session</a>
      </div>
      ${total ? '' : `<p class="cp-note">Nothing due. ${due.fresh.length ? 'Today’s new-card limit is used up. ' : ''}Start a custom session to cram, or come back tomorrow.</p>`}
    </div>
    <div class="cp-streak ${sk.doneToday ? 'is-done' : ''}">
      <span class="cp-streak-num">${sk.n}</span>
      <span class="mono">day streak</span>
      <span class="cp-streak-note">${sk.doneToday ? 'Done for today' : sk.n ? 'Review today to keep it' : 'Review a card to start one'}</span>
    </div>
  </section>
  ${decksByCategory()
    .map(
      (g) => `<section class="cp-cat">
        <h2 class="cp-cat-title">${esc(g.cat.title)}</h2>
        <div class="cp-deck-grid">${g.decks.map(deckRow).join('')}</div>
      </section>`
    )
    .join('')}`;
  app.querySelector('[data-act="start-review"]').addEventListener('click', () => {
    const d = dueInfo();
    startSession({ ids: shuffle([...d.reviews, ...d.newToday]), schedule: true, label: 'Daily review' });
  });
}

function cardListItem(c, opts = {}) {
  const st = S().srs[c.id];
  const stg = stage(st);
  const flagged = S().flags[c.id];
  return `<details class="cp-item" data-id="${esc(c.id)}">
    <summary>
      <span class="cp-item-front">${frontHTML(c.front)}</span>
      <span class="cp-item-meta mono">
        ${opts.showDeck ? `<span class="cp-chip">${esc(deckTitle(c.deck))}</span>` : ''}
        ${c.mode === 'recall' ? '<span class="cp-chip">recall</span>' : ''}
        ${c.tags.map((t) => `<span class="cp-chip cp-chip-tag">${esc(t)}</span>`).join('')}
        ${flagged ? '<span class="cp-chip cp-chip-flag">flagged</span>' : ''}
        ${c.edited ? '<span class="cp-chip">edited</span>' : ''}${c.local ? '<span class="cp-chip">added in browser</span>' : ''}
        ${opts.showStage ? `<span class="cp-stage cp-stage-${stg}">${stg}${st && st.due && st.s !== 'new' ? ` · due ${st.due}` : ''}</span>` : ''}
      </span>
    </summary>
    <div class="cp-item-body"><div class="cp-prose cp-lazy"></div>
      <p class="cp-item-actions mono"><a href="#/edit/${encodeURIComponent(c.id)}">Edit</a> <button type="button" class="cp-link" data-del="${esc(c.id)}">Delete</button>${opts.showDeck ? ` <a href="#/deck/${encodeURIComponent(c.deck)}">Open deck</a>` : ''}${opts.unflag ? ` <button type="button" class="cp-link" data-unflag="${esc(c.id)}">Unflag</button>` : ''}</p>
    </div>
  </details>`;
}

// Asks first. Returns true if the card was deleted.
function deleteCard(c) {
  if (!confirm('Delete this card? Its review history stays in your backup but the card disappears from all decks.')) return false;
  const L = S().local;
  if (c.local) delete L.cards[c.id];
  else L.deleted[c.id] = 1;
  delete S().flags[c.id];
  store.save();
  buildCards();
  return true;
}

// Delete buttons in card lists (deck, search, flagged, manage): delete, then redraw the
// current view in place.
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const c = cards.get(b.dataset.del);
  if (!c || !deleteCard(c)) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
  flash('Card deleted');
});

// Render card backs only when a row is opened, so long lists stay fast.
function bindLazyBacks(root) {
  root.addEventListener(
    'toggle',
    (e) => {
      const det = e.target;
      if (!det.open || !det.matches('details.cp-item')) return;
      const box = det.querySelector('.cp-lazy');
      if (box && !box.dataset.done) {
        const c = cards.get(det.dataset.id);
        box.innerHTML = c ? renderMarkdown(c.back).html : '';
        box.dataset.done = '1';
      }
    },
    true
  );
}

function viewDeck(r) {
  const d = decks.get(r.arg);
  if (!d) return notFound('That deck does not exist.');
  if (r.params.get('edit')) return viewDeckEdit(d);
  const st = deckStats(d.id);
  const list = cardsInDeck(d.id);
  app.innerHTML = `
  <p class="cp-crumb mono"><a href="#/">Home</a> / ${esc(catTitle(d.category))}</p>
  <h2 class="cp-h2">${esc(d.title)}</h2>
  ${d.description ? `<p class="cp-note">${esc(d.description)}</p>` : ''}
  <div class="cp-stats mono">
    <span><b>${st.total}</b> cards</span><span><b>${st.due}</b> due</span><span><b>${st.new}</b> new</span>
    <span><b>${st.learning}</b> learning</span><span><b>${st.mature}</b> mature</span>
    <span><b>${st.retention ? st.retention.pct + '%' : '—'}</b> retention (30d)</span>
  </div>
  <div class="cp-row-btns">
    <a class="cp-btn cp-btn-primary" href="#/custom?deck=${encodeURIComponent(d.id)}">Study this deck</a>
    ${content.guides.has(d.id) ? `<a class="cp-btn" href="#/guide/${encodeURIComponent(d.id)}">Read study guide</a>` : ''}
    <a class="cp-btn" href="#/deck/${encodeURIComponent(d.id)}?edit=1">Edit this deck</a>
  </div>
  <div class="cp-list">${list.map((c) => cardListItem(c, { showStage: true })).join('') || '<p class="cp-note">No cards yet.</p>'}</div>`;
  bindLazyBacks(app);
}

// Deck edit mode: rename the deck, add cards, and tick cards to delete in bulk.
function viewDeckEdit(d) {
  const list = cardsInDeck(d.id);
  const base = `#/deck/${encodeURIComponent(d.id)}`;
  app.innerHTML = `
  <p class="cp-crumb mono"><a href="#/">Home</a> / <a href="${base}">${esc(d.title)}</a> / Edit</p>
  <h2 class="cp-h2">Edit deck</h2>
  <form class="cp-form cp-deck-form">
    <label class="cp-field"><span>Title</span><input name="title" type="text" required value="${esc(d.title)}"></label>
    <label class="cp-field"><span>Description <em>optional, one line</em></span><input name="description" type="text" value="${esc(d.description || '')}"></label>
    <div class="cp-row-btns">
      <button type="submit" class="cp-btn">Save title and description</button>
      ${d.edited ? '<button type="button" class="cp-btn" data-act="revert">Revert to file version</button>' : ''}
    </div>
  </form>
  <div class="cp-row-btns">
    <a class="cp-btn cp-btn-primary" href="#/new?deck=${encodeURIComponent(d.id)}&ret=edit">Add card</a>
    <a class="cp-btn" href="${base}">Done</a>
  </div>
  <div class="cp-bulk">
    <label class="cp-check"><input type="checkbox" id="cp-sel-all"> Select all</label>
    <span class="cp-bulk-count mono" role="status"></span>
    <button type="button" class="cp-btn cp-btn-danger" id="cp-del-sel" disabled>Delete selected</button>
  </div>
  <div class="cp-list cp-sel-list">${
    list
      .map(
        (c) => `<label class="cp-sel-row"><input type="checkbox" value="${esc(c.id)}">
          <span class="cp-item-front">${frontHTML(c.front)}</span>
          <a class="cp-sel-edit mono" href="#/edit/${encodeURIComponent(c.id)}?ret=edit">Edit</a></label>`
      )
      .join('') || '<p class="cp-note">No cards yet.</p>'
  }</div>
  <p class="cp-note">Changes are saved in this browser. Use Manage cards → Download deck as Markdown to copy them into the site repo.</p>`;

  const form = app.querySelector('.cp-deck-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) return;
    const description = form.elements.description.value.trim();
    const L = S().local;
    if (L.decks[d.id]) Object.assign(L.decks[d.id], { title, description });
    else (L.deckEdits || (L.deckEdits = {}))[d.id] = { title, description };
    store.save();
    buildCards();
    render();
    flash('Deck saved');
  });
  const rev = form.querySelector('[data-act="revert"]');
  if (rev)
    rev.addEventListener('click', () => {
      delete S().local.deckEdits[d.id];
      store.save();
      buildCards();
      render();
      flash('Deck reverted');
    });

  const boxes = [...app.querySelectorAll('.cp-sel-list input[type="checkbox"]')];
  const all = app.querySelector('#cp-sel-all');
  const delBtn = app.querySelector('#cp-del-sel');
  const count = app.querySelector('.cp-bulk-count');
  const sync = () => {
    const n = boxes.filter((b) => b.checked).length;
    count.textContent = n ? `${n} selected` : '';
    delBtn.disabled = !n;
    delBtn.textContent = n ? `Delete selected (${n})` : 'Delete selected';
    all.checked = n > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  };
  all.disabled = !boxes.length;
  all.addEventListener('change', () => {
    boxes.forEach((b) => (b.checked = all.checked));
    sync();
  });
  // Shift-click ticks or unticks every card between the last click and this one.
  let last = -1;
  boxes.forEach((b, i) =>
    b.addEventListener('click', (e) => {
      if (e.shiftKey && last >= 0) {
        const [a, z] = [Math.min(last, i), Math.max(last, i)];
        for (let k = a; k <= z; k++) boxes[k].checked = b.checked;
      }
      last = i;
      sync();
    })
  );
  delBtn.addEventListener('click', () => {
    const ids = boxes.filter((b) => b.checked).map((b) => b.value);
    if (!ids.length) return;
    if (!confirm(`Delete ${plural(ids.length, 'card')}? They disappear from all decks.`)) return;
    const L = S().local;
    for (const id of ids) {
      const c = cards.get(id);
      if (!c) continue;
      if (c.local) delete L.cards[id];
      else L.deleted[id] = 1;
      delete S().flags[id];
    }
    store.save();
    buildCards();
    render();
    flash(`Deleted ${plural(ids.length, 'card')}`);
  });
  sync();
}

function viewGuide(r) {
  const d = decks.get(r.arg);
  const g = content.guides.get(r.arg);
  if (!d || !g) return notFound('No study guide for that deck.');
  const toc = g.headings.filter((h) => h.level === 2 || h.level === 3);
  app.innerHTML = `
  <p class="cp-crumb mono"><a href="#/">Home</a> / <a href="#/deck/${encodeURIComponent(d.id)}">${esc(d.title)}</a> / Study guide</p>
  <div class="cp-guide">
    <nav class="cp-toc" aria-label="Contents">
      <p class="cp-eyebrow mono">Contents</p>
      <ol>${toc.map((h) => `<li class="lvl${h.level}"><a href="#/guide/${encodeURIComponent(d.id)}?s=${h.id}">${inline(h.text)}</a></li>`).join('')}</ol>
      <a class="cp-btn cp-btn-primary" href="#/custom?deck=${encodeURIComponent(d.id)}">Study this deck</a>
    </nav>
    <article class="cp-prose cp-guide-body">${g.html}</article>
  </div>`;
  const s = r.params.get('s');
  if (s) {
    setTimeout(() => {
      const el = document.getElementById(s);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('cp-hit');
      }
    }, 0);
  }
}

function viewCustom(r) {
  const pre = new Set((r.params.get('deck') || '').split(',').filter(Boolean));
  const tags = [...new Set([...cards.values()].flatMap((c) => c.tags))].sort();
  app.innerHTML = `
  <h2 class="cp-h2">Custom session</h2>
  <p class="cp-note">Pick decks and tags to cram. Due dates are ignored, and your review schedule stays as it is unless you tick the box below.</p>
  <form id="cp-custom" class="cp-form">
    <fieldset class="cp-fs"><legend class="cp-eyebrow mono">Categories and decks <em>none ticked = all</em></legend>
      ${decksByCategory()
        .map(
          (g) => `<div class="cp-fs-group">
          <label class="cp-check cp-check-cat"><input type="checkbox" data-cat="${esc(g.cat.id)}"> ${esc(g.cat.title)}</label>
          <div class="cp-check-list">${g.decks
            .map(
              (d) => `<label class="cp-check"><input type="checkbox" name="deck" value="${esc(d.id)}" data-in="${esc(g.cat.id)}" ${pre.has(d.id) ? 'checked' : ''}> ${esc(d.title)}</label>`
            )
            .join('')}</div></div>`
        )
        .join('')}
    </fieldset>
    ${tags.length ? `<fieldset class="cp-fs"><legend class="cp-eyebrow mono">Tags <em>none ticked = any</em></legend>
      <div class="cp-tags">${tags.map((t) => `<label class="cp-tag"><input type="checkbox" name="tag" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('')}</div></fieldset>` : ''}
    <fieldset class="cp-fs"><legend class="cp-eyebrow mono">Order</legend>
      <label class="cp-check"><input type="radio" name="order" value="shuffle" checked> Shuffle</label>
      <label class="cp-check"><input type="radio" name="order" value="fixed"> Fixed (deck order)</label>
    </fieldset>
    <fieldset class="cp-fs">
      <label class="cp-check"><input type="checkbox" name="sched"> Update my review schedule with these ratings</label>
    </fieldset>
    <div class="cp-row-btns"><button class="cp-btn cp-btn-primary cp-btn-lg" type="submit" id="cp-custom-go">Start</button></div>
  </form>`;
  const form = app.querySelector('#cp-custom');
  const pick = () => {
    const ds = new Set([...form.querySelectorAll('input[name="deck"]:checked')].map((i) => i.value));
    const ts = new Set([...form.querySelectorAll('input[name="tag"]:checked')].map((i) => i.value));
    return [...cards.values()].filter((c) => (!ds.size || ds.has(c.deck)) && (!ts.size || c.tags.some((t) => ts.has(t))));
  };
  const update = () => {
    form.querySelectorAll('[data-cat]').forEach((cb) => {
      const kids = [...form.querySelectorAll(`input[data-in="${CSS.escape(cb.dataset.cat)}"]`)];
      const n = kids.filter((k) => k.checked).length;
      cb.checked = n === kids.length;
      cb.indeterminate = n > 0 && n < kids.length;
    });
    const n = pick().length;
    const btn = form.querySelector('#cp-custom-go');
    btn.textContent = `Start (${plural(n, 'card')})`;
    btn.disabled = !n;
  };
  form.addEventListener('change', (e) => {
    if (e.target.dataset.cat) {
      form.querySelectorAll(`input[data-in="${CSS.escape(e.target.dataset.cat)}"]`).forEach((k) => (k.checked = e.target.checked));
    }
    update();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const list = pick().map((c) => c.id);
    const fixed = form.querySelector('input[name="order"]:checked').value === 'fixed';
    const names = [...form.querySelectorAll('input[name="deck"]:checked')].map((i) => deckTitle(i.value));
    startSession({
      ids: fixed ? list : shuffle(list),
      schedule: form.querySelector('input[name="sched"]').checked,
      label: names.length === 1 ? names[0] : names.length ? `${names.length} decks` : 'All decks',
    });
  });
  update();
}

// ---------- Study session ----------
function startSession({ ids, schedule: sched, label }) {
  if (!ids.length) return;
  session = {
    queue: [...ids],
    current: null,
    flipped: false,
    typed: '',
    schedule: sched,
    label,
    virt: {},
    ratings: { 1: 0, 2: 0, 3: 0, 4: 0 },
    reviews: 0,
    seen: new Set(),
    again: new Set(),
    started: Date.now(),
  };
  nextCard();
  go('#/study');
}

function nextCard() {
  session.current = session.queue.shift() || null;
  // Skip cards deleted mid-session.
  while (session.current && !cards.has(session.current)) session.current = session.queue.shift() || null;
  session.flipped = false;
  session.typed = '';
}

function endSession(navigate = true) {
  if (!session) return;
  const s = session;
  session = null;
  if (s.reviews) {
    lastSummary = {
      label: s.label,
      reviews: s.reviews,
      cards: s.seen.size,
      ratings: s.ratings,
      ms: Date.now() - s.started,
      schedule: s.schedule,
      again: [...s.again],
      left: s.queue.length + (s.current ? 1 : 0),
    };
    if (navigate) go('#/summary');
  } else if (navigate) go('#/');
}

function flip() {
  if (!session || !session.current || session.flipped) return;
  const ta = document.getElementById('cp-recall');
  if (ta) session.typed = ta.value;
  session.flipped = true;
  viewStudy();
}

function rate(r) {
  const s = session;
  if (!s || !s.current || !s.flipped) return;
  const id = s.current;
  const t = today();
  const prev = s.schedule ? S().srs[id] : s.virt[id] || S().srs[id];
  const { state, requeue } = schedule(prev, r, t);
  if (s.schedule) {
    S().srs[id] = state;
    S().log.push([Date.now(), id, r, !prev || prev.s === 'new' ? 1 : 0, prev ? prev.ivl : 0]);
  } else s.virt[id] = state;
  S().days[t] = (S().days[t] || 0) + 1;
  store.save();
  s.ratings[r]++;
  s.reviews++;
  s.seen.add(id);
  if (r === 1) s.again.add(id);
  if (requeue === 'soon') s.queue.splice(Math.min(3, s.queue.length), 0, id);
  else if (requeue === 'end') s.queue.push(id);
  nextCard();
  if (!s.current) endSession();
  else viewStudy();
}

function toggleFlag() {
  if (!session || !session.current) return;
  const id = session.current;
  if (S().flags[id]) delete S().flags[id];
  else S().flags[id] = true;
  store.save();
  viewStudy();
}

const RATINGS = [
  [1, 'Again'],
  [2, 'Hard'],
  [3, 'Good'],
  [4, 'Easy'],
];

function viewStudy() {
  const s = session;
  if (!s || !s.current) return go('#/');
  const c = cards.get(s.current);
  const d = decks.get(c.deck);
  const t = today();
  const prev = s.schedule ? S().srs[c.id] : s.virt[c.id] || S().srs[c.id];
  const recall = c.mode === 'recall';
  const label = (r) => {
    const p = previewLabel(prev, r, t);
    if (s.schedule || p === 'now' || p === 'later') return p;
    return 'done';
  };
  const back = renderMarkdown(c.back).html;
  app.innerHTML = `
  <div class="cp-session-bar mono">
    <button type="button" class="cp-btn cp-btn-sm" data-act="exit">Exit <kbd>Esc</kbd></button>
    <span>${esc(s.label)} · ${s.reviews} done · ${s.queue.length + 1} left${s.schedule ? '' : ' · schedule unchanged'}</span>
  </div>
  <article class="cp-card ${s.flipped ? 'is-flipped' : ''} ${recall ? 'is-recall' : ''}" id="cp-card" tabindex="-1" aria-live="polite">
    <p class="cp-card-deck mono">${esc(d ? d.title : c.deck)}${recall ? ' · recall mode' : ''}${S().flags[c.id] ? ' · <span class="cp-flag-on">flagged</span>' : ''}</p>
    <div class="cp-front">${frontHTML(c.front)}</div>
    ${
      recall && !s.flipped
        ? `<label class="cp-recall-label mono" for="cp-recall">Write out your structure, then reveal (Ctrl+Enter)</label>
           <textarea id="cp-recall" rows="7" placeholder="e.g. 1. Market  2. Client  3. Economics  4. Risks">${esc(s.typed)}</textarea>`
        : ''
    }
    ${
      s.flipped
        ? recall
          ? `<div class="cp-compare">
              <div><p class="cp-eyebrow mono">Your answer</p><pre class="cp-typed">${esc(s.typed) || '<em>(nothing typed)</em>'}</pre></div>
              <div><p class="cp-eyebrow mono">Model answer</p><div class="cp-prose">${back}</div></div>
            </div>`
          : `<div class="cp-back cp-prose">${back}</div>`
        : `<p class="cp-tap-hint mono">${recall ? '' : 'Tap card or press Space to flip'}</p>`
    }
  </article>
  <div class="cp-actions">
    ${
      s.flipped
        ? `<div class="cp-rate">${RATINGS.map(
            ([r, name]) => `<button type="button" class="cp-rate-btn r${r}" data-rate="${r}"><span>${name}</span><small class="mono">${label(r)} · ${r}</small></button>`
          ).join('')}</div>
          <p class="cp-swipe-hint mono">Swipe right = Good, left = Again</p>`
        : `<button type="button" class="cp-btn cp-btn-primary cp-btn-lg cp-flip-btn" data-act="flip">${recall ? 'Reveal model answer' : 'Show answer'} <kbd>${recall ? 'Ctrl+Enter' : 'Space'}</kbd></button>`
    }
    <div class="cp-secondary mono">
      <button type="button" class="cp-btn cp-btn-sm" data-act="flag">${S().flags[c.id] ? 'Unflag' : 'Flag'} <kbd>F</kbd></button>
      <button type="button" class="cp-btn cp-btn-sm" data-act="edit">Edit <kbd>E</kbd></button>
    </div>
  </div>`;

  const card = app.querySelector('#cp-card');
  const ta = app.querySelector('#cp-recall');
  if (ta) {
    ta.addEventListener('input', () => (s.typed = ta.value));
    if (matchMedia('(pointer: fine)').matches) ta.focus();
  } else card.focus({ preventScroll: true });

  let sx = 0;
  let sy = 0;
  let swiped = false;
  card.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    swiped = false;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (e.target.closest('textarea')) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped = true;
      if (s.flipped) rate(dx > 0 ? 3 : 1);
      else flip();
    }
  });
  card.addEventListener('click', (e) => {
    if (swiped) return (swiped = false);
    if (e.target.closest('textarea, a, button, pre') || String(getSelection())) return;
    if (!s.flipped) flip();
  });
  app.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => rate(+b.dataset.rate)));
  app.querySelector('[data-act="exit"]').addEventListener('click', () => endSession());
  app.querySelector('[data-act="flag"]').addEventListener('click', toggleFlag);
  app.querySelector('[data-act="edit"]').addEventListener('click', editInSession);
  const fb = app.querySelector('[data-act="flip"]');
  if (fb) fb.addEventListener('click', flip);
}

function editInSession() {
  if (!session || !session.current) return;
  const ta = document.getElementById('cp-recall');
  if (ta) session.typed = ta.value;
  const c = cards.get(session.current);
  dialog.innerHTML = `<div class="cp-dialog-inner"><h2 class="cp-h2">Edit card</h2>${editorHTML(c)}</div>`;
  bindEditor(dialog, c, (result) => {
    dialog.close();
    if (result === 'deleted') {
      nextCard();
      if (!session.current) return endSession();
    }
    viewStudy();
  });
  dialog.showModal();
}

function fmtTime(ms) {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function viewSummary() {
  const s = lastSummary;
  if (!s) return go('#/');
  const max = Math.max(1, ...Object.values(s.ratings));
  app.innerHTML = `
  <h2 class="cp-h2">Session done</h2>
  <p class="cp-note">${esc(s.label)}${s.schedule ? '' : ' · custom session, schedule unchanged'}${s.left ? ` · ended early, ${plural(s.left, 'card')} left` : ''}</p>
  <div class="cp-stats cp-stats-lg mono">
    <span><b>${s.cards}</b> cards</span><span><b>${s.reviews}</b> ratings</span><span><b>${fmtTime(s.ms)}</b> time</span>
  </div>
  <div class="cp-bars">${RATINGS.map(
    ([r, name]) => `<div class="cp-bar-row"><span class="mono">${name}</span><span class="cp-bar"><span class="r${r}" style="width:${(100 * s.ratings[r]) / max}%"></span></span><span class="mono">${s.ratings[r]}</span></div>`
  ).join('')}</div>
  ${s.again.length ? `<h3 class="cp-h3">Missed at least once</h3><div class="cp-list">${s.again.map((id) => cards.get(id)).filter(Boolean).map((c) => cardListItem(c, { showDeck: true })).join('')}</div>` : ''}
  <div class="cp-row-btns"><a class="cp-btn cp-btn-primary" href="#/">Home</a><a class="cp-btn" href="#/custom">Custom session</a></div>`;
  bindLazyBacks(app);
}

// ---------- Search ----------
function getIndex() {
  if (searchIndex) return searchIndex;
  searchIndex = [];
  for (const c of cards.values()) {
    searchIndex.push({ type: 'card', c, front: c.front.toLowerCase(), hay: `${c.front}\n${c.back}\n${c.tags.join(' ')}\n${deckTitle(c.deck)}`.toLowerCase() });
  }
  for (const [deckId, g] of content.guides) {
    for (const sec of g.sections) {
      searchIndex.push({ type: 'guide', deckId, sec, front: sec.heading.toLowerCase(), hay: `${deckTitle(deckId)}\n${sec.heading}\n${sec.text}`.toLowerCase() });
    }
  }
  return searchIndex;
}

// Every term must match at the start of a word, so "rate" does not match "accurate".
function search(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const res = toks.map((t) => new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const hits = [];
  for (const e of getIndex()) {
    if (!res.every((re) => re.test(e.hay))) continue;
    const score = (res.every((re) => re.test(e.front)) ? 2 : 0) + (e.type === 'card' ? 1 : 0);
    hits.push({ e, score });
  }
  return hits.sort((a, b) => b.score - a.score).map((h) => h.e);
}

function snippet(text, tok) {
  const plain = text.replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const i = Math.max(0, plain.toLowerCase().indexOf(tok));
  const start = Math.max(0, i - 60);
  return (start ? '…' : '') + plain.slice(start, start + 180) + (plain.length > start + 180 ? '…' : '');
}

function viewSearch(r) {
  const q = r.params.get('q') || '';
  app.innerHTML = `<h2 class="cp-h2">Search</h2>
    <input type="search" class="cp-input cp-search-big" id="cp-search-page" value="${esc(q)}" placeholder="e.g. NIM, RevPAR, synergies" aria-label="Search cards and guides">
    <p class="cp-note mono" id="cp-search-stats"></p><div class="cp-list" id="cp-search-results"></div>`;
  const input = app.querySelector('#cp-search-page');
  const out = app.querySelector('#cp-search-results');
  const stats = app.querySelector('#cp-search-stats');
  const runSearch = () => {
    const query = input.value.trim();
    const t0 = performance.now();
    const hits = search(query);
    const ms = performance.now() - t0;
    stats.textContent = query ? `${plural(hits.length, 'result')} in ${ms.toFixed(1)} ms${hits.length > 60 ? ' (showing 60)' : ''}` : '';
    const tok = query.toLowerCase().split(/\s+/)[0] || '';
    out.innerHTML = hits
      .slice(0, 60)
      .map((e) =>
        e.type === 'card'
          ? cardListItem(e.c, { showDeck: true })
          : `<a class="cp-item cp-guide-hit" href="#/guide/${encodeURIComponent(e.deckId)}?s=${e.sec.id}">
               <span class="cp-item-front">${inline(e.sec.heading || deckTitle(e.deckId))}</span>
               <span class="cp-item-meta mono"><span class="cp-chip">${esc(deckTitle(e.deckId))} guide</span></span>
               <span class="cp-snippet">${esc(snippet(e.sec.text, tok))}</span></a>`
      )
      .join('');
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(query)}`);
  };
  input.addEventListener('input', runSearch);
  bindLazyBacks(out);
  runSearch();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ---------- Flagged / progress ----------
function viewFlagged() {
  const list = Object.keys(S().flags).map((id) => cards.get(id)).filter(Boolean);
  app.innerHTML = `<h2 class="cp-h2">Flagged cards</h2>
  <p class="cp-note">Cards you flagged while studying (press F during a session). Fix them, then unflag.</p>
  <div class="cp-list">${list.map((c) => cardListItem(c, { showDeck: true, unflag: true })).join('') || '<p class="cp-note">No flagged cards.</p>'}</div>`;
  bindLazyBacks(app);
  app.querySelectorAll('[data-unflag]').forEach((b) =>
    b.addEventListener('click', () => {
      delete S().flags[b.dataset.unflag];
      store.save();
      viewFlagged();
    })
  );
}

function viewProgress() {
  const sk = streak();
  const all = retention(null, 1);
  const mature = retention(null, 21);
  const week = [...Array(7)].map((_, i) => addDays(today(), -i)).filter((d) => S().days[d]).length;
  app.innerHTML = `<h2 class="cp-h2">Progress</h2>
  <div class="cp-stats cp-stats-lg mono">
    <span><b>${sk.n}</b> day streak</span>
    <span><b>${week}/7</b> days studied this week</span>
    <span><b>${all ? all.pct + '%' : '—'}</b> retention, 30d</span>
    <span><b>${mature ? mature.pct + '%' : '—'}</b> mature retention, 30d</span>
  </div>
  <p class="cp-note">Retention = share of review-stage ratings that were Good or Easy. Mature = interval of 21+ days. Target: 85%+ mature retention.</p>
  ${decksByCategory()
    .map(
      (g) => `<h3 class="cp-h3">${esc(g.cat.title)}</h3>
    <div class="md-table"><table class="cp-table"><thead><tr><th>Deck</th><th>Cards</th><th>New</th><th>Learning</th><th>Mature</th><th>Due</th><th>Retention 30d</th></tr></thead>
    <tbody>${g.decks
      .map((d) => {
        const st = deckStats(d.id);
        return `<tr><td><a href="#/deck/${encodeURIComponent(d.id)}">${esc(d.title)}</a></td><td>${st.total}</td><td>${st.new}</td><td>${st.learning}</td><td>${st.mature}</td><td>${st.due}</td><td>${st.retention ? `${st.retention.pct}% <small>(${st.retention.total})</small>` : '—'}</td></tr>`;
      })
      .join('')}</tbody></table></div>`
    )
    .join('')}`;
}

// ---------- Card editor ----------
function deckOptions(selected) {
  return (
    decksByCategory()
      .map(
        (g) => `<optgroup label="${esc(g.cat.title)}">${g.decks
          .map((d) => `<option value="${esc(d.id)}" ${d.id === selected ? 'selected' : ''}>${esc(d.title)}</option>`)
          .join('')}</optgroup>`
      )
      .join('') + '<option value="__new">+ New deck…</option>'
  );
}

const catOptions = (sel) =>
  content.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.title)}</option>`).join('');

function editorHTML(c, defaults = {}) {
  const v = c || { front: '', back: '', deck: defaults.deck || [...decks.keys()][0], tags: [], mode: 'basic' };
  return `<form class="cp-form cp-editor" autocomplete="off">
    <div class="cp-grid2">
      <label class="cp-field"><span>Deck</span><select name="deck">${deckOptions(v.deck)}</select></label>
      <label class="cp-field"><span>Card type</span><select name="mode">
        <option value="basic" ${v.mode !== 'recall' ? 'selected' : ''}>Basic (flip)</option>
        <option value="recall" ${v.mode === 'recall' ? 'selected' : ''}>Recall (type your structure first)</option></select></label>
    </div>
    <div class="cp-grid2 cp-newdeck" hidden>
      <label class="cp-field"><span>New deck name</span><input name="newDeck" type="text"></label>
      <label class="cp-field"><span>Category</span><select name="newCat">${catOptions('frameworks')}</select></label>
    </div>
    <label class="cp-field"><span>Front <em>the prompt</em></span><textarea name="front" rows="2" required>${esc(v.front)}</textarea></label>
    <div class="cp-grid2 cp-grid-edit">
      <label class="cp-field"><span>Back <em>Markdown: lists, **bold**, tables</em></span><textarea name="back" rows="10" class="cp-code">${esc(v.back)}</textarea></label>
      <div class="cp-field"><span>Preview</span><div class="cp-preview cp-prose"></div></div>
    </div>
    <label class="cp-field"><span>Tags <em>comma-separated</em></span><input name="tags" type="text" value="${esc(v.tags.join(', '))}"></label>
    <p class="cp-form-msg mono" role="status"></p>
    <div class="cp-row-btns">
      <button type="submit" class="cp-btn cp-btn-primary">Save</button>
      <button type="button" class="cp-btn" data-act="cancel">Cancel</button>
      ${c && c.edited ? '<button type="button" class="cp-btn" data-act="revert">Revert to file version</button>' : ''}
      ${c ? '<button type="button" class="cp-btn cp-btn-danger" data-act="delete">Delete</button>' : ''}
    </div>
    ${c && !c.local ? '<p class="cp-note">Edits to built-in cards are saved in this browser. Use Manage → Download deck as Markdown to copy them into the site repo.</p>' : ''}
  </form>`;
}

function ensureDeck(title, category) {
  const t = title.trim();
  const found = [...decks.values()].find((d) => d.id === t || d.title.toLowerCase() === t.toLowerCase());
  if (found) return found.id;
  let id = slugify(t) || 'deck';
  while (decks.has(id)) id += '-2';
  const cat = content.categories.find((c) => c.id === category || c.title.toLowerCase() === String(category).toLowerCase());
  const d = { id, title: t, category: cat ? cat.id : 'frameworks' };
  S().local.decks[id] = d;
  decks.set(id, { ...d, local: true });
  return id;
}

function uniqueId(deckId, front) {
  let id = derivedId(deckId, front);
  while (cards.has(id) && !S().local.cards[id]) id += '-b';
  return id;
}

function bindEditor(root, c, done) {
  const form = root.querySelector('form');
  const deckSel = form.elements.deck;
  const preview = form.querySelector('.cp-preview');
  const msg = form.querySelector('.cp-form-msg');
  const showPrev = () => (preview.innerHTML = renderMarkdown(form.elements.back.value).html || '<em>Nothing yet</em>');
  const showNew = () => (form.querySelector('.cp-newdeck').hidden = deckSel.value !== '__new');
  deckSel.addEventListener('change', showNew);
  form.elements.back.addEventListener('input', showPrev);
  showPrev();
  showNew();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const front = form.elements.front.value.trim();
    if (!front) return (msg.textContent = 'The front cannot be empty.');
    let deck = deckSel.value;
    if (deck === '__new') {
      if (!form.elements.newDeck.value.trim()) return (msg.textContent = 'Name the new deck.');
      deck = ensureDeck(form.elements.newDeck.value, form.elements.newCat.value);
    }
    const vals = { front, back: form.elements.back.value.trim(), deck, tags: splitTags(form.elements.tags.value), mode: form.elements.mode.value };
    const L = S().local;
    if (!c) {
      const id = uniqueId(deck, front);
      L.cards[id] = { id, ...vals };
    } else if (c.local) L.cards[c.id] = { id: c.id, ...vals };
    else L.overrides[c.id] = vals;
    store.save();
    buildCards();
    done('saved');
  });
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => done('cancel'));
  const del = form.querySelector('[data-act="delete"]');
  if (del)
    del.addEventListener('click', () => {
      if (deleteCard(c)) done('deleted');
    });
  const rev = form.querySelector('[data-act="revert"]');
  if (rev)
    rev.addEventListener('click', () => {
      delete S().local.overrides[c.id];
      store.save();
      buildCards();
      done('saved');
    });
}

function viewEdit(r) {
  const c = r.name === 'edit' ? cards.get(r.arg) : null;
  if (r.name === 'edit' && !c) return notFound('That card does not exist.');
  // ret=edit: opened from deck edit mode, so go back there.
  const ret = r.params.get('ret') === 'edit';
  const backTo = (c ? `#/deck/${encodeURIComponent(c.deck)}` : r.params.get('deck') ? `#/deck/${encodeURIComponent(r.params.get('deck'))}` : '#/manage') + (ret && (c || r.params.get('deck')) ? '?edit=1' : '');
  app.innerHTML = `<h2 class="cp-h2">${c ? 'Edit card' : 'Add card'}</h2>${editorHTML(c, { deck: r.params.get('deck') })}`;
  bindEditor(app, c, (result) => {
    if (result === 'saved' && !c) {
      // Stay on the form for fast entry of several cards.
      const deck = app.querySelector('select[name="deck"]').value;
      flash('Card added.');
      return go(`#/new?deck=${encodeURIComponent(deck === '__new' ? [...decks.keys()].pop() : deck)}${ret ? '&ret=edit' : ''}&t=${Date.now()}`);
    }
    go(backTo);
  });
  app.querySelector('textarea[name="front"]').focus();
}

// ---------- Manage: list, import, export ----------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importCards(text, filename, defaultCat) {
  const L = S().local;
  let added = 0;
  let skipped = 0;
  const touched = new Set();
  const add = (front, back, deckName, tags, mode, cat) => {
    front = (front || '').trim();
    if (!front) return skipped++;
    const deck = ensureDeck(deckName || 'Imported', cat || defaultCat);
    const id = derivedId(deck, front);
    if (cards.has(id) || L.cards[id]) return skipped++;
    L.cards[id] = { id, front, back: (back || '').trim(), deck, tags: splitTags(tags), mode: mode === 'recall' ? 'recall' : 'basic' };
    cards.set(id, L.cards[id]);
    touched.add(deckTitle(deck));
    added++;
  };
  if (/\.(md|markdown|txt)$/i.test(filename)) {
    const id0 = filename.replace(/\.[^.]+$/, '');
    const { meta, cards: parsed } = parseDeck(text, '__file');
    const deckName = meta.title || id0;
    for (const c of parsed) add(c.front, c.back, c.deck === '__file' ? deckName : c.deck, c.tags.join(','), c.mode, meta.category);
  } else {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('The file is empty.');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const hasHead = head.includes('front') && head.includes('back');
    const col = (name, fallback) => (hasHead ? head.indexOf(name) : fallback);
    const ci = { front: col('front', 0), back: col('back', 1), deck: col('deck', 2), tags: col('tags', 3), category: col('category', 4), mode: col('mode', 5) };
    for (const row of hasHead ? rows.slice(1) : rows) {
      const g = (k) => (ci[k] >= 0 ? row[ci[k]] : '');
      add(g('front'), g('back'), g('deck'), g('tags'), (g('mode') || '').trim().toLowerCase(), g('category'));
    }
  }
  store.save();
  buildCards();
  return { added, skipped, decks: [...touched] };
}

function viewManage(r) {
  const deckFilter = r.params.get('deck') || '';
  app.innerHTML = `<h2 class="cp-h2">Manage cards</h2>
  ${store.storageOk ? '' : '<p class="cp-warn">Browser storage is unavailable, so progress will not be saved. Export a backup before closing the tab.</p>'}
  <div class="cp-row-btns"><a class="cp-btn cp-btn-primary" href="#/new">Add card</a><a class="cp-btn" href="#/flagged">Flagged cards (${Object.keys(S().flags).filter((id) => cards.has(id)).length})</a></div>

  <section class="cp-panel">
    <h3 class="cp-h3">Import cards</h3>
    <p class="cp-note">CSV with columns <code>front, back, deck, tags</code> (optional <code>category</code>, <code>mode</code>), or a Markdown deck file in the same format as the built-in decks. Unknown deck names become new decks. Duplicates (same deck and front) are skipped.</p>
    <div class="cp-grid2">
      <label class="cp-field"><span>File</span><input type="file" id="cp-import-file" accept=".csv,.md,.markdown,.txt"></label>
      <label class="cp-field"><span>Category for new decks</span><select id="cp-import-cat">${catOptions('frameworks')}</select></label>
    </div>
    <p class="cp-form-msg mono" id="cp-import-msg" role="status"></p>
  </section>

  <section class="cp-panel">
    <h3 class="cp-h3">Backup</h3>
    <p class="cp-note">Export saves every card plus your progress, streak, flags and in-browser edits to one JSON file. Import it on another device to pick up where you left off. Importing replaces this browser’s progress.</p>
    <div class="cp-row-btns">
      <button type="button" class="cp-btn cp-btn-primary" id="cp-export">Export backup (JSON)</button>
      <label class="cp-btn cp-file-btn">Import backup<input type="file" id="cp-restore" accept=".json,application/json"></label>
    </div>
    <p class="cp-form-msg mono" id="cp-backup-msg" role="status"></p>
  </section>

  <section class="cp-panel">
    <h3 class="cp-h3">Download deck as Markdown</h3>
    <p class="cp-note">Turns a deck, including your in-browser edits, into a deck file. Replace the file in <code>case-prep/content/decks/</code> to make the edits permanent.</p>
    <div class="cp-row-btns"><select id="cp-md-deck" class="cp-input cp-input-inline">${deckOptions('').replace('<option value="__new">+ New deck…</option>', '')}</select>
    <button type="button" class="cp-btn" id="cp-md-go">Download</button></div>
  </section>

  <section class="cp-panel">
    <h3 class="cp-h3">Settings</h3>
    <label class="cp-field cp-field-inline"><span>New cards per day</span><input type="number" id="cp-newperday" min="0" max="500" value="${S().settings.newPerDay}"></label>
  </section>

  <section class="cp-panel">
    <h3 class="cp-h3">All cards (${cards.size})</h3>
    <div class="cp-grid2">
      <input type="search" class="cp-input" id="cp-filter" placeholder="Filter by text or tag">
      <select class="cp-input" id="cp-filter-deck"><option value="">All decks</option>${deckOptions(deckFilter).replace('<option value="__new">+ New deck…</option>', '')}</select>
    </div>
    <p class="cp-note mono" id="cp-filter-count"></p>
    <div class="cp-list" id="cp-all"></div>
  </section>`;

  const list = app.querySelector('#cp-all');
  const fText = app.querySelector('#cp-filter');
  const fDeck = app.querySelector('#cp-filter-deck');
  fDeck.value = deckFilter;
  const drawList = () => {
    const q = fText.value.trim().toLowerCase();
    const matches = [...cards.values()].filter(
      (c) => (!fDeck.value || c.deck === fDeck.value) && (!q || `${c.front}\n${c.back}\n${c.tags.join(' ')}`.toLowerCase().includes(q))
    );
    app.querySelector('#cp-filter-count').textContent = `${plural(matches.length, 'card')}${matches.length > 200 ? ' (showing 200)' : ''}`;
    list.innerHTML = matches.slice(0, 200).map((c) => cardListItem(c, { showDeck: true, showStage: true })).join('');
  };
  fText.addEventListener('input', drawList);
  fDeck.addEventListener('change', drawList);
  bindLazyBacks(list);
  drawList();

  app.querySelector('#cp-import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    const msg = app.querySelector('#cp-import-msg');
    if (!f) return;
    try {
      const res = importCards(await f.text(), f.name, app.querySelector('#cp-import-cat').value);
      msg.textContent = `Imported ${plural(res.added, 'card')}${res.decks.length ? ` into ${res.decks.join(', ')}` : ''}. Skipped ${res.skipped}.`;
      e.target.value = '';
      drawList();
    } catch (err) {
      msg.textContent = `Import failed: ${err.message}`;
    }
  });

  app.querySelector('#cp-export').addEventListener('click', () => {
    const payload = JSON.parse(store.exportJSON());
    payload.cards = [...cards.values()].map(({ id, front, back, deck, tags, mode }) => ({ id, front, back, deck, deckTitle: deckTitle(deck), tags, mode }));
    download(`case-prep-backup-${today()}.json`, JSON.stringify(payload, null, 1), 'application/json');
    app.querySelector('#cp-backup-msg').textContent = 'Backup downloaded.';
  });

  app.querySelector('#cp-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    const msg = app.querySelector('#cp-backup-msg');
    if (!f) return;
    if (!confirm('Replace this browser’s progress, flags and edits with the backup?')) return (e.target.value = '');
    try {
      const parsed = JSON.parse(await f.text());
      delete parsed.cards;
      store.importJSON(JSON.stringify(parsed));
      buildCards();
      msg.textContent = 'Backup restored.';
      flash('Backup restored.');
    } catch (err) {
      msg.textContent = `Restore failed: ${err.message}`;
    }
    e.target.value = '';
  });

  app.querySelector('#cp-md-go').addEventListener('click', () => {
    const d = decks.get(app.querySelector('#cp-md-deck').value);
    if (d) download(`${d.id}.md`, deckToMarkdown(d, cardsInDeck(d.id)), 'text/markdown');
  });

  app.querySelector('#cp-newperday').addEventListener('change', (e) => {
    S().settings.newPerDay = Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0));
    store.save();
    flash('Saved.');
  });
}

function notFound(msg) {
  app.innerHTML = `<h2 class="cp-h2">Not found</h2><p class="cp-note">${esc(msg)}</p><p><a class="cp-btn" href="#/">Home</a></p>`;
}

let flashTimer;
function flash(text) {
  const el = document.getElementById('cp-flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------- Keyboard ----------
document.addEventListener('keydown', (e) => {
  if (dialog.open) return;
  const t = e.target;
  const typing = t.matches && t.matches('input, textarea, select, [contenteditable="true"]');
  const onStudy = parseHash().name === 'study' && session && session.current;
  if (!onStudy) {
    if (e.key === '/' && !typing) {
      e.preventDefault();
      document.getElementById('cp-q').focus();
    }
    return;
  }
  if (typing) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      flip();
    } else if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'Enter') {
    if (t.tagName === 'BUTTON' || t.tagName === 'A') return; // let focused controls work
    e.preventDefault();
    flip();
  } else if (/^[1-4]$/.test(e.key)) rate(+e.key);
  else if (e.key === 'f' || e.key === 'F') toggleFlag();
  else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    editInSession();
  } else if (e.key === 'Escape') endSession();
});

// ---------- Boot ----------
document.getElementById('cp-search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  go(`#/search?q=${encodeURIComponent(document.getElementById('cp-q').value.trim())}`);
});
dialog.addEventListener('close', () => (dialog.innerHTML = ''));

(async function boot() {
  store.load();
  try {
    await loadContent();
  } catch (err) {
    app.innerHTML = `<p class="cp-warn">Could not load the card files (${esc(err.message)}). If you opened this file directly from disk, run a local web server instead (see case-prep/README.md).</p>`;
    return;
  }
  buildCards();
  window.addEventListener('hashchange', render);
  render();
})();
