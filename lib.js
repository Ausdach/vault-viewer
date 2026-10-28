/* Vault Viewer - pure logic: YAML subset, frontmatter, tags/links,
   Obsidian-flavoured Markdown renderer, Bases expression engine.
   No DOM access in here, so it can be tested under Node. */
(function (root) {
'use strict';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const basenameOf = p => { const f = String(p).split('/').pop(); const i = f.lastIndexOf('.'); return i > 0 ? f.slice(0, i) : f; };

/* ====================================================================
   YAML (the subset Obsidian frontmatter and .base files use)
   ==================================================================== */
function plain(s) {
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseFlow(s) {
  let p = 0;
  const ws = () => { while (p < s.length && /\s/.test(s[p])) p++; };
  function quoted() {
    const q = s[p++]; let out = '';
    while (p < s.length) {
      const c = s[p];
      if (c === q) { if (q === "'" && s[p + 1] === "'") { out += "'"; p += 2; continue; } break; }
      if (c === '\\' && q === '"') { out += s[p + 1]; p += 2; continue; }
      out += c; p++;
    }
    p++; return out;
  }
  function tok(stops) { const st = p; while (p < s.length && !stops.includes(s[p])) p++; return plain(s.slice(st, p).trim()); }
  function val() {
    ws();
    if (s[p] === '[') {
      p++; const a = []; ws();
      while (p < s.length && s[p] !== ']') { a.push(val()); ws(); if (s[p] === ',') p++; ws(); }
      p++; return a;
    }
    if (s[p] === '{') {
      p++; const o = {}; ws();
      while (p < s.length && s[p] !== '}') {
        ws();
        const k = (s[p] === '"' || s[p] === "'") ? quoted() : String(tok(':,}'));
        ws();
        if (s[p] === ':') { p++; o[k] = val(); } else o[k] = null;
        ws(); if (s[p] === ',') p++; ws();
      }
      p++; return o;
    }
    if (s[p] === '"' || s[p] === "'") return quoted();
    return tok(',]}');
  }
  return val();
}

function scalar(s) {
  s = s.trim();
  if (s === '') return null;
  const q = s[0];
  if (q === '"') { const m = s.match(/^"((?:[^"\\]|\\.)*)"/); if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; } } }
  if (q === "'") { const m = s.match(/^'((?:[^']|'')*)'/); if (m) return m[1].replace(/''/g, "'"); }
  if (q === '[' || q === '{') { try { return parseFlow(s); } catch (e) { return s; } }
  return plain(s.replace(/\s+#.*$/, ''));
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"\[{#][^:]*?)\s*:(?:\s+(.*))?$/;

function parseYaml(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  let i = 0;
  const blank = l => /^\s*(#.*)?$/.test(l);
  const ind = l => l.match(/^ */)[0].length;
  const isSeq = t => t === '-' || t.startsWith('- ');
  const skip = () => { while (i < lines.length && blank(lines[i])) i++; };

  function block(min) {
    skip();
    if (i >= lines.length) return null;
    const n = ind(lines[i]);
    if (n < min) return null;
    const t = lines[i].trim();
    if (isSeq(t)) return seq(n);
    if (KEY.test(t)) return map(n);
    i++; return scalar(t);
  }
  function seq(n) {
    const out = [];
    for (;;) {
      skip();
      if (i >= lines.length || ind(lines[i]) !== n) break;
      const t = lines[i].trim();
      if (!isSeq(t)) break;
      const rest = t.slice(1).trimStart();
      if (!rest) { i++; out.push(block(n + 1)); continue; }
      if (KEY.test(rest)) {
        const off = n + t.length - rest.length;
        lines[i] = ' '.repeat(off) + rest;
        out.push(map(off));
      } else { i++; out.push(scalar(rest)); }
    }
    return out;
  }
  function map(n) {
    const o = {};
    for (;;) {
      skip();
      if (i >= lines.length || ind(lines[i]) !== n) break;
      const t = lines[i].trim();
      if (isSeq(t)) break;
      const m = t.match(KEY);
      if (!m) break;
      let k = m[1];
      if (k[0] === '"' || k[0] === "'") k = String(scalar(k));
      const rest = (m[2] || '').trim();
      i++;
      if (rest === '' || rest[0] === '#') {
        skip();
        if (i < lines.length) {
          const ni = ind(lines[i]), nt = lines[i].trim();
          if (ni > n) o[k] = block(n + 1);
          else if (ni === n && isSeq(nt)) o[k] = seq(n);
          else o[k] = null;
        } else o[k] = null;
      } else if (/^[|>][+-]?\d*\s*$/.test(rest)) {
        const folded = rest[0] === '>'; const buf = []; let bi = null;
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === '') { buf.push(''); i++; continue; }
          const li = ind(l);
          if (li <= n) break;
          if (bi === null) bi = li;
          buf.push(l.slice(bi)); i++;
        }
        while (buf.length && buf[buf.length - 1] === '') buf.pop();
        o[k] = folded ? buf.join(' ') : buf.join('\n');
      } else o[k] = scalar(rest);
    }
    return o;
  }
  return block(0);
}

function reviveDates(v) {
  if (typeof v === 'string') {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); d.dateOnly = true; return d; }
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) {
      const d = new Date(v.replace(' ', 'T')); if (!isNaN(d)) return d;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(reviveDates);
  if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const k in v) o[k] = reviveDates(v[k]); return o; }
  return v;
}

function splitFrontmatter(text) {
  text = text.replace(/^\uFEFF/, '');
  const m = text.match(/^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, body: text };
  let fm = {};
  try { const y = parseYaml(m[1] || ''); if (y && typeof y === 'object' && !Array.isArray(y)) fm = reviveDates(y); } catch (e) { /* ignore */ }
  return { fm, body: text.slice(m[0].length) };
}

/* ====================================================================
   Tags and links
   ==================================================================== */
function stripCode(t) { return t.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/%%[\s\S]*?%%/g, ' '); }
const TAG_SRC = '(^|[\\s(,;])#((?:[\\p{L}\\p{N}_\\-/])*[\\p{L}_\\-/](?:[\\p{L}\\p{N}_\\-/])*)';

function propGet(props, name) {
  if (!props) return null;
  const v = props[name];
  if (v !== undefined) return v;
  const lk = String(name).toLowerCase();
  for (const k in props) if (k.toLowerCase() === lk) return props[k];
  return null;
}

function extractTags(body, fm) {
  const set = new Set();
  const add = t => { t = String(t).trim().replace(/^#/, ''); if (t) set.add(t); };
  const fv = propGet(fm, 'tags') != null ? propGet(fm, 'tags') : propGet(fm, 'tag');
  if (Array.isArray(fv)) fv.forEach(add); else if (typeof fv === 'string') fv.split(/[,\s]+/).forEach(add);
  const re = new RegExp(TAG_SRC, 'gu'); const txt = stripCode(body); let m;
  while ((m = re.exec(txt))) add(m[2]);
  return [...set];
}

function extractLinks(body, fm) {
  const out = []; const txt = stripCode(body);
  const re = /(!?)\[\[([^\[\]]*?)\]\]/g; let m;
  const pushWiki = (embed, inner) => {
    let tp = inner.replace(/\\\|/g, '|'); const bar = tp.indexOf('|'); if (bar >= 0) tp = tp.slice(0, bar);
    const h = tp.indexOf('#'); if (h >= 0) tp = tp.slice(0, h);
    tp = tp.trim(); if (tp) out.push({ target: tp, embed });
  };
  while ((m = re.exec(txt))) pushWiki(!!m[1], m[2]);
  const re2 = /(!?)\[[^\]]*\]\((<[^>]*>|[^\s)]+)[^)]*\)/g;
  while ((m = re2.exec(txt))) {
    let u = m[2].replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u[0] === '#') continue;
    u = u.split('#')[0]; try { u = decodeURIComponent(u); } catch (e) { /* */ }
    if (u) out.push({ target: u, embed: !!m[1], md: true });
  }
  const walk = v => {
    if (typeof v === 'string') { const r = /\[\[([^\[\]]*?)\]\]/g; let x; while ((x = r.exec(v))) pushWiki(false, x[1]); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object' && !(v instanceof Date)) Object.values(v).forEach(walk);
  };
  walk(fm);
  return out;
}

function plainHeading(t) {
  return t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~=]/g, '').trim();
}

/* ====================================================================
   Markdown renderer
   ==================================================================== */
const CALLOUT_ICONS = {
  note: '\u270E', abstract: '\u2630', info: '\u24D8', todo: '\u2611', tip: '\u2726', success: '\u2714', question: '?',
  warning: '\u26A0', failure: '\u2718', danger: '\u26A1', bug: '\u2731', example: '\u2261', quote: '\u275D'
};
const CALLOUT_ALIAS = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question',
  caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote'
};

function extLink(url, innerHtml) { return `<a class="external-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`; }

function renderEmbed(target, heading, alias, r) {
  if (!r) return `<span class="embed-unresolved">${esc(target)}</span>`;
  const p = esc(r.path);
  switch (r.kind) {
    case 'image': {
      let w = '', h = '', alt = alias || target;
      const m = alias && alias.match(/(?:^|\|)(\d+)(?:x(\d+))?$/);
      if (m) { w = ` width="${m[1]}"`; if (m[2]) h = ` height="${m[2]}"`; alt = alias.replace(/\|?\d+(?:x\d+)?$/, '') || target; }
      return `<img class="vault-img" data-src="${p}" alt="${esc(alt)}"${w}${h}>`;
    }
    case 'audio': return `<audio controls data-src="${p}"></audio>`;
    case 'video': return `<video controls data-src="${p}"></video>`;
    case 'pdf': return `<iframe class="embed-pdf" data-src="${p}"></iframe>`;
    case 'note': return `<span class="embed-note" data-path="${p}" data-heading="${esc(heading)}"></span>`;
    case 'base': return `<span class="embed-base" data-path="${p}"></span>`;
    default: return `<a class="internal-link" href="#" data-href="${p}">${esc(target)}</a>`;
  }
}

function renderWiki(embed, inner, o) {
  inner = inner.replace(/\\\|/g, '|');
  let alias = null, tp = inner;
  const bar = inner.indexOf('|');
  if (bar >= 0) { tp = inner.slice(0, bar); alias = inner.slice(bar + 1); }
  let target = tp, heading = '';
  const h = tp.indexOf('#');
  if (h >= 0) { target = tp.slice(0, h); heading = tp.slice(h + 1); }
  if (heading.startsWith('^')) heading = '';
  if (heading.includes('#')) heading = heading.split('#').pop();
  target = target.trim(); heading = heading.trim();
  const r = target ? o.resolve(target) : (o.self ? { path: o.self, kind: 'note' } : null);
  if (embed) return renderEmbed(target, heading, alias, r);
  const display = alias != null ? alias : ((target + (heading ? ' > ' + heading : '')) || heading);
  if (!r) return `<a class="internal-link is-unresolved" href="#" data-href="${esc(target)}">${esc(display)}</a>`;
  return `<a class="internal-link" href="#" data-href="${esc(r.path)}" data-heading="${esc(heading)}">${esc(display)}</a>`;
}

function renderMdLink(bang, label, url, o) {
  url = url.trim();
  if (url[0] === '<' && url.endsWith('>')) url = url.slice(1, -1);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (/^https?:/i.test(url)) {
      if (bang) return `<img class="external-image" src="${esc(url)}" alt="${esc(label)}" referrerpolicy="no-referrer">`;
      return extLink(url, renderInline(label || url, o));
    }
    if (/^(mailto|tel):/i.test(url) && !bang) return `<a class="external-link" href="${esc(url)}">${renderInline(label || url, o)}</a>`;
    return esc(label || url);
  }
  let p = url, heading = '';
  const h = p.indexOf('#');
  if (h >= 0) { heading = p.slice(h + 1); p = p.slice(0, h); }
  try { p = decodeURIComponent(p); heading = decodeURIComponent(heading); } catch (e) { /* */ }
  const r = p ? o.resolve(p) : (o.self ? { path: o.self, kind: 'note' } : null);
  if (bang) return renderEmbed(p, heading, label, r);
  const inner = renderInline(label || p, o);
  if (!r) return `<a class="internal-link is-unresolved" href="#" data-href="${esc(p)}">${inner}</a>`;
  return `<a class="internal-link" href="#" data-href="${esc(r.path)}" data-heading="${esc(heading)}">${inner}</a>`;
}

function renderInline(text, o) {
  o = o || { resolve: () => null };
  const store = [];
  const hold = html => { store.push(html); return '\uE000' + (store.length - 1) + '\uE001'; };
  let s = String(text);
  s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (m, a, b) => hold('<code>' + esc(b.trim()) + '</code>'));
  s = s.replace(/\$\$([^$]+?)\$\$/g, (m, t) => hold(`<span class="math-inline" data-display="1" data-tex="${esc(t)}">${esc(t)}</span>`));
  s = s.replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g, (m, t) => hold(`<span class="math-inline" data-tex="${esc(t)}">${esc(t)}</span>`));
  s = s.replace(/(!?)\[\[([^\[\]]*?)\]\]/g, (m, bang, inner) => hold(renderWiki(!!bang, inner, o)));
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~=>$%])/g, (m, c) => hold(esc(c)));
  s = s.replace(/(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(<[^>]*>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"]*")?\s*\)/g,
    (m, bang, label, url) => hold(renderMdLink(!!bang, label, url, o)));
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) => hold(extLink(u, esc(u))));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (m, pre, u) => pre + hold(extLink(u, esc(u))));
  s = esc(s);
  s = s.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])__(?!\s)([\s\S]+?)(?<!\s)__(?![\w*])/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '<em>$1</em>')
    .replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, '<em>$1</em>')
    .replace(/~~(?!\s)([\s\S]+?)(?<!\s)~~/g, '<del>$1</del>')
    .replace(/==(?!\s)([\s\S]+?)(?<!\s)==/g, '<mark>$1</mark>');
  s = s.replace(new RegExp(TAG_SRC, 'gu'), (m, pre, t) => `${pre}<a href="#" class="tag" data-tag="${t}">#${t}</a>`);
  s = s.replace(/&lt;(\/?)(br|b|i|u|em|strong|mark|sub|sup|kbd|small|del|s|ins|code)\s*\/?&gt;/gi, (m, sl, t) => t.toLowerCase() === 'br' ? '<br>' : `<${sl}${t}>`);
  let guard = 0;
  while (/\uE000\d+\uE001/.test(s) && guard++ < 6) s = s.replace(/\uE000(\d+)\uE001/g, (m, i) => store[+i]);
  return s.replace(/\n/g, '<br>');
}

const LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

function splitRow(line) {
  let t = line.trim();
  t = t.replace(/\[\[[^\]]*\]\]/g, m => m.replace(/\|/g, '\uE002'));
  const cells = t.split(/(?<!\\)\|/);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.replace(/\uE002/g, '|').trim());
}

function startsBlock(l, next) {
  if (/^\s*(`{3,}|~{3,})/.test(l) || /^#{1,6}\s/.test(l) || HR.test(l) || /^\s{0,3}>/.test(l) || LI.test(l.replace(/\t/g, '    ')) || /^\s*\$\$/.test(l)) return true;
  if (l.includes('|') && next && next.includes('|') && next.includes('-') && DELIM.test(next)) return true;
  return false;
}

function renderLi(n, o) {
  let txt = n.text.join('\n'), cls = '', pre = '';
  const t = txt.match(/^\[(.)\]\s+([\s\S]*)$/);
  if (t) {
    const done = t[1] !== ' ';
    cls = ` class="task-list-item${done ? ' is-checked' : ''}" data-task="${esc(t[1])}"`;
    pre = `<input type="checkbox" class="task-list-item-checkbox" disabled${done ? ' checked' : ''}>`;
    txt = t[2];
  }
  return `<li${cls}>${pre}${renderInline(txt, o)}${n.kids.length ? renderListNodes(n.kids, o) : ''}</li>`;
}
function renderListNodes(nodes, o) {
  let html = '', k = 0;
  while (k < nodes.length) {
    const ord = nodes[k].ordered; let j = k, inner = '';
    while (j < nodes.length && nodes[j].ordered === ord) { inner += renderLi(nodes[j], o); j++; }
    html += ord ? `<ol${nodes[k].start > 1 ? ` start="${nodes[k].start}"` : ''}>${inner}</ol>` : `<ul>${inner}</ul>`;
    k = j;
  }
  return html;
}

function renderBlocks(lines, o) {
  const out = []; let i = 0;
  const isBlank = l => /^\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
    if (m) {
      const fence = m[1], lang = m[2]; i++; const buf = [];
      const closeRe = new RegExp('^\\s*' + fence[0] + '{' + fence.length + ',}\\s*$');
      while (i < lines.length && !closeRe.test(lines[i])) buf.push(lines[i++]);
      i++;
      if (lang.toLowerCase() === 'mermaid') out.push(`<div class="mermaid-block" data-src="${esc(buf.join('\n'))}"></div>`);
      else out.push(`<pre><code class="language-${esc(lang)}">${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const buf = []; let first = line.replace(/^\s*\$\$/, '');
      if (/\$\$\s*$/.test(first)) { out.push(`<div class="math-block" data-tex="${esc(first.replace(/\$\$\s*$/, ''))}">${esc(first.replace(/\$\$\s*$/, ''))}</div>`); i++; continue; }
      if (first.trim()) buf.push(first); i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) { buf.push(lines[i].replace(/\$\$\s*$/, '')); i++; }
      out.push(`<div class="math-block" data-tex="${esc(buf.join('\n'))}">${esc(buf.join('\n'))}</div>`); continue;
    }
    m = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
    if (m) {
      const n = m[1].length;
      out.push(`<h${n} data-heading="${esc(plainHeading(m[2]))}">${renderInline(m[2], o)}</h${n}>`); i++; continue;
    }
    if (HR.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
      const c = buf[0].match(/^\[!([\w-]+)\]([+-]?)\s*(.*)$/);
      if (c) {
        let type = c[1].toLowerCase(); type = CALLOUT_ALIAS[type] || type;
        const title = c[3] || (c[1][0].toUpperCase() + c[1].slice(1).toLowerCase());
        const fold = c[2];
        const body = renderBlocks(buf.slice(1), o);
        out.push(`<div class="callout${fold ? ' is-collapsible' : ''}${fold === '-' ? ' is-collapsed' : ''}" data-callout="${esc(type)}">` +
          `<div class="callout-title"><div class="callout-icon">${CALLOUT_ICONS[type] || CALLOUT_ICONS.note}</div>` +
          `<div class="callout-title-inner">${renderInline(title, o)}</div>${fold ? '<div class="callout-fold">\u25BE</div>' : ''}</div>` +
          (body ? `<div class="callout-content">${body}</div>` : '') + '</div>');
      } else out.push('<blockquote>' + renderBlocks(buf, o) + '</blockquote>');
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].includes('-') && DELIM.test(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      i += 2; const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      const al = k => aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
      out.push('<table><thead><tr>' + head.map((c, k) => `<th${al(k)}>${renderInline(c, o)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + head.map((_, k) => `<td${al(k)}>${renderInline(r[k] || '', o)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (LI.test(line.replace(/\t/g, '    '))) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i].replace(/\t/g, '    '); const lm = l.match(LI);
        if (lm) { items.push({ indent: lm[1].length, ordered: /\d/.test(lm[2][0]), start: parseInt(lm[2], 10), text: [lm[3]], kids: [] }); i++; }
        else if (isBlank(l)) {
          let j = i + 1; while (j < lines.length && isBlank(lines[j])) j++;
          const nl = j < lines.length ? lines[j].replace(/\t/g, '    ') : '';
          if (items.length && j < lines.length && (LI.test(nl) || /^\s{2,}\S/.test(nl))) i = j; else break;
        }
        else if (/^\s+\S/.test(l) && items.length) { items[items.length - 1].text.push(l.trim()); i++; }
        else break;
      }
      const roots = [], stack = [];
      for (const it of items) {
        while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop();
        (stack.length ? stack[stack.length - 1].kids : roots).push(it);
        stack.push(it);
      }
      out.push(renderListNodes(roots, o));
      continue;
    }
    const buf = [line]; i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) buf.push(lines[i++]);
    out.push('<p>' + renderInline(buf.join('\n'), o) + '</p>');
  }
  return out.join('\n');
}

function renderMarkdown(src, o) {
  src = String(src).replace(/\r\n?/g, '\n').replace(/%%[\s\S]*?%%/g, '');
  return renderBlocks(src.split('\n'), o || { resolve: () => null });
}

function sectionOf(body, heading) {
  const lines = body.split('\n'), want = heading.trim().toLowerCase();
  let start = -1, level = 0, code = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) code = !code;
    if (code) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    if (start < 0) { if (plainHeading(m[2]).toLowerCase() === want) { start = i; level = m[1].length; } }
    else if (m[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return start < 0 ? '' : lines.slice(start).join('\n');
}

/* ====================================================================
   Dates / durations
   ==================================================================== */
const p2 = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtDate(d) {
  const s = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return d.dateOnly ? s : `${s} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function formatDate(d, f) {
  return String(f).replace(/YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g, t => {
    switch (t) {
      case 'YYYY': return d.getFullYear(); case 'YY': return String(d.getFullYear()).slice(-2);
      case 'MMMM': return MONTHS[d.getMonth()]; case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return p2(d.getMonth() + 1); case 'M': return d.getMonth() + 1;
      case 'dddd': return DAYS[d.getDay()]; case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'DD': return p2(d.getDate()); case 'D': return d.getDate();
      case 'HH': return p2(d.getHours()); case 'H': return d.getHours();
      case 'hh': return p2(d.getHours() % 12 || 12); case 'h': return d.getHours() % 12 || 12;
      case 'mm': return p2(d.getMinutes()); case 'ss': return p2(d.getSeconds());
      case 'A': return d.getHours() < 12 ? 'AM' : 'PM'; case 'a': return d.getHours() < 12 ? 'am' : 'pm';
    } return t;
  });
}
function mkDur(ms) {
  return { __dur: true, ms, valueOf() { return ms; }, days: ms / 864e5, hours: ms / 36e5, minutes: ms / 6e4, seconds: ms / 1e3, milliseconds: ms,
    toString() { const a = Math.abs(ms); if (a >= 864e5) return Math.round(ms / 864e5) + 'd'; if (a >= 36e5) return Math.round(ms / 36e5) + 'h'; if (a >= 6e4) return Math.round(ms / 6e4) + 'm'; return Math.round(ms / 1e3) + 's'; } };
}
function addDuration(d, str, sign) {
  const r = new Date(d.getTime()); r.dateOnly = d.dateOnly;
  const re = /(\d+(?:\.\d+)?)\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|s)\b/g; let m, any = false;
  while ((m = re.exec(String(str)))) {
    any = true; const n = parseFloat(m[1]) * sign, u = m[2];
    if (/^y/.test(u)) r.setFullYear(r.getFullYear() + n);
    else if (u === 'M' || /^mon/.test(u)) r.setMonth(r.getMonth() + n);
    else if (/^w/.test(u)) r.setDate(r.getDate() + 7 * n);
    else if (/^d/.test(u)) r.setDate(r.getDate() + n);
    else if (/^h/.test(u)) r.setHours(r.getHours() + n);
    else if (/^(m|min)/.test(u)) r.setMinutes(r.getMinutes() + n);
    else r.setSeconds(r.getSeconds() + n);
  }
  return any ? r : null;
}
function durMs(str) { const a = new Date(0), b = addDuration(a, str, 1); return b ? b - a : 0; }
function toDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') { const r = reviveDates(v.trim()); if (r instanceof Date) return r; const d = new Date(v); return isNaN(d) ? null : d; }
  return null;
}
function relative(d) {
  const diff = d.getTime() - Date.now(), a = Math.abs(diff);
  const u = a < 6e4 ? [1e3, 'second'] : a < 36e5 ? [6e4, 'minute'] : a < 864e5 ? [36e5, 'hour'] : a < 2592e6 ? [864e5, 'day'] : a < 31536e6 ? [2592e6, 'month'] : [31536e6, 'year'];
  const n = Math.round(a / u[0]);
  return diff < 0 ? `${n} ${u[1]}${n === 1 ? '' : 's'} ago` : `in ${n} ${u[1]}${n === 1 ? '' : 's'}`;
}

/* ====================================================================
   Bases: values, expressions, filters
   ==================================================================== */
const mkLink = (path, display) => ({ __link: true, path, display: display || null });
const isLink = v => !!(v && v.__link);
const isDur = v => !!(v && v.__dur);

function str(v) {
  if (v == null) return '';
  if (v instanceof Date) return fmtDate(v);
  if (isLink(v)) return v.display || basenameOf(v.path);
  if (isDur(v)) return v.toString();
  if (Array.isArray(v)) return v.map(str).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const truthy = v => !(v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length));
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !(v instanceof Date) && !isLink(v) && !isDur(v) && !Object.keys(v).length);

function linkish(v) {
  if (isLink(v)) return v.path;
  if (typeof v === 'string') { const m = v.match(/^\[\[([^\]|#]*)/); if (m) return m[1]; }
  return null;
}
function eq(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) { const x = toDate(a), y = toDate(b); return !!x && !!y && +x === +y; }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => eq(v, b[i]));
  const la = linkish(a), lb = linkish(b);
  if (la !== null || lb !== null) {
    const x = la !== null ? la : String(a), y = lb !== null ? lb : String(b);
    return x === y || basenameOf(x).toLowerCase() === basenameOf(y).toLowerCase();
  }
  if (isDur(a) || isDur(b)) return +a === +b;
  return a === b;
}
function cmp(a, b) {
  if (isLink(a)) a = str(a); if (isLink(b)) b = str(b);
  if (a instanceof Date || b instanceof Date) { const x = +(toDate(a) || 0), y = +(toDate(b) || 0); return x < y ? -1 : x > y ? 1 : 0; }
  if (isDur(a) || isDur(b)) { const x = +a, y = +b; return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'boolean') a = +a; if (typeof b === 'boolean') b = +b;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a)) a = str(a); if (Array.isArray(b)) b = str(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

class NS { constructor(n) { this.n = n; } }
const NS_FILE = new NS('file'), NS_NOTE = new NS('note'), NS_FORMULA = new NS('formula'), NS_THIS = new NS('this');

const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

function tokenize(src) {
  const t = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/); t.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { const n = src[j + 1]; out += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; } else out += src[j++]; }
      t.push({ t: 'str', v: out }); i = j + 1; continue;
    }
    if (/[A-Za-z_$\u00C0-\uFFFF]/.test(c)) { const m = src.slice(i).match(/^[\w$\u00C0-\uFFFF]+/); t.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = src.substr(i, 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { t.push({ t: 'op', v: two }); i += 2; continue; }
    t.push({ t: 'op', v: c }); i++;
  }
  return t;
}

function parseExpr(src) {
  const tk = tokenize(src); let p = 0;
  const isOp = v => tk[p] && tk[p].t === 'op' && tk[p].v === v;
  function binary(l) {
    if (l >= LEVELS.length) return unary();
    let left = binary(l + 1);
    while (tk[p] && tk[p].t === 'op' && LEVELS[l].includes(tk[p].v)) { const op = tk[p++].v; left = { k: 'bin', op, l: left, r: binary(l + 1) }; }
    return left;
  }
  function unary() {
    if (isOp('!')) { p++; return { k: 'not', e: unary() }; }
    if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
    return postfix();
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isOp('.')) { p++; const n = tk[p++]; if (!n) throw new Error('Bad member'); e = { k: 'mem', o: e, n: String(n.v) }; }
      else if (isOp('(')) { p++; const a = []; while (p < tk.length && !isOp(')')) { a.push(binary(0)); if (isOp(',')) p++; } p++; e = { k: 'call', f: e, a }; }
      else if (isOp('[')) { p++; const ix = binary(0); p++; e = { k: 'idx', o: e, i: ix }; }
      else break;
    }
    return e;
  }
  function primary() {
    const t = tk[p++];
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      return { k: 'id', n: t.v };
    }
    if (t.v === '(') { const e = binary(0); p++; return e; }
    if (t.v === '[') { const a = []; while (p < tk.length && !isOp(']')) { a.push(binary(0)); if (isOp(',')) p++; } p++; return { k: 'list', a }; }
    throw new Error('Unexpected ' + t.v);
  }
  const e = binary(0);
  if (p < tk.length) throw new Error('Unexpected ' + tk[p].v);
  return e;
}

const astCache = new Map();
function evalExprString(src, ctx) {
  let ast = astCache.get(src);
  if (!ast) { ast = parseExpr(src); astCache.set(src, ast); }
  return evaluate(ast, ctx, null);
}

function evalFormula(name, ctx) {
  const defs = (ctx.base && ctx.base.formulas) || {};
  if (!(name in defs)) return null;
  if (ctx.cache.has(name)) return ctx.cache.get(name);
  if (ctx.stack.has(name)) return null;
  ctx.stack.add(name);
  let v = null;
  try { v = evalExprString(String(defs[name]), ctx); } catch (e) { v = null; }
  ctx.stack.delete(name); ctx.cache.set(name, v);
  return v;
}

function member(o, name, ctx) {
  if (o instanceof NS) {
    if (o.n === 'file') { const v = ctx.file ? ctx.file[name] : null; return v === undefined ? null : v; }
    if (o.n === 'note') return propGet(ctx.props, name);
    if (o.n === 'formula') return evalFormula(name, ctx);
    return null;
  }
  if (o == null) return null;
  if (o instanceof Date) {
    switch (name) {
      case 'year': return o.getFullYear(); case 'month': return o.getMonth() + 1; case 'day': return o.getDate();
      case 'hour': return o.getHours(); case 'minute': return o.getMinutes(); case 'second': return o.getSeconds(); case 'millisecond': return o.getMilliseconds();
    } return null;
  }
  if (typeof o === 'string' || Array.isArray(o)) return name === 'length' ? o.length : null;
  if (typeof o === 'object') { const v = o[name]; return v === undefined ? null : v; }
  return null;
}

function hasTag(tags, t) {
  t = t.replace(/^#/, '').toLowerCase();
  return (tags || []).some(x => { x = String(x).replace(/^#/, '').toLowerCase(); return x === t || x.startsWith(t + '/'); });
}
function inFolder(folder, arg) {
  arg = String(arg).replace(/^\/+|\/+$/g, '');
  return arg === '' || folder === arg || folder.startsWith(arg + '/');
}

function callFn(name, argNodes, ctx, scope) {
  const A = () => argNodes.map(a => evaluate(a, ctx, scope));
  switch (name) {
    case 'if': return truthy(evaluate(argNodes[0], ctx, scope)) ? evaluate(argNodes[1], ctx, scope) : (argNodes[2] ? evaluate(argNodes[2], ctx, scope) : null);
    case 'today': { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth(), n.getDate()); d.dateOnly = true; return d; }
    case 'now': return new Date();
    case 'date': { const v = toDate(A()[0]); if (v) { const d = new Date(v.getFullYear(), v.getMonth(), v.getDate()); d.dateOnly = true; return d; } return null; }
    case 'duration': return mkDur(durMs(A()[0]));
    case 'link': { const a = A(); return mkLink(String(isLink(a[0]) ? a[0].path : a[0]), a[1] != null ? str(a[1]) : null); }
    case 'list': { const v = A()[0]; return Array.isArray(v) ? v : (v == null ? [] : [v]); }
    case 'number': { const n = Number(A()[0]); return isNaN(n) ? null : n; }
    case 'min': return Math.min(...A().flat().map(Number));
    case 'max': return Math.max(...A().flat().map(Number));
    case 'escapeHTML': return esc(str(A()[0]));
    case 'icon': case 'image': case 'html': return A()[0];
    default: throw new Error('Unknown function ' + name);
  }
}

function callMethod(obj, name, argNodes, ctx, scope) {
  const A = () => argNodes.map(a => evaluate(a, ctx, scope));
  if (obj instanceof NS && obj.n === 'file') {
    const f = ctx.file || {}, a = A();
    switch (name) {
      case 'hasTag': return a.some(t => hasTag(f.tags, String(t)));
      case 'inFolder': return inFolder(f.folder || '', a[0]);
      case 'hasLink': { const t = linkish(a[0]) !== null ? linkish(a[0]) : String(isLink(a[0]) ? a[0].path : a[0]); return (f.links || []).some(l => l.path === t || basenameOf(l.path).toLowerCase() === basenameOf(t).toLowerCase()); }
      case 'hasProperty': return propGet(ctx.props, String(a[0])) !== null;
      case 'asLink': return mkLink(f.path, a[0] != null ? str(a[0]) : null);
    }
    throw new Error('Unknown file method ' + name);
  }
  if (Array.isArray(obj) && (name === 'filter' || name === 'map')) {
    const out = [];
    obj.forEach((value, index) => {
      const r = evaluate(argNodes[0], ctx, Object.assign({}, scope, { value, index }));
      if (name === 'filter') { if (truthy(r)) out.push(value); } else out.push(r);
    });
    return out;
  }
  const a = A();
  switch (name) {
    case 'isEmpty': return isEmpty(obj);
    case 'toString': return str(obj);
    case 'isType': { const t = String(a[0]); const ty = obj == null ? 'null' : Array.isArray(obj) ? 'list' : obj instanceof Date ? 'date' : isLink(obj) ? 'link' : typeof obj === 'object' ? 'object' : typeof obj; return t === ty; }
  }
  if (typeof obj === 'string') {
    switch (name) {
      case 'contains': return obj.includes(String(a[0]));
      case 'containsAll': return a.flat().every(x => obj.includes(String(x)));
      case 'containsAny': return a.flat().some(x => obj.includes(String(x)));
      case 'startsWith': return obj.startsWith(String(a[0]));
      case 'endsWith': return obj.endsWith(String(a[0]));
      case 'lower': return obj.toLowerCase();
      case 'upper': return obj.toUpperCase();
      case 'title': return obj.replace(/\b\w/g, c => c.toUpperCase());
      case 'trim': return obj.trim();
      case 'replace': return obj.split(String(a[0])).join(String(a[1]));
      case 'split': return obj.split(String(a[0]));
      case 'slice': return obj.slice(a[0], a[1]);
      case 'repeat': return obj.repeat(Number(a[0]) || 0);
      case 'reverse': return [...obj].reverse().join('');
    }
  }
  if (typeof obj === 'number') {
    switch (name) {
      case 'abs': return Math.abs(obj); case 'ceil': return Math.ceil(obj); case 'floor': return Math.floor(obj);
      case 'round': { const d = Number(a[0]) || 0, k = Math.pow(10, d); return Math.round(obj * k) / k; }
      case 'toFixed': return obj.toFixed(Number(a[0]) || 0);
    }
  }
  if (Array.isArray(obj)) {
    const has = x => obj.some(y => eq(y, x) || (typeof y === 'string' && typeof x === 'string' && y.replace(/^#/, '') === x.replace(/^#/, '')));
    switch (name) {
      case 'contains': return has(a[0]);
      case 'containsAll': return a.flat().every(has);
      case 'containsAny': return a.flat().some(has);
      case 'join': return obj.map(str).join(a[0] == null ? ',' : String(a[0]));
      case 'sort': return obj.slice().sort(cmp);
      case 'unique': return obj.filter((x, i) => obj.findIndex(y => eq(x, y)) === i);
      case 'flat': return obj.flat();
      case 'reverse': return obj.slice().reverse();
      case 'slice': return obj.slice(a[0], a[1]);
    }
  }
  if (obj instanceof Date) {
    switch (name) {
      case 'format': return formatDate(obj, a[0]);
      case 'date': { const d = new Date(obj.getFullYear(), obj.getMonth(), obj.getDate()); d.dateOnly = true; return d; }
      case 'time': return `${p2(obj.getHours())}:${p2(obj.getMinutes())}:${p2(obj.getSeconds())}`;
      case 'relative': return relative(obj);
    }
  }
  throw new Error('Unknown method ' + name);
}

function evaluate(n, ctx, scope) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'list': return n.a.map(x => evaluate(x, ctx, scope));
    case 'id': {
      if (scope && n.n in scope) return scope[n.n];
      if (n.n === 'file') return NS_FILE; if (n.n === 'note') return NS_NOTE; if (n.n === 'formula') return NS_FORMULA; if (n.n === 'this') return NS_THIS;
      return propGet(ctx.props, n.n);
    }
    case 'not': return !truthy(evaluate(n.e, ctx, scope));
    case 'neg': return -Number(evaluate(n.e, ctx, scope));
    case 'mem': return member(evaluate(n.o, ctx, scope), n.n, ctx);
    case 'idx': {
      const o = evaluate(n.o, ctx, scope), i = evaluate(n.i, ctx, scope);
      if (o instanceof NS) return member(o, String(i), ctx);
      if (Array.isArray(o)) return o[Number(i)] === undefined ? null : o[Number(i)];
      if (o && typeof o === 'object') return o[i] === undefined ? null : o[i];
      return null;
    }
    case 'call': {
      if (n.f.k === 'id') return callFn(n.f.n, n.a, ctx, scope);
      if (n.f.k === 'mem') return callMethod(evaluate(n.f.o, ctx, scope), n.f.n, n.a, ctx, scope);
      throw new Error('Not callable');
    }
    case 'bin': {
      if (n.op === '&&') return truthy(evaluate(n.l, ctx, scope)) && truthy(evaluate(n.r, ctx, scope));
      if (n.op === '||') return truthy(evaluate(n.l, ctx, scope)) || truthy(evaluate(n.r, ctx, scope));
      const a = evaluate(n.l, ctx, scope), b = evaluate(n.r, ctx, scope);
      switch (n.op) {
        case '==': return eq(a, b);
        case '!=': return !eq(a, b);
        case '<': case '>': case '<=': case '>=': {
          if (a == null || b == null) return false;
          const c = cmp(a, b);
          return n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
        }
        case '+':
          if (a instanceof Date && typeof b === 'string') return addDuration(a, b, 1);
          if (a instanceof Date && isDur(b)) return new Date(+a + b.ms);
          if (typeof a === 'string' || typeof b === 'string') return str(a) + str(b);
          return Number(a) + Number(b);
        case '-':
          if (a instanceof Date && b instanceof Date) return mkDur(+a - +b);
          if (a instanceof Date && typeof b === 'string') return addDuration(a, b, -1);
          if (a instanceof Date && isDur(b)) return new Date(+a - b.ms);
          return Number(a) - Number(b);
        case '*': return Number(a) * Number(b);
        case '/': return Number(a) / Number(b);
        case '%': return Number(a) % Number(b);
      }
    }
  }
  return null;
}

function makeCtx(row, base) { return { file: row.file, props: row.props || {}, base: base || {}, cache: new Map(), stack: new Set() }; }

function evalFilter(f, ctx) {
  if (f == null) return true;
  if (typeof f === 'string') { try { return truthy(evalExprString(f, ctx)); } catch (e) { return false; } }
  if (Array.isArray(f)) return f.every(x => evalFilter(x, ctx));
  if (typeof f === 'object') {
    if (f.and) return [].concat(f.and).every(x => evalFilter(x, ctx));
    if (f.or) return [].concat(f.or).some(x => evalFilter(x, ctx));
    if (f.not) return ![].concat(f.not).some(x => evalFilter(x, ctx));
  }
  return true;
}

function getValue(id, ctx) {
  id = String(id);
  if (id.startsWith('file.')) { const v = ctx.file ? ctx.file[id.slice(5)] : null; return v === undefined ? null : v; }
  if (id.startsWith('formula.')) return evalFormula(id.slice(8), ctx);
  if (id.startsWith('note.')) return propGet(ctx.props, id.slice(5));
  const v = propGet(ctx.props, id);
  if (v !== null) return v;
  if (/[()\[\]"']/.test(id)) { try { return evalExprString(id, ctx); } catch (e) { return null; } }
  return null;
}

const DEFAULT_LABELS = { 'file.name': 'Name', 'file.basename': 'Basename', 'file.folder': 'Folder', 'file.path': 'Path', 'file.ext': 'Extension', 'file.size': 'Size', 'file.ctime': 'Created', 'file.mtime': 'Modified', 'file.tags': 'Tags', 'file.links': 'Links', 'file.backlinks': 'Backlinks', 'file.link': 'Link' };
function propLabel(id, base) {
  const d = base && base.properties && base.properties[id];
  if (d && d.displayName) return String(d.displayName);
  if (DEFAULT_LABELS[id]) return DEFAULT_LABELS[id];
  return String(id).replace(/^(note|formula)\./, '');
}

root.VaultLib = {
  esc, basenameOf, parseYaml, splitFrontmatter, reviveDates, extractTags, extractLinks, plainHeading,
  renderMarkdown, renderInline, sectionOf, fmtDate, formatDate, str, cmp, eq, mkLink, isLink, isDur,
  makeCtx, evalFilter, getValue, propLabel, evalExprString, truthy, propGet
};
})(typeof window !== 'undefined' ? window : globalThis);
