"""Explicit offline evaluation data validation and anonymous aggregate metrics."""
import math
import re
from collections import Counter, defaultdict

from .taxonomy import SUBCATEGORIES


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get('version') != 1:
        raise ValueError('MANIFEST_VERSION')
    rows = manifest.get('records')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 5000:
        raise ValueError('MANIFEST_SIZE')
    groups, identifiers = {}, set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('MANIFEST_RECORD')
        for field in ('id', 'group'):
            if not isinstance(row.get(field), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', row[field]):
                raise ValueError('MANIFEST_IDENTIFIER')
        if row['id'] in identifiers:
            raise ValueError('DUPLICATE_ID')
        identifiers.add(row['id'])
        split = row.get('split')
        if split not in {'development', 'calibration', 'test'}:
            raise ValueError('MANIFEST_SPLIT')
        if row['group'] in groups and groups[row['group']] != split:
            raise ValueError('GROUP_SPLIT_LEAK')
        groups[row['group']] = split
        if not all(isinstance(row.get(f), str) and row[f].strip() for f in ('source', 'authorization')):
            raise ValueError('SOURCE_AUTHORIZATION_REQUIRED')
        if not isinstance(row.get('must_review'), bool):
            raise ValueError('MUST_REVIEW_REQUIRED')
        if 'path' in row:
            # Manifest paths are portable project-relative inputs, never implicit
            # access to files elsewhere on a machine.
            path = row['path']
            if not isinstance(path, str) or not path or path.startswith(('/', '\\')) or ':' in path or '..' in path.replace('\\', '/').split('/'):
                raise ValueError('UNSAFE_SAMPLE_PATH')
        elif not isinstance(row.get('text'), str) or len(row['text']) > 1_000_000:
            raise ValueError('SAMPLE_TEXT_REQUIRED')
        if not isinstance(row.get('name'), str) or '/' in row['name'] or '\\' in row['name'] or len(row['name']) > 150:
            raise ValueError('SAMPLE_NAME')
        labels = row.get('acceptable')
        if not isinstance(labels, list) or len(labels) > 8:
            raise ValueError('LABELS_REQUIRED')
        for label in labels:
            if not isinstance(label, dict):
                raise ValueError('INVALID_LABEL')
            category, subtype = label.get('category'), label.get('subcategory')
            if not isinstance(category, str) or category not in SUBCATEGORIES:
                raise ValueError('INVALID_LABEL')
            if subtype is not None and (not isinstance(subtype, str) or subtype not in SUBCATEGORIES[category]):
                raise ValueError('INVALID_LABEL')
    return rows


def _wilson(errors, total):
    if not total:
        return None
    z = 1.959963984540054
    p = errors / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0., center - half), min(1., center + half)]


def _label(row):
    return f"{row.get('category', 'other')}/{row.get('subcategory') or '*'}"


def summarize(rows, predictions):
    by_id = {p['id']: p for p in predictions}
    count = len(rows)
    stats = Counter()
    warning_counts = Counter()
    classes = defaultdict(Counter)
    confusion = defaultdict(Counter)
    elapsed, errors = [], []
    anonymous = []
    for row in rows:
        pred = by_id.get(row['id'], {'error': 'MISSING_RESULT'})
        failure = bool(pred.get('error'))
        degraded = [code for code in pred.get('engine_warnings', []) if any(
            token in code for token in ('missing', 'unavailable', 'failed', 'timeout', 'exhausted', 'cancelled', 'exceeded'))]
        warning_counts.update(degraded)
        stats['degraded_count'] += bool(degraded)
        labels = row['acceptable']
        expected = {_label(label) for label in labels}
        actual = _label(pred) if not failure else 'error'
        subtype_hit = actual in expected
        main_hit = any(label['category'] == pred.get('category') for label in labels) and not failure
        ordinary = not failure and not pred.get('review_required', True) and pred.get('decision_level', 'ordinary') == 'ordinary'
        stats['processing_failures'] += failure
        stats['ordinary_count'] += ordinary
        stats['ordinary_errors'] += ordinary and (not subtype_hit or row['must_review'])
        stats['review_count'] += not ordinary
        stats['abstain_count'] += not failure and (pred.get('decision_level') == 'abstain' or pred.get('category') == 'other')
        if labels:
            stats['labeled_count'] += 1
            stats['top1_category_hits'] += main_hit
            stats['top1_subcategory_hits'] += subtype_hit
            candidates = pred.get('candidates', [])[:3] if not failure else []
            stats['top3_hits'] += any(_label(c) in expected for c in candidates)
            # Multi-label acceptable truth: score a correct alternative as correct,
            # otherwise choose the first supplied reference for confusion counts.
            truth = actual if subtype_hit else _label(labels[0])
            confusion[truth][actual] += 1
            classes[truth]['support'] += 1
            if subtype_hit:
                classes[actual]['tp'] += 1
            else:
                classes[truth]['fn'] += 1
                classes[actual]['fp'] += 1
        elif not failure:
            confusion['out_of_scope'][actual] += 1
            if pred.get('category') != 'other':
                classes[actual]['fp'] += 1
        duration = pred.get('elapsed')
        if isinstance(duration, (float, int)) and math.isfinite(duration) and duration >= 0:
            elapsed.append(duration)
        if failure:
            errors.append({'id': row['id'], 'code': str(pred['error'])[:80]})
        anonymous.append({'id': row['id'], 'split': row['split'], 'expected': sorted(expected),
                          'predicted': actual, 'review_required': not ordinary,
                          'decision_level': pred.get('decision_level', 'error' if failure else 'candidate')})
    per_class = {}
    for key, values in sorted(classes.items()):
        precision = values['tp'] / (values['tp'] + values['fp']) if values['tp'] + values['fp'] else 0.
        recall = values['tp'] / (values['tp'] + values['fn']) if values['tp'] + values['fn'] else 0.
        per_class[key] = {**dict(values), 'precision': precision, 'recall': recall,
                          'f1': 2 * precision * recall / (precision + recall) if precision + recall else 0.}
    supported = [v for v in per_class.values() if v.get('support', 0)]
    def percentile(fraction):
        return sorted(elapsed)[max(0, math.ceil(len(elapsed) * fraction) - 1)] if elapsed else None
    return {'count': count, **{key: stats[key] for key in (
        'processing_failures', 'degraded_count', 'ordinary_count', 'ordinary_errors', 'review_count', 'abstain_count',
        'labeled_count', 'top1_category_hits', 'top1_subcategory_hits', 'top3_hits')},
        'top3_denominator': stats['labeled_count'],
        'processing_success_rate': (count - stats['processing_failures']) / count if count else None,
        'ordinary_coverage': stats['ordinary_count'] / count if count else None,
        'ordinary_error_rate': stats['ordinary_errors'] / stats['ordinary_count'] if stats['ordinary_count'] else None,
        'ordinary_error_wilson95': _wilson(stats['ordinary_errors'], stats['ordinary_count']),
        'review_rate': stats['review_count'] / count if count else None,
        'abstain_rate': stats['abstain_count'] / count if count else None,
        'macro_f1': sum(c['f1'] for c in supported) / len(supported) if supported else None,
        'per_class': per_class, 'confusion': {k: dict(v) for k, v in confusion.items()},
        'engine_warning_counts': dict(warning_counts),
        'elapsed_seconds': {'p50': percentile(.5), 'p95': percentile(.95), 'total': sum(elapsed)},
        'failures': errors, 'records': anonymous}
