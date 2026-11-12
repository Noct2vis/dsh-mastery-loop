// graph-view.js —— 由 render-graph.mjs 内联进 sys/graph.html。零依赖、浏览器直接跑。
(() => {
  const D = window.__GRAPH_DATA__;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('stage');
  const scene = document.getElementById('scene');
  const mini = document.getElementById('mini');
  const W = 168, H = 40;
  const box = D.box;

  const byId = new Map(D.nodes.map((n) => [n.id, n]));
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

  const palette = D.palette;
  const colorMap = new Map();
  const assignColor = (key) => {
    if (!colorMap.has(key)) colorMap.set(key, palette[colorMap.size % palette.length]);
    return colorMap.get(key);
  };
  const catOf = (n, level) => (n.cls && n.cls[0] && n.cls[0][level]) || '未分类';

  const courses = [...new Set(D.nodes.map((n) => catOf(n, 0)))];
  const lectures = [...new Set(D.nodes.map((n) => catOf(n, 1)))];
  for (const c of courses) assignColor('c:' + c);
  for (const l of lectures) assignColor('l:' + l);
  const tagAxisOptions = (() => {
    const count = new Map();
    for (const n of D.nodes) for (const t of n.tags || []) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  })();
  for (const t of tagAxisOptions) assignColor('t:' + t);

  // ---------- 建图 ----------
  const edgeEls = [];
  const groupEls = [];
  const nodeEls = new Map();
  const gEdges = el('g', {});
  const gGroups = el('g', {});
  const gNodes = el('g', {});
  scene.append(gEdges, gGroups, gNodes);

  const edgePath = (a, b) => {
    const x1 = a.x, y1 = a.y + H / 2, x2 = b.x, y2 = b.y - H / 2;
    const dy = Math.max(30, Math.abs(y2 - y1) * 0.5);
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
  };

  for (const e of D.edges) {
    const a = byId.get(e.s), b = byId.get(e.t);
    if (!a || !b) continue;
    const p = el('path', { d: edgePath(a, b), class: 'edge' });
    const t = el('title', {});
    t.textContent = `${e.s} → ${e.t}\n${e.reason || ''}`;
    p.appendChild(t);
    gEdges.appendChild(p);
    edgeEls.push({ p, s: e.s, t: e.t });
  }
  for (const g of D.groups) {
    const b = byId.get(g.t);
    if (!b) continue;
    for (const o of g.of) {
      const a = byId.get(o);
      if (!a) continue;
      const p = el('path', { d: edgePath(a, b), class: 'edge or' });
      const t = el('title', {});
      t.textContent = `任一前置：${g.of.join(' 或 ')} → ${g.t}\n${g.reason || ''}`;
      p.appendChild(t);
      gGroups.appendChild(p);
      groupEls.push({ p, s: o, t: g.t });
    }
  }

  for (const n of D.nodes) {
    const g = el('g', { class: 'node', transform: `translate(${n.x - W / 2} ${n.y - H / 2})` });
    const r = el('rect', { width: W, height: H, rx: 6 });
    const t = el('text', { x: 10, y: 24 });
    t.textContent = trunc(n.id, 13);
    const ti = el('title', {});
    ti.textContent = [n.id, n.alias, ...(n.cls || []).map((p) => p.join(' / ')), n.one].filter(Boolean).join('\n');
    g.append(r, t, ti);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); selectNode(n.id); });
    gNodes.appendChild(g);
    nodeEls.set(n.id, { g, r, t });
  }

  const neigh = new Map();
  const touch = (a, b) => {
    if (!neigh.has(a)) neigh.set(a, new Set());
    neigh.get(a).add(b);
  };
  for (const e of D.edges) { touch(e.s, e.t); touch(e.t, e.s); }
  for (const g of D.groups) for (const o of g.of) { touch(o, g.t); touch(g.t, o); }

  // ---------- 视口 ----------
  let tx = 0, ty = 0, k = 1;
  const apply = () => {
    scene.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
    updateMini();
  };
  const size = () => ({ w: svg.clientWidth || window.innerWidth, h: svg.clientHeight || window.innerHeight });
  const fit = () => {
    const { w, h } = size();
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    k = Math.min(w / bw, h / bh) * 0.92;
    k = Math.max(0.03, Math.min(k, 1.4));
    tx = w / 2 - ((box.x0 + box.x1) / 2) * k;
    ty = h / 2 - ((box.y0 + box.y1) / 2) * k;
    apply();
  };
  const centerOn = (x, y) => {
    const { w, h } = size();
    tx = w / 2 - x * k;
    ty = h / 2 - y * k;
    apply();
  };

  let panning = false, px = 0, py = 0;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    panning = true;
    px = e.clientX; py = e.clientY;
    svg.classList.add('panning');
  });
  window.addEventListener('pointermove', (e) => {
    if (!panning) return;
    tx += e.clientX - px; ty += e.clientY - py;
    px = e.clientX; py = e.clientY;
    apply();
  });
  window.addEventListener('pointerup', () => { panning = false; svg.classList.remove('panning'); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.max(0.03, Math.min(3, k * f));
    tx = cx - (cx - tx) * (nk / k);
    ty = cy - (cy - ty) * (nk / k);
    k = nk;
    apply();
  }, { passive: false });

  // ---------- 小地图 ----------
  mini.setAttribute('viewBox', `${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`);
  const miniDots = el('g', {});
  const dotR = Math.max(14, (box.x1 - box.x0) / 260);
  for (const n of D.nodes) miniDots.appendChild(el('circle', { cx: n.x, cy: n.y, r: dotR, fill: '#3a4355' }));
  const viewRect = el('rect', { fill: 'rgba(91,143,249,.12)', stroke: '#5B8FF9', 'stroke-width': 8 });
  mini.append(miniDots, viewRect);
  const updateMini = () => {
    const { w, h } = size();
    viewRect.setAttribute('x', -tx / k);
    viewRect.setAttribute('y', -ty / k);
    viewRect.setAttribute('width', w / k);
    viewRect.setAttribute('height', h / k);
  };
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect();
    const x = box.x0 + ((e.clientX - r.left) / r.width) * (box.x1 - box.x0);
    const y = box.y0 + ((e.clientY - r.top) / r.height) * (box.y1 - box.y0);
    centerOn(x, y);
  });

  // ---------- 着色 ----------
  const colorMode = document.getElementById('colorMode');
  const tagAxis = document.getElementById('tagAxis');
  for (const t of tagAxisOptions) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    tagAxis.appendChild(o);
  }
  const legend = document.getElementById('legendBody');
  const colorOf = (n) => {
    const mode = colorMode.value;
    if (mode === 'cat0') return assignColor('c:' + catOf(n, 0));
    if (mode === 'cat1') return assignColor('l:' + catOf(n, 1));
    const t = tagAxis.value;
    return (n.tags || []).includes(t) ? '#F6BD16' : '#2b3342';
  };
  const paint = () => {
    const mode = colorMode.value;
    tagAxis.classList.toggle('hidden', mode !== 'tag');
    const lum = (hex) => {
      const c = hex.replace('#', '');
      const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    };
    for (const n of D.nodes) {
      const rec = nodeEls.get(n.id);
      if (!rec) continue;
      const color = colorOf(n);
      rec.r.style.fill = color;
      rec.t.style.fill = lum(color) > 0.62 ? '#10141b' : '#eef1f7';
    }
    legend.innerHTML = '';
    const used = new Map();
    if (mode === 'tag') {
      used.set('含「' + (tagAxis.value || '…') + '」', '#F6BD16');
      used.set('其它', '#2b3342');
    } else {
      for (const n of D.nodes) {
        const key = mode === 'cat0' ? catOf(n, 0) : catOf(n, 1);
        if (!used.has(key)) used.set(key, colorOf(n));
      }
    }
    for (const [label, color] of used) {
      const row = document.createElement('div');
      row.className = 'item';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = color;
      const span = document.createElement('span');
      span.textContent = trunc(label, 24);
      row.append(dot, span);
      legend.appendChild(row);
    }
  };

  // ---------- 筛选 ----------
  const checks = document.getElementById('checks');
  const lvl = D.levels || ['课程', '讲次'];
  const state = { c: new Set(courses), l: new Set(lectures), tag: '' };

  const section = (title, values, key) => {
    const h = document.createElement('h2');
    h.textContent = title;
    checks.appendChild(h);
    for (const v of values) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.key = key;
      cb.dataset.value = v;
      cb.addEventListener('change', () => {
        if (cb.checked) state[key].add(v); else state[key].delete(v);
        applyFilter();
      });
      const span = document.createElement('span');
      span.textContent = ' ' + trunc(v, 26);
      lab.append(cb, span);
      checks.appendChild(lab);
    }
  };
  section(lvl[0] || '课程', courses, 'c');
  section(lvl[1] || '讲次', lectures, 'l');

  const tagFilter = document.getElementById('tagFilter');
  for (const t of tagAxisOptions) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    tagFilter.appendChild(o);
  }
  tagFilter.addEventListener('change', () => { state.tag = tagFilter.value; applyFilter(); });

  const visible = (n) => state.c.has(catOf(n, 0)) && state.l.has(catOf(n, 1)) && (!state.tag || (n.tags || []).includes(state.tag));

  const applyFilter = () => {
    let shown = 0;
    for (const n of D.nodes) {
      const ok = visible(n);
      if (ok) shown++;
      const rec = nodeEls.get(n.id);
      if (rec) rec.g.classList.toggle('hidden', !ok);
    }
    for (const e of [...edgeEls, ...groupEls]) {
      const a = byId.get(e.s), b = byId.get(e.t);
      const ok = a && b && visible(a) && visible(b);
      e.p.classList.toggle('hidden', !ok);
    }
    document.getElementById('count').textContent = shown + ' / ' + D.nodes.length + ' 个知识点';
  };

  document.getElementById('all').onclick = () => {
    state.c = new Set(courses); state.l = new Set(lectures); state.tag = '';
    tagFilter.value = '';
    for (const cb of checks.querySelectorAll('input')) cb.checked = true;
    applyFilter();
  };
  document.getElementById('none').onclick = () => {
    state.c = new Set(); state.l = new Set(); state.tag = '';
    tagFilter.value = '';
    for (const cb of checks.querySelectorAll('input')) cb.checked = false;
    applyFilter();
  };

  // ---------- 搜索 ----------
  const search = document.getElementById('search');
  const doSearch = (jump) => {
    const q = search.value.trim().toLowerCase();
    for (const n of D.nodes) {
      const rec = nodeEls.get(n.id);
      const hit = q && (n.id.toLowerCase().includes(q) || (n.alias || '').toLowerCase().includes(q));
      if (rec) rec.g.classList.toggle('hit', !!hit);
    }
    if (jump && q) {
      const hit = D.nodes.find((n) => n.id.toLowerCase().includes(q) || (n.alias || '').toLowerCase().includes(q));
      if (hit) centerOn(hit.x, hit.y);
    }
  };
  search.addEventListener('input', () => doSearch(false));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(true); });

  // ---------- 选中邻域 ----------
  let selected = null;
  const clearSel = () => {
    selected = null;
    for (const rec of nodeEls.values()) rec.g.classList.remove('sel', 'dim');
    for (const e of [...edgeEls, ...groupEls]) e.p.classList.remove('hl');
  };
  const selectNode = (id) => {
    if (selected === id) { clearSel(); return; }
    clearSel();
    selected = id;
    const keep = new Set([id, ...(neigh.get(id) || [])]);
    for (const [nid, rec] of nodeEls) {
      rec.g.classList.toggle('dim', !keep.has(nid));
      if (nid === id) rec.g.classList.add('sel');
    }
    for (const e of [...edgeEls, ...groupEls]) if (e.s === id || e.t === id) e.p.classList.add('hl');
  };
  svg.addEventListener('click', () => clearSel());

  // ---------- 启动 ----------
  document.getElementById('fit').addEventListener('click', fit);
  const filtersPanel = document.getElementById('filters');
  const collapse = document.createElement('button');
  collapse.textContent = '收起筛选';
  collapse.addEventListener('click', () => {
    filtersPanel.classList.toggle('collapsed');
    collapse.textContent = filtersPanel.classList.contains('collapsed') ? '展开筛选' : '收起筛选';
  });
  filtersPanel.querySelector('.row')?.appendChild(collapse);
  colorMode.addEventListener('change', paint);
  tagAxis.addEventListener('change', paint);
  document.getElementById('meta').textContent =
    `生成于 ${D.generatedAt} · ${D.nodes.length} 点 · ${D.edges.length} 边 · ${D.groups.length} 个 OR 组`;
  paint();
  applyFilter();
  fit();
  window.addEventListener('resize', () => apply());
})();
