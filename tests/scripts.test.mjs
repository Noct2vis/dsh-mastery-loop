import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'skills', '_shared', 'scripts');
const load = (f) => import(pathToFileURL(join(SCRIPTS, f)).href);
const { check } = await load('graph.mjs');
const { cmdNext } = await load('ledger.mjs');
const { plan, mark } = await load('review.mjs');

function kb(files) {
  const root = mkdtempSync(join(HERE, '.tmp-'));
  mkdirSync(join(root, 'kb', 'knowledge'), { recursive: true });
  mkdirSync(join(root, 'sys'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'kb', 'knowledge', name + '.md'), text, 'utf8');
  return root;
}
const note = (pre, post = '_（暂无）_') =>
  `# X\n\n## 前置知识\n\n${pre}\n\n## 后置知识\n\n${post}\n`;
const graph = (edges, groups = []) =>
  JSON.stringify({ '用途': 't', '规则': 't', version: 2, coverage: { X: { done: ['A'], todo: [] } }, edges, groups });
const capture = (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const code = fn();
    return { code, text: lines.join('\n') };
  } finally {
    console.log = orig;
  }
};

test('graph: OR 组合法时通过', () => {
  const root = kb({
    A: note('_（暂无）_', '- [[kb/knowledge/B.md|B]]\n- [[kb/knowledge/C.md|C]]'),
    B: note('- [[kb/knowledge/A.md|A]] —— A', '- [[kb/knowledge/D.md|D]]'),
    C: note('- [[kb/knowledge/A.md|A]] —— A', '- [[kb/knowledge/D.md|D]]'),
    D: note('- [[kb/knowledge/B.md|B]] 或 [[kb/knowledge/C.md|C]]（任一） —— 任选'),
  });
  writeFileSync(join(root, 'sys', 'graph.json'), graph(
    [{ from: 'A', to: 'B', reason: 'A' }, { from: 'A', to: 'C', reason: 'A' }],
    [{ id: 'g1', to: 'D', mode: 'any', of: ['B', 'C'], reason: '任选' }]
  ));
  const { code, text } = capture(() => check(root));
  assert.equal(code, 0, text);
  rmSync(root, { recursive: true, force: true });
});

test('graph: 环被第 7 项抓到', () => {
  const root = kb({
    A: note('- [[kb/knowledge/C.md|C]] —— C', '- [[kb/knowledge/B.md|B]]'),
    B: note('- [[kb/knowledge/A.md|A]] —— A', '- [[kb/knowledge/C.md|C]]'),
    C: note('- [[kb/knowledge/B.md|B]] —— B', '- [[kb/knowledge/A.md|A]]'),
  });
  writeFileSync(join(root, 'sys', 'graph.json'), graph([
    { from: 'A', to: 'B', reason: 'A' },
    { from: 'B', to: 'C', reason: 'B' },
    { from: 'C', to: 'A', reason: 'C' },
  ]));
  const { code, text } = capture(() => check(root));
  assert.equal(code, 1);
  assert.match(text, /无环/);
  rmSync(root, { recursive: true, force: true });
});

test('ledger next: 按层序跳过已学', () => {
  const root = kb({
    One: note('_（暂无）_'),
    Two: note('- [[kb/knowledge/One.md|One]] —— One'),
  });
  writeFileSync(join(root, 'sys', 'layers.json'), JSON.stringify({ '用途': 't', depth: { One: 0, Two: 1 }, layers: [['One'], ['Two']], groups: [] }));
  writeFileSync(join(root, 'sys', 'ledger.jsonl'), [
    JSON.stringify({ kind: 'header', '用途': 't' }),
    JSON.stringify({ '知识点': 'One', '是否学习过': true, '做对': 1, '总共出过': 1, '熟练程度': 0.75, '最后复习日期': '2026-11-01' }),
    JSON.stringify({ '知识点': 'Two', '是否学习过': false, '做对': 0, '总共出过': 0, '熟练程度': null, '最后复习日期': null }),
  ].join('\n') + '\n');
  const { code, text } = capture(() => cmdNext(root, null, 5));
  assert.equal(code, 0, text);
  assert.match(text, /Two/);
  assert.doesNotMatch(text, /· One/);
  rmSync(root, { recursive: true, force: true });
});

test('review: mark 后同一批边不再进候选', () => {
  const root = kb({
    A: note('_（暂无）_', '- [[kb/knowledge/B.md|B]]'),
    B: note('- [[kb/knowledge/A.md|A]] —— A'),
  });
  writeFileSync(join(root, 'sys', 'graph.json'), graph([{ from: 'A', to: 'B', reason: 'A' }]));
  const first = capture(() => plan(root, ['plan', root, '--dry']));
  assert.match(first.text, /A → B/);
  const list = join(root, 'ok.txt');
  writeFileSync(list, 'A → B\n');
  assert.equal(capture(() => mark(root, ['mark', root, '--file', list])).code, 0);
  const g = JSON.parse(readFileSync(join(root, 'sys', 'graph.json'), 'utf8'));
  assert.ok(g.edges[0].reviewedAt && g.edges[0].fp);
  const again = capture(() => plan(root, ['plan', root, '--dry']));
  assert.doesNotMatch(again.text, /A → B/);
  rmSync(root, { recursive: true, force: true });
});
