from pathlib import Path

from neatdrop import offline


def test_model_directory_permission_failure_is_reported_without_breaking_config(monkeypatch):
    original = Path.is_file
    def denied(path):
        if path.is_relative_to(offline.MODEL_DIR):
            raise PermissionError('model directory unreadable')
        return original(path)
    monkeypatch.setattr(Path, 'is_file', denied)
    status = offline.offline_status()
    assert status['vision']['available'] is False
    assert status['vision']['integrity_check'] == 'failed'
