"""Opt-in scanned PDF OCR with isolated rendering and a single parent deadline."""
import base64
import importlib.util
import io
import math
import os
import time

from .files import MAX_FILE, SafetyError

TOTAL_SECONDS = 60
PAGE_PIXELS = 4_000_000
MIN_READABLE_PER_SAMPLED_PAGE = 32


def sample_pages(count):
    return sorted({page for page in (0, 1, (count - 1) // 2, count - 1) if 0 <= page < count})


def _text_layer_sufficient(payload):
    from .content_quality import assess_content
    text = payload.get('text', '')
    sampling = payload.get('sampling')
    segments = sampling.get('segments') if isinstance(sampling, dict) else None
    if not segments:
        quality = assess_content(payload, image_input=False)
        # Standalone payloads without page metadata retain the bounded whole-
        # text fallback. This heuristic does not establish document coverage.
        return (quality['metrics']['readable_chars'] >= MIN_READABLE_PER_SAMPLED_PAGE
                and 'text_garbled' not in quality['issues'])
    if not isinstance(text, str) or not isinstance(segments, list) or len(segments) > 4:
        return False

    # Parser segments retain page lengths while the sampled text uses one
    # newline between pages. Assess each body independently so a cover cannot
    # mask scanned or nearly blank pages.
    cursor = 0
    for index, segment in enumerate(segments):
        if (not isinstance(segment, dict) or segment.get('start') != 0 or
                not isinstance(segment.get('end'), int) or isinstance(segment.get('end'), bool) or
                segment['end'] < 0):
            return False
        end = cursor + segment['end']
        if end > len(text):
            return False
        quality = assess_content({'text': text[cursor:end]}, image_input=False)
        if (quality['metrics']['readable_chars'] < MIN_READABLE_PER_SAMPLED_PAGE or
                'text_garbled' in quality['issues']):
            return False
        cursor = end
        if index < len(segments) - 1:
            if cursor >= len(text) or text[cursor] != '\n':
                return False
            cursor += 1
    return True


def pdf_ocr_status():
    from .offline import offline_status
    renderer = importlib.util.find_spec('pypdfium2') is not None
    return {'available': renderer and offline_status()['ocr']['available'],
            'enabled': os.getenv('NEATDROP_SCANNED_PDF_OCR') == '1',
            'renderer_available': renderer, 'name': '扫描 PDF OCR（最多4页）',
            'max_pages': 4, 'total_seconds': TOTAL_SECONDS}


def _render_worker(connection, data, index):
    try:
        connection.recv()
        if os.name != 'nt':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 ** 2,) * 2)
        import socket
        def denied(*args, **kwargs):
            raise OSError('offline PDF renderer network disabled')
        socket.socket.connect = denied
        socket.create_connection = denied
        socket.getaddrinfo = denied
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(data) as document:
            count = len(document)
            if count > 1000:
                raise SafetyError('PDF_PAGE_LIMIT')
            if not 0 <= index < count:
                raise SafetyError('PDF_PARSE_FAILED')
            page = document[index]
            try:
                width, height = page.get_size()
                if not all(math.isfinite(value) and value > 0 for value in (width, height)):
                    raise SafetyError('PDF_RENDER_BUDGET')
                # <=1600px uses one OCR view. Larger renders trigger tiled OCR
                # and multiply cold starts inside the fixed file deadline.
                scale = min(2, math.sqrt(PAGE_PIXELS / (width * height)), 1600 / max(width, height)) * .999
                bitmap = page.render(scale=scale, draw_annots=False)
                try:
                    image = bitmap.to_pil().convert('RGB')
                    if image.width * image.height > PAGE_PIXELS:
                        raise SafetyError('PDF_RENDER_BUDGET')
                    output = io.BytesIO(); image.save(output, format='PNG')
                    connection.send({'text': '', 'pages': count, 'image': base64.b64encode(output.getvalue()).decode('ascii')})
                finally:
                    bitmap.close()
            finally:
                page.close()
    except SafetyError as exc:
        connection.send({'error': exc.code})
    except BaseException:
        try:
            connection.send({'error': 'PDF_RENDER_FAILED'})
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


def render_page(data, index, *, timeout=8, cancelled=None):
    from .parsing import _run_bounded
    from PIL import Image
    if not isinstance(data, bytes) or len(data) > MAX_FILE:
        raise SafetyError('FILE_TOO_LARGE')
    result = _run_bounded(_render_worker, (data, index), 1, timeout, cancelled, 'PDF_RENDER')
    try:
        image = Image.open(io.BytesIO(base64.b64decode(result['image'], validate=True)))
        if image.width * image.height > PAGE_PIXELS:
            raise SafetyError('PDF_RENDER_BUDGET')
        image.load()
        return image.convert('RGB'), result['pages']
    except (KeyError, ValueError, OSError) as exc:
        raise SafetyError('PDF_RENDER_FAILED') from exc


def parse_local_pdf(data, *, cancelled=None, timeout=TOTAL_SECONDS):
    from .parsing import parse_pdf
    from .offline import analyze_image_bounded
    if cancelled and cancelled():
        raise SafetyError('PDF_PARSE_CANCELLED')
    if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise SafetyError('PDF_OCR_TIMEOUT')
    deadline = time.monotonic() + min(TOTAL_SECONDS, timeout)

    def remaining():
        if cancelled and cancelled():
            raise SafetyError('PDF_PARSE_CANCELLED')
        left = deadline - time.monotonic()
        if left <= 0:
            raise SafetyError('PDF_OCR_TIMEOUT')
        return left

    try:
        parsed = parse_pdf(data, limit=12000, timeout=min(12, remaining()), cancelled=cancelled)
        remaining()
        # Adequate text PDFs retain the exact existing payload. Only local
        # insufficient text reaches the opt-in gate; cloud sampling is separate.
        if _text_layer_sufficient(parsed):
            return parsed
        # Preserve the pre-OCR behavior for any selectable text when OCR is
        # off. The normal content-quality pipeline already marks short or
        # garbled text for review; no rendering or hidden OCR is performed.
        if os.getenv('NEATDROP_SCANNED_PDF_OCR') != '1':
            return parsed
    except SafetyError as exc:
        if exc.code != 'PDF_NO_TEXT':
            raise
    if os.getenv('NEATDROP_SCANNED_PDF_OCR') != '1':
        raise SafetyError('PDF_OCR_DISABLED')
    if importlib.util.find_spec('pypdfium2') is None:
        raise SafetyError('PDF_OCR_RENDERER_MISSING')

    first, count = render_page(data, 0, timeout=min(8, remaining()), cancelled=cancelled)
    pages = sample_pages(count)
    if not pages:
        first.close()
        raise SafetyError('PDF_NO_TEXT')
    quota = (12000 - len(pages)) // len(pages)
    text_parts, segments, lines, warnings = [], [], [], []
    cursor, partial = 0, len(pages) < count
    for index in pages:
        image = first if index == 0 else render_page(data, index, timeout=min(8, remaining()), cancelled=cancelled)[0]
        try:
            payload = analyze_image_bounded(image, timeout=min(25, remaining()), use_vision=False, cancelled=cancelled)
        finally:
            image.close()
        remaining()
        warnings.extend(payload.get('warnings', []))
        if 'inference_timeout' in warnings:
            raise SafetyError('PDF_OCR_TIMEOUT')
        raw = payload.get('text', '')
        text = raw[:quota]
        partial = partial or bool(payload.get('truncated')) or len(raw) > quota
        segments.append({'page': index + 1, 'start': 0, 'end': len(text), 'sample_start': cursor, 'truncated': len(raw) > quota})
        line_cursor = 0
        for row in payload.get('ocr_lines', [])[:max(1, 150 // len(pages))]:
            start = raw.find(row.get('text', ''), line_cursor)
            if start < 0 or start >= len(text):
                continue
            row_text = row['text'][:len(text) - start]
            lines.append({**row, 'text': row_text, 'page': index + 1, 'sample_start': cursor + start, 'sample_end': cursor + start + len(row_text)})
            line_cursor = start + len(row_text)
        text_parts.append(text)
        cursor += len(text) + 1
    text = '\n'.join(text_parts)
    if not text.strip():
        raise SafetyError('PDF_OCR_NO_TEXT')
    summary = '本地扫描 PDF OCR 第 ' + '、'.join(str(page + 1) for page in pages) + ' 页；' + ('部分页面或内容未读取' if partial else '已读取所选全部页面')
    return {'text': text, 'ocr_lines': lines, 'visual': [], 'warnings': sorted(set(warnings)), 'local_image': True,
            'truncated': partial, 'sample': summary, 'sampling': {'kind': 'pdf', 'truncated': partial,
            'budget_exhausted': partial, 'segments': segments, 'summary': summary}}
