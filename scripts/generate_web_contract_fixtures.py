"""Generate explicit shared learning-subset expectations from production rules."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from neatdrop.classification_pipeline import classify_payload

cases = [
    ('notes', '课程笔记\n定义：矩阵对应线性映射。定理：矩阵秩等于独立向量数量。证明：用初等变换求阶梯矩阵。例题：求三阶矩阵的特征值。'),
    ('experiment', '光学实验记录\n实验目的：测量凸透镜焦距。实验器材：凸透镜和光源。实验步骤：调整物距并测量像距。实验结果：五次测量均值12.4厘米。'),
    ('paper', '光学研究论文\n摘要：研究凸透镜焦距的误差传播。关键词：光学；焦距。研究方法：采用重复成像测量。结果：误差减小。结论：固定光源能稳定成像。参考文献：人工构造资料。'),
    ('unknown', '明天买一些水果和蔬菜，然后去公园走路，天气很好，晚上在家休息。'),
    ('tutorial', '这是如何填写实验报告的教程，不是实验记录。示例：实验目的：占位。实验步骤：待填写。实验结果：无。'),
]
rows = []
for identifier, text in cases:
    result = classify_payload({'id': identifier, 'name': 'misleading-invoice.txt', 'extension': '.txt'}, {'text': text, 'sample': 'shared subset contract'})
    rows.append({'id': identifier, 'text': text, 'category': result['category'], 'subcategory': result['subcategory']})
path = ROOT / 'frontend/src/experience/sharedContract.generated.json'
path.write_text(json.dumps({'scope': 'five explicitly shared content contracts; web review policy differs', 'cases': rows}, ensure_ascii=False, indent=2), encoding='utf8')
