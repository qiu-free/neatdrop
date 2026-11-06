"""Graph API exercises real receipts, session authorization and byte verification."""
import time
import pytest
from fastapi.testclient import TestClient
from neatdrop.app import create_app
from neatdrop.executor import Executor
from neatdrop.files import Workspace
from neatdrop.trust import TrustStore


@pytest.fixture
def archived(tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    for name, text in [('paper.md', 'Quantum photon entanglement experiment measures polarization correlations.'),
                       ('notes.md', 'Quantum photon entanglement experiment measures polarization correlations.'),
                       ('garden.md', 'Garden irrigation tomato harvesting compost seasonal vegetable cultivation.')]:
        (root / name).write_text(text, encoding='utf-8')
    ws = Workspace(root)
    executor = Executor(ws, TrustStore(tmp_path / 'receipts'))
    records = ws.scan()
    plan = executor.plan([{'file_id': r['id'], 'name': r['name'], 'category': 'study', 'subcategory': 'notes'} for r in records])
    assert executor.execute(plan['id'], plan['digest'], True)['status'] == 'completed'
    with TestClient(create_app(), base_url='http://127.0.0.1', client=('127.0.0.1', 50000)) as client:
        csrf = client.get('/api/session').json()['csrf']
        client.headers['x-neatdrop-csrf'] = csrf
        session = next(iter(client.app.state.sessions.values()))
        session.workspaces[ws.id] = (ws, executor)
        yield client, '/api/v1/workspaces/' + ws.id + '/graph', executor, plan


def test_graph_route_requires_authorized_workspace(archived):
    client, prefix, _, _ = archived
    response = client.get(prefix)
    assert response.status_code == 200
    data = response.json()
    assert {i['name'] for i in data['items']} == {'paper.md', 'notes.md', 'garden.md'}
    assert data['index']['count'] == 0
    assert len(data['relations']) == 1
    assert data['relations'][0]['kind'] == 'duplicate'
    assert data['relations'][0]['origin'] == 'archive'

def test_manual_directional_relation_revision_and_reopen(archived):
    from neatdrop.graph import GraphService
    client, prefix, executor, _ = archived
    data = client.get(prefix).json()
    source, target = [i['id'] for i in data['items'][:2]]
    body = {'source': source, 'target': target, 'kind': 'reference', 'revision': 0}
    result = client.post(prefix + '/relations', json=body)
    assert result.status_code == 200
    relation = next(r for r in result.json()['relations'] if r['origin'] == 'manual')
    assert (relation['source'], relation['target'], relation['status']) == (source, target, 'confirmed')
    assert relation in GraphService(executor).listing()['relations']
    assert client.post(prefix + '/relations', json=body).json()['code'] == 'GRAPH_REVISION_CONFLICT'
    assert client.post(prefix + '/relations', json={**body, 'revision': 1, 'target': source}).json()['code'] == 'GRAPH_SELF_LINK'
    assert client.post(prefix + '/relations', json={**body, 'revision': 1, 'target': 'f'*64}).json()['code'] == 'GRAPH_ENTRY_NOT_FOUND'
    assert client.post(prefix + '/relations', json={**body, 'revision': 1, 'path': 'private'}).status_code == 422
    assert client.request('DELETE', prefix + '/relations/' + relation['id'], json={'revision': 1}).status_code == 200


def wait_job(client, prefix, job):
    for _ in range(150):
        data = client.get(prefix + '/jobs/' + job['id']).json()
        if data['status'] not in {'queued', 'running'}:
            return data
        time.sleep(.02)
    pytest.fail('graph job did not settle')


def test_index_evidence_confirm_and_clear_preserves_manual(archived):
    client, prefix, _, _ = archived
    ids = [i['id'] for i in client.get(prefix).json()['items']]
    assert client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': False}).json()['code'] == 'GRAPH_CONFIRMATION_REQUIRED'
    job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
    assert wait_job(client, prefix, job)['status'] == 'completed'
    data = client.get(prefix).json()
    assert data['index']['count'] == 3
    candidate = next(r for r in data['relations'] if r['status'] == 'suggested')
    evidence = client.get(prefix + '/relations/' + candidate['id'] + '/evidence')
    assert evidence.status_code == 200
    assert all(f['excerpts'] for f in evidence.json()['files'])
    response = client.post(prefix + '/relations', json={'source': candidate['source'], 'target': candidate['target'], 'kind': 'related', 'revision': data['index']['revision'], 'candidate_id': candidate['id']})
    assert response.status_code == 200
    cleared = client.request('DELETE', prefix + '/index', json={'revision': response.json()['index']['revision']})
    assert cleared.status_code == 200
    assert cleared.json()['index']['count'] == 0
    assert any(r['origin'] == 'manual' for r in cleared.json()['relations'])


def test_receipt_withdrawal_and_changed_current_bytes_block_evidence(archived):
    client, prefix, executor, plan = archived
    data = client.get(prefix).json()
    relation = data['relations'][0]
    entry = next(i for i in data['items'] if i['id'] == relation['source'])
    target = executor.ws.root / entry['target']
    original = target.read_bytes()
    target.write_bytes(b'x' * len(original))
    assert client.get(prefix + '/relations/' + relation['id'] + '/evidence').json()['code'] == 'GRAPH_ENTRY_CHANGED'
    executor.trust._path(plan['id']).unlink()
    assert client.get(prefix).json()['relations'] == []


def test_graph_auth_csrf_guessed_ids_and_delete_body_guard(archived):
    client, prefix, _, _ = archived
    assert client.get(prefix.replace('/workspaces/', '/workspaces/unknown')).status_code == 404
    assert client.get(prefix + '/jobs/' + 'f'*32).status_code == 404
    assert client.get(prefix + '/relations/' + 'f'*64 + '/evidence').status_code == 404
    csrf = client.headers.pop('x-neatdrop-csrf')
    assert client.request('DELETE', prefix + '/index', json={'revision': 0}).status_code == 403
    client.headers['x-neatdrop-csrf'] = csrf
    assert client.request('DELETE', prefix + '/index', content='{}', headers={'content-type': 'text/plain'}).status_code == 415
    assert client.request('DELETE', prefix + '/index', json={'revision': 0, 'path': '/etc'}).status_code == 422
    with TestClient(client.app, base_url='http://127.0.0.1', client=('127.0.0.1', 50001)) as other:
        other.get('/api/session')
        assert other.get(prefix).status_code == 404

def test_cancel_during_decode_never_publishes_partial_batch(archived, monkeypatch):
    import threading
    from neatdrop.graph import GraphService
    client, prefix, _, _ = archived
    entered, release = threading.Event(), threading.Event()
    original = GraphService.read
    def blocked(self, *args, **kwargs):
        if kwargs.get('local', True):
            entered.set()
            assert release.wait(5)
        return original(self, *args, **kwargs)
    monkeypatch.setattr(GraphService, 'read', blocked)
    ids = [i['id'] for i in client.get(prefix).json()['items']]
    try:
        job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
        assert entered.wait(3)
        second = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True})
        assert second.json()['code'] == 'GRAPH_JOB_BUSY'
        cancelled = client.post(prefix + '/jobs/' + job['id'] + '/cancel', json={})
        assert cancelled.status_code == 200
        assert cancelled.json()['status'] == 'cancelled'
    finally:
        release.set()
    assert client.get(prefix).json()['index']['count'] == 0


def test_job_revision_conflict_does_not_overwrite_manual_edit(archived, monkeypatch):
    import threading
    from neatdrop.graph import GraphService
    client, prefix, _, _ = archived
    entered, release = threading.Event(), threading.Event()
    original = GraphService.read
    def blocked(self, *args, **kwargs):
        if kwargs.get('local', True):
            entered.set()
            assert release.wait(5)
        return original(self, *args, **kwargs)
    monkeypatch.setattr(GraphService, 'read', blocked)
    ids = [i['id'] for i in client.get(prefix).json()['items']]
    try:
        job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
        assert entered.wait(3)
        result = client.post(prefix + '/relations', json={'source': ids[0], 'target': ids[1], 'kind': 'reference', 'revision': 0})
        assert result.status_code == 200
    finally:
        release.set()
    settled = wait_job(client, prefix, job)
    assert settled['status'] == 'failed'
    assert settled['error'] == 'GRAPH_REVISION_CONFLICT'
    data = client.get(prefix).json()
    assert data['index']['count'] == 0
    assert any(r['origin'] == 'manual' for r in data['relations'])


def test_partial_decode_failure_reports_entry_and_commits_only_successes(archived):
    client, prefix, executor, _ = archived
    # Real invalid UTF-8 archive exercises decoder failure without replacing
    # receipts or mocking graph state.
    source = executor.ws.root / 'broken.md'
    source.write_bytes(b'\xff\xfe\xff')
    record = next(r for r in executor.ws.scan() if r['name'] == 'broken.md')
    plan = executor.plan([{'file_id': record['id'], 'name': 'broken.md', 'category': 'study', 'subcategory': 'notes'}])
    assert executor.execute(plan['id'], plan['digest'], True)['status'] == 'completed'
    items = client.get(prefix).json()['items']
    broken = next(i['id'] for i in items if i['name'] == 'broken.md')
    job = client.post(prefix + '/jobs', json={'entry_ids': [i['id'] for i in items], 'confirmed': True}).json()
    data = wait_job(client, prefix, job)
    assert data['status'] == 'completed'
    assert data['processed'] == 4
    assert any(e['entry_id'] == broken for e in data['errors'])
    assert client.get(prefix).json()['index']['count'] == 3


def test_changed_bytes_and_receipt_removal_refuse_cached_candidate_confirmation(archived):
    client, prefix, executor, _ = archived
    items = client.get(prefix).json()['items']
    job = client.post(prefix + '/jobs', json={'entry_ids': [i['id'] for i in items], 'confirmed': True}).json()
    assert wait_job(client, prefix, job)['status'] == 'completed'
    data = client.get(prefix).json()
    candidate = next(r for r in data['relations'] if r['status'] == 'suggested')
    item = next(i for i in items if i['id'] == candidate['source'])
    target = executor.ws.root / item['target']
    target.write_bytes(b'x' * target.stat().st_size)
    result = client.post(prefix + '/relations', json={'source': candidate['source'], 'target': candidate['target'], 'kind': 'version', 'candidate_id': candidate['id'], 'revision': data['index']['revision']})
    assert result.status_code == 409
    assert result.json()['code'] == 'GRAPH_ENTRY_CHANGED'


def test_dismissed_candidate_not_recreated_for_same_bytes(archived):
    client, prefix, _, _ = archived
    ids = [i['id'] for i in client.get(prefix).json()['items']]
    job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
    assert wait_job(client, prefix, job)['status'] == 'completed'
    data = client.get(prefix).json()
    candidate = next(r for r in data['relations'] if r['status'] == 'suggested')
    response = client.post(prefix + '/relations/' + candidate['id'] + '/dismiss', json={'revision': data['index']['revision']})
    assert response.status_code == 200
    job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
    assert wait_job(client, prefix, job)['status'] == 'completed'
    assert candidate['id'] not in {r['id'] for r in client.get(prefix).json()['relations']}

def test_evidence_discloses_partial_read_scope(archived):
    client, prefix, executor, _ = archived
    (executor.ws.root / 'long.md').write_text('photon quantum correlation ' * 900, encoding='utf-8')
    record = next(r for r in executor.ws.scan() if r['name'] == 'long.md')
    plan = executor.plan([{'file_id': record['id'], 'name': 'long.md', 'category': 'study', 'subcategory': 'notes'}])
    assert executor.execute(plan['id'], plan['digest'], True)['status'] == 'completed'
    items = client.get(prefix).json()['items']
    source = next(i['id'] for i in items if i['name'] == 'long.md')
    target = next(i['id'] for i in items if i['name'] == 'paper.md')
    data = client.post(prefix + '/relations', json={'source': source, 'target': target, 'kind': 'related', 'revision': 0}).json()
    relation = next(r for r in data['relations'] if r['origin'] == 'manual')
    evidence = client.get(prefix + '/relations/' + relation['id'] + '/evidence').json()
    summary = next(f['summary'] for f in evidence['files'] if f['id'] == source)
    assert '部分内容未' in summary


def test_publish_rechecks_same_size_bytes_after_initial_decode(archived, monkeypatch):
    from neatdrop.graph import GraphService
    client, prefix, executor, _ = archived
    items = client.get(prefix).json()['items']
    selected = items[0]
    target = executor.ws.root / selected['target']
    original_read = GraphService.read
    def changed_after_decode(self, key, **kwargs):
        payload = original_read(self, key, **kwargs)
        if key == selected['id'] and kwargs.get('local', True):
            target.write_bytes(b'x' * target.stat().st_size)
        return payload
    monkeypatch.setattr(GraphService, 'read', changed_after_decode)
    job = client.post(prefix + '/jobs', json={'entry_ids': [selected['id']], 'confirmed': True}).json()
    result = wait_job(client, prefix, job)
    assert result['status'] == 'failed'
    assert result['error'] == 'GRAPH_ENTRY_CHANGED'
    assert client.get(prefix).json()['index']['count'] == 0
