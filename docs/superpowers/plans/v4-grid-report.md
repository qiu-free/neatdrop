# FileGrid v4 交付记录

完成日期：2026-11-03。

## 文件范围

- `frontend/src/components/FileGrid.tsx`
- `frontend/src/components/FileGrid.test.tsx`
- `frontend/src/components/file-grid.css`

另按任务要求写入本报告。未修改 Workbench、Inspector、types、FileTable 或 useWorkspace。未使用 Git，未派生子代理。

## 已实现行为

组件接收父级已筛选的文件与选择、当前查看、编辑、建议、确认、错误状态。主分类/子分类标签通过可选 `taxonomy` 传入；缺失时回退建议或编辑的分类 ID。卡片展示原文件名、合并的一行分类和确认状态。非图片显示既有 FileIcon，不请求内容预览。

规则网格采用固定 4:3 缩略图区域；图片以 contain 显示，加载、失败共用相同区域。森林绿选中与查看状态有独立反馈；查看按钮和选择框为相邻独立控件，选择不会改变当前查看，更不会确认文件。待复核文件允许勾选，暂不支持的文件和 `selectionDisabled` 会阻止选择；查看仍可用。

图片预览沿用本地 API。每卡按工作区 ID、文件 ID、SHA-256 标记预览身份；无摘要时使用修改时间与大小。身份变化重建缩略图表面，旧响应不会显示在新文件下。组件卸载时取消请求并释放自身图片状态；不写浏览器存储，也没有组件外图片缓存。

有 IntersectionObserver 时，在距视口 160px 内才开始加载；无此能力时直接排队。所有挂载网格共享最多两个活动缩略图请求。已排队的取消项立即移除，活动请求取消时 AbortController 中止并释放名额；后续排队调度推迟一个微任务，避免同批卸载时启动马上要删除的卡片。

查看按钮支持方向键及 Home/End，按实际网格布局计算上下移动列数，越界停留；调用 focus({ preventScroll: true }) 且阻止方向键原生滚动。悬浮仅改变颜色，不选择或切换文件。选择标签触控区域至少 44px；容器较窄时为两列，再窄为一列，卡内文字省略而不横溢。颜色过渡为 150ms，并支持 prefers-reduced-motion。

## 验证证据

先写 12 个真实组件行为测试，以空实现运行，12 项失败；再实现并验证 12 项通过。后续增加文件身份、失败和边界覆盖，新增首/末行箭头测试捕获跨列错误，修复后最终全部通过。

```text
cd frontend
npm test -- --run src/components/FileGrid.test.tsx
Test Files 1 passed (1)
Tests      17 passed (17)
```

最终测试执行于 2026-11-03 19:31 本地时间，无 React act 警告。首次命令因沙盒 spawn EPERM 无法启动 Vitest，按要求升级后运行上述命令。

```text
cd frontend
npx tsc --noEmit
exit 0
```

覆盖内容：待复核勾选不自动确认、查看/选择分离、选择禁用、父传标签/无标签回退、混合文件图标、工作区/文件 ID/摘要/扫描元信息变化、旧响应隔离、两请求并发、取消不阻塞后续、近视口加载、卡片卸载后重新请求、请求和解码失败、键盘导航、焦点 preventScroll 和首末行边界。

## 验证边界与局限

本任务范围只包含可集成组件；Workbench 的切换入口与布局接入由父任务完成。本报告中的自动化运行于 jsdom，网络层被 mock，证明组件处理响应和取消的行为，不证明浏览器中的真实解码耗时、服务端并发或内存上限。固定比例、窄屏布局、颜色对比与真实页面滚动仍需父任务接入后用浏览器实测。未做外部上传、模型调用或真实用户图片持久化。

单卡已加载预览会在本卡挂载期间保留，取消客户端请求也不代表服务端已开始的处理瞬间结束。最初网格内的独立调度及不重试行为已由下述审查修正替代。

## 共享预览调度修正（2026-11-03 追加）

审查发现网格内部两个缩略图请求与 Inspector 的独立请求可以同时调用预览 API，超过后端两个解析名额，并使 PARSER_BUSY 永久停留在缩略图错误状态。本次改为共享 `frontend/src/previewRequests.ts`，对外导出：

```ts
requestPreview(path: string, signal?: AbortSignal): Promise<Preview>
```

FileGrid 已替换原模块内队列并调用此接口。Inspector 接入由父任务完成；本子任务没有修改 Inspector。新增测试文件为 `frontend/src/previewRequests.test.tsx`。

调度器在同一前端模块上下文共享最多两个实际未完成的 API 调用。排队项和重试延迟中的 signal 取消会立即移除任务并以 AbortError 拒绝；活动请求收到取消时立即拒绝调用者，但仍计入并发，直到底层 API promise 真正结束，防止忽略 signal 或稍迟结束的旧调用与新请求合计超过两个。后续调度推迟到微任务，避免同一卸载批次启动待删除文件。模块不保留结果，也不持久化图片。

只对 `error instanceof Error && error.message === explain('PARSER_BUSY')` 做重试，延迟分别为 200ms、400ms，最多两次，合计最多三次实际请求。重试等待期间不占并发名额，普通错误不会重试。次数用尽后仍返回原错误，界面显示“预览不可用”。服务端已开始的工作可能在客户端中止后继续短暂占用名额，有限重试用于覆盖此类竞争，不保证繁忙服务必然恢复。

TDD 证据：先用直接转发 API 的最小实现运行新增八项测试，其中七项按预期失败，明确复现“两网格请求＋第三消费者＝三个 API 调用”，并捕获排队取消、活动取消、忙碌重试、重试上限和已取消 signal 等缺失。实现后新增“重试等待不占名额”覆盖。旧 FileGrid 的取消测试同步改为等待底层调用结束后才断言下一项启动。

```text
cd frontend
npm test -- --run src/previewRequests.test.tsx src/components/FileGrid.test.tsx
Test Files 2 passed (2)
Tests      26 passed (26)
```

上述针对性测试执行于 2026-11-03 19:47 本地时间，无 React act 警告。测试使用真实调度器与真实 FileGrid，mock API 慢响应及错误；不使用常量镜像测试。该模块的并发限制只覆盖调用它的消费者，与后端其他分析任务的竞争仍由服务器解析名额和有限重试处理。

父任务接入 Inspector 后，完整测试发现 `Workbench.test.tsx` 的 beforeEach 使用不结束且忽略 abort 的默认 API promise，导致前序用例卸载后两个真实 promise 仍占名额。先独立复现 Workbench 18 项中 1 项失败（读不到 Stable preview），随后仅修正测试替身：每次调用创建 pending promise，监听 AbortSignal，以 AbortError 拒绝。生产调度器保留严格的实际 promise 预算。检查 Inspector 测试中慢响应都显式完成，没有同类默认替身问题，因此未改动其测试。

```text
cd frontend
npm test -- --run
Test Files 18 passed (18)
Tests      135 passed (135)

npx tsc --noEmit
exit 0
```

完整前端测试最终执行于 2026-11-03 19:54:51 本地时间，用时 8.77s，无控制台警告；类型检查随后通过。补充修改范围为 `previewRequests.ts`、`previewRequests.test.tsx`、`FileGrid.tsx`、`FileGrid.test.tsx`、`Workbench.test.tsx` 和本报告。
