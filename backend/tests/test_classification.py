import pytest

from neatdrop.classifier import classify_text, fuse_image
from neatdrop.taxonomy import destination
from neatdrop.files import SafetyError


@pytest.mark.parametrize('name,text,category,subtype', [
    ('random.md', '# 线性代数课程笔记\n矩阵、特征值与线性变换', 'study', 'notes'),
    ('lesson.txt', '课程笔记\n本节学习使用机器学习识别发票，发票和报销只是算法示例。', 'study', 'notes'),
    ('policy.txt', '报销材料提交说明\n请提交发票原件，并填写报销申请。', 'finance', 'reimbursement'),
    ('scan.txt', '增值税电子普通发票\n发票号码：123456789\n购买方：样例公司\n销售方：样例商户\n价税合计：38.50元', 'finance', 'invoice'),
    ('x.txt', '课程学习通知\n课程安排：线性代数 第三章\n请复习矩阵习题。', 'study', 'courseware'),
    ('x.txt', '社团读书会活动通知\n报名截止前提交报名表，活动地点为图书馆。', 'activity', 'notice'),
    ('x.txt', '取件通知\n快递包裹已到驿站\n取件码：12-3456', 'life', 'delivery'),
    ('x.txt', '劳动合同\n甲方：某公司\n乙方：某人\n合同期限：三年\n双方签字盖章', 'office', 'contract'),
    ('x.txt', '个人简历\n教育经历\n工作经历\n项目经验\n求职意向：工程师', 'office', 'resume'),
    ('x.txt', '门诊病历\n就诊日期\n临床诊断\n处方用药\n检查结果', 'life', 'medical'),
])
def test_structured_evidence_selects_fine_category(name, text, category, subtype):
    result = classify_text(name, text)
    assert (result['category'], result['subcategory']) == (category, subtype)
    assert result['evidence_items']
    assert result['content_form'] == 'text_document'


def test_filename_only_is_weak_evidence():
    result = classify_text('发票_123.txt', '随手记录，没有其他信息。')
    assert result['review_required'] is True
    assert 'filename_only' in result['review_reasons']


def test_conflicting_documents_need_review():
    result = classify_text('混合.txt', '劳动合同\n甲方乙方签字盖章\n个人简历\n教育经历 工作经历 求职意向')
    assert result['review_required'] is True
    assert 'competing_categories' in result['review_reasons']


def test_no_information_is_not_guessed():
    result = classify_text('IMG_1234.png', '')
    assert result['category'] == 'other'
    assert result['subcategory'] == 'unclassified'
    assert result['review_required'] is True


def test_visual_ambiguity_needs_review():
    result = fuse_image('IMG.png', '', [
        {'label': 'landscape', 'score': .28}, {'label': 'people', 'score': .27},
    ], [])
    assert result['review_required'] is True
    assert 'visual_ambiguous' in result['review_reasons']


def test_invoice_ocr_outweighs_generic_photo_prediction():
    result = fuse_image('IMG.png', '增值税电子普通发票\n发票号码12345\n购买方甲\n销售方乙\n价税合计38.50元', [
        {'label': 'object', 'score': .31}, {'label': 'document', 'score': .30},
    ], [])
    assert result['category'] == 'finance'
    assert result['subcategory'] == 'invoice'
    assert result['content_form'] == 'document_image'


def test_photo_is_not_archived_as_coursework_for_incidental_text():
    result = fuse_image('photo.png', '课程', [
        {'label': 'landscape', 'score': .38}, {'label': 'object', 'score': .22},
    ], [])
    assert result['category'] == 'photos'
    assert result['subcategory'] == 'landscape'
    assert result['content_form'] == 'natural_photo'


def test_fixed_destination_rejects_mismatched_subcategory():
    assert destination('study', 'notes') == '02_学习科研/课程笔记'
    assert destination('study', None) == '02_学习科研'
    with pytest.raises(SafetyError, match='INVALID_SUBCATEGORY'):
        destination('study', 'invoice')
    with pytest.raises(SafetyError):
        destination('photos', '../../bad')


def test_negated_document_title_does_not_become_invoice():
    result = classify_text('x.txt', '这不是增值税电子普通发票\n请勿作为发票使用，本页只是空白模板说明。')
    assert result['review_required'] is True
    assert result['category'] != 'finance'


def test_invoice_word_alone_in_article_is_not_a_ticket():
    result = classify_text('x.txt', '关于发票识别的讨论\n我们研究的算法只是示例，不包含真实票据信息。')
    assert result['review_required'] is True


def test_learning_image_title_recognized_without_exact_notes_phrase():
    result = fuse_image('random.png', '课程复习 线性代数\n矩阵 特征值 线性变换', [], [])
    assert result['category'] == 'study'
    assert result['subcategory'] == 'notes'


def test_negated_invoice_fields_are_not_positive_support():
    result = classify_text('x.txt', '这不是增值税电子普通发票\n没有真实购买方、销售方、发票号码、税额信息，只是一个学习算法说明。')
    assert result['review_required'] is True
    assert result['category'] != 'finance'


def test_quoted_invoice_example_in_tutorial_needs_review():
    result = classify_text('x.txt', '票据识别算法教程\n下面引用一个"增值税电子普通发票"示例，包含发票号码、购买方、销售方、价税合计等字段，供课程学习使用。')
    assert result['review_required'] is True


def test_visual_model_cannot_erase_competing_ocr_categories():
    result = fuse_image('mixed.png', '劳动合同\n甲方乙方签字盖章\n个人简历\n教育经历 工作经历 求职意向', [
        {'label': 'people', 'score': .38}, {'label': 'document', 'score': .29},
    ], [])
    assert result['review_required'] is True
    assert 'competing_categories' in result['review_reasons']
