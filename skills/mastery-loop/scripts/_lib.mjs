#!/usr/bin/env node
// 共享工具（不单独使用）
//
// 用途：本文件是其它脚本共用的最小工具集 —— 读写 JSON / JSONL、解析 frontmatter、
//       收集知识点、扫 wikilink、替换 AUTO 区。**零依赖、不拼 shell。**

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, sep } from 'node:path';

export const KB = 'kb';
export const NOTES = join('kb', 'knowledge');
export const MOC = join('kb', 'MOC');
export const SYS = 'sys';
export const AUTO_BEGIN = '<!-- AUTO:BEGIN -->';
export const AUTO_END = '<!-- AUTO:END -->';

export function readIfPossible(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function writeText(p, text) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, 'utf8');
}

export function sha1(text) {
  return 'sha1:' + createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
}

export function readJson(p) {
  const t = readIfPossible(p);
  if (t === null) return { ok: false, reason: `读不了：${p}` };
  try {
    return { ok: true, data: JSON.parse(t) };
  } catch (err) {
    return { ok: false, reason: `${p} 不是合法 JSON：${err.message}` };
  }
}

/** JSONL：第一行是 header（kind: header），其余是数据行 */
export function readJsonl(p) {
  const t = readIfPossible(p);
  if (t === null) return { ok: false, reason: `读不了：${p}` };
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  let header = null;
  lines.forEach((l, i) => {
    let obj;
    try {
      obj = JSON.parse(l);
    } catch {
      return;
    }
    if (i === 0 && obj && obj.kind === 'header') header = obj;
    else rows.push(obj);
  });
  return { ok: true, header, rows };
}

export function writeJsonl(p, header, rows) {
  const text = [JSON.stringify(header), ...rows.map((r) => JSON.stringify(r))].join('\n') + '\n';
  writeText(p, text);
}

// ---------- frontmatter（只支持契约用到的那几种写法） ----------

/** 切出 frontmatter 文本与正文 */
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

function parseScalar(s) {
  let v = s.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** 行内列表：["a/b", "c"] —— 引号内的逗号/括号不切 */
function parseInlineList(s) {
  const inner = s.trim().replace(/^\[/, '').replace(/\]$/, '');
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(parseScalar).filter((x) => x !== '');
}

/** 极简 YAML 子集 → 对象（够契约用） */
export function parseFrontmatter(fmText) {
  const data = {};
  if (!fmText) return data;
  for (const line of fmText.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_\u4e00-\u9fa5]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw === '' || raw === '>-' || raw === '|') {
      data[key] = '';
      continue;
    }
    if (raw.startsWith('[')) data[key] = parseInlineList(raw);
    else data[key] = parseScalar(raw);
  }
  return data;
}

// ---------- 知识点 ----------

export function collectNotes(root) {
  const map = new Map();
  const dir = join(root, NOTES);
  const walk = (d, depth) => {
    if (depth > 4) return;
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
  walk(dir, 0);
  return map;
}

export function noteName(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^\[\[/, '').replace(/\]\]$/, '');
  const pipe = s.indexOf('|');
  if (pipe !== -1) s = s.slice(0, pipe);
  s = s.replace(/\.md$/i, '');
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1].trim();
}

/** 笔记名 + 分类值 + 一句话 */
export function readNote(root, name, path, cfg) {
  const text = readIfPossible(path) || '';
  const { fm, body } = splitFrontmatter(text);
  const data = parseFrontmatter(fm);
  const field = cfg?.分类?.字段 || '分类';
  const csep = cfg?.分类?.分隔符 || '/';
  const raw = data[field];
  const 分类 = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const one = /##\s*一句话\s*\n+([^\n#]+)/.exec(body);
  return {
    name,
    path,
    rel: relative(root, path).split(sep).join('/'),
    分类: 分类.map((c) => String(c).split(csep).map((x) => x.trim()).filter(Boolean)),
    一句话: one ? one[1].trim() : '',
    text,
    data,
  };
}

// ---------- 正文小节 ----------

export function sectionRange(text, heading) {
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

export function sectionBullets(text, heading) {
  const r = sectionRange(text, heading);
  if (!r) return null;
  const body = text.slice(r.bodyStart, r.end);
  const names = [];
  for (const line of body.split(/\r?\n/)) {
    const mm = line.match(/^\s*[-*]\s+\[\[([^\]]+?)\]\]/);
    if (mm) names.push(noteName(mm[1]));
  }
  return names;
}

export function replaceSection(text, heading, bullets) {
  const r = sectionRange(text, heading);
  if (!r) return { text, found: false };
  const body = bullets.length ? bullets.join('\n') : '_（暂无）_';
  return {
    text: `${text.slice(0, r.headStart)}## ${heading}\n\n${body}\n\n${text.slice(r.end)}`,
    found: true,
  };
}

// ---------- AUTO 区 ----------

export function replaceAutoZone(text, lines) {
  const b = text.indexOf(AUTO_BEGIN);
  const e = text.indexOf(AUTO_END);
  const block = `${AUTO_BEGIN}\n${lines.join('\n')}\n${AUTO_END}`;
  if (b === -1 || e === -1 || e < b) {
    // 没有标记：原地补一个，放在第一个 `## ` 之前（或文件末尾）
    const at = text.search(/^##[ \t]/m);
    const body = `${block}\n\n`;
    return at === -1 ? text.trimEnd() + '\n\n' + body : text.slice(0, at) + body + text.slice(at);
  }
  return text.slice(0, b) + block + text.slice(e + AUTO_END.length);
}

// ---------- 链接 ----------

export function parseLinks(text) {
  const out = [];
  const re = /\[\[([^\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1];
    const pipe = raw.indexOf('|');
    const target = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
    const alias = pipe === -1 ? '' : raw.slice(pipe + 1).trim();
    out.push({ raw, target, alias });
  }
  return out;
}

export function walkMarkdown(root, dirRel = '.', depth = 0, out = []) {
  if (depth > 5) return out;
  const dir = join(root, dirRel);
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = dirRel === '.' ? e.name : join(dirRel, e.name);
    if (e.isDirectory()) walkMarkdown(root, rel, depth + 1, out);
    else if (/\.md$/i.test(e.name)) out.push(join(root, rel));
  }
  return out;
}

export function existsDir(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

// ⚠️ 下面是**未被调用的副本**：图的单一实现是 `graph.mjs` 的 `check()`（`scan.mjs` 直接 import 它）。
//    保留只为对照；下次清理时删掉，别再往这里加逻辑。

export function checkGraph(root) {
  const problems = [];
  const warnings = [];
  const g = readJson(join(root, SYS, 'graph.json'));
  if (!g.ok) {
    return { ok: false, reason: g.reason, problems, warnings, edges: [], notes: new Map(), involved: new Set() };
  }
  const data = g.data;
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const notes = collectNotes(root);
  const hasNote = (name) => notes.has(name);

  const fwd = new Map();
  const bwd = new Map();
  const addTo = (m, k, v) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(v);
  };

  edges.forEach((e, i) => {
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
    addTo(fwd, from, to);
    addTo(bwd, to, from);
  });

  const involved = new Set([...fwd.keys(), ...bwd.keys()]);

  for (const [name, path] of notes) {
    const text = readIfPossible(path);
    if (text === null) {
      warnings.push(`读不了：${path}`);
      continue;
    }
    const pre = sectionBullets(text, '前置知识');
    const post = sectionBullets(text, '后置知识');
    if (involved.has(name)) {
      if (pre === null) warnings.push(`「${name}」缺 \`## 前置知识\` 小节`);
      if (post === null) warnings.push(`「${name}」缺 \`## 后置知识\` 小节`);
    }
    for (const [label, list] of [['前置知识', pre], ['后置知识', post]]) {
      if (!list) continue;
      const seen = new Set();
      for (const n of list) {
        if (seen.has(n)) problems.push(`同段无重复 ✖ 「${name}」\`## ${label}\` 里「${n}」出现两次`);
        seen.add(n);
      }
    }
    if (pre && post) {
      const both = [...new Set(pre.filter((n) => post.includes(n)))];
      if (both.length) problems.push(`前后置互斥 ✖ 「${name}」同时出现在前置与后置：${both.join('、')}`);
    }
    if (pre) {
      for (const n of new Set(pre)) {
        if (!(bwd.get(name) || new Set()).has(n)) {
          problems.push(`双向自洽 ✖ 「${name}」的 \`## 前置知识\` 里有「${n}」，但图里没有这条边`);
        }
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

  for (const [from, tos] of fwd) {
    for (const to of tos) {
      const t1 = notes.has(from) ? readIfPossible(notes.get(from)) : null;
      if (t1 !== null) {
        const post = sectionBullets(t1, '后置知识') || [];
        if (!post.includes(to)) problems.push(`双向自洽 ✖ 「${from}」的 \`## 后置知识\` 缺「${to}」（图里有这条边）`);
      }
      const t2 = notes.has(to) ? readIfPossible(notes.get(to)) : null;
      if (t2 !== null) {
        const pre = sectionBullets(t2, '前置知识') || [];
        if (!pre.includes(from)) problems.push(`双向自洽 ✖ 「${to}」的 \`## 前置知识\` 缺「${from}」（图里有这条边）`);
      }
    }
  }

  const reach = (start) => {
    const seen = new Set([start]);
    const stack = [...(fwd.get(start) || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const t of fwd.get(cur) || []) if (!seen.has(t)) stack.push(t);
    }
    seen.delete(start);
    return seen;
  };
  for (const name of involved) {
    const path = notes.get(name);
    if (!path) continue;
    const list = sectionBullets(readIfPossible(path) || '', '前置知识');
    if (!list) continue;
    const uniq = [...new Set(list)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i];
        const b = uniq[j];
        if (reach(a).has(b)) problems.push(`前置两两不可比 ✖ 「${name}」的前置里「${a}」已经是「${b}」的前置 —— 只收直接前置`);
        else if (reach(b).has(a)) problems.push(`前置两两不可比 ✖ 「${name}」的前置里「${b}」已经是「${a}」的前置 —— 只收直接前置`);
      }
    }
  }

  if (data['用途'] === undefined) warnings.push('graph.json 缺「用途」字段');
  if (data['规则'] === undefined) warnings.push('graph.json 缺「规则」字段');

  return { ok: true, data, edges, notes, involved, problems, warnings, fwd, bwd };
}
