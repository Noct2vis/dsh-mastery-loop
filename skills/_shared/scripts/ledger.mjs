#!/usr/bin/env node
// 账本脚本
//
// 用途：本脚本管 sys/ledger.jsonl（复习账本，真值）—— 算达标、按 60/30/10 划范围清单、把批改结果写回。
// 契约正文：../templates.md（第十一节）
//
// 用法：
//   node ledger.mjs stats <工作区根> [--scope 深度学习/L3] [--target 0.9]
//   node ledger.mjs pick  <工作区根> [--scope …] [--target 0.9] [--n 20]
//   node ledger.mjs write <工作区根> <updates.jsonl>
//   node ledger.mjs add   <工作区根> <new-points.jsonl>
//
// write 的输入：一行一条 {"知识点":"梯度","做对":1,"总共出过":1,"是否学习过":true,"最后复习日期":"2026-10-15"}
//   其中 做对 / 总共出过 按**增量**累加；熟练程度自动 = (做对+0.5)/(总共出过+1)（Jeffreys）。

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYS, NOTES, readJson, readJsonl, writeJsonl, collectNotes, readNote, readIfPossible } from './_lib.mjs';

function load(root) {
  const cfg = readJson(join(root, SYS, 'config.json'));
  const led = readJsonl(join(root, SYS, 'ledger.jsonl'));
  if (!led.ok) return { err: led.reason };
  const notes = new Map();
  for (const [name, p] of collectNotes(root)) {
    const n = readNote(root, name, p, cfg.ok ? cfg.data : null);
    notes.set(name, n.分类);
  }
  return { cfg: cfg.ok ? cfg.data : null, header: led.header, rows: led.rows, classes: notes };
}

function inScope(classes, scopeParts) {
  if (!scopeParts) return true;
  const list = classes || [];
  return list.some((parts) => {
    if (parts.length < scopeParts.length) return false;
    return scopeParts.every((s, i) => parts[i] === s);
  });
}

function proficiency(row) {
  const done = Number(row['总共出过'] || 0);
  const right = Number(row['做对'] || 0);
  if (!done) return null;
  // Jeffreys 估计：4/4 = 90%，3/4 = 70%，1/1 = 75%。
  return Math.round(((right + 0.5) / (done + 1)) * 1000) / 1000;
}

/** 达标只看 Jeffreys 熟练度；样本不足只是展示，不是独立判据。 */
function flag(row, target) {
  const p = proficiency(row);
  if (p !== null && p >= target) return '达标';
  return '未达标';
}

function cmdStats(root, scopeParts, target) {
  const L = load(root);
  if (L.err) {
    console.log(`❌ ${L.err}`);
    return 1;
  }
  const rows = L.rows.filter((r) => inScope(L.classes.get(r['知识点']), scopeParts));
  console.log(`范围：${scopeParts ? scopeParts.join('/') : '全库'} · 知识点 ${rows.length} 个 · 目标正确率 ${target}`);
  console.log('');
  let ok = 0;
  let thin = 0;
  let bad = 0;
  for (const r of rows) {
    const done = Number(r['总共出过'] || 0);
    const f = flag(r, target);
    if (f === '达标') ok++;
    else bad++;
    if (done < 3) thin++;
    const p = proficiency(r);
    console.log(
      `- ${r['知识点']} · 出过 ${r['总共出过'] ?? 0} · 做对 ${r['做对'] ?? 0} · 熟练程度 ${p === null ? 'NULL' : p} · ${f}` +
        (r['最后复习日期'] ? ` · 最后 ${r['最后复习日期']}` : '') +
        (done < 3 ? ' · 样本不足' : '')
    );
  }
  console.log('');
  console.log(`达标 ${ok} · 未达标 ${bad} · 其中样本不足 ${thin}`);
  return 0;
}

function cmdPick(root, scopeParts, target, n) {
  const L = load(root);
  if (L.err) {
    console.log(`❌ ${L.err}`);
    return 1;
  }
  const rows = L.rows.filter((r) => inScope(L.classes.get(r['知识点']), scopeParts));
  const weakest = [...rows].sort((a, b) => {
    const pa = proficiency(a);
    const pb = proficiency(b);
    if (pa === null && pb === null) return Number(a['总共出过'] || 0) - Number(b['总共出过'] || 0);
    if (pa === null) return -1;
    if (pb === null) return 1;
    return pa - pb;
  });
  const never = rows.filter((r) => r['是否学习过'] !== true);
  const oldest = [...rows]
    .filter((r) => r['最后复习日期'])
    .sort((a, b) => String(a['最后复习日期']).localeCompare(String(b['最后复习日期'])));

  const total = n || rows.length;
  const nA = Math.round(total * 0.6);
  const nB = Math.round(total * 0.3);
  const nC = Math.max(0, total - nA - nB);

  const chosen = [];
  const seen = new Set();
  const take = (list, k, label) => {
    for (const r of list) {
      if (chosen.length >= total) return;
      if (k <= 0) return;
      const key = r['知识点'];
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push({ ...r, bucket: label });
      k--;
    }
  };
  take(weakest, nA, '60% 熟练度最低');
  take(never, nB, '30% 没学过');
  take(oldest.length ? oldest : weakest, nC, '10% 最久没碰');
  take(weakest, total, '补齐');

  console.log(`本次范围：${scopeParts ? scopeParts.join('/') : '全库'} · 目标正确率 ${target} · 题量 ${total}`);
  console.log('');
  let last = '';
  for (const r of chosen) {
    if (r.bucket !== last) {
      console.log(`## ${r.bucket}`);
      last = r.bucket;
    }
    const p = proficiency(r);
    console.log(`- ${r['知识点']}　（出过 ${r['总共出过'] ?? 0} · 做对 ${r['做对'] ?? 0} · 熟练程度 ${p === null ? 'NULL' : p}）`);
  }
  return 0;
}

function cmdWrite(root, updatesPath) {
  const L = load(root);
  if (L.err) {
    console.log(`❌ ${L.err}`);
    return 1;
  }
  const text = readIfPossible(resolve(updatesPath));
  if (text === null) {
    console.log(`❌ 读不了更新文件：${updatesPath}`);
    return 1;
  }
  const updates = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const byName = new Map(L.rows.map((r) => [r['知识点'], r]));
  let changed = 0;
  for (const u of updates) {
    const row = byName.get(u['知识点']);
    if (!row) {
      console.log(`⚠️  账本里没有「${u['知识点']}」（跳过）`);
      continue;
    }
    if (u['做对'] !== undefined) row['做对'] = Number(row['做对'] || 0) + Number(u['做对']);
    if (u['总共出过'] !== undefined) row['总共出过'] = Number(row['总共出过'] || 0) + Number(u['总共出过']);
    if (u['是否学习过'] !== undefined) row['是否学习过'] = u['是否学习过'] === true;
    if (u['最后复习日期'] !== undefined) row['最后复习日期'] = u['最后复习日期'];
    const p = proficiency(row);
    row['熟练程度'] = p === null ? null : p;
    changed++;
  }

  writeJsonl(join(root, SYS, 'ledger.jsonl'), L.header || { kind: 'header', '用途': '本文件是复习账本：逐条记每个知识点的复习统计。' }, L.rows);
  console.log(`已写回 ${changed} 行（共 ${L.rows.length} 行）。`);
  return 0;
}

function cmdAdd(root, rowsPath) {
  const L = load(root);
  if (L.err) {
    console.log(`❌ ${L.err}`);
    return 1;
  }
  const text = readIfPossible(resolve(rowsPath));
  if (text === null) {
    console.log(`❌ 读不了新增文件：${rowsPath}`);
    return 1;
  }
  const incoming = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const byName = new Map(L.rows.map((r) => [r['知识点'], r]));
  let added = 0;
  let skipped = 0;
  for (const u of incoming) {
    const name = u['知识点'];
    if (!name) continue;
    if (byName.has(name)) {
      skipped++;
      continue;
    }
    const row = {
      '知识点': name,
      '是否学习过': u['是否学习过'] === true,
      '做对': 0,
      '总共出过': 0,
      '熟练程度': null,
      '最后复习日期': u['最后复习日期'] ?? null,
    };
    L.rows.push(row);
    byName.set(name, row);
    added++;
  }
  writeJsonl(join(root, SYS, 'ledger.jsonl'), L.header || { kind: 'header', '用途': '本文件是复习账本：逐条记每个知识点的复习统计。' }, L.rows);
  console.log(`账本新增 ${added} 行，跳过已存在 ${skipped} 行（共 ${L.rows.length} 行）。`);
  return 0;
}

function cmdNext(root, scopeParts, n) {
  const L = load(root);
  if (L.err) {
    console.log(`❌ ${L.err}`);
    return 1;
  }
  const layers = readJson(join(root, SYS, 'layers.json'));
  if (!layers.ok) {
    console.log(`❌ ${layers.reason}`);
    console.log('   先跑：node graph.mjs check <工作区根> --layers --write');
    return 1;
  }
  const data = layers.data;
  const rows = new Map(L.rows.map((r) => [r['知识点'], r]));
  const limit = n > 0 ? n : 5;
  const out = [];
  let total = 0;
  for (const [depth, names] of (data.layers || []).entries()) {
    for (const name of names) {
      const row = rows.get(name);
      if (row && row['是否学习过'] === true) continue;
      if (scopeParts && !inScope(L.classes.get(name), scopeParts)) continue;
      total++;
      if (out.length < limit) out.push({ name, depth, row });
    }
  }
  console.log(
    `按层序的下一个：候选 ${total} 个，显示 ${out.length} 个${scopeParts ? `（范围 ${scopeParts.join('/')}）` : ''}`
  );
  for (const o of out) {
    const cls = (L.classes.get(o.name) || []).map((p) => p.join('/')).join(' | ') || '无分类';
    console.log(`- 层 ${o.depth} · ${o.name} · ${cls}${o.row ? '' : '（账本无此行）'}`);
  }
  if (!total) console.log('✅ 范围内都学过了。');
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1).filter((a) => !a.startsWith('--'));
  const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
  };

  if (!['stats', 'pick', 'write', 'add', 'next'].includes(cmd)) {
    console.log('用法：');
    console.log('  node ledger.mjs stats <工作区根> [--scope 深度学习/L3] [--target 0.9]');
    console.log('  node ledger.mjs pick  <工作区根> [--scope …] [--target 0.9] [--n 20]');
    console.log('  node ledger.mjs write <工作区根> <updates.jsonl>');
    console.log('  node ledger.mjs add   <工作区根> <new-points.jsonl>');
    console.log('  node ledger.mjs next  <工作区根> [--scope …] [--n 5]');
    return 2;
  }

  const root = resolve(rest[0] || '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log(`❌ 工作区根不存在：${root}`);
    return 1;
  }
  const scope = opt('--scope', '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const target = Number(opt('--target', '0.9')) || 0.9;

  if (cmd === 'stats') return cmdStats(root, scope.length ? scope : null, target);
  if (cmd === 'pick') return cmdPick(root, scope.length ? scope : null, target, Number(opt('--n', '0')) || 0);
  if (cmd === 'add') return cmdAdd(root, rest[1]);
  if (cmd === 'next') return cmdNext(root, scope.length ? scope : null, Number(opt('--n', '5')) || 5);
  return cmdWrite(root, rest[1]);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (err) {
    console.log('❌ ledger.mjs 自身出错：' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
}

export { cmdNext };
