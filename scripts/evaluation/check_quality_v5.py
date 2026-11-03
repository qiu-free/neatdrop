"""Explicit synthetic v5 development regression, no downloads or model calls.

Runs the real analyze_local path with default-disabled experimental semantics.
Frozen classifier/decision/analysis come from local baseline commit 3336fe5;
unchanged extraction/safety dependencies are shared. The legacy 40-scenario
manifest is reported separately from the new eight purpose groups/variants.
Saved v4 image probe payloads can be replayed, without rerunning inference or
inventing absent OCR confidences/coverage. Counts are regression diagnostics,
not independent accuracy estimates.
"""
import argparse
import copy
import hashlib
import json
import os
import subprocess
import sys
import types
from collections import Counter
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
BASELINE = '3336fe5'
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.analysis import analyze_local
from neatdrop.extraction import sample_text


def frozen_analysis():
    package_name = '_neatdrop_v4_quality_comparison'
    package = types.ModuleType(package_name)
    package.__path__ = [str(PROJECT / 'backend/neatdrop')]
    sys.modules[package_name] = package
    fingerprints = {}
    for filename in ('classifier', 'decision', 'analysis'):
        source = subprocess.run(['git', 'show', f'{BASELINE}:backend/neatdrop/{filename}.py'],
                                cwd=PROJECT, capture_output=True, check=True).stdout
        fingerprints[filename + '.py'] = hashlib.sha256(source).hexdigest()
        module = types.ModuleType(package_name + '.' + filename)
        module.__package__ = package_name
        module.__file__ = str(PROJECT / 'backend/neatdrop' / (filename + '.py'))
        sys.modules[module.__name__] = module
        exec(compile(source, f'{BASELINE}:{filename}.py', 'exec'), module.__dict__)
    return module.analyze_local, fingerprints


def fixture_payload(row):
    payload = sample_text(row['text'])
    for key in ('sampling', 'visual', 'warnings'):
        if key in row:
            payload[key] = copy.deepcopy(row[key])
    if row.get('image'):
        payload['local_image'] = True
    if 'ocr_score' in row:
        payload['ocr_lines'] = [{'text': line, 'score': row['ocr_score']} for line in row['text'].splitlines()]
    return payload


def prediction(run, row):
    extension = '.png' if row.get('image') else '.txt'
    record = {'id': row['id'], 'name': row.get('name', 'original' + extension), 'extension': extension}
    payload = fixture_payload(row)
    before = copy.deepcopy(payload)
    result = run(record, payload)
    assert payload == before, 'input payload mutated'
    return {key: result[key] for key in ('category', 'subcategory', 'content_form', 'decision_level',
                                       'review_required', 'review_reasons')} | {
        'kept_original_name': result['name'] == record['name'],
        **({'quality': result['quality']} if 'quality' in result else {})}


def purpose_variants(groups):
    for group in groups:
        anchor, fields = group['anchor'], group['fields']
        positive = '\n'.join([anchor, *fields])
        variants = {
            'positive': {'text': positive},
            'filename_only': {'text': '普通文字内容，稍后整理。', 'name': anchor + '.txt'},
            'title_only': {'text': anchor},
            'one_group': {'text': anchor + '\n' + fields[0]},
            'negated_anchor': {'text': '这不是' + positive},
            'negated_fields': {'text': anchor + '\n' + '\n'.join('没有真实' + field for field in fields)},
            'empty_fields': {'text': '\n'.join([anchor, *[field.split('：')[0] + '：' for field in fields]])},
            'tutorial': {'text': anchor + '编写教程\n' + '\n'.join(fields)},
            'template': {'text': anchor + '空白模板范本\n' + '\n'.join(fields)},
            'legacy_conflict': {'text': '劳动合同\n甲方乙方\n合同期限三年\n双方签字盖章\n' + positive},
            'ocr': {'text': positive, 'image': True, 'ocr_score': .95,
                    'visual': [{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}]},
        }
        for variant, inputs in variants.items():
            yield {'id': group['id'] + '-' + variant, 'group': group['id'], 'variant': variant,
                   'expected_label': (group['category'], group['subcategory']), **inputs}


def evaluate():
    manifest_path = PROJECT / 'docs/evaluation/v5-development.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    legacy_path = PROJECT / 'docs/evaluation/development.json'
    old, fingerprints = frozen_analysis()
    all_rows, failures = [], []
    for row in purpose_variants(manifest['purpose_groups']):
        previous, current = prediction(old, row), prediction(analyze_local, row)
        actual = current['category'], current['subcategory']
        variant = row['variant']
        if variant in {'positive', 'ocr'}:
            passed = actual == row['expected_label'] and current['decision_level'] == 'candidate'
        elif variant in {'tutorial', 'template'}:
            passed = current['review_required'] and 'example_context' in current['review_reasons']
        elif variant == 'legacy_conflict':
            passed = current['review_required'] and 'competing_categories' in current['review_reasons']
        else:
            passed = actual != row['expected_label']
        if not passed:
            failures.append(row['id'])
        all_rows.append({'id': row['id'], 'group': row['group'], 'variant': variant,
                         'expected_label': row['expected_label'], 'passed': passed,
                         'baseline': previous, 'v5': current})
    quality_rows = []
    for row in manifest['quality_cases']:
        previous, current = prediction(old, row), prediction(analyze_local, row)
        expect = row['expect']
        passed = (current['quality']['state'] == expect['state'] and current['decision_level'] == expect['level']
                  and (not expect.get('keep_name') or current['kept_original_name'])
                  and (not expect.get('issue') or expect['issue'] in current['quality']['issues']))
        if not passed:
            failures.append(row['id'])
        quality_rows.append({'id': row['id'], 'expected': expect, 'passed': passed,
                             'baseline': previous, 'v5': current})
    legacy_rows = []
    for row in json.loads(legacy_path.read_bytes())['records']:
        previous, current = prediction(old, row), prediction(analyze_local, row)
        changed = [key for key in ('category', 'subcategory', 'decision_level', 'kept_original_name')
                   if previous[key] != current[key]]
        legacy_rows.append({'id': row['id'], 'changed': changed, 'baseline': previous, 'v5': current})
    image_rows = []
    saved_path = PROJECT / 'docs/superpowers/plans/v4-chart-probes.json'
    for saved in json.loads(saved_path.read_bytes())['probes']:
        row = {'id': saved['probe'], 'text': saved['ocr'], 'image': True,
               'visual': saved['visual_top3'], 'warnings': saved['warnings']}
        previous, current = prediction(old, row), prediction(analyze_local, row)
        image_rows.append({'id': row['id'], 'baseline': previous, 'v5': current})
    summary = {
        'purpose_groups': len(manifest['purpose_groups']), 'purpose_variants': len(all_rows),
        'purpose_checks_passed': sum(row['passed'] for row in all_rows),
        'positive_and_ocr_matching_candidates': sum(row['passed'] for row in all_rows if row['variant'] in {'positive', 'ocr'}),
        'new_purpose_ordinary_count': sum(row['v5']['decision_level'] == 'ordinary' for row in all_rows
                                        if (row['v5']['category'], row['v5']['subcategory']) == tuple(row['expected_label'])),
        'quality_cases': len(quality_rows), 'quality_checks_passed': sum(row['passed'] for row in quality_rows),
        'legacy_cases': len(legacy_rows), 'legacy_label_changes': sum(any(k in row['changed'] for k in ('category', 'subcategory')) for row in legacy_rows),
        'legacy_decision_changes': sum('decision_level' in row['changed'] for row in legacy_rows),
        'legacy_name_changes': sum('kept_original_name' in row['changed'] for row in legacy_rows),
        'saved_image_payload_replays': len(image_rows),
        'saved_image_label_changes': sum(any(row['baseline'][key] != row['v5'][key] for key in ('category', 'subcategory', 'content_form')) for row in image_rows),
        'quality_state_counts_saved_images': dict(Counter(row['v5']['quality']['state'] for row in image_rows)),
        'failures': failures,
    }
    return {'version': 1, 'engine_version': manifest['engine_version'], 'split': 'development',
            'source': manifest['source'], 'authorization': manifest['authorization'], 'scope': __doc__,
            'baseline_commit': BASELINE, 'semantics': 'disabled; no model inference',
            'v5_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'legacy_manifest_sha256': hashlib.sha256(legacy_path.read_bytes()).hexdigest(),
            'saved_image_probes_sha256': hashlib.sha256(saved_path.read_bytes()).hexdigest(),
            'baseline_engine_sha256': fingerprints,
            'v5_engine_sha256': {name: hashlib.sha256((PROJECT / 'backend/neatdrop' / name).read_bytes()).hexdigest()
                                 for name in ('content_quality.py', 'analysis.py', 'classifier.py', 'decision.py')},
            'summary': summary, 'purpose_records': all_rows, 'quality_records': quality_rows,
            'legacy_records': legacy_rows, 'saved_image_records': image_rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'docs/evaluation/v5-development-results.json')
    args = parser.parse_args()
    # Preserve the caller's environment; the regression must not accidentally
    # enable native semantic inference through a user's experimental setting.
    previous = os.environ.get('NEATDROP_SEMANTIC_CANDIDATES')
    os.environ['NEATDROP_SEMANTIC_CANDIDATES'] = '0'
    try:
        report = evaluate()
    finally:
        if previous is None:
            os.environ.pop('NEATDROP_SEMANTIC_CANDIDATES', None)
        else:
            os.environ['NEATDROP_SEMANTIC_CANDIDATES'] = previous
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))
    return bool(report['summary']['failures'])


if __name__ == '__main__':
    raise SystemExit(main())
