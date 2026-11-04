# Task2：v7 用途候选与开发对照交付

范围为 `classifier.py`、`decision.py`、`classification_profiles.json`、专属测试、评测脚本及下述报告。既有七个子类和固定目录已存在，未新增分类；`content_quality.py` 和 `taxonomy.py` 无需修改。格式解析与位置映射由 Task1、前端位置显示由 Task3 集成。

实现银行材料、公共服务缴费凭证、税务材料、研究数据、工作演示、住房物业、旅行准备七类规则。每类有独立正文锚点、四个同义字段组及至少两组实值证据。缴费项目与成功状态是必需组；研究背景与观测/变量内容是必需组。文件名和格式不参与新用途锚定。字段保留冒号或实际 TAB 分隔，不接受普通空格作为结构证据；空标签不借用下一字段的值。

扩充占位、缺失值、字段否定和教程/教学上下文处理，保留与旧用途/新用途的冲突披露。所有新增用途加入既有 `PURPOSE_LABELS`，决策层在上游复核位丢失时仍重加 `purpose_uncalibrated`。普通物品视觉不能擦除这些明确 OCR 用途候选。规则版本诊断更新为7，质量与决策版本维持原版本。

画像补充独立正例、相邻反例、必要结构，并去除此前对 PPTX/CSV/XLSX 的过期描述。分类表/固定路径未改变。前端已由对应负责方运行 `python scripts/generate_taxonomy.py` 同步公开描述。

测试驱动记录：

- 首次新增七类回归在实现前为 **73 failed, 78 passed**，失败原因是七类规则、复核闸门、OCR保留、示例与冲突功能缺失。
- 真实表格 TAB 字段回归在支持前为 **8 failed, 153 passed**；包括实际 CSV 字节→解析→用途候选用例。之后仅扩展已知字段标签后的 TAB 边界。
- 最终专属及既有分类/决策/质量范围：`python -m pytest backend/tests/test_purpose_rules_v7.py backend/tests/test_purpose_rules_v5.py backend/tests/test_classification.py backend/tests/test_decision.py backend/tests/test_content_quality_v5.py -q --tb=short -p no:cacheprovider`，**362 passed**。
- 最终上述范围加 `backend/tests/test_taxonomy_v4.py`：**388 passed**。临时目录遇到 Windows权限错误后在授权的独立工作区临时目录 `.cache/v7-quality-final-scoped3` 完成。最终集成方负责全量后端/前端验证。
- `python scripts/evaluation/check_quality_v7.py`：**325/325** 行为检查通过；其中七用途168、相邻14、健壮性6、旧40、此前八用途88、质量9。冻结旧40及此前八用途/质量的标签与决策没有变化。

对照固定 Git `3b041c13352027b9bbb169ec0bfa56087cac2683`，使用真实 `analyze_local`，基线12个依赖模块全部由该提交的本地归档加载，不混用当前分类依赖。旧40和旧八用途清单也取自该提交。禁用可选语义推理，未联网、下载模型、访问用户资料、重启旧服务。

详细分母、待复核、拒判、普通错误及逐条记录见 `docs/evaluation/v7-development-results.md` / `.json`。评测输出保存基线、当前源码、画像、输入清单和脚本 SHA256。只证明合成开发场景中的可解释候选覆盖和安全闸门改善，不能推出真实总体准确率。旧40仍为主/子类31/35，原有4个有标签未命中没有被掩盖。

解析收益与用途规则分开记录：评测中的格式扩展名载荷不解码，TAB测试只处理提取后的结构；真正四格式字节解析、复制、资料库、撤回和危险容器由 Task1/根任务报告。没有真实用户代表性评测、独立校准或真人新手试用，因此七类全部保持候选级别。
