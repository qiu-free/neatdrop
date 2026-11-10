import io
import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from neatdrop.files import SafetyError


def scanned_pdf(pages=1):
    image = Image.new('RGB', (800, 1000), 'white')
    ImageDraw.Draw(image).text((70, 100), 'Lecture notes: optics measurement', fill='black')
    output = io.BytesIO()
    image.save(output, format='PDF', save_all=True, append_images=[image] * (pages - 1))
    return output.getvalue()


def text_pdf(texts):
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=800, height=1000)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({
            NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 30 20 Td ({text}) Tj ET'.encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def hybrid_scanned_pdf(layer, pages=1):
    writer = PdfWriter()
    raster = PdfReader(io.BytesIO(scanned_pdf(pages)))
    overlay = PdfReader(io.BytesIO(text_pdf([layer])))
    for page in raster.pages:
        writer.add_page(page).merge_page(overlay.pages[0])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_sample_pages_are_deterministic_bounded():
    from neatdrop.pdf_ocr import sample_pages
    assert sample_pages(0) == []
    assert sample_pages(1) == [0]
    assert sample_pages(9) == [0, 1, 4, 8]
    assert len(sample_pages(1000)) == 4


def test_disabled_scanned_ocr_never_renders(monkeypatch):
    from neatdrop import pdf_ocr
    monkeypatch.delenv('NEATDROP_SCANNED_PDF_OCR', raising=False)
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: pytest.fail('renderer called'))
    with pytest.raises(SafetyError, match='PDF_OCR_DISABLED'):
        pdf_ocr.parse_local_pdf(scanned_pdf())


@pytest.mark.parametrize('layer,pages,selected', [('1', 1, [1]), ('Confidential', 1, [1]),
                                                ('Confidential', 5, [1, 2, 3, 5])])
def test_opted_in_hybrid_scan_recovers_raster_text_despite_nonempty_text_layer(monkeypatch, layer, pages, selected):
    pytest.importorskip('pypdfium2')
    from neatdrop import pdf_ocr, offline
    from neatdrop.parsing import parse_pdf
    data = hybrid_scanned_pdf(layer, pages)
    assert parse_pdf(data, limit=12000)['text'].strip() == '\n'.join([layer] * len(selected))
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    def ocr(image, **kwargs):
        # Real parser and renderer must deliver the raster to the OCR boundary.
        assert image.mode == 'RGB' and image.getextrema()[0][0] < 100
        assert kwargs['use_vision'] is False
        return {'text': 'Lecture notes: optics measurement recovered from raster.',
                'ocr_lines': [], 'warnings': []}
    monkeypatch.setattr(offline, 'analyze_image_bounded', ocr)

    result = pdf_ocr.parse_local_pdf(data)

    assert 'recovered from raster' in result['text']
    assert result['local_image'] is True
    assert [segment['page'] for segment in result['sampling']['segments']] == selected


@pytest.mark.parametrize('layer', ['1', 'Confidential'])
def test_disabled_hybrid_scan_preserves_legacy_nonempty_text_without_ocr(monkeypatch, layer):
    from neatdrop import pdf_ocr, offline
    from neatdrop.parsing import parse_pdf
    data = hybrid_scanned_pdf(layer)
    expected = parse_pdf(data, limit=12000)
    monkeypatch.delenv('NEATDROP_SCANNED_PDF_OCR', raising=False)
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: pytest.fail('renderer called'))
    monkeypatch.setattr(offline, 'analyze_image_bounded', lambda *a, **kw: pytest.fail('OCR called'))

    assert pdf_ocr.parse_local_pdf(data) == expected


@pytest.mark.parametrize('text', ['Short note.', 'Confidential'])
def test_disabled_short_text_pdf_retains_legacy_payload(monkeypatch, text):
    from neatdrop import pdf_ocr
    from neatdrop.parsing import parse_pdf
    data = text_pdf([text])
    expected = parse_pdf(data, limit=12000)
    monkeypatch.delenv('NEATDROP_SCANNED_PDF_OCR', raising=False)
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: pytest.fail('renderer called'))

    assert pdf_ocr.parse_local_pdf(data) == expected


@pytest.mark.parametrize('enabled', [False, True])
def test_adequate_text_pdf_retains_exact_legacy_payload_without_optional_dependencies(monkeypatch, enabled):
    from neatdrop import pdf_ocr
    from neatdrop.parsing import parse_pdf
    data = text_pdf(['Lecture notes on optics and the measurement of focal lengths.'] * 7)
    expected = parse_pdf(data, limit=12000)
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1' if enabled else '0')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: pytest.fail('dependency probe called'))
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: pytest.fail('renderer called'))

    assert pdf_ocr.parse_local_pdf(data) == expected


def test_cloud_pdf_sampling_bypasses_local_ocr_even_when_enabled(monkeypatch):
    from neatdrop import pdf_ocr
    from neatdrop.analysis import decode_input
    from neatdrop.parsing import parse_pdf
    data = hybrid_scanned_pdf('Confidential', 5)
    expected = parse_pdf(data, limit=1500)
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr, 'parse_local_pdf', lambda *a, **kw: pytest.fail('local OCR called'))

    assert decode_input(data, '.pdf', local=False) == expected
    assert expected['sample'] == 'PDF pages 1, 2, 5'
    assert 'sampling' not in expected


def test_enabled_ocr_tracks_real_page_boxes_and_partial_coverage(monkeypatch):
    from neatdrop import pdf_ocr, offline
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: True)
    pages = []
    def render(data, page, **kwargs):
        pages.append(page)
        return Image.new('RGB', (100, 100), 'white'), 9
    monkeypatch.setattr(pdf_ocr, 'render_page', render)
    monkeypatch.setattr(offline, 'analyze_image_bounded', lambda image, **kwargs: {'text': '课程笔记\n定义：透镜成像。定理：光路可逆。例题：测量焦距。', 'ocr_lines': [{'text': '课程笔记', 'box': [[1, 2], [50, 2], [50, 20], [1, 20]], 'score': .99}], 'warnings': []})
    result = pdf_ocr.parse_local_pdf(scanned_pdf(9))
    assert pages == [0, 1, 4, 8]
    assert result['sampling']['truncated'] is True
    assert [segment['page'] for segment in result['sampling']['segments']] == [1, 2, 5, 9]
    assert result['ocr_lines'][0]['page'] == 1
    assert result['ocr_lines'][0]['box'][0] == [1, 2]
    assert len(result['text']) <= 12000


def test_cancelled_input_never_starts_parser_or_renderer(monkeypatch):
    from neatdrop import pdf_ocr
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: pytest.fail('renderer called'))
    with pytest.raises(SafetyError, match='PDF_PARSE_CANCELLED'):
        pdf_ocr.parse_local_pdf(b'invalid', cancelled=lambda: True)


def test_encrypted_and_corrupt_documents_remain_rejected(monkeypatch):
    from neatdrop.pdf_ocr import parse_local_pdf
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    writer = PdfWriter(); writer.add_blank_page(width=200, height=200); writer.encrypt('test-password')
    output = io.BytesIO(); writer.write(output)
    with pytest.raises(SafetyError, match='PDF_ENCRYPTED'):
        parse_local_pdf(output.getvalue())
    with pytest.raises(SafetyError, match='PDF_PARSE_FAILED'):
        parse_local_pdf(b'not a pdf')


def test_real_renderer_obeys_pixel_budget():
    pytest.importorskip('pypdfium2')
    from neatdrop.pdf_ocr import render_page
    image, count = render_page(scanned_pdf(), 0)
    assert count == 1
    assert 0 < image.width * image.height <= 4_000_000
    assert image.mode == 'RGB'
    image.close()


def test_parent_deadline_stops_following_pages(monkeypatch):
    from neatdrop import pdf_ocr, offline, parsing
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(parsing, 'parse_pdf', lambda *a, **kw: (_ for _ in ()).throw(SafetyError('PDF_NO_TEXT')))
    clock = [0.0]
    monkeypatch.setattr(pdf_ocr.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: True)
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: (Image.new('RGB', (100, 100)), 9))
    def ocr(*a, **kwargs):
        clock[0] += 61
        return {'text': '已识别文字'}
    monkeypatch.setattr(offline, 'analyze_image_bounded', ocr)
    with pytest.raises(SafetyError, match='PDF_OCR_TIMEOUT'):
        pdf_ocr.parse_local_pdf(b'synthetic')


def test_missing_optional_renderer_is_explicit(monkeypatch):
    from neatdrop import pdf_ocr, parsing
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(parsing, 'parse_pdf', lambda *a, **kw: (_ for _ in ()).throw(SafetyError('PDF_NO_TEXT')))
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: None)
    with pytest.raises(SafetyError, match='PDF_OCR_RENDERER_MISSING'):
        pdf_ocr.parse_local_pdf(b'synthetic')


def test_hybrid_scan_missing_optional_renderer_is_explicit(monkeypatch):
    from neatdrop import pdf_ocr
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: None)

    with pytest.raises(SafetyError, match='PDF_OCR_RENDERER_MISSING'):
        pdf_ocr.parse_local_pdf(hybrid_scanned_pdf('Confidential'))


def test_low_text_fallback_uses_only_deadline_left_after_text_parse(monkeypatch):
    from neatdrop import pdf_ocr, offline, parsing
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: True)
    clock = [0.0]
    monkeypatch.setattr(pdf_ocr.time, 'monotonic', lambda: clock[0])
    def parse(*args, **kwargs):
        clock[0] = 58
        return {'text': 'Confidential', 'sample': 'short text layer'}
    def render(*args, **kwargs):
        assert kwargs['timeout'] == 2
        clock[0] = 59
        return Image.new('RGB', (100, 100)), 1
    def ocr(image, **kwargs):
        assert kwargs['timeout'] == 1
        clock[0] = 61
        return {'text': 'Late raster text'}
    monkeypatch.setattr(parsing, 'parse_pdf', parse)
    monkeypatch.setattr(pdf_ocr, 'render_page', render)
    monkeypatch.setattr(offline, 'analyze_image_bounded', ocr)

    with pytest.raises(SafetyError, match='PDF_OCR_TIMEOUT'):
        pdf_ocr.parse_local_pdf(b'synthetic')


@pytest.mark.parametrize('failure', ['cancel_after_render', 'ocr_raises'])
def test_rendered_page_is_closed_if_cancelled_or_ocr_raises(monkeypatch, failure):
    from neatdrop import pdf_ocr, offline, parsing
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: True)
    monkeypatch.setattr(parsing, 'parse_pdf', lambda *a, **kw: (_ for _ in ()).throw(SafetyError('PDF_NO_TEXT')))
    image = Image.new('RGB', (100, 100))
    cancelled = [False]
    def render(*args, **kwargs):
        cancelled[0] = failure == 'cancel_after_render'
        return image, 1
    def ocr(*args, **kwargs):
        raise SafetyError('PDF_PARSE_CANCELLED')
    monkeypatch.setattr(pdf_ocr, 'render_page', render)
    monkeypatch.setattr(offline, 'analyze_image_bounded', ocr)

    with pytest.raises(SafetyError, match='PDF_PARSE_CANCELLED'):
        pdf_ocr.parse_local_pdf(b'synthetic', cancelled=lambda: cancelled[0])
    with pytest.raises(ValueError, match='closed image'):
        image.getpixel((0, 0))


def test_known_garbled_text_layer_also_reaches_opted_in_ocr(monkeypatch):
    from neatdrop import pdf_ocr, offline, parsing
    monkeypatch.setenv('NEATDROP_SCANNED_PDF_OCR', '1')
    monkeypatch.setattr(pdf_ocr.importlib.util, 'find_spec', lambda _: True)
    monkeypatch.setattr(parsing, 'parse_pdf', lambda *a, **kw: {
        'text': '\ufffd' * 50 + 'unreadable document text layer' * 3, 'sample': 'garbled text layer'})
    monkeypatch.setattr(pdf_ocr, 'render_page', lambda *a, **kw: (Image.new('RGB', (100, 100)), 1))
    monkeypatch.setattr(offline, 'analyze_image_bounded', lambda *a, **kw: {
        'text': 'Recovered readable raster document.', 'ocr_lines': [], 'warnings': []})

    assert pdf_ocr.parse_local_pdf(b'synthetic')['text'] == 'Recovered readable raster document.'
