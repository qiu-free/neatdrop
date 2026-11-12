"""Independent acceptance subjects, real document bytes and image fingerprints."""
import io
import json
import socket
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from neatdrop.analysis import decode_input
from neatdrop.graph_matching import image_fingerprint, match_features, text_features

CORPUS = Path(__file__).resolve().parents[2] / 'scripts/evaluation/graph_corpus_v9.json'


def test_evaluation_cli_reports_labelled_results_and_limits():
    result = subprocess.run([sys.executable, '-X', 'utf8', 'scripts/evaluate_graph_v9.py'], cwd=CORPUS.parents[2], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode('utf-8', errors='replace')
    report = json.loads(result.stdout)
    assert report['files'] == 160 and report['related_pairs'] == 40 and report['negative_pairs'] == 40
    assert report['precision'] >= .9 and report['related_file_coverage'] >= .6
    assert report['limits'] and report['benchmark']['files'] == 1000


def test_independent_corpus_meets_candidate_precision_and_file_coverage():
    data = json.loads(CORPUS.read_text('utf-8'))
    features, expected, relevant = {}, set(), set()
    assert len(data['related']) >= 40 and len(data['unrelated']) >= 40
    for index, (_, first, second) in enumerate(data['related']):
        left, right = f'related-{index:02}-a', f'related-{index:02}-b'
        features[left], features[right] = text_features(first), text_features(second)
        expected.add(frozenset((left, right)))
        relevant.update((left, right))
    for index, (first, second) in enumerate(data['unrelated']):
        features[f'negative-{index:02}-a'] = text_features(first)
        features[f'negative-{index:02}-b'] = text_features(second)
    actual = match_features(features)
    correct = [edge for edge in actual if frozenset((edge['source'], edge['target'])) in expected]
    covered = {identifier for edge in correct for identifier in (edge['source'], edge['target'])}
    assert actual and len(correct) / len(actual) >= .9
    assert len(covered & relevant) / len(relevant) >= .6
    assert all(edge['status'] == 'suggested' and edge['origin'] == 'automatic' for edge in actual)


def test_real_office_csv_and_plain_text_connect_offline(monkeypatch):
    # The real parser process must succeed without socket access. Do not mock
    # extraction or matching: actual decoded payloads become candidate inputs.
    def forbidden(*args, **kwargs):
        raise AssertionError('Graph document acceptance must remain offline')
    monkeypatch.setattr(socket, 'create_connection', forbidden)
    from test_document_formats_v7 import document_bytes
    features = {'plain': text_features('线性代数课程笔记。课程学习矩阵与特征值，课堂笔记包括线性代数复习要点。')}
    for ext in ('.docx', '.pptx', '.xlsx', '.csv'):
        payload = decode_input(document_bytes(ext), ext, local=True)
        features[ext] = text_features(payload['text'])
    edges = match_features(features)
    covered = {key for edge in edges for key in (edge['source'], edge['target'])}
    assert covered == {'.docx', '.pptx', '.xlsx', '.csv', 'plain'}
    assert all(edge['kind'] == 'text_similar' for edge in edges)


def test_real_image_compression_is_candidate_not_duplicate():
    first = Image.new('RGB', (320, 220), '#d3e4f2')
    draw = ImageDraw.Draw(first)
    draw.polygon([(0, 220), (75, 35), (230, 220)], fill='#416251')
    draw.ellipse((235, 25, 290, 80), fill='#f1d89c')
    image_bytes = io.BytesIO()
    first.save(image_bytes, format='JPEG', quality=70)
    with Image.open(io.BytesIO(image_bytes.getvalue())) as compressed:
        second_hash = image_fingerprint(compressed)
    features = {'a': text_features(''), 'b': text_features('')}
    features['a']['fingerprint'] = image_fingerprint(first)
    features['b']['fingerprint'] = second_hash
    edges = match_features(features)
    assert len(edges) == 1
    assert edges[0]['kind'] == 'visual_similar' and edges[0]['status'] == 'suggested'
    assert image_fingerprint(Image.new('RGB', (320, 220), 'white')) is None
