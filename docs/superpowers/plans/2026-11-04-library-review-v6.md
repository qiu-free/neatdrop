# v6 实施计划

Spec: `docs/superpowers/specs/2026-11-04-library-review-v6-design.md`
Base: ff573d7, branch feat/archive-library-review-v6. 保留 v0.4/v0.5 标签，在现有目录开发。

## Global Constraints

- 本机离线优先；不新增网络调用或模型下载。
- 原件保留；复制执行必须有独立最终确认；不新增删除操作。
- 资料库的文件读取只来自验证过的日志与本机可信回执，不能接受客户端文件路径。
- 保留现有路径、根目录身份、链接拒绝、读取预算、可信撤回与服务安全检查。
- 不引入新依赖；主题延续；桌面和移动端可访问。

## Task 1: 后端可信资料库

Owner backend agent. Backend only. TDD 新资料库读取/预览 API，复用安全读取、日志验证和回执校验，符合 spec API。写 backend report，提交自己的文件。

## Task 2: 简化审核和工作台详情

Owner workspace agent. Own useWorkspace.ts, Workbench.tsx, FileTable.tsx, FileGrid.tsx, Inspector.tsx, tests thereof, workspace-flow.css, main.tsx import. 增加 approveSelected、active/onLibrary props，按 spec 审核资格。实现统一按需侧栏，checkbox 不打开。保留缓存/稳定布局/最终确认。TDD 并报告提交。

## Task 3: 资料库前端与导航

Owner library agent. Own types.ts, App.tsx, Sidebar.tsx, LibraryPage.tsx, library.css and tests thereof. 消费 Task1 API 与 Task2 `active`/`onLibrary` props。资料库独立可访问侧栏、分类搜索、状态，空态可返回工作台选择目录。每次进入/目录或历史改变时刷新，取消旧请求。TDD 并报告提交。

## Task 4: 审查、集成验证和版本保存

Controller dispatch scoped and broad reviewer(s), address findings via implementers, run complete backend/frontend tests+build. Synthetic browser E2E desktop/mobile, copy persistence/preview/undo/source hashes. Write delivery report; commit/tag local version. 不合并或推送。
