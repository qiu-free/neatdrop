"""Guard ordinary advice against isolated titles and empty invoice fields."""
import pytest

from neatdrop.analysis import analyze_local
from neatdrop.extraction import sample_text


@pytest.fixture(autouse=True)
def rules_only(monkeypatch):
    monkeypatch.setenv('NEATDROP_SEMANTIC_CANDIDATES', '0')


def analyze(text, name='original.txt', **extra):
    return analyze_local({'id': 'synthetic-v8', 'name': name, 'extension': '.' + name.rsplit('.', 1)[1]},
                         {**sample_text(text), **extra})


@pytest.mark.parametrize('text,subtype', [
    ('课程笔记\n明天去超市买牛奶和洗衣液，顺路取快递。', 'notes'),
    ('增值税电子普通发票\n这是一次排版练习，以下留空。', 'invoice'),
    ('工作记录\n今晚吃米饭和蔬菜。', 'work_notes'),
    ('课程笔记\n课程笔记\n课程笔记', 'notes'),
    ('课程学习通知\n课程学习通知\n课程学习通知', 'courseware'),
])
def test_isolated_or_repeated_title_cannot_be_ordinary(text, subtype):
    result = analyze(text)
    assert result['subcategory'] == subtype
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'title_only' in result['review_reasons']


@pytest.mark.parametrize('text', [
    '增值税电子普通发票\n发票号码\n购买方\n销售方\n价税合计',
    '增值税电子普通发票\n发票号码：\n购买方：\n销售方：\n价税合计：',
    '增值税电子普通发票\n发票号码：未提供\n购买方：待填写\n销售方：无\n价税合计：未知',
    '增值税电子普通发票\n发票号码：购买方：销售方：价税合计：',
    '增值税电子普通发票\n购买方\t\t备注\t南城公司\n发票号码\t\t备注\t12345',
    '增值税电子普通发票\n购买方：；备注：南城公司\n发票号码：；备注：12345',
    '增值税电子普通发票\n购买方：联系人：林青\n发票号码：联系电话：12345',
    '增值税电子普通发票\n购买方：南城公司\n发票号码：需要3天后补录',
    '增值税电子普通发票\n购买方：无，联系人林青\n发票号码：无，需要3天后补录',
])
def test_empty_or_placeholder_invoice_fields_cannot_be_ordinary(text):
    result = analyze(text)
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'required_fields_missing' in result['review_reasons']


@pytest.mark.parametrize('text', [
    '增值税电子普通发票\n发票号码：123456789\n购买方：南城公司\n销售方：北城公司\n价税合计：110.00元',
    '增值税电子普通发票\n发票号码123456789\n购买方南城公司\n销售方北城公司\n价税合计110.00元',
    '增值税电子普通发票\n购买方：无锡公司\n销售方：北城公司\n税额：10.00元',
    '增值税电子普通发票\n购买方：无锡公司\n价税合计：-110.00元',
])
def test_actual_invoice_fields_keep_independent_document_advice(text):
    result = analyze(text)
    assert result['subcategory'] == 'invoice'
    assert result['decision_level'] == 'ordinary'
    assert 'required_fields_missing' not in result['review_reasons']


def test_independent_course_content_is_not_mistaken_for_a_repeated_heading():
    result = analyze('课程笔记\n本节学习矩阵的特征值和计算方法。')
    assert result['subcategory'] == 'notes'
    assert result['decision_level'] == 'ordinary'


def test_isolated_ocr_heading_does_not_override_a_clear_photo():
    result = analyze('课程笔记\n课程笔记', 'photo.png', local_image=True,
                     visual=[{'label': 'landscape', 'score': .4}, {'label': 'object', 'score': .2}], warnings=[])
    assert (result['category'], result['subcategory']) == ('photos', 'landscape')
    assert result['name'] == 'photo.png'


def test_actual_ocr_invoice_keeps_its_purpose_when_generic_visual_scene_disagrees():
    result = analyze('增值税电子普通发票\n发票号码123456789\n购买方南城公司\n销售方北城公司\n价税合计110.00元',
                     'invoice.png', local_image=True,
                     visual=[{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}], warnings=[])
    assert (result['category'], result['subcategory']) == ('finance', 'invoice')
    assert result['decision_level'] == 'ordinary'
