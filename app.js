/* Vault Viewer UI - read-only Obsidian vault viewer. Everything runs client-side. */
(function () {
'use strict';
const L = window.VaultLib;
const $ = (s, r) => (r || document).querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const naturalCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } } };

const IC = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 1M7 8l4 8M17 10l-4 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'
};
const svg = n => `<svg class="ic" viewBox="0 0 24 24">${IC[n]}</svg>`;

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'ico']);
const AUD = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', '3gp']);
const VID = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv']);
const kindOfExt = e => e === 'md' ? 'note' : e === 'base' ? 'base' : IMG.has(e) ? 'image' : AUD.has(e) ? 'audio' : VID.has(e) ? 'video' : e === 'pdf' ? 'pdf' : 'file';

/* ---------------- state ---------------- */
const S = {
  name: '', files: new Map(), byName: new Map(), byPath: new Map(), backlinks: new Map(),
  templateFolders: [], opts: { templates: false, attachments: false }, query: '',
  expanded: new Set(), urls: new Map(), viewSel: {}, lastNote: null, cleanup: null
};
const nav = { stack: [], idx: -1 };
const content = () => $('#content');

/* ---------------- vault loading ---------------- */
function showLoading(t) { $('#loading').hidden = false; $('#loading-text').textContent = t; }
function hideLoading() { $('#loading').hidden = true; }

async function walk(dir, prefix, out) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') {
      if (name.startsWith('.')) { if (name === '.obsidian') await readCfg(h, out); continue; }
      await walk(h, prefix + name + '/', out);
    } else if (!name.startsWith('.')) out.push({ path: prefix + name, file: await h.getFile() });
  }
}
async function readCfg(obs, out) {
  try { const fh = await obs.getFileHandle('templates.json'); out.push({ path: '.obsidian/templates.json', file: await fh.getFile() }); } catch (e) { /* none */ }
  try {
    const p = await (await obs.getDirectoryHandle('plugins')).getDirectoryHandle('templater-obsidian');
    out.push({ path: '.obsidian/plugins/templater-obsidian/data.json', file: await (await p.getFileHandle('data.json')).getFile() });
  } catch (e) { /* none */ }
}

async function pickVault() {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' });
      showLoading('Scanning folder…');
      const entries = []; await walk(dir, '', entries);
      return loadVault(entries, dir.name);
    } catch (e) { hideLoading(); if (e && e.name === 'AbortError') return; }
  }
  $('#picker').click();
}

async function loadVault(entries, name) {
  showLoading('Indexing…');
  await new Promise(r => setTimeout(r, 20));
  for (const u of S.urls.values()) URL.revokeObjectURL(u);
  Object.assign(S, { name, files: new Map(), byName: new Map(), byPath: new Map(), backlinks: new Map(), templateFolders: [], urls: new Map(), viewSel: {}, lastNote: null, query: '' });
  S.expanded = new Set(); $('#search').value = '';
  nav.stack = []; nav.idx = -1;

  const cfg = {};
  for (const e of entries) {
    const parts = e.path.split('/');
    if (parts[0] === '.obsidian') { cfg[e.path] = e.file; continue; }
    if (parts.some(p => p.startsWith('.'))) continue;
    const fname = parts[parts.length - 1], dot = fname.lastIndexOf('.');
    const ext = dot > 0 ? fname.slice(dot + 1).toLowerCase() : '';
    S.files.set(e.path, {
      path: e.path, file: e.file, name: fname, base: dot > 0 ? fname.slice(0, dot) : fname, ext, kind: kindOfExt(ext),
      folder: parts.slice(0, -1).join('/'), size: e.file.size, mtime: new Date(e.file.lastModified), hidden: false
    });
  }
  try { if (cfg['.obsidian/templates.json']) { const j = JSON.parse(await cfg['.obsidian/templates.json'].text()); if (j.folder) S.templateFolders.push(String(j.folder).replace(/^\/|\/$/g, '').toLowerCase()); } } catch (e) { /* */ }
  try { const k = '.obsidian/plugins/templater-obsidian/data.json'; if (cfg[k]) { const j = JSON.parse(await cfg[k].text()); if (j.templates_folder) S.templateFolders.push(String(j.templates_folder).replace(/^\/|\/$/g, '').toLowerCase()); } } catch (e) { /* */ }
  for (const f of S.files.values()) {
    const segs = f.folder.toLowerCase().split('/');
    f.hidden = !!f.folder && (segs.some(s => /^_?templates?$/.test(s)) ||
      S.templateFolders.some(t => t && (f.folder.toLowerCase() === t || f.folder.toLowerCase().startsWith(t + '/'))));
  }

  const add = (m, k, p) => { const a = m.get(k); if (a) a.push(p); else m.set(k, [p]); };
  for (const f of S.files.values()) {
    const lp = f.path.toLowerCase();
    S.byPath.set(lp, f.path); if (f.kind === 'note') S.byPath.set(lp.slice(0, -3), f.path);
    add(S.byName, f.name.toLowerCase(), f.path); if (f.kind === 'note') add(S.byName, f.base.toLowerCase(), f.path);
  }

  const notes = [...S.files.values()].filter(f => f.kind === 'note');
  for (let k = 0; k < notes.length; k += 64) {
    await Promise.all(notes.slice(k, k + 64).map(async f => {
      let text = ''; try { text = await f.file.text(); } catch (e) { /* */ }
      const { fm, body } = L.splitFrontmatter(text);
      f.fm = fm; f.body = body; f.tags = L.extractTags(body, fm); f.rawLinks = L.extractLinks(body, fm);
    }));
    showLoading(`Reading notes… ${Math.min(k + 64, notes.length)} / ${notes.length}`);
  }
  for (const f of notes) {
    const seen = new Set(), un = new Set(); f.links = [];
    for (const l of f.rawLinks) {
      const r = resolveRef(l.target, f.path);
      if (r) { if (!seen.has(r.path)) { seen.add(r.path); f.links.push(r.path); } } else if (!l.md) un.add(l.target);
    }
    f.unresolved = [...un];
    for (const p of f.links) { if (p === f.path) continue; let s = S.backlinks.get(p); if (!s) S.backlinks.set(p, s = new Set()); s.add(f.path); }
  }
  hideLoading();
  $('#vault-name').textContent = name;
  document.title = name + ' – Vault Viewer';
  renderSidebar();
  const first = [...S.files.values()].filter(f => f.kind === 'base' && !f.hidden).sort((a, b) => naturalCmp(a.path, b.path))[0];
  if (first) openPath(first.path); else showGraph();
}

/* ---------------- link resolution ---------------- */
function pick(cands, from) {
  if (cands.length === 1) return cands[0];
  const dir = (from || '').split('/').slice(0, -1);
  const score = p => { const d = p.split('/').slice(0, -1); let i = 0; while (i < d.length && i < dir.length && d[i] === dir[i]) i++; return i; };
  return cands.slice().sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
}
function resolveRef(target, from) {
  let t = String(target).trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!t) return null;
  const lower = t.toLowerCase();
  let path = S.byPath.get(lower);
  if (!path) {
    const last = lower.split('/').pop();
    let c = S.byName.get(last) || [];
    if (lower.includes('/')) c = c.filter(p => { const lp = p.toLowerCase(); return lp.endsWith('/' + lower) || lp.endsWith('/' + lower + '.md') || lp === lower || lp === lower + '.md'; });
    if (!c.length && !/\.[a-z0-9]+$/.test(last)) c = (S.byName.get(last + '.md') || []);
    if (c.length) path = pick(c, from);
  }
  if (!path) return null;
  return { path, kind: S.files.get(path).kind };
}
const refOpts = from => ({ resolve: t => resolveRef(t, from), self: from });
function urlFor(f) { let u = S.urls.get(f.path); if (!u) { u = URL.createObjectURL(f.file); S.urls.set(f.path, u); } return u; }

/* ---------------- sidebar ---------------- */
function visible(f) { return !f.hidden || S.opts.templates; }
function matchQuery(f) {
  const q = S.query.trim().toLowerCase(); if (!q) return true;
  return q.split(/\s+/).every(tok => tok[0] === '#' ? (f.tags || []).some(t => t.toLowerCase().startsWith(tok.slice(1))) : f.path.toLowerCase().includes(tok));
}
function renderSidebar() {
  const bases = [...S.files.values()].filter(f => f.kind === 'base' && visible(f) && matchQuery(f)).sort((a, b) => naturalCmp(a.base, b.base));
  $('#bases-section').hidden = !bases.length;
  const bl = $('#bases-list'); bl.innerHTML = '';
  for (const f of bases) bl.append(navFile(f, true));
  renderTree();
  markActive();
}
function navFile(f, isBase) {
  const d = el('div', 'nav-file'), t = el('div', 'nav-file-title'); t.dataset.path = f.path;
  const ic = el('div', 'nav-file-icon'); ic.innerHTML = svg(isBase ? 'table' : f.kind === 'image' ? 'img' : 'file'); t.append(ic);
  t.append(el('div', 'nav-file-title-content', f.base));
  if (f.kind !== 'note' && !isBase) t.append(el('span', 'ext', f.ext));
  t.onclick = () => openPath(f.path);
  d.append(t); return d;
}
function renderTree() {
  const tree = $('#tree'); tree.innerHTML = '';
  const rootN = { dirs: new Map(), files: [] }; const searching = !!S.query.trim(); let count = 0;
  for (const f of S.files.values()) {
    if (f.kind === 'base' || !visible(f) || !matchQuery(f)) continue;
    if (f.kind !== 'note' && !S.opts.attachments) continue;
    let n = rootN; if (f.folder) for (const seg of f.folder.split('/')) { let c = n.dirs.get(seg); if (!c) n.dirs.set(seg, c = { dirs: new Map(), files: [] }); n = c; }
    n.files.push(f); count++;
  }
  if (!count) { tree.append(el('div', 'nav-empty', S.files.size ? 'No matching notes' : 'Open a vault folder to begin')); return; }
  const build = (n, path, parent) => {
    [...n.dirs.keys()].sort(naturalCmp).forEach(name => {
      const p = path ? path + '/' + name : name;
      const box = el('div', 'nav-folder'); const title = el('div', 'nav-folder-title');
      title.append(el('div', 'nav-folder-collapse-indicator', '▾'), el('div', 'nav-folder-title-content', name));
      const kids = el('div', 'nav-folder-children');
      if (!searching && !S.expanded.has(p)) box.classList.add('is-collapsed');
      title.onclick = () => { const c = box.classList.toggle('is-collapsed'); if (c) S.expanded.delete(p); else S.expanded.add(p); };
      box.append(title, kids); parent.append(box); build(n.dirs.get(name), p, kids);
    });
    n.files.sort((a, b) => naturalCmp(a.base, b.base)).forEach(f => parent.append(navFile(f, false)));
  };
  build(rootN, '', tree);
}
function markActive() {
  const cur = nav.stack[nav.idx]; const path = cur && cur.path;
  document.querySelectorAll('.nav-file-title.is-active').forEach(e => e.classList.remove('is-active'));
  if (!path) return;
  const t = [...document.querySelectorAll('.nav-file-title')].find(e => e.dataset.path === path);
  if (!t) return;
  t.classList.add('is-active');
  let p = t.parentElement;
  while (p && p.id !== 'tree') { if (p.classList && p.classList.contains('is-collapsed')) { p.classList.remove('is-collapsed'); } p = p.parentElement; }
  const f = S.files.get(path); if (f && f.folder) { const segs = f.folder.split('/'); for (let i = 1; i <= segs.length; i++) S.expanded.add(segs.slice(0, i).join('/')); }
  t.scrollIntoView({ block: 'nearest' });
}

/* ---------------- navigation ---------------- */
function go(t, push) {
  if (push !== false) { nav.stack = nav.stack.slice(0, nav.idx + 1); nav.stack.push(t); nav.idx = nav.stack.length - 1; }
  if (S.cleanup) { S.cleanup(); S.cleanup = null; }
  $('#view-actions').innerHTML = ''; content().classList.remove('no-scroll'); content().scrollTop = 0;
  if (t.type === 'graph') showGraph(); else if (t.type === 'note') showNote(t); else if (t.type === 'base') showBase(t); else showFile(t);
  $('#btn-back').disabled = nav.idx <= 0; $('#btn-fwd').disabled = nav.idx >= nav.stack.length - 1;
  markActive();
}
function openPath(path, heading) {
  const f = S.files.get(path); if (!f) return;
  go({ type: f.kind === 'base' ? 'base' : f.kind === 'note' ? 'note' : 'file', path, heading: heading || '' });
}
function setHeader(f, titleText) {
  const crumbs = $('#crumbs'), title = $('#title');
  if (f) { crumbs.textContent = f.folder ? f.folder.split('/').join(' / ') + ' / ' : ''; title.textContent = f.base; } else { crumbs.textContent = ''; title.textContent = titleText || ''; }
}

/* ---------------- value rendering ---------------- */
function inlineHtml(s, from) { return L.renderInline(s, refOpts(from)); }
function renderValue(v, p, from, isTags) {
  if (v == null || v === '') return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => { if (!isTags && i) p.append(', '); renderValue(x, p, from, isTags); if (isTags && i < v.length - 1) p.append(' '); });
    return;
  }
  if (isTags && typeof v === 'string') { const t = v.replace(/^#/, ''); const a = el('a', 'tag', '#' + t); a.href = '#'; a.dataset.tag = t; p.append(a); return; }
  if (v instanceof Date) { p.append(L.fmtDate(v)); return; }
  if (L.isLink(v)) {
    const f = S.files.get(v.path); const a = el('a', 'internal-link' + (f ? '' : ' is-unresolved'), v.display || (f ? f.base : L.basenameOf(v.path)));
    a.href = '#'; a.dataset.href = v.path; p.append(a); return;
  }
  if (L.isDur(v)) { p.append(L.str(v)); return; }
  if (typeof v === 'boolean') { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.disabled = true; cb.checked = v; p.append(cb); return; }
  if (typeof v === 'object') { p.append(JSON.stringify(v)); return; }
  if (typeof v === 'number') { p.append(String(Math.round(v * 100) / 100)); return; }
  const span = el('span'); span.innerHTML = inlineHtml(String(v), from); p.append(span);
}

/* ---------------- notes ---------------- */
function propsPanel(f) {
  const keys = Object.keys(f.fm); if (!keys.length) return null;
  const d = el('details', 'metadata-container'); d.open = true; d.append(el('summary', null, 'Properties'));
  const g = el('div', 'metadata-properties');
  for (const k of keys) {
    g.append(el('div', 'metadata-key', k));
    const v = el('div', 'metadata-value');
    const isTags = /^tags?$/i.test(k);
    const val = f.fm[k];
    if (Array.isArray(val) && !isTags) val.forEach(x => { const pill = el('span', 'pill'); renderValue(x, pill, f.path); v.append(pill); });
    else renderValue(val, v, f.path, isTags);
    g.append(v);
  }
  d.append(g); return d;
}
/* ---------------- math, code highlighting, mermaid (vendored libs, loaded on demand) ---------------- */
const loaded = {};
function loadScript(src) { return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); })); }
function loadCss(href) { if (loaded[href]) return; loaded[href] = true; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
let mermaidN = 0;
function mermaidConfig() {
  const cs = getComputedStyle(document.body), g = n => cs.getPropertyValue(n).trim(), dark = document.body.classList.contains('theme-dark');
  return {
    startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: cs.fontFamily,
    themeVariables: {
      darkMode: dark, background: g('--background-primary'), primaryColor: g('--background-secondary'), primaryTextColor: g('--text-normal'),
      primaryBorderColor: g('--interactive-accent'), lineColor: g('--text-muted'), secondaryColor: g('--color-base-25'), tertiaryColor: g('--background-primary'),
      textColor: g('--text-normal'), noteBkgColor: g('--color-base-25'), noteTextColor: g('--text-normal'), mainBkg: g('--background-secondary'), nodeBorder: g('--interactive-accent'),
      clusterBkg: g('--background-primary'), edgeLabelBackground: g('--background-primary')
    }
  };
}
async function drawMermaid(n) {
  try {
    await loadScript('vendor/mermaid.min.js'); window.mermaid.initialize(mermaidConfig());
    const { svg } = await window.mermaid.render('mmd' + (++mermaidN), n.dataset.src);
    n.innerHTML = svg; n.classList.remove('has-error');
  } catch (e) { n.classList.add('has-error'); n.innerHTML = ''; n.append(el('pre', null, 'Mermaid error: ' + (e.message || e) + '\n\n' + n.dataset.src)); }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* */ } ta.remove(); return ok;
  }
}
function addCopyButtons(root) {
  root.querySelectorAll('pre > code').forEach(code => {
    const pre = code.parentElement; if (pre.parentElement.classList.contains('code-block')) return;
    const wrap = el('div', 'code-block'); pre.replaceWith(wrap); wrap.append(pre);
    const b = el('button', 'copy-btn', 'Copy'); b.type = 'button'; b.title = 'Copy code';
    b.onclick = async () => { const ok = await copyText(code.textContent); b.textContent = ok ? 'Copied' : 'Failed'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
    wrap.append(b);
  });
}
function enhance(root) {
  addCopyButtons(root);
  const maths = root.querySelectorAll('[data-tex]');
  if (maths.length) {
    loadCss('vendor/katex.min.css');
    loadScript('vendor/katex.min.js').then(() => maths.forEach(m => {
      try { window.katex.render(m.dataset.tex, m, { displayMode: m.classList.contains('math-block') || m.dataset.display === '1', throwOnError: false }); } catch (e) { /* leave source */ }
    })).catch(() => {});
  }
  const codes = [...root.querySelectorAll('pre > code[class*="language-"]')].filter(c => !c.dataset.hl);
  if (codes.length) loadScript('vendor/highlight.min.js').then(() => codes.forEach(c => {
    const lang = (c.className.match(/language-([\w+-]+)/) || [])[1];
    if (!lang || !window.hljs.getLanguage(lang)) return;
    c.dataset.hl = '1'; window.hljs.highlightElement(c); c.classList.add('hljs');
  })).catch(() => {});
  root.querySelectorAll('.mermaid-block').forEach(drawMermaid);
}
const redrawMermaid = () => Promise.all([...document.querySelectorAll('.mermaid-block')].map(drawMermaid));
let redrawP = Promise.resolve();
window.addEventListener('vv-theme', () => { redrawP = redrawMermaid(); });

/* ---------------- diagram / image overlay (zoom + drag) ---------------- */
function openViewer(node) {
  let w, h, c;
  if (node.tagName.toLowerCase() === 'svg') {
    const vb = node.viewBox && node.viewBox.baseVal, r = node.getBoundingClientRect();
    w = vb && vb.width ? vb.width : r.width; h = vb && vb.height ? vb.height : r.height;
    c = node.cloneNode(true); c.removeAttribute('height'); c.style.maxWidth = 'none'; c.style.width = w + 'px'; c.style.height = h + 'px'; c.setAttribute('width', w); c.setAttribute('height', h);
  } else { w = node.naturalWidth || node.width || 400; h = node.naturalHeight || node.height || 300; c = node.cloneNode(true); c.removeAttribute('width'); c.removeAttribute('height'); c.style.cssText = `width:${w}px;height:${h}px;max-width:none`; }
  const ov = el('div', 'diagram-overlay'), stage = el('div', 'diagram-stage'), holder = el('div', 'diagram-holder');
  holder.append(c); stage.append(holder);
  const bar = el('div', 'diagram-toolbar'), label = el('span', 'diagram-zoom');
  const mk = (t, title, fn) => { const b = el('button', null, t); b.title = title; b.onclick = fn; return b; };
  let k = 1, x = 0, y = 0;
  const apply = () => { holder.style.transform = `translate(${x}px,${y}px)`; c.style.width = (w * k) + 'px'; c.style.height = (h * k) + 'px'; label.textContent = Math.round(k * 100) + '%'; };
  const zoomAt = (f, px, py) => { const nk = Math.max(0.05, Math.min(30, k * f)); x = px - (px - x) * (nk / k); y = py - (py - y) * (nk / k); k = nk; apply(); };
  const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  const fit = () => { const r = stage.getBoundingClientRect(); k = Math.min(4, 0.92 * Math.min(r.width / w, r.height / h)); x = (r.width - w * k) / 2; y = (r.height - h * k) / 2; apply(); };
  const actual = () => { const r = stage.getBoundingClientRect(); k = 1; x = (r.width - w) / 2; y = (r.height - h) / 2; apply(); };
  const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
    else if (e.key === '-') zoomAt(0.8, ...center());
    else if (e.key === '0') fit();
  }
  bar.append(mk('+', 'Zoom in', () => zoomAt(1.25, ...center())), mk('\u2212', 'Zoom out', () => zoomAt(0.8, ...center())), mk('Fit', 'Fit to screen', fit), mk('100%', 'Actual size', actual), label, mk('\u2715', 'Close (Esc)', close));
  ov.append(stage, bar); document.body.append(ov); document.addEventListener('keydown', onKey, true);
  stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y }; stage.classList.add('dragging'); });
  stage.addEventListener('pointermove', e => { if (!drag) return; x = drag.ox + e.clientX - drag.sx; y = drag.oy + e.clientY - drag.sy; apply(); });
  const end = () => { drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('dblclick', fit);
  fit();
}

/* ---------------- printing ---------------- */
let printRestore = null;
function toPrintTheme() {
  if (printRestore || !document.body.classList.contains('theme-dark')) return false;
  printRestore = 'dark'; document.body.className = 'theme-light'; window.dispatchEvent(new Event('vv-theme')); return true;
}
async function printPage() {
  if (toPrintTheme()) { await redrawP; await new Promise(r => setTimeout(r, 150)); }
  window.print();
}
window.addEventListener('beforeprint', toPrintTheme);
window.addEventListener('afterprint', () => { if (printRestore) { printRestore = null; document.body.className = 'theme-dark'; window.dispatchEvent(new Event('vv-theme')); } });

function fillMarkdown(container, md, from, depth) {
  container.innerHTML = L.renderMarkdown(md, refOpts(from));
  postProcess(container, from, depth);
}
function postProcess(root, from, depth) {
  enhance(root);
  root.querySelectorAll('[data-src]:not(.mermaid-block)').forEach(n => { const f = S.files.get(n.dataset.src); if (f) n.src = urlFor(f); });
  root.querySelectorAll('span.embed-note').forEach(n => embedNote(n, from, depth));
  root.querySelectorAll('span.embed-base').forEach(n => { const box = el('div'); n.append(box); mountBase(box, n.dataset.path, null); });
}
function embedNote(n, from, depth) {
  const f = S.files.get(n.dataset.path); if (!f) return;
  if (depth >= 3 || f.path === from) { n.append(el('em', null, 'Cannot embed ' + f.base + ' here')); return; }
  const box = el('div', 'markdown-embed'); const h = n.dataset.heading;
  const a = el('a', 'internal-link markdown-embed-title', f.base + (h ? ' > ' + h : '')); a.href = '#'; a.dataset.href = f.path; a.dataset.heading = h || '';
  const inner = el('div', 'markdown-rendered');
  fillMarkdown(inner, h ? L.sectionOf(f.body, h) : f.body, f.path, depth + 1);
  box.append(a, inner); n.append(box);
}
function showNote(t) {
  const f = S.files.get(t.path); S.lastNote = f.path; setHeader(f);
  const c = content(); c.innerHTML = '';
  const wrap = el('div', 'markdown-preview-view'), sizer = el('div', 'markdown-preview-sizer');
  sizer.append(el('div', 'inline-title', f.base));
  const pp = propsPanel(f); if (pp) sizer.append(pp);
  const body = el('div', 'markdown-rendered'); fillMarkdown(body, f.body, f.path, 0); sizer.append(body);
  const bl = [...(S.backlinks.get(f.path) || [])].map(p => S.files.get(p)).filter(x => x && visible(x)).sort((a, b) => naturalCmp(a.base, b.base));
  if (bl.length) {
    const d = el('details', 'backlinks'); d.append(el('summary', null, `Backlinks (${bl.length})`));
    const ul = el('ul'); bl.forEach(x => { const li = el('li'); const a = el('a', 'internal-link', x.base); a.href = '#'; a.dataset.href = x.path; li.append(a); ul.append(li); });
    d.append(ul); sizer.append(d);
  }
  wrap.append(sizer); c.append(wrap);
  if (t.heading) {
    const want = t.heading.toLowerCase();
    const h = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(x => (x.dataset.heading || '').toLowerCase() === want);
    if (h) h.scrollIntoView();
  }
}
function showFile(t) {
  const f = S.files.get(t.path); setHeader(f); S.lastNote = S.lastNote;
  const c = content(); c.innerHTML = ''; const w = el('div', 'file-view');
  const u = urlFor(f);
  if (f.kind === 'image') { const i = el('img'); i.src = u; i.alt = f.name; w.append(i); }
  else if (f.kind === 'pdf') { const i = el('iframe'); i.src = u; w.append(i); }
  else if (f.kind === 'audio') { const a = el('audio'); a.controls = true; a.src = u; w.append(a); }
  else if (f.kind === 'video') { const a = el('video'); a.controls = true; a.src = u; a.style.maxWidth = '100%'; w.append(a); }
  else { const m = el('div', 'msg', 'This file type cannot be previewed. '); const a = el('a', null, 'Download'); a.href = u; a.download = f.name; m.append(a); w.append(m); }
  c.append(w);
}

/* ---------------- bases ---------------- */
function fileObj(f) {
  if (f._obj) return f._obj;
  return (f._obj = {
    name: f.name, basename: f.base, path: f.path, folder: f.folder, ext: f.ext, size: f.size, ctime: f.mtime, mtime: f.mtime,
    tags: f.tags || [], links: (f.links || []).map(p => L.mkLink(p)),
    backlinks: [...(S.backlinks.get(f.path) || [])].map(p => L.mkLink(p)), embeds: [], link: L.mkLink(f.path)
  });
}
function normSort(s) { return (Array.isArray(s) ? s : s ? [s] : []).filter(x => x && x.property).map(x => ({ property: x.property, dir: String(x.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1 })); }

function baseRows(doc, view) {
  let rows = [];
  for (const f of S.files.values()) {
    if (f.kind === 'base' || !visible(f)) continue;
    const ctx = L.makeCtx({ file: fileObj(f), props: f.fm || {} }, doc); ctx.entry = f;
    if (L.evalFilter(doc.filters, ctx) && L.evalFilter(view.filters, ctx)) rows.push(ctx);
  }
  rows.sort((a, b) => naturalCmp(a.file.path, b.file.path));
  const sorts = normSort(view.sort);
  if (sorts.length) {
    rows.forEach(r => { r.keys = sorts.map(s => L.getValue(s.property, r)); });
    rows.sort((a, b) => {
      for (let i = 0; i < sorts.length; i++) {
        const x = a.keys[i], y = b.keys[i];
        if (x == null && y == null) continue; if (x == null) return 1; if (y == null) return -1;
        const c = L.cmp(x, y); if (c) return c * sorts[i].dir;
      }
      return 0;
    });
  }
  if (view.limit > 0) rows = rows.slice(0, view.limit);
  let groups = null;
  const gb = view.groupBy && (typeof view.groupBy === 'string' ? { property: view.groupBy } : view.groupBy);
  if (gb && gb.property) {
    const m = new Map();
    rows.forEach(r => { const v = L.getValue(gb.property, r); const k = v == null || v === '' ? '\u0000' : L.str(v); if (!m.has(k)) m.set(k, { value: v, key: k, rows: [] }); m.get(k).rows.push(r); });
    const dir = String(gb.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
    groups = [...m.values()].sort((a, b) => (a.value == null ? 1 : b.value == null ? -1 : L.cmp(a.value, b.value) * dir));
    groups.forEach(g => { g.label = g.value == null || g.value === '' ? 'None' : L.str(g.value); });
  }
  return { rows, groups };
}

function renderCell(td, id, ctx) {
  if (id === 'file.name' || id === 'file.basename' || id === 'file.link') {
    const f = ctx.entry; const a = el('a', 'internal-link', f.kind === 'note' || id !== 'file.name' ? f.base : f.name); a.href = '#'; a.dataset.href = f.path; td.append(a); return;
  }
  const v = L.getValue(id, ctx);
  renderValue(v, td, ctx.file.path, /(^|\.)tags?$/i.test(id));
}

function buildCard(ctx, view, doc, order) {
  const card = el('div', 'bases-card');
  const imgProp = view.image || view.cover || view.imageProperty;
  if (imgProp) {
    const iv = L.getValue(imgProp, ctx); let src = null;
    const iStr = L.isLink(iv) ? iv.path : typeof iv === 'string' ? iv.replace(/^!?\[\[|\]\]$/g, '').split('|')[0] : null;
    if (iStr) { const r = resolveRef(iStr, ctx.file.path); if (r && r.kind === 'image') src = urlFor(S.files.get(r.path)); }
    if (src) {
      const box = el('div', 'bases-card-img'); const im = el('img'); im.src = src;
      if (String(view.imageFit || '').toLowerCase() === 'contain') im.style.objectFit = 'contain';
      if (view.imageAspectRatio) box.style.aspectRatio = String(view.imageAspectRatio);
      box.append(im); card.append(box);
    }
  }
  const body = el('div', 'bases-card-body'); const title = el('div', 'bases-card-title');
  renderCell(title, order.includes('file.basename') && !order.includes('file.name') ? 'file.basename' : 'file.name', ctx); body.append(title);
  for (const id of order) {
    if (id === 'file.name' || id === 'file.basename') continue;
    const v = L.getValue(id, ctx); if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const row = el('div', 'bases-card-prop'); row.append(el('span', 'k', L.propLabel(id, doc))); const vs = el('span', 'v'); renderCell(vs, id, ctx); row.append(vs); body.append(row);
  }
  card.append(body); return card;
}

function kanbanProp(view, order) {
  const gb = view.groupBy && (typeof view.groupBy === 'string' ? view.groupBy : view.groupBy.property);
  const cand = [gb, view.columnProperty, view.column, view.groupProperty, view.boardProperty, view.statusProperty, view.property, view.groupByProperty];
  for (const c of cand) if (c && typeof c === 'string') return c;
  return order.find(id => !/^file\.(name|basename|link)$/.test(id)) || null;
}
function buildKanban(rows, view, doc, order) {
  const prop = kanbanProp(view, order);
  const board = el('div', 'kanban-board');
  if (!prop) { board.append(el('div', 'bases-empty', 'This kanban view has no column property.')); return board; }
  const val = o => (o && typeof o === 'object' && !Array.isArray(o)) ? (o.value != null ? o.value : o.name != null ? o.name : o.id != null ? o.id : o.title) : o;
  let cfg = null;
  for (const k of ['columnOrder', 'columns', 'groupOrder', 'columnValues', 'lanes', 'columnsOrder']) { if (Array.isArray(view[k])) { cfg = view[k]; break; } if (view[k] && Array.isArray(view[k].order)) { cfg = view[k].order; break; } }
  const cols = new Map();
  const keyOf = v => (v == null || v === '' || (Array.isArray(v) && !v.length)) ? '\u0000' : L.str(v);
  (cfg || []).map(val).filter(v => v != null).forEach(v => { const k = L.str(v); if (!cols.has(k)) cols.set(k, { label: k, value: v, rows: [] }); });
  rows.forEach(r => {
    const v = L.getValue(prop, r), vals = Array.isArray(v) && v.length ? v : [v];
    vals.forEach(x => { const k = keyOf(x); if (!cols.has(k)) cols.set(k, { label: k === '\u0000' ? 'No ' + L.propLabel(prop, doc).toLowerCase() : k, value: x, rows: [], extra: true }); cols.get(k).rows.push(r); });
  });
  let list = [...cols.values()];
  const none = list.filter(c => c.label.startsWith('No ') && c.extra && c.value == null);
  let rest = list.filter(c => !none.includes(c));
  if (!cfg) { const dir = view.groupBy && String(view.groupBy.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1; rest.sort((a, b) => L.cmp(a.value, b.value) * dir); }
  else { const fixed = rest.filter(c => !c.extra), extra = rest.filter(c => c.extra).sort((a, b) => L.cmp(a.value, b.value)); rest = fixed.concat(extra); }
  list = none.concat(rest);
  for (const c of list) {
    const col = el('div', 'kanban-column'), head = el('div', 'kanban-column-header');
    head.append(el('span', 'kanban-column-title', c.label), el('span', 'group-count', String(c.rows.length)));
    const body = el('div', 'kanban-column-body');
    c.rows.forEach(ctx => body.append(buildCard(ctx, view, doc, order.filter(id => id !== prop))));
    col.append(head, body); board.append(col);
  }
  return board;
}

function renderBaseView(out, doc, view) {
  out.innerHTML = '';
  let data;
  try { data = baseRows(doc, view); } catch (e) { out.append(el('div', 'bases-empty', 'Could not evaluate this view: ' + e.message)); return; }
  const type = String(view.type || 'table').toLowerCase();
  const order = (Array.isArray(view.order) && view.order.length ? view.order : ['file.name']).map(String);
  out.append(el('div', 'bases-toolbar', `${data.rows.length} result${data.rows.length === 1 ? '' : 's'}`));
  if (!data.rows.length) { out.append(el('div', 'bases-empty', 'No results')); return; }
  const known = ['table', 'cards', 'list', 'kanban', 'board'];
  if (!known.includes(type)) out.append(el('div', 'bases-note', `"${type}" views are not supported in this viewer; showing a table instead.`));
  const sections = data.groups || [{ label: null, rows: data.rows }];

  if (type === 'cards') {
    const w = view.cardSize || view.cardWidth; const wrap = el('div'); if (w) wrap.style.setProperty('--card-w', Number(w) + 'px');
    for (const g of sections) {
      if (g.label != null) wrap.append(el('div', 'bases-group-title', `${g.label} (${g.rows.length})`));
      const grid = el('div', 'bases-cards');
      g.rows.forEach(ctx => grid.append(buildCard(ctx, view, doc, order)));
      wrap.append(grid);
    }
    out.append(wrap); return;
  }
  if (type === 'kanban' || type === 'board') { out.append(buildKanban(data.rows, view, doc, order)); return; }
  if (type === 'list') {
    for (const g of sections) {
      if (g.label != null) out.append(el('div', 'bases-group-title', `${g.label} (${g.rows.length})`));
      const ul = el('ul', 'bases-list');
      for (const ctx of g.rows) {
        const li = el('li'); renderCell(li, order[0] === 'file.name' || order[0] === 'file.basename' ? order[0] : 'file.name', ctx);
        const rest = order.filter(id => id !== 'file.name' && id !== 'file.basename');
        const metaVals = rest.map(id => L.getValue(id, ctx)).filter(v => v != null && v !== '');
        if (metaVals.length) { const m = el('span', 'meta'); rest.forEach(id => { const v = L.getValue(id, ctx); if (v == null || v === '') return; if (m.childNodes.length) m.append(' · '); renderCell(m, id, ctx); }); li.append(m); }
        ul.append(li);
      }
      out.append(ul);
    }
    return;
  }
  const wrap = el('div', 'bases-table-wrap'), table = el('table', 'bases-table'), thead = el('thead'), hr = el('tr');
  order.forEach(id => hr.append(el('th', null, L.propLabel(id, doc)))); thead.append(hr); table.append(thead);
  const tb = el('tbody');
  for (const g of sections) {
    if (g.label != null) { const tr = el('tr', 'group-row'), td = el('td'); td.colSpan = order.length; td.append(g.label); td.append(el('span', 'group-count', String(g.rows.length))); tr.append(td); tb.append(tr); }
    for (const ctx of g.rows) { const tr = el('tr'); order.forEach(id => { const td = el('td'); renderCell(td, id, ctx); tr.append(td); }); tb.append(tr); }
  }
  table.append(tb); wrap.append(table); out.append(wrap);
}

async function mountBase(container, path, slot) {
  const f = S.files.get(path); if (!f) { container.textContent = 'Base not found'; return; }
  let doc;
  try { doc = L.parseYaml(await f.file.text()) || {}; } catch (e) { container.textContent = 'Could not parse base: ' + e.message; return; }
  if (typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  const views = Array.isArray(doc.views) && doc.views.length ? doc.views : [{ type: 'table', name: 'Table' }];
  const sel = el('select', 'dropdown'); sel.title = 'Select view';
  views.forEach((v, i) => { const o = document.createElement('option'); o.value = i; o.textContent = v.name || ((v.type || 'table')[0].toUpperCase() + String(v.type || 'table').slice(1)); sel.append(o); });
  sel.value = String(Math.min(S.viewSel[path] || 0, views.length - 1));
  const out = el('div');
  const draw = () => { S.viewSel[path] = +sel.value; renderBaseView(out, doc, views[+sel.value] || views[0]); };
  sel.onchange = draw;
  if (slot) slot.append(sel); else { const bar = el('div', 'bases-toolbar'); bar.append(sel); container.append(bar); }
  container.append(out);
  draw();
}
function showBase(t) {
  const f = S.files.get(t.path); setHeader(f);
  const c = content(); c.innerHTML = '';
  const pad = el('div', 'bases-pad'); c.append(pad);
  mountBase(pad, t.path, $('#view-actions'));
}

/* ---------------- graph ---------------- */
function showGraph() {
  setHeader(null, 'Graph view');
  const c = content(); c.innerHTML = ''; c.classList.add('no-scroll');
  if (!S.files.size) { c.append(welcome()); c.classList.remove('no-scroll'); return; }
  const wrap = el('div', 'graph-view'), canvas = el('canvas');
  const panel = el('div', 'graph-controls');
  panel.innerHTML = '<input type="search" id="g-filter" placeholder="Filter notes…">' +
    '<label><input type="checkbox" id="g-orph" checked> Orphans</label>' +
    '<label><input type="checkbox" id="g-unres"> Unresolved links</label>' +
    '<label><input type="checkbox" id="g-local"> Local graph (current note)</label>' +
    '<label>Depth <input type="range" id="g-depth" min="1" max="4" value="1"></label><div class="graph-stats" id="g-stats"></div>';
  wrap.append(canvas, panel); c.append(wrap);
  const g = forceGraph(canvas, node => { if (!node.ghost) openPath(node.id); });
  const local = $('#g-local', panel); if (!S.lastNote) local.disabled = true;
  const rebuild = () => {
    g.setData(buildGraphData({
      filter: $('#g-filter', panel).value.trim().toLowerCase(), orphans: $('#g-orph', panel).checked, unresolved: $('#g-unres', panel).checked,
      local: local.checked ? S.lastNote : null, depth: +$('#g-depth', panel).value
    }), local.checked ? S.lastNote : null);
    $('#g-stats', panel).textContent = g.stats();
  };
  panel.addEventListener('input', rebuild); panel.addEventListener('change', rebuild);
  setTimeout(rebuild, 0);
  S.cleanup = () => g.destroy();
}
function buildGraphData(o) {
  const notes = [...S.files.values()].filter(f => f.kind === 'note' && !f.hidden);
  const idx = new Map(), nodes = [], edges = [];
  const add = (id, label, ghost) => { if (!idx.has(id)) { idx.set(id, nodes.length); nodes.push({ id, label, ghost, deg: 0 }); } return idx.get(id); };
  notes.forEach(n => add(n.path, n.base, false));
  const seen = new Set();
  notes.forEach(n => {
    (n.links || []).forEach(p => {
      const t = S.files.get(p); if (!t || t.kind !== 'note' || t.hidden || p === n.path) return;
      const k = n.path < p ? n.path + '\0' + p : p + '\0' + n.path; if (seen.has(k)) return; seen.add(k);
      edges.push([idx.get(n.path), idx.get(p)]);
    });
    if (o.unresolved) (n.unresolved || []).forEach(u => edges.push([idx.get(n.path), add('?' + u.toLowerCase(), u, true)]));
  });
  edges.forEach(e => { nodes[e[0]].deg++; nodes[e[1]].deg++; });
  let keep = nodes.map(() => true);
  if (o.local && idx.has(o.local)) {
    const adj = nodes.map(() => []); edges.forEach(e => { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    keep = nodes.map(() => false); let frontier = [idx.get(o.local)]; keep[frontier[0]] = true;
    for (let d = 0; d < o.depth; d++) { const nx = []; frontier.forEach(i => adj[i].forEach(j => { if (!keep[j]) { keep[j] = true; nx.push(j); } })); frontier = nx; }
  }
  if (o.filter) keep = keep.map((k, i) => k && nodes[i].label.toLowerCase().includes(o.filter));
  if (!o.orphans) keep = keep.map((k, i) => k && nodes[i].deg > 0);
  const remap = new Map(), outNodes = [];
  nodes.forEach((n, i) => { if (keep[i]) { remap.set(i, outNodes.length); outNodes.push({ id: n.id, label: n.label, ghost: n.ghost, deg: 0 }); } });
  const outEdges = [];
  edges.forEach(e => { if (remap.has(e[0]) && remap.has(e[1])) { outEdges.push([remap.get(e[0]), remap.get(e[1])]); outNodes[remap.get(e[0])].deg++; outNodes[remap.get(e[1])].deg++; } });
  return { nodes: outNodes, edges: outEdges };
}

function forceGraph(canvas, onClick) {
  const cx = canvas.getContext('2d');
  let lastError = '', needFit = false, nodes = [], edges = [], adj = [], alpha = 0, raf = 0, hover = -1, drag = null, W = 0, H = 0, dpr = 1, focusId = null;
  const view = { x: 0, y: 0, k: 1 }; const pos = new Map(); let colors = null, destroyed = false;
  const readColors = () => { const cs = getComputedStyle(document.body), g = n => cs.getPropertyValue(n).trim(); colors = { node: g('--text-muted') || '#999', accent: g('--interactive-accent') || '#e90', line: g('--color-base-40') || '#666', text: g('--text-normal') || '#ddd', ghost: g('--text-faint') || '#777', bg: g('--background-primary') || '#222' }; };
  const onTheme = () => { colors = null; draw(); }; window.addEventListener('vv-theme', onTheme);

  function measure() {
    dpr = window.devicePixelRatio || 1; const r = canvas.getBoundingClientRect();
    const cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
    if (r.width !== W || r.height !== H || canvas.width !== cw || canvas.height !== ch) { W = r.width; H = r.height; canvas.width = cw; canvas.height = ch; }
  }
  function resize() { measure(); if (needFit && W > 0 && H > 0) { needFit = false; fit(); } draw(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  function setData(d, focus) {
    nodes.forEach(n => pos.set(n.id, { x: n.x, y: n.y }));
    nodes = d.nodes; edges = d.edges; focusId = focus; adj = nodes.map(() => []);
    edges.forEach(e => { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    const R = Math.sqrt(nodes.length) * 14 + 20;
    nodes.forEach(n => {
      const p = pos.get(n.id);
      if (p && isFinite(p.x)) { n.x = p.x; n.y = p.y; } else { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * R; n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; }
      n.vx = n.vy = 0; n.r = 3 + Math.min(Math.sqrt(n.deg) * 1.8, 7); n.fixed = false;
    });
    alpha = 1; const t0 = performance.now();
    for (let i = 0; i < 160 && performance.now() - t0 < 450; i++) tick();
    nodes.forEach(n => { if (!isFinite(n.x) || !isFinite(n.y)) { n.x = (Math.random() - .5) * 200; n.y = (Math.random() - .5) * 200; } });
    measure(); if (W > 0 && H > 0) fit(); else needFit = true;
    hover = -1; start();
  }
  function fit() {
    if (!nodes.length || !(W > 0) || !(H > 0)) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
    const bw = Math.max(x1 - x0, 60), bh = Math.max(y1 - y0, 60);
    view.k = Math.min(2, 0.88 * Math.min(W / bw, H / bh)); view.x = W / 2 - ((x0 + x1) / 2) * view.k; view.y = H / 2 - ((y0 + y1) / 2) * view.k;
  }
  function tick() {
    const n = nodes.length, a = alpha;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j]; let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > 160000) continue;
        if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = dx * dx + dy * dy + .01; }
        const f = 38 * a / (d2 + 25); p.vx -= dx * f; p.vy -= dy * f; q.vx += dx * f; q.vy += dy * f;
      }
    }
    for (const e of edges) {
      const p = nodes[e[0]], q = nodes[e[1]]; let dx = q.x - p.x, dy = q.y - p.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const s = (d - 34) / d * 0.5 * a / Math.min(adj[e[0]].length, adj[e[1]].length);
      dx *= s; dy *= s; p.vx += dx; p.vy += dy; q.vx -= dx; q.vy -= dy;
    }
    for (const p of nodes) {
      p.vx -= p.x * 0.05 * a; p.vy -= p.y * 0.05 * a; p.vx *= 0.6; p.vy *= 0.6;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 20) { p.vx *= 20 / sp; p.vy *= 20 / sp; }
      if (!isFinite(sp)) { p.vx = p.vy = 0; p.x = (Math.random() - .5) * 100; p.y = (Math.random() - .5) * 100; }
      if (!p.fixed) { p.x += p.vx; p.y += p.vy; }
    }
    alpha *= 0.982;
  }
  function loop() { raf = 0; if (destroyed) return; if (alpha > 0.01) { tick(); draw(); raf = requestAnimationFrame(loop); } else draw(); }
  function start() { if (!raf && !destroyed) raf = requestAnimationFrame(loop); }

  function draw() {
    if (destroyed) return;
    try { measure(); if (!(W > 0 && H > 0)) return; if (needFit) { needFit = false; fit(); } drawInner(); lastError = ''; }
    catch (e) { lastError = String(e && e.message || e); const s = document.getElementById('g-stats'); if (s) s.textContent = 'Graph error: ' + lastError; }
  }
  function drawInner() {
    if (!colors) readColors();
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    cx.translate(view.x, view.y); cx.scale(view.k, view.k);
    const near = new Set(); if (hover >= 0) { near.add(hover); adj[hover].forEach(j => near.add(j)); }
    cx.lineWidth = 1 / view.k;
    for (const e of edges) {
      const hl = hover >= 0 && (e[0] === hover || e[1] === hover);
      cx.globalAlpha = hover >= 0 ? (hl ? 1 : 0.07) : 0.55; cx.strokeStyle = hl ? colors.accent : colors.line;
      cx.beginPath(); cx.moveTo(nodes[e[0]].x, nodes[e[0]].y); cx.lineTo(nodes[e[1]].x, nodes[e[1]].y); cx.stroke();
    }
    nodes.forEach((n, i) => {
      cx.globalAlpha = hover >= 0 && !near.has(i) ? 0.18 : 1;
      cx.fillStyle = i === hover || n.id === focusId ? colors.accent : n.ghost ? colors.ghost : colors.node;
      cx.beginPath(); cx.arc(n.x, n.y, n.r, 0, 6.2832); cx.fill();
    });
    const la = Math.max(0, Math.min(1, (view.k - 0.55) / 0.5));
    cx.font = `${12 / view.k}px ${getComputedStyle(document.body).fontFamily}`; cx.textAlign = 'center'; cx.textBaseline = 'top'; cx.fillStyle = colors.text;
    nodes.forEach((n, i) => {
      const show = i === hover || (hover >= 0 && near.has(i)) || (hover < 0 && (la > 0 || n.id === focusId));
      if (!show) return;
      cx.globalAlpha = i === hover || n.id === focusId ? 1 : hover >= 0 ? 0.9 : la;
      cx.fillText(n.label, n.x, n.y + n.r + 2 / view.k);
    });
    cx.globalAlpha = 1;
  }

  const world = (ev) => { const r = canvas.getBoundingClientRect(); return { sx: ev.clientX - r.left, sy: ev.clientY - r.top, x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k }; };
  function hit(w) { let best = -1, bd = 1e9; nodes.forEach((n, i) => { const d = Math.hypot(n.x - w.x, n.y - w.y); if (d <= n.r + 4 / view.k && d < bd) { bd = d; best = i; } }); return best; }
  canvas.addEventListener('pointerdown', ev => {
    const w = world(ev), i = hit(w); canvas.setPointerCapture(ev.pointerId);
    drag = { i, sx: w.sx, sy: w.sy, ox: view.x, oy: view.y, moved: false };
    if (i >= 0) nodes[i].fixed = true; canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', ev => {
    const w = world(ev);
    if (drag) {
      if (Math.hypot(w.sx - drag.sx, w.sy - drag.sy) > 4) drag.moved = true;
      if (drag.moved) {
        if (drag.i >= 0) { nodes[drag.i].x = w.x; nodes[drag.i].y = w.y; alpha = Math.max(alpha, 0.35); start(); }
        else { view.x = drag.ox + (w.sx - drag.sx); view.y = drag.oy + (w.sy - drag.sy); }
        draw();
      }
    } else { const h = hit(w); if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? 'pointer' : 'grab'; draw(); } }
  });
  canvas.addEventListener('pointerup', ev => {
    if (!drag) return; const d = drag; drag = null; canvas.style.cursor = 'grab';
    if (d.i >= 0) { nodes[d.i].fixed = false; if (!d.moved) onClick(nodes[d.i]); }
  });
  canvas.addEventListener('pointerleave', () => { if (!drag && hover >= 0) { hover = -1; draw(); } });
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault(); const w = world(ev), f = Math.exp(-ev.deltaY * 0.0015), nk = Math.max(0.08, Math.min(8, view.k * f));
    view.x = w.sx - w.x * nk; view.y = w.sy - w.y * nk; view.k = nk; draw();
  }, { passive: false });

  return {
    setData, stats: () => `${nodes.length} notes · ${edges.length} links`,
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('vv-theme', onTheme); }
  };
}

/* ---------------- welcome + wiring ---------------- */
function welcome() {
  const w = el('div', 'welcome');
  w.innerHTML = '<h1>Vault Viewer</h1><p>A read-only viewer for Obsidian vaults. Pick your vault folder and browse notes, Bases and the link graph.</p>' +
    '<button class="btn-cta" id="cta">Open vault folder</button><small>Everything stays in your browser – no files are uploaded anywhere.</small>';
  w.querySelector('#cta').onclick = pickVault;
  return w;
}
function setTheme(t) {
  document.body.className = 'theme-' + t; ls.set('vv-theme', t);
  $('#btn-theme').innerHTML = svg(t === 'dark' ? 'sun' : 'moon'); window.dispatchEvent(new Event('vv-theme'));
}

function init() {
  $('#btn-open').innerHTML = svg('folder'); $('#btn-graph').innerHTML = svg('graph'); $('#btn-sidebar').innerHTML = svg('panel');
  $('#btn-back').innerHTML = svg('left'); $('#btn-fwd').innerHTML = svg('right');
  $('#btn-theme').innerHTML = svg(document.body.classList.contains('theme-dark') ? 'sun' : 'moon');
  $('#btn-back').disabled = $('#btn-fwd').disabled = true;
  $('#btn-print').innerHTML = svg('print'); $('#btn-print').onclick = printPage;
  $('#btn-open').onclick = pickVault;
  $('#btn-graph').onclick = () => { if (S.files.size) go({ type: 'graph' }); else pickVault(); };
  $('#btn-theme').onclick = () => setTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
  $('#btn-sidebar').onclick = () => $('#app').classList.toggle('sidebar-hidden');
  $('#btn-back').onclick = () => { if (nav.idx > 0) { nav.idx--; go(nav.stack[nav.idx], false); } };
  $('#btn-fwd').onclick = () => { if (nav.idx < nav.stack.length - 1) { nav.idx++; go(nav.stack[nav.idx], false); } };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printPage(); return; } if (e.altKey && e.key === 'ArrowLeft') $('#btn-back').click(); if (e.altKey && e.key === 'ArrowRight') $('#btn-fwd').click(); });
  $('#search').addEventListener('input', e => { S.query = e.target.value; renderSidebar(); });
  $('#opt-templates').onchange = e => { S.opts.templates = e.target.checked; renderSidebar(); };
  $('#opt-attach').onchange = e => { S.opts.attachments = e.target.checked; renderSidebar(); };
  $('#picker').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    const root = files[0].webkitRelativePath.split('/')[0];
    await loadVault(files.map(f => ({ path: f.webkitRelativePath.slice(root.length + 1), file: f })), root);
  };
  // delegated clicks inside the content area
  content().addEventListener('click', e => {
    const a = e.target.closest('a'); const ct = e.target.closest('.callout-title');
    if (!a) {
      const mb = e.target.closest('.mermaid-block:not(.has-error)'); const sv = mb && mb.querySelector('svg');
      if (sv) { openViewer(sv); return; }
      const im = e.target.closest('img.vault-img, img.external-image'); if (im) { openViewer(im); return; }
    }
    if (a && a.classList.contains('internal-link')) {
      e.preventDefault(); const p = a.dataset.href;
      if (S.files.has(p)) openPath(p, a.dataset.heading); return;
    }
    if (a && a.classList.contains('tag')) { e.preventDefault(); $('#search').value = '#' + a.dataset.tag; S.query = '#' + a.dataset.tag; renderSidebar(); $('#app').classList.remove('sidebar-hidden'); return; }
    if (a && a.getAttribute('href') === '#') { e.preventDefault(); return; }
    if (ct && ct.parentElement.classList.contains('is-collapsible')) ct.parentElement.classList.toggle('is-collapsed');
  });
  // drag to resize sidebar
  const rz = $('#resizer');
  rz.addEventListener('pointerdown', e => {
    rz.setPointerCapture(e.pointerId);
    const move = ev => { const w = Math.max(180, Math.min(640, ev.clientX - 44)); document.body.style.setProperty('--sidebar-w', w + 'px'); };
    const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); };
    rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
  });
  renderSidebar();
  content().append(welcome());
}

window.VaultViewer = { loadVault };
init();
})();
