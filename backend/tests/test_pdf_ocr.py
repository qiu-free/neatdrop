import io
import pytest
from PIL import Image, ImageDraw
from pypdf import PdfWriter

from neatdrop.files import SafetyError


def scanned_pdf(pages=1):
    image = Image.new('RGB', (800, 1000), 'white')
    ImageDraw.Draw(image).text((70, 100), 'Lecture notes: optics measurement', fill='black')
    output = io.BytesIO()
    image.save(output, format='PDF', save_all=True, append_images=[image] * (pages - 1))
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
