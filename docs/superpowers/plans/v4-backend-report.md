# v4 后端实施报告

日期：2026-11-03。范围：实施计划第1、2项，以及网格预览与分析竞争预处理名额的复核修正。没有 Git 仓库，未提交。没有改动服务端口8765上的用户工作台。

## 修改

- `backend/neatdrop/taxonomy.py` 保留9个主类和全部35个旧子类的ID、标签、目录；在现有域下新增22个用途，共57子类。新增用途支持已有TXT、MD、PDF、PNG、JPG、JPEG、WEBP格式的手动归档，未新增开发、媒体、电子表格或演示文稿格式解析。
- 每个子类公开独立 `descriptions` 文案，定义、例子和反例来自同一份后端 `classification_profiles.json`，没有在前端另建分类定义。57份语义profile完整覆盖分类；55个非兜底profile仍仅候选，实验开关默认不启用。
- `scripts/generate_taxonomy.py` 可从任意工作目录重复生成 `frontend/src/taxonomy.generated.json`，根结构固定为 `{taxonomy, content_forms}`。默认命令：`.venv/Scripts/python.exe scripts/generate_taxonomy.py`。也支持 `--output <path>`。输出UTF-8、LF、稳定顺序，测试与 `/api/v1/config` 对比并重复生成验证。
- 现有本地CLIP由10个场景扩至20个标签，补七类数据图表、流程图、结构图和表格影像提示；保留既有权重、哈希校验、CPU执行、网络禁用、25秒推理预算、1536MiB内存上限及取消路径。
- 图表内容形式与归档用途分离。视觉分数达到 `.285` 且与首位差不超过 `.025` 才保留新类型候选；这是开发保护门槛，未经独立校准。多种类型接近时只保留 `data_chart` / `diagram` 等宽泛标签。所有新结构形式需要复核，不能给普通建议。
- 强OCR文档用途保留，例如工作报告仍归工作办公/报告，内容形式可以是数据图表。仅标题、`Figure` 文件名、图例单词不能证明图表。无独立用途证据时提供待确认用途候选。稀疏图表OCR不替换原文件名，不还原数值、不生成趋势结论。
- 新标签未达到门槛时不挤压旧十类之间的照片判断差距，避免公开猫图由自然照片退化为拒判。
- `AnalysisJobs.run` 只对本地输入准备的瞬态 `PARSER_BUSY` 最多等待2秒，每50ms检查取消并重试。预处理函数拒绝名额时还未启动解析器，因此不重跑已启动解析，不改变单次预算。云请求与其他解析错误不会重试。直接预览仍保留非阻塞资源门槛。

## 分类和标签契约

`taxonomy[group]` 为 `{label: string, directory: string, subcategories: Record<string,string>, descriptions: Record<string,string>}`。返回值复制子类字典，调用方不能通过修改config改变进程内可信路径。旧平级目录及旧嵌套目录仍允许执行、查记录和撤回。

| 主类 | 新增子类ID → 标签 |
| --- | --- |
| study | data_chart → 数据图表；experiment_material → 实验资料；research_data → 研究数据；technical_document → 技术文档；reading_excerpt → 读书摘录 |
| office | spreadsheet → 表格数据；presentation → 演示资料；project_plan → 项目方案；requirements → 需求设计；email → 邮件存档 |
| social | icon → 图标标志；ui_design → 界面设计；diagram → 流程架构图；reference → 参考素材 |
| life | family → 家庭资料；warranty → 保修说明；property → 住房物业；insurance → 保险资料；travel_material → 旅行资料 |
| finance | bank_material → 银行材料；utility_payment → 缴费凭证；tax_material → 税务材料 |

新增内容形式：`data_chart` 数据图表，`table_image` 表格影像，`diagram` 流程结构图。形式和类型标签都不生成目录；仅category/subcategory通过服务端固定表决定一个目的地。

视觉类型ID：`scatter_plot` 散点图、`line_chart` 折线图、`bar_chart` 柱状图、`histogram` 直方图、`pie_chart` 饼图、`heatmap` 热图、`box_plot` 箱线图、`flowchart` 流程图、`diagram` 结构图、`table_image` 表格影像。拒绝细分时tags保留宽泛形式ID；原始视觉Top-3仍以diagnostic候选返回。

新增复核理由：

| Key | 建议中文 |
| --- | --- |
| visual_type_uncalibrated | 图表或结构类型尚未校准，请核对 |
| visual_purpose_uncalibrated | 内容类型已有线索，归档用途需要你确认 |
| visual_type_ambiguous | 多个图表类型相近，请确认具体类型 |

## RED / GREEN 证据

沙箱首跑pytest遇默认临时目录权限失败，真实推理沙箱子进程返回 `inference_failed`；按工具规则升级权限后运行，未以权限错误作为预期功能失败。

1. RED：`.venv/Scripts/python.exe -m pytest backend/tests/test_taxonomy_v4.py backend/tests/test_chart_fusion_v4.py -q --tb=short` → **38 failed, 5 passed**。失败覆盖新增固定目录、独立定义、config别名修改、生成脚本、新图表形式、冲突和原名保留。
2. 初次完整GREEN：`.venv/Scripts/python.exe -m pytest -q --tb=short` → **310 passed in 50.31s**。
3. 真实推理暴露截图弱图表候选与照片margin退化。补RED：`.venv/Scripts/python.exe -m pytest backend/tests/test_chart_fusion_v4.py -q --tb=short` → **2 failed, 18 passed**；收紧门槛及旧标签margin后完整GREEN → **312 passed in 49.77s**。
4. 补全部旧路径兼容契约后完整GREEN → **313 passed in 51.53s**。
5. 预览slot竞争RED：`.venv/Scripts/python.exe -m pytest backend/tests/test_parser_contention_v4.py -q --tb=short` → **3 failed, 1 passed**。真实占用两个预处理slot后复现本地文件立即永久失败、取消来不及、无等待；云请求不重试检查原已通过。
6. 修复后针对性GREEN：`.venv/Scripts/python.exe -m pytest backend/tests/test_parser_contention_v4.py backend/tests/test_analysis.py backend/tests/test_analysis_v3.py -q --tb=short` → **28 passed in 14.40s**。
7. 最终完整GREEN：`.venv/Scripts/python.exe -m pytest -q --tb=short` → **317 passed in 53.56s**。覆盖全部后端测试，包括真实OCR/CLIP、模型完整性、资源预算、取消、路径、执行及可信撤回。

## 真实离线模型开发对照

可重复命令：`.venv/Scripts/python.exe scripts/evaluation/check_charts_v4.py`。结果见同目录 `v4-chart-probes.json`，包括OCR、Top-3、旧基线、v4结论、拒判原因、耗时、峰值内存、网络禁用状态、引擎指纹和CLIP固定manifest。

样本为8张确定性Pillow生成图表、3张生成对照，以及既有报告注明来源的公开模型文档猫图缓存（`huggingface/documentation-images/coco_sample.png`）。没有发现、读取或复制用户图片；没有下载或外传。

旧十类基线使用同一次真实CLIP图像编码与原提示的cosine分数，过滤新增提示后交给冻结v2融合。cosine没有softmax归一化，不因新增标签改变旧分数，因此不需要重复加载权重得到同一组旧分数。

| 开发探针 | 旧十类形式 | v4形式/决策 | 具体类型 |
| --- | --- | --- | --- |
| 散点、折线、柱状、直方、饼、热、箱线（7张） | 均unknown | 均data_chart / candidate | 接近候选较多，全部保留宽泛data_chart标签 |
| 流程图 | unknown | diagram / candidate | flowchart与diagram接近，保留宽泛diagram |
| 合成应用截图 | unknown | unknown / abstain | 未新增图表候选 |
| 合成风景插画 | document_image | document_image / ordinary | 沿用既有OCR illustration标题规则，形式仍有局限 |
| 合成英文报告文档 | unknown | unknown / abstain | 未新增图表候选；英文用途仍未覆盖 |
| 公开猫照片 | natural_photo | natural_photo / ordinary | photos/pet保持 |

最终这12张开发探针的单次工作子进程耗时约 **3.91–5.78秒**，峰值工作集约 **602–612MiB**，全部 `network_disabled: true`、无引擎警告，低于现有预算。图表输出均需复核，未产生图表用途的普通建议。

这不是独立评测集，不能据此宣称图表准确率、总体准确率或真实用户照片不退化。没有部署新的结构几何提取器；本轮是现有CLIP提示与保守融合基线。图表细分仍相互混淆，研究/办公/个人用途仍须上下文与人工确认。未校准新增用途仅手动或语义候选支持，不保证自动规则识别。
