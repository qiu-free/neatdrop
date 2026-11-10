# 网页运行范围

`npm run build:experience` → `dist-experience`，随后`npm run preview:experience -- --port 8770`。

本目录的规则是保守的学习用途子集。`studyProfiles.generated.json`来源于后端画像；`sharedContract.generated.json`用`scripts/generate_web_contract_fixtures.py`生成五项明确共享用途输入/期望，不代表全部Python逻辑等价。浏览器建议全部需复核。

8份原创学习文本、4份原创合成图片均以CC0-1.0提供。图片由`scripts/generate_experience_records.py`程序绘制，`records/results.json`为2026-11-11本机RapidOCR+生产规则实际输出；图像模型关闭。预录时间/原图SHA/读取范围保留，不作为独立质量样本或性能P95。程序仅生成测试图像，不读取个人文件。

主动选择UTF8 TXT/MD≤10，512KiB/份，2MiB合计；分析≤12000字符。纯文本预览，无HTML执行/URL自动访问，不保存正文。结果只在页面内存，刷新即清空。JSON/CSV导出仅整理元数据，CSV公式前缀保护。

本地构建别名排除本目录输入数据/Worker；网页构建别名替换API和能力对象、排除本地设置组件。构建后均有产物检查。网页使用经典静态资源与模块Worker，部署平台需要允许同源Worker。预览地址不是公开参赛链接。
