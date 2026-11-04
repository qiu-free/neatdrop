"""New purposes need actual content and always remain reviewed candidates."""
import pytest

from neatdrop.analysis import analyze_local
from neatdrop.classifier import classify_text, fuse_image
from neatdrop.decision import decide


CASES = [
    ('finance', 'bank_material', '银行开户证明',
     ['开户银行：海岬银行', '账户名称：林青', '银行账号：6222000042', '办理事项：工资账户开立'],
     '银行账户证明', ['开户行：海岬支行', '户名：林青', '账号：6222000042']),
    ('finance', 'utility_payment', '水费缴费凭证',
     ['费用项目：居民水费', '缴费状态：已缴清', '缴费金额：86.40元', '缴费户号：U100'],
     '公共服务缴费回执', ['缴费项目：燃气费', '支付状态：缴费成功', '实缴金额：72元']),
    ('finance', 'tax_material', '个人所得税申报回执',
     ['纳税人名称：林青', '纳税人识别号：T20260042', '税款所属期：2026年3月', '申报税种：个人所得税'],
     '税收完税证明', ['纳税人：林青', '税种：个人所得税', '所属期间：2026年3月']),
    ('study', 'research_data', '研究观测数据',
     ['研究课题：沿海水质观测', '变量定义：温度单位摄氏度', '观测数据：样本A温度18.5，样本B温度19.2', '采集日期：2026年3月2日'],
     '科研测量记录', ['研究项目：沿海温度变化', '测量值：样本A为18.5摄氏度', '变量说明：站点与温度']),
    ('office', 'presentation', '项目汇报演示资料',
     ['汇报主题：检索服务升级', '汇报对象：项目评审组', '演示提纲：现状、方案、上线安排', '讲稿：本次展示服务升级方案'],
     '工作汇报幻灯片', ['演讲主题：索引改造', '展示对象：部门同事', '页面提纲：现状与下一步']),
    ('life', 'property', '物业维修通知',
     ['房屋地址：海岬小区2栋301室', '物业事项：更换楼道照明', '办理安排：周三上午入户核查', '物业服务单位：海岬物业'],
     '住房管理记录', ['房屋坐落：海岬路2号', '管理事项：公共门禁维修', '处理安排：五月二日更换']),
    ('life', 'travel_material', '旅行行程规划',
     ['旅行目的地：海岬市', '计划日期：2026年5月1日至3日', '游览安排：第一天参观海洋馆', '行前清单：雨具、药品'],
     '旅游攻略', ['目的地：青湾', '出游时间：五月上旬', '景点安排：海湾步道和博物馆']),
]


def run(text, name='original.txt', **payload):
    return analyze_local({'id': 'synthetic', 'name': name, 'extension': '.txt'},
                         {'text': text, 'sample': 'synthetic v7 regression', **payload})


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
@pytest.mark.parametrize('variant', ['explicit', 'alias', 'body_anchor'])
def test_real_content_supports_each_new_purpose_as_candidate(category, subtype, anchor, fields, alias, alias_fields, variant):
    text = {'explicit': '\n'.join([anchor, *fields]), 'alias': '\n'.join([alias, *alias_fields]),
            'body_anchor': '\n'.join(['留存说明', '供后续核对。', '本页为' + anchor, *fields])}[variant]
    result = run(text)
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    assert 'purpose_uncalibrated' in result['review_reasons']
    assert len([hit for hit in result['evidence_items'] if hit['source'] == 'body']) >= 2


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
@pytest.mark.parametrize('variant', ['filename_only', 'extension_only', 'title_only', 'one_field', 'duplicate_group',
                                     'negated_anchor', 'negated_fields', 'empty_fields', 'placeholder_values'])
def test_sparse_missing_or_negated_content_does_not_assign_new_purpose(category, subtype, anchor, fields, alias, alias_fields, variant):
    labels = [field.split('：')[0] for field in fields]
    text = {'filename_only': '普通文字内容，稍后整理。', 'extension_only': '普通文字内容，稍后整理。',
            'title_only': anchor, 'one_field': anchor + '\n' + fields[0],
            'duplicate_group': '\n'.join([anchor, fields[0], fields[0], fields[0]]),
            'negated_anchor': '\n'.join(['并非' + anchor, *fields]),
            'negated_fields': '\n'.join([anchor, *['没有真实' + field for field in fields]]),
            'empty_fields': '\n'.join([anchor, *[label + '：' for label in labels]]),
            'placeholder_values': '\n'.join([anchor, *[label + '：请填写' + label for label in labels]])}[variant]
    name = anchor + '.xlsx' if variant == 'filename_only' else 'original.pptx' if variant == 'extension_only' else 'original.txt'
    result = run(text, name)
    assert (result['category'], result['subcategory']) != (category, subtype)


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
@pytest.mark.parametrize('context', ['编写教程', '模板范本', '示例说明', '操作教学'])
def test_example_and_instruction_context_is_disclosed(category, subtype, anchor, fields, alias, alias_fields, context):
    result = run('\n'.join([anchor + context, *fields]))
    assert result['decision_level'] != 'ordinary'
    assert 'example_context' in result['review_reasons']


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
def test_new_purpose_survives_generic_visual_scene_but_requires_review(category, subtype, anchor, fields, alias, alias_fields):
    result = decide(fuse_image('x.png', '\n'.join([anchor, *fields]),
                               [{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}], []))
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    assert any(hit['source'] == 'ocr' for hit in result['evidence_items'])


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
def test_second_document_cannot_hide_behind_high_support_purpose(category, subtype, anchor, fields, alias, alias_fields):
    result = run('劳动合同\n甲方乙方\n合同期限三年\n双方签字盖章\n' + '\n'.join([anchor, *fields]))
    assert result['decision_level'] == 'candidate'
    assert 'competing_categories' in result['review_reasons']


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
def test_decision_reapplies_uncalibrated_gate_if_upstream_bit_is_lost(category, subtype, anchor, fields, alias, alias_fields):
    result = decide({'category': category, 'subcategory': subtype, 'review_required': False,
                     'review_reasons': [], 'evidence_items': [], 'candidates': []})
    assert result['decision_level'] == 'candidate'
    assert 'purpose_uncalibrated' in result['review_reasons']


@pytest.mark.parametrize('text,forbidden', [
    ('银行业务介绍\n开户银行：海岬银行\n账户名称：林青', 'bank_material'),
    ('水费待缴账单\n费用项目：居民水费\n缴费状态：待缴费\n缴费金额：86元', 'utility_payment'),
    ('水费缴费凭证\n费用项目：居民水费\n缴费状态：尚未缴费\n缴费金额：86元', 'utility_payment'),
    ('水费缴费凭证\n费用项目：居民水费\n缴费状态：支付失败\n缴费金额：86元', 'utility_payment'),
    ('数据整理说明\n研究课题：沿海温度\n变量定义：温度', 'research_data'),
    ('研究数据\n研究课题：沿海温度\n采集日期：2026年3月2日', 'research_data'),
    ('季度销售台账\n部门：零售部\n数据记录：一月收入3000元\n统计口径：营业收入', 'research_data'),
    ('课程课件\n课程：线性代数\n章节：第三章\n汇报主题：矩阵\n演示提纲：特征值', 'presentation'),
    ('工作报告\n项目：升级检索\n进度：已上线\n结论：稳定运行', 'presentation'),
    ('租赁合同\n甲方：陈甲\n乙方：林乙\n期限：一年\n双方签字盖章\n房屋地址：青湾路2号', 'property'),
    ('火车票\n出发：青湾\n到达：海岬\n车次：G42\n座位：03A', 'travel_material'),
    ('增值税电子普通发票\n发票号码：12345\n购买方：林青\n销售方：海岬商店\n税额：12元', 'tax_material'),
])
def test_nearby_document_and_generic_vocabulary_do_not_imply_new_purpose(text, forbidden):
    result = run(text)
    assert result['subcategory'] != forbidden


def test_two_distinct_purposes_still_disclose_conflict():
    result = run('银行开户证明\n开户银行：海岬银行\n账户名称：林青\n银行账号：6222000042\n'
                 '税收完税证明\n纳税人：林青\n税种：个人所得税')
    assert result['decision_level'] == 'candidate'
    assert 'competing_categories' in result['review_reasons']


@pytest.mark.parametrize('text', [
    '银行开户证明\n开户银行：无实际银行\n账户名称：待补充',
    '银行开户证明\n开户银行：[银行名称]\n账户名称：____',
    '银行开户证明\n开户银行：XXX\n账户名称：某某',
])
def test_readable_placeholder_strings_are_not_actual_body_evidence(text):
    assert run(text)['subcategory'] != 'bank_material'


def test_global_negation_scope_does_not_erase_later_actual_document():
    result = run('这不是工作报告。\n银行开户证明\n开户银行：海岬银行\n账户名称：林青')
    assert result['subcategory'] == 'bank_material'
    assert result['decision_level'] == 'candidate'


def test_partial_content_keeps_new_purpose_review_gate():
    result = run('旅游攻略\n目的地：青湾\n出游时间：五月上旬',
                 sampling={'kind': 'text', 'truncated': True, 'budget_exhausted': True, 'segments': []})
    assert result['subcategory'] == 'travel_material'
    assert result['decision_level'] == 'candidate'
    assert {'purpose_uncalibrated', 'partial_content'} <= set(result['review_reasons'])


@pytest.mark.parametrize('category,subtype,anchor,fields,alias,alias_fields', CASES)
def test_extracted_tab_delimited_key_value_rows_keep_actual_evidence(category, subtype, anchor, fields, alias, alias_fields):
    text = '\n'.join([anchor, *[field.replace('：', '\t', 1) for field in fields]])
    result = run(text)
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    body = [item for item in result['evidence_items'] if item['source'] == 'body']
    assert len(body) >= 2
    assert all(item['text'] in text.casefold() and '\t' in item['text'] for item in body)


def test_actual_csv_extraction_supports_key_value_rows_without_fabricating_punctuation():
    from neatdrop.document_formats import extract_document
    payload = extract_document('缴费凭证,\n缴费项目,居民电费\n缴费状态,缴费成功\n缴费金额,88元\n'.encode('utf-8'), '.csv', 12000)
    result = analyze_local({'id': 'csv', 'name': 'sample.csv', 'extension': '.csv'}, payload)
    assert result['subcategory'] == 'utility_payment'
    assert result['decision_level'] == 'candidate'
    assert any(item['text'] == '缴费项目\t居民电费' for item in result['evidence_items'])


@pytest.mark.parametrize('separator', [' ', '    '])
def test_unstructured_whitespace_is_not_a_key_value_separator(separator):
    result = run(f'银行开户证明\n开户银行{separator}海岬银行\n账户名称{separator}林青')
    assert result['subcategory'] != 'bank_material'
