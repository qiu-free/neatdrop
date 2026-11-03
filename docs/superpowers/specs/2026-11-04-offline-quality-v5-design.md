# 离线识别 v5 第一阶段：内容质量与高频用途

用户已要求先保存Git版本再继续优化。当前基线 `3336fe5`、标签 `v0.4.0-baseline`，后端317、前端135测试通过。所有改进在 `feat/offline-quality-v5` 分支、现有目录进行，保留本机模型和配置，不创建第二份运行目录，不推送。

## 交付范围

1. 不改变现有解析预算的情况下，对提取内容增加质量诊断：无有效文字、乱码/不可读字符、依赖OCR但置信度不足、读取不完整。质量描述只说明输入，不能显示为分类准确率。
2. 质量不足不能升级普通建议；低质量文字不得用于自动命名。照片和图表没有OCR文字是合法情况，不因无文字一律拒绝图像类型。真正空白图片仍按既有引擎警告拒判。
3. 首批补充8个现有用途的多证据规则：实验资料、技术文档、读书摘录、项目方案、需求设计、邮件存档、保修说明、保险资料。新规则必须有明确用途锚点与至少两个不同的支持字段组；文件名、孤立标题、否定语境不能支持明确结论；教程/范本保留复核。新用途尚未校准，始终candidate，不能凭合成测试启用ordinary。
4. 详情在当前核对任务附近显示“内容读取质量”，说明限制与下一步；技术指标折叠。兼容没有quality字段的旧建议，不改变确认/复制/撤回。
5. 新增确定性开发回归清单，记录范围、来源、预期和版本，和既有开发集分开；不是独立代表性测试集，不宣传总体准确率。

## 契约

新增可选 `Suggestion.quality`：

```json
{"state":"acceptable|limited|unavailable","issues":["no_readable_text|text_garbled|ocr_low_confidence|partial_read|low_information_image"],"summary":"本地内容读取状态说明","metrics":{"text_chars":0,"readable_chars":0,"replacement_chars":0,"ocr_lines":0,"ocr_mean_confidence":0.0}}
```

`ocr_mean_confidence` 仅真实存在有效置信度时返回；不生成伪概率。指标只保留计数，不再复制正文。issues有限白名单、去重，summary由服务端固定句式生成。state表示读取状态，不保证分类正确。

后端模块 `content_quality.py` 提供 `assess_content(payload: dict, image_input: bool) -> dict`，以及 `apply_content_quality(classification: dict, quality: dict) -> dict`。不得修改调用者输入；保护性原因追加 `content_quality_limited`、`ocr_quality_limited` 等明确review reason；名字策略在analyze_local最终阶段读取质量。原有sampling仍独立存在。

## 不包含

不增加扫描PDF/Office解析、几何图表分类器、本地VLM、自动下载、用户资料收集或训练。BGE默认关闭、网络和资源边界不变。独立授权标注集和统计校准是后续范围，不用这轮合成规则覆盖代替。
