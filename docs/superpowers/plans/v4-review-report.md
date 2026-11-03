# NeatDrop v4 代码审查

日期：2026-11-03。审查依据：`2026-11-03-taxonomy-workbench-v4.md` 与对应设计文档；直接阅读当前文件，无 Git diff。审查期间实现方继续更新共享目录，因此下列结论区分当前开放问题与已复验的修复。未修改业务代码，未重复运行完整测试。

## 当前开放问题

无已确认的 P1/P2 开放问题。最后一项解析槽竞争已在下述定向复验后关闭。

## 最后一项 P2 的修复与复验

### [P2，已关闭] 预览占满解析槽时，正常分析会直接整批失败

修复位置：`backend/neatdrop/analysis.py:280-296`；相关资源门槛为同文件 `:25-30`。前端关联位置为 `frontend/src/components/Workbench.tsx:341` 与 `frontend/src/previewRequests.ts`。

原问题：`requestPreview` 虽将网格和详情限制为两路，但分析不经过该队列，两路预览与分析仍争用后端同一个 `PREPROCESS_SLOTS = BoundedSemaphore(2)`。两个解析槽均被慢预览占用时，旧版分析的 `prepare_input` 立即抛 `PARSER_BUSY`，`run` 将其记录为文件错误并推进，同一瞬时拥塞可以将整个批次标为失败。

受控复现：将 `_prepare_input` 临时替换为事件阻塞的假解析器，在两个线程调用 `prepare_input` 并确认占满两槽后，创建并运行两个文件的真实 `AnalysisJobs`。没有读取用户文件或写磁盘，退出后恢复函数。实际输出：

```text
{'status': 'completed', 'processed': 2,
 'errors': [{'file_id': 'first', 'code': 'PARSER_BUSY'},
            {'file_id': 'second', 'code': 'PARSER_BUSY'}]}
```

当前修复：仅本地准备阶段遇到 `PARSER_BUSY` 才异步等待并重试，每次间隔最多 50ms、每个文件最多等待约两秒；循环检查取消。等待时不推进文件、不记录永久错误，槽释放后仍处理同一文件。其他解析错误直接返回，云端准备及模型请求均不进入重试路径，因此不会增加云请求次数。双并发门槛保持不变。

本次独立复验：

- 执行 `& .venv/Scripts/python.exe -m pytest backend/tests/test_parser_contention_v4.py -q --tb=short`，结果为 **4 passed in 2.96s**。初次沙箱运行在临时目录 fixture 建立时被系统拒绝，授权后同一命令成功；没有重跑全套。四项覆盖槽释放后继续原文件、等待时取消不产生文件错误、约两秒等待截止，以及云端模型报告同名错误仍只调用一次。
- 复用原受控竞争探针：用两个真正的 `prepare_input` 调用占用两槽，启动两个文件的真实 `AnalysisJobs`，120ms 后释放预览。新结果为 `{'status': 'completed', 'processed': 2, 'successes': 2, 'errors': [], 'elapsed_ms': 141}`。仅临时替换进程内 `_prepare_input` 来模拟慢预览，退出后恢复，没有读取用户文件或写入业务数据。

判定：原瞬态竞争已关闭。持续占满超过两秒时仍返回明确 `PARSER_BUSY`，属于本次修复约定的有界等待行为。

## 审查中发现且已复验的修复

1. **网格与详情使用独立预算，导致三路同时预览。** 初版将两个网格缩略图与详情一起挂载时，首个响应前发出三次请求。当前已改为共享 `previewRequests.ts`，并在取消后等底层 Promise settle 才释放额度。相同 React 渲染探针当前输出 `simultaneous previews before any response: 2`，释放一槽后第三条详情请求才开始。此项在当前版本关闭。
2. **列表遇到未知主分类及子分类会抛异常。** 初版 `subcategories[category][subtype]` 在未来或移除的分类上导致 `Cannot read properties of undefined`。当前 `FileTable.tsx:33` 已使用可选索引并显示“分类待核对”。相同服务端渲染探针已返回 `unknown-category fallback rendered: true`。此项在当前版本关闭。

## 其余核对结果与边界

- 分类运行时由 `TaxonomyProvider` 使用服务端配置；冷启动快照由后端生成。新子类有固定服务端目录，未发现本轮改动重命名旧 ID 或旧目录。计划及撤回仍使用固定目标路径，目录父级继续经过 `allowed_parent` 校验。
- 图表形式在融合结果中与归档用途分开保存；新增结构类型始终带人工复核理由。强文档用途得到保留，文件名/孤立标题不能单独成立为图表，稀疏 OCR 不替换图表原名。未发现生成图中数值或趋势的路径。
- 待复核项可勾选。生成计划前仍逐项检查 `reviewed`，编辑名称或分类清除对应确认和旧计划。执行对话框继续要求显式确认。
- 当前图片身份含工作区、文件 ID、内容摘要；异步旧响应有清理标记，详情预览缓存按大小/数量限额，图片节点按身份替换；缩放按身份恢复适应窗口。详情使用工作区 key 保持 DOM，导航焦点使用 `preventScroll`，窄屏抽屉锁背景滚动并恢复触发焦点。技术证据位于默认关闭的 `details`。
- 上述项目主要为源码审查结论。本审查独立执行了修复前后 React 渲染探针、修复前后解析槽受控并发探针，以及本次四项解析竞争测试；未重跑完整测试。主任务另报告最终后端 317 项、前端 135 项和生产构建通过，桌面/窄屏无横向溢出且切换时滚动与高度稳定，以及新增数据图表分类的复制/撤回合成 smoke 中原件 SHA 不变；这些完整验证由主任务负责汇总，未计作本审查独立执行证据。未使用用户实际图片，未评估总体识别准确率。

结论：本轮审查发现的三项 P2 均已修复并作定向复验，当前无已确认的 P1/P2 开放问题。
