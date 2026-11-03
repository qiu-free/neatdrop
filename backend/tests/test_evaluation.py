import pytest

from neatdrop.evaluation import validate_manifest, summarize


def row(identifier='a', group='one', split='development', **extra):
    return {'id': identifier, 'group': group, 'split': split, 'source': 'synthetic',
            'authorization': 'CC0', 'name': 'x.txt', 'text': '内容',
            'acceptable': [{'category': 'study', 'subcategory': 'notes'}],
            'must_review': False, **extra}


def test_same_template_cannot_leak_between_splits():
    with pytest.raises(ValueError, match='GROUP_SPLIT_LEAK'):
        validate_manifest({'version': 1, 'records': [row(), row('b', split='test')]})


@pytest.mark.parametrize('extra', [{'id': '../private'}, {'path': '../../secret.txt'},
                                  {'acceptable': [{'category': 'study', 'subcategory': 'invoice'}]},
                                  {'authorization': ''}])
def test_manifest_rejects_untrusted_metadata_or_mismatched_taxonomy(extra):
    with pytest.raises(ValueError):
        validate_manifest({'version': 1, 'records': [row(**extra)]})


def test_abstain_without_candidates_is_top3_miss_and_failure_is_in_denominator():
    rows = [row(), row('b', 'two')]
    predictions = [{'id': 'a', 'category': 'other', 'subcategory': 'unclassified',
                    'review_required': True, 'decision_level': 'abstain', 'candidates': [], 'elapsed': .1},
                   {'id': 'b', 'error': 'INFERENCE_FAILED', 'elapsed': .2}]
    report = summarize(rows, predictions)
    assert report['count'] == 2
    assert report['top3_hits'] == 0
    assert report['top3_denominator'] == 2
    assert report['processing_failures'] == 1
    assert report['processing_success_rate'] == .5
    assert report['review_count'] == 2


def test_ambiguous_ordinary_result_is_error_even_when_label_matches():
    rows = [row(must_review=True)]
    predictions = [{'id': 'a', 'category': 'study', 'subcategory': 'notes',
                    'review_required': False, 'decision_level': 'ordinary', 'elapsed': .1}]
    report = summarize(rows, predictions)
    assert report['ordinary_count'] == 1
    assert report['ordinary_errors'] == 1
    assert report['ordinary_error_rate'] == 1


def test_metrics_include_per_class_and_confusion_without_private_content():
    rows = [row(text='PRIVATE BODY', name='private-name.txt')]
    predictions = [{'id': 'a', 'category': 'study', 'subcategory': 'notes',
                    'review_required': True, 'decision_level': 'candidate', 'elapsed': .25,
                    'evidence': 'PRIVATE BODY'}]
    report = summarize(rows, predictions)
    assert report['top1_subcategory_hits'] == 1
    assert report['per_class']['study/notes']['recall'] == 1
    assert report['confusion']['study/notes']['study/notes'] == 1
    assert 'PRIVATE BODY' not in str(report)
    assert 'private-name.txt' not in str(report)


def test_zero_errors_still_has_nonzero_uncertainty():
    rows = [row(str(i), str(i)) for i in range(125)]
    predictions = [{'id': str(i), 'category': 'study', 'subcategory': 'notes',
                    'review_required': False, 'elapsed': .1} for i in range(125)]
    report = summarize(rows, predictions)
    assert .029 < report['ordinary_error_wilson95'][1] < .03


def test_cli_exercises_manifest_and_anonymous_report(tmp_path):
    import json
    import subprocess
    import sys
    from pathlib import Path
    manifest = tmp_path / 'input.json'
    output = tmp_path / 'report.json'
    manifest.write_text(json.dumps({'version': 1, 'records': [row(text='PRIVATE BODY')]}), encoding='utf-8')
    command = [sys.executable, str(Path(__file__).resolve().parents[2] / 'scripts/evaluate_offline.py'),
               '--manifest', str(manifest), '--output', str(output), '--stages', 'baseline', 'rules']
    result = subprocess.run(command, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    report = json.loads(output.read_text('utf-8'))
    assert report['stages']['baseline']['count'] == 1
    assert report['stages']['rules']['processing_failures'] == 0
    assert report['sample_sha256']['a'] == __import__('hashlib').sha256(b'PRIVATE BODY').hexdigest()
    assert report['engine_fingerprints']['classifier.py']
    assert 'PRIVATE BODY' not in output.read_text('utf-8')


def test_partial_engine_failures_are_disclosed_separately_from_completed_results():
    report = summarize([row()], [{'id': 'a', 'category': 'study', 'subcategory': 'notes',
                                  'review_required': True, 'engine_warnings': ['semantic_budget_exhausted']}])
    assert report['processing_failures'] == 0
    assert report['degraded_count'] == 1
    assert report['engine_warning_counts']['semantic_budget_exhausted'] == 1


def test_out_of_scope_false_positive_counts_against_class_precision():
    report = summarize([row(), row('b', 'two', acceptable=[])], [
        {'id': 'a', 'category': 'study', 'subcategory': 'notes', 'review_required': True},
        {'id': 'b', 'category': 'study', 'subcategory': 'notes', 'review_required': True}])
    assert report['per_class']['study/notes']['precision'] == .5
    assert report['confusion']['out_of_scope']['study/notes'] == 1
