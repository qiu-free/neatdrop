"""Content patterns improve reviewed recall without inventing uses from form."""
import pytest

from neatdrop.analysis import analyze_local
from neatdrop.extraction import sample_text


@pytest.fixture(autouse=True)
def rules_only(monkeypatch):
    monkeypatch.setenv('NEATDROP_SEMANTIC_CANDIDATES', '0')


def analyze(text, name='original.txt', **extra):
    return analyze_local({'id': 'synthetic-v8', 'name': name, 'extension': '.' + name.rsplit('.', 1)[1]},
                         {**sample_text(text), **extra})


POSITIVES = [
    ('今日复习高等数学\n极限存在时可以运用洛必达法则。整理了三道求导问题和计算步骤。', 'study', 'notes'),
    ('今天自学数据库的事务与隔离级别，整理了练习题和解题思路。', 'study', 'notes'),
    ('我们考察了一种新的信号降噪方法，比较实验表明误差降低。本文给出实验设置、结果讨论及相关文献。', 'study', 'paper'),
    ('本研究提出新的分类方法。对照实验检验模型，结果表明显著提高检索表现。', 'study', 'paper'),
    ('周二大家一起讨论下一版发布。王同学负责界面，李同学负责测试，约定下周复查进度并提交讨论结论。', 'activity', 'meeting'),
    ('团队商议本月交付安排，陈青负责汇总缺陷。双方决定周五复查。', 'activity', 'meeting'),
    ('2026年销售台账\n日期\t客户\t商品\t数量\t含税金额\n2026-11-01\t南城门店\t办公椅\t3\t1497\n合计\t\t\t3\t1497', 'office', 'spreadsheet'),
    ('库存清单\n物料\t数量\t仓库\n螺栓\t150\t一号库', 'office', 'spreadsheet'),
    ('净匣需求说明\n使用场景：离线整理本地文件\n功能需求：扫描目录并展示分类\n验收标准：保留原件', 'office', 'requirements'),
    ('账户业务办理确认\n开户银行\t无锡银行\n账户名称\t林青\n银行账号\t623456789012', 'finance', 'bank_material'),
]


@pytest.mark.parametrize('text,category,subtype', POSITIVES)
def test_multiple_content_groups_produce_a_reviewed_candidate(text, category, subtype):
    result = analyze(text)
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    body = [item for item in result['evidence_items'] if item['source'] in {'body', 'title'}]
    assert len(body) >= 2
    assert all(item['text'] in text for item in body)


@pytest.mark.parametrize('text', [
    '今日复习高等数学，晚餐做米饭。',
    '数据库事务与隔离级别是产品介绍中的术语。',
    '我整理三道求导问题和计算步骤，尚未决定资料用途。',
    '我们研究一种方案，明天再讨论。',
    '产品宣传：模型误差降低，欢迎选购。',
    '大家一起讨论晚餐，随后各自回家。',
    '王同学负责界面，李同学负责测试。',
    '我计划周五整理房间，决定先收拾衣柜。',
    '销售台账',
    '销售台账\n日期\t客户\t数量\t金额',
    '销售台账\n日期\t客户\t数量\t金额\n\t\t\t',
    '销售台账\n日期\t客户\t数量\t金额\n未填写\t未知\t暂无\t未提供',
    '研究观测记录\n时间\t温度\t湿度\n2026-01-01\t18\t65',
    '需求说明\n功能需求：\n验收标准：',
    '账户业务办理确认\n开户银行：无\n账户名称：未提供',
])
def test_sparse_context_and_empty_table_rows_cannot_invent_a_purpose(text):
    result = analyze(text)
    assert result['category'] == 'other'
    assert result['decision_level'] == 'abstain'


@pytest.mark.parametrize('text', [
    '没有复习高等数学。极限和求导只是聊天话题，整理了三道问题和计算步骤。',
    '不是销售台账\n日期\t客户\t商品\t数量\n2026-11-01\t南城店\t水杯\t3',
    '没有团队商议事项，陈青负责汇总缺陷。双方决定周五复查。',
    '团队没有讨论具体事项。张三负责开门，决定明天完成。',
    '团队尚未讨论交付安排，陈青负责值班。双方决定周五复查。',
    '我们还没讨论具体事项，张三负责开门，决定明天完成。',
    '团队不需要讨论具体事项，张三负责开门，决定明天完成。',
    '团队无需讨论具体事项，张三负责开门，决定明天完成。',
    '请团队负责讨论并决定明天交付。',
    '本研究方法的相关文献。',
])
def test_negated_context_cannot_activate_structural_candidates(text):
    assert analyze(text)['decision_level'] == 'abstain'


@pytest.mark.parametrize('text', [
    '票据识别算法教程\n下面引用一个增值税电子普通发票示例。\n发票号码、购买方、销售方、价税合计均为示例字段。\n请勿作为真实票据使用。',
    '合同解析算法教学\n下面引用劳动合同示例。\n甲方乙方，合同期限和签字盖章只用于演示字段提取。',
])
def test_learning_context_outranks_the_document_quoted_as_an_example(text):
    result = analyze(text)
    assert (result['category'], result['subcategory']) == ('study', 'notes')
    assert result['decision_level'] == 'candidate'
    assert 'example_context' in result['review_reasons']
    assert any(item['category'] in {'finance', 'office'} for item in result['candidates'])


def test_actual_csv_bytes_support_business_data_without_extension_shortcuts():
    from neatdrop.document_formats import extract_document
    payload = extract_document('销售台账,,,\n日期,客户,数量,金额\n2026-11-01,南城店,3,1497\n'.encode('utf-8'), '.csv', 12000)
    result = analyze_local({'id': 'csv-v8', 'name': 'table.csv', 'extension': '.csv'}, payload)
    assert (result['category'], result['subcategory']) == ('office', 'spreadsheet')
    assert result['decision_level'] == 'candidate'
    evidence = [item for item in result['evidence_items'] if item['source'] == 'body']
    assert any(item.get('row') == 3 for item in evidence)
    assert all(item['text'] in payload['text'] for item in evidence)


def test_two_docx_tables_cannot_supply_each_others_missing_business_rows():
    from neatdrop.document_formats import extract_document
    from test_document_formats_v7 import package, W
    def row(*values):
        return '<w:tr>' + ''.join(f'<w:tc><w:p><w:r><w:t>{value}</w:t></w:r></w:p></w:tc>'
                                 for value in values) + '</w:tr>'
    xml = (f'<w:document xmlns:w="{W}"><w:body>'
           '<w:p><w:r><w:t>销售台账字段定义</w:t></w:r></w:p>'
           '<w:tbl>' + row('客户', '数量', '金额') + '</w:tbl>'
           '<w:tbl>' + row('字段类型', '长度', '上限') + row('客户名称', '3', '64') + '</w:tbl>'
           '</w:body></w:document>')
    payload = extract_document(package('.docx', main_xml=xml), '.docx', 12000)
    result = analyze_local({'id': 'docx-v8', 'name': 'definitions.docx', 'extension': '.docx'}, payload)
    assert result['category'] == 'other'
    assert result['decision_level'] == 'abstain'


def test_xlsx_business_header_cannot_borrow_a_different_sheets_row():
    text = '销售台账\n客户\t数量\t金额\n客户名称\t3\t64'
    result = analyze(text, 'sheets.xlsx', sampling={
        'kind': 'xlsx', 'truncated': False, 'budget_exhausted': False,
        'segments': [
            {'sheet': '销售表', 'sample_start': 0, 'sample_end': 4, 'start': 0, 'end': 4},
            {'sheet': '销售表', 'sample_start': 5, 'sample_end': 13, 'start': 0, 'end': 8},
            {'sheet': '字段定义', 'sample_start': 14, 'sample_end': len(text), 'start': 0, 'end': len(text) - 14},
        ],
    })
    assert result['category'] == 'other'


def test_real_xlsx_business_context_cannot_validate_a_different_sheets_definition_table():
    from neatdrop.document_formats import extract_document
    from test_document_formats_v7 import package, rels, S, R
    workbook = (f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets>'
                '<sheet name="销售台账" sheetId="1" r:id="s1"/>'
                '<sheet name="数据库字段定义" sheetId="2" r:id="s2"/></sheets></workbook>')
    first = f'<worksheet xmlns="{S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>暂缺，稍后补录</t></is></c></row></sheetData></worksheet>'
    second = f'<worksheet xmlns="{S}"><sheetData>'
    for index, values in enumerate([('客户', '数量', '金额'), ('字段最大长度', '3', '64')], 1):
        second += f'<row r="{index}">' + ''.join(
            f'<c r="{column}{index}" t="inlineStr"><is><t>{value}</t></is></c>'
            for column, value in zip('ABC', values)) + '</row>'
    second += '</sheetData></worksheet>'
    source = package('.xlsx', main_xml=workbook, extra={
        'xl/_rels/workbook.xml.rels': rels([('s1', 'worksheet', 'worksheets/sheet1.xml', ''),
                                           ('s2', 'worksheet', 'worksheets/sheet2.xml', '')]),
        'xl/worksheets/sheet1.xml': first, 'xl/worksheets/sheet2.xml': second,
    })
    payload = extract_document(source, '.xlsx', 12000)
    result = analyze_local({'id': 'sheets-v8', 'name': 'definitions.xlsx', 'extension': '.xlsx'}, payload)
    assert result['category'] == 'other'


def test_table_header_without_its_own_data_stops_at_a_different_header():
    result = analyze('销售台账字段定义\n客户\t数量\t金额\n字段类型\t长度\t上限\n客户名称\t3\t64')
    assert result['category'] == 'other'


def test_new_structural_ocr_is_preserved_against_generic_object_scene():
    text = POSITIVES[4][0]
    result = analyze(text, 'screenshot.png', local_image=True,
                     visual=[{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}],
                     warnings=[], ocr_lines=[{'text': text, 'score': .95,
                                              'box': [[0, 0], [800, 0], [800, 160], [0, 160]]}])
    assert (result['category'], result['subcategory']) == ('activity', 'meeting')
    assert result['decision_level'] == 'candidate'
    assert any(item['source'] == 'ocr' and item.get('box') for item in result['evidence_items'])


def test_legacy_heading_cannot_discard_corroborating_ocr_structure():
    text = '会议记录\n团队商议本月交付安排，陈青负责汇总缺陷。双方决定周五复查。'
    result = analyze(text, 'screenshot.png', local_image=True,
                     visual=[{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}],
                     warnings=[], ocr_lines=[{'text': text, 'score': .95,
                                              'box': [[0, 0], [800, 0], [800, 160], [0, 160]]}])
    assert (result['category'], result['subcategory']) == ('activity', 'meeting')
    assert result['decision_level'] == 'candidate'
    assert 'structure_uncalibrated' in result['review_reasons']
    assert len([item for item in result['evidence_items'] if item['source'] == 'ocr']) >= 3


def test_new_structure_evidence_maps_to_the_original_unicode_text():
    text = 'ＡＢＣ Straße e\u0301\n' + POSITIVES[0][0]
    result = analyze(text)
    assert result['subcategory'] == 'notes'
    body = [item for item in result['evidence_items'] if item['source'] == 'body']
    assert len(body) >= 2
    assert all(text[item['start']:item['end']] == item['text'] for item in body)


def test_repeated_phrase_evidence_points_to_the_positive_occurrence():
    text = '没有团队商议安排。\n团队商议本月交付安排，陈青负责汇总缺陷。双方决定周五复查。'
    result = analyze(text)
    phrase = next(item for item in result['evidence_items'] if item['text'] == '团队商议')
    assert phrase['start'] == 10
    assert text[phrase['start']:phrase['end']] == '团队商议'


def test_ocr_repeated_phrase_uses_the_positive_lines_box():
    first, second = '没有团队商议安排。', '团队商议本月交付安排，陈青负责汇总缺陷。双方决定周五复查。'
    positive_box = [[0, 120], [800, 120], [800, 280], [0, 280]]
    result = analyze(first + '\n' + second, 'screen.png', local_image=True, visual=[], warnings=[], ocr_lines=[
        {'text': first, 'score': .95, 'box': [[0, 0], [800, 0], [800, 100], [0, 100]]},
        {'text': second, 'score': .95, 'box': positive_box},
    ])
    phrase = next(item for item in result['evidence_items'] if item['text'] == '团队商议')
    assert phrase['box'] == positive_box
    assert all(not any(key.startswith('_sample_') for key in item) for item in result['evidence_items'])
