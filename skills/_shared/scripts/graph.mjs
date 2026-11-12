#!/usr/bin/env node
// mastery-loop 关系图工具（v2：AND/OR 前置图）
//
// 用途：本脚本是关系图的读写器 —— 管 sys/graph.json
//       edges = 必要前置（AND）；groups = 任一满足（OR，mode:"any"）。
//       做八项校验、算分层，并把两个小节（## 前置知识 / ## 后置知识）渲染回笔记。
// 契约正文：../templates.md（第二、三、七节）
//
// 用法：
//   node graph.mjs check     <工作区根> [--layers] [--write]
//   node graph.mjs backlinks <工作区根> [--write]
//   node graph.mjs sort      <工作区根> --note <笔记名> [--folder <已注册 folder 名>] [--limit N]
//
// 硬要求：**永远不要崩溃** —— 缺文件、坏 JSON、目录不存在都只报错并以退出码结束。

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIYO_ENDPOINT = 'http://127.0.0.1:8742/v0/search/related';
const GRAPH_REL = join('sys', 'graph.json');
const LAYERS_REL = join('sys', 'layers.json');
const NOTES_REL = join('kb', 'knowledge');

// ---------- 基础 ----------

function readIfPossible(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 笔记名：去掉路径、去掉 .md、去掉 |别名、去掉 [[ ]] */
function noteName(raw) {
  let s = String(raw || '').trim();
  if (s.startsWith('[[')) s = s.slice(2);
  if (s.endsWith(']]')) s = s.slice(0, -2);
  const pipe = s.indexOf('|');
  if (pipe !== -1) s = s.slice(0, pipe);
  s = s.replace(/\.md$/i, '');
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1].trim();
}

function notesDir(root) {
  const d = join(root, NOTES_REL);
  return existsSync(d) && statSync(d).isDirectory() ? d : join(root, 'kb', 'knowledge');
}

/** name -> 绝对路径 */
function collectNotes(root) {
  const map = new Map();
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.md$/i.test(e.name)) map.set(e.name.replace(/\.md$/i, ''), p);
    }
  };
  walk(notesDir(root), 0);
  return map;
}

function loadGraph(root) {
  const path = join(root, GRAPH_REL);
  if (!existsSync(path)) return { ok: false, reason: `没有图文件：${path}`, path };
  const text = readIfPossible(path);
  if (text === null) return { ok: false, reason: `图文件读不了：${path}`, path };
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `图文件不是合法 JSON：${err.message}`, path };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: `图文件不是对象：${path}`, path };
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  return { ok: true, path, data, edges, groups };
}

/** 归一化一个 OR 组 */
function normGroup(g) {
  const to = noteName(g && g.to);
  const rawOf = Array.isArray(g && g.of) ? g.of.map(noteName).filter(Boolean) : [];
  return {
    id: String((g && g.id) || ''),
    mode: g && typeof g.mode === 'string' ? g.mode : '',
    to,
    of: [...new Set(rawOf)],
    reason: g && typeof g.reason === 'string' ? g.reason.trim() : '',
  };
}

// ---------- 正文小节 ----------

function sectionRange(text, heading) {
  const re = new RegExp('^##\\s*' + heading + '\\s*$', 'm');
  const m = re.exec(text);
  if (!m) return null;
  const after = text.indexOf('\n', m.index);
  if (after === -1) return { headStart: m.index, bodyStart: text.length, end: text.length };
  const rest = text.slice(after + 1);
  const nextRel = rest.search(/^##[ \t]/m);
  const end = nextRel === -1 ? text.length : after + 1 + nextRel;
  return { headStart: m.index, bodyStart: after + 1, end };
}

function sectionBody(text, heading) {
  const r = sectionRange(text, heading);
  return r ? text.slice(r.bodyStart, r.end) : null;
}

function sectionBullets(text, heading) {
  const body = sectionBody(text, heading);
  if (body === null) return null;
  const names = [];
  for (const line of body.split(/\r?\n/)) {
    const mm = line.match(/^\s*[-*]\s+\[\[([^\]]+?)\]\]/);
    if (mm) names.push(noteName(mm[1]));
  }
  return names;
}

/**
 * 解析前置知识：
 *   `- [[X]] —— reason`            → { kind: 'and', name }
 *   `- [[X]] 或 [[Y]]（任一）—— reason` → { kind: 'or', of: [X, Y], reason }
 */
function preEntries(text) {
  const body = sectionBody(text, '前置知识');
  if (body === null) return null;
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    const raw = m[1];
    const links = [...raw.matchAll(/\[\[([^\]]+?)\]\]/g)].map((x) => noteName(x[1])).filter(Boolean);
    if (!links.length) continue;
    const reason = (raw.split('——').slice(1).join('——') || '').trim();
    if (links.length === 1) out.push({ kind: 'and', name: links[0], reason });
    else out.push({ kind: 'or', of: [...new Set(links)], reason });
  }
  return out;
}

function replaceSection(text, heading, bullets) {
  const r = sectionRange(text, heading);
  if (!r) return { text, found: false };
  const before = text.slice(0, r.headStart);
  const after = text.slice(r.end);
  const body = bullets.length ? bullets.join('\n') : '_（暂无）_';
  return { text: `${before}## ${heading}\n\n${body}\n\n${after}`, found: true };
}

function groupKey(to, of) {
  return to + ' ← {' + [...of].sort().join(', ') + '}';
}

// ---------- 分层 ----------

/** 语义层：AND 取 max，OR 组取 min；无依赖为 0 */
function computeDepth(names, reqOf, altOf) {
  const memo = new Map();
  const depthOf = (n) => {
    if (memo.has(n)) return memo.get(n);
    memo.set(n, 0);
    let best = 0;
    for (const p of reqOf.get(n) || []) best = Math.max(best, depthOf(p) + 1);
    for (const grp of altOf.get(n) || []) {
      if (!grp.length) continue;
      best = Math.max(best, Math.min(...grp.map((o) => depthOf(o))) + 1);
    }
    memo.set(n, best);
    return best;
  };
  const depth = {};
  let max = 0;
  for (const n of names) {
    const d = depthOf(n);
    depth[n] = d;
    if (d > max) max = d;
  }
  const layers = Array.from({ length: max + 1 }, () => []);
  for (const n of names) layers[depth[n]].push(n);
  for (const l of layers) l.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return { depth, layers };
}

// ---------- check ----------

export function check(root, opts = {}) {
  const problems = [];
  const warnings = [];

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 1;
  }

  const g = loadGraph(root);
  if (!g.ok) {
    console.log(`⚠️  ${g.reason}`);
    console.log('   没有图就没有关系可查 —— 契约见 templates.md 第三、七节。');
    return 1;
  }

  const notes = collectNotes(root);
  const hasNote = (name) => notes.has(name);

  const fwd = new Map();
  const bwd = new Map();
  const reqOf = new Map();
  const altOf = new Map();
  const addTo = (m, k, v) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(v);
  };
  const addReq = (to, from) => {
    if (!reqOf.has(to)) reqOf.set(to, []);
    reqOf.get(to).push(from);
    addTo(fwd, from, to);
    addTo(bwd, to, from);
  };
  const addAlt = (to, of) => {
    if (!altOf.has(to)) altOf.set(to, []);
    altOf.get(to).push(of);
    for (const o of of) {
      addTo(fwd, o, to);
      addTo(bwd, to, o);
    }
  };

  g.edges.forEach((e, i) => {
    const at = `edges[${i}]`;
    const from = noteName(e && e.from);
    const to = noteName(e && e.to);
    const reason = e && typeof e.reason === 'string' ? e.reason.trim() : '';

    if (!from || !to) {
      problems.push(`${at}：缺 from 或 to`);
      return;
    }
    if (from === to) problems.push(`无自链 ✖ ${at}：${from} → ${to}`);
    if (!hasNote(from)) problems.push(`无悬空 ✖ ${at}：找不到笔记「${from}」`);
    if (!hasNote(to)) problems.push(`无悬空 ✖ ${at}：找不到笔记「${to}」`);
    if (!reason) problems.push(`${at}：缺 reason（每条边必须 ≤30 字理由）`);
    else if ([...reason].length > 30) problems.push(`${at}：reason ${[...reason].length} 字 > 30（${reason}）`);

    addReq(to, from);
  });

  const groups = g.groups.map(normGroup);
  const groupIds = new Set();
  groups.forEach((gr, i) => {
    const at = `groups[${i}]`;
    if (!gr.id) problems.push(`${at}：缺 id`);
    else if (groupIds.has(gr.id)) problems.push(`组结构 ✖ ${at}：id「${gr.id}」重复`);
    else groupIds.add(gr.id);
    if (gr.mode !== 'any') problems.push(`组结构 ✖ ${at}：mode 必须是 "any"（当前 ${gr.mode || '空'}）`);
    if (!gr.to) {
      problems.push(`${at}：缺 to`);
      return;
    }
    if (!gr.of.length) {
      problems.push(`组结构 ✖ ${at}：of 为空`);
      return;
    }
    if (gr.of.length < 2) warnings.push(`${at}：只有一个选项的 OR 组等价于一条边 —— 建议直接写成 edge`);
    if (gr.of.includes(gr.to)) problems.push(`无自链 ✖ ${at}：of 里出现了 to「${gr.to}」`);
    if (!gr.reason) problems.push(`${at}：缺 reason（每个组必须 ≤30 字理由）`);
    else if ([...gr.reason].length > 30) problems.push(`${at}：reason ${[...gr.reason].length} 字 > 30（${gr.reason}）`);
    if (!hasNote(gr.to)) problems.push(`无悬空 ✖ ${at}：找不到笔记「${gr.to}」`);
    for (const o of gr.of) {
      if (!hasNote(o)) problems.push(`无悬空 ✖ ${at}：找不到笔记「${o}」`);
    }
    addAlt(gr.to, gr.of);
  });

  // 规则 7：无环（含 OR 组边）
  const color = new Map();
  const stack = [];
  let cycle = null;
  const dfs = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of fwd.get(u) || []) {
      const c = color.get(v);
      if (c === 1) {
        if (!cycle) cycle = stack.slice(stack.indexOf(v)).concat(v);
      } else if (!c) dfs(v);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const n of fwd.keys()) if (!color.get(n)) dfs(n);
  if (cycle) problems.push(`无环 ✖ 发现环：${cycle.join(' → ')}`);

  const reach = (start) => {
    const seen = new Set();
    const st = [...(fwd.get(start) || [])];
    while (st.length) {
      const cur = st.pop();
      if (seen.has(cur) || cur === start) continue;
      seen.add(cur);
      for (const t of fwd.get(cur) || []) if (!seen.has(t)) st.push(t);
    }
    return seen;
  };

  // 规则 8：组内选项两两不可达（否则是假 OR）
  groups.forEach((gr, i) => {
    if (gr.of.length < 2 || !hasNote(gr.to)) return;
    for (let a = 0; a < gr.of.length; a++) {
      for (let b = a + 1; b < gr.of.length; b++) {
        const A = gr.of[a];
        const B = gr.of[b];
        if (reach(A).has(B)) problems.push(`组结构 ✖ groups[${i}]：「${A}」已是「${B}」的前置 —— 组内必须互不可达`);
        else if (reach(B).has(A)) problems.push(`组结构 ✖ groups[${i}]：「${B}」已是「${A}」的前置 —— 组内必须互不可达`);
      }
    }
  });

  const involved = new Set([...fwd.keys(), ...bwd.keys()]);

  for (const [name, path] of notes) {
    const text = readIfPossible(path);
    if (text === null) {
      warnings.push(`读不了：${path}`);
      continue;
    }
    const pre = preEntries(text);
    const post = sectionBullets(text, '后置知识');

    if (involved.has(name)) {
      if (pre === null) warnings.push(`「${name}」缺 \`## 前置知识\` 小节`);
      if (post === null) warnings.push(`「${name}」缺 \`## 后置知识\` 小节`);
    }

    const preSeen = new Set();
    for (const e of pre || []) {
      const key = e.kind === 'and' ? e.name : '【OR】' + e.of.join('|');
      if (preSeen.has(key)) problems.push(`同段无重复 ✖ 「${name}」\`## 前置知识\` 里「${key}」出现两次`);
      preSeen.add(key);
    }
    const postSeen = new Set();
    for (const n of post || []) {
      if (postSeen.has(n)) problems.push(`同段无重复 ✖ 「${name}」\`## 后置知识\` 里「${n}」出现两次`);
      postSeen.add(n);
    }

    const preNames = new Set();
    for (const e of pre || []) {
      if (e.kind === 'and') preNames.add(e.name);
      else for (const o of e.of) preNames.add(o);
    }
    if (pre && post) {
      const both = [...preNames].filter((n) => post.includes(n));
      if (both.length) problems.push(`前后置互斥 ✖ 「${name}」同时出现在前置与后置：${both.join('、')}`);
    }

    if (pre) {
      const andSet = pre.filter((e) => e.kind === 'and').map((e) => e.name);
      for (const n of andSet) {
        if (!(bwd.get(name) || new Set()).has(n)) {
          problems.push(`双向自洽 ✖ 「${name}」的 \`## 前置知识\` 里有「${n}」，但图里没有这条边`);
        }
      }
      const orLines = pre.filter((e) => e.kind === 'or').map((e) => groupKey(name, e.of));
      const orGraph = groups.filter((gr) => gr.to === name).map((gr) => groupKey(name, gr.of));
      for (const k of orLines) {
        if (!orGraph.includes(k)) problems.push(`双向自洽 ✖ 「${name}」的 OR 行 ${k} 在图里没有对应组`);
      }
      for (const k of orGraph) {
        if (!orLines.includes(k)) problems.push(`双向自洽 ✖ 「${name}」缺 OR 行 ${k}（图里有这个组）`);
      }
    }
    if (post) {
      for (const n of new Set(post)) {
        if (!(fwd.get(name) || new Set()).has(n)) {
          problems.push(`双向自洽 ✖ 「${name}」的 \`## 后置知识\` 里有「${n}」，但图里没有这条边`);
        }
      }
    }
  }

  const plainEdge = new Set(g.edges.map((e) => `${noteName(e && e.from)}→${noteName(e && e.to)}`));
  for (const [from, tos] of fwd) {
    for (const to of tos) {
      const t1 = notes.has(from) ? readIfPossible(notes.get(from)) : null;
      if (t1 !== null) {
        const post = sectionBullets(t1, '后置知识') || [];
        if (!post.includes(to)) problems.push(`双向自洽 ✖ 「${from}」的 \`## 后置知识\` 缺「${to}」（图里有这条依赖）`);
      }
      const t2 = notes.has(to) ? readIfPossible(notes.get(to)) : null;
      if (t2 !== null) {
        const pre = preEntries(t2) || [];
        const ok = plainEdge.has(`${from}→${to}`)
          ? pre.some((e) => e.kind === 'and' && e.name === from)
          : pre.some((e) => e.kind === 'or' && e.of.includes(from));
        if (!ok) problems.push(`双向自洽 ✖ 「${to}」的 \`## 前置知识\` 缺「${from}」（图里有这条依赖）`);
      }
    }
  }

  // 规则 6：同一篇的 AND 前置两两不可比
  for (const name of involved) {
    const path = notes.get(name);
    if (!path) continue;
    const pre = preEntries(readIfPossible(path) || '');
    if (!pre) continue;
    const uniq = [...new Set(pre.filter((e) => e.kind === 'and').map((e) => e.name))];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i];
        const b = uniq[j];
        if (reach(a).has(b)) problems.push(`前置两两不可比 ✖ 「${name}」的前置里「${a}」已经是「${b}」的前置 —— 只收直接前置`);
        else if (reach(b).has(a)) problems.push(`前置两两不可比 ✖ 「${name}」的前置里「${b}」已经是「${a}」的前置 —— 只收直接前置`);
      }
    }
  }

  if (g.data['用途'] === undefined) warnings.push('graph.json 缺「用途」字段');
  if (g.data['规则'] === undefined) warnings.push('graph.json 缺「规则」字段');
  if (g.data.version !== 2) warnings.push(`graph.json 的 version 是 ${g.data.version ?? '（缺）'}；契约要求 2`);
  const cov = g.data.coverage;
  if (cov && typeof cov === 'object') {
    const done = Object.values(cov).flatMap((v) => (v && Array.isArray(v.done) ? v.done : []));
    if (!done.length) warnings.push('coverage 里还没有任何 done —— 图可能还没开始建');
  }

  const names = [...involved];
  const deck = computeDepth(names, reqOf, altOf);
  if (opts.writeLayers && problems.length) {
    warnings.push('校验未过，未写 sys/layers.json（先修问题再生成分层）');
  }
  if (opts.writeLayers && problems.length === 0) {
    const out = {
      '用途': '本文件是关系图的分层（派生数据，可随时重算）：depth 是每个点的语义层（AND 取 max，OR 取 min）。',
      '生成于': new Date().toISOString().slice(0, 16).replace('T', ' '),
      depth: deck.depth,
      layers: deck.layers,
      groups: groups.map((gr) => ({ to: gr.to, of: gr.of, reason: gr.reason })),
    };
    try {
      writeFileSync(join(root, LAYERS_REL), JSON.stringify(out, null, 2) + '\n', 'utf8');
    } catch (err) {
      warnings.push(`写不了 ${LAYERS_REL}：${err.message}`);
    }
  }

  console.log(`图：${relative(process.cwd(), g.path) || g.path}`);
  console.log(`边 ${g.edges.length} 条 · OR 组 ${groups.length} 个 · 知识点 ${notes.size} 篇 · 参与图的 ${involved.size} 篇`);
  if (opts.layers) {
    console.log('');
    console.log(`分层：${deck.layers.length} 层`);
    deck.layers.forEach((list, i) => {
      const shown = list.slice(0, 12).join('、');
      console.log(`  层 ${i}（${list.length}）：${shown}${list.length > 12 ? ' …' : ''}`);
    });
  }
  if (warnings.length) {
    console.log('');
    for (const w of warnings) console.log(`⚠️  ${w}`);
  }
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`❌ ${p}`);
    console.log('');
    console.log(`未过：${problems.length} 个问题。`);
    return 1;
  }
  console.log('');
  console.log('✅ 八项校验全过：双向自洽 / 无自链 / 无悬空 / 同段无重复 / 前后置互斥 / 前置两两不可比 / 无环 / 组结构。');
  return 0;
}

// ---------- backlinks ----------

function backlinks(root, write) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 2;
  }
  const g = loadGraph(root);
  if (!g.ok) {
    console.log(`❌ ${g.reason}`);
    return 1;
  }
  const notes = collectNotes(root);
  const groups = g.groups.map(normGroup);

  const preOf = new Map();
  const postOf = new Map();
  const altOf = new Map();
  for (const e of g.edges) {
    const from = noteName(e && e.from);
    const to = noteName(e && e.to);
    const reason = e && typeof e.reason === 'string' ? e.reason.trim() : '';
    if (!from || !to) continue;
    if (!postOf.has(from)) postOf.set(from, []);
    postOf.get(from).push(to);
    if (!preOf.has(to)) preOf.set(to, []);
    preOf.get(to).push({ from, reason });
  }
  for (const gr of groups) {
    if (!gr.to || !gr.of.length) continue;
    if (!altOf.has(gr.to)) altOf.set(gr.to, []);
    altOf.get(gr.to).push({ of: gr.of, reason: gr.reason });
    for (const o of gr.of) {
      if (!postOf.has(o)) postOf.set(o, []);
      postOf.get(o).push(gr.to);
    }
  }

  const rel = (p) => relative(root, p).split(sep).join('/');
  const link = (name) => {
    const target = notes.get(name);
    return target ? `[[${rel(target)}|${name}]]` : `[[${name}]]`;
  };
  let changed = 0;
  let touched = 0;

  for (const [name, path] of notes) {
    const pre = (preOf.get(name) || []).filter((x) => notes.has(x.from));
    const alts = (altOf.get(name) || []).filter((x) => x.of.every((o) => notes.has(o)));
    const post = [...new Set(postOf.get(name) || [])].filter((x) => notes.has(x));
    if (!pre.length && !post.length && !alts.length) continue;
    const text = readIfPossible(path);
    if (text === null) continue;
    const preBullets = [
      ...pre.map((x) => `- ${link(x.from)}${x.reason ? ` —— ${x.reason}` : ''}`),
      ...alts.map((x) => `- ${x.of.map(link).join(' 或 ')}（任一）${x.reason ? ` —— ${x.reason}` : ''}`),
    ];
    const postBullets = post.map((x) => `- ${link(x)}`);
    const a = replaceSection(text, '前置知识', preBullets);
    const b = replaceSection(a.text, '后置知识', postBullets);
    if (!a.found && !b.found) continue;
    touched++;
    if (b.text !== text) {
      changed++;
      if (write) {
        try {
          writeFileSync(path, b.text, 'utf8');
        } catch (err) {
          console.log(`❌ 写不了 ${path}：${err.message}`);
          return 1;
        }
      }
    }
  }

  console.log(`${write ? '已写回' : '预览（未写盘）'}：${touched} 篇有两段，${changed} 篇内容有变化。`);
  if (!write && changed) console.log('加 --write 才会真正写盘（只动 \`## 前置知识\` / \`## 后置知识\` 两个小节）。');
  return 0;
}

// ---------- sort（可选：本机装了 Miyo 才用） ----------

async function miyoSort(root, noteArg, folderArg, limit) {
  const note = noteName(noteArg);
  const notes = collectNotes(root);
  const path = notes.get(note);
  if (!path) {
    console.log(`❌ 找不到笔记「${note}」`);
    return 2;
  }
  const folderName = folderArg || basename(dirname(root));
  const relPath = relative(dirname(root), path).split(sep).join('\\');
  const filePath = `${folderName}/${relPath}`;

  let res;
  try {
    res = await fetch(MIYO_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, limit }),
    });
  } catch (err) {
    console.log(`ℹ️ 连不上 Miyo（${MIYO_ENDPOINT}）：${err.message}`);
    console.log('   没装 Miyo 就跳过排序 —— 发布版不依赖它。');
    return 0;
  }
  if (!res.ok) {
    console.log(`ℹ️ Miyo 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    console.log(`   用的 file_path = ${filePath}`);
    return 0;
  }
  const data = await res.json().catch(() => null);
  const results = data && Array.isArray(data.results) ? data.results : [];
  const score = new Map(results.map((r) => [noteName(r.path), r.score]));

  console.log(`Miyo related：${filePath} → ${results.length} 条`);
  console.log('');
  const text = readIfPossible(path) || '';
  for (const heading of ['前置知识', '后置知识']) {
    const list = sectionBullets(text, heading) || [];
    const ranked = [...list].sort((a, b) => (score.has(b) ? score.get(b) : -1) - (score.has(a) ? score.get(a) : -1));
    console.log(`## ${heading}（按 Miyo 相关度排序，仅供参考；定序者是知识深度）`);
    for (const n of ranked) {
      const s = score.has(n) ? score.get(n).toFixed(3) : '—';
      console.log(`- [[${n}]]   ${s}`);
    }
    console.log('');
  }
  return 0;
}

// ---------- main ----------

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1).filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
  const opt = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(name + '='));
    if (hit) return hit.split('=').slice(1).join('=');
    const i = argv.indexOf(name);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    return dflt;
  };

  if (!cmd || !['check', 'backlinks', 'sort'].includes(cmd)) {
    console.log('用法：');
    console.log('  node graph.mjs check     <工作区根> [--layers] [--write]');
    console.log('  node graph.mjs backlinks <工作区根> [--write]');
    console.log('  node graph.mjs sort      <工作区根> --note <笔记名> [--folder <folder 名>] [--limit N]');
    return 2;
  }

  const root = resolve(rest[0] || '.');
  if (cmd === 'check') {
    return check(root, { layers: flags.has('--layers'), writeLayers: flags.has('--write') });
  }
  if (cmd === 'backlinks') return backlinks(root, flags.has('--write'));
  const limit = Number(opt('--limit', '20')) || 20;
  return miyoSort(root, opt('--note', ''), opt('--folder', ''), limit);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const code = await Promise.resolve(main());
    process.exit(typeof code === 'number' ? code : 0);
  } catch (err) {
    console.log('❌ graph.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
}
