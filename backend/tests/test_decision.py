"""Protect review gates when rules, semantics and coverage disagree."""
import pytest

from neatdrop.classifier import classify_text, fuse_image
from neatdrop.decision import decide


def test_academic_structure_without_explicit_paper_heading_is_a_review_candidate():
    result = classify_text('random.txt', 'Efficient spectral methods for nonlinear systems\nAbstract\n'
                           'We propose a numerical method.\nKeywords: spectral methods\n'
                           '1 Introduction\n2 Methods\nReferences')
    assert (result['category'], result['subcategory']) == ('study', 'paper')
    assert result['review_required'] is True
    assert any(item['source'] == 'structure' for item in result['evidence_items'])


def test_mathematics_notes_without_notes_title_are_not_lost():
    result = classify_text('random.md', '矩阵与线性变换\n定义：线性映射在一组基下可表示为矩阵。\n'
                           '定理：相似矩阵具有相同的特征值。\n证明与例题')
    assert (result['category'], result['subcategory']) == ('study', 'notes')
    assert result['review_required'] is True


def test_generic_references_or_definition_does_not_imply_academic_document():
    result = classify_text('x.txt', '网站服务说明\n定义用户和服务的关系。\n参考文献格式见帮助中心。')
    assert result['category'] == 'other'
    assert result['review_required']


def test_weak_structural_ocr_is_preserved_as_document_candidate():
    result = fuse_image('x.png', '矩阵与线性变换\n定义：线性映射\n定理：相似矩阵\n证明与例题', [], [])
    assert (result['category'], result['subcategory']) == ('study', 'notes')
    assert result['content_form'] == 'document_image'
    assert result['review_required']


def unknown():
    return classify_text('unknown.txt', '')


def semantic(*candidates, **extra):
    return {'candidates': list(candidates), 'warnings': [], 'version': 'test-semantic', 'truncated': False, **extra}


def candidate(category, subtype, score=.8):
    return {'category': category, 'subcategory': subtype, 'score': score, 'evidence': '用途语义相近'}


def test_semantic_only_suggestion_is_always_review_required():
    result = decide(unknown(), semantic(candidate('study', 'paper')))
    assert (result['category'], result['subcategory']) == ('study', 'paper')
    assert result['decision_level'] == 'candidate'
    assert result['review_required'] is True
    assert 'semantic_uncalibrated' in result['review_reasons']
    assert result['engine_versions']['semantic'] == 'test-semantic'


def test_close_same_main_candidates_produce_main_only():
    result = decide(unknown(), semantic(candidate('study', 'notes', .80), candidate('study', 'courseware', .79)))
    assert result['category'] == 'study'
    assert result['subcategory'] is None
    assert 'subtype_ambiguous' in result['review_reasons']
    assert len(result['candidates']) == 2


def test_semantic_disagreement_cannot_erase_strong_rule_or_required_review():
    rules = classify_text('x.txt', '个人简历\n教育背景 工作经历 项目经验 求职意向')
    result = decide(rules, semantic(candidate('study', 'notes')))
    assert (result['category'], result['subcategory']) == ('office', 'resume')
    assert result['review_required'] is True
    assert 'engine_disagreement' in result['review_reasons']
    assert {row['category'] for row in result['candidates']} == {'office', 'study'}


def test_sampling_truncation_blocks_ordinary_suggestion():
    result = decide(classify_text('x.txt', '课程笔记\n矩阵与特征值'), None,
                    {'kind': 'text', 'truncated': True, 'budget_exhausted': False,
                     'summary': '头中尾抽样', 'segments': []})
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'partial_content' in result['review_reasons']


@pytest.mark.parametrize('bad', [candidate('study', 'invoice'), candidate('../../bad', 'notes'),
                                candidate('other', 'unclassified'), candidate('photos', 'pet', float('nan'))])
def test_invalid_semantic_candidates_are_ignored(bad):
    result = decide(unknown(), semantic(bad))
    assert result['category'] == 'other'
    assert result['decision_level'] == 'abstain'
    assert result['review_required']


def test_missing_optional_semantics_does_not_invent_text_or_candidates():
    result = decide(unknown(), semantic(warnings=['semantic_models_missing']))
    assert result['decision_level'] == 'abstain'
    assert result['candidates'] == []
    assert 'semantic_models_missing' in result['engine_warnings']


def test_key_ocr_failure_requires_review_even_with_visual_scene():
    result = decide(fuse_image('x.png', '', [{'label': 'pet', 'score': .4},
                                           {'label': 'object', 'score': .2}], ['ocr_unavailable']))
    assert result['review_required']
    assert result['decision_level'] == 'candidate'


def test_clear_existing_rule_retains_result_without_optional_semantics():
    result = decide(classify_text('x.txt', '个人简历\n教育背景 工作经历 项目经验 求职意向'))
    assert result['category'] == 'office'
    assert result['decision_level'] == 'ordinary'
    assert result['review_required'] is False


def test_same_main_different_semantic_child_still_requires_review():
    rules = classify_text('x.txt', '个人简历\n教育背景 工作经历 项目经验 求职意向')
    result = decide(rules, semantic(candidate('office', 'contract', .95)))
    assert result['review_required']
    assert 'engine_disagreement' in result['review_reasons']


def test_main_only_can_never_be_an_ordinary_suggestion():
    result = decide({'category': 'study', 'subcategory': None, 'review_required': False,
                     'review_reasons': [], 'candidates': [], 'evidence_items': []})
    assert result['decision_level'] == 'candidate'
    assert result['review_required']


def test_semantic_chunk_conflict_is_kept_visible_and_requires_review():
    result = decide(classify_text('x.txt', '个人简历\n教育背景 工作经历 项目经验 求职意向'),
                    semantic(candidate('office', 'resume'), warnings=['semantic_chunk_conflict'],
                             chunk_support={'conflict': True, 'chunks': [{'chunk': 0, 'candidates': []}]}))
    assert result['review_required']
    assert 'conflicting_evidence' in result['review_reasons']
    assert result['semantic_details']['chunk_support']['conflict'] is True


@pytest.mark.parametrize('text', [
    '学术论文写作教程\n摘要应简洁，关键词应规范，研究方法应清楚，参考文献用统一格式。',
    'How to write a research paper\nAbstract\nKeywords\nMethods\nReferences',
    '论文格式说明\n摘要 abstract 关键词 keywords 参考文献 references 方法 结论',
    '桌面壁纸设置教程\n壁纸 分辨率',
])
def test_document_about_a_purpose_is_not_an_ordinary_document_of_that_purpose(text):
    result = decide(classify_text('x.txt', text))
    assert result['review_required']
    assert 'example_context' in result['review_reasons']


def test_optional_semantic_failure_is_disclosed_without_invalidating_independent_rule():
    result = decide(classify_text('x.txt', '个人简历\n教育背景 工作经历 项目经验 求职意向'),
                    semantic(warnings=['semantic_engine_failed']))
    assert result['category'] == 'office'
    assert result['decision_level'] == 'ordinary'
    assert 'semantic_engine_failed' in result['engine_warnings']
