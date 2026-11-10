import pytest
from neatdrop.files import Workspace, SafetyError


def test_child_navigation_is_direct_explicit_and_tracks_directory_identity(tmp_path):
    child = tmp_path / '课程'; child.mkdir()
    (child / '笔记.md').write_text('课程正文', encoding='utf8')
    (tmp_path / 'file.txt').write_text('正文', encoding='utf8')
    workspace = Workspace(tmp_path)
    files = workspace.scan()
    directory = next(file for file in files if file['name'] == '课程')
    assert directory['supported'] is False
    assert workspace.child_directory(directory['id']) == str(child)
    with pytest.raises(SafetyError, match='DIRECTORY_NOT_AVAILABLE'):
        workspace.child_directory(next(file['id'] for file in files if file['supported']))
    with pytest.raises(SafetyError):
        workspace.child_directory('../课程')
    child.rename(tmp_path / 'old')
    child.mkdir()
    with pytest.raises(SafetyError, match='DIRECTORY_CHANGED'):
        workspace.child_directory(directory['id'])


def test_link_like_child_cannot_be_opened(tmp_path, monkeypatch):
    import neatdrop.files as files
    child = tmp_path / 'child'; child.mkdir()
    workspace = Workspace(tmp_path)
    record = workspace.scan()[0]
    original = files.is_link
    monkeypatch.setattr(files, 'is_link', lambda path: path == child or original(path))
    with pytest.raises(SafetyError, match='LINK_FORBIDDEN'):
        workspace.child_directory(record['id'])
