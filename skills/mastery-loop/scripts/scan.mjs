#!/usr/bin/env node
// 扫库脚本
//
// 用途：本脚本是健康检查 —— 查链接、查分类与配置是否对得上、查图与笔记是否一致、查账本引用；
//       并读 sys/state.jsonl 按内容哈希跳过没变过的文件（--update-state 写回哈希）。
// 契约正文：../templates.md（第七节）
//
// 用法：node scan.mjs <工作区根> [--update-state]

import { existsSync, statSync, readdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  SYS, readJson, readJsonl, writeJsonl, collectNotes, readNote, readIfPossible,
  walkMarkdown, parseLinks, sha1,
} from './_lib.mjs';
import * as checkGraphModule from './graph.mjs';

const EXPECTED_SCHEMA = '0.2.0';

function main() {
  const argv = process.argv.slice(2);
  const root = resolve(argv.find((a) => !a.startsWith('--')) || '.');
  const updateState = argv.includes('--update-state');

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 2;
  }

  const problems = [];
  const notes = [];

  // ---------- 变化检测：**有 git 看 git**，没有 git 才用哈希兜底 ----------
  // 注意：沙箱里**不能用管道**抓子进程输出（EPERM），所以把 stdout/stderr 重定向到文件描述符再读回来。
  const TMPGIT = join(root, SYS, '.git-out.tmp');
  const git = (args) => {
    let fd = null;
    try {
      fd = openSync(TMPGIT, 'w');
      const r = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { stdio: ['ignore', fd, fd] });
      closeSync(fd);
      fd = null;
      if (r.error || r.status !== 0) return null;
      return readIfPossible(TMPGIT) || '';
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {}
      }
      try {
        unlinkSync(TMPGIT);
      } catch {}
    }
  };
  const gitOk = (git(['rev-parse', '--is-inside-work-tree']) || '').trim() === 'true';

  const st = readJsonl(join(root, SYS, 'state.jsonl'));
  const stRows = st.ok ? st.rows : [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const mdFiles = walkMarkdown(root, join('kb'));
  let stateRows = [];
  let changedFiles = [];
  let unchanged = 0;
  let mode = 'hash';

  if (gitOk) {
    mode = 'git';
    const head = (git(['rev-parse', 'HEAD']) || '').trim();
    const mark = stRows.find((r) => r && r.mode === 'git');
    const last = mark && mark.last ? mark.last : '';

    const inKb = (p) => p.startsWith('kb/') && /\.md$/i.test(p);
    const set = new Set();

    // ① 未提交的变化
    const por = git(['status', '--porcelain']);
    if (por !== null) {
      for (const line of por.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let p = line.slice(3).trim();
        const arrow = p.indexOf(' -> ');
        if (arrow !== -1) p = p.slice(arrow + 4);
        p = p.replace(/^"|"$/g, '').split('\\').join('/');
        if (inKb(p)) set.add(p);
      }
    }
    // ② 上次检查之后提交过的变化
    if (last && head) {
      const diff = git(['diff', '--name-only', `${last}..HEAD`]);
      if (diff !== null) {
        for (const p of diff.split(/\r?\n/)) {
          const norm = p.trim().split('\\').join('/');
          if (inKb(norm)) set.add(norm);
        }
      }
    } else if (!last) {
      for (const p of mdFiles) set.add(p.slice(root.length + 1).split('\\').join('/'));
    }

    changedFiles = [...set];
    const total = mdFiles.length;
    unchanged = Math.max(0, total - changedFiles.length);
    stateRows = [{ mode: 'git', last: head, schema: EXPECTED_SCHEMA, checked: now }];
  } else {
    const prev = new Map(stRows.map((r) => [r.path, r.hash]));
    for (const p of mdFiles) {
      const rel = p.slice(root.length + 1).split('\\').join('/');
      const h = sha1(readIfPossible(p) || '');
      stateRows.push({ path: rel, hash: h, schema: EXPECTED_SCHEMA, checked: now });
      if (prev.get(rel) === h) unchanged++;
      else changedFiles.push(rel);
    }
  }

  // ---------- ①② 链接（在**所有文件**里解析：PDF 之类也要算存在） ----------
  const allFiles = walkMarkdown(root, '.');
  const allRel = new Set();
  const allBase = new Map();
  const collect = (dirRel, depth) => {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = readdirSync(join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = dirRel === '.' ? e.name : join(dirRel, e.name);
      if (e.isDirectory()) {
        collect(rel, depth + 1);
        continue;
      }
      const norm = rel.split('\\').join('/');
      allRel.add(norm);
      const base = norm.split('/').pop().replace(/\.md$/i, '');
      if (!allBase.has(base)) allBase.set(base, []);
      allBase.get(base).push(norm);
    }
  };
  collect('.', 0);

  const normTarget = (t) => t.replace(/^\.\//, '').split('\\').join('/');

  for (const p of allFiles) {
    const rel = p.slice(root.length + 1).split('\\').join('/');
    const text = readIfPossible(p) || '';
    for (const link of parseLinks(text)) {
      const t = normTarget(link.target);
      if (allRel.has(t) || allRel.has(t + '.md')) continue;
      const base = t.split('/').pop().replace(/\.md$/i, '');
      const hits = allBase.get(base) || [];
      if (hits.length === 1) {
        problems.push(`② 路径与目录不符：\`${rel}\` 里的 [[${link.target}]] → 现在它在 \`${hits[0]}\`（跑 rewrite-links.mjs 修）`);
      } else if (hits.length > 1) {
        problems.push(`② 路径与目录不符：\`${rel}\` 里的 [[${link.target}]] → 同名有 ${hits.length} 处，得人来定`);
      } else {
        problems.push(`① 悬空链接：\`${rel}\` 里的 [[${link.target}]] 找不到目标`);
      }
    }
  }

  // ---------- ③ 分类与配置 ----------
  const c = readJson(join(root, SYS, 'config.json'));
  if (!c.ok) {
    problems.push(`③ ${c.reason}`);
  } else {
    const cfg = c.data;
    const field = cfg?.['分类']?.['字段'] || '分类';
    const sep = cfg?.['分类']?.['分隔符'] || '/';
    const levels = cfg?.['分类']?.['层级'] || [];
    const values = cfg?.['分类']?.['类值'] || {};
    if (cfg['schema_version'] && cfg['schema_version'] !== EXPECTED_SCHEMA) {
      problems.push(`③ config.schema_version = ${cfg['schema_version']}，本套脚本按 ${EXPECTED_SCHEMA} 跑 —— 需要迁移`);
    }
    for (const [name, p] of collectNotes(root)) {
      const n = readNote(root, name, p, cfg);
      notes.push(n);
      if (!n.分类.length) {
        problems.push(`③ 「${name}」的 \`${field}\` 是空的 —— 生成知识点时就该附上分类`);
        continue;
      }
      for (const parts of n.分类) {
        if (levels.length && parts.length !== levels.length) {
          problems.push(`③ 「${name}」的分类 \`${parts.join(sep)}\` 只有 ${parts.length} 层，配置里是 ${levels.length} 层`);
        }
        parts.forEach((v, i) => {
          const level = levels[i];
          if (!level) return;
          const list = (values[level] || []).map((x) => x['值'] ?? x);
          if (list.length && !list.includes(v)) {
            problems.push(`③ 「${name}」用的类值 \`${v}\` 没在 config 的「${level}」里声明`);
          }
        });
      }
    }
  }

  // ---------- ④ 图与笔记一致（同进程调用 graph.mjs 的 check；沙箱下不能起子进程） ----------
  const captured = [];
  const origLog = console.log;
  console.log = (...a) => captured.push(a.join(' '));
  let gcode = 1;
  try {
    gcode = checkGraphModule.check(root);
  } catch (err) {
    captured.push('❌ graph check 抛错：' + (err && err.message ? err.message : String(err)));
  } finally {
    console.log = origLog;
  }
  if (gcode !== 0) {
    const lines = captured.filter((l) => l.startsWith('❌'));
    if (lines.length) for (const l of lines) problems.push(`④ ${l}`);
    else problems.push(`④ 图校验没过：${captured.find((l) => l.trim()) || '（无输出）'}`);
  }

  // ---------- ⑤ 账本 / 错误原因引用 ----------
  const known = new Set(notes.map((n) => n.name));
  const led = readJsonl(join(root, SYS, 'ledger.jsonl'));
  if (led.ok) {
    for (const r of led.rows) {
      const name = r['知识点'];
      if (name && !known.has(name)) problems.push(`⑤ 账本里的「${name}」找不到对应知识点`);
    }
  }
  const errs = readJsonl(join(root, SYS, 'errors.jsonl'));
  if (errs.ok) {
    for (const r of errs.rows) {
      const name = r['知识点'];
      if (name && !known.has(name)) problems.push(`⑤ 错误原因里的「${name}」找不到对应知识点`);
    }
  }

  // ---------- 输出 ----------
  console.log(`扫库：${root}`);
  console.log(
    `文件 ${mdFiles.length} 个 · 判定方式：${mode === 'git' ? 'git' : '哈希（这个库没有 git）'} · 没变过的 ${unchanged} 个${changedFiles.length ? ` · 变过的 ${changedFiles.length} 个` : ''} · 知识点 ${notes.length} 篇`
  );
  if (changedFiles.length) {
    console.log('');
    for (const f of changedFiles.slice(0, 20)) console.log(`· 变过：${f}${changedFiles.length > 20 ? '' : ''}`);
    if (changedFiles.length > 20) console.log(`· …还有 ${changedFiles.length - 20} 个`);
  }

  if (updateState) {
    writeJsonl(
      join(root, SYS, 'state.jsonl'),
      { kind: 'header', '用途': '本文件是状态表（变化检测）：有 git 时只记上次检查到的提交号；没有 git 时逐文件记内容哈希。管「要不要重看」，不管「发生过什么」（那是 git / changes.jsonl）。' },
      stateRows
    );
    console.log('（已更新 sys/state.jsonl）');
  }

  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`❌ ${p}`);
    console.log('');
    console.log(`未过：${problems.length} 个问题。`);
    return 1;
  }
  console.log('');
  console.log('✅ 五项全过：链接 / 路径 / 分类与配置 / 图与笔记 / 账本引用。');
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.log('❌ scan.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
