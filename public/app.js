const PREDEFINED_TAGS = [
  { id: 'work',      label: 'Work',      group: 'context' },
  { id: 'casual',    label: 'Casual',    group: 'context' },
  { id: 'active',    label: 'Active',    group: 'context' },
  { id: 'lounge',    label: 'Lounge',    group: 'context' },
  { id: 'top',       label: 'Top',       group: 'type' },
  { id: 'bottom',    label: 'Bottom',    group: 'type' },
  { id: 'dress',     label: 'Dress',     group: 'type' },
  { id: 'outerwear', label: 'Outerwear', group: 'type' },
  { id: 'shoes',     label: 'Shoes',     group: 'type' },
  { id: 'accessory', label: 'Accessory', group: 'type' },
];
const CONTEXT_TAGS = new Set(['work','casual','active','lounge']);
const TYPE_TAGS    = new Set(['top','bottom','dress','outerwear','shoes','accessory']);

let items = [];
let editingId = null;
let activeTags = new Set();
let activeScore = 'all';
let gapOpen = true;
let formTags = new Set();

// ── Utilities ────────────────────────────────────────────────────────────────

function sc(s)  { return s >= 8 ? '#3B6D11' : s >= 5 ? '#BA7517' : '#A32D2D'; }
function rowCls(item) {
  if (item.score <= 4) return 'row-flag';
  if (item.score >= 8) return 'row-star';
  if (item.status === 'updated') return 'row-updated';
  if (item.status === 'incoming') return 'row-incoming';
  return '';
}
function sBadge(s) {
  if (s === 'incoming') return '<span class="badge badge-incoming">incoming</span>';
  if (s === 'updated')  return '<span class="badge badge-updated">updated</span>';
  return '';
}
function tagCls(t) {
  if (CONTEXT_TAGS.has(t)) return 'tag-context';
  if (TYPE_TAGS.has(t))    return 'tag-type';
  return 'tag-custom';
}
function tagChipsHtml(tagsStr) {
  return (tagsStr || '').split('|').filter(Boolean)
    .map(t => `<span class="tag-chip ${tagCls(t)}">${h(t)}</span>`)
    .join('');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function h(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function loadItems() {
  try {
    const res = await fetch('/api/wardrobe');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = await res.json();
    render();
  } catch(e) {
    document.getElementById('sections-container').innerHTML =
      `<div class="section"><div class="empty">Failed to load wardrobe: ${e.message}</div></div>`;
  }
}

async function saveItem() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Please enter an item name.'); return; }
  if (!formTags.size) { alert('Please select at least one tag.'); return; }
  const payload = {
    name,
    brand:  document.getElementById('f-brand').value.trim() || '—',
    color:  document.getElementById('f-color').value.trim() || '—',
    hex:    document.getElementById('f-hex').value,
    score:  Math.min(10, Math.max(1, parseInt(document.getElementById('f-score').value) || 5)),
    tags:   [...formTags].join('|'),
    status: document.getElementById('f-status').value,
    notes:  document.getElementById('f-notes').value.trim(),
  };
  try {
    if (editingId) {
      const res = await fetch('/api/wardrobe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      });
      if (!res.ok) { const e = await res.text().then(t => { try { return JSON.parse(t).error || t; } catch { return t; } }); throw new Error(e); }
      const updated = await res.json();
      const idx = items.findIndex(i => i.id === editingId);
      if (idx > -1) items[idx] = updated;
      toast('Item updated');
    } else {
      const res = await fetch('/api/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.text().then(t => { try { return JSON.parse(t).error || t; } catch { return t; } }); throw new Error(e); }
      const created = await res.json();
      items.push(created);
      toast('Item added');
    }
    closeModal();
    render();
  } catch(e) {
    toast('Save failed: ' + e.message);
  }
}

async function deleteItem(id) {
  if (!confirm('Remove this item from your wardrobe?')) return;
  try {
    const res = await fetch(`/api/wardrobe?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.text().then(t => { try { return JSON.parse(t).error || t; } catch { return t; } }); throw new Error(e); }
    items = items.filter(i => i.id !== id);
    render();
    toast('Item removed');
  } catch(e) {
    toast('Delete failed: ' + e.message);
  }
}

// ── Filtering / sorting ───────────────────────────────────────────────────────

function getFiltered() {
  const q    = document.getElementById('search').value.toLowerCase();
  const sort = document.getElementById('sort-by').value;
  let data = items.filter(i => {
    const tagArr = (i.tags || '').split('|');
    if (activeTags.size > 0 && ![...activeTags].every(t => tagArr.includes(t))) return false;
    if (activeScore === 'flag'  && i.score > 4) return false;
    if (activeScore === 'ideal' && i.score < 8) return false;
    if (q && !`${i.name} ${i.brand} ${i.color} ${i.notes} ${i.tags}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if      (sort === 'score-desc') data.sort((a,b) => b.score - a.score);
  else if (sort === 'score-asc')  data.sort((a,b) => a.score - b.score);
  else if (sort === 'name')       data.sort((a,b) => a.name.localeCompare(b.name));
  else                            data.sort((a,b) => a.brand.localeCompare(b.brand));
  return data;
}

function toggleTagFilter(tag) {
  if (activeTags.has(tag)) activeTags.delete(tag);
  else activeTags.add(tag);
  document.querySelectorAll('.filter-tag').forEach(btn =>
    btn.classList.toggle('active', activeTags.has(btn.dataset.tag))
  );
  render();
}

function setScoreFilter(el, val) {
  activeScore = activeScore === val ? 'all' : val;
  document.querySelectorAll('.filter-btn[data-score]').forEach(b => b.classList.remove('active'));
  if (activeScore !== 'all') el.classList.add('active');
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────

function itemRow(item) {
  return `<tr class="item-row ${rowCls(item)}">
    <td>
      <div>${h(item.name)} ${sBadge(item.status)}</div>
      <div class="item-tags">${tagChipsHtml(item.tags)}</div>
    </td>
    <td style="color:var(--text-mid)">${h(item.brand)}</td>
    <td><div class="swatch-cell"><span class="swatch" style="background:${h(item.hex)}"></span><span>${h(item.color)}</span></div></td>
    <td><div class="score-bar"><div class="bar-track"><div class="bar-fill" style="width:${item.score*10}%;background:${sc(item.score)}"></div></div><span class="score-num" style="color:${sc(item.score)}">${item.score}/10</span></div></td>
    <td style="color:var(--text-mid);font-size:.73rem">${h(item.notes)}</td>
    <td><div class="act-wrap"><button class="act-btn" onclick="openEdit(${item.id})">Edit</button><button class="act-btn del" onclick="deleteItem(${item.id})">✕</button></div></td>
  </tr>`;
}

function render() {
  const filtered = getFiltered();
  const sort = document.getElementById('sort-by').value;
  let rows = '';

  if (sort === 'default') {
    const brands = [...new Set(filtered.map(i => i.brand))].sort((a,b) => a.localeCompare(b));
    brands.forEach(brand => {
      rows += `<tr class="grp-row"><td colspan="6">${brand}</td></tr>`;
      filtered.filter(i => i.brand === brand).forEach(item => { rows += itemRow(item); });
    });
  } else {
    filtered.forEach(item => { rows += itemRow(item); });
  }

  if (!rows) rows = `<tr><td colspan="6" class="empty">No items match current filters.</td></tr>`;

  document.getElementById('sections-container').innerHTML = `
    <div class="section">
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th class="col-name">Item</th>
            <th class="col-brand">Brand</th>
            <th class="col-color">Color</th>
            <th class="col-score">Palette fit</th>
            <th class="col-notes">Notes</th>
            <th class="col-act"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="add-row"><button onclick="openAdd()">+ add item</button></div>
    </div>`;

  renderGaps();
  updateMetrics();
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function updateMetrics() {
  const n    = items.length;
  const avg  = n ? (items.reduce((s,i) => s + i.score, 0) / n).toFixed(1) : '—';
  const ideal = items.filter(i => i.score >= 8).length;
  const flag  = items.filter(i => i.score <= 4).length;
  const multi = items.filter(i => {
    const tags = (i.tags || '').split('|');
    return tags.filter(t => CONTEXT_TAGS.has(t)).length >= 2;
  }).length;
  document.getElementById('m-total').textContent = n;
  document.getElementById('m-avg').textContent   = avg;
  document.getElementById('m-ideal').textContent = ideal;
  document.getElementById('m-flag').textContent  = flag;
  document.getElementById('m-cross').textContent = multi;
}

// ── Gap analysis ──────────────────────────────────────────────────────────────

function computeGaps() {
  const contextTags = ['work','casual','active','lounge'];
  const typeTags    = ['top','bottom','dress','outerwear','shoes','accessory'];
  const gaps = [];
  for (const ctx of contextTags) {
    for (const type of typeTags) {
      const pair = items.filter(i => {
        const t = (i.tags || '').split('|');
        return t.includes(ctx) && t.includes(type);
      });
      if (!pair.length) continue;
      const ideal = pair.filter(i => i.score >= 8).length;
      if (ideal === 0) gaps.push({ priority: 'high', text: `No DA-ideal ${ctx} ${type}` });
      else if (ideal === 1) gaps.push({ priority: 'low', text: `Only 1 DA-ideal ${ctx} ${type}` });
    }
  }
  return gaps;
}

function togGaps() {
  gapOpen = !gapOpen;
  document.getElementById('p-gaps').style.display = gapOpen ? 'block' : 'none';
  document.getElementById('cv-gaps').classList.toggle('open', gapOpen);
}

function renderGaps() {
  const gaps = computeGaps();
  document.getElementById('gap-count').textContent = gaps.length ? `${gaps.length} gaps` : 'Looking good';
  const el = document.getElementById('p-gaps');
  if (!gaps.length) {
    el.innerHTML = '<div class="gap-list"><div class="gap-item" style="justify-content:center;color:var(--score-high)">✓ No DA-ideal gaps detected</div></div>';
    return;
  }
  el.innerHTML = '<div class="gap-list">' +
    gaps.map(g =>
      `<div class="gap-item"><span class="gpri ${g.priority === 'high' ? 'gph' : 'gpl'}">${g.priority === 'high' ? 'High' : 'Low'}</span>${g.text}</div>`
    ).join('') +
  '</div>';
}

// ── Modal / form ──────────────────────────────────────────────────────────────

function renderFormTagPicker() {
  const ctx = PREDEFINED_TAGS.filter(t => t.group === 'context');
  const typ = PREDEFINED_TAGS.filter(t => t.group === 'type');
  const chip = tag => {
    const sel = formTags.has(tag.id) ? ' selected' : '';
    return `<button type="button" class="tag-pick-btn${sel}" data-tag="${h(tag.id)}" onclick="toggleFormTag('${h(tag.id)}')">${h(tag.label)}</button>`;
  };
  const customTags = [...formTags].filter(t => !PREDEFINED_TAGS.find(p => p.id === t));
  const customDisplay = customTags.length
    ? `<div class="tag-custom-display">${customTags.map(t =>
        `<span class="tag-chip tag-custom">${h(t)}<button type="button" onclick="removeCustomTag('${h(t)}')">×</button></span>`
      ).join('')}</div>`
    : '';
  document.getElementById('f-tag-picker').innerHTML = `
    <div class="tag-picker-group"><span class="tpl">Context</span>${ctx.map(chip).join('')}</div>
    <div class="tag-picker-group"><span class="tpl">Type</span>${typ.map(chip).join('')}</div>
    ${customDisplay}
    <div class="tag-picker-input">
      <input id="f-custom-tag" type="text" placeholder="custom tag…" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomTag();}">
      <button type="button" onclick="addCustomTag()">+ Add</button>
    </div>`;
}

function toggleFormTag(tagId) {
  if (formTags.has(tagId)) formTags.delete(tagId);
  else formTags.add(tagId);
  renderFormTagPicker();
}

function addCustomTag() {
  const input = document.getElementById('f-custom-tag');
  const val = input.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (val && !formTags.has(val)) { formTags.add(val); renderFormTagPicker(); }
  input.value = '';
}

function removeCustomTag(tag) {
  formTags.delete(tag);
  renderFormTagPicker();
}

function clearForm() {
  ['f-name','f-brand','f-color','f-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-hex').value = '#888888';
  document.getElementById('f-score').value = '';
  document.getElementById('f-status').value = '';
}

function openAdd() {
  editingId = null;
  formTags = new Set();
  clearForm();
  document.getElementById('modal-title').textContent = 'Add item';
  renderFormTagPicker();
  document.getElementById('modal-bg').classList.add('open');
}

function openEdit(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  formTags = new Set(item.tags.split('|').filter(Boolean));
  document.getElementById('modal-title').textContent = 'Edit item';
  document.getElementById('f-name').value  = item.name;
  document.getElementById('f-brand').value = item.brand;
  document.getElementById('f-color').value = item.color;
  document.getElementById('f-hex').value   = item.hex;
  document.getElementById('f-score').value = item.score;
  document.getElementById('f-status').value = item.status || '';
  document.getElementById('f-notes').value  = item.notes;
  renderFormTagPicker();
  document.getElementById('modal-bg').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-bg').classList.remove('open');
  editingId = null;
}

document.getElementById('modal-bg').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── Export CSV ────────────────────────────────────────────────────────────────

function buildCSV() {
  const header = 'id,tags,brand,name,color,hex,palette_score,status,notes';
  const rows = items.map(i =>
    [i.id, i.tags, i.brand, i.name, i.color, i.hex, i.score, i.status, i.notes]
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
      .join(',')
  );
  return [header, ...rows].join('\n');
}

function exportCSV() {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(buildCSV());
  a.download = 'deep-autumn-wardrobe.csv';
  a.click();
  toast('CSV exported');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

loadItems();
