# Offline Quality v5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 使离线建议显式考虑输入质量，并为八类已存在的高频用途提供保守的多证据候选。

**Architecture:** 提取器和模型保持原预算，质量模块只消费已有payload。质量闸门在多证据决策前追加原因，最终命名不使用低质量文本。前端消费可选quality字段，旧记录兼容。

**Tech Stack:** Python3.12/FastAPI/Pytest、React19/TypeScript/Vitest。

**Spec:** `docs/superpowers/specs/2026-11-04-offline-quality-v5-design.md`

## Global Constraints

- 原件不改动、固定目录/复制/明确确认/可信撤回不变。
- 离线不联网、不下载、不采集真实用户图片。
- 保留图片25s/1536MiB、PDF12s/384MiB、字符12000、批次50/200MiB边界。
- 新用途始终待复核；quality不是分类准确率。
- 分支 `feat/offline-quality-v5`，主基线 `3336fe5`，不推送。

### Task 1: Content quality and candidate rules

**Files:** 新建backend/neatdrop/content_quality.py；改analysis.py/classifier.py/decision.py；新增tests/test_content_quality_v5.py、test_purpose_rules_v5.py。

**Interfaces:** assess_content(payload,image_input)、apply_content_quality(classification,quality)，结果契约见spec。分类ID为study/experiment_material、technical_document、reading_excerpt，office/project_plan、requirements、email，life/warranty、insurance。

- [ ] RED：不可读文字虽有“课程笔记”锚点仍须复核且保留原名；低置信OCR不生成普通票据；正常照片无OCR不得误报文字缺失；抽样不完整保留quality限制；不修改payload。
- [ ] RED：八类锚点+至少两个支持组给对应candidate；filename-only、标题only、否定、教程/模板、与旧类冲突不产生新普通结论。运行 `python -m pytest backend/tests/test_content_quality_v5.py backend/tests/test_purpose_rules_v5.py -q --tb=short` 记录真实失败。
- [ ] 实现固定白名单质量诊断和保守新规则；analyze_local接入并保留低质量原名，不改变云路径。
- [ ] GREEN并跑全部后端、40场景既有评测对照；报告新增/旧类变化，不把开发集视为独立准确率。
- [ ] 提交明确文件：`feat: add offline content quality gates and purpose candidates`。

### Task 2: Readable quality feedback

**Files:** frontend/src/types.ts；新建components/ContentQuality.tsx及test；Inspector.tsx和对应test；readable-theme.css；daily-use.md。

- [ ] RED：limited报告限制与手动核对入口文案，不显示准确率；无quality旧建议不受影响；unknown state安全降级；0.8 OCR值不能展示成80%分类率。
- [ ] 实现ContentQuality组件，默认只显示summary和固定建议，metrics折叠；放在核对任务与目标位置附近，不动预览DOM/key或滚动处理。
- [ ] GREEN：npm test -- --run、npm run build；独立浏览器合成样例验证desktop/mobile、字段展示与切换稳定。
- [ ] 提交：`feat: explain offline extraction quality in file review`。

### Task 3: Verification and version delivery

**Files:** docs/evaluation新增v5开发清单/结果、docs/v5-delivery-2026-11-04.md。

- [ ] 独立审查Task1/2及全分支diff；修正P1/P2并定向复验。
- [ ] 后端完整测试、前端完整测试与生产构建；新类副本/撤回验证，原件摘要不变。
- [ ] 本地优化提交和版本标签，main基线保留；工作树清洁、git log和tag可查；不推远程。

## Progress

- 基线317后端/135前端通过，153文件约1.3MB密钥模式与文件范围检查无异常；真实环境/模型/缓存已ignore。
- Ruling: 第一阶段限定质量诊断和八类保守规则，独立真实评测集需授权来源后再建；若方向不合适，可回到baseline，避免虚报整体精度。
- Task1完成：317旧+155新，完整472通过；八用途88变体、质量9案例，冻结3336fe5旧40场景标签/决策/保原名零变化，保存12图像payload标签/形式零变化。2项review P2已修复并独立复验通过。
- Task2完成：ContentQuality组件与旧数据兼容，141前端测试/TypeScript/生产构建通过。桌面1440×1024与手机390×844质量反馈、导航、确认和副本撤回实测通过。
- Task3完成：主任务独立最终后端472通过52.84秒；合成3文件生成与撤回，摘要一致；review spec pass/quality approved。交付记录见docs/v5-delivery-2026-11-04.md。
