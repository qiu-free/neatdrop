"""Compare actual analyze_local with frozen 3b041c1 on synthetic development data.

No inference, downloads, network, user paths or decoding are performed. Inputs
are deterministic extracted-text/OCR payloads. Format byte support is verified
separately; a parsed_content variant only checks extension-independent purpose.
Related variants share a group and must never be counted as independent samples.
"""
import argparse
import copy
import hashlib
import importlib
import importlib.abc
import importlib.metadata
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
from collections import Counter
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
BASELINE = '3b041c1'
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.analysis import analyze_local
from neatdrop.evaluation import summarize
from neatdrop.extraction import sample_text


def git(*args):
    return subprocess.run(['git', *args], cwd=PROJECT, capture_output=True, check=True).stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


class FrozenModules(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Only baseline bytes resolve under this package; no current-file fallback."""
    prefix = '_neatdrop_v7_frozen'

    def __init__(self):
        with tarfile.open(fileobj=io.BytesIO(git('archive', BASELINE, 'backend/neatdrop'))) as archive:
            self.sources = {Path(member.name).name: archive.extractfile(member).read()
                            for member in archive.getmembers() if member.isfile()}
        self.loaded = set()

    def find_spec(self, fullname, path=None, target=None):
        if fullname == self.prefix or fullname.startswith(self.prefix + '.'):
            return importlib.util.spec_from_loader(fullname, self, is_package=fullname == self.prefix)

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        filename = '__init__.py' if module.__name__ == self.prefix else module.__name__.rsplit('.', 1)[1] + '.py'
        source = self.sources[filename]  # A missing frozen dependency must fail.
        module.__file__ = f'frozen-{BASELINE}/backend/neatdrop/{filename}'
        self.loaded.add(filename)
        exec(compile(source, module.__file__, 'exec'), module.__dict__)


def fixture_payload(row, sampler):
    payload = sampler(row['text'])
    for key in ('sampling', 'visual', 'warnings'):
        if key in row:
            payload[key] = copy.deepcopy(row[key])
    if row.get('image'):
        payload['local_image'] = True
    if 'ocr_score' in row:
        payload['ocr_lines'] = [{'text': line, 'score': row['ocr_score']} for line in row['text'].splitlines()]
    return payload


def prediction(run, sampler, row):
    extension = '.png' if row.get('image') else row.get('extension', '.txt')
    record = {'id': row['id'], 'name': row.get('name', 'original' + extension), 'extension': extension}
    payload = fixture_payload(row, sampler)
    before = copy.deepcopy(payload)
    result = run(record, payload)
    if payload != before:
        raise AssertionError('analyze_local mutated the extracted payload')
    keys = ('category', 'subcategory', 'content_form', 'decision_level', 'review_required',
            'review_reasons', 'engine_warnings', 'candidates', 'engine_versions', 'quality')
    return {key: result[key] for key in keys} | {
        'id': row['id'], 'kept_original_name': result['name'] == record['name'],
        'evidence_sources': dict(Counter(item['source'] for item in result.get('evidence_items', [])))}


def purpose_variants(manifest):
    extensions = ['.docx', '.csv', '.xlsx', '.xlsx', '.pptx', '.docx', '.pptx']
    for index, group in enumerate(manifest['purpose_groups']):
        anchor, fields = group['anchor'], group['fields']
        positive = '\n'.join([anchor, *fields])
        labels = [field.split('：')[0] for field in fields]
        variants = {
            'explicit': {'text': positive},
            'synonym': {'text': '\n'.join([group['alias_anchor'], *group['alias_fields']])},
            'body_anchor': {'text': '\n'.join(['留存说明', '供后续核对。', '本页为' + anchor, *fields])},
            'two_fields': {'text': '\n'.join([anchor, *fields[:2]])},
            'same_line': {'text': anchor + '\n' + '；'.join(fields)},
            'tab_fields': {'text': '\n'.join([anchor, *[field.replace('：', '\t', 1) for field in fields]])},
            'ocr': {'text': positive, 'image': True, 'ocr_score': .95,
                    'visual': [{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}]},
            'parsed_content': {'text': positive, 'extension': extensions[index]},
            'partial': {'text': positive, 'sampling': {'kind': 'text', 'truncated': True,
                                                      'budget_exhausted': True, 'segments': []}},
            'filename_only': {'text': '普通文字内容，稍后整理。', 'name': anchor + '.txt'},
            'extension_only': {'text': '普通文字内容，稍后整理。', 'extension': extensions[index]},
            'title_only': {'text': anchor},
            'one_field': {'text': anchor + '\n' + fields[0]},
            'duplicate_group': {'text': '\n'.join([anchor, fields[0], fields[0], fields[0]])},
            'empty_fields': {'text': '\n'.join([anchor, *[label + '：' for label in labels]])},
            'tab_empty_fields': {'text': '\n'.join([anchor, *[label + '\t' for label in labels]])},
            'placeholders': {'text': '\n'.join([anchor, *[label + '：请填写' + label for label in labels]])},
            'negated_anchor': {'text': '并非' + positive},
            'negated_fields': {'text': '\n'.join([anchor, *['没有真实' + field for field in fields]])},
            'missing_values': {'text': '\n'.join([anchor, *[label + '：未提供' for label in labels]])},
            'tutorial': {'text': anchor + '编写教程\n' + '\n'.join(fields)},
            'template': {'text': anchor + '模板范本\n' + '\n'.join(fields)},
            'teaching': {'text': anchor + '操作教学\n' + '\n'.join(fields)},
            'legacy_conflict': {'text': '劳动合同\n甲方乙方\n合同期限三年\n双方签字盖章\n' + positive},
        }
        for variant, values in variants.items():
            family = next(key for key, members in manifest['variant_families'].items() if variant in members)
            expected = [{'category': group['category'], 'subcategory': group['subcategory']}]
            if family == 'sparse_negative':
                expected = []
            elif family == 'conflict':
                expected += [{'category': 'office', 'subcategory': 'contract'}]
                if group['category'] == 'office':
                    expected += [{'category': 'office', 'subcategory': None}]
            yield {'id': group['id'] + '-' + variant, 'group': group['id'], 'variant': variant,
                   'family': family, 'acceptable': expected, 'must_review': True,
                   'split': 'development', **values}


def previous_purposes(manifest):
    # Freeze old development inputs as well as code, and report their group
    # separately so expanded correlated variants cannot hide old regressions.
    for group in manifest['purpose_groups']:
        anchor, fields = group['anchor'], group['fields']
        positive = '\n'.join([anchor, *fields])
        variants = {
            'positive': {'text': positive},
            'filename_only': {'text': '普通文字内容，稍后整理。', 'name': anchor + '.txt'},
            'title_only': {'text': anchor}, 'one_group': {'text': anchor + '\n' + fields[0]},
            'negated_anchor': {'text': '这不是' + positive},
            'negated_fields': {'text': anchor + '\n' + '\n'.join('没有真实' + f for f in fields)},
            'empty_fields': {'text': '\n'.join([anchor, *[f.split('：')[0] + '：' for f in fields]])},
            'tutorial': {'text': anchor + '编写教程\n' + '\n'.join(fields)},
            'template': {'text': anchor + '空白模板范本\n' + '\n'.join(fields)},
            'legacy_conflict': {'text': '劳动合同\n甲方乙方\n合同期限三年\n双方签字盖章\n' + positive},
            'ocr': {'text': positive, 'image': True, 'ocr_score': .95,
                    'visual': [{'label': 'object', 'score': .4}, {'label': 'document', 'score': .25}]},
        }
        for variant, values in variants.items():
            family = 'positive' if variant in {'positive', 'ocr'} else 'example' if variant in {
                'tutorial', 'template'} else 'conflict' if variant == 'legacy_conflict' else 'sparse_negative'
            expected = [] if family == 'sparse_negative' else [
                {'category': group['category'], 'subcategory': group['subcategory']}]
            if family == 'conflict':
                expected += [{'category': 'office', 'subcategory': 'contract'},
                             {'category': 'office', 'subcategory': None}]
            yield {'id': 'v5-' + group['id'] + '-' + variant, 'group': 'v5-' + group['id'],
                   'family': family, 'variant': variant, 'acceptable': expected,
                   'must_review': True, 'split': 'development', **values}


def behavioral_check(row, result):
    actual = result['category'], result['subcategory']
    if row['family'] == 'positive':
        return (actual == (row['acceptable'][0]['category'], row['acceptable'][0]['subcategory'])
                and result['decision_level'] == 'candidate'
                and 'purpose_uncalibrated' in result['review_reasons'])
    if row['family'] == 'sparse_negative':
        return result['decision_level'] == 'abstain'
    if row['family'] in {'example', 'conflict'}:
        reason = 'example_context' if row['family'] == 'example' else 'competing_categories'
        return result['review_required'] and reason in result['review_reasons']
    acceptable = {(label['category'], label['subcategory']) for label in row['acceptable']}
    return ((actual in acceptable if acceptable else result['decision_level'] == 'abstain')
            and (not row['must_review'] or result['review_required'])
            and set(row.get('required_reasons', [])) <= set(result['review_reasons']))


def metrics(rows, results):
    summary = summarize(rows, results)
    keys = ('count', 'labeled_count', 'top1_category_hits', 'top1_subcategory_hits',
            'top3_hits', 'top3_denominator', 'ordinary_count', 'ordinary_errors', 'review_count',
            'abstain_count', 'processing_failures')
    return {key: summary[key] for key in keys} | {
        'unlabeled_count': sum(not row['acceptable'] for row in rows),
        'unlabeled_abstain_count': sum(not row['acceptable'] and result['decision_level'] == 'abstain'
                                      for row, result in zip(rows, results)),
        'ordinary_error_denominator': summary['ordinary_count'],
        'top1_hit_denominator': summary['labeled_count']}


def quality_records(manifest):
    labels = [('study', 'notes'), ('finance', 'invoice'), ('photos', 'landscape'),
              ('study', 'data_chart'), None, ('study', 'notes'), None, ('study', 'notes'),
              ('photos', 'landscape')]
    for row, label in zip(manifest['quality_cases'], labels, strict=True):
        yield dict(row, group='quality', family='quality', split='development',
                   acceptable=[] if label is None else [{'category': label[0], 'subcategory': label[1]}],
                   must_review=row['expect']['level'] != 'ordinary')


def evaluate():
    frozen = FrozenModules()
    sys.meta_path.insert(0, frozen)
    try:
        old = importlib.import_module(frozen.prefix + '.analysis').analyze_local
        old_sampler = importlib.import_module(frozen.prefix + '.extraction').sample_text
        new_bytes = (PROJECT / 'docs/evaluation/v7-development.json').read_bytes()
        new_manifest = json.loads(new_bytes)
        old_bytes = git('show', BASELINE + ':docs/evaluation/development.json')
        v5_bytes = git('show', BASELINE + ':docs/evaluation/v5-development.json')
        v5_manifest = json.loads(v5_bytes)
        sets = {
            'new7': list(purpose_variants(new_manifest)),
            'adjacent': [dict(row, family='adjacent', split='development') for row in new_manifest['adjacent_records']],
            'robustness': [dict(row, family='robustness', split='development') for row in new_manifest['robustness_records']],
            'legacy40': [dict(row, family='legacy') for row in json.loads(old_bytes)['records']],
            'prior8': list(previous_purposes(v5_manifest)),
            'quality9': list(quality_records(v5_manifest)),
        }
        sections, failures = {}, []
        compared = ('category', 'subcategory', 'content_form', 'decision_level', 'review_required',
                    'review_reasons', 'kept_original_name', 'quality')
        for section, rows in sets.items():
            previous = [prediction(old, old_sampler, row) for row in rows]
            current = [prediction(analyze_local, sample_text, row) for row in rows]
            records = []
            for row, before, after in zip(rows, previous, current):
                changed = [key for key in compared if before[key] != after[key]]
                if section == 'legacy40':
                    passed = not changed
                elif section == 'quality9':
                    expected = row['expect']
                    passed = (after['quality']['state'] == expected['state'] and
                              after['decision_level'] == expected['level'] and
                              (not expected.get('keep_name') or after['kept_original_name']) and
                              (not expected.get('issue') or expected['issue'] in after['quality']['issues']))
                else:
                    passed = behavioral_check(row, after)
                if not passed:
                    failures.append(row['id'])
                records.append({'id': row['id'], 'group': row['group'], 'family': row['family'],
                                'variant': row.get('variant'), 'acceptable': row['acceptable'],
                                'must_review': row['must_review'], 'changed': changed, 'passed': passed,
                                'baseline': before, 'v7': after})
            def report_subset(selected):
                subset = [rows[i] for i in selected]
                return {'baseline': metrics(subset, [previous[i] for i in selected]),
                        'v7': metrics(subset, [current[i] for i in selected])}
            sections[section] = {
                'group_count': len({row['group'] for row in rows}),
                'metrics': report_subset(range(len(rows))),
                'by_group': {group: report_subset([i for i, row in enumerate(rows) if row['group'] == group])
                             for group in sorted({row['group'] for row in rows})},
                'by_family': {family: report_subset([i for i, row in enumerate(rows) if row['family'] == family])
                              for family in sorted({row['family'] for row in rows})},
                'checks_passed': sum(record['passed'] for record in records),
                'changes_count': sum(bool(record['changed']) for record in records), 'records': records}
        return {'version': 1, 'engine_version': new_manifest['engine_version'], 'split': 'development',
                'source': new_manifest['source'], 'authorization': new_manifest['authorization'],
                'scope': __doc__, 'baseline_commit': git('rev-parse', BASELINE).decode().strip(),
                'current_head': git('rev-parse', 'HEAD').decode().strip(),
                'semantics': 'disabled by NEATDROP_SEMANTIC_CANDIDATES=0; no model inference',
                'manifest_sha256': {'v7': sha(new_bytes), 'legacy40_frozen': sha(old_bytes), 'prior8_frozen': sha(v5_bytes)},
                'script_sha256': sha(Path(__file__).read_bytes()),
                'baseline_loaded_modules_sha256': {name: sha(frozen.sources[name]) for name in sorted(frozen.loaded)},
                'baseline_profiles_sha256': sha(frozen.sources['classification_profiles.json']),
                'current_engine_sha256': {name: sha((PROJECT / 'backend/neatdrop' / name).read_bytes())
                                          for name in ('analysis.py', 'classifier.py', 'decision.py', 'content_quality.py',
                                                       'extraction.py', 'taxonomy.py', 'classification_profiles.json')},
                'dependencies': {name: importlib.metadata.version(name) for name in ('pypdf', 'pillow', 'httpx')},
                'summary': {section: {'count': data['metrics']['v7']['count'],
                                      'checks_passed': data['checks_passed'], 'changes_count': data['changes_count']}
                            for section, data in sections.items()} | {'failures': failures}, 'sections': sections}
    finally:
        sys.meta_path.remove(frozen)
        for name in [name for name in sys.modules if name == frozen.prefix or name.startswith(frozen.prefix + '.')]:
            del sys.modules[name]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'docs/evaluation/v7-development-results.json')
    args = parser.parse_args()
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
