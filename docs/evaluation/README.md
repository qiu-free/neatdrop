# 离线分类评测数据与使用边界

`development.json` 包含 40 个独立手写的合成开发场景，按 CC0-1.0 提供，无真实个人资料。所有记录均标为 `development`，用于回归和路线探索。它们不是代表性用户样本，也没有冻结测试集性质。请勿用比例宣传真实分类准确率。

标注字段：匿名 `id`、近重复/模板组 `group`、`split`（development/calibration/test）、`source`、`authorization`、`name`、`text` 或相对 `path`、可接受标签集合 `acceptable`、`must_review`。子类可为空，表示主类归档也可接受；空标签集合表示超出分类范围。主观用途可列多个可接受标签。

评测只读取显式清单。文件路径相对于清单目录，不接受绝对路径、`..`、符号链接、目录逃逸或不支持格式。路径样本接受当前本地分析器支持的 TXT、MD、PDF、PNG、JPG、JPEG、WEBP、DOCX、PPTX、XLSX 和 CSV，并使用同一安全提取流程。扫描 PDF 需按 [提取说明](../extraction/scanned-pdf.md) 安装可选依赖并显式启用；默认关闭。Office 内嵌图像仍不支持。真实样本必须另有授权并留在专用本地目录，不提交源码，不自动上传。报告不包含正文、文件名和绝对路径；匿名 ID、标签与文件摘要仍可能构成敏感元数据，分享前需要检查。

在项目目录运行：

```powershell
.\.venv\Scripts\python.exe scripts/evaluate_offline.py --manifest docs/evaluation/development.json --output .cache/evaluation.json
```

可用 `--stages baseline rules semantic` 指定阶段，`--split test` 只运行特定划分。`rules` 使用产品语义候选开关（`NEATDROP_SEMANTIC_CANDIDATES=1` 才启用）；`--semantic on` 和 `--semantic off` 可在本次命令中明确覆盖该阶段的开关。`semantic` 阶段则显式强制运行语义候选，属于实验比较，不代表产品默认能力。推理不下载模型；模型准备是独立命令。

分类建议阶段共用产品的质量约束、候选决策、证据位置与安全命名流程。汇总报告新增质量状态、证据来源计数和改名建议数量，不包含证据正文或文件名。源组划分可从显式授权清单生成：

```powershell
.\.venv\Scripts\python.exe scripts/evaluation/make_group_splits.py --input docs/evaluation/development.json --output .cache/development-split.json --seed review-v1
```

切分按 `group` 用种子和 SHA-256 排序后按比例分配。同组记录始终留在一个 split；输入清单已有同组跨 split 时拒绝运行。已有的一致分组分配会被保留，只为尚未分配的组生成新 split，因此向清单追加新组不会移动既有冻结组。输出元数据记录保留组/新分组数量、输入摘要、算法版本、种子、比例和分组/记录计数。切分工具只分配现有记录，不收集样本，也不产生分类质量证据。

评测 JSON 会在 `semantic_experiment` 中同时记录 `rules_toggle`（产品开关或命令覆盖模式）和 `rules_semantic_enabled`（本次运行实际是否启用语义候选）。`engine_fingerprints` 包括 Office 文档解析与可选本地 PDF OCR 的实现，文件格式路径结果可对应到具体提取源码版本。

`baseline` 固定使用 `scripts/evaluation/baseline_v2.py`。内联文本沿用 v2 前 12000 字符；文件路径样本共用新版安全读取和提取，因此只能比较分类器，不能用来证明 v2/v3 图片或 PDF 提取收益。报告的 `baseline_scope` 同时写入 JSON 和 Markdown。

报告保存清单摘要、各匿名样本内容摘要、生产分类管线、质量/决策、源码/知识表、评测脚本和切分工具指纹、实际模型包 revision/manifest 摘要和依赖版本。运行间模型或数据发生变化，应视为不同版本。每阶段报告完整分母、处理失败、引擎降级计数、质量状态、证据来源计数、改名建议计数、主/子类首选命中、Top-3、逐类质量与混淆、普通建议错误/覆盖、复核/拒判、耗时和 Wilson 区间；拒判是复核子集。

首选命中包括需复核建议，不能当作可自动执行比例。范围外错误候选会计入对应类别 Precision 的假阳性。必须复核却得到普通建议，即使标签可接受，仍计为普通建议错误。

当前报告只证明开发样例行为变化和工程路径可运行。300–500 份授权代表性样本、分组划分、校准和独立发布测试仍是质量发布的数据前提。不得将模板微调变体当作独立样本补足数量。
