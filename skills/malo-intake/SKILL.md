---
name: malo-intake
description: >-
  把新收录的课程材料入库：抽新知识点、修订旧知识点、补关系图边、加账本行、重聚合 MOC。
  用在 /malo-kbcheck 报出「新增/修改文件」之后，或用户说「我把 Week 4 放进去了」「这几篇笔记要入库」时。
  写盘前必须给清单确认。
---

# malo-intake —— 新文件入库

## 0 · 入口

1. 读 `sys/config.json`；**版本闸**同 `malo-kbcheck`：库版本 < 技能版本就停，指回 CHANGELOG 迁移。
2. 输入优先级：
   - `/malo-kbcheck` 报出的新增 / 修改清单；
   - 用户点名的文件或目录。
   **不要主动扫全库。**

## 1 · 读材料

按用户指的文件读，不预设扩展名。材料目录只读：不改、不移、不改名。

## 2 · 抽点与改点

- **新点**：frontmatter 五字段（`类型` / `分类` / `归属` / `aliases` / `标签`）+ 正文六节；链接带路径、相对工作区根、带后缀、带别名。
- **改点**：只改结构，内容一个字节不动；已经合规的不重写。
- 契约以 [`../_shared/templates.md`](../_shared/templates.md) 为准。

## 3 · 定边

- 判据：**删掉 from，to 的核心内容就解释不通**；
- 只收直接前置；同一篇的**必要前置（AND）之间**两两不可比（OR 组内的选项本来就互不可达，不受这条约束）；
- `reason` ≤ 30 字，指出 to 依赖 from 的那一步；
- 图是 **v2**（`edges` + `groups` 同时存在，缺省 `groups: []`）；写 OR 组按 [`../_shared/templates.md`](../_shared/templates.md) §三，不要只写 `edges`。

## 4 · 账本

新点追加一行：

```json
{"知识点":"<名字>","是否学习过":false,"做对":0,"总共出过":0,"熟练程度":null,"最后复习日期":null}
```

```bash
node ../_shared/scripts/ledger.mjs add <根> <new-points.jsonl>
```

一行一条 `{"知识点":"<名字>"}`；已存在的点会跳过。

## 5 · 校验与 MOC

```bash
node ../_shared/scripts/graph.mjs   check <根> --layers --write
node ../_shared/scripts/aggregate.mjs <根>
node ../_shared/scripts/scan.mjs    <根>
```

图不过就先修；MOC 的机器区由脚本覆盖，手写区不碰。

## 6 · 闸门（写盘前）

读 `config.闸门.入库`（默认 `每次`）。要给用户看的清单：

- 新增了哪些点、修改了哪些点；
- 新增 / 删除了哪些边（含理由）；
- 账本新增几行；
- 会影响哪些 MOC。

用户确认后一次写入。

## 7 · 删除

源文件被删或改名时：**不删笔记**，在笔记里标 `归属缺失`，由 `/malo-kbcheck` 报出来。是否删点由用户另行决定。

## 8 · 重审（可选，写完图之后）

```bash
node ../_shared/scripts/review.mjs plan <根>
```

- 增量默认；改图满 5 次或 `--force` 才全量。
- 逐条判「删掉它，目标还解释得通吗？理由是否说出那一步？」；否 → 建议删边 / 改方向 / 合并 / 改判 OR 组。
- 用户确认后写确认清单（一行一条 id），`mark` 盖审；真正要改图时按 §6 的闸门再确认一次。

## 9 · 收尾

告诉用户：入库了什么、图与 MOC 是否更新、以及「下一步去 `/malo-study`」。
