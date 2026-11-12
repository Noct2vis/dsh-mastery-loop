#!/usr/bin/env node
// 重写链接脚本
//
// 用途：本脚本把「路径变了但链接没跟着改」的 wikilink 修回当前路径（名字唯一才敢改，重名的一律留给人）。
// 契约正文：../templates.md（第二、七节）
//
// 用法：
//   node rewrite-links.mjs <工作区根>            # 只列建议（不写盘）
//   node rewrite-links.mjs <工作区根> --apply    # 真写

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readIfPossible, writeText, walkMarkdown, parseLinks } from './_lib.mjs';

function main() {
  const argv = process.argv.slice(2);
  const root = resolve(argv.find((a) => !a.startsWith('--')) || '.');
  const apply = argv.includes('--apply');

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 2;
  }

  const files = walkMarkdown(root, '.');
  const rels = files.map((p) => p.slice(root.length + 1).split('\\').join('/'));
  const relSet = new Set(rels);
  const byBase = new Map();
  for (const rel of rels) {
    const base = rel.split('/').pop().replace(/\.md$/i, '');
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(rel);
  }

  let planned = 0;
  let written = 0;

  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    const rel = rels[i];
    const text = readIfPossible(path);
    if (text === null) continue;

    let next = text;
    let touched = false;
    for (const link of parseLinks(text)) {
      const t = link.target.replace(/^\.\//, '');
      if (relSet.has(t) || relSet.has(t + '.md')) continue;
      const base = t.split('/').pop().replace(/\.md$/i, '');
      const hits = byBase.get(base) || [];
      if (hits.length !== 1) continue;
      const fixed = hits[0].endsWith('.md') ? hits[0] : hits[0] + '.md';
      const before = link.alias ? `[[${link.target}|${link.alias}]]` : `[[${link.target}]]`;
      const after = link.alias ? `[[${fixed}|${link.alias}]]` : `[[${fixed}]]`;
      if (!next.includes(before)) continue;
      next = next.replace(before, after);
      touched = true;
      planned++;
      console.log(`${apply ? '改写' : '建议'}：${rel}\n    ${before}  →  ${after}`);
    }
    if (touched && apply && next !== text) {
      writeText(path, next);
      written++;
    }
  }

  console.log('');
  if (!planned) {
    console.log('✅ 没有需要重写的链接。');
    return 0;
  }
  console.log(apply ? `已写 ${written} 个文件、改 ${planned} 处链接。` : `共 ${planned} 处可自动修（加 --apply 才写盘；重名的链接已跳过）。`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.log('❌ rewrite-links.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
