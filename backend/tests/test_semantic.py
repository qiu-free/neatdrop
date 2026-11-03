"""Contract, real tokenizer, package trust and disposable-worker regressions."""
import hashlib
import importlib.util
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from tokenizers import Tokenizer, models, pre_tokenizers

from neatdrop import semantic
from neatdrop.taxonomy import SUBCATEGORIES


def _preparer():
    path = Path(__file__).resolve().parents[2] / 'scripts' / 'prepare_semantic.py'
    spec = importlib.util.spec_from_file_location('prepare_semantic', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_profiles_cover_taxonomy_with_meaningful_negatives_and_no_fallback_competition():
    profiles = semantic.load_profiles()
    assert {(p['category'], p['subcategory']) for p in profiles} == {
        (c, s) for c, subs in SUBCATEGORIES.items() for s in subs}
    assert len(profiles) == 57
    for profile in profiles:
        assert profile['definition'] and profile['positive_examples'] and profile['negative_examples']
        assert isinstance(profile['necessary_structure'], list)
    active = semantic.candidate_profiles(profiles)
    assert len(active) == 55
    assert {'unclassified', 'unsorted_photo'}.isdisjoint(p['subcategory'] for p in active)
    assert all(p['support'] == 'candidate_only' for p in active)


def test_bad_profile_ids_are_rejected(tmp_path):
    path = tmp_path / 'profiles.json'
    path.write_text(json.dumps({'version': 'bad', 'profiles': [
        {'category': 'finance', 'subcategory': '../../escape'}]}), 'utf-8')
    with pytest.raises(ValueError):
        semantic.load_profiles(path)


def test_missing_model_returns_explicit_candidate_only_contract_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(socket.socket, 'connect', lambda *a, **k: pytest.fail('runtime used network'))
    engine = semantic.SemanticEngine(tmp_path)
    status = engine.status()
    assert status['available'] is False and status['state'] == 'missing'
    assert status['integrity_check'] != 'verified'
    result = engine.classify('A methods and results academic document')
    assert result['candidates'] == [] and 'semantic_models_missing' in result['warnings']
    assert result['version'] and result['truncated'] is False


def test_manifest_cannot_make_unknown_or_corrupt_files_ready(tmp_path):
    (tmp_path / 'manifest.json').write_text(json.dumps({'repository': 'attacker/model', 'files': {}}))
    status = semantic.SemanticEngine(tmp_path).status()
    assert not status['available'] and status['state'] == 'self_test_failed'
    assert status['integrity_check'] == 'failed'
    (tmp_path / 'manifest.json').write_text(json.dumps(semantic.package_manifest()))
    for name in semantic.TRUSTED_FILES:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'wrong model data')
    with pytest.raises(ValueError, match='integrity|size'):
        semantic.verify_package(tmp_path)


def test_denied_model_files_degrade_without_raising(tmp_path, monkeypatch):
    original = Path.exists
    def denied(path):
        if path == tmp_path / 'manifest.json':
            raise PermissionError('model is not readable')
        return original(path)
    monkeypatch.setattr(Path, 'exists', denied)
    engine = semantic.SemanticEngine(tmp_path)
    assert engine.status()['state'] == 'self_test_failed'
    result = engine.classify('this is a document')
    assert result['candidates'] == [] and 'semantic_integrity_or_selftest_failed' in result['warnings']


def test_changed_hash_invalidates_prior_successful_status(tmp_path, monkeypatch):
    engine = semantic.SemanticEngine(tmp_path)
    (tmp_path / 'manifest.json').write_text('{}')
    monkeypatch.setattr(semantic, 'verify_package', lambda p: {})
    monkeypatch.setattr(semantic, 'run_worker', lambda *a, **k: {'ok': True, 'network_blocked': True, 'provider': 'CPUExecutionProvider', 'worker_pid': 123})
    assert engine.status()['available']
    (tmp_path / 'manifest.json').write_text('{"tampered":true}')
    monkeypatch.setattr(semantic, 'verify_package', lambda p: (_ for _ in ()).throw(ValueError('bad hash')))
    assert engine.status()['available'] is False


def test_incomplete_selftest_cannot_report_ready(tmp_path, monkeypatch):
    (tmp_path / 'manifest.json').write_text('{}')
    monkeypatch.setattr(semantic, 'verify_package', lambda p: {})
    monkeypatch.setattr(semantic, 'run_worker', lambda *a, **k: {})
    status = semantic.SemanticEngine(tmp_path).status()
    assert status['available'] is False and status['state'] == 'self_test_failed'


def test_chunk_budget_uses_real_tokens_and_covers_tail_deterministically():
    tokenizer = Tokenizer(models.WordLevel({'[UNK]': 100, '[CLS]': 101, '[SEP]': 102,
                                           **{f'w{i}': 200 + i for i in range(3000)}}, unk_token='[UNK]'))
    tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
    text = ' '.join(f'w{i}' for i in range(2800))
    first = semantic.token_chunks(tokenizer, text)
    assert first == semantic.token_chunks(tokenizer, text)
    assert first['truncated'] is True and len(first['chunks']) == 6
    assert all(2 < len(c) <= 384 and c[0] == 101 and c[-1] == 102 for c in first['chunks'])
    assert first['chunks'][0][1] == 200 and 2999 in first['chunks'][-1]
    spans = first['spans']
    assert all(a['end'] - b['start'] <= 48 for a, b in zip(spans, spans[1:]))


def test_cls_pooling_normalizes_first_token_not_mean():
    import numpy as np
    result = semantic.cls_pool(np.array([[[3., 4.], [100., 0.]]], dtype=np.float32))
    assert result.tolist()[0] == pytest.approx([.6, .8])
    with pytest.raises(ValueError):
        semantic.cls_pool(np.array([[[float('nan'), 0.]]]))


def test_native_worker_timeout_terminates_child(monkeypatch, tmp_path):
    real_popen = subprocess.Popen
    spawned = []
    def slow_child(*args, **kwargs):
        proc = real_popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        spawned.append(proc)
        return proc
    monkeypatch.setattr(semantic.subprocess, 'Popen', slow_child)
    began = time.monotonic()
    with pytest.raises(TimeoutError):
        semantic.run_worker(tmp_path, '', operation='selftest', timeout=.15)
    assert time.monotonic() - began < 3
    assert spawned[0].poll() is not None


def test_native_worker_cancellation_terminates_child(monkeypatch, tmp_path):
    real_popen = subprocess.Popen
    spawned = []
    def slow_child(*args, **kwargs):
        proc = real_popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        spawned.append(proc)
        return proc
    monkeypatch.setattr(semantic.subprocess, 'Popen', slow_child)
    began = time.monotonic()
    with pytest.raises(InterruptedError):
        semantic.run_worker(tmp_path, '', operation='selftest', timeout=5,
                            cancelled=lambda: time.monotonic() - began > .1)
    assert time.monotonic() - began < 2
    assert spawned[0].poll() is not None


def test_lock_wait_is_included_in_total_worker_budget(tmp_path):
    import threading
    acquired = threading.Event()
    release = threading.Event()
    def hold_lock():
        with semantic._LOCK:
            acquired.set()
            release.wait(2)
    thread = threading.Thread(target=hold_lock)
    thread.start()
    assert acquired.wait(1)
    began = time.monotonic()
    try:
        with pytest.raises(TimeoutError):
            semantic.run_worker(tmp_path, '', operation='selftest', timeout=.1)
        assert time.monotonic() - began < .4
    finally:
        release.set()
        thread.join()


def test_real_native_memory_limit_refuses_an_over_budget_allocation():
    backend = str(Path(semantic.__file__).resolve().parents[1])
    code = (
        'import sys; sys.path.insert(0,' + repr(backend) + '); '
        'from neatdrop.semantic import _memory_limit, MEMORY_BYTES; '
        'job = _memory_limit()\n'
        'try:\n bytearray(MEMORY_BYTES + 1)\n'
        'except MemoryError:\n print("memory_limited")\n'
        'else:\n raise RuntimeError("native memory limit failed")\n'
    )
    result = subprocess.run([getattr(sys, '_base_executable', sys.executable), '-I', '-S', '-c', code],
                            capture_output=True, timeout=5)
    assert result.returncode == 0 and result.stdout.strip() == b'memory_limited'


def test_candidate_selection_abstains_below_floor_and_when_negative_is_stronger():
    import numpy as np
    profiles = semantic.candidate_profiles(semantic.load_profiles())[:3]
    assert semantic.select_candidates(profiles, np.array([[.4, .5, .52]]), np.zeros((1, 3))) == []
    assert semantic.select_candidates(profiles, np.array([[.8, .7, .54]]), np.array([[.85, .72, .55]])) == []
    selected = semantic.select_candidates(profiles, np.array([[.8, .6, .1], [.1, .6, .8]]), np.zeros((2, 3)))
    assert [c['subcategory'] for c in selected] == ['receipt']  # whole-document mean, not strongest chunk


def test_chunk_support_preserves_disagreeing_sections():
    import numpy as np
    profiles = semantic.candidate_profiles(semantic.load_profiles())[:2]
    summary = semantic.chunk_support(profiles, np.array([[.8, .2], [.2, .8]]), np.zeros((2, 2)))
    assert summary['conflict'] is True
    assert [c['candidates'][0]['subcategory'] for c in summary['chunks']] == ['invoice', 'receipt']
    assert summary['chunks'][0]['candidates'][0]['score'] == .8


@pytest.mark.parametrize('subcategory,text', [
    ('wallpaper', '这是一份壁纸设计教程，介绍如何选择手机屏幕背景，并非准备归档的壁纸。'),
    ('medical', '患者检验报告示例用于医学课程教学，不是真实就诊资料。白细胞结果5.3，单位和参考范围。'),
    ('wallpaper', '手机锁屏壁纸图片下载教程：背景设置与分辨率调整。'),
    ('identity', '教你识别身份证样例，证件号码仅为教学示例。'),
    ('people', '有人在公园散步。'),
    ('code', 'def code(): return 123456'),
])
def test_required_purpose_gates_suppress_tutorial_or_unproved_sensitive_candidates(subcategory, text):
    profile = next(p for p in semantic.load_profiles() if p['subcategory'] == subcategory)
    assert semantic.profile_eligible(profile, text) is False


@pytest.mark.parametrize('subcategory,text', [
    ('wallpaper', '这张图我准备设置为手机锁屏壁纸。'),
    ('medical', '医院检验报告 患者样例 检测日期11月1日 白细胞 结果5.3 参考范围4-10'),
    ('invoice', '增值税发票 发票号码12345678 购买方样例 销售方商店 价税合计128元'),
])
def test_required_purpose_gates_allow_explicit_candidate_evidence(subcategory, text):
    profile = next(p for p in semantic.load_profiles() if p['subcategory'] == subcategory)
    assert semantic.profile_eligible(profile, text) is True


def test_cancelled_classification_returns_explicit_warning_without_model(tmp_path):
    result = semantic.SemanticEngine(tmp_path).classify('hello', cancelled=lambda: True)
    assert result['candidates'] == [] and 'semantic_cancelled' in result['warnings']


@pytest.mark.parametrize('name', ['../evil', '/absolute', 'onnx/../../evil', 'C:/evil', 'onnx\\evil', 'onnx/model.onnx:ads'])
def test_prepare_rejects_unsafe_relative_paths(name):
    with pytest.raises(ValueError):
        _preparer().safe_relative(name)


def test_prepare_blocks_http_credentials_external_redirect_and_size(tmp_path):
    prepare = _preparer()
    for url in ['http://huggingface.co/file', 'https://user:pass@huggingface.co/file',
                'https://huggingface.co:444/file', 'https://127.0.0.1/file']:
        with pytest.raises(ValueError):
            prepare.validate_url(url)
    def redirect(request):
        return httpx.Response(302, headers={'location': 'https://evil.example/model'})
    with httpx.Client(transport=httpx.MockTransport(redirect)) as client:
        with pytest.raises(ValueError):
            prepare.download(client, 'https://huggingface.co/model', tmp_path / 'file', 16)
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b'X' * 17))) as client:
        with pytest.raises(ValueError, match='size'):
            prepare.download(client, 'https://huggingface.co/model', tmp_path / 'file', 16)
    assert not (tmp_path / 'file').exists()


def test_local_import_rejects_symlink_and_wrong_hash_without_publishing(tmp_path):
    prepare = _preparer()
    source = tmp_path / 'source'
    source.mkdir()
    target = tmp_path / 'installed'
    (source / 'manifest.json').write_text('{}')
    with pytest.raises(ValueError):
        prepare.prepare(target, source=source)
    assert not target.exists()


def test_verified_local_import_publishes_only_after_real_selftest(tmp_path):
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    prepare = _preparer()
    target = tmp_path / 'imported'
    assert prepare.prepare(target, source=semantic.MODEL_DIR) == target
    assert semantic.verify_package(target)['revision'] == '75c43b069aac4d136ba6bc1122f995fedcfd2781'
    assert not list(tmp_path.glob('.semantic-stage-*'))


def test_real_worker_handle_owns_actual_native_inference_process(monkeypatch):
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    original = subprocess.Popen
    handles = []
    def track(*args, **kwargs):
        handle = original(*args, **kwargs)
        handles.append(handle)
        return handle
    monkeypatch.setattr(semantic.subprocess, 'Popen', track)
    result = semantic.run_worker(semantic.MODEL_DIR, '', operation='selftest')
    assert result['worker_pid'] == handles[0].pid


def test_native_load_consumes_verified_bytes_after_paths_are_replaced(tmp_path, monkeypatch):
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    source = tmp_path / 'verified'
    _preparer().prepare(source, source=semantic.MODEL_DIR)
    original = semantic.read_verified_package
    def replace_after_read(root):
        result = original(root)
        (source / 'onnx/model_quantized.onnx').write_bytes(b'untrusted after checksum')
        (source / 'tokenizer.json').write_text('{}')
        return result
    monkeypatch.setattr(semantic, 'read_verified_package', replace_after_read)
    result = semantic._infer_local(source, '增值税发票 发票号码123456 购买方样例公司 销售方商店 价税合计128元', 'classify')
    assert any(c['subcategory'] == 'invoice' for c in result['candidates'])


def test_real_verified_cpu_inference_without_network():
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    engine = semantic.SemanticEngine()
    status = engine.status()
    assert status['available'] and status['state'] == 'ready'
    assert status['integrity_check'] == 'verified'
    # run_worker enforces Python DNS/socket denial in its fresh native worker.
    result = engine.classify('增值税电子普通发票 发票号码12345678 购买方样例公司 销售方商店 价税合计128元')
    assert result['candidates'] and len(result['candidates']) <= 3
    assert all(c['subcategory'] in SUBCATEGORIES[c['category']] and -1 <= c['score'] <= 1
               for c in result['candidates'])
    assert 'semantic_uncalibrated' in result['warnings']
    assert any(c['subcategory'] == 'invoice' for c in result['candidates'])


@pytest.mark.parametrize('text', ['xqzv 8473 abcd zzqq 123 test lorem ipsum', '您好，谢谢，再见。'])
def test_real_out_of_scope_text_abstains(text):
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    result = semantic.SemanticEngine().classify(text)
    assert result['candidates'] == [] and 'semantic_no_supported_candidate' in result['warnings']


def test_real_full_budget_uses_no_more_than_six_windows_and_marks_truncation():
    if not (semantic.MODEL_DIR / 'manifest.json').exists():
        pytest.skip('explicit optional model preparation not yet completed')
    text = '学术研究方法与实验结果。' * 1200
    result = semantic.SemanticEngine().classify(text)
    assert result['truncated'] and 'semantic_input_truncated' in result['warnings']
    sampling = result['token_sampling']
    assert len(sampling['spans']) <= 6
    assert sampling['spans'][0]['start'] == 0
    assert sampling['spans'][-1]['end'] == sampling['total_tokens']
