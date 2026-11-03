# Offline v3 提取域独立审查

日期：2026-11-03。只读审查 `extraction.py`、`offline.py`、`parsing.py`、`test_extraction.py`、`test_offline.py`；补读 PDF 安全、分析集成测试及交付报告。未编辑提取实现或测试，未创建子代理。

## 审查结论

**冻结版本复审结论：Windows 目标环境内规格符合性通过，本轮三项发现全部解决，无开放 P1/P2。** 配额、原图位置、空间去重、全图 letterbox、工作进程硬预算、云端取样隔离保持通过；CLIP 已使用经过校验的不可变字节，RapidOCR 已在构造期间固定模型文件与祖先目录，PDF 已支持主动取消并验证实际 PID 退出，文本切片已按预算添加换行。

**代码质量：当前范围通过，可继续最终集成。** 独立复跑 **100/100 测试通过**，包括新模型替换、目录固定、PDF 主动取消和换行边界回归，真实 OCR/CLIP 运行成功。没有发现抽样长度越界、OCR 视图超配额、实际解释器残留或云端新增本地数据问题。此结论针对 Windows 当前宿主，不把 Windows 文件共享句柄保证扩展为 POSIX 等效保证；不代表分类准确率或最坏性能已验证。

## 初审发现（现已全部解决，保留复现记录）

### [P1，复审已解决] 模型校验后按路径重新打开，可能加载未经此次校验的内容

位置：`backend/neatdrop/offline.py:138`、`:147`、`:157`、`:169`。

`_load_vision()` 先调用 `_vision_integrity()` 完成模型和 tokenizer 的 SHA-256 校验，随后 `Tokenizer.from_file()` 和 `ort.InferenceSession(str(path))` 再次打开路径。`_load_ocr()` 同样先哈希包内文件，再让 RapidOCR 按默认路径打开模型。如果文件在这两个步骤之间被替换，当前运行可以加载与已校验摘要不同的 bytes，完整性失败不会被本次校验检测到。这与已发现的语义引擎校验/加载窗口相同。

受控读取探针确认调用顺序为 `verification_finished` 后按 `tokenizer.json` 路径打开；损坏模型状态测试仅覆盖校验前已损坏的情况。其影响是失去“仅执行已验证本地推理包”的保证，且原生模型解析器会接收替换后的内容。

建议：在安全的固定读取范围内读出并校验不可变 bytes，然后直接用这些 bytes 初始化 tokenizer/ONNX；OCR 如必须传路径，应使用固定已验证句柄、受控不可变副本或等效的校验与读取一致性机制。回归应在校验完成后替换源文件，证明运行使用已验证 bytes 或明确拒绝加载。已第一时间通知根任务和语义负责人。

### [P2，复审已解决] PDF 解析未接入用户取消，取消后可能继续工作到 12 秒上限

位置：`backend/neatdrop/parsing.py:111`、`:123`；`backend/neatdrop/analysis.py:69`。

图片父进程每 0.1 秒检查取消并终止 native worker；PDF 仍使用单次 `parent.poll(timeout)`，没有 `cancelled` 参数，分析 PDF 分支也未传递回调。因此取消不会立即停止正在解析的 PDF，可能持续占用解析名额直到完成或 12 秒硬超时。当前边界与旧实现一致，工作进程最终可终止，故不是无限资源泄漏。

建议：如取消承诺覆盖 PDF，在默认行为保持兼容的前提下添加可选回调、短轮询并沿用 finally 清理，增加实际 PID 取消测试；否则在说明中明确 PDF 当前可能等待既有硬上限，避免把图片取消能力概括为全部格式都立即停止。

### [P2，复审已解决] 远距离文本切片直接连接会制造原文不存在的词组

位置：`backend/neatdrop/extraction.py:18`。

`sample_text` 用空字符串连接头、中、尾。可以在头段尾部放“个人”、中段开头放“简历”，原文中没有“个人简历”，抽样文本却包含这个规则锚点。局部抽样会强制复核，因此不会把该情形升级为普通建议；但候选与 evidence 的语义可能被人为拼接，跨段 evidence 的原位置也难以成立。

建议：在总 12000 字符预算内预留最多两个换行分隔符，或让分类器按带位置的片段分别读取。增加跨片段词组不应当作连续原文的回归。交付报告已经披露无分隔连接，此处记录为质量改进项。

## 冻结版本复审与新验证

复审期间三项提取生产文件保持冻结，未编辑实现或测试。修复核对如下：

- `offline.py:57` 的 `_pinned_files` 拒绝 reparse 路径，从卷根到模型目录固定祖先目录，并打开拒绝写入/删除共享的模型文件句柄。`_verified_vision_bytes` 在固定句柄内读取并哈希，随后 CLIP 的两个 ONNX session 直接使用这些 `bytes`，tokenizer 使用 `Tokenizer.from_str`；不再重新打开未固定路径。替换源文件的回归证明推理初始化仍消费原始已校验字节。
- `offline.py:190` 的 RapidOCR 构造完整位于三个模型文件的固定句柄上下文内，构造参数显式指定 det/rec/cls 三个已核验路径；其祖先目录同样保持固定到构造完成。Windows 回归在构造函数内部尝试改写模型、重命名 models 目录，均得到 `PermissionError`。reparse 祖先的状态读取返回不可用而不抛出未处理错误。
- `parsing.py:111` 新增可选 `cancelled`，启动前检查并每最多 0.1 秒轮询；取消抛出 `PDF_PARSE_CANCELLED`，沿用 finally 终止、join、关闭 Job Object 与名额释放。分析分支已转发本地取消回调；云端默认参数保持原取样边界。真实 PID 取消回归确认 worker 不再存活，随后正常 PDF 解析成功。
- `extraction.py:13` 为最多两个换行预留总量，从内容配额中扣除；极小预算减少非空段数，仍不超过硬预算。`sampling.separator` 记录换行，分析位置映射已同步适配。附加 3510 个长度/预算组合再次验证原文重建、非重叠及长度上限，全部通过。

独立执行：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_offline.py backend/tests/test_extraction.py backend/tests/test_parsing_security.py backend/tests/test_analysis.py backend/tests/test_analysis_v3.py backend/tests/test_hardening.py -q -s -p no:cacheprovider
```

结果：**100 passed in 29.22s，退出码 0**。真实 child OCR/CLIP 用时 **4328 ms**、峰值工作集 **567.1 MiB**、`network_disabled=true`、无推理警告；新增 byte-buffer 初始化的峰值高于初审，仍低于 1536 MiB 硬上限。恶意 PDF 夹具的 `invalid pdf header` / `EOF marker not found` 为预期输出。

冻结复审的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| extraction.py | `B4F450BE21B1F5FF8ED2EB8B3AB972229486C083990098E7615098F9136B04EB` |
| offline.py | `F5AD6A2EEB56381D36E1A0329502A681A3441FEF7E0A7E585021DBF516661B1C` |
| parsing.py | `548A93C52FFB112FDFB8370569A2CE1E7C1A905E2E63D8605149A855ECEABCEE` |
| test_extraction.py | `316A3F2FF8E684869F3E76A2F73838612EB478928D3BA9FBA5A6ABB9562345A8` |
| test_offline.py | `1F5FBEB30B6702644B8DD5A4CF1992B565FBC03D75759321659D13D55715A551` |

## 初审通过的规格核对

- 默认长文本头、中、尾各最多 4000 字，总量最多 12000；短文本仅一次、无重复和误截断。附加遍历 3510 个长度/预算组合，检查配额、非重叠、原文切片重建均通过。
- 本地 PDF 只提取去重后的第 1、2、中间、末页，最多四页；先保留分隔符预算再分配页配额，尾页不会被前页挤掉。遗漏页面和页内截断都会标为覆盖不足。
- 云端 PDF 仍是前两页加末页、最多 1500 字符，无新增本地 sampling/版面字段；本地改动未扩大云端读取边界。
- 图片最多一个全图加五个局部 OCR 视图，每个实际 OCR 输入最长边不超过 1600；原像素方框合法，首尾覆盖明确。16000px 长图及二维大图配额不足时明确标记局部/预算耗尽。
- OCR 输出保留置信度、原图四边形、来源视图及顺序；缩放后坐标正确映射到输入的 EXIF 规范化图像。空间重叠且文字一致才合并，异处重复文字保留，较高局部识别分数替代旧行。最多 150 行，最终文字最多 12000 字符。
- CLIP 全图改为均值背景的 224×224 letterbox，左右边缘均可见。极端比例图像最多再计算一个局部视图，局部候选单独保留，不覆盖全图候选。
- 图片实际推理受 25 秒、1536 MiB、两并发限制；PDF 保持 12 秒、384 MiB、两并发。资源挂接失败、Pipe 启动失败、超时和 worker 异常均有清理/名额释放路径。
- 实际 Windows 图片/PDF 解释器 PID 与父进程追踪 PID 一致，并已通过超时后实际 PID 不存活测试；不是只检查外层 launcher 状态。图片取消行为当前有耗时/警告验证，取消后的实际 PID 可作为额外加强测试。
- 图片 child 内禁止 Python socket 连接、解析及 UDP 发送后才加载模型。真实 OCR/CLIP 在这一环境中完成；这是 Python 层断网证据，不是 OS 防火墙级隔离声明。
- 本地完整性状态针对真实固定摘要进行检查，缺包/损坏标为不可用；相关状态不会下载模型。其不足限于上文校验与使用之间的竞态。

## 集成衔接已解决事项

初读时 `analysis.py` 未把提取所得 OCR box 交给 evidence。根任务随后新增按文本命中匹配 `ocr_lines` 并复制原图 box 的实现及 `test_matched_ocr_evidence_retains_original_image_location`；已重新读取确认，作为已解决事项记录。正文/标题证据也开始映射到原始采样页/字符位置。

此前根任务评测报告缺实际模型包身份的发现，也已看到新增包 manifest 摘要、revision、version 和依赖版本字段；不再作为当前提取域开放问题。

## 初审独立验证证据

执行：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_offline.py backend/tests/test_extraction.py backend/tests/test_parsing_security.py backend/tests/test_analysis.py -q -s -p no:cacheprovider
```

结果：**43 passed in 24.88s，退出码 0**。真实 spawned OCR/CLIP 返回发票与金额文本、十个视觉候选，无警告；`network_disabled=true`、worker 用时 **4422 ms**、峰值工作集 **345.1 MiB**。实际图片/PDF 超时 PID 测试、图片 1536 MiB 内存限制、PDF 384 MiB 限制、云端 PDF 与读取安全回归均运行通过。恶意 PDF 夹具预期输出 `invalid pdf header` / `EOF marker not found`。

## 初审快照与并发修改（历史）

审查期间提取生产源码保持稳定；提取负责人在本轮前已加入实际 PID 测试。本报告读取的文件摘要如下，后续完整性/取消修复需要重新运行并补充本报告：

| 文件 | SHA-256 |
| --- | --- |
| extraction.py | `66EE46BC7D64BA1B79A8C57F674E33D40639FBFA70FB442A057D932B66321666` |
| offline.py | `6C15FC1F6F36B7DFD461EFCB897092AA89E40A6C658B4EB3DDADF8FCE9E8C0EE` |
| parsing.py | `4C5972549EE7E4B3B124437F54109A888C9A9E34EAE7560689F3C2F4E895B63A` |
| test_extraction.py | `93BE1D88228E4E66F8666EB4923F5614F8D955676BFB2337CEFB9D00F5EFB616` |
| test_offline.py | `328D92EF576A341C3A77A25E12D7FAAF1ACD9A428801C13F0149B833C10584EC` |
