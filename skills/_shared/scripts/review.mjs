#!/usr/bin/env node
// 关系图重审工具（v1）
//
// 用法：
//   node review.mjs plan <工作区根> [--limit N] [--force] [--changed a,b] [--dry]
//   node review.mjs mark <工作区根> --file <确认清单.txt> [--full]
//   node review.mjs done <工作区根> --full
//
// 只做机械部分：算指纹、找候选、写清单、盖 reviewedAt/fp。
// **判定留 agent**：删掉 from 之后 to 还解释得通吗？reason 是否说出 to 的哪一步用到 from？
//
// 退出码：0 成功；1 有问题；2 用法错误。

import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectNotes, noteName, readIfPossible, sha1 } from './_lib.mjs';

const CRITERIA = 'v2.1';
const AGING_DAYS = 90;
const FORCE_FULL_AFTER = 5;

const GRAPH = join('sys', 'graph.json');
const REVIEWS = join('sys', 'reviews');
const STATE = join(REVIEWS, 'state.json');

const today = () => new Date().toISOString().slice(0, 10);
const nowMin = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function loadGraph(root) {
  const p = join(root, GRAPH);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function git(root, args) {
  const tmp = join(root, 'sys', '.git-out.tmp');
  let fd = null;
  try {
    fd = openSync(tmp, 'w');
    const r = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    fd = null;
    if (r.error || r.status !== 0) return null;
    return readIfPossible(tmp) || '';
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    try { unlinkSync(tmp); } catch {}
  }
}

function readState(root) {
  const p = join(root, STATE);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { lastRun: '', lastFullAt: '', lastFullCommit: '' };
  }
}

function writeState(root, state) {
  const dir = join(root, REVIEWS);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, STATE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function edgeFp(fromText, toText, reason) {
  return sha1([fromText, toText, reason, CRITERIA].join('\u0000'));
}

function groupFp(toText, optionTexts, reason) {
  return sha1([toText, ...[...optionTexts].sort(), reason, CRITERIA].join('\u0000'));
}

function buildAdj(edges, groups) {
  const adj = new Map();
  const touch = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const e of edges) {
    const a = noteName(e.from), b = noteName(e.to);
    if (a && b) { touch(a, b); touch(b, a); }
  }
  for (const g of groups) {
    const t = noteName(g.to);
    for (const o of Array.isArray(g.of) ? g.of : []) {
      const a = noteName(o);
      if (a && t) { touch(a, t); touch(t, a); }
    }
  }
  return adj;
}

function neighborhood(adj, starts, hops = 2) {
  const seen = new Set(starts);
  let frontier = [...starts];
  for (let i = 0; i < hops; i++) {
    const next = [];
    for (const n of frontier) {
      for (const m of adj.get(n) || []) {
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return seen;
}

function gitNewNodes(root, state) {
  if (!state.lastRun) return new Set();
  const out = git(root, ['diff', '--name-only', state.lastRun + '..HEAD']);
  if (!out) return new Set();
  const set = new Set();
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim().split('\\').join('/');
    if (p.startsWith('kb/knowledge/') && /\.md$/i.test(p)) set.add(noteName(p));
  }
  return set;
}

function gitChangesSinceFull(root, state) {
  const ok = (git(root, ['rev-parse', '--is-inside-work-tree']) || '').trim() === 'true';
  if (!ok) return null; // 没有 git → 调用方用「改图次数」兜底
  if (!state.lastFullCommit) return 0; // 还没全量过：按增量走（全是「从未审过」），别一上来就 540 条
  const out = git(root, ['rev-list', '--count', state.lastFullCommit + '..HEAD', '--', 'sys/graph.json']);
  if (out === null) return FORCE_FULL_AFTER;
  const n = Number(out.trim());
  return Number.isFinite(n) ? n : 0;
}

function plan(root, argv) {
  const graph = loadGraph(root);
  if (!graph) {
    console.log(`❌ 没有可读的 ${GRAPH} —— 先建图。`);
    return 1;
  }
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const groups = Array.isArray(graph.groups) ? graph.groups : [];
  const notes = collectNotes(root);
  const text = (n) => {
    const p = notes.get(n);
    return p ? readIfPossible(p) || '' : '';
  };

  const state = readState(root);
  const changedArg = argv.indexOf('--changed');
  const changed = changedArg !== -1 && argv[changedArg + 1] ? new Set(argv[changedArg + 1].split(',').map(noteName)) : gitNewNodes(root, state);
  const adj = buildAdj(edges, groups);
  const near = neighborhood(adj, [...changed], 2);

  const force = argv.includes('--force');
  const graphHash = sha1(readFileSync(join(root, GRAPH), 'utf8'));
  if (state.lastGraphHash !== graphHash) {
    state.pendingChanges = (Number(state.pendingChanges) || 0) + 1;
    state.lastGraphHash = graphHash;
  }
  const fromGit = gitChangesSinceFull(root, state);
  const commits = fromGit === null ? Number(state.pendingChanges) || 0 : fromGit;
  const full = force || commits >= FORCE_FULL_AFTER;
  const limitArg = argv.indexOf('--limit');
  // 全量默认「不截断」，但显式 --limit 仍然生效（分批审全量时用）
  const limit = limitArg !== -1 ? Number(argv[limitArg + 1]) || 40 : full ? 0 : 40;

  const items = [];
  const todayMs = Date.now();

  edges.forEach((e, i) => {
    const from = noteName(e.from);
    const to = noteName(e.to);
    if (!from || !to) return;
    const reason = typeof e.reason === 'string' ? e.reason.trim() : '';
    const fp = edgeFp(text(from), text(to), reason);
    const why = [];
    if (full) why.push(force ? '强制全量' : `改图满 ${FORCE_FULL_AFTER} 次，强制全量`);
    else if (e.fp !== fp) why.push(e.fp ? '端点内容或 reason 变过' : '从未审过');
    if (!full && near.has(from) && near.has(to)) why.push('邻域内有新点 / 改点');
    if (!full && e.reviewedAt) {
      const days = (todayMs - Date.parse(e.reviewedAt)) / 86400000;
      if (Number.isFinite(days) && days > AGING_DAYS) why.push(`${Math.floor(days)} 天未审`);
    } else if (!full && !e.reviewedAt) {
      // 已在「从未审过」里
    }
    if (!why.length) return;
    items.push({ kind: 'edge', id: `${from} → ${to}`, from, to, reason, why, index: i, fp });
  });

  groups.forEach((g, i) => {
    const to = noteName(g.to);
    const of = (Array.isArray(g.of) ? g.of : []).map(noteName).filter(Boolean);
    if (!to || !of.length) return;
    const reason = typeof g.reason === 'string' ? g.reason.trim() : '';
    const fp = groupFp(text(to), of.map((o) => text(o)), reason);
    const why = [];
    if (full) why.push(force ? '强制全量' : `改图满 ${FORCE_FULL_AFTER} 次，强制全量`);
    else if (g.fp !== fp) why.push(g.fp ? '端点内容或 reason 变过' : '从未审过');
    if (!full && (of.some((o) => near.has(o)) || near.has(to))) why.push('邻域内有新点 / 改点');
    if (!full && g.reviewedAt) {
      const days = (todayMs - Date.parse(g.reviewedAt)) / 86400000;
      if (Number.isFinite(days) && days > AGING_DAYS) why.push(`${Math.floor(days)} 天未审`);
    }
    if (!why.length) return;
    items.push({ kind: 'group', id: g.id || `groups[${i}]`, to, of, reason, why, index: i, fp });
  });

  items.sort((a, b) => (a.why.includes('从未审过') ? -1 : 0) - (b.why.includes('从未审过') ? -1 : 0));
  const picked = limit > 0 ? items.slice(0, limit) : items;

  const at = nowMin();
  const payload = {
    at,
    mode: full ? 'full' : 'incremental',
    criteria: CRITERIA,
    commitsSinceFull: commits,
    counts: { edges: edges.length, groups: groups.length, candidates: picked.length, skipped: items.length - picked.length },
    items: picked,
  };

  console.log(`${full ? '全量重审' : '增量重审'} · ${at}`);
  console.log(`边 ${edges.length} · 组 ${groups.length} · 候选 ${picked.length}${items.length > picked.length ? `（另有 ${items.length - picked.length} 条被 --limit 截掉）` : ''}`);
  if (changed.size) console.log(`邻域起点（新/改）：${[...changed].slice(0, 10).join('、')}${changed.size > 10 ? ' …' : ''}`);
  console.log('');
  for (const it of picked.slice(0, 12)) {
    console.log(`· [${it.kind === 'edge' ? '边' : '组'}] ${it.id} —— ${it.why.join(' / ')}`);
    if (it.reason) console.log(`    理由：${it.reason}`);
  }
  if (picked.length > 12) console.log(`  …还有 ${picked.length - 12} 条`);

  if (argv.includes('--dry')) {
    console.log('');
    console.log('（--dry：不写清单）');
    return 0;
  }
  const dir = join(root, REVIEWS);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = at.replace(/[: ]/g, '-');
  const base = join(dir, `${stamp}`);
  writeFileSync(base + '.json', JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const lines = [];
  lines.push(`# 重审清单 · ${at}`);
  lines.push('');
  lines.push(`模式：**${full ? '全量' : '增量'}** · 判据版本：${CRITERIA} · 候选 ${picked.length}${items.length > picked.length ? `（截掉 ${items.length - picked.length}）` : ''}`);
  lines.push('');
  lines.push('> 逐条判定，回「改 / 不改」。脚本不自动改图。判定完跑：');
  lines.push('> `node review.mjs mark <根> --file <确认清单.txt>`（一行一条 id；`--full` 表示这次是全量审完）');
  lines.push('');
  for (const it of picked) {
    lines.push(`## ${it.kind === 'edge' ? '边' : '组'}：${it.id}`);
    lines.push('');
    lines.push(`- 候选原因：${it.why.join(' / ')}`);
    if (it.kind === 'group') lines.push(`- 组内选项：${it.of.join(' 或 ')}`);
    if (it.reason) lines.push(`- 现有理由：${it.reason}`);
    lines.push('- 判定问题：删掉这一项，目标点的核心内容还解释得通吗？理由是否说出「目标的哪一步用到它」？');
    lines.push('');
  }
  writeFileSync(base + '.md', lines.join('\n'), 'utf8');
  console.log('');
  console.log(`✅ 清单：${relative(process.cwd(), base)}.md / .json`);

  state.lastRun = (git(root, ['rev-parse', 'HEAD']) || '').trim() || state.lastRun || '';
  const completeFull = full && picked.length === items.length;
  if (completeFull) {
    state.lastFullAt = at;
    state.lastFullCommit = state.lastRun;
    state.pendingChanges = 0;
  }
  writeState(root, state);
  return 0;
}

function mark(root, argv) {
  const graph = loadGraph(root);
  if (!graph) return 1;
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const groups = Array.isArray(graph.groups) ? graph.groups : [];
  const notes = collectNotes(root);
  const text = (n) => {
    const p = notes.get(n);
    return p ? readIfPossible(p) || '' : '';
  };
  const fi = argv.indexOf('--file');
  const file = fi !== -1 ? argv[fi + 1] : '';
  if (!file || !existsSync(file)) {
    console.log('❌ 用法：review.mjs mark <根> --file <确认清单.txt> [--full]');
    return 2;
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let nEdge = 0, nGroup = 0;
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const arrow = line.indexOf('→');
    if (arrow !== -1) {
      const from = noteName(line.slice(0, arrow));
      const to = noteName(line.slice(arrow + 1));
      const e = edges.find((x) => noteName(x.from) === from && noteName(x.to) === to);
      if (!e) { console.log(`⚠️  找不到边：${line}`); continue; }
      e.reviewedAt = today();
      e.fp = edgeFp(text(from), text(to), typeof e.reason === 'string' ? e.reason.trim() : '');
      nEdge++;
    } else {
      const g = groups.find((x) => String(x.id) === line);
      if (!g) { console.log(`⚠️  找不到组：${line}`); continue; }
      const to = noteName(g.to);
      const of = (Array.isArray(g.of) ? g.of : []).map(noteName).filter(Boolean);
      g.reviewedAt = today();
      g.fp = groupFp(text(to), of.map((o) => text(o)), typeof g.reason === 'string' ? g.reason.trim() : '');
      nGroup++;
    }
  }
  writeFileSync(join(root, GRAPH), JSON.stringify(graph, null, 2) + '\n', 'utf8');
  console.log(`✅ 已盖审：边 ${nEdge} 条 · 组 ${nGroup} 个（reviewedAt = ${today()}）`);
  if (argv.includes('--full')) return done(root, argv);
  return 0;
}

function done(root, argv) {
  if (!argv.includes('--full')) {
    console.log('用法：review.mjs done <根> --full');
    return 2;
  }
  const state = readState(root);
  state.lastFullAt = nowMin();
  state.lastFullCommit = (git(root, ['rev-parse', 'HEAD']) || '').trim() || '';
  state.pendingChanges = 0;
  writeState(root, state);
  console.log(`✅ 全量审完：${state.lastFullAt}${state.lastFullCommit ? ' @ ' + state.lastFullCommit.slice(0, 7) : ''}`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const root = resolve(argv.slice(1).find((a) => !a.startsWith('--')) || '.');
  if (!cmd || !['plan', 'mark', 'done'].includes(cmd)) {
    console.log('用法：');
    console.log('  node review.mjs plan <根> [--limit N] [--force] [--changed a,b] [--dry]');
    console.log('  node review.mjs mark <根> --file <确认清单.txt> [--full]');
    console.log('  node review.mjs done <根> --full');
    return 2;
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 2;
  }
  if (cmd === 'plan') return plan(root, argv);
  if (cmd === 'mark') return mark(root, argv);
  return done(root, argv);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (err) {
    console.log('❌ review.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
}

export { plan, mark };
