"""Author synthetic CC0 pages and record actual installed local OCR/classifier outputs."""
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def main():
    from PIL import Image, ImageDraw, ImageFont
    from neatdrop.offline import analyze_image_bounded
    from neatdrop.classification_pipeline import classify_payload
    from neatdrop.taxonomy import taxonomy_config
    directory = ROOT / 'frontend/src/experience/records'
    directory.mkdir(exist_ok=True)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 25)
    title = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 38)
    samples = [
        ('board', '课堂板书 · 人工构造', ['线性代数课程笔记', '定义：线性映射保持向量加法和数乘。', '定理：矩阵的秩等于线性无关列向量个数。', '证明：用初等变换构造阶梯矩阵。', '例题：求三阶矩阵的秩，复习特征值。']),
        ('chart', '透镜实验图表 · 人工构造', ['光学实验记录', '实验目的：测量凸透镜焦距。', '实验器材：光学平台、透镜、刻度尺。', '实验步骤：改变物距并记录像距。', '实验结果：焦距均值12.4厘米。', '图表用途仍需人工核对，不推断研究主题。']),
        ('slide', '课程课件影像 · 人工构造', ['线性代数课程课件', '第三讲：矩阵与线性映射', '学习目标：理解矩阵秩、基与特征值。', '教学安排：两学时讲授与课堂讨论。', '章节一：定义，章节二：证明与例题。']),
        ('paper', '论文扫描页 · 人工构造', ['光学透镜研究论文', '摘要：研究焦距测量中物距像距的误差。', '研究方法：改变光源位置，记录成像。', '结果：重复测量降低误差。', '结论：固定光源有利于稳定成像。', '参考文献：人工构造，无对应真实论文。']),
    ]
    records = []
    for identifier, heading, rows in samples:
        image = Image.new('RGB', (1100, 820), '#ffffff')
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 1100, 115), fill='#e9f1ff')
        draw.text((50, 36), heading, font=title, fill='#173e70')
        for index, row in enumerate(rows):
            draw.text((55, 160 + index * 65), row, font=font, fill='#243447')
        draw.text((55, 765), 'NeatDrop 原创合成样例 · CC0-1.0 · 不作为准确率评测资料', font=font, fill='#506278')
        path = directory / (identifier + '.png'); image.save(path)
        started = time.monotonic()
        payload = analyze_image_bounded(image, use_vision=False)
        elapsed = round((time.monotonic() - started) * 1000)
        record = {'id': identifier, 'name': identifier + '.png', 'extension': '.png'}
        suggestion = classify_payload(record, {**payload, 'local_image': True})
        group = taxonomy_config()[suggestion['category']]
        records.append({'id': identifier, 'title': heading, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'license': 'CC0-1.0', 'created': '2026-11-11', 'elapsed_ms': elapsed,
                        'engine': 'Installed RapidOCR CPU / production rules; vision explicitly disabled',
                        'text': payload.get('text', ''), 'sampling': payload.get('sampling'),
                        'warnings': payload.get('warnings', []), 'runtime': payload.get('runtime'),
                        'category_label': group['label'], 'subcategory_label': group['subcategories'].get(suggestion['subcategory'], '仅主类'),
                        'suggestion': suggestion})
        print(identifier, elapsed, len(payload.get('text', '')), suggestion['category'], suggestion['subcategory'], flush=True)
    (directory / 'results.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
