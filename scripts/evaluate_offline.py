"""Evaluate only an explicit authorized manifest; never scans personal folders."""
import argparse
import hashlib
import importlib.util
import importlib.metadata
import json
import platform
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.classification_pipeline import classify_payload
from neatdrop.evaluation import validate_manifest, summarize


def evaluate(manifest_path, stages, split=None):
    data = manifest_path.read_bytes()
    rows = validate_manifest(json.loads(data))
    if split:
        rows = [r for r in rows if r['split'] == split]
    baseline_spec = importlib.util.spec_from_file_location('baseline_v2', PROJECT / 'scripts/evaluation/baseline_v2.py')
    baseline = importlib.util.module_from_spec(baseline_spec)
    baseline_spec.loader.exec_module(baseline)
    report = {'manifest_sha256': hashlib.sha256(data).hexdigest(), 'manifest_version': 1,
              'python': platform.python_version(), 'platform': platform.system(),
              'scope': 'Development fixtures; not independent production accuracy evidence.',
              'baseline_scope': 'Frozen v2 classifier. Inline text uses v2 first-12000 sampling; explicit file paths share v3 extraction across stages. Path results compare classifiers only, not v2/v3 extraction.',
              'semantic_experiment': {'rules_uses_product_toggle': True,
                                      'semantic_stage': 'Explicit experimental comparison stage; not product-default evidence.'},
              'sample_sha256': {},
              'engine_fingerprints': {name: hashlib.sha256((PROJECT / 'backend/neatdrop' / name).read_bytes()).hexdigest()
                                      for name in ('analysis.py', 'classifier.py', 'classification_pipeline.py', 'content_quality.py',
                                                   'decision.py', 'extraction.py', 'offline.py', 'semantic.py',
                                                   'classification_profiles.json')},
              'evaluation_tool_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'split_tool_sha256': hashlib.sha256((PROJECT / 'scripts/evaluation/make_group_splits.py').read_bytes()).hexdigest(),
              'baseline_sha256': hashlib.sha256((PROJECT / 'scripts/evaluation/baseline_v2.py').read_bytes()).hexdigest(),
              'dependencies': {name: importlib.metadata.version(name) for name in
                               ('onnxruntime', 'tokenizers', 'numpy', 'rapidocr-onnxruntime', 'pillow', 'pypdf')},
              'model_packages': {},
              'stages': {}}
    for name in ('bge-small-zh-v1.5', 'clip-vit-base-patch32'):
        try:
            raw = (PROJECT / 'models' / name / 'manifest.json').read_bytes()
            package = json.loads(raw)
            report['model_packages'][name] = {'manifest_sha256': hashlib.sha256(raw).hexdigest(),
                                              'repository': package.get('repository'),
                                              'revision': package.get('revision'), 'version': package.get('version')}
        except (OSError, ValueError):
            report['model_packages'][name] = {'available': False}
    for stage in stages:
        predictions = []
        for row in rows:
            start = time.perf_counter()
            try:
                if 'path' in row:
                    original_path = manifest_path.parent / row['path']
                    if any(p.is_symlink() for p in (original_path, *original_path.parents)):
                        raise ValueError('UNSAFE_SAMPLE_PATH')
                    path = original_path.resolve()
                    root = manifest_path.parent.resolve()
                    if not path.is_relative_to(root) or path.is_symlink():
                        raise ValueError('UNSAFE_SAMPLE_PATH')
                    from neatdrop.files import Workspace
                    from neatdrop.analysis import prepare_input
                    ws = Workspace(path.parent)
                    from neatdrop.files import MAX_FILE
                    if path.suffix.lower() not in {'.txt', '.md', '.pdf', '.png', '.jpg', '.jpeg', '.webp',
                                                   '.docx', '.pptx', '.xlsx', '.csv'} or path.stat().st_size > MAX_FILE:
                        raise ValueError('UNSUPPORTED_SAMPLE')
                    record = {'id': row['id'], 'name': path.name, 'extension': path.suffix.lower(),
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                    digest = record['sha256']
                    payload = prepare_input(ws, record, local=True)
                else:
                    from neatdrop.extraction import sample_text
                    digest = hashlib.sha256(row['text'].encode('utf-8')).hexdigest()
                    payload = sample_text(row['text']) if stage != 'baseline' else {'text': row['text'][:12000]}
                previous_digest = report['sample_sha256'].setdefault(row['id'], digest)
                if previous_digest != digest:
                    raise ValueError('SAMPLE_CHANGED_DURING_EVALUATION')
                image = payload.get('local_image', False)
                text = payload.get('text', '')
                if stage == 'baseline':
                    result = baseline.fuse_image(row['name'], text, payload.get('visual', []), payload.get('warnings', [])) if image else baseline.classify_text(row['name'], text)
                else:
                    semantic = None
                    if stage == 'semantic':
                        from neatdrop.semantic import classify_semantic
                        semantic = classify_semantic(text)
                    elif stage == 'rules':
                        from neatdrop.analysis import local_semantic
                        semantic = local_semantic(text)
                    result = classify_payload({'id': row['id'], 'name': row['name'],
                                               'extension': Path(row['name']).suffix.lower()},
                                              payload, semantic=semantic)
                predictions.append({'id': row['id'], **result, 'elapsed': time.perf_counter() - start})
            except Exception as exc:
                # Do not serialize arbitrary exception text: parser messages can
                # contain filenames or private document contents.
                predictions.append({'id': row['id'], 'error': getattr(exc, 'code', type(exc).__name__),
                                    'elapsed': time.perf_counter() - start})
        report['stages'][stage] = summarize(rows, predictions)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stages', nargs='+', choices=['baseline', 'rules', 'semantic'], default=['baseline', 'rules', 'semantic'])
    parser.add_argument('--split', choices=['development', 'calibration', 'test'])
    parser.add_argument('--semantic', choices=['product', 'off', 'on'], default='product',
                        help='rules-stage semantic candidates: product env toggle, forced off, or explicit experiment')
    args = parser.parse_args()
    if args.semantic != 'product':
        import os
        if args.semantic == 'on':
            os.environ['NEATDROP_SEMANTIC_CANDIDATES'] = '1'
        else:
            os.environ.pop('NEATDROP_SEMANTIC_CANDIDATES', None)
    result = evaluate(args.manifest.resolve(), args.stages, args.split)
    result['semantic_experiment']['rules_toggle'] = args.semantic
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['# 离线分类开发集对照', '', result['scope'], '',
             result['baseline_scope'], '',
             f"Semantic settings: `{result['semantic_experiment']}`", '',
             f"Manifest SHA-256: `{result['manifest_sha256']}`", '',
             '| 阶段 | 样本 | 子类首选命中 | Top-3 | 普通建议/错误 | 待复核 | 拒判 | P95 秒 |',
             '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for name, s in result['stages'].items():
        lines.append(f"| {name} | {s['count']} | {s['top1_subcategory_hits']}/{s['labeled_count']} | {s['top3_hits']}/{s['top3_denominator']} | {s['ordinary_count']}/{s['ordinary_errors']} | {s['review_count']} | {s['abstain_count']} | {s['elapsed_seconds']['p95']} |")
    args.output.with_suffix('.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({name: {k: s[k] for k in ('count', 'top1_subcategory_hits', 'top3_hits', 'ordinary_count', 'ordinary_errors', 'processing_failures')} for name, s in result['stages'].items()}))


if __name__ == '__main__':
    main()
