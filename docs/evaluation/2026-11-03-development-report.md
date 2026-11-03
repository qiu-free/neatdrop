# 离线分类开发集对照

Development fixtures; not independent production accuracy evidence.

Frozen v2 classifier. Inline text uses v2 first-12000 sampling; explicit file paths share v3 extraction across stages. Path results compare classifiers only, not v2/v3 extraction.

Manifest SHA-256: `76524ab434b3561010361575cbda1873abd96900e4ec90d43a29bc46ea461259`

| 阶段 | 样本 | 子类首选命中 | Top-3 | 普通建议/错误 | 待复核 | 拒判 | P95 秒 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 40 | 29/35 | 29/35 | 28/1 | 12 | 9 | 0.00032369999098591506 |
| rules | 40 | 31/35 | 31/35 | 22/0 | 18 | 7 | 0.0006139000033726916 |
| semantic | 40 | 31/35 | 31/35 | 22/0 | 18 | 3 | 1.1350355000031414 |
