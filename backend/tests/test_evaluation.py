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
    assert report['semantic_experiment']['rules_toggle'] == 'product'
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


def test_product_quality_rules_are_not_omitted_from_evaluation_pipeline():
    from neatdrop.classification_pipeline import classify_payload

    prediction = classify_payload(
        {'id': 'short', 'name': 'notes.txt', 'extension': '.txt'},
        {'text': 'abc', 'sample': 'short fixture'},
    )

    assert prediction['review_required'] is True
    assert prediction['quality']['state'] == 'limited'
    assert prediction['review_required']


def test_evaluator_processes_supported_csv_and_docx_paths_with_production_pipeline(tmp_path):
    import json
    from test_document_formats_v7 import document_bytes
    from scripts.evaluate_offline import evaluate

    (tmp_path / 'rows.csv').write_text(
        '标题,课程,知识点\n线性代数课程笔记,线性代数,矩阵与特征值\n课堂笔记与复习要点,线性代数,证明与公式\n',
        encoding='utf-8')
    (tmp_path / 'notes.docx').write_bytes(document_bytes('.docx'))
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'version': 1, 'records': [
        row('csv', 'csv-source', path='rows.csv', name='rows.csv'),
        row('docx', 'docx-source', path='notes.docx', name='notes.docx'),
    ]}), encoding='utf-8')

    report = evaluate(manifest, ['rules'])

    assert report['stages']['rules']['processing_failures'] == 0
    assert report['stages']['rules']['suggestion_diagnostics']['quality_state_counts']['acceptable'] == 2
    assert report['stages']['rules']['suggestion_diagnostics']['evidence_source_counts']['title'] >= 1


def test_rules_stage_observes_product_semantic_toggle_and_reports_semantic_evidence(tmp_path, monkeypatch):
    import json
    import neatdrop.semantic as semantic
    from scripts.evaluate_offline import evaluate

    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'version': 1, 'records': [
        row(text='未命名内容：关于矩阵与线性变换的讨论。')]}), encoding='utf-8')
    monkeypatch.setenv('NEATDROP_SEMANTIC_CANDIDATES', '1')
    monkeypatch.setattr(semantic, 'classify_semantic', lambda text: {
        'candidates': [{'category': 'study', 'subcategory': 'notes', 'score': .8}],
        'warnings': [], 'version': 'fixture', 'truncated': False})

    report = evaluate(manifest, ['rules'])

    assert report['stages']['rules']['suggestion_diagnostics']['evidence_source_counts']['semantic'] == 1


def test_group_split_assignment_is_repeatable_and_keeps_groups_together():
    from scripts.evaluation.make_group_splits import split_manifest

    manifest = {'version': 1, 'records': [row(f'item-{i}', f'group-{i // 2}') for i in range(20)]}

    first = split_manifest(manifest, seed='test-seed')
    second = split_manifest(manifest, seed='test-seed')

    assert [r['split'] for r in first['records']] == [r['split'] for r in second['records']]
    assert all(len({r['split'] for r in first['records'] if r['group'] == group}) == 1
               for group in {r['group'] for r in first['records']})
    assert first['split_metadata']['group_counts'] == {'development': 6, 'calibration': 2, 'test': 2}
    assert 'no samples or accuracy evidence' in first['split_metadata']['quality_claim']


def test_group_split_tool_rejects_input_group_leakage():
    from scripts.evaluation.make_group_splits import split_manifest

    with pytest.raises(ValueError, match='GROUP_SPLIT_LEAK'):
        split_manifest({'version': 1, 'records': [row(), row('b', split='test')]})


def test_group_split_cli_writes_reproducible_assignments_and_input_metadata(tmp_path):
    import hashlib
    import json
    import subprocess
    import sys
    from pathlib import Path

    source = tmp_path / 'input.json'
    source.write_text(json.dumps({'version': 1, 'records': [
        row(f'item-{i}', f'group-{i // 2}') for i in range(20)]}), encoding='utf-8')
    output = tmp_path / 'split.json'
    script = Path(__file__).resolve().parents[2] / 'scripts/evaluation/make_group_splits.py'

    result = subprocess.run([sys.executable, str(script), '--input', str(source), '--output', str(output),
                             '--seed', 'fixed'], capture_output=True, timeout=20)

    assert result.returncode == 0, result.stderr.decode(errors='replace')
    manifest = json.loads(output.read_text('utf-8'))
    assert manifest['split_metadata']['seed'] == 'fixed'
    assert manifest['split_metadata']['input_sha256'] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert manifest['split_metadata']['group_counts'] == {'development': 6, 'calibration': 2, 'test': 2}
