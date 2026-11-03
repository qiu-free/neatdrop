"""Chart form needs visual evidence; archive purpose stays a reviewed choice."""
import pytest

from neatdrop.analysis import analyze_local
from neatdrop.classifier import fuse_image
from neatdrop.decision import decide


@pytest.mark.parametrize('label,category,child,form', [
    ('scatter_plot', 'study', 'data_chart', 'data_chart'),
    ('line_chart', 'study', 'data_chart', 'data_chart'),
    ('bar_chart', 'study', 'data_chart', 'data_chart'),
    ('histogram', 'study', 'data_chart', 'data_chart'),
    ('pie_chart', 'study', 'data_chart', 'data_chart'),
    ('heatmap', 'study', 'data_chart', 'data_chart'),
    ('box_plot', 'study', 'data_chart', 'data_chart'),
    ('flowchart', 'social', 'diagram', 'diagram'),
    ('diagram', 'social', 'diagram', 'diagram'),
    ('table_image', 'office', 'spreadsheet', 'table_image'),
])
def test_structured_visual_form_is_a_candidate_without_inventing_purpose(label, category, child, form):
    result = decide(fuse_image('IMG.png', '', [
        {'label': label, 'score': .38}, {'label': 'screenshot', 'score': .30},
    ], []))
    assert (result['category'], result['subcategory'], result['content_form']) == (category, child, form)
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert 'visual_type_uncalibrated' in result['review_reasons']
    assert 'visual_purpose_uncalibrated' in result['review_reasons']
    assert label in result['tags']
    assert result['candidates'][0]['engine'] == 'visual'


def test_close_chart_candidate_is_not_lost_to_generic_screenshot_or_pet():
    for generic in ('screenshot', 'pet', 'illustration'):
        result = decide(fuse_image('Figure_dog.png', 'Dog counts', [
            {'label': generic, 'score': .38}, {'label': 'pie_chart', 'score': .37},
        ], []))
        assert result['content_form'] == 'data_chart'
        assert result['category'] == 'study'
        assert result['review_required']
        assert result['visual_candidates'][0]['label'] == generic


def test_strong_document_purpose_is_kept_when_visual_form_is_chart():
    result = decide(fuse_image('x.png', '项目报告\n项目进度与工作总结，分析结论和下一步计划。', [
        {'label': 'bar_chart', 'score': .40}, {'label': 'document', 'score': .30},
    ], []))
    assert (result['category'], result['subcategory']) == ('office', 'report')
    assert result['content_form'] == 'data_chart'
    assert 'bar_chart' in result['tags']
    assert result['review_required']
    assert 'visual_purpose_uncalibrated' not in result['review_reasons']
    assert any(item['source'] == 'ocr' for item in result['evidence_items'])


@pytest.mark.parametrize('name,text', [('Figure_1.png', 'Histogram'), ('scatter.png', 'Simple Scatter'),
                                     ('数据图表.png', '数据图表\n横轴与纵轴')])
def test_title_or_filename_alone_cannot_establish_chart_form(name, text):
    result = decide(fuse_image(name, text, [], []))
    assert result['content_form'] == 'unknown'
    assert result['category'] == 'other'
    assert result['decision_level'] == 'abstain'


def test_strong_natural_photo_does_not_become_chart_due_to_incidental_title():
    result = decide(fuse_image('Figure_1.png', 'Histogram', [
        {'label': 'pet', 'score': .42}, {'label': 'histogram', 'score': .28},
    ], []))
    assert (result['category'], result['subcategory'], result['content_form']) == ('photos', 'pet', 'natural_photo')


def test_low_visual_score_cannot_make_a_chart_from_its_title():
    result = decide(fuse_image('Figure_1.png', 'Histogram', [
        {'label': 'histogram', 'score': .20}, {'label': 'screenshot', 'score': .19},
    ], []))
    assert result['content_form'] == 'unknown'
    assert result['review_required']


def test_weak_chart_cue_does_not_promote_illustration_or_screenshot_to_chart():
    # Rounded real development-probe scores: without a conservative floor,
    # generic UI rows and illustrated scenery became false chart candidates.
    for visual in ([{'label': 'line_chart', 'score': .2774}, {'label': 'landscape', 'score': .2687}],
                   [{'label': 'screenshot', 'score': .2874}, {'label': 'histogram', 'score': .2659}]):
        result = decide(fuse_image('x.png', '', visual, []))
        assert result['content_form'] != 'data_chart'
        assert result['review_required']


def test_subthreshold_new_label_does_not_erase_legacy_photo_margin():
    # Existing public cat fixture remains a photo with its original ten-label
    # margin; a weak new box-plot label must not force it into abstention.
    result = decide(fuse_image('x.png', '', [
        {'label': 'pet', 'score': .2609}, {'label': 'box_plot', 'score': .2382},
        {'label': 'people', 'score': .2328},
    ], []))
    assert (result['category'], result['subcategory'], result['content_form']) == ('photos', 'pet', 'natural_photo')


def test_sparse_chart_ocr_does_not_replace_original_name_or_invent_chart_values(monkeypatch):
    monkeypatch.delenv('NEATDROP_SEMANTIC_CANDIDATES', raising=False)
    result = analyze_local({'id': 'chart', 'name': 'IMG_1234.png', 'extension': '.png'}, {
        'local_image': True, 'text': 'Logs', 'sample': 'Synthetic visual evidence',
        'visual': [{'label': 'histogram', 'score': .39}, {'label': 'screenshot', 'score': .30}],
    })
    assert result['name'] == 'IMG_1234.png'
    assert result['content_form'] == 'data_chart'
    assert result['evidence'] == 'Logs'
    assert result['review_required']
