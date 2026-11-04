# v6 资料库前端交付记录

Task 3，分支 `feat/archive-library-review-v6`。实现主导航“资料库”及工作台 `active` / `onLibrary` 接线，工作台继续挂载以保留草稿。

资料库仅通过当前授权 workspace 的列表 API 读取记录；每次进入、授权目录改变、历史改变或手动刷新时重新读取，使用 AbortController 丢弃过期结果。没有目录时显示返回工作台选择目录的空态。列表提供主分类、文件名搜索和数量，展示日志中的来源、实际相对路径、生成日期、大小及 available/missing/changed/unverified 状态。available 文案是“可预览”。没有新增依赖、上传逻辑或目录的浏览器持久存储。

右侧预览初始关闭，仅点击文件按钮时打开。通过共享 `requestPreview` 保留全局预览并发预算，按不透明 entry ID 请求已有 Preview JSON，关闭、切换文件或离开页面时取消请求。每次重开或切回副本都重新核验，不缓存旧内容。图像仅允许本地服务返回的 PNG/JPEG/WebP data URI；来源和目标路径仅作为文本展示。副本不可用时展示友好说明，不发起读取。已补全四个 LIBRARY_ENTRY 错误映射。

侧栏使用 portal，具备关闭按钮、遮罩、Escape、Tab 边界与焦点约束、焦点还原、背景 inert 与滚动锁。切换文件保留同一侧栏与固定高度预览容器，长文件名、来源和路径可折行，移动端占满可用宽度。

## 验证证据

- TDD：先新增 App 导航测试并观察因缺少“资料库”按钮失败，再实现接线，App 3/3 通过。
- TDD：新增 LibraryPage 7 个测试并观察 7/7 因缺少列表和侧栏行为失败，实现后与 App 合计 10/10 通过。
- 追加快速切回文件回归测试，先观察旧预览内容残留导致失败，再在新请求开始时清空旧状态。最终 `npm test -- --run src/components/LibraryPage.test.tsx src/App.test.tsx`：2 个文件、11 个测试全部通过。
- 最终 `npm run build`：TypeScript 与 Vite 成功，1599 modules，产物 `index-CJpKcyhF.css` / `index-7afJ581K.js`。
- `git diff --check`：无空白错误，仅仓库现有 LF→CRLF 提示。

测试覆盖分类搜索与计数、实际路径日期、初始关闭、预览 ID 路由、重开核验、不可用原因、快速切换和过期响应、目录变化与历史刷新、侧栏 Escape/遮罩/Tab/焦点还原/滚动还原/卸载清理、读取错误重试和截断提示。桌面及移动端真实浏览器合成流程由 controller 统一执行。

## 浏览器选择器

- 主导航按钮：`资料库`
- 分类 select：`主分类`
- 搜索框：`搜索资料库文件名`
- 文件按钮：`查看 {name}`
- dialog：`归档副本详情`
- 关闭按钮：`关闭资料库详情`
- 遮罩按钮：`关闭资料库详情遮罩`
- 相邻文件按钮：`上一个归档副本` / `下一个归档副本`
- 无目录 CTA：`返回工作台选择目录`
