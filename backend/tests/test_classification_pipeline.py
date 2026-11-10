"""The offline evaluator and local workbench share classification decisions."""
import copy

import pytest

from neatdrop.analysis import analyze_local
from neatdrop.classification_pipeline import classify_payload


RECORD = {'id': 'fixture', 'name': 'original.txt', 'extension': '.txt'}


@pytest.mark.parametrize('payload', [
    {'text': 'abc', 'sample': 'short fixture'},
    {'text': '课程笔记\n矩阵与特征值', 'sample': 'partial fixture',
     'sampling': {'kind': 'text', 'truncated': True, 'budget_exhausted': True,
                  'segments': [], 'summary': 'partial fixture'}},
    {'text': '课程笔记\n矩阵与特征值', 'sample': 'image fixture', 'local_image': True,
     'visual': [], 'warnings': [], 'ocr_lines': []},
    {'text': '线性代数课程笔记\n知识点：矩阵与特征值', 'sample': 'CSV fixture',
     'sampling': {'kind': 'csv', 'separator': '\n', 'truncated': False,
                  'segments': [{'start': 0, 'end': 17, 'sample_start': 0, 'row': 1},
                               {'start': 18, 'end': 38, 'sample_start': 18, 'row': 2}]}},
])
def test_product_and_evaluation_pipeline_return_same_quality_evidence_and_name(payload):
    original = copy.deepcopy(payload)
    production = analyze_local(RECORD, payload)
    evaluated = classify_payload(RECORD, payload)

    assert evaluated == production
    assert payload == original
    if payload['text'] == 'abc':
        assert evaluated['quality']['state'] == 'limited'


def test_pipeline_accepts_explicit_semantic_candidate_without_loading_engine():
    semantic = {'candidates': [{'category': 'study', 'subcategory': 'notes', 'score': .8}],
                'warnings': [], 'version': 'fixture'}
    result = classify_payload(RECORD, {
        'text': '未命名的矩阵与线性变换内容。', 'sample': 'fixture',
        'sampling': {'kind': 'text', 'truncated': False, 'budget_exhausted': False,
                     'segments': [], 'summary': 'complete'},
    }, semantic=semantic)

    assert result['decision_level'] == 'candidate'
    assert result['review_required'] is True
    assert result['provider'] == 'offline_semantic'


def test_product_semantic_compatibility_hook_is_preserved(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: None)

    result = analyze_local(RECORD, {'text': 'abc', 'sample': 'fixture'})

    assert result['decision_level'] == 'abstain'


def test_analysis_classifier_import_remains_a_patchable_compatibility_hook(monkeypatch):
    import neatdrop.analysis as analysis

    def patched_classifier(name, text, sampling=None):
        return {'category': 'other', 'subcategory': 'unclassified', 'decision_level': 'abstain',
                'review_required': True, 'review_reasons': [], 'candidates': [], 'evidence_items': [],
                'content_form': 'text'}

    monkeypatch.setattr(analysis, 'classify_text', patched_classifier)
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: None)

    prediction = analysis.analyze_local(RECORD, {'text': '', 'sample': 'fixture'})

    assert prediction['category'] == 'other'
    assert prediction['name'] == 'original.txt'
