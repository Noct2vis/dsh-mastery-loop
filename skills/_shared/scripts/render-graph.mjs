#!/usr/bin/env node
// 分层图渲染器（v1）
//
// 用法：node render-graph.mjs <工作区根> [--out <文件>]
//
// 读：sys/graph.json · sys/layers.json（先跑 graph.mjs check --layers --write）· kb/knowledge/*.md · sys/config.json
// 写：sys/graph.html（自包含，浏览器直接打开；零依赖、无构建步骤）
//
// 只读库，不回写任何笔记或图数据。

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNotes, readNote, readJson, noteName } from './_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_JS = join(HERE, 'graph-view.js');

const PALETTE = ['#5B8FF9', '#61DDAA', '#F6BD16', '#7262FD', '#78D3F8', '#9661BC', '#F6903D', '#008685', '#F08BB4', '#65789B'];

function fail(msg) {
  console.log('❌ ' + msg);
  return 1;
}

function main() {
  const argv = process.argv.slice(2);
  const root = resolve(argv.find((a) => !a.startsWith('--')) || '.');
  const oi = argv.indexOf('--out');
  const out = oi !== -1 && argv[oi + 1] ? resolve(argv[oi + 1]) : join(root, 'sys', 'graph.html');

  if (!existsSync(root) || !statSync(root).isDirectory()) return fail(`工作区根不存在：${root}`);

  const gp = join(root, 'sys', 'graph.json');
  if (!existsSync(gp)) return fail(`没有图文件：${gp}`);
  let graph;
  try {
    graph = JSON.parse(readFileSync(gp, 'utf8'));
  } catch (err) {
    return fail(`graph.json 不是合法 JSON：${err.message}`);
  }

  const lp = join(root, 'sys', 'layers.json');
  let decks = null;
  if (existsSync(lp)) {
    try {
      decks = JSON.parse(readFileSync(lp, 'utf8'));
    } catch {
      decks = null;
    }
  }
  if (!decks || !decks.depth || !decks.layers) {
    return fail('没有 sys/layers.json —— 先跑：node graph.mjs check <工作区根> --layers --write');
  }
  try {
    if (statSync(lp).mtimeMs + 1000 < statSync(gp).mtimeMs) console.log('⚠️  layers.json 比 graph.json 旧 —— 建议重跑 check --layers --write');
  } catch {}

  const cfg = readJson(join(root, 'sys', 'config.json'));
  const cfgData = cfg && cfg.ok ? cfg.data : {};
  const notes = collectNotes(root);
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const groups = Array.isArray(graph.groups) ? graph.groups : [];

  const byName = new Map();
  for (const [name, path] of notes) byName.set(name, readNote(root, name, path, cfgData));

  const names = Object.keys(decks.depth);
  const index = new Set(names);
  const layers = decks.layers || [];

  const preds = new Map(names.map((n) => [n, []]));
  const succs = new Map(names.map((n) => [n, []]));
  const addLink = (a, b) => {
    if (!index.has(a) || !index.has(b)) return;
    preds.get(b).push(a);
    succs.get(a).push(b);
  };
  for (const e of edges) addLink(noteName(e && e.from), noteName(e && e.to));
  for (const g of groups) {
    const to = noteName(g && g.to);
    for (const o of Array.isArray(g && g.of) ? g.of : []) addLink(noteName(o), to);
  }

  const order = layers.map((l) => [...l]);
  const posOf = new Map();
  order.forEach((l) => l.forEach((n, i) => posOf.set(n, i)));
  for (let round = 0; round < 4; round++) {
    const down = round % 2 === 0;
    const seq = down ? order : [...order].reverse();
    for (const layer of seq) {
      const score = (n) => {
        const list = down ? preds.get(n) : succs.get(n);
        if (!list.length) return posOf.get(n) ?? 0;
        return list.reduce((s, p) => s + (posOf.get(p) ?? 0), 0) / list.length;
      };
      layer.sort((a, b) => score(a) - score(b));
      layer.forEach((n, i) => posOf.set(n, i));
    }
  }

  const ROW = 150;
  const COL = 200;
  const W = 168;
  const H = 40;
  const nodes = [];
  let minX = Infinity, maxX = -Infinity;
  order.forEach((layer, d) => {
    layer.forEach((n, i) => {
      const x = (i - (layer.length - 1) / 2) * COL;
      const y = d * ROW;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      const rec = byName.get(n);
      nodes.push({
        id: n,
        x,
        y,
        depth: d,
        cls: rec && Array.isArray(rec.分类) ? rec.分类 : [],
        tags: rec && rec.data && Array.isArray(rec.data['标签']) ? rec.data['标签'] : [],
        alias: rec && rec.data && Array.isArray(rec.data.aliases) ? rec.data.aliases[0] : '',
        one: rec && rec.一句话 ? rec.一句话 : '',
      });
    });
  });

  const data = {
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    levels: (cfgData['分类'] && cfgData['分类']['层级']) || ['课程', '讲次'],
    nodes,
    edges: edges
      .map((e) => ({ s: noteName(e && e.from), t: noteName(e && e.to), reason: e && e.reason ? String(e.reason) : '' }))
      .filter((e) => index.has(e.s) && index.has(e.t)),
    groups: groups
      .map((g) => ({ t: noteName(g && g.to), of: (Array.isArray(g && g.of) ? g.of : []).map(noteName), reason: g && g.reason ? String(g.reason) : '' }))
      .filter((g) => index.has(g.t) && g.of.every((o) => index.has(o))),
    box: { x0: minX - W / 2 - 20, x1: maxX + W / 2 + 20, y0: -H, y1: Math.max(0, order.length - 1) * ROW + H + 20 },
    palette: PALETTE,
    row: ROW,
    col: COL,
    w: W,
    h: H,
  };

  let view;
  try {
    view = readFileSync(VIEW_JS, 'utf8');
  } catch (err) {
    return fail(`读不了 graph-view.js：${err.message}`);
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知识先修图</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#2a2f3a; --fg:#e6e8ee; --dim:#8b93a7; --accent:#5B8FF9; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  #stage { width:100%; height:100%; display:block; cursor:grab; }
  #stage.panning { cursor:grabbing; }
  .edge { fill:none; stroke:#39404f; stroke-width:1.2; opacity:.55; }
  .edge.or { stroke-dasharray:5 4; stroke:#6b768c; }
  .edge.hl { stroke:var(--accent); stroke-width:2; opacity:1; }
  .node rect { stroke:#39404f; stroke-width:1; rx:6; }
  .node text { fill:#dfe3ec; font-size:12px; pointer-events:none; }
  .node.hit rect { stroke:#F6BD16; stroke-width:2.5; }
  .node.dim { opacity:.18; }
  .node.sel rect { stroke:#fff; stroke-width:2; }
  .panel { position:fixed; background:color-mix(in srgb, var(--panel) 92%, transparent); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  #top { left:12px; top:12px; max-width:360px; }
  #top h1 { font-size:13px; margin:0 0 6px; font-weight:600; }
  #top .meta { color:var(--dim); font-size:11px; }
  #search { width:100%; margin-top:8px; background:#0f131a; border:1px solid var(--line); color:var(--fg); border-radius:6px; padding:5px 8px; }
  #filters { left:12px; bottom:12px; width:300px; max-height:52vh; overflow:auto; }
  #filters h2 { font-size:12px; margin:8px 0 4px; color:var(--dim); font-weight:600; }
  #filters label { display:block; padding:1px 0; cursor:pointer; }
  #filters .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  #filters button, #filters select, #top button { background:#0f131a; border:1px solid var(--line); color:var(--fg); border-radius:5px; padding:2px 6px; cursor:pointer; }
  #filters.collapsed #checks, #filters.collapsed #tagFilter, #filters.collapsed h2 { display:none; }
  #legend { right:12px; top:12px; max-width:220px; }
  #legend .item { display:flex; align-items:center; gap:6px; font-size:12px; padding:1px 0; }
  #legend .dot { width:10px; height:10px; border-radius:3px; flex:none; }
  #mini { position:fixed; right:12px; bottom:12px; width:200px; height:130px; background:#0d1016; border:1px solid var(--line); border-radius:8px; }
  #hint { position:fixed; right:222px; bottom:16px; color:var(--dim); font-size:11px; }
  .hidden { display:none; }
</style>
</head>
<body>
<svg id="stage"><g id="scene"></g></svg>
<div class="panel" id="top">
  <h1>知识先修图 · <span id="count"></span></h1>
  <div class="meta" id="meta"></div>
  <input id="search" placeholder="搜索知识点（回车定位）">
  <div class="row" style="margin-top:6px"><button id="fit">适应全图</button><span class="meta">滚轮缩放 · 拖动画布</span></div>
</div>
<div class="panel" id="filters">
  <div class="row">
    <button id="all">全选</button><button id="none">清空</button>
    <select id="colorMode"><option value="cat0">按课程着色</option><option value="cat1">按讲次着色</option><option value="tag">按标签高亮</option></select>
  </div>
  <select id="tagAxis" class="hidden"></select>
  <div id="checks"></div>
  <h2>只看含标签</h2>
  <select id="tagFilter"><option value="">（不限）</option></select>
</div>
<div class="panel" id="legend"><h1 style="font-size:12px;margin:0 0 6px;">图例</h1><div id="legendBody"></div></div>
<svg id="mini"></svg>
<div id="hint">点节点看邻域 · 再点取消</div>
<script>window.__GRAPH_DATA__ = ${json};</script>
<script>
${view}
</script>
</body>
</html>
`;

  try {
    writeFileSync(out, html, 'utf8');
  } catch (err) {
    return fail(`写不了 ${out}：${err.message}`);
  }
  console.log(`✅ 已生成 ${out}`);
  console.log(`   节点 ${nodes.length} · 边 ${data.edges.length} · OR 组 ${data.groups.length} · 层 ${layers.length}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.log('❌ render-graph.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
