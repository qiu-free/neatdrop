"""Matching behavior: template suppression, independent terms and bounded degree."""
from neatdrop.graph_matching import text_features, match_features, image_fingerprint


def test_same_template_different_subject_is_not_a_fact():
    a = text_features('项目报告\n厨房设备巡检，清洗油烟过滤网。')
    b = text_features('项目报告\n森林样地鸟类调查，记录迁徙路线。')
    assert not match_features({'a': a, 'b': b})


def test_normalization_common_terms_and_actual_locations():
    a = text_features('ＱＵＡＮＴＵＭ photon entanglement measures polarization correlations')
    b = text_features('quantum photon entanglement polarization experiment correlations')
    assert a['terms']['quantum'][0] == [0, 7]
    edges = match_features({'a': a, 'b': b})
    assert len(edges) == 1
    assert edges[0]['kind'] == 'text_similar'
    assert len(edges[0]['keywords']) >= 2
    assert edges[0]['status'] == 'suggested'


def test_one_term_or_low_quality_never_connects():
    assert not match_features({'a': text_features('photon kitchen cooking oven'), 'b': text_features('photon forest bird migration')})
    a = text_features('photon quantum entanglement \ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd')
    assert not match_features({'a': a, 'b': a})


def test_degree_bound_is_stable_at_both_endpoints():
    features = {str(i): text_features('Quantum photon entanglement experiment polarization correlations') for i in range(12)}
    edges = match_features(features)
    assert edges == match_features(dict(reversed(list(features.items()))))
    for identifier in features:
        assert sum(identifier in (r['source'], r['target']) for r in edges) <= 5


def test_blank_image_has_no_fingerprint():
    from PIL import Image
    assert image_fingerprint(Image.new('RGB', (100, 100), 'white')) is None

def test_large_repeated_corpus_has_bounded_candidate_memory():
    import tracemalloc
    features = {str(i): text_features('quantum photon entanglement polarization correlations experiment ' * 3) for i in range(1000)}
    tracemalloc.start()
    try:
        edges = match_features(features)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 40 * 1024 * 1024
    assert len(edges) <= 2500
    assert edges



def test_template_headings_cannot_outvote_different_body():
    a = text_features('# Objectives\n# Methodology\n# Deliverables\nKitchen equipment sanitation exhaust ventilation filters')
    b = text_features('# Objectives\n# Methodology\n# Deliverables\nForest bird migration nesting habitat conservation')
    assert not match_features({'a': a, 'b': b})

def test_many_shared_markdown_headings_are_not_subject_evidence():
    headings = '# Objectives\n## Methodology\n## Deliverables\n## Implementation\n## Evaluation\n## Timeline\n## Resources\n## Governance\n'
    assert not match_features({'a': text_features(headings + 'Kitchen sanitation exhaust filters'),
                               'b': text_features(headings + 'Forest migration nesting habitat')})
