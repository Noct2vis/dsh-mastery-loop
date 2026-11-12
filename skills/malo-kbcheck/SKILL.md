---
name: malo-kbcheck
description: >-
  只读体检知识库：结构齐不齐、关系图与链接坏没坏、有没有新/改/删的材料、库版本配不配当前技能。
  用在「体检」「检查知识库」「库还好吗」「有没有新文件」时。**不写任何文件**；要入库请用 /malo-intake。
---

# malo-kbcheck —— 知识库体检（只读）

**这个 skill 不写盘。** 只回答四件事：建好了吗、坏了什么、有哪些新文件、版本对不对。

## 0 · 硬规矩

- 不跑 `scan.mjs --update-state`，不动 `state.jsonl` / `config.json` / 笔记 / 图。
- 删除的文件只报，不处理。
- 版本不一致就停，不在本 skill 里迁移。

## 1 · 版本闸（第一步）

读 `sys/config.json` 的 `schema_version`，与 `../_shared/scripts/_lib.mjs` 里的 `LIB_VERSION` 比：

- **相等** → 继续；
- **库版本 < 技能版本** → **停**。输出：
  `库版本 X，技能版本 Y。按 CHANGELOG 的「### 迁移」从 X 逐版升到 Y，完成后再体检。`
- **库版本 > 技能版本** → **停**，提示先升级插件包。

## 2 · 四条只读命令

在知识库根目录跑：

```bash
node ../_shared/scripts/validate.mjs <根>        # 结构齐不齐
node ../_shared/scripts/graph.mjs  check <根>    # 图校验（v2：八项）
node ../_shared/scripts/scan.mjs   <根>          # 链接 / 分类 / 账本引用 / 归属；不带 --update-state
node ../_shared/scripts/review.mjs plan <根> --dry  # 可选：只看待重审候选（不写文件）
```

原样保留失败条目，不要改写成人话——下一个人要能按它定位。

## 3 · 新文件清单

**有 git**（`sys/state.jsonl` 的 `mode = "git"`）：

```bash
git -C <根> status --porcelain
git -C <根> diff --name-only <last>..HEAD     # last = state.jsonl 里的 last
```

**无 git**（`mode = "hash"`）：读 `state.jsonl` 的逐文件 `{path, hash}`，与当前文件哈希比对。

归成三类：**新增 / 修改 / 删除**。只列相对工作区根的路径。

## 4 · 报告

固定四块：

1. **版本**：库版本 / 技能版本 / 是否一致。
2. **结构与图**：`validate`、`graph check` 的失败条目原文。
3. **材料变动**：新增 / 修改 / 删除。
4. **下一步**：
   - 有新文件或修改 → `/malo-intake`；
   - 结构/图有问题 → 给出对应命令与条目；
   - 版本落后 → 指回 CHANGELOG 的迁移段。

## 5 · 收尾

不做任何修复。把报告交给用户，或交给下一个 skill。
