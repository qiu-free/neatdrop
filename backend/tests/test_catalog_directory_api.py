"""Opening a child requires an explicit confirmation and fresh identity check."""
from fastapi.testclient import TestClient

from neatdrop.app import create_app


def make_client(tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    child = root / 'course'
    child.mkdir()
    (child / 'notes.md').write_text('course notes', encoding='utf-8')
    client = TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 52000))
    csrf = client.get('/api/session').json()['csrf']
    client.headers['x-neatdrop-csrf'] = csrf
    opened = client.post('/api/v1/workspaces', json={'path': str(root)}).json()
    directory = next(row for row in opened['files'] if row['reason'] == 'DIRECTORY_SKIPPED')
    return client, root, child, opened, directory


def test_child_open_requires_confirmation_and_uses_scanned_child(tmp_path):
    client, _, child, opened, directory = make_client(tmp_path)
    endpoint = f"/api/v1/workspaces/{opened['id']}/children/{directory['id']}/open"
    rejected = client.post(endpoint, json={'confirmed': False})
    assert rejected.status_code == 409 and rejected.json()['code'] == 'CONFIRMATION_REQUIRED'
    response = client.post(endpoint, json={'confirmed': True})
    assert response.status_code == 200
    assert response.json()['path'] == str(child.resolve())
    assert [row['name'] for row in response.json()['files']] == ['notes.md']
    assert client.get(f"/api/v1/workspaces/{response.json()['id']}/files").status_code == 200


def test_child_open_rejects_unknown_or_non_directory_entry(tmp_path):
    client, _, _, opened, directory = make_client(tmp_path)
    prefix = f"/api/v1/workspaces/{opened['id']}/children/"
    assert client.post(prefix + 'f' * 24 + '/open', json={'confirmed': True}).json()['code'] == 'DIRECTORY_NOT_AVAILABLE'
    invalid = client.post(prefix + directory['id'] + '/open', json={'confirmed': True, 'path': 'elsewhere'})
    assert invalid.status_code == 422


def test_child_open_rechecks_directory_identity_after_lookup(tmp_path):
    client, root, child, opened, directory = make_client(tmp_path)
    moved = root / 'moved'
    child.rename(moved)
    child.mkdir()
    (child / 'attacker.md').write_text('replacement', encoding='utf-8')
    endpoint = f"/api/v1/workspaces/{opened['id']}/children/{directory['id']}/open"
    response = client.post(endpoint, json={'confirmed': True})
    assert response.status_code == 409
    assert response.json()['code'] == 'DIRECTORY_CHANGED'
    assert len(next(iter(client.app.state.sessions.values())).workspaces) == 1


def test_child_open_does_not_follow_concurrent_rescan_to_replacement(tmp_path, monkeypatch):
    import threading
    from neatdrop.files import Workspace
    client, root, child, opened, directory = make_client(tmp_path)
    ws = next(iter(client.app.state.sessions.values())).workspaces[opened['id']][0]
    lookup, swapped, rescan_attempted, rescanned = threading.Event(), threading.Event(), threading.Event(), threading.Event()
    original = Workspace.child_directory
    workers = []

    def change_then_rescan():
        assert lookup.wait(3)
        child.rename(root / 'old-course')
        child.mkdir()
        (child / 'attacker.md').write_text('replacement', encoding='utf-8')
        swapped.set()
        rescan_attempted.set()
        ws.scan()
        rescanned.set()

    def pause_after_lookup(self, identifier):
        value = original(self, identifier)
        lookup.set()
        assert swapped.wait(3)
        assert rescan_attempted.wait(3)
        rescanned.wait(.5)
        # With the endpoint's workspace lock, a concurrent rescan cannot update
        # the captured expected identity. The replacement must be rejected.
        return value

    monkeypatch.setattr(Workspace, 'child_directory', pause_after_lookup)
    worker = threading.Thread(target=change_then_rescan, daemon=True)
    workers.append(worker); worker.start()
    endpoint = f"/api/v1/workspaces/{opened['id']}/children/{directory['id']}/open"
    response = client.post(endpoint, json={'confirmed': True})
    worker.join(3)
    assert not worker.is_alive()
    assert response.status_code == 409
    assert response.json()['code'] == 'DIRECTORY_CHANGED'
    assert len(next(iter(client.app.state.sessions.values())).workspaces) == 1
