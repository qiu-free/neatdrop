import io
import json
import os
import socket
import time

import numpy as np
import pytest

from PIL import Image, ImageDraw, ImageFont

from neatdrop.offline import OfflineEngine, offline_status


def patterned_image(size):
    image = Image.new('RGB', size, 'white')
    ImageDraw.Draw(image).rectangle((0, 0, min(100, size[0]), size[1]), fill='black')
    return image


def test_ocr_maps_resized_full_view_boxes_back_to_original_pixels():
    engine = OfflineEngine()
    engine._ocr = lambda pixels: ([[[[10, 20], [100, 20], [100, 40], [10, 40]], 'sample', .95]], None)
    result = engine.analyze(patterned_image((900, 3200)), use_vision=False)
    full = next(line for line in result['ocr_lines'] if line['region'] == 0)
    assert full['box'] == [[20., 40.], [200., 40.], [200., 80.], [20., 80.]]
    assert all(0 <= x <= 900 and 0 <= y <= 3200 for line in result['ocr_lines'] for x, y in line['box'])
    assert all('order' in line and 'score' in line for line in result['ocr_lines'])


def test_overlapping_ocr_duplicates_merge_but_repeated_text_elsewhere_survives():
    engine = OfflineEngine()
    calls = 0
    def ocr(pixels):
        nonlocal calls
        calls += 1
        if calls == 1:
            return [[[[10, 10], [100, 10], [100, 30], [10, 30]], 'Invoice', .9]], None
        if calls == 2:
            return [[[[20, 20], [200, 20], [200, 60], [20, 60]], 'Invoice', .95]], None
        return [[[[20, 200], [200, 200], [200, 240], [20, 240]], 'Invoice', .95]], None
    engine._ocr = ocr
    result = engine.analyze(patterned_image((900, 3200)), use_vision=False)
    near_top = [line for line in result['ocr_lines'] if min(point[1] for point in line['box']) < 100]
    assert len(near_top) == 1
    assert near_top[0]['score'] == .95
    assert len(result['ocr_lines']) >= 2


def test_long_image_has_at_most_six_ocr_views_and_reports_unread_detail():
    engine = OfflineEngine()
    calls = []
    def ocr(pixels):
        calls.append(pixels.shape)
        return None, None
    engine._ocr = ocr
    result = engine.analyze(patterned_image((900, 16000)), use_vision=False)
    assert len(calls) == 6
    assert all(max(shape[:2]) <= 1600 for shape in calls)
    assert result['sampling']['truncated'] is True
    assert result['sampling']['budget_exhausted'] is True
    assert result['sampling']['segments'][0]['box'] == [0, 0, 900, 16000]
    assert len(result['sampling']['segments']) == 6
    assert '局部' in result['sampling']['summary']


def test_vision_keeps_edge_content_with_full_image_letterbox():
    engine = OfflineEngine()
    seen = []
    class Session:
        def run(self, outputs, inputs):
            seen.append(inputs['pixel_values'])
            return [np.ones((1, 2), dtype=np.float32)]
        def get_outputs(self):
            return [type('Output', (), {'name': 'image_embeds'})()]
    engine._vision = Session()
    engine._embeddings = np.ones((2, 2), dtype=np.float32)
    engine._labels = ['document', 'document']
    # Only one prompt group is needed to exercise the real preprocessing path.
    from neatdrop import offline
    original = offline.PROMPTS
    try:
        offline.PROMPTS = {'document': ['document']}
        image = Image.new('RGB', (1000, 200), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 100, 199), fill='red')
        draw.rectangle((900, 0, 999, 199), fill='blue')
        engine._visual_scores(image)
    finally:
        offline.PROMPTS = original
    pixels = seen[0][0]
    assert pixels.shape == (3, 224, 224)
    # The horizontal stripe retains both red left and blue right edges.
    assert pixels[0, 112, 5] > pixels[2, 112, 5]
    assert pixels[2, 112, 218] > pixels[0, 112, 218]


def test_status_rejects_present_but_corrupted_vision_package(tmp_path, monkeypatch):
    from neatdrop import offline
    monkeypatch.setattr(offline, 'MODEL_DIR', tmp_path)
    for name in offline.VISION_FILES:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'corrupted')
    (tmp_path / 'manifest.json').write_text('{}', encoding='utf-8')
    status = offline_status()['vision']
    assert status['available'] is False
    assert status['state'] == 'integrity_failed'
    assert status['integrity_check'] == 'failed'


def test_vision_initialization_consumes_verified_bytes_after_files_are_replaced(tmp_path, monkeypatch):
    import hashlib
    import onnxruntime
    import tokenizers
    from neatdrop import offline
    payloads = {name: ('original-' + name).encode() for name in offline.VISION_FILES}
    for name, data in payloads.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()}
    monkeypatch.setattr(offline, 'EXPECTED_HASHES', hashes)
    (tmp_path / 'manifest.json').write_text(json.dumps({'files': hashes}))
    consumed = []
    class Session:
        def __init__(self, source, *args, **kwargs):
            if not consumed:
                for name in payloads:
                    (tmp_path / name).write_bytes(b'replacement-untrusted')
            assert isinstance(source, bytes)
            assert source in payloads.values()
            consumed.append(source)
        def get_inputs(self):
            return [type('Input', (), {'name': 'input_ids'})()]
        def get_outputs(self):
            return [type('Output', (), {'name': 'text_embeds'})()]
        def run(self, *args):
            return [np.ones((20, 2), dtype=np.float32)]
    class Tokenizer:
        @classmethod
        def from_str(cls, text):
            assert text == payloads['tokenizer.json'].decode()
            return cls()
        @classmethod
        def from_file(cls, path):
            pytest.fail('tokenizer reopened an unverified filename')
        def enable_padding(self, **kwargs):
            pass
        def enable_truncation(self, **kwargs):
            pass
        def encode_batch(self, sentences):
            return [type('Encoding', (), {'ids': [1], 'attention_mask': [1]})() for _ in sentences]
    monkeypatch.setattr(onnxruntime, 'InferenceSession', Session)
    monkeypatch.setattr(tokenizers, 'Tokenizer', Tokenizer)
    engine = OfflineEngine(tmp_path)
    engine._load_vision()
    assert consumed == [payloads['onnx/text_model_quantized.onnx'], payloads['onnx/vision_model_quantized.onnx']]


@pytest.mark.skipif(os.name != 'nt', reason='Windows deny-write/delete handle guarantee')
def test_ocr_initialization_pins_verified_files_and_ancestor_directories(tmp_path, monkeypatch):
    import hashlib
    import importlib.util
    import rapidocr_onnxruntime
    from neatdrop import offline
    directory = tmp_path / 'package' / 'models'
    directory.mkdir(parents=True)
    payloads = {name: ('model-' + name).encode() for name in offline.OCR_HASHES}
    for name, data in payloads.items():
        (directory / name).write_bytes(data)
    monkeypatch.setattr(offline, 'OCR_HASHES', {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()})
    real_find = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, 'find_spec', lambda name: type('Spec', (), {'origin': str(directory.parent / '__init__.py')})()
                        if name == 'rapidocr_onnxruntime' else real_find(name))
    checked = []
    def construct(**kwargs):
        with pytest.raises(PermissionError):
            (directory / next(iter(payloads))).write_bytes(b'untrusted')
        with pytest.raises(PermissionError):
            directory.rename(directory.with_name('replaced-models'))
        checked.append(kwargs)
        return object()
    monkeypatch.setattr(rapidocr_onnxruntime, 'RapidOCR', construct)
    OfflineEngine()._load_ocr()
    assert len(checked) == 1
    assert set(checked[0]) >= {'det_model_path', 'rec_model_path', 'cls_model_path'}


def test_ocr_status_rejects_reparse_ancestor_without_raising(tmp_path, monkeypatch):
    import importlib.util
    from pathlib import Path
    from neatdrop import offline
    directory = tmp_path / 'package' / 'models'
    directory.mkdir(parents=True)
    for name in offline.OCR_HASHES:
        (directory / name).write_bytes(b'placeholder')
    real_find = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, 'find_spec', lambda name: type('Spec', (), {'origin': str(directory.parent / '__init__.py')})()
                        if name == 'rapidocr_onnxruntime' else real_find(name))
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == directory.parent or original(path))
    status = offline.offline_status()['ocr']
    assert status['available'] is False and status['integrity_check'] == 'failed'


def stuck_image_worker(connection, image_data, use_ocr, use_vision):
    connection.recv()
    time.sleep(20)


def test_bounded_image_worker_is_killed_on_timeout_and_slot_is_released(monkeypatch):
    from neatdrop import offline
    original = offline._image_worker
    monkeypatch.setattr(offline, '_image_worker', stuck_image_worker)
    started = time.monotonic()
    result = offline.analyze_image_bounded(patterned_image((64, 64)), timeout=.2)
    assert time.monotonic() - started < 8
    assert result['text'] == ''
    assert 'inference_timeout' in result['warnings']
    assert result['sampling']['budget_exhausted'] is True
    monkeypatch.setattr(offline, '_image_worker', original)
    recovered = offline.analyze_image_bounded(Image.new('RGB', (64, 64), 'white'), use_ocr=False, use_vision=False)
    assert 'inference_timeout' not in recovered['warnings']
    assert 'image_low_information' in recovered['warnings']


def test_bounded_image_worker_cancellation_terminates_running_native_work(monkeypatch):
    from neatdrop import offline
    monkeypatch.setattr(offline, '_image_worker', stuck_image_worker)
    started = time.monotonic()
    result = offline.analyze_image_bounded(patterned_image((64, 64)),
                                           cancelled=lambda: time.monotonic() - started > .25)
    assert time.monotonic() - started < 4
    assert result['warnings'] == ['inference_cancelled']


def test_real_spawned_ocr_and_clip_work_with_child_network_blocked():
    from neatdrop.offline import analyze_image_bounded
    image = Image.new('RGB', (900, 500), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 42)
    for index, text in enumerate(['增值税电子普通发票', '发票号码 123456789', '购买方 样例公司', '价税合计 38.50元']):
        draw.text((35, 35 + index * 100), text, font=font, fill='black')
    result = analyze_image_bounded(image)
    assert '发票' in result['text'] and '38.50' in result['text']
    assert len(result['visual']) == 20
    assert result['warnings'] == []
    assert result['runtime']['network_disabled'] is True
    assert result['runtime']['elapsed_ms'] < 25000
    assert 0 < result['runtime']['peak_working_set_mib'] < 1536
    print('REAL_WORKER_METRICS', result['runtime'])


def oversized_image_worker(connection, image_data, use_ocr, use_vision):
    connection.recv()
    try:
        allocation = bytearray(1800 * 1024 * 1024)
        connection.send({'text': 'MEMORY_BUDGET_BYPASSED'})
        del allocation
    except MemoryError:
        connection.send({'error': 'inference_failed'})


def test_bounded_image_worker_memory_budget_is_enforced(monkeypatch):
    from neatdrop import offline
    monkeypatch.setattr(offline, '_image_worker', oversized_image_worker)
    result = offline.analyze_image_bounded(patterned_image((64, 64)), timeout=5)
    assert result['text'] == ''
    assert result['warnings'] == ['inference_failed']


def native_pid_image_worker(connection, image_data, use_ocr, use_vision):
    from pathlib import Path
    connection.recv()
    Path(os.environ['NEATDROP_TEST_WORKER_PID_FILE']).write_text(json.dumps({'pid': os.getpid()}))
    time.sleep(20)


def process_is_running(pid):
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        exitcode = wintypes.DWORD()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(exitcode))) and exitcode.value == 259
    finally:
        kernel.CloseHandle(handle)


@pytest.mark.skipif(os.name != 'nt', reason='Windows venv launcher PID regression')
def test_multiprocessing_timeout_targets_actual_image_interpreter_pid(tmp_path, monkeypatch):
    from neatdrop import offline, parsing
    pid_file = tmp_path / 'native-pid.json'
    monkeypatch.setenv('NEATDROP_TEST_WORKER_PID_FILE', str(pid_file))
    monkeypatch.setattr(offline, '_image_worker', native_pid_image_worker)
    original_limit = parsing._limit_worker_memory
    tracked = []
    def track(process, limit):
        tracked.append(process.pid)
        return original_limit(process, limit)
    monkeypatch.setattr(parsing, '_limit_worker_memory', track)
    result = offline.analyze_image_bounded(patterned_image((64, 64)), timeout=1.5)
    assert result['warnings'] == ['inference_timeout']
    actual = json.loads(pid_file.read_text())['pid']
    assert actual == tracked[0]
    assert not process_is_running(actual)


def test_missing_vision_models_is_explicit_and_does_not_download(tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError('Offline inference attempted network')
    monkeypatch.setattr(socket.socket, 'connect', no_network)
    engine = OfflineEngine(model_dir=tmp_path)
    image = Image.new('RGB', (64, 64), 'white')
    result = engine.analyze(image, use_ocr=False)
    assert result['visual'] == []
    assert 'vision_models_missing' in result['warnings']


def test_chinese_ocr_runs_without_network(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError('Offline inference attempted network')
    monkeypatch.setattr(socket.socket, 'connect', no_network)
    image = Image.new('RGB', (900, 500), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 42)
    draw.text((35, 35), '增值税电子普通发票', font=font, fill='black')
    draw.text((35, 130), '发票号码 123456789', font=font, fill='black')
    draw.text((35, 230), '购买方 样例公司', font=font, fill='black')
    draw.text((35, 330), '价税合计 38.50元', font=font, fill='black')
    result = OfflineEngine().analyze(image, use_vision=False)
    assert '发票' in result['text']
    assert '38.50' in result['text']
    assert result['ocr_lines']


def test_status_exposes_real_ocr_capability():
    assert offline_status()['ocr']['available'] is True


def test_real_clip_inference_on_synthetic_document_without_network(monkeypatch):
    import pytest
    from neatdrop.offline import MODEL_DIR
    if not (MODEL_DIR / 'manifest.json').is_file():
        pytest.skip('Prepare optional offline vision models before integration test')
    def no_network(*args, **kwargs):
        raise AssertionError('Offline inference attempted network')
    monkeypatch.setattr(socket.socket, 'connect', no_network)
    image = Image.new('RGB', (700, 500), 'white')
    draw = ImageDraw.Draw(image)
    for y in range(30, 470, 35):
        draw.text((30, y), 'Example printed document with a heading and text', fill='black')
    result = OfflineEngine().analyze(image, use_ocr=False)
    assert len(result['visual']) == 20
    assert all(-1 <= row['score'] <= 1 for row in result['visual'])
    assert result['warnings'] == []
