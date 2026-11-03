# 离线分类评测数据与使用边界

`development.json` 包含 40 个独立手写的合成开发场景，按 CC0-1.0 提供，无真实个人资料。所有记录均标为 `development`，用于回归和路线探索。它们不是代表性用户样本，也没有冻结测试集性质。请勿用比例宣传真实分类准确率。

标注字段：匿名 `id`、近重复/模板组 `group`、`split`（development/calibration/test）、`source`、`authorization`、`name`、`text` 或相对 `path`、可接受标签集合 `acceptable`、`must_review`。子类可为空，表示主类归档也可接受；空标签集合表示超出分类范围。主观用途可列多个可接受标签。

评测只读取显式清单。文件路径相对于清单目录，不接受绝对路径、`..`、符号链接、目录逃逸或不支持格式。真实样本必须另有授权并留在专用本地目录，不提交源码，不自动上传。报告不包含正文、文件名和绝对路径；匿名 ID、标签与文件摘要仍可能构成敏感元数据，分享前需要检查。

在项目目录运行：

```powershell
.\.venv\Scripts\python.exe scripts/evaluate_offline.py --manifest docs/evaluation/development.json --output .cache/evaluation.json
```

可用 `--stages baseline rules semantic` 指定阶段，`--split test` 只运行特定划分。评测命令显式比较语义引擎，不受产品默认实验关闭开关影响。推理不下载模型；模型准备是独立命令。

`baseline` 固定使用 `scripts/evaluation/baseline_v2.py`。内联文本沿用 v2 前 12000 字符；文件路径样本共用新版安全读取和提取，因此只能比较分类器，不能用来证明 v2/v3 图片或 PDF 提取收益。报告的 `baseline_scope` 同时写入 JSON 和 Markdown。

报告保存清单摘要、各匿名样本内容摘要、源码/知识表指纹、实际模型包 revision/manifest 摘要和依赖版本。运行间模型或数据发生变化，应视为不同版本。每阶段报告完整分母、处理失败、引擎降级计数、主/子类首选命中、Top-3、逐类质量与混淆、普通建议错误/覆盖、复核/拒判、耗时和 Wilson 区间；拒判是复核子集。

首选命中包括需复核建议，不能当作可自动执行比例。范围外错误候选会计入对应类别 Precision 的假阳性。必须复核却得到普通建议，即使标签可接受，仍计为普通建议错误。

当前报告只证明开发样例行为变化和工程路径可运行。300–500 份授权代表性样本、分组划分、校准和独立发布测试仍是质量发布的数据前提。不得将模板微调变体当作独立样本补足数量。
