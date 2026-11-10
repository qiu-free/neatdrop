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
