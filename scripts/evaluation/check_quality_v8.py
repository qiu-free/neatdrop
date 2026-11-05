"""Compare reviewed content recall and false ordinary advice with frozen v7.

Synthetic development diagnostics only. No user files, model calls or network.
The old v7 invariant checker remains untouched; explicitly permitted v8 changes
are reviewed here rather than rewriting its frozen expected behavior.
"""
import argparse
import hashlib
import importlib
import json
import os
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from neatdrop.analysis import analyze_local
from neatdrop.extraction import sample_text
import check_quality_v7 as prior

BASELINE = '281f11ade433d4a1e02f7f895423f83814b630dd'
ENGINE_FILES = ('analysis.py', 'classifier.py', 'content_signals.py', 'decision.py', 'content_quality.py',
                'extraction.py', 'taxonomy.py', 'classification_profiles.json', 'safe_io.py')
ALLOWED_LEGACY_CHANGES = {'invoice-tutorial', 'informal-study', 'research-narrative', 'meeting-informal',
                          'meme', 'misleading-name'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def diagnostic_records():
    examples = [
        ('study-process', '今日复习高等数学\n极限存在时可以运用洛必达法则。整理了三道求导问题和计算步骤。', 'study', 'notes'),
        ('database-learning', '今天自学数据库的事务与隔离级别，整理了练习题和解题思路。', 'study', 'notes'),
        ('research-narrative', '我们考察了一种新的信号降噪方法，比较实验表明误差降低。本文给出实验设置、结果讨论及相关文献。', 'study', 'paper'),
        ('research-model', '本研究提出新的分类方法。对照实验检验模型，结果表明显著提高检索表现。', 'study', 'paper'),
        ('meeting-actions', '周二大家一起讨论下一版发布。王同学负责界面，李同学负责测试，约定下周复查进度并提交讨论结论。', 'activity', 'meeting'),
        ('meeting-delivery', '团队商议本月交付安排，陈青负责汇总缺陷。双方决定周五复查。', 'activity', 'meeting'),
        ('business-sales', '2026年销售台账\n日期\t客户\t商品\t数量\t含税金额\n2026-11-01\t南城店\t办公椅\t3\t1497', 'office', 'spreadsheet'),
        ('business-stock', '库存清单\n物料\t数量\t仓库\n螺栓\t150\t一号库', 'office', 'spreadsheet'),
        ('requirements-alias', '净匣需求说明\n使用场景：离线整理本地文件\n功能需求：扫描目录并展示分类\n验收标准：保留原件', 'office', 'requirements'),
        ('bank-alias', '账户业务办理确认\n开户银行\t无锡银行\n账户名称\t林青\n银行账号\t623456789012', 'finance', 'bank_material'),
        ('learning-quotation', '票据识别算法教程\n下面引用一个增值税电子普通发票示例。\n发票号码、购买方、销售方、价税合计均为示例字段。\n请勿作为真实票据使用。', 'study', 'notes'),
        ('contract-teaching', '合同解析算法教学\n下面引用劳动合同示例。\n甲方乙方，合同期限和签字盖章只用于演示字段提取。', 'study', 'notes'),
    ]
    for identifier, text, category, subtype in examples:
        yield {'id': 'v8-' + identifier, 'group': identifier, 'family': 'positive', 'split': 'development',
               'text': text, 'acceptable': [{'category': category, 'subcategory': subtype}],
               'must_review': True, 'name': 'original.txt'}
    negatives = [
        '今日复习高等数学，晚餐做米饭。', '数据库事务与隔离级别是产品介绍中的术语。',
        '我整理三道求导问题和计算步骤，尚未决定资料用途。', '我们研究一种方案，明天再讨论。',
        '产品宣传：模型误差降低，欢迎选购。', '大家一起讨论晚餐，随后各自回家。',
        '王同学负责界面，李同学负责测试。', '我计划周五整理房间，决定先收拾衣柜。',
        '销售台账', '销售台账\n日期\t客户\t数量\t金额',
        '销售台账\n日期\t客户\t数量\t金额\n\t\t\t',
        '销售台账\n日期\t客户\t数量\t金额\n未填写\t未知\t暂无\t未提供',
        '研究观测记录\n时间\t温度\t湿度\n2026-01-01\t18\t65',
        '需求说明\n功能需求：\n验收标准：', '账户业务办理确认\n开户银行：无\n账户名称：未提供',
        '没有复习高等数学。极限和求导只是聊天话题，整理了三道问题和计算步骤。',
        '不是销售台账\n日期\t客户\t商品\t数量\n2026-11-01\t南城店\t水杯\t3',
        '没有团队商议事项，陈青负责汇总缺陷。双方决定周五复查。',
    ]
    for index, text in enumerate(negatives):
        yield {'id': f'v8-negative-{index}', 'group': f'negative-{index}', 'family': 'negative',
               'split': 'development', 'text': text, 'acceptable': [], 'must_review': True, 'name': 'original.txt'}
    title_only = [
        ('title-notes', '课程笔记\n明天去超市买牛奶和洗衣液，顺路取快递。', 'study', 'notes'),
        ('title-invoice', '增值税电子普通发票\n这是一次排版练习，以下留空。', 'finance', 'invoice'),
        ('title-work', '工作记录\n今晚吃米饭和蔬菜。', 'office', 'work_notes'),
        ('repeat-notes', '课程笔记\n课程笔记\n课程笔记', 'study', 'notes'),
        ('repeat-course', '课程学习通知\n课程学习通知\n课程学习通知', 'study', 'courseware'),
        ('invoice-labels', '增值税电子普通发票\n发票号码\n购买方\n销售方\n价税合计', 'finance', 'invoice'),
        ('invoice-empty', '增值税电子普通发票\n发票号码：\n购买方：\n销售方：\n价税合计：', 'finance', 'invoice'),
        ('invoice-placeholder', '增值税电子普通发票\n发票号码：未提供\n购买方：待填写\n销售方：无\n价税合计：未知', 'finance', 'invoice'),
        ('invoice-borrow', '增值税电子普通发票\n发票号码：购买方：销售方：价税合计：', 'finance', 'invoice'),
        ('invoice-tab-empty', '增值税电子普通发票\n购买方\t\t备注\t南城公司\n发票号码\t\t备注\t12345', 'finance', 'invoice'),
    ]
    for identifier, text, category, subtype in title_only:
        # Only a reviewed alternative is acceptable, not an independently
        # established true purpose. Report separately from positive recall.
        yield {'id': 'v8-' + identifier, 'group': identifier, 'family': 'evidence_gate', 'split': 'development',
               'text': text, 'acceptable': [{'category': category, 'subcategory': subtype}],
               'must_review': True, 'name': 'original.txt'}


def evaluate():
    prior.BASELINE = BASELINE
    frozen = prior.FrozenModules()
    frozen.prefix = '_neatdrop_v8_frozen'
    sys.meta_path.insert(0, frozen)
    try:
        old = importlib.import_module(frozen.prefix + '.analysis').analyze_local
        old_sampler = importlib.import_module(frozen.prefix + '.extraction').sample_text
        legacy_bytes = prior.git('show', BASELINE + ':docs/evaluation/development.json')
        v7_bytes = prior.git('show', BASELINE + ':docs/evaluation/v7-development.json')
        v5_bytes = prior.git('show', BASELINE + ':docs/evaluation/v5-development.json')
        v7, v5 = json.loads(v7_bytes), json.loads(v5_bytes)
        groups = {
            'legacy40': json.loads(legacy_bytes)['records'],
            'diagnostic40': list(diagnostic_records()),
            'new7': list(prior.purpose_variants(v7)),
            'adjacent': [dict(row, family='adjacent', split='development') for row in v7['adjacent_records']],
            'robustness': [dict(row, family='robustness', split='development') for row in v7['robustness_records']],
            'prior8': list(prior.previous_purposes(v5)),
            'quality9': list(prior.quality_records(v5)),
            'review13': [dict(row, family='review', split='development') for row in v7['review_regressions']],
        }
        sections, failures = {}, []
        compared = ('category', 'subcategory', 'content_form', 'decision_level', 'review_required',
                    'review_reasons', 'kept_original_name', 'quality')
        for group, rows in groups.items():
            before = [prior.prediction(old, old_sampler, row) for row in rows]
            after = [prior.prediction(analyze_local, sample_text, row) for row in rows]
            records = []
            for row, previous, current in zip(rows, before, after, strict=True):
                changed = [key for key in compared if previous[key] != current[key]]
                if group == 'legacy40':
                    if row['id'] not in ALLOWED_LEGACY_CHANGES:
                        passed = not changed
                    elif row['id'] in {'meme', 'misleading-name'}:
                        passed = ((previous['category'], previous['subcategory']) == (current['category'], current['subcategory'])
                                  and current['review_required'])
                    else:
                        passed = (any(current['category'] == label['category'] and current['subcategory'] == label['subcategory']
                                      for label in row['acceptable']) and current['review_required'])
                elif group == 'diagnostic40':
                    passed = (current['decision_level'] == 'abstain' if not row['acceptable'] else
                              any(current['category'] == label['category'] and current['subcategory'] == label['subcategory']
                                  for label in row['acceptable']) and current['decision_level'] == 'candidate')
                elif group == 'quality9':
                    expected = row['expect']
                    passed = (current['quality']['state'] == expected['state'] and
                              current['decision_level'] == expected['level'] and
                              (not expected.get('keep_name') or current['kept_original_name']) and
                              (not expected.get('issue') or expected['issue'] in current['quality']['issues']))
                else:
                    passed = prior.behavioral_check(row, current)
                if not passed:
                    failures.append({'section': group, 'id': row['id']})
                records.append({'id': row['id'], 'family': row.get('family', 'legacy'), 'changed': changed,
                                'passed': passed, 'v7': previous, 'v8': current})
            def subset_metrics(indices):
                subset = [rows[i] for i in indices]
                return {'v7': prior.metrics(subset, [before[i] for i in indices]),
                        'v8': prior.metrics(subset, [after[i] for i in indices])}
            sections[group] = {'metrics': subset_metrics(range(len(rows))),
                               'by_family': {family: subset_metrics([i for i, row in enumerate(rows) if row.get('family', 'legacy') == family])
                                             for family in sorted({row.get('family', 'legacy') for row in rows})},
                               'checks_passed': sum(item['passed'] for item in records), 'records': records}
        return {
            'scope': __doc__, 'baseline_commit': BASELINE,
            'current_head': prior.git('rev-parse', 'HEAD').decode().strip(),
            'semantics': 'disabled; no inference, downloads or user files',
            'current_engine_sha256': {name: digest((PROJECT / 'backend/neatdrop' / name).read_bytes()) for name in ENGINE_FILES},
            'baseline_loaded_sha256': {name: digest(frozen.sources[name]) for name in sorted(frozen.loaded)},
            'script_sha256': digest(Path(__file__).read_bytes()),
            'source_manifest_sha256': {'legacy': digest(legacy_bytes), 'v7': digest(v7_bytes), 'v5': digest(v5_bytes)},
            'diagnostic_inputs': groups['diagnostic40'],
            'sections': sections,
            'summary': {group: {'count': len(section['records']), 'checks_passed': section['checks_passed'],
                                'v7': section['metrics']['v7'], 'v8': section['metrics']['v8']}
                        for group, section in sections.items()},
            'failures': failures,
        }
    finally:
        sys.meta_path.remove(frozen)
        for name in list(sys.modules):
            if name == frozen.prefix or name.startswith(frozen.prefix + '.'):
                del sys.modules[name]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'docs/evaluation/v8-development-results.json')
    args = parser.parse_args()
    previous = os.environ.get('NEATDROP_SEMANTIC_CANDIDATES')
    os.environ['NEATDROP_SEMANTIC_CANDIDATES'] = '0'
    try:
        report = evaluate()
    finally:
        if previous is None:
            os.environ.pop('NEATDROP_SEMANTIC_CANDIDATES', None)
        else:
            os.environ['NEATDROP_SEMANTIC_CANDIDATES'] = previous
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'] | {'failures': report['failures']}, ensure_ascii=False, indent=2))
    return bool(report['failures'])


if __name__ == '__main__':
    raise SystemExit(main())
