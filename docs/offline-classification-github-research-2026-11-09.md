# 离线分类开源项目调研与目录选择修复

核对日期：2026-11-09。基于 GitHub 官方仓库 API、README、许可证和部分关键源码的只读检查；未安装、执行或引入第三方项目代码，也未下载新模型。

## 结论

有可复用的离线分类项目与组件。最接近整套“本地文件 + 图片自动整理”的项目是 **Local File Organizer**；最适合让 NeatDrop 的固定中文分类标准保持一致的增量路线是 **SetFit 或小型监督分类头 + 现有本地 OCR/视觉提取 + 有限候选与拒判**。这些项目均不能直接证明对我们的九个主分类、57 个二级分类已有可靠准确率。

“分类更标准”需同时做到：服务端只有一套版本化标签；模型从允许标签中选择；证据不足可只给主类或待分类；通过独立标注样本评估错误率、覆盖率和耗时。让模型自由生成目录名称不能替代固定标准。

## 已核实候选

| 项目 | 实际能力与离线条件 | 核实的代码许可证 | 对 NeatDrop 的判断 |
| --- | --- | --- | --- |
| [QiuYannnn/Local-File-Organizer](https://github.com/QiuYannnn/Local-File-Organizer) | Nexa 本地 Llama3.2 3B 生成摘要和目录名，LLaVA 7B 生成图片说明，再用文本模型生成分类与名称；模型和依赖需事先准备 | 根 `LICENSE` 为 MIT；README 另述双许可，本次以实际 MIT 文件为已核实依据 | 最像完整产品，但当前提示词让模型生成最多两个词的自由类别，并非固定中文用途分类；还使用英文 NLTK 预处理和启动下载。可借鉴“图片说明 → 文本分类”的分流，不能原样接管归档路径或替代现有副本执行器 |
| [huggingface/setfit](https://github.com/huggingface/setfit) | Sentence Transformer 加分类头，通过少量标注训练；支持多语言底座，保存模型后可部署本地推理 | Apache-2.0 | **优先做对照实验**。以我们的标签训练中文用途分类器，训练依赖与产品运行依赖分开；是否导出 ONNX、量化及 CPU 耗时需单独验证 |
| [docling-project/docling](https://github.com/docling-project/docling) | 文档解析、PDF 版面/阅读顺序/表格、扫描件 OCR；README 明确支持本地与隔离环境，支持 Windows | MIT | 适合增强“能读出来”的能力，尤其扫描 PDF、复杂表格；不是开箱即用的九类用途分类器。按解析失败类型引入受限 worker，模型权重许可另核 |
| [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | OCR、文档结构和多种文档理解管线；本地模型需事先准备，具体模型的硬件和包体不同 | Apache-2.0 | 对密集截图、复杂版面及扫描文档更值得评测。先挑轻量 OCR/结构化组件，避免整套多模态大模型成为基础依赖 |
| [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR) | 中文/英文 OCR，支持 ONNX Runtime 等本地后端；README 提供离线部署与定制模型路线 | Apache-2.0 | 项目已经使用 RapidOCR PP-OCRv4。可对照更合适的识别模型与版面重建，重复安装同类库不会自动提升用途分类 |
| [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | 本地文档管理、标注后自动匹配标签/类型/存放路径；当前分类源码有 MLPClassifier、分类阈值和训练更新机制 | GPL-3.0 | 借鉴“人工纠正 → 再训练 → 阈值拒判”的闭环。源码依赖 Django/文档数据库/缓存且有 GPL 分发义务；不直接复制进现有应用 |

补充候选：[OFA-Sys/Chinese-CLIP](https://github.com/OFA-Sys/Chinese-CLIP)。已读取 README，确认中文零样本图片分类与 ONNX 部署路线；GitHub API 限流导致本次未读到 LICENSE，因此不列为已完成许可核验的接入项。照片场景分类仍无法独立确定“报销材料、项目文档”等业务用途，需要 OCR 和文件证据共同判断。

## 对照当前代码的缺口

1. `backend/neatdrop/classifier.py` 主要依赖正文锚点和字段组合。没有固定标题、用词口语化、领域术语变化时容易拒判。
2. `backend/neatdrop/semantic.py` 已有固定版本的 BGE-small-zh-v1.5 ONNX 候选，并有哈希核验、隔离执行和资源预算。当前 `analysis.py` 只在 `NEATDROP_SEMANTIC_CANDIDATES=1` 时调用；此前开发评测没有额外收益证据，不能把“打开开关”当准确率提升。
3. `backend/neatdrop/offline.py` 已有 RapidOCR 和 CLIP，当前视觉提示词主要是英文场景描述。照片场景、文档形式和归档用途需要分别评估，不能混成一个分数。
4. 扫描 PDF OCR、复杂阅读顺序和表格语义仍是提取层缺口；用途分类器不能弥补未读到内容的问题。
5. 仓库已有合成开发评测，但没有足够的代表性、分组隔离的真实发布测试集。公开仓库的 benchmark 或 README 描述不等于 NeatDrop 准确率。

## 建议的接入顺序

第一步：沿用服务端 `taxonomy.py` 的固定标签和画像，明确“内容形式、用途、子类”三者。对错分、漏分、解析失败分别记数；人工更正样本只在明确选择后写入专用本地训练目录。

第二步：以 SetFit 训练中文用途候选。先挑有实际样本的常用类，每类约 20–50 份独立样本用于初步对照是工程起点，不是质量保证；稀有类保持规则/待复核。按来源和模板分开训练、校准和测试，防止同一模板泄漏。对照现有规则、现有 BGE、监督分类头三条路径；有持续收益才导出并接入本地 worker。

第三步：针对图片错误分流：低 OCR 质量、长图、表格、扫描 PDF 用 RapidOCR/PaddleOCR/Docling 的具体组件做小范围比较；自然照片单独比较现有 CLIP 与中文模型。首次准备模型可联网，正式推理只读本地固定模型包。

第四步：统一决策层。模型只能返回合法标签 ID、来源、Top-3 候选和可核对片段；主类可靠但子类冲突时只给主类；证据不足保持待分类。所有目标目录由现有服务端映射生成。保留人工审核及副本计划确认。

验收同时报告：逐类 precision/recall、主/子分类命中、Top-3、错误高置信建议、拒判/复核覆盖率、OCR/解析失败率、每文件 CPU 耗时和内存。相似度不能直接显示为“准确率百分比”。

## 许可证与版本证据

| 仓库 | 本次读取的提交 |
| --- | --- |
| Local-File-Organizer | `a19559942a35d98e9d2168fa58f288d9ea294bc6` |
| SetFit | `d70dad84de757d30f03465d120e0d3fad2c725b0` |
| Docling | `1005c8d7d39447ff433ff650fbc49e046ad0aeee` |
| PaddleOCR | `dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf` |
| RapidOCR | `a538d3a75e26ca7ac521da8602842b9d6e5a872d` |
| Paperless-ngx | `936b1b3bfa3b83fd5c1762bdc8e8e2953c5bace2` |

MIT/Apache 项目允许在对应条款下复用，复制代码时需保留版权、许可证和适用 NOTICE。代码许可证不自动覆盖模型权重、数据集和其他依赖。GPL 代码如果合并并对外分发需要遵守其对应义务，单纯私人使用不等于必须对外公开全部代码。

源码证据：

- [Local File Organizer 文本分类提示词](https://github.com/QiuYannnn/Local-File-Organizer/blob/a19559942a35d98e9d2168fa58f288d9ea294bc6/text_data_processing.py)：自由生成主题目录名。
- [Local File Organizer 初始化](https://github.com/QiuYannnn/Local-File-Organizer/blob/a19559942a35d98e9d2168fa58f288d9ea294bc6/main.py)：Nexa 模型、`local_path=None` 及 NLTK 下载。
- [Local File Organizer MIT 许可](https://github.com/QiuYannnn/Local-File-Organizer/blob/a19559942a35d98e9d2168fa58f288d9ea294bc6/LICENSE)。
- [SetFit README](https://github.com/huggingface/setfit/blob/d70dad84de757d30f03465d120e0d3fad2c725b0/README.md) 与 [Apache 许可](https://github.com/huggingface/setfit/blob/d70dad84de757d30f03465d120e0d3fad2c725b0/LICENSE)。
- [Docling README](https://github.com/docling-project/docling/blob/1005c8d7d39447ff433ff650fbc49e046ad0aeee/README.md) 与 [MIT 许可](https://github.com/docling-project/docling/blob/1005c8d7d39447ff433ff650fbc49e046ad0aeee/LICENSE)。
- [Paperless 当前分类器](https://github.com/paperless-ngx/paperless-ngx/blob/936b1b3bfa3b83fd5c1762bdc8e8e2953c5bace2/src/documents/classifier.py) 与 [GPL 许可](https://github.com/paperless-ngx/paperless-ngx/blob/936b1b3bfa3b83fd5c1762bdc8e8e2953c5bace2/LICENSE)。

## 本次目录选择修复

截图错误 `CSRF_REJECTED` 是 LocalSecurity 在路由执行前拒绝请求。此前前端只在首次加载获取校验令牌，遇到多窗口共享 Cookie 状态变化时无法恢复。已复现并修复旧令牌请求无恢复的代码路径；截图发生时是哪一个窗口或会话操作导致令牌不同，因缺少当时请求日志未作断言。

- `frontend/src/api.ts` 合并并发的会话读取；收到明确 HTTP 403 + `CSRF_REJECTED` 时最多刷新一次令牌、重发一次原请求。已有令牌更新时不再重复刷新。取消请求不重发。
- 断网、模型失败、来源拒绝和 `SESSION_REQUIRED` 均不自动重试；没有取消来源/CSRF 校验，也没有重放不确定状态下的复制请求。
- 两个目录选择按钮同时锁定到系统选择结束，并在新选择前清除上次错误。
- 浏览器通过真实本地中间件验证了 `POST /workspaces 403 → GET /api/session 200 → POST /workspaces 200`，合成目录显示 12 项且无残留错误。没有生成新归档副本。
- 实际“选择本地目录”按钮已进入“等待选择”状态；桌面工具返回 `USER_CONTROL` 后已停止自动化。未声称替用户完成原生窗口中的最终选择。
- 前端定向回归 54 项通过；前端全量 35 个文件、325 项通过；后端 API/安全相关 37 项通过。TypeScript 与 Vite 生产构建通过，已更新 `frontend/dist`，现有 8765 页面刷新后加载修复。`git diff --check` 无空白错误。
