# Offline v3 根任务代码审查

审查日期：2026-11-03。审查范围：`decision.py`、`classifier.py`、`analysis.py`、`app.py`、`evaluation.py`、`scripts/evaluate_offline.py` 及指定三组测试。只读审查，未编辑上述实现或测试；仅创建本报告。未详细审查语义引擎及提取引擎内部实现。

## 结论

**规格符合性：当前审查快照的核心产品复核门槛、云端分支隔离及取消传播通过；评测复现记录仍有一项 P2 缺口。** 本次没有发现未修复的 P1 产品问题。路径型评测只比较共享 v3 提取下的分类器，已经在 JSON/Markdown 明确披露，不能据此宣称 v2/v3 提取端到端收益。

**代码质量：可继续集成与最终验收。** 决策层独立、保留原始分数空间、候选经过固定 taxonomy 校验，评测报告避免正文、文件名和异常文本。新增回归已覆盖审查中发现的复核与取消问题。37 项相关测试通过。此结论不等同完整后端、真实断网、真实 OCR/CLIP、桌面/移动端流程、质量指标或性能门槛已全部验收。

## 未解决的可操作发现

### [P2] 模型包身份未进入评测记录，源码指纹不足以复现模型结果

位置：`scripts/evaluate_offline.py:26`、`:31`、`:69`；`backend/neatdrop/evaluation.py:126`。

当前报告保存 manifest、匿名样本、基线和实现文件 SHA-256，但未保存语义/视觉实际模型包版本、固定 revision/manifest 摘要，以及推理依赖版本；`summarize` 也丢弃各结果的 `engine_versions`。相同脚本与样本在另一已验证模型包上运行时，可以产生不同结果，却具有相同的已记录引擎指纹。规格第 6 节要求引擎版本支持复现，第 7.4 节要求配置与基线可复现。

建议：增加不含本地路径的模型版本、固定 revision 或包 manifest 摘要及相关依赖版本；将本次阶段实际使用的引擎版本汇总入报告。缺包时明确记录不可用。补一个同样源码、不同包版本会使评测环境标识不同的测试。此问题影响模型对照报告的复现能力，不影响文件执行安全。

## 审查中发现、由根任务并发修复的事项

下列问题已在初始快照复现，随后由根任务修改；已重新读取并运行当前测试，故不再作为开放问题。

1. **[P1，已修复] 同主类不同子类的引擎冲突仍为普通建议。** 原 `decision.py:54` 只比较主分类。规则 `office/resume` 对语义 `office/contract` 返回 `ordinary`、`review_required=False`。当前比较完整主/子元组，产生 `engine_disagreement`。`test_same_main_different_semantic_child_still_requires_review` 通过。
2. **[P1，已修复] 仅主分类结果可以成为普通建议。** 原输入 `{category: study, subcategory: null, review_required: false}` 返回普通建议。当前 `decision.py:78` 强制添加 `subtype_ambiguous`。`test_main_only_can_never_be_an_ordinary_suggestion` 通过。
3. **[P2，已修复] 降级推理未单列。** 原语义超时/预算耗尽仍只表现为处理完成，报告不能看出缺失引擎。当前 `evaluation.py:86` 增加 `degraded_count` 和 `engine_warning_counts`，与完全处理失败分开。相关回归通过。
4. **[P2，已修复] 范围外误报未进入每类 precision。** 一个正确发票加一个无可接受标签却预测发票的样本，原 precision 为 1.0。当前 `evaluation.py:117` 将范围外误报纳入 FP，并保留 `out_of_scope` 混淆行，回归期望 precision=0.5 通过。
5. **[P2，已修复] 外层 asyncio 任务取消未通知本地 worker。** 应用关闭时 `app.py:88` 调用 `task.cancel()`，原 `analysis.py` 的 finally 把任务标为 completed，worker callback 仍为 false。使用内存事件阻塞分类器后取消 task，原实测 `status=completed/cancel_requested=False`。当前 `analysis.py:282` 捕获 `CancelledError`、设置取消标记并重抛；新增真实管理器回归确认 callback 为 true、状态 cancelled。
6. **[P2，已以范围披露解决] 文件型基线使用了 v3 提取。** `evaluate_offline.py:57` 路径样本各阶段共享当前 `prepare_input(local=True)`；只有内联基线使用前 12000 字。构造中部包含简历结构的长文，同一冻结分类器对旧抽样返回 other、对 v3 抽样返回 office。当前报告增加 `baseline_scope`，JSON 与 Markdown 均说明仅比较分类器；不能当作冻结 v2 端到端基线。后续如需证明提取整体收益，应单独冻结旧提取或采用受控提取夹具。
7. **[P2，已修复] 文件样本内容未锁定版本。** 原仅 manifest SHA 不随路径文件内容变化而变化。当前脚本增加匿名 ID 对应内容 SHA、实现源码指纹、基线 SHA，并检测各阶段样本摘要变化。CLI 回归检查这些字段且仍无正文泄露。

## 规格与安全核对

- `analyze_local` 只在本地模式接收本地提取、OCR/视觉及语义候选；云端分支仍走 `prepare_input(local=False)`，没有新增本地候选/向量/版面进入云端 payload 的调用路径。文本上限 1500 字符，图片缩略最长边 1024、重新编码清除 EXIF 的分支保留。
- 云端任务仍要求 `cloud_consent`，绑定 endpoint/config_version；候选决策不生成目标目录。原确认、执行和撤回没有被此次改动绕过。
- 新结构规则固定返回复核；主分类相近/跨引擎冲突、局部采样、关键图像处理失败均有复核门槛。可选语义缺失保持原规则降级，且实验语义默认关闭。
- manifest 验证重复匿名 ID、组跨 split、授权字段、固定 taxonomy 标签和路径约束；文件读取再次受 Workspace/安全读取约束。评测输出只汇总匿名 ID、标签、计数、耗时、摘要与代码，未输出正文、名称、完整 OCR 或任意异常消息。
- Top-3 对有明确标签样本保留处理失败/无候选作为未命中；必须复核真值即便分类标签匹配，也计为普通建议错误。复核与拒判分别报告；Wilson 区间的零错误情况有独立回归。

## 验证与快照说明

最终执行：`.venv/Scripts/python.exe -m pytest backend/tests/test_decision.py backend/tests/test_analysis_v3.py backend/tests/test_evaluation.py -q -p no:cacheprovider`，**37 passed，退出码 0**（约 2.66 秒）。初次在受限沙箱执行因 Windows 临时目录访问失败；通过相同获批命令完成验证。

审查期间根任务并发修改了 decision、analysis、app、evaluation、evaluate_offline 及测试。报告按照最后读取版本给出结论，未把旧快照问题继续标为开放。classifier 在审查期间未变化；其冻结基线位于 `scripts/evaluation/baseline_v2.py`。

最后读取的核心源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| decision.py | `06DDD28FEBC00EB05CE9F88E351ADCF7D87918D3880CD44E4BD361423A63E5C6` |
| classifier.py | `D55DD8CC4A3BDBD35244520A6E2F6FF1D0969E0A878628DBBF62F2C2E23B228D` |
| analysis.py | `EB287563CA473FA2D74AB237ABE7B031CFD29BFC91BF5A9B2D00E7EACB9AA2DE` |
| app.py | `0387BFB7A504D124FF96DFC883687B30B1723F5B284E8FD846E0A48385D450F3` |
| evaluation.py | `21C5BCCB9C2B7AF87852CC27B4D57E012096658AEE27ECE08F9EE247664614C5` |
| scripts/evaluate_offline.py | `710835402C3056D9BA5801924F348512D64226A755BFA4B26237EEF2BFC2637B` |
