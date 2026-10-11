# mastery-loop

**A general exam-revision loop for DeepSeek Harness.** It reads your course materials and your notes vault, then drills you — question, grade, question again — until **every knowledge point** reaches your target accuracy, and finally hands you a pre-exam list.

Two things make it different from a quiz bot:

- **Every question requires you to write your reasoning, not just your answer.** Grading checks the reasoning first, then the answer. **A lucky guess does not count as correct.**
- **Wrong-answer reasons are stored verbatim and reused.** So a mistake you make three times is counted three times, instead of splitting into three near-synonyms and vanishing from the statistics.

通用应试复习闭环：读你的课程材料与笔记库 → 出题 → 批改 → 再出题，直到每个知识点的熟练度都达到目标正确率，最后产出考前 list。**每道题都要求你写出思维链**，批改先判思维链再判答案，**蒙对不算对**。

---

## 安装

```bash
dsh plugin --profile web add dsh-mastery-loop
```

## 用法：两步

### 1 · 先初始化（只跑一次）

```
/mastery-loop-setup
```

它会探测你的课程材料与笔记库，问清路径 / 素材 / 语言 / 融合方式 / 卷子格式，然后在你**知识库根目录**生成 6 个文件并校验：

| 文件 | 作用 |
| --- | --- |
| `ledger.md` | 复习账本（进度 + 已初始化的凭据） |
| `index.md` | 主题 → 知识点的反向索引 |
| `errors.md` | 错误原因表 |
| `paper-format.md` | 每个课程的每个考试的卷子格式 |
| `error-taxonomy.md` | 失分原因分类（**初始为空**，等归纳） |
| `config.md` | 路径 / 每门课的素材选择 / 语言标准 |

> 初始化**有意做成独立的 skill**：它要问六组问题，跟日常复习是两件事。分开之后 `mastery-loop` 本身短得多。

### 2 · 之后正常复习

```
/mastery-loop
```

或者直接用自然语言说「我想开始复习了」—— 这个 skill **模型可以自动调用**。

## 复习循环长什么样

```
读状态 → 与用户逐步确认（范围 / 目标正确率 / 是否混合考）
   → 复习清单
   → 出题（每题后面挂「答案：」「思维链：」两行）
   → 批改（先判思维链 → 再判答案 → 错了才提炼错误原因）
   → 写回账本与错误原因表
   → 达标？→ 问是否继续
   → 考前 list（从第一轮就开始攒，不是最后生成）
```

**达标是逐点判断的**：一个知识点要「**总共出过 ≥ 5** 且 **熟练程度 ≥ 目标正确率**」。不到 5 次标「样本不足」，继续出题。

## 错误原因为什么写成英文

`errors.md` 里的错误原因**默认用英文** —— 因为要套 **ASD-STE100（简化技术英语）** 的写法：一句一个偏移、不超过 20 词、动词开头、不写题号和数字。

这样做的目的是**可统计**：同名错误必须逐字一致，才能数出「我在这一点上错了几次」。

> ⚠️ 口径说明：本 skill **借用 ASD-STE100 的原则**，**不声称符合** ASD-STE100 —— 官方明说它不适用于一般写作。
> 另外，「同一表述必须逐字复用」是本 skill 的**跨文档外推**（STE 只要求「一篇文档内一致」）。**这个外推的责任在本 skill，不在 ASD。**

## 一次只复习一门课吗

**建议**。但范围由你定 —— 跨多门时 skill 会问你是否要**跨课程混合出题**（**默认不混合**）。

## 语言

**按产物类别分别定**（知识点笔记 / 出的题 / 批改解析 / 记录性文件 / 产出 / 机制层），在初始化时问你。想要中英双语对照、法文、或纯中文都行 —— 除了 `errors.md` 的错误原因默认英文（要套 STE）。

## License

MIT
