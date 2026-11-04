# v7 实施计划

Spec: docs/superpowers/specs/2026-11-04-offline-formats-onboarding-v7-design.md
Base: 3b041c1. Branch feat/offline-formats-onboarding-v7，沿用已建立的原目录分支开发方式。

## Global Constraints

- 本地离线优先，不自动下载模型、不静默联网或云端降级。
- 原件保留、固定分类目录、独占创建、哈希校验、可信记录撤回和最终复制确认保持。
- 保留路径/根身份/链接拒绝、20MiB单文件、50文件/200MiB批次、两槽解析和有界子进程。
- 用户资料不写入浏览器持久存储，不自动采集真实训练/评测内容。
- 旧服务重启此前被拒绝；本轮不停止或重载该服务，验证使用已授权的独立进程内测试桥接，明确运行状态。

## Task 1：新增格式提取及API集成

Own backend/neatdrop的新解析模块、files.py、analysis.py、parsing.py、app.py与相关测试。先写真实OOXML/CSV字节测试观察失败，增加严格有界无执行提取和隔离worker，复用prepare_input/API/可信归档；配置可发布supported_extensions供前端说明消费。不得编辑classifier/decision/画像（Task2）。精确限制写在报告里。单元+API+安全回归通过后提交。

## Task 2：用途候选、证据位置与开发对照

Own classifier.py、decision.py、content_quality.py、classification_profiles.json、taxonomy.py及专属测试/评测脚本。先测试新7类及邻类反例，补规则与candidate-only闸门、可解释必要证据；已支持内容字段可产生候选，但格式不决定用途。内容位置的UI展示由Task3，提取器位置保留由Task1。冻结旧基线和开发对照记录结果/分组/指纹，报告限制。测试通过后提交。

## Task 3：新手工作流、顺畅导航、格式与证据UI

Own frontend全部文件。先写导览/演练真实语义回归：完整6阶段、演练无网络、选择独立、改类清审核、两次确认、资料库和撤回、跳过与完成区分并兼容旧进度。新增共享旅程定义、稳定页面状态/滚动/焦点与过渡、减少动态；新增格式提示和错误文案、证据位置可读显示。复用主题不做整体重设计、不加动效依赖。目标当前页唯一可访问、隐藏页不能预览请求/锁滚动。分组测试后提交。

## Task 4：审查与集成验收

独立审查前三任务并修复。主任务全量后端/前端+构建；当前ASGI桥接真实新格式流程、桌面/手机截图与焦点/动画/草稿检查；记录不支持边界和缺少真人试用/代表性评测，不声称总体准确率。补README/daily-use/交付文档，保存Git提交和新标签，不推送/合并/重启旧服务。
