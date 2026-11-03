"""Reproducible synthetic development probes; no personal images or downloads.

Compares the unchanged ten-scene prompts with the expanded prompt set. This
tiny generated set is not an independent accuracy benchmark or a calibration.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.classifier import VISUAL_MAPPING, fuse_image
from neatdrop.decision import decide
from neatdrop.offline import MODEL_DIR, analyze_image_bounded


def draw_probe(kind):
    image = Image.new('RGB', (900, 640), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 25)
    small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18)
    title = {'scatter_plot': 'Simple Scatter', 'line_chart': 'Sample Line Chart',
             'bar_chart': 'Category Comparison', 'histogram': 'Histogram',
             'pie_chart': 'Distribution', 'heatmap': 'Correlation Matrix',
             'box_plot': 'Box Plot', 'flowchart': 'Process Flow'}.get(kind, kind)
    draw.text((300, 22), title, fill='black', font=font)
    if kind in {'scatter_plot', 'line_chart', 'bar_chart', 'histogram', 'box_plot'}:
        draw.line([(90, 90), (90, 550), (840, 550)], fill='black', width=3)
        draw.text((420, 595), 'Sample / Value', fill='black', font=small)
        draw.text((12, 300), 'Count', fill='black', font=small)
        for tick in range(6):
            y = 550 - tick * 90
            draw.line([(83, y), (840, y)], fill='#dddddd', width=1)
            draw.text((52, y - 10), str(tick * 20), fill='black', font=small)
            draw.text((90 + tick * 145, 562), str(tick * 10), fill='black', font=small)
        if kind == 'scatter_plot':
            for index in range(70):
                x = 110 + (index * 137 % 700)
                y = 520 - .48 * (x - 100) + (index * 73 % 100) - 50
                draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill='#3475ad')
        elif kind == 'line_chart':
            points = [(110 + i * 67, 500 - i * 30 - (i % 3) * 38) for i in range(11)]
            draw.line(points, fill='#3475ad', width=4)
            for x, y in points:
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill='#3475ad')
        elif kind in {'bar_chart', 'histogram'}:
            heights = [80, 160, 280, 380, 420, 330, 230, 130, 50]
            width = 75 if kind == 'histogram' else 49
            for i, height in enumerate(heights):
                x = 120 + i * 76
                draw.rectangle((x, 550 - height, x + width, 550), fill='#4690b9', outline='white', width=2)
        elif kind == 'box_plot':
            for i, (low, q1, q3, high) in enumerate([(480, 390, 250, 140), (500, 430, 310, 220), (420, 310, 190, 110)]):
                x = 250 + i * 220
                draw.line((x, low, x, high), fill='black', width=3)
                draw.line((x - 25, low, x + 25, low), fill='black', width=3)
                draw.line((x - 25, high, x + 25, high), fill='black', width=3)
                draw.rectangle((x - 55, q3, x + 55, q1), fill='#afd7ef', outline='black', width=3)
                draw.line((x - 55, (q1 + q3) // 2, x + 55, (q1 + q3) // 2), fill='black', width=3)
    elif kind == 'pie_chart':
        start = 0
        for angle, color, text in [(144, '#4295bc', '40%'), (108, '#f4b16b', '30%'), (72, '#85b57b', '20%'), (36, '#bf9ac8', '10%')]:
            draw.pieslice((230, 100, 690, 560), start, start + angle, fill=color, outline='white', width=3)
            radians = math.radians(start + angle / 2)
            draw.text((445 + 155 * math.cos(radians), 315 + 155 * math.sin(radians)), text, fill='black', font=font)
            start += angle
    elif kind == 'heatmap':
        for row in range(6):
            draw.text((155, 125 + row * 70), f'V{row + 1}', fill='black', font=small)
            draw.text((220 + row * 70, 570), f'V{row + 1}', fill='black', font=small)
            for column in range(6):
                value = 1 if row == column else ((row * 3 + column * 5) % 10) / 10
                color = (int(80 + 170 * value), int(170 - 70 * value), int(210 - 150 * value))
                x, y = 200 + column * 70, 105 + row * 70
                draw.rectangle((x, y, x + 68, y + 68), fill=color)
                draw.text((x + 18, y + 23), f'{value:.1f}', fill='black', font=small)
    elif kind == 'flowchart':
        for y, text in [(100, 'Start'), (245, 'Validate input'), (390, 'Process'), (530, 'End')]:
            draw.rounded_rectangle((320, y, 580, y + 62), radius=12, fill='#e4f0e9', outline='#347459', width=3)
            draw.text((345, y + 15), text, fill='black', font=font)
            if y < 530:
                draw.line((450, y + 65, 450, y + 140), fill='black', width=3)
                draw.polygon([(450, y + 142), (440, y + 125), (460, y + 125)], fill='black')
    elif kind == 'screenshot':
        draw.rectangle((30, 80, 870, 600), fill='#f3f5f7', outline='#777777', width=2)
        draw.rectangle((30, 80, 870, 130), fill='#3f5367')
        draw.rectangle((30, 130, 220, 600), fill='#e2e6eb')
        for i, text in enumerate(['Files', 'Search', 'Settings', 'Help']):
            draw.text((60, 170 + i * 70), text, fill='black', font=font)
        for i, text in enumerate(['Document A.pdf', 'Notes.txt', 'Schedule.md']):
            draw.rectangle((250, 175 + i * 90, 820, 240 + i * 90), fill='white', outline='#bbbbbb')
            draw.text((280, 190 + i * 90), text, fill='black', font=font)
    elif kind == 'illustration':
        draw.rectangle((0, 90, 900, 640), fill='#a9d9ef')
        draw.ellipse((680, 120, 790, 230), fill='#f8d75f')
        draw.polygon([(0, 500), (240, 250), (450, 500)], fill='#6c9b73')
        draw.polygon([(250, 550), (650, 280), (900, 550)], fill='#4a7c6a')
        draw.rectangle((0, 520, 900, 640), fill='#4b9d70')
    elif kind == 'document':
        for i, text in enumerate(['Project report', 'Work progress and next steps',
                                  'This document describes the current project.',
                                  'The team completed planning and validation.',
                                  'Tasks and owners were reviewed this week.',
                                  'Next steps include documentation and review.']):
            draw.text((65, 130 + i * 65), text, fill='black', font=font)
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'docs/superpowers/plans/v4-chart-probes.json')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('baseline_v2', PROJECT / 'scripts/evaluation/baseline_v2.py')
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    kinds = ['scatter_plot', 'line_chart', 'bar_chart', 'histogram', 'pie_chart', 'heatmap', 'box_plot',
             'flowchart', 'screenshot', 'illustration', 'document']
    rows = []
    # This exact cached file has a documented public provenance in the v2
    # delivery report. Never discover images from user workspaces or folders.
    public_photo = PROJECT / '.cache/offline-fixtures/cats.png'
    if public_photo.is_file():
        kinds.append('public_cat_photo')
    for kind in kinds:
        if kind == 'public_cat_photo':
            with Image.open(public_photo) as source:
                image = source.convert('RGB')
        else:
            image = draw_probe(kind)
        payload = analyze_image_bounded(image)
        expanded = decide(fuse_image('probe.png', payload['text'], payload['visual'], payload['warnings']),
                          sampling=payload['sampling'])
        old_visual = [row for row in payload['visual'] if row['label'] in VISUAL_MAPPING]
        old = baseline.fuse_image('probe.png', payload['text'], old_visual, payload['warnings'])
        rows.append({'probe': kind, 'source': 'huggingface/documentation-images/coco_sample.png (existing public v2 cache)' if kind == 'public_cat_photo' else 'deterministic Pillow-generated fixture',
                     'pixels_sha256': hashlib.sha256(image.tobytes()).hexdigest(),
                     'expected_form': 'diagram' if kind == 'flowchart' else 'data_chart' if kind in kinds[:7] else 'natural_photo' if kind == 'public_cat_photo' else None,
                     'ocr': payload['text'], 'visual_top3': payload['visual'][:3],
                     'baseline': {key: old[key] for key in ('category', 'subcategory', 'content_form', 'review_required')},
                     'v4': {key: expanded[key] for key in ('category', 'subcategory', 'content_form', 'decision_level',
                                                           'review_required', 'review_reasons', 'tags')},
                     'warnings': payload['warnings'], 'runtime': payload.get('runtime', {})})
        print(kind, expanded['content_form'], expanded['decision_level'], flush=True)
    args.output.write_text(json.dumps({'scope': __doc__,
                                     'baseline_method': 'Same real CLIP image and prompt embeddings, filtered to the unchanged ten legacy prompts. Cosine scores are independent of additional labels (no softmax). Frozen v2 fusion uses these ten scores.',
                                     'engine_sha256': {name: hashlib.sha256((PROJECT / 'backend/neatdrop' / name).read_bytes()).hexdigest()
                                                       for name in ('classifier.py', 'offline.py', 'analysis.py')},
                                     'clip_manifest': json.loads((MODEL_DIR / 'manifest.json').read_text('utf-8')),
                                     'probes': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
