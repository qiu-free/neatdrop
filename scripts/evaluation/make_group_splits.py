"""Deterministically assign development/calibration/test splits by source group."""
import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path


DEFAULT_RATIOS = {'development': .6, 'calibration': .2, 'test': .2}


def split_manifest(manifest, *, seed='neatdrop-v1', ratios=None):
    if not isinstance(manifest, dict) or not isinstance(manifest.get('records'), list):
        raise ValueError('MANIFEST_RECORDS_REQUIRED')
    ratios = ratios or DEFAULT_RATIOS
    if set(ratios) != set(DEFAULT_RATIOS) or any(not isinstance(v, (float, int)) or v <= 0 for v in ratios.values()):
        raise ValueError('INVALID_SPLIT_RATIOS')
    if not math.isclose(sum(ratios.values()), 1.0, rel_tol=0, abs_tol=1e-9):
        raise ValueError('INVALID_SPLIT_RATIOS')
    declared = {}
    groups = set()
    for record in manifest['records']:
        if not isinstance(record, dict) or not isinstance(record.get('group'), str) or not record['group']:
            raise ValueError('MANIFEST_GROUP_REQUIRED')
        group = record['group']
        groups.add(group)
        existing = record.get('split')
        if existing is not None:
            if existing not in DEFAULT_RATIOS:
                raise ValueError('INVALID_EXISTING_SPLIT')
            if group in declared and declared[group] != existing:
                raise ValueError('GROUP_SPLIT_LEAK')
            declared[group] = existing
    group_splits = dict(declared)
    unassigned = groups - set(declared)
    ordered = sorted(unassigned, key=lambda group: (hashlib.sha256(f'{seed}\0{group}'.encode('utf-8')).digest(), group))
    boundaries = (ratios['development'], ratios['development'] + ratios['calibration'])
    for index, group in enumerate(ordered):
        fraction = (index + .5) / max(1, len(ordered))
        split = 'development' if fraction < boundaries[0] else 'calibration' if fraction < boundaries[1] else 'test'
        group_splits[group] = split
    result = dict(manifest)
    result['records'] = [dict(record, split=group_splits[record['group']]) for record in manifest['records']]
    row_counts = Counter(record['split'] for record in result['records'])
    group_counts = Counter(group_splits.values())
    result['split_metadata'] = {'algorithm': 'sha256(seed + NUL + group), sorted-rank proportional assignment v1',
                                'seed': str(seed), 'ratios': dict(ratios),
                                'input_group_count': len(groups), 'assigned_group_count': len(ordered),
                                'preserved_group_count': len(declared), 'new_group_count': len(ordered),
                                'group_counts': dict(group_counts), 'record_counts': dict(row_counts),
                                'source_groups_remain_intact': True,
                                'quality_claim': 'Assignment metadata only; no samples or accuracy evidence are created.'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--seed', default='neatdrop-v1')
    parser.add_argument('--development', type=float, default=.6)
    parser.add_argument('--calibration', type=float, default=.2)
    parser.add_argument('--test', type=float, default=.2)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    manifest = json.loads(raw)
    result = split_manifest(manifest, seed=args.seed,
                            ratios={'development': args.development, 'calibration': args.calibration, 'test': args.test})
    result['split_metadata']['input_sha256'] = hashlib.sha256(raw).hexdigest()
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded, encoding='utf-8')
    print(json.dumps(result['split_metadata'], ensure_ascii=False))


if __name__ == '__main__':
    main()
