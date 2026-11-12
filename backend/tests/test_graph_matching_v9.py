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

def test_homogeneous_cjk_subject_keeps_shared_bigrams():
    subject = '线性代数课程学习矩阵特征值课堂复习要点。'
    features = {name: text_features(subject + suffix) for name, suffix in {
        'plain': '课堂笔记', 'docx': '课程讲义', 'pptx': '课程幻灯片', 'xlsx': '课程表格', 'csv': '课程数据'
    }.items()}
    edges = match_features(features)
    covered = {key for edge in edges for key in (edge['source'], edge['target'])}
    assert covered == set(features)

def test_common_chinese_process_boilerplate_does_not_connect_unrelated_files():
    boilerplate = '本项目采用标准方法进行系统分析并记录实验结果确保过程质量和数据完整性。'
    subjects = [
        '厨房设备巡检清洗油烟过滤网，检查通风管路。',
        '森林样地鸟类调查，记录迁徙路线与筑巢地点。',
        '财务报销审核发票税额，核对季度预算支出。',
        '古典音乐排练弦乐声部，调整协奏曲演奏速度。',
    ]
    features = {str(i): text_features(boilerplate + subject) for i, subject in enumerate(subjects)}
    assert not match_features(features)


def test_homogeneous_english_subject_terms_survive_corpus_frequency_pruning():
    subject = 'quantum photon entanglement polarization correlation experiment measurement'
    features = {name: text_features(subject + suffix) for name, suffix in {
        'plain': ' laboratory notebook', 'docx': ' course handout', 'pptx': ' lecture slides',
        'xlsx': ' data worksheet', 'csv': ' measurement table'
    }.items()}
    edges = match_features(features)
    covered = {key for edge in edges for key in (edge['source'], edge['target'])}
    assert covered == set(features)
