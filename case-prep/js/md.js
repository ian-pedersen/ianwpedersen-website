// Small Markdown renderer plus the deck-file and CSV parsers.
// No dependencies, so the page makes no third-party requests and keeps working offline.

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

// ---------- Inline formatting ----------
export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const ok = /^(https?:|mailto:|#|\.{0,2}\/)/i.test(url);
    const ext = /^https?:/i.test(url);
    return `<a href="${ok ? url : '#'}"${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

// ---------- Block parsing ----------
const isBlank = (l) => /^\s*$/.test(l);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const indentOf = (l) => l.match(/^\s*/)[0].length;
const startsBlock = (lines, i) =>
  /^(#{1,6}\s|```|\s*>)/.test(lines[i]) ||
  (lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]));

function splitRow(r) {
  r = r.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

function unwrapFirstP(html) {
  return html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
}

function parseList(lines, start, opts) {
  const first = lines[start].match(listRe);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length) {
        const m2 = lines[j].match(listRe);
        const ind = indentOf(lines[j]);
        if ((m2 && ind === base) || ind > base) {
          if (items.length) items[items.length - 1].push('');
          i = j;
          continue;
        }
      }
      break;
    }
    const m = l.match(listRe);
    const ind = indentOf(l);
    if (m && ind === base) {
      items.push([m[3]]);
      i++;
    } else if (ind > base && items.length) {
      items[items.length - 1].push(l.slice(Math.min(ind, base + 2)));
      i++;
    } else if (!m && items.length && !startsBlock(lines, i)) {
      items[items.length - 1].push(l.trim()); // lazy continuation
      i++;
    } else break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const body = items
    .map((it) => `<li>${unwrapFirstP(renderMarkdown(it.join('\n'), opts).html)}</li>`)
    .join('');
  return [`<${tag}${startAttr}>${body}</${tag}>`, i];
}

export function renderMarkdown(src, opts = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const used = opts._used || (opts._used = {});
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const level = m[1].length;
      const text = m[2];
      let id = (opts.idPrefix || '') + slugify(text.replace(/[*_`]/g, ''));
      if (used[id]) id += '-' + ++used[id];
      else used[id] = 1;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), opts).html}</blockquote>`);
      continue;
    }
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(l);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''
      );
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(splitRow(lines[i++]));
      const cell = (tagName, c, k) =>
        `<${tagName}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c || '')}</${tagName}>`;
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table></div>`
      );
      continue;
    }
    if (listRe.test(l)) {
      const [html, next] = parseList(lines, i, opts);
      out.push(html);
      i = next;
      continue;
    }
    const buf = [l.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i) && !listRe.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings };
}

// ---------- Deck files ----------
// Format: optional front matter, then one card per "## Q:" heading.
// Lines starting with @tags / @mode / @id / @deck right under the heading set card metadata.
export function parseFrontmatter(src) {
  const m = src.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  });
  return { meta, body: src.slice(m[0].length) };
}

export const derivedId = (deckId, front) => `${deckId}:${slugify(front).slice(0, 60)}`;

export const splitTags = (s) =>
  String(s || '')
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

export function parseDeck(src, deckId) {
  src = String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const { meta, body } = parseFrontmatter(src);
  const cards = [];
  const seen = {};
  let cur = null;
  let fence = false;
  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    let k = 0;
    while (k < ls.length && (isBlank(ls[k]) || /^@\w+/.test(ls[k]))) {
      const mm = ls[k].match(/^@(\w+)\s*(.*)$/);
      if (mm) cur.meta[mm[1].toLowerCase()] = mm[2].trim();
      k++;
    }
    const deck = cur.meta.deck || deckId;
    let id = cur.meta.id || derivedId(deck, cur.front);
    if (seen[id]) id += '-' + ++seen[id];
    else seen[id] = 1;
    cards.push({
      id,
      front: cur.front,
      back: ls.slice(k).join('\n').trim(),
      tags: splitTags(cur.meta.tags),
      mode: cur.meta.mode === 'recall' ? 'recall' : 'basic',
      deck,
    });
    cur = null;
  };
  for (const l of body.split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(/^##\s+Q:\s*(.+)$/);
    if (m) {
      flush();
      cur = { front: m[1].trim(), lines: [], meta: {} };
    } else if (cur) cur.lines.push(l);
  }
  flush();
  return { meta, cards };
}

export function deckToMarkdown(deck, cards) {
  const head = ['---', `title: ${deck.title}`, `category: ${deck.category}`];
  if (deck.guide) head.push(`guide: ${deck.guide}`);
  if (deck.description) head.push(`description: ${deck.description}`);
  head.push('---', '');
  const body = cards.map((c) => {
    const meta = [];
    if (c.id !== derivedId(deck.id, c.front)) meta.push(`@id ${c.id}`);
    if (c.tags.length) meta.push(`@tags ${c.tags.join(', ')}`);
    if (c.mode === 'recall') meta.push('@mode recall');
    return [`## Q: ${c.front.replace(/\n+/g, ' ')}`, ...meta, '', c.back, ''].join('\n');
  });
  return head.join('\n') + '\n' + body.join('\n');
}

// ---------- CSV ----------
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
