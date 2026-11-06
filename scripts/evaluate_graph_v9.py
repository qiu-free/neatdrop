"""Evaluate graph candidates against frozen synthetic subject-pair labels."""
import argparse
import hashlib
import json
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from neatdrop.graph_matching import ALGORITHM, match_features, text_features


def evaluate(corpus):
    features, labels, relevant = {}, set(), set()
    for index, (_, first, second) in enumerate(corpus['related']):
        left, right = f'related-{index:02}-a', f'related-{index:02}-b'
        features[left], features[right] = text_features(first), text_features(second)
        labels.add(frozenset((left, right)))
        relevant.update((left, right))
    negatives = set()
    for index, (first, second) in enumerate(corpus['unrelated']):
        left, right = f'negative-{index:02}-a', f'negative-{index:02}-b'
        features[left], features[right] = text_features(first), text_features(second)
        negatives.add(frozenset((left, right)))
    started = time.perf_counter()
    edges = match_features(features)
    elapsed = time.perf_counter() - started
    correct = [edge for edge in edges if frozenset((edge['source'], edge['target'])) in labels]
    wrong = [edge for edge in edges if frozenset((edge['source'], edge['target'])) not in labels]
    touched = {key for edge in edges for key in (edge['source'], edge['target'])}
    covered = {key for edge in correct for key in (edge['source'], edge['target'])}
    repeated = {str(index): text_features('quartz gravimeter calibration reference station gravity correction certificate north pier instrument') for index in range(1000)}
    benchmark_start = time.perf_counter()
    dense = match_features(repeated)
    degrees = Counter(key for edge in dense for key in (edge['source'], edge['target']))
    return {
        'algorithm': ALGORITHM, 'related_pairs': len(labels), 'negative_pairs': len(negatives),
        'files': len(features), 'candidates': len(edges), 'correct_candidates': len(correct),
        'precision': len(correct) / len(edges) if edges else 0,
        'related_file_coverage': len(covered & relevant) / len(relevant) if relevant else 0,
        'labelled_negative_edges': sum(frozenset((edge['source'], edge['target'])) in negatives for edge in edges),
        'no_result_files': len(features.keys() - touched),
        'quality_limited_files': sum(feature['quality']['state'] != 'acceptable' for feature in features.values()),
        'false_positive_pairs': [{'source': edge['source'], 'target': edge['target'], 'score': edge.get('score')} for edge in wrong],
        'match_seconds': round(elapsed, 4),
        'benchmark': {'files': 1000, 'candidates': len(dense), 'max_degree': max(degrees.values(), default=0), 'seconds': round(time.perf_counter() - benchmark_start, 4)},
        'limits': [
            'Frozen synthetic text pairs are deliberately explicit about shared subjects; these results do not estimate accuracy on private user files.',
            'Each intended related pair is labelled; other cross-pair edges count as false positives conservatively.',
            'OCR-like fixtures are supplied text, not an OCR engine benchmark. Real document-byte and compressed-image tests are separate.',
            'The 1000-file benchmark measures pure matching on this machine, not end-to-end extraction or browser rendering.',
            'Candidate nomination is bounded and can miss connections in large dense collections.',
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', type=Path, default=ROOT / 'scripts/evaluation/graph_corpus_v9.json')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    raw = args.corpus.read_bytes()
    report = evaluate(json.loads(raw))
    report['corpus_sha256'] = hashlib.sha256(raw).hexdigest()
    encoded = json.dumps(report, ensure_ascii=True, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + '\n', encoding='utf-8')
    print(encoded)
    return 0 if report['precision'] >= .9 and report['related_file_coverage'] >= .6 else 1


if __name__ == '__main__':
    raise SystemExit(main())
