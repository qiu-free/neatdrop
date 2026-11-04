"""Eight uncalibrated purpose rules need content anchors and distinct fields."""
import pytest

from neatdrop.analysis import analyze_local
from neatdrop.classifier import classify_text, fuse_image
from neatdrop.decision import decide


PURPOSE_CASES = [
    ('study', 'experiment_material', '实验记录', ['实验目的：测量溶液浓度', '实验器材：量筒和烧杯', '实验步骤：分组测量', '实验结果：三组数值']),
    ('study', 'technical_document', 'API接口文档', ['接口地址：/items', '请求参数：item_id', '返回值：status', '错误码：404']),
    ('study', 'reading_excerpt', '读书摘录', ['书名：山海拾遗', '作者：陈一', '摘录原文：此处记载山海故事', '页码：42']),
    ('office', 'project_plan', '项目实施方案', ['项目目标：升级检索系统', '实施范围：索引服务', '里程碑：五月完成', '负责人：工程组']),
    ('office', 'requirements', '产品需求设计', ['用户角色：编辑', '功能需求：批量筛选', '验收标准：结果可复现', '交互流程：选择后确认']),
    ('office', 'email', '邮件存档', ['发件人：alice@example.invalid', '收件人：bob@example.invalid', '主题：周五安排', '发送时间：2026年5月1日']),
    ('life', 'warranty', '产品保修说明', ['产品型号：A100', '保修期限：两年', '保修范围：制造缺陷', '售后电话：000-123456']),
    ('life', 'insurance', '保险保单', ['保单号码：P100', '被保险人：甲', '保险期间：2026至2027', '保险责任：意外保障']),
]


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
def test_multi_evidence_purpose_is_candidate_even_with_every_support(category, subtype, title, fields):
    result = decide(classify_text('unrelated.txt', '\n'.join([title, *fields])))
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'purpose_uncalibrated' in result['review_reasons']
    assert len([hit for hit in result['evidence_items'] if hit['source'] == 'body']) >= 2


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
@pytest.mark.parametrize('variant', ['filename_only', 'title_only', 'one_group', 'negated_anchor', 'negated_fields'])
def test_sparse_or_negated_purpose_does_not_select_new_label(category, subtype, title, fields, variant):
    name = title + '.txt' if variant == 'filename_only' else 'x.txt'
    text = {'filename_only': '普通文字内容，稍后整理。', 'title_only': title,
            'one_group': title + '\n' + fields[0],
            'negated_anchor': '这不是' + title + '\n' + '\n'.join(fields),
            'negated_fields': title + '\n' + '\n'.join('没有真实' + field for field in fields)}[variant]
    result = decide(classify_text(name, text))
    assert (result['category'], result['subcategory']) != (category, subtype)


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
@pytest.mark.parametrize('context', ['编写教程', '空白模板范本'])
def test_tutorial_and_template_purposes_remain_reviewable(category, subtype, title, fields, context):
    result = decide(classify_text('x.txt', '\n'.join([title + context, *fields])))
    assert result['decision_level'] != 'ordinary'
    assert result['review_required']
    assert 'example_context' in result['review_reasons']


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
def test_new_purpose_mixed_with_legacy_contract_cannot_hide_conflict(category, subtype, title, fields):
    text = '劳动合同\n甲方乙方\n合同期限三年\n双方签字盖章\n' + '\n'.join([title, *fields])
    result = decide(classify_text('x.txt', text))
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'competing_categories' in result['review_reasons']


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
def test_new_purpose_ocr_is_not_erased_by_generic_visual_scene(category, subtype, title, fields):
    text = '\n'.join([title, *fields])
    result = decide(fuse_image('x.png', text, [{'label': 'object', 'score': .4},
                                              {'label': 'document', 'score': .25}], []))
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    assert any(hit['source'] == 'ocr' for hit in result['evidence_items'])


def test_repeated_synonyms_from_one_support_group_do_not_count_twice():
    result = decide(classify_text('x.txt', '产品保修说明\n产品型号：A1\n设备型号：A1\n型号：A1'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


@pytest.mark.parametrize('category,subtype,title,fields', PURPOSE_CASES)
def test_empty_field_labels_cannot_borrow_values_from_next_line(category, subtype, title, fields):
    result = decide(classify_text('x.txt', '\n'.join([title, *[field.split('：')[0] + '：' for field in fields]])))
    assert (result['category'], result['subcategory']) != (category, subtype)


@pytest.mark.parametrize('value', ['---', '...', '：', '   '])
def test_punctuation_only_field_values_do_not_support_purpose(value):
    result = decide(classify_text('x.txt', f'产品保修说明\n产品型号：{value}\n保修期限：{value}'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


def test_two_nonempty_field_groups_on_one_line_support_purpose():
    result = decide(classify_text('x.txt', '产品保修说明\n产品型号：A100；保修期限：两年'))
    assert (result['category'], result['subcategory']) == ('life', 'warranty')
    assert result['decision_level'] == 'candidate'


def test_empty_field_on_same_line_cannot_borrow_next_field_label():
    result = decide(classify_text('x.txt', '产品保修说明\n产品型号： 保修期限：两年'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


def test_email_domain_does_not_imply_template_context():
    result = decide(classify_text('x.txt', '邮件存档\n发件人：a@example.invalid\n收件人：b@example.invalid'))
    assert result['subcategory'] == 'email'
    assert 'example_context' not in result['review_reasons']


@pytest.mark.parametrize('value', ['无', '未提供', '不适用', '未知', 'N/A', '不存在', '暂无',
                                  '无。', '无，', '无；', '无!', '非。', '尚未采集', '尚未填写', '未填写'])
def test_missing_or_negated_field_values_do_not_support_purpose(value):
    result = decide(classify_text('x.txt', f'产品保修说明\n产品型号：{value}\n保修期限：{value}'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


def test_actual_product_name_starting_with_wu_remains_meaningful():
    result = decide(classify_text('x.txt', '保修卡\n产品型号：无刷电机A100\n保修期限：两年'))
    assert (result['category'], result['subcategory']) == ('life', 'warranty')
    assert result['decision_level'] == 'candidate'


def test_old_warranty_fields_do_not_borrow_unknown_tab_columns():
    result = decide(classify_text('x.txt', '保修卡\n产品型号\t\t备注\tA100\n保修期限\t\t备注\t两年'))
    assert result['decision_level'] == 'abstain'
    assert result['subcategory'] == 'unclassified'


def test_empty_field_followed_by_negated_duplicate_cannot_become_support():
    result = decide(classify_text('x.txt', '产品保修说明\n产品型号：A100\n保修期限：；无保修期限：两年'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


def test_overlapping_functional_and_nonfunctional_label_is_one_field():
    result = decide(classify_text('x.txt', '产品需求文档\n非功能需求：响应应在两秒内'))
    assert (result['category'], result['subcategory']) != ('office', 'requirements')


@pytest.mark.parametrize('prefix', ['不含', '不包含', '无', '非', 'not a ', '没有'])
def test_other_common_negations_do_not_become_purpose_anchors(prefix):
    result = decide(classify_text('x.txt', prefix + '保修说明\n产品型号：A100\n保修期限：两年'))
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


@pytest.mark.parametrize('text', [
    '没有保修说明\n产品型号：A100\n保修期限：两年',
    '产品保修说明\n产品型号：不存在\n保修期限：暂无',
])
def test_negated_or_missing_warranty_content_is_not_selected_end_to_end(text):
    result = analyze_local({'id': 'review', 'name': 'x.txt', 'extension': '.txt'},
                           {'text': text, 'sample': 'synthetic review regression'})
    assert (result['category'], result['subcategory']) != ('life', 'warranty')


def test_two_new_purposes_with_different_support_counts_still_disclose_conflict():
    result = decide(classify_text('x.txt', '项目实施方案\n项目目标：升级系统\n实施范围：检索\n里程碑：五月\n负责人：甲\n'
                                 '邮件存档\n发件人：a@example.invalid\n收件人：b@example.invalid'))
    assert result['decision_level'] == 'candidate'
    assert 'competing_categories' in result['review_reasons']


def test_decision_cannot_promote_new_purpose_if_upstream_review_bit_is_lost():
    result = decide({'category': 'study', 'subcategory': 'technical_document',
                     'review_required': False, 'review_reasons': [], 'candidates': [], 'evidence_items': []})
    assert result['decision_level'] == 'candidate'
    assert 'purpose_uncalibrated' in result['review_reasons']


def test_end_to_end_new_purpose_has_quality_and_remains_candidate():
    result = analyze_local({'id': 'p', 'name': 'x.txt', 'extension': '.txt'},
                           {'text': '项目实施方案\n项目目标：升级索引\n里程碑：五月交付', 'sample': 'synthetic'})
    assert (result['category'], result['subcategory']) == ('office', 'project_plan')
    assert result['quality']['state'] == 'acceptable'
    assert result['decision_level'] == 'candidate'
