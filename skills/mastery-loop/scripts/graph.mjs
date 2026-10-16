#!/usr/bin/env node
// mastery-loop 关系图工具
//
// 用途：本脚本是关系图的读写器 —— 管 sys/graph.json（只存边；节点就是 kb/knowledge/ 里的笔记本身），
//       做六项校验，并把两个小节（## 前置知识 / ## 后置知识）渲染回笔记。
// 契约正文：../templates.md（第二、三、七节）
//
// 用法：
//   node graph.mjs check     <工作区根>
//   node graph.mjs backlinks <工作区根> [--write]
//   node graph.mjs sort      <工作区根> --note <笔记名> [--folder <已注册 folder 名>] [--limit N]
//
// 硬要求：**永远不要崩溃** —— 缺文件、坏 JSON、目录不存在都只报错并以退出码结束。

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIYO_ENDPOINT = 'http://127.0.0.1:8742/v0/search/related';
const GRAPH_REL = join('sys', 'graph.json');
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
  s = s.replace(/^\[\[/, '').replace(/\]\]$/, '');
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
  return { ok: true, path, data, edges };
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

function sectionBullets(text, heading) {
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

function replaceSection(text, heading, bullets) {
  const r = sectionRange(text, heading);
  if (!r) return { text, found: false };
  const before = text.slice(0, r.headStart);
  const after = text.slice(r.end);
  const body = bullets.length ? bullets.join('\n') : '_（暂无）_';
  return { text: `${before}## ${heading}\n\n${body}\n\n${after}`, found: true };
}

// ---------- check ----------

export function check(root) {
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

  const fwd = new Map(); // from -> Set(to)
  const bwd = new Map(); // to -> Set(from)
  const addTo = (m, k, v) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(v);
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

    addTo(fwd, from, to);
    addTo(bwd, to, from);
  });

  // 参与图的笔记：只见于图中的那些才强校验（图允许分批，图外的笔记不报缺小节）
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

  // 图里有、正文里没有
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

  // 规则 6：同一篇的前置集合两两不可比（只收直接前置）
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

  if (g.data['用途'] === undefined) warnings.push('graph.json 缺「用途」字段');
  if (g.data['规则'] === undefined) warnings.push('graph.json 缺「规则」字段');
  const cov = g.data.coverage;
  if (cov && typeof cov === 'object') {
    const done = Object.values(cov).flatMap((v) => (v && Array.isArray(v.done) ? v.done : []));
    warnings.length; // no-op，保持结构清晰
    if (!done.length) warnings.push('coverage 里还没有任何 done —— 图可能还没开始建');
  }

  console.log(`图：${relative(process.cwd(), g.path) || g.path}`);
  console.log(`边 ${g.edges.length} 条 · 知识点 ${notes.size} 篇 · 参与图的 ${involved.size} 篇`);
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
  console.log('✅ 六项校验全过：双向自洽 / 无自链 / 无悬空 / 同段无重复 / 前后置互斥 / 前置两两不可比。');
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

  const preOf = new Map();
  const postOf = new Map();
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

  const rel = (p) => relative(root, p).split(sep).join('/');
  let changed = 0;
  let touched = 0;

  for (const [name, path] of notes) {
    const pre = (preOf.get(name) || []).filter((x) => notes.has(x.from));
    const post = [...new Set(postOf.get(name) || [])].filter((x) => notes.has(x));
    if (!pre.length && !post.length) continue;
    const text = readIfPossible(path);
    if (text === null) continue;
    const preBullets = pre.map((x) => {
      const target = notes.get(x.from);
      const link = target ? `[[${rel(target)}|${x.from}]]` : `[[${x.from}]]`;
      return `- ${link}${x.reason ? ` —— ${x.reason}` : ''}`;
    });
    const postBullets = post.map((x) => {
      const target = notes.get(x);
      return target ? `- [[${rel(target)}|${x}]]` : `- [[${x}]]`;
    });
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
  if (!write && changed) console.log('加 --write 才会真正写盘（只动 `## 前置知识` / `## 后置知识` 两个小节）。');
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
    console.log('  node graph.mjs check     <工作区根>');
    console.log('  node graph.mjs backlinks <工作区根> [--write]');
    console.log('  node graph.mjs sort      <工作区根> --note <笔记名> [--folder <folder 名>] [--limit N]');
    return 2;
  }

  const root = resolve(rest[0] || '.');
  if (cmd === 'check') return check(root);
  if (cmd === 'backlinks') return backlinks(root, flags.has('--write'));
  const limit = Number(opt('--limit', '20')) || 20;
  return miyoSort(root, opt('--note', ''), opt('--folder', ''), limit);
}

// 直接跑才执行；被 scan.mjs import 时不执行（只借它的 check 函数）
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
