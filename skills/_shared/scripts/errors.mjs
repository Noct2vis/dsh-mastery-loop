#!/usr/bin/env node
// 错因查询 / 写入
//
// 用途：本脚本管 sys/errors.jsonl —— 按知识点查候选、按结构键去重写入。
//       判断「这条错因对不对、谓词选哪个、涉及哪篇」由 agent 做；本脚本只做机械比对。
// 契约正文：../templates.md（第十二节）
//
// 用法：
//   node errors.mjs query <工作区根> [--point <知识点>] [--predicate <谓词>] [--involves <知识点>]
//   node errors.mjs add   <工作区根> <records.jsonl>
//
// add 的输入：一行一条，字段见契约；同 (谓词, 涉及集合, 方面) 的记录只追加日期，不重写原文。

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SYS, readJsonl, writeJsonl, readIfPossible } from './_lib.mjs';

const PREDICATES = [
  'confuse', 'overgeneralize', 'misorder', 'omit',
  'invert', 'misapply', 'miscompute', 'notation', 'other',
];

const fileOf = (root) => join(root, SYS, 'errors.jsonl');

function keyOf(r) {
  const involves = [...new Set((r['涉及'] || []).map(String))].sort();
  return `${r['谓词']}\u0000${involves.join('|')}\u0000${r['方面'] || ''}`;
}

function fmt(r) {
  const inv = (r['涉及'] || []).length ? ` ↔ ${r['涉及'].join('、')}` : '';
  const dates = (r['日期'] || []).join(', ');
  return `- [${r['谓词'] || '?'}] ${r['知识点']}${inv} · ${r['方面'] || '—'}\n    ${r['错误原因']}\n    ${dates}`;
}

function cmdQuery(root, opts) {
  const f = fileOf(root);
  const data = readJsonl(f);
  if (!data.ok) {
    console.log(`❌ ${data.reason}`);
    return 1;
  }
  const rows = data.rows.filter((r) => r.kind === 'error');
  const hit = rows.filter((r) => {
    if (opts.point && r['知识点'] !== opts.point && !(r['涉及'] || []).includes(opts.point)) return false;
    if (opts.predicate && r['谓词'] !== opts.predicate) return false;
    if (opts.involves && !(r['涉及'] || []).includes(opts.involves)) return false;
    return true;
  });
  console.log(`候选 ${hit.length} 条（共 ${rows.length} 条）`);
  if (opts.point) {
    const own = hit.filter((r) => r['知识点'] === opts.point).length;
    console.log(`  其中挂在「${opts.point}」下 ${own} 条，涉及它 ${hit.length - own} 条`);
  }
  for (const r of hit) console.log(fmt(r));
  return 0;
}

function cmdAdd(root, recordsPath) {
  const f = fileOf(root);
  const data = readJsonl(f);
  if (!data.ok) {
    console.log(`❌ ${data.reason}`);
    return 1;
  }
  const text = readIfPossible(resolve(recordsPath));
  if (text === null) {
    console.log(`❌ 读不了更新文件：${recordsPath}`);
    return 1;
  }
  const incoming = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (!incoming.length) {
    console.log('❌ 没有可写入的记录');
    return 1;
  }

  const byKey = new Map();
  for (const r of data.rows) if (r.kind === 'error') byKey.set(keyOf(r), r);

  let added = 0;
  let merged = 0;
  for (const r of incoming) {
    if (!PREDICATES.includes(r['谓词'])) {
      console.log(`⚠️  跳过：谓词非法「${r['谓词']}」—— ${r['错误原因'] || ''}`);
      continue;
    }
    const rec = {
      kind: 'error',
      '知识点': r['知识点'],
      '谓词': r['谓词'],
      '涉及': [...new Set((r['涉及'] || []).map(String))],
      '方面': r['方面'] || '',
      '错误原因': r['错误原因'],
      '中文': r['中文'] || '',
      '日期': [...new Set((r['日期'] || []).map(String))].sort(),
      '来源': r['来源'] || '',
    };
    const k = keyOf(rec);
    const old = byKey.get(k);
    if (old) {
      old['日期'] = [...new Set([...(old['日期'] || []), ...rec['日期']])].sort();
      merged++;
    } else {
      data.rows.push(rec);
      byKey.set(k, rec);
      added++;
    }
  }

  writeJsonl(f, data.header || { kind: 'header', '用途': '本文件是错误原因表。' }, data.rows);
  console.log(`已写回：新增 ${added} 条，合并日期 ${merged} 条（共 ${data.rows.filter((r) => r.kind === 'error').length} 条）。`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1).filter((a) => !a.startsWith('--'));
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
  };

  if (!['query', 'add'].includes(cmd)) {
    console.log('用法：');
    console.log('  node errors.mjs query <工作区根> [--point X] [--predicate P] [--involves Y]');
    console.log('  node errors.mjs add   <工作区根> <records.jsonl>');
    return 2;
  }
  const root = resolve(rest[0] || '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 1;
  }
  if (cmd === 'query') {
    return cmdQuery(root, { point: opt('--point'), predicate: opt('--predicate'), involves: opt('--involves') });
  }
  return cmdAdd(root, rest[1]);
}

try {
  process.exit(main());
} catch (err) {
  console.log('❌ errors.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
