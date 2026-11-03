"""Quality describes existing extraction, never classification correctness."""
import copy
import importlib
import importlib.util

import pytest

from neatdrop.analysis import analyze_local


def quality_module():
    # Fail as a missing feature assertion during RED, not collection failure.
    assert importlib.util.find_spec('neatdrop.content_quality') is not None, 'quality assessment is not implemented'
    return importlib.import_module('neatdrop.content_quality')


def analyze(text='', *, image=False, **extra):
    return analyze_local({'id': 'v5', 'name': 'original.png' if image else 'original.txt',
                          'extension': '.png' if image else '.txt'},
                         {'text': text, 'sample': 'synthetic development input',
                          **({'local_image': True} if image else {}), **extra})


def test_garbled_anchor_cannot_create_ordinary_suggestion_or_rename():
    result = analyze('课程笔记\n矩阵与特征值\n' + '\ufffd' * 120)
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert result['name'] == 'original.txt'
    assert 'text_garbled' in result['quality']['issues']
    assert 'content_quality_limited' in result['review_reasons']


def test_low_retained_ocr_confidence_limits_ticket_and_keeps_original_name():
    text = '增值税电子普通发票\n发票号码12345\n购买方甲\n销售方乙\n价税合计38.50元'
    result = analyze(text, image=True, ocr_lines=[{'text': line, 'score': .69} for line in text.splitlines()])
    assert (result['category'], result['subcategory']) == ('finance', 'invoice')
    assert result['decision_level'] == 'candidate'
    assert result['name'] == 'original.png'
    assert result['quality']['metrics']['ocr_mean_confidence'] == pytest.approx(.69)
    assert 'ocr_quality_limited' in result['review_reasons']


@pytest.mark.parametrize('visual,label', [
    ([{'label': 'landscape', 'score': .4}, {'label': 'object', 'score': .2}], ('photos', 'landscape')),
    ([{'label': 'bar_chart', 'score': .4}, {'label': 'screenshot', 'score': .3}], ('study', 'data_chart')),
])
def test_nontext_image_without_ocr_is_valid_input(visual, label):
    result = analyze(image=True, visual=visual, ocr_lines=[])
    assert (result['category'], result['subcategory']) == label
    assert result['quality']['state'] == 'acceptable'
    assert 'no_readable_text' not in result['quality']['issues']
    assert 'ocr_mean_confidence' not in result['quality']['metrics']
    assert result['name'] == 'original.png'


def test_truly_low_information_image_still_abstains():
    result = analyze(image=True, warnings=['image_low_information'])
    assert result['decision_level'] == 'abstain'
    assert result['quality']['state'] == 'unavailable'
    assert result['quality']['issues'] == ['low_information_image']


def test_low_information_warning_overrides_contradictory_visual_candidate():
    result = analyze(image=True, warnings=['image_low_information'],
                     visual=[{'label': 'landscape', 'score': .4}, {'label': 'object', 'score': .2}])
    assert result['decision_level'] == 'abstain'
    assert (result['category'], result['subcategory']) == ('other', 'unclassified')


def test_low_information_image_cannot_be_upgraded_by_optional_semantics(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: {
        'candidates': [{'category': 'study', 'subcategory': 'notes', 'score': .9}], 'warnings': []})
    result = analyze('课程笔记 矩阵特征值', image=True, warnings=['image_low_information'])
    assert result['decision_level'] == 'abstain'


def test_partial_read_keeps_sampling_and_quality_as_separate_diagnostics():
    sampling = {'kind': 'text', 'truncated': True, 'budget_exhausted': True, 'segments': []}
    result = analyze('课程笔记\n矩阵与特征值', sampling=sampling)
    assert result['quality']['state'] == 'limited'
    assert result['quality']['issues'] == ['partial_read']
    assert result['sampling'] == sampling
    assert 'partial_content' in result['review_reasons']
    assert 'content_quality_limited' in result['review_reasons']
    assert result['name'] == 'original.txt'


@pytest.mark.parametrize('text,state,issues', [
    ('', 'unavailable', ['no_readable_text']),
    (' \n\t', 'unavailable', ['no_readable_text']),
    ('课程笔记', 'limited', ['no_readable_text']),
    ('课程笔记\n矩阵与特征值', 'acceptable', []),
    ('\ufffd' * 8, 'unavailable', ['no_readable_text', 'text_garbled']),
    ('\ue000' * 10 + '课程笔记', 'limited', ['no_readable_text', 'text_garbled']),
    ('课程笔记\n矩阵、特征值与公式 ∑ x² = 1。', 'acceptable', []),
])
def test_readable_threshold_and_garbling_are_deterministic(text, state, issues):
    quality = quality_module().assess_content({'text': text}, False)
    assert quality['state'] == state
    assert quality['issues'] == issues


def test_quality_is_bounded_anonymous_and_does_not_mutate_payload():
    payload = {'text': '秘密正文：课程笔记\n矩阵与特征值' + '甲' * 13000,
               'ocr_lines': [{'text': '秘密行', 'score': .9, 'box': [[1, 2]]}],
               'sampling': {'truncated': True}, 'warnings': ['arbitrary-private-warning']}
    original = copy.deepcopy(payload)
    quality = quality_module().assess_content(payload, False)
    assert payload == original
    assert quality['metrics']['text_chars'] == 12000
    assert set(quality['metrics']) == {'text_chars', 'readable_chars', 'replacement_chars', 'ocr_lines'}
    assert '秘密' not in str(quality)
    assert 'arbitrary-private-warning' not in str(quality)
    assert set(quality) == {'state', 'issues', 'summary', 'metrics'}


@pytest.mark.parametrize('score', [None, True, float('nan'), float('inf'), -.1, 1.1, '0.7'])
def test_absent_or_invalid_ocr_score_cannot_become_a_probability(score):
    line = {'text': '普通图中文字', **({'score': score} if score is not None else {})}
    quality = quality_module().assess_content({'text': line['text'], 'ocr_lines': [line]}, True)
    assert 'ocr_mean_confidence' not in quality['metrics']
    assert 'ocr_low_confidence' not in quality['issues']


def test_valid_ocr_scores_only_are_averaged():
    quality = quality_module().assess_content({'text': '课程笔记 矩阵特征值', 'ocr_lines': [
        {'text': '课程笔记', 'score': .7}, {'text': '矩阵特征值', 'score': .9},
        {'text': '', 'score': 0}, {'text': 'ignored', 'score': float('nan')} ]}, True)
    assert quality['metrics']['ocr_mean_confidence'] == pytest.approx(.8)
    # The .7 title still limits naming even when the valid-score mean is .8.
    assert 'ocr_low_confidence' in quality['issues']


def test_apply_quality_is_copying_idempotent_and_preserves_existing_reasons():
    classification = {'category': 'study', 'subcategory': 'notes', 'decision_level': 'ordinary',
                      'review_required': False, 'review_reasons': ['example_context'],
                      'evidence_items': [{'source': 'title', 'text': '课程笔记'}]}
    original = copy.deepcopy(classification)
    module = quality_module()
    quality = module.assess_content({'text': '课程笔记' + '\ufffd' * 20}, False)
    first = module.apply_content_quality(classification, quality)
    second = module.apply_content_quality(first, quality)
    assert classification == original
    assert first == second
    assert first['decision_level'] == 'candidate'
    assert first['review_required']
    assert first['review_reasons'] == ['example_context', 'content_quality_limited']


def test_damaged_title_cannot_be_hidden_by_a_long_readable_body_for_renaming():
    result = analyze('\ufffd课程笔记\n本节学习矩阵与特征值。' + '正文内容可读。' * 50)
    assert result['name'] == 'original.txt'


def test_mean_ocr_score_cannot_hide_a_low_quality_title_line():
    text = '课程笔记\n本节学习矩阵与特征值'
    result = analyze(text, image=True, ocr_lines=[{'text': '课程笔记', 'score': .66},
                                                *[{'text': '本节学习矩阵与特征值', 'score': .99}] * 8])
    assert result['name'] == 'original.png'
    assert result['decision_level'] == 'candidate'
    assert 'ocr_low_confidence' in result['quality']['issues']


def test_high_ocr_mean_cannot_hide_low_quality_support_fields():
    text = '增值税电子普通发票\n发票号码12345\n购买方甲\n销售方乙\n价税合计38.50元'
    result = analyze(text, image=True, ocr_lines=[{'text': '增值税电子普通发票', 'score': .99},
                                                {'text': '购买方甲 销售方乙', 'score': .69},
                                                *[{'text': '发票号码12345', 'score': .99}] * 8])
    assert result['quality']['metrics']['ocr_mean_confidence'] > .9
    assert result['decision_level'] == 'candidate'
    assert result['name'] == 'original.png'


def test_analyze_local_never_mutates_nested_payload():
    payload = {'text': '课程笔记\n本节学习矩阵与特征值', 'sample': 'synthetic', 'local_image': True,
               'ocr_lines': [{'text': '课程笔记', 'score': .9, 'box': [[1, 2], [3, 2], [3, 4], [1, 4]]}],
               'visual': [], 'warnings': [], 'sampling': {'kind': 'image', 'segments': []}}
    before = copy.deepcopy(payload)
    analyze_local({'id': 'a', 'name': 'x.png', 'extension': '.png'}, payload)
    assert payload == before


@pytest.mark.parametrize('prefix', ['---', '***', '...', '###', '#   ', '# ---', '---\ntitle: ignored\n---'])
def test_punctuation_or_empty_markdown_title_keeps_name_without_lowering_body_quality(prefix):
    result = analyze(prefix + '\n课程笔记\n本节学习矩阵与特征值')
    assert result['name'] == 'original.txt'
    assert result['quality']['state'] == 'acceptable'
    assert (result['category'], result['subcategory']) == ('study', 'notes')
    assert result['decision_level'] == 'ordinary'


@pytest.mark.parametrize('heading', ['课程笔记', '# 课程笔记', '### 课程笔记'])
def test_readable_normal_and_markdown_titles_still_rename(heading):
    result = analyze(heading + '\n本节学习矩阵与特征值')
    assert result['name'] == '课程笔记.txt'
    assert result['quality']['state'] == 'acceptable'
    assert result['decision_level'] == 'ordinary'
