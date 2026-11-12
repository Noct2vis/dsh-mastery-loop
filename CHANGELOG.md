# Changelog

## 0.3.0

**拆分 + 改名（不兼容）** —— 日常流程拆成五个可独立触发的 skill，`mastery-loop` 改名为 `malo-quiz`。

- 新增 `/malo-kbcheck`（只读体检）、`/malo-intake`（新文件入库）、`/malo-study`（学习阶段）、`/malo-quiz`（考试循环）；`/malo-setup` 取代 `/mastery-loop-setup`。
- `/mastery-loop` 与 `/mastery-loop-setup` 保留为重定向壳，只响应手动输入。
- 新增「学习阶段」：按关系图拓扑、以讲次为单位过材料，每点 1 题（错则回读再 1 题）初始化掌握度。
- 熟练度改为 Jeffreys 估计 `(做对+0.5)/(总共出过+1)`；删除「总共出过 ≥ 5」硬阈值；4/4 = 90%。
- 错误原因改为结构化记录：`谓词`（8 类 + `other`）/ `涉及` / `方面`，原文只用于展示；跨点混淆只写一条。
- 批改与写回合并为一个动作；`sys/config.json` 新增「闸门」与「覆盖率阈值」。
- 共享契约与脚本移到 `skills/_shared/`；`LIB_VERSION` 成为技能版本。

### 图模型 v2（本批）

- `sys/graph.json` 升 **version 2**：`edges` = 必要前置（AND），新增 `groups` = 任一前置组（OR，`mode:"any"`）。旧图零迁移（当时 557 条边全按 AND 读）。
- 校验 **六项 → 八项**：新增 7 无环（Tarjan，打印环路径）、8 组结构（`of` 非空、`mode` 为 `any`、id 唯一、组内两两不可达）。
- 新增分层：`check --layers --write` 写 `sys/layers.json`，`depth = 1 + max(AND)`，OR 组取 `1 + min`。
- 新增 `render-graph.mjs` + `graph-view.js`：生成自包含 `sys/graph.html`（分层、缩放/平移/小地图、搜索、边 reason、按分类/标签筛选、点节点看邻域），零依赖。
- `## 前置知识` 支持 OR 行：`- [[X]] 或 [[Y]]（任一） —— reason`；`backlinks` 会渲染它。
- 删掉从未实现的 `sys/changes.jsonl` 承诺；`state.jsonl` header 修正；git 变化检测纳入 `sys/` 的 json/jsonl。
- 新增 `review.mjs`：重审候选（指纹变化 / 从未审过 / 新点邻域 / 90 天老化）、增量清单 `.md`/`.json`、`mark` 盖 `reviewedAt`/`fp`；改图满 5 次或 `--force` 强制全量。契约 §十三。
- 真实库已按 0.3.0 迁移：`schema_version` 0.3.0、`graph.json` v2（540 条边，17 条传递冗余已删）、`layers.json` 已生成。

### 迁移（0.2.0 → 0.3.0）

1. `sys/config.json`：
   - `schema_version` 改为 `"0.3.0"`；
   - 加 `闸门`（六项，默认：入库/study开局/批改写回/达标后继续 = 每次，出题 = 仅首轮，study单点 = 从不）；
   - 加 `覆盖率阈值: 0.3`。
2. `sys/errors.jsonl`：每条 `kind:"error"` 记录补 `谓词`（`confuse / overgeneralize / misorder / omit / invert / misapply / miscompute / notation / other`）、`涉及`（跨点混淆填另一篇，否则空数组）、`方面`（自由短标签，可为空）。**这一步由 agent 读原文判断，用户逐条或批量确认。**
3. 跑 `node <shared>/scripts/scan.mjs <工作区根> --update-state` 刷新 `sys/state.jsonl`。
4. `sys/graph.json`：`version` 改为 `2`，补 `"groups": []`（旧边全部按 AND 读，不需要改边）；
5. 跑 `validate.mjs` 与 `graph.mjs check`；不过就先修。


## 0.2.0

**架构重写（不兼容）** —— 库的布局、文件格式、脚本边界全变了。已有的库要重新对齐一次。

**修复（自 0.1.0 起就坏的 bug）**：`mastery-loop-setup` 的 frontmatter 是**非法 YAML** —— `description` 写成裸标量，里面含 `mastery-loop: explore` 的「冒号 + 空格」。DSH 加载器对非法 frontmatter 的处理是**把整个 skill 丢弃**，所以 **`/mastery-loop-setup` 从 0.1.0 起就从未出现过**（模型侧、用户侧都没有），不是开关问题。已改成 `>-` 折行块标量（文字未改）。

**布局**：工作区根下两个并列文件夹 —— `kb/`（内容区，给人看）+ `sys/`（机器区，给脚本读）。

- `kb/knowledge/` 知识点 · `kb/MOC/` 聚合产物（镜像分类层级）
- `sys/config.json` · `sys/graph.json` · `sys/ledger.jsonl` · `sys/errors.jsonl` · `sys/error-taxonomy.json` · `sys/paper-format.json` · `sys/state.jsonl`
- `sys/changes.jsonl` 只在「没有 git 且用户不装 git」时启用

**知识点契约**

- `归属` = **来源文件**（多值、必填）；**删 `课程:` / `主题:` / `难度:`** —— 课程与讲次改为**从 `归属` 解析**
- 正文固定六节，**删 `## 平行关联`**；`## 后置知识` 由图反算、不手写
- 链接一律**带路径、相对工作区根、带后缀、带别名**

**分类与范围**：分类是**全库级定义**（层数不固定、每层一条解析规则、类值经用户确认后写进 config）；**范围 = 分类里的一个或多个类值**。

**关系图**：`sys/graph.json`（`用途` / `规则` / `coverage` / `edges`）；边带 **≤30 字**理由；**后置由图反算**；**六项校验**（双向自洽 / 无自链 / 无悬空 / 同段无重复 / 前后置互斥 / 前置两两不可比）。

**聚合与两区**：`kb/MOC/` 的**机器区**由 `aggregate.mjs` 从「`归属` + 图」生成并覆盖；**手写区**（主线、脉络、考点提示）脚本**永不碰**。

**脚本边界**：脚本只做重复性、机械性、不需要变通的事（校验 / 渲染 / 聚合 / 哈希跳过 / 账本运算 / 批量写回）；判断前置、写理由、出题、批改、**错误原因逐字去重**留给 agent。

**git 不硬依赖**：有 git 就用它承担历史（**不自动 commit、绝不 push**）；没有且用户不装 → 回退 `sys/changes.jsonl`。

**其它**：删掉 `index.md`（索引 = 聚合结果的层级视图）；Miyo 仍为**可选**、发布版不依赖。

## 0.1.0

首个版本。

**两个 skill**：

- **`mastery-loop`** —— 复习闭环。模型可自动调用，也可手动 `/mastery-loop`。
- **`mastery-loop-setup`** —— 一次性初始化。**纯手动**（`disable-model-invocation`），只响应 `/mastery-loop-setup`。

**内容**：

- 出题 → 批改 → 再出题，直到逐点达标（`总共出过 ≥ 5` 且 `熟练程度 ≥ 目标正确率`）
- **每题必须写思维链**；批改**先判思维链、再判答案**；**蒙对不算对**
- 错误原因**逐字复用**、按知识点分组、追加日期 → 可统计
- 错误原因写法**借用 ASD-STE100 原则**（≤20 词、一句一个偏移、动词开头）
- 初始化生成 **6 个根目录文件**，并可用 `scripts/validate.mjs` **机械校验**
- 不做间隔重复排程（SM-2 那套）—— 那该由日历与考试表决定
