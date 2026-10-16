#!/usr/bin/env node
// 聚合脚本
//
// 用途：本脚本把知识点**按 `分类` 字段聚合**成 kb/MOC/ 下的机器区（只写 AUTO 区，手写区永不碰）。
// 契约正文：../templates.md（第一、五节）
//
// 用法：node aggregate.mjs <工作区根> [--scope <类路径>] [--dry]
//
// 只做聚合：不写待办、不产报告。

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SYS, MOC, AUTO_BEGIN, AUTO_END, readJson, readIfPossible, writeText,
  collectNotes, readNote, replaceAutoZone,
} from './_lib.mjs';

const SKELETON = (title) =>
  `# ${title}\n\n> 本文件是聚合产物：机器区由 \`aggregate.mjs\` 从知识点的 \`分类\` 生成并覆盖；手写区脚本永不碰。\n\n` +
  `${AUTO_BEGIN}\n_（还没聚合）_\n${AUTO_END}\n\n## 主线（手写区）\n\n`;

function declaredValues(cfg) {
  const levels = (cfg?.['分类']?.['层级']) || [];
  const values = cfg?.['分类']?.['类值'] || {};
  return { levels, values };
}

function main() {
  const argv = process.argv.slice(2);
  const root = resolve(argv.find((a) => !a.startsWith('--')) || '.');
  const dry = argv.includes('--dry');
  const si = argv.indexOf('--scope');
  const scope = si !== -1 && argv[si + 1] ? argv[si + 1].split('/').map((s) => s.trim()).filter(Boolean) : null;
  const sep = '/';

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 2;
  }

  const c = readJson(join(root, SYS, 'config.json'));
  if (!c.ok) {
    console.log(`❌ ${c.reason}`);
    return 1;
  }
  const cfg = c.data;
  const { levels, values } = declaredValues(cfg);

  const notes = [...collectNotes(root)].map(([name, p]) => readNote(root, name, p, cfg));

  // 组节点：key = 类路径
  const nodes = new Map();
  const touch = (parts) => {
    const key = parts.join(sep);
    if (!nodes.has(key)) nodes.set(key, { parts, notes: [], children: new Set() });
    return nodes.get(key);
  };
  const declaredOnly = (partList) => {
    // config 里声明过的类值也算节点（哪怕是空的）
    let cur = [];
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      for (const v of values[level] || []) {
        const parts = [...cur, v['值']];
        touch(parts);
        if (cur.length) touch(cur).children.add(parts.join(sep));
      }
      // 下一层的 cur 只有一条链时没法枚举；这里只铺第一层
      if (i === 0) break;
    }
  };
  declaredOnly();

  for (const n of notes) {
    if (!n.分类.length) continue;
    for (const parts of n.分类) {
      const trimmed = levels.length ? parts.slice(0, levels.length) : parts;
      const node = touch(trimmed);
      node.notes.push(n);
      for (let i = 1; i <= trimmed.length; i++) {
        const parent = trimmed.slice(0, i - 1);
        if (parent.length) touch(parent).children.add(trimmed.slice(0, i).join(sep));
      }
    }
  }

  const inScope = (key) =>
    !scope || key === scope.join(sep) || key.startsWith(scope.join(sep) + sep);

  const depth = (n) => n.parts.length;
  const leafDepth = Math.max(1, levels.length);

  let written = 0;
  let created = 0;

  const writeOne = (rel, title, lines) => {
    const path = join(root, rel);
    const existed = existsSync(path);
    const text = existed ? readIfPossible(path) : null;
    const next = replaceAutoZone(text === null ? SKELETON(title) : text, lines);
    if (next === text) return;
    written++;
    if (!existed) created++;
    if (!dry) writeText(path, next);
  };

  // 全库总览（只有不带 scope 时才写）
  if (!scope) {
    const firstKeys = [...nodes.keys()].filter((k) => nodes.get(k).parts.length === 1).sort();
    const lines = firstKeys.map((k) => {
      const n = nodes.get(k);
      const rel = `kb/MOC/${n.parts[0]}/00 ${n.parts[0]}（索引）.md`;
      return `- [[${rel}|${n.parts[0]}]] —— ${n.notes.length} 个知识点`;
    });
    writeOne(join(MOC, '00 总览.md'), '总览（全库）', lines.length ? lines : ['_（还没有任何分类）_']);
  }

  for (const [key, node] of nodes) {
    if (!inScope(key)) continue;
    const d = depth(node);
    const dir = join(MOC, ...node.parts);
    const isLeaf = d >= leafDepth;
    const title = `${node.parts[node.parts.length - 1]}（${isLeaf ? 'MOC' : '索引'}）`;
    const rel = join(dir, `00 ${node.parts[node.parts.length - 1]}（${isLeaf ? 'MOC' : '索引'}）.md`);

    let lines;
    if (isLeaf) {
      lines = node.notes
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        .map((n) => `- [[${n.rel}|${n.name}]]${n.一句话 ? ` —— ${n.一句话}` : ''}`);
      if (!lines.length) lines = ['_（这一讲还没有知识点）_'];
    } else {
      const kids = [...node.children].sort();
      lines = kids.map((k) => {
        const child = nodes.get(k);
        const name = k.split(sep).pop();
        const childLeaf = child.parts.length >= leafDepth;
        const childRel = `kb/MOC/${child.parts.join('/')}/00 ${name}（${childLeaf ? 'MOC' : '索引'}）.md`;
        return `- [[${childRel}|${name}]] —— ${child.notes.length} 个知识点`;
      });
      if (!lines.length) lines = ['_（还没有下一层）_'];
    }
    writeOne(rel, title, lines);
  }

  console.log(`聚合完成：${nodes.size} 个类节点 · ${dry ? '试算' : '已写'} ${written} 个文件（新建 ${created}）。`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.log('❌ aggregate.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
