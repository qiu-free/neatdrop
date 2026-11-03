import time

import pytest
from PIL import Image

from neatdrop.files import Workspace, SafetyError
from neatdrop.analysis import prepare_input


def test_image_pixel_cap_is_checked_before_decode(tmp_path):
    # Highly compressible PNG remains small on disk but would expand in memory.
    Image.new('1', (7000, 7000)).save(tmp_path / 'large.png')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    with pytest.raises(SafetyError, match='IMAGE_PIXEL_LIMIT'):
        prepare_input(ws, record)


def stuck_pdf_worker(connection, data, limit):
    connection.recv()
    time.sleep(20)


def test_hung_pdf_worker_is_terminated_and_next_parse_still_works(monkeypatch):
    from neatdrop import parsing
    original = parsing._pdf_worker
    monkeypatch.setattr(parsing, '_pdf_worker', stuck_pdf_worker)
    started = time.monotonic()
    with pytest.raises(SafetyError, match='PDF_PARSE_TIMEOUT'):
        parsing.parse_pdf(b'bad input', timeout=.3)
    assert time.monotonic() - started < 8
    monkeypatch.setattr(parsing, '_pdf_worker', original)
    with pytest.raises(SafetyError, match='PDF_PARSE_FAILED'):
        parsing.parse_pdf(b'bad input')


def oversized_pdf_worker(connection, data, limit):
    connection.recv()
    try:
        memory = bytearray(512 * 1024 * 1024)
        connection.send({'text': 'MEMORY_BUDGET_BYPASSED', 'sample': 'test'})
        del memory
    except MemoryError:
        connection.send({'error': 'PDF_PARSE_FAILED'})


def test_pdf_worker_memory_budget_is_enforced(monkeypatch):
    from neatdrop import parsing
    monkeypatch.setattr(parsing, '_pdf_worker', oversized_pdf_worker)
    with pytest.raises(SafetyError, match='PDF_PARSE_FAILED'):
        parsing.parse_pdf(b'test', timeout=5)
