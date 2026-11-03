import io
import json
import os
import time

import pytest

from neatdrop.extraction import image_regions, sample_text
from neatdrop.parsing import parse_pdf


def pdf_bytes(texts):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 10 200 Td ({text}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_text_budget_preserves_head_middle_tail_and_original_offsets():
    text = 'HEAD' + 'A' * 9000 + 'MIDDLE' + 'B' * 9000 + 'TAIL'
    result = sample_text(text)
    assert len(result['text']) == 12000
    assert all(marker in result['text'] for marker in ['HEAD', 'MIDDLE', 'TAIL'])
    assert result['truncated'] is True
    assert result['sampling']['kind'] == 'text'
    assert result['sampling']['budget_exhausted'] is True
    segments = result['sampling']['segments']
    assert len(segments) == 3
    assert all(0 < segment['end'] - segment['start'] <= 4000 for segment in segments)
    assert '\n'.join(text[segment['start']:segment['end']] for segment in segments) == result['text']
    assert result['sampling']['separator'] == '\n'
    assert segments[0]['start'] == 0 and segments[-1]['end'] == len(text)
    assert '抽样' in result['sampling']['summary']


@pytest.mark.parametrize('text', ['', 'a', '# 标题\n短文'])
def test_short_text_is_read_once_without_false_truncation(text):
    result = sample_text(text)
    assert result['text'] == text
    assert result['sampling']['truncated'] is False
    assert result['sampling']['budget_exhausted'] is False
    assert len(result['sampling']['segments']) <= 1


def test_small_custom_text_budget_remains_nonoverlapping():
    result = sample_text('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', limit=10)
    assert len(result['text']) == 10
    segments = result['sampling']['segments']
    assert all(a['end'] <= b['start'] for a, b in zip(segments, segments[1:]))
    assert result['text'].startswith('01') and result['text'].endswith('XYZ')


def test_text_sampling_separators_do_not_invent_cross_segment_words():
    text = 'x' * 3996 + '发票' + 'x' * 7000 + '号码' + 'x' * 7000
    result = sample_text(text)
    segments = result['sampling']['segments']
    assert '\n'.join(text[s['start']:s['end']] for s in segments) == result['text']
    assert len(result['text']) <= 12000
    assert result['text'].count('\n') == 2


@pytest.mark.parametrize('limit', range(1, 9))
def test_tiny_sampling_budgets_include_only_separated_nonempty_segments(limit):
    result = sample_text('abcdefghijklmnopqrstuvwxyz', limit=limit)
    assert len(result['text']) <= limit
    assert result['text'] == '\n'.join('abcdefghijklmnopqrstuvwxyz'[s['start']:s['end']]
                                       for s in result['sampling']['segments'])


def test_long_image_regions_are_bounded_original_pixel_boxes_covering_ends():
    regions = image_regions((900, 16000))
    assert regions[0] == (0, 0, 900, 16000)
    assert len(regions) == 6
    assert regions[1][1] == 0 and regions[-1][3] == 16000
    assert all(0 <= l < r <= 900 and 0 <= t < b <= 16000 for l, t, r, b in regions)
    assert all(max(r - l, b - t) <= 1600 for l, t, r, b in regions[1:])
    assert len(set(regions)) == len(regions)


def test_small_images_have_one_full_region_and_invalid_sizes_are_rejected():
    assert image_regions((900, 500)) == [(0, 0, 900, 500)]
    with pytest.raises(ValueError):
        image_regions((0, 500))


def test_local_pdf_page_quotas_cannot_erase_middle_or_last_page():
    payload = parse_pdf(pdf_bytes(['FIRST' + 'A' * 9000, 'SECOND' + 'B' * 9000,
                                   'IGNORED3', 'MIDDLE' + 'C' * 9000, 'IGNORED5',
                                   'IGNORED6', 'LAST' + 'D' * 9000]), limit=12000)
    assert all(word in payload['text'] for word in ['FIRST', 'SECOND', 'MIDDLE', 'LAST'])
    assert 'IGNORED' not in payload['text']
    assert len(payload['text']) <= 12000
    assert [segment['page'] for segment in payload['sampling']['segments']] == [1, 2, 4, 7]
    assert all(segment['end'] - segment['start'] <= 3000 for segment in payload['sampling']['segments'])
    assert payload['sampling']['truncated'] is True
    assert payload['sampling']['budget_exhausted'] is True


def test_local_short_pdf_deduplicates_pages_without_false_coverage_warning():
    payload = parse_pdf(pdf_bytes(['FIRST', 'SECOND']), limit=12000)
    assert payload['text'].count('FIRST') == 1
    assert payload['text'].count('SECOND') == 1
    assert [segment['page'] for segment in payload['sampling']['segments']] == [1, 2]
    assert payload['sampling']['truncated'] is False


def test_cloud_pdf_sampling_retains_first_two_last_and_1500_character_cap():
    payload = parse_pdf(pdf_bytes(['FIRST', 'SECOND', 'MIDDLE', 'SKIPPED', 'LAST']))
    assert 'FIRST' in payload['text'] and 'SECOND' in payload['text'] and 'LAST' in payload['text']
    assert 'MIDDLE' not in payload['text'] and 'SKIPPED' not in payload['text']
    assert len(payload['text']) <= 1500
    assert 'sampling' not in payload


def test_pdf_page_budget_marks_omitted_pages_even_when_sampled_pages_are_short():
    payload = parse_pdf(pdf_bytes(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX']), limit=12000)
    assert payload['sampling']['truncated'] is True
    assert payload['sampling']['budget_exhausted'] is True


def test_pdf_pipe_startup_failure_releases_parser_slot(monkeypatch):
    from neatdrop import parsing
    real_context = parsing.multiprocessing.get_context
    class Context:
        def Pipe(self):
            raise OSError('pipe unavailable')
    monkeypatch.setattr(parsing.multiprocessing, 'get_context', lambda method: Context())
    for _ in range(3):
        with pytest.raises(OSError, match='pipe unavailable'):
            parse_pdf(b'broken startup')
    monkeypatch.setattr(parsing.multiprocessing, 'get_context', real_context)
    assert 'ONE' in parse_pdf(pdf_bytes(['ONE']))['text']


def native_pid_pdf_worker(connection, data, limit):
    from pathlib import Path
    connection.recv()
    Path(os.environ['NEATDROP_TEST_WORKER_PID_FILE']).write_text(json.dumps({'pid': os.getpid()}))
    time.sleep(20)


@pytest.mark.skipif(os.name != 'nt', reason='Windows venv launcher PID regression')
def test_multiprocessing_timeout_targets_actual_pdf_interpreter_pid(tmp_path, monkeypatch):
    from neatdrop import parsing
    from neatdrop.files import SafetyError
    from test_offline import process_is_running
    pid_file = tmp_path / 'native-pid.json'
    monkeypatch.setenv('NEATDROP_TEST_WORKER_PID_FILE', str(pid_file))
    monkeypatch.setattr(parsing, '_pdf_worker', native_pid_pdf_worker)
    original_limit = parsing._limit_worker_memory
    tracked = []
    def track(process):
        tracked.append(process.pid)
        return original_limit(process)
    monkeypatch.setattr(parsing, '_limit_worker_memory', track)
    with pytest.raises(SafetyError, match='PDF_PARSE_TIMEOUT'):
        parse_pdf(b'PID proof', timeout=1.5)
    actual = json.loads(pid_file.read_text())['pid']
    assert actual == tracked[0]
    assert not process_is_running(actual)


@pytest.mark.skipif(os.name != 'nt', reason='Windows actual process cancellation proof')
def test_pdf_cancellation_terminates_actual_worker_pid_and_releases_slot(tmp_path, monkeypatch):
    from neatdrop import parsing
    from neatdrop.files import SafetyError
    from test_offline import process_is_running
    pid_file = tmp_path / 'cancelled-native-pid.json'
    monkeypatch.setenv('NEATDROP_TEST_WORKER_PID_FILE', str(pid_file))
    original = parsing._pdf_worker
    monkeypatch.setattr(parsing, '_pdf_worker', native_pid_pdf_worker)
    started = time.monotonic()
    with pytest.raises(SafetyError, match='PDF_PARSE_CANCELLED'):
        parse_pdf(b'cancelled PID proof', cancelled=pid_file.exists)
    assert time.monotonic() - started < 4
    actual = json.loads(pid_file.read_text())['pid']
    assert not process_is_running(actual)
    monkeypatch.setattr(parsing, '_pdf_worker', original)
    assert 'ONE' in parse_pdf(pdf_bytes(['ONE']))['text']
