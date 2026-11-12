# malo

**先学，后考。** A study-then-drill bundle for DeepSeek Harness: walk your course materials **in graph order**, seed each knowledge point with a question, then drill until every point reaches your target accuracy — and end with a pre-exam list.

通用应试复习：**先按关系图把材料学一遍，再进入考试循环**。它解决的是「还没学完就做题，错因全变成『我不会』」。

## 安装

```bash
dsh plugin --profile web add dsh-mastery-loop
```

## 五个命令

| 命令 | 什么时候用 | 写盘吗 |
| --- | --- | --- |
| `/malo-setup` | 第一次建库 / 迁移 | 写（手动） |
| `/malo-kbcheck` | 「体检」「有没有新文件」 | **只读** |
| `/malo-intake` | 新讲义入库 | 写（要确认） |
| `/malo-study` | 「开始学习」「先把材料过一遍」 | 写账本 |
| `/malo-quiz` | 「开始做题」「批改」「考前 list」 | 写账本与错因 |

`/mastery-loop` 与 `/mastery-loop-setup` 仍可用，但只是重定向壳。

## 生命周期

```
/malo-setup（一次）
   → /malo-kbcheck ←→ /malo-intake
   → /malo-study
   → /malo-quiz
```

- **kbcheck**：跑结构 / 图 / 扫库，列出新增·修改·删除文件；版本落后就停。
- **intake**：读新文件 → 新点 / 改点 → 定前置边 → 补账本行 → 重聚合 MOC。
- **study**：按图分层，**一份讲义只解析一次**；每点 1 题（含思维链），错则回读 `讲义出处` 再 1 题；两题全错进「不熟清单」。不判达标。
- **quiz**：出题 → 批改（先判思维链）→ **批改+写回一个动作** → 判达标 → 考前 list。

另有两个只读/派生工具：`sys/layers.json`（分层，`graph.mjs check --layers --write`）给 study 定顺序；`sys/graph.html`（`render-graph.mjs`）把先修图渲染成可缩放的分层图。图重审用 `review.mjs plan`，契约见 `templates.md` §十三。

## 熟练度：不是简单正确率

```
熟练度 = (做对 + 0.5) / (总共出过 + 1)      # Jeffreys
```

- 4/4 = 90.0%，3/4 = 70.0%，1/1 = 75.0%；
- 达标 = 熟练度 ≥ 目标（默认 0.9）；
- **没有「总共出过 ≥ 5」的硬阈值**，样本惩罚长在公式里。

## 错误原因：结构化，才能跨轮复用

每条错因是一个 JSON 记录，键是 `(谓词, 涉及集合, 方面)`，原文只用于展示：

```json
{"kind":"error","知识点":"梯度","谓词":"confuse","涉及":["学习率"],"方面":"方向",
 "错误原因":"Confuse the gradient with the step size.","中文":"把梯度当成步长。",
 "日期":["2026-11-08"]}
```

谓词 8 个 + `other`：`confuse / overgeneralize / misorder / omit / invert / misapply / miscompute / notation`。

- 跨点混淆**只写一条**，`涉及` 指向另一篇；两个点都能看到，统计只算一次；
- 新增前先列候选（`errors.mjs query`），没选中再走结构键，仍没有才新增；
- 写法借用 **ASD-STE100** 的原则（一句一个偏移、≤20 词、动词开头），**不声称合规**。

## 闸门

六个动作可在 `sys/config.json` 里配 `每次 / 仅首轮 / 从不`：入库、study 开局、study 单点、出题、批改写回、达标后继续。另有一个 `覆盖率阈值`（默认 0.3）：quiz 前若范围内未学率超过它，**警告并放行**。

## 从 0.2.0 升级

1. 安装 0.3.0；
2. 跑 `/malo-kbcheck`，它会说「库版本 0.2.0 < 技能版本 0.3.0」；
3. 按 `CHANGELOG.md` 的 `### 迁移（0.2.0 → 0.3.0）` 执行：config 补闸门/阈值，`errors.jsonl` 补谓词/涉及/方面（agent 判断），`scan --update-state`；
4. 再跑一次 `/malo-kbcheck`，结构 / 图应全过。

`kb/` 布局与 451 篇笔记不需要动。

## License

MIT
