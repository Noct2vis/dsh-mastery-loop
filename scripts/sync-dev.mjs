#!/usr/bin/env node
// 把开发副本（<repo>/.dsh/skills/）同步进发布包（<pkg>/skills/）。
//
// 为什么是「同步」而不是直接发布 .dsh/skills：
//   · `.dsh/skills/` 是**开发副本** —— DSH 会扫它，所以本地改完立刻能加载验证
//   · `skills/` 是**发布快照** —— npm 的 `files` 字段只能打包包内文件，没法引用包外
// 单一事实来源 = `.dsh/skills/`；跑本脚本即为「出包」。
//
// 用法：npm run sync

import { cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');

const SRC = join(repoRoot, '.dsh', 'skills');
const DST = join(pkgRoot, 'skills');

const SKILLS = ['mastery-loop', 'mastery-loop-setup'];

if (!existsSync(SRC)) {
  console.error('❌ 找不到开发副本：' + SRC);
  process.exit(1);
}

// 整目录重建，避免删掉的东西留在包里
rmSync(DST, { recursive: true, force: true });

let copied = 0;
for (const name of SKILLS) {
  const from = join(SRC, name);
  if (!existsSync(from)) {
    console.error(`❌ 开发副本里没有 ${name} —— 先把它建出来`);
    process.exit(1);
  }
  cpSync(from, join(DST, name), { recursive: true });
  copied++;
}

console.log(`✅ 同步完成：${copied} 个 skill → ${DST}`);
for (const name of SKILLS) {
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else files.push(rel);
    }
  };
  walk(join(DST, name));
  console.log(`   ${name}/  (${files.length} 文件)`);
  for (const f of files) console.log(`      ${f}`);
}

console.log('\n下一步：npm pack --dry-run 看清单，再 npm publish');
