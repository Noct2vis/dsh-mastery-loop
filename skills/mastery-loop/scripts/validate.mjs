#!/usr/bin/env node
// mastery-loop 初始化校验
//
// 用法：node validate.mjs <知识库根目录>
//
// 判据（票 18 M4）：知识库根目录下 6 个固定文件名都在 = 初始化完成。
// 硬要求：**永远不要崩溃** —— 干净目录上应当报「6 个全缺」并以退出码 1 结束。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = [
  { name: 'ledger.md', label: '复习账本', required: true },
  { name: 'index.md', label: '反向索引', required: true },
  { name: 'errors.md', label: '错误原因表', required: true },
  { name: 'paper-format.md', label: '卷子格式', required: true },
  { name: 'error-taxonomy.md', label: '失分原因分类', required: true },
  { name: 'config.md', label: '配置', required: true },
];

function readIfPossible(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 每个文件一点结构检查；返回问题列表（空 = 通过） */
function inspect(name, text) {
  const problems = [];
  if (text === null) return problems;

  if (name === 'ledger.md') {
    if (!/首次对齐/.test(text)) problems.push('缺少「首次对齐」标记行 —— 初始化未完成');
    if (!/\|\s*知识点\s*\|/.test(text)) problems.push('缺少账本表头（`知识点 / 是否学习过 / …`）');
  }

  if (name === 'index.md') {
    if (!/^#\s/m.test(text)) problems.push('缺少 H1 标题');
  }

  if (name === 'errors.md') {
    if (!/^#\s/m.test(text)) problems.push('缺少 H1 标题');
  }

  if (name === 'paper-format.md') {
    const courses = (text.match(/^##\s+(?!没有往年卷)/gm) || []).length;
    if (courses === 0) problems.push('还没有任何课程条目（每个课程的每个考试各一条）');
  }

  if (name === 'config.md') {
    if (!/材料根目录/.test(text)) problems.push('缺少「材料根目录」');
    if (!/知识库根目录/.test(text)) problems.push('缺少「知识库根目录」');
    if (/<绝对路径>/.test(text)) problems.push('路径还是占位符，没填');
  }

  // error-taxonomy.md 初始为空是对的 —— 不检查内容

  return problems;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('用法：node validate.mjs <知识库根目录>');
    process.exit(2);
  }

  const root = resolve(arg);
  console.log('校验知识库根目录：' + root);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.log('❌ 这个目录不存在，或不是目录。');
    process.exit(1);
  }

  let missing = 0;
  let problematic = 0;

  for (const f of FILES) {
    const path = join(root, f.name);
    let text = null;

    if (!existsSync(path)) {
      console.log(`❌ ${f.name}  —— 缺失（${f.label}）`);
      missing++;
      continue;
    }

    text = readIfPossible(path);
    if (text === null) {
      console.log(`❌ ${f.name}  —— 存在但读不了`);
      problematic++;
      continue;
    }

    const problems = inspect(f.name, text);
    if (problems.length === 0) {
      console.log(`✅ ${f.name}  —— ${f.label}`);
    } else {
      console.log(`⚠️  ${f.name}  —— ${f.label}`);
      for (const p of problems) console.log(`      · ${p}`);
      problematic++;
    }
  }

  console.log('');
  if (missing === 0 && problematic === 0) {
    console.log('✅ 初始化已完成：6 个文件都在。');
    process.exit(0);
  }

  console.log(`未完成：缺 ${missing} 个、有问题的 ${problematic} 个。`);
  console.log('跑一遍 `mastery-loop-setup` 补齐。');
  process.exit(1);
}

try {
  main();
} catch (err) {
  // 无论如何都不要崩
  console.log('❌ 校验脚本自身出错：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
