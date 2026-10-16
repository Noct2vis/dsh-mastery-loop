#!/usr/bin/env node
// mastery-loop 结构校验
//
// 用途：本脚本是结构校验器 —— 查 kb/ 与 sys/ 是否按契约建齐。
// 契约正文：../templates.md （第一节「库的布局」）
//
// 用法：node validate.mjs <工作区根>
//
// 硬要求：**永远不要崩溃** —— 干净目录上应报「全缺」并以退出码 1 结束。

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const KB_FILES = [
  { rel: 'kb/knowledge', kind: 'dir', label: '知识点笔记目录' },
  { rel: 'kb/MOC', kind: 'dir', label: '聚合产物目录' },
];

const SYS_FILES = [
  { rel: 'sys/config.json', kind: 'json', label: '设定（路径 / 分类 / 语言）' },
  { rel: 'sys/graph.json', kind: 'json', label: '关系图' },
  { rel: 'sys/ledger.jsonl', kind: 'jsonl', label: '账本（真值）' },
  { rel: 'sys/errors.jsonl', kind: 'jsonl', label: '错误原因表' },
  { rel: 'sys/error-taxonomy.json', kind: 'json', label: '失分原因分类' },
  { rel: 'sys/paper-format.json', kind: 'json', label: '卷面参数' },
  { rel: 'sys/state.jsonl', kind: 'jsonl', label: '状态（哈希）' },
];

function readIfPossible(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function countNotes(dir) {
  let n = 0;
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
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
      else if (/\.md$/i.test(e.name)) n++;
    }
  };
  walk(dir, 0);
  return n;
}

/** 返回问题列表（空 = 通过） */
function inspect(rel, kind) {
  const problems = [];
  const path = rel;
  const text = readIfPossible(path);

  if (kind === 'json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      problems.push(`不是合法 JSON：${err.message}`);
      return problems;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      problems.push('顶层不是对象');
      return problems;
    }
    if (!data['用途']) problems.push('缺「用途」字段（每个文件开头要有一句「这个文件是干什么的」）');
    if (rel.endsWith('config.json')) {
      if (!data['分类'] || !Array.isArray(data['分类']?.['层级']) || data['分类']['层级'].length === 0) {
        problems.push('缺「分类.层级」—— 分类是全库级定义，必填');
      }
      if (!data['路径'] || !data['路径']['知识库']) problems.push('缺「路径.知识库」');
    }
    if (rel.endsWith('graph.json')) {
      if (!Array.isArray(data['edges'])) problems.push('缺「edges」数组');
      if (!data['规则']) problems.push('缺「规则」字段（前置判据）');
    }
  }

  if (kind === 'jsonl') {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) {
      problems.push('空文件 —— 至少要有一行 header');
      return problems;
    }
    let head = null;
    try {
      head = JSON.parse(lines[0]);
    } catch (err) {
      problems.push(`第一行不是合法 JSON：${err.message}`);
    }
    if (head && head.kind !== 'header') problems.push('第一行不是 `{"kind":"header","用途":"…"}` 头部记录');
    if (head && !head['用途']) problems.push('头部记录缺「用途」');
    for (let i = 1; i < lines.length; i++) {
      try {
        JSON.parse(lines[i]);
      } catch (err) {
        problems.push(`第 ${i + 1} 行不是合法 JSON：${err.message}`);
        break;
      }
    }
  }

  return problems;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('用法：node validate.mjs <工作区根>');
    process.exit(2);
  }

  const root = resolve(arg);
  console.log('校验工作区根：' + root);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log('❌ 这个目录不存在，或不是目录。');
    process.exit(1);
  }

  let missing = 0;
  let problematic = 0;

  const dirs = [...KB_FILES, ...SYS_FILES].filter((f) => f.kind === 'dir');
  const files = [...KB_FILES, ...SYS_FILES].filter((f) => f.kind !== 'dir');

  for (const f of dirs) {
    const p = join(root, f.rel);
    if (!existsSync(p) || !statSync(p).isDirectory()) {
      console.log(`❌ ${f.rel}/  —— 缺失（${f.label}）`);
      missing++;
    } else if (f.rel === 'kb/knowledge') {
      const n = countNotes(p);
      console.log(`✅ ${f.rel}/  —— ${f.label}（${n} 篇知识点）`);
    } else {
      console.log(`✅ ${f.rel}/  —— ${f.label}`);
    }
  }

  for (const f of files) {
    const p = join(root, f.rel);
    if (!existsSync(p)) {
      console.log(`❌ ${f.rel}  —— 缺失（${f.label}）`);
      missing++;
      continue;
    }
    const problems = inspect(p, f.kind);
    if (!problems.length) {
      console.log(`✅ ${f.rel}  —— ${f.label}`);
    } else {
      console.log(`⚠️  ${f.rel}  —— ${f.label}`);
      for (const pr of problems) console.log(`      · ${pr}`);
      problematic++;
    }
  }

  console.log('');
  if (missing === 0 && problematic === 0) {
    console.log('✅ 结构齐：kb/ 与 sys/ 都按契约建好了。');
    process.exit(0);
  }
  console.log(`未完成：缺 ${missing} 个、有问题的 ${problematic} 个。`);
  console.log('跑一遍 `mastery-loop-setup` 补齐。');
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.log('❌ 校验脚本自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
