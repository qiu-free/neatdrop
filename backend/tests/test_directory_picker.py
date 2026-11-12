import json
import subprocess
from types import SimpleNamespace

import pytest

from neatdrop.files import SafetyError


def test_windows_picker_uses_hidden_sta_native_helper_without_tk(monkeypatch, tmp_path):
    from neatdrop import directory_picker as picker
    calls = []
    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps({'path': str(tmp_path)}, ensure_ascii=False).encode('utf-8'), stderr=b'\xd5\xfd')
    monkeypatch.setattr(picker.subprocess, 'run', run)
    monkeypatch.setattr(picker, '_is_windows', lambda: True)
    assert picker.choose_directory() == str(tmp_path)
    command, options = calls[0]
    assert '-STA' in command and '-EncodedCommand' in command
    assert '-WindowStyle' in command and 'Hidden' in command
    assert options.get('shell', False) is False
    assert not options.get('encoding') and not options.get('text')
    assert options['timeout'] <= 600
    assert str(tmp_path) not in ' '.join(command)


def test_cancel_is_not_an_error_or_a_fallback_dialog(monkeypatch):
    from neatdrop import directory_picker as picker
    monkeypatch.setattr(picker, '_is_windows', lambda: True)
    run = lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout='{"path":null}', stderr='')
    monkeypatch.setattr(picker.subprocess, 'run', run)
    assert picker.choose_directory() is None


@pytest.mark.parametrize('payload', ['not json', '{"path":123}', '{"path":"relative"}', '{"path":""}'])
def test_invalid_picker_result_is_rejected(monkeypatch, payload):
    from neatdrop import directory_picker as picker
    monkeypatch.setattr(picker, '_is_windows', lambda: True)
    monkeypatch.setattr(picker.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=payload, stderr=''))
    with pytest.raises(SafetyError, match='PICKER_UNAVAILABLE'):
        picker.choose_directory()


def test_timed_out_helper_has_a_recoverable_error(monkeypatch):
    from neatdrop import directory_picker as picker
    monkeypatch.setattr(picker, '_is_windows', lambda: True)
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('picker', 600)
    monkeypatch.setattr(picker.subprocess, 'run', timeout)
    with pytest.raises(SafetyError, match='PICKER_TIMEOUT'):
        picker.choose_directory()


def test_overlapping_requests_do_not_open_a_second_dialog(monkeypatch):
    from neatdrop import directory_picker as picker
    assert picker._picker_lock.acquire(blocking=False)
    try:
        with pytest.raises(SafetyError, match='PICKER_BUSY'):
            picker.choose_directory()
    finally:
        picker._picker_lock.release()
