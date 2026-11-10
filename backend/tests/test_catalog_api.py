"""Catalog grants are session-local; real archives/receipts stay isolated."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from neatdrop.app import create_app
from neatdrop.executor import Executor
from neatdrop.files import Workspace
from neatdrop.trust import TrustStore


@pytest.fixture
def catalog(tmp_path):
    app = create_app()
    # A persistent installation store belongs to this test alone.
    app.state.catalog_path = tmp_path / 'catalog-state'
    archives = []
    for index in range(2):
        root = tmp_path / f'root-{index}'
        root.mkdir()
        (root / 'notes.md').write_text(
            'Quantum photon entanglement experiment measures polarization correlations. '
            'Photon quantum polarization observations support entanglement experiments.', encoding='utf-8')
        ws = Workspace(root)
        executor = Executor(ws, TrustStore(tmp_path / 'receipts'))
        record = ws.scan()[0]
        plan = executor.plan([{'file_id': record['id'], 'name': 'notes.md', 'category': 'study', 'subcategory': 'notes'}])
        assert executor.execute(plan['id'], plan['digest'], True)['status'] == 'completed'
        archives.append((ws, executor, plan))
    with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 51000)) as client:
        client.headers['x-neatdrop-csrf'] = client.get('/api/session').json()['csrf']
        session = next(iter(app.state.sessions.values()))
        for ws, executor, _ in archives:
            session.workspaces[ws.id] = (ws, executor)
        yield client, session, archives


def register(client, ws, alias, **extra):
    response = client.post('/api/v1/catalog/roots', json={
        'workspace_id': ws.id, 'alias': alias, 'confirmed': True, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_registry_never_grants_new_session_or_exposes_stored_paths(catalog):
    client, session, archives = catalog
    ws, _, _ = archives[0]
    assert client.get('/api/v1/catalog').status_code == 200
    data = register(client, ws, '课程甲')
    root = data['roots'][0]
    assert root['status'] == 'authorized'
    assert root['workspace_id'] == ws.id
    assert str(ws.root) not in json.dumps(data, ensure_ascii=False)
    assert len(session.workspaces) == 2
    with TestClient(client.app, base_url='http://127.0.0.1', client=('127.0.0.1', 51001)) as other:
        other.headers['x-neatdrop-csrf'] = other.get('/api/session').json()['csrf']
        pending = other.get('/api/v1/catalog').json()['roots'][0]
        assert pending['status'] == 'pending_reauthorization'
        assert 'workspace_id' not in pending
        assert other.get('/api/v1/catalog/graph').json()['items'] == []
        rejected = other.post('/api/v1/catalog/roots', json={'workspace_id': ws.id, 'alias': '课程甲', 'confirmed': True, 'root_id': root['id']})
        assert rejected.status_code == 404
        selected = other.post('/api/v1/workspaces', json={'path': str(ws.root)})
        assert selected.status_code == 200
        implicit = other.post('/api/v1/catalog/roots', json={'workspace_id': selected.json()['id'], 'alias': '课程甲', 'confirmed': True})
        assert implicit.json()['code'] == 'CATALOG_REAUTHORIZATION_REQUIRED'
        explicit = other.post('/api/v1/catalog/roots', json={'workspace_id': selected.json()['id'], 'alias': '课程甲',
            'confirmed': True, 'root_id': root['id']})
        assert explicit.status_code == 200


def test_composite_entries_revoke_and_explicit_same_identity_reauthorization(catalog):
    client, session, archives = catalog
    first = register(client, archives[0][0], '甲')['roots'][0]['id']
    second = register(client, archives[1][0], '乙')['roots'][1]['id']
    listing = client.get('/api/v1/catalog/graph').json()
    assert len(listing['items']) == 2
    assert len({i['id'] for i in listing['items']}) == 2
    assert {i['name'] for i in listing['items']} == {'notes.md'}
    assert {i['source_alias'] for i in listing['items']} == {'甲', '乙'}
    assert {i['root_id'] for i in listing['items']} == {first, second}
    assert listing['total'] == 2 and listing['next_offset'] is None
    assert len(listing['relations']) == 1
    relation = listing['relations'][0]
    assert relation['kind'] == 'duplicate'
    evidence = client.get('/api/v1/catalog/graph/relations/' + relation['id'] + '/evidence')
    assert evidence.status_code == 200
    assert all(f['excerpts'] for f in evidence.json()['files'])
    item = next(i for i in listing['items'] if i['root_id'] == first)
    assert client.get('/api/v1/catalog/library/' + item['id'] + '/preview').status_code == 200
    assert client.post('/api/v1/catalog/roots/' + first + '/revoke', json={'confirmed': True}).status_code == 200
    assert client.get('/api/v1/catalog/library/' + item['id'] + '/preview').status_code == 404
    assert client.get('/api/v1/catalog/graph').json()['relations'] == []
    # Catalog revoke keeps the ordinary workbench grant and draft usable.
    assert archives[0][0].id in session.workspaces
    assert client.get('/api/v1/workspaces/' + archives[0][0].id + '/files').status_code == 200
    wrong = client.post('/api/v1/catalog/roots', json={'workspace_id': archives[1][0].id, 'alias': '甲', 'confirmed': True, 'root_id': first})
    assert wrong.json()['code'] == 'CATALOG_ROOT_IDENTITY_MISMATCH'
    register(client, archives[0][0], '甲', root_id=first)
    assert len(client.get('/api/v1/catalog/graph').json()['items']) == 2


def test_changed_same_length_bytes_hide_edges_and_features(catalog):
    client, _, archives = catalog
    for index, (ws, _, _) in enumerate(archives):
        register(client, ws, str(index))
    listing = client.get('/api/v1/catalog/graph').json()
    old_relation = listing['relations'][0]
    item = listing['items'][0]
    executor = next(ex for ws, ex, _ in archives if ws.id == item['workspace_id'])
    target = executor.ws.root / item['target']
    target.write_bytes(b'x' * target.stat().st_size)
    changed = client.get('/api/v1/catalog/graph').json()
    assert changed['relations'] == []
    assert next(i for i in changed['items'] if i['id'] == item['id'])['availability'] == 'changed'
    assert client.get('/api/v1/catalog/graph/relations/' + old_relation['id'] + '/evidence').status_code == 404


def test_registration_confirmation_and_catalog_mutations_inherit_guards(catalog):
    client, _, archives = catalog
    body = {'workspace_id': archives[0][0].id, 'alias': '课', 'confirmed': False}
    assert client.post('/api/v1/catalog/roots', json=body).json()['code'] == 'CONFIRMATION_REQUIRED'
    csrf = client.headers.pop('x-neatdrop-csrf')
    assert client.post('/api/v1/catalog/roots', json={**body, 'confirmed': True}).status_code == 403
    client.headers['x-neatdrop-csrf'] = csrf
    assert client.get('/api/v1/catalog', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/v1/catalog', headers={'Host': 'evil.example'}).status_code == 403
    assert client.post('/api/v1/catalog/roots', json={**body, 'path': str(archives[0][0].root)}).status_code == 422
    assert client.get('/api/v1/catalog/graph?limit=1001').status_code == 422
    assert client.get('/api/v1/catalog/graph?offset=-1').status_code == 422


def test_cross_root_manual_relations_revisions_and_removal_impact_survive_session(catalog):
    client, _, archives = catalog
    roots = [register(client, ws, str(index))['roots'][index]['id'] for index, (ws, _, _) in enumerate(archives)]
    before = {path: path.read_bytes() for ws, _, _ in archives for path in (ws.root / '.neatdrop/transactions').iterdir()
              if path.is_file() and path.suffix == '.ndj'}
    data = client.get('/api/v1/catalog/graph').json()
    source, target = [i['id'] for i in data['items']]
    body = {'source': source, 'target': target, 'kind': 'reference', 'revision': 0}
    response = client.post('/api/v1/catalog/graph/relations', json=body)
    assert response.status_code == 200, response.text
    manual = next(r for r in response.json()['relations'] if r['origin'] == 'manual')
    assert client.post('/api/v1/catalog/graph/relations', json=body).json()['code'] == 'CATALOG_REVISION_CONFLICT'
    assert all(path.read_bytes() == content for path, content in before.items())
    states = client.get('/api/v1/catalog').json()
    assert all(root['manual_relation_count'] == 1 for root in states['roots'])
    with TestClient(client.app, base_url='http://127.0.0.1', client=('127.0.0.1', 51002)) as other:
        other.headers['x-neatdrop-csrf'] = other.get('/api/session').json()['csrf']
        assert all(root['manual_relation_count'] == 1 for root in other.get('/api/v1/catalog').json()['roots'])
    delete_body = {'revision': states['revision'], 'relations_revision': 0, 'confirmed': True, 'remove_relations': True}
    assert client.request('DELETE', '/api/v1/catalog/roots/' + roots[0], json=delete_body).json()['code'] == 'CATALOG_REVISION_CONFLICT'
    delete_body['relations_revision'] = 1
    assert client.request('DELETE', '/api/v1/catalog/roots/' + roots[0], json={**delete_body, 'remove_relations': False}).json()['code'] == 'CATALOG_RELATIONS_CONFIRMATION_REQUIRED'
    removed = client.request('DELETE', '/api/v1/catalog/roots/' + roots[0], json=delete_body)
    assert removed.status_code == 200, removed.text
    assert len(removed.json()['roots']) == 1
    assert client.get('/api/v1/catalog/graph/relations/' + manual['id'] + '/evidence').status_code == 404
    assert len(client.get('/api/v1/catalog/graph').json()['items']) == 1


def test_match_verified_root_features_confirm_dismiss_and_delete(catalog):
    client, _, archives = catalog
    for index, (ws, _, _) in enumerate(archives):
        register(client, ws, str(index))
        prefix = '/api/v1/workspaces/' + ws.id + '/graph'
        identifiers = [i['id'] for i in client.get(prefix).json()['items']]
        job = client.post(prefix + '/jobs', json={'entry_ids': identifiers, 'confirmed': True}).json()
        for _ in range(150):
            result = client.get(prefix + '/jobs/' + job['id']).json()
            if result['status'] not in {'queued', 'running'}:
                break
            time.sleep(.02)
        assert result['status'] == 'completed'
    data = client.get('/api/v1/catalog/graph').json()
    assert data['index']['count'] == 2
    candidate = next(r for r in data['relations'] if r['origin'] == 'automatic')
    assert client.get('/api/v1/catalog/graph/relations/' + candidate['id'] + '/evidence').status_code == 200
    added = client.post('/api/v1/catalog/graph/relations', json={'source': candidate['source'], 'target': candidate['target'],
        'kind': 'related', 'candidate_id': candidate['id'], 'revision': 0})
    assert added.status_code == 200, added.text
    assert candidate['id'] not in {r['id'] for r in added.json()['relations']}
    manual = next(r for r in added.json()['relations'] if r['origin'] == 'manual')
    deleted = client.request('DELETE', '/api/v1/catalog/graph/relations/' + manual['id'], json={'revision': 1})
    assert deleted.status_code == 200
    assert all(r['origin'] != 'manual' for r in deleted.json()['relations'])


def test_catalog_dismissed_candidate_stays_hidden_after_refresh(catalog):
    client, _, archives = catalog
    for index, (ws, _, _) in enumerate(archives):
        register(client, ws, str(index))
        prefix = '/api/v1/workspaces/' + ws.id + '/graph'
        ids = [item['id'] for item in client.get(prefix).json()['items']]
        job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
        for _ in range(150):
            result = client.get(prefix + '/jobs/' + job['id']).json()
            if result['status'] not in {'queued', 'running'}:
                break
            time.sleep(.02)
        assert result['status'] == 'completed'
    data = client.get('/api/v1/catalog/graph').json()
    candidate = next(r for r in data['relations'] if r['origin'] == 'automatic')
    dismissed = client.post('/api/v1/catalog/graph/relations/' + candidate['id'] + '/dismiss', json={'revision': 0})
    assert dismissed.status_code == 200
    assert candidate['id'] not in {r['id'] for r in dismissed.json()['relations']}
    assert candidate['id'] not in {r['id'] for r in client.get('/api/v1/catalog/graph').json()['relations']}


def test_paging_is_deterministic_and_root_registry_limit_is_ten(catalog, tmp_path):
    client, session, archives = catalog
    for index, (ws, _, _) in enumerate(archives):
        register(client, ws, str(index))
    full = client.get('/api/v1/catalog/graph').json()
    first = client.get('/api/v1/catalog/graph?limit=1').json()
    second = client.get('/api/v1/catalog/graph?limit=1&offset=1').json()
    assert first['next_offset'] == 1 and second['next_offset'] is None
    assert first['total'] == second['total'] == 2
    assert [first['items'][0]['id'], second['items'][0]['id']] == [i['id'] for i in full['items']]
    assert first['relations'] == second['relations'] == []
    for index in range(2, 11):
        path = tmp_path / f'extra-{index}'
        path.mkdir()
        ws = Workspace(path)
        session.workspaces[ws.id] = (ws, Executor(ws, TrustStore(tmp_path / 'receipts')))
        response = client.post('/api/v1/catalog/roots', json={'workspace_id': ws.id, 'alias': str(index), 'confirmed': True})
        if index < 10:
            assert response.status_code == 200
        else:
            assert response.json()['code'] == 'CATALOG_ROOT_LIMIT'


def test_tampered_registry_cannot_redirect_current_grant_or_reauthorize(catalog):
    from neatdrop.catalog_store import CatalogStore
    client, _, archives = catalog
    root_id = register(client, archives[0][0], '甲')['roots'][0]['id']
    store = CatalogStore(client.app.state.catalog_path)
    state = store.require()
    state['roots'][0]['locator'] = str(archives[1][0].root).casefold()
    state['roots'][0]['identity'] = list(archives[1][0].identity)
    store.path.write_text(json.dumps(state), encoding='utf-8')
    assert client.get('/api/v1/catalog/graph').json()['items'] == []
    assert client.get('/api/v1/catalog').json()['roots'][0]['status'] != 'authorized'
    # Restoring registry is still insufficient; explicit Session reauthorization required.
    state['roots'][0]['locator'] = str(archives[0][0].root).casefold()
    state['roots'][0]['identity'] = list(archives[0][0].identity)
    store.path.write_text(json.dumps(state), encoding='utf-8')
    assert client.get('/api/v1/catalog/graph').json()['items'] == []
    register(client, archives[0][0], '甲', root_id=root_id)
    assert len(client.get('/api/v1/catalog/graph').json()['items']) == 1


def test_catalog_authorization_revoke_cancels_existing_graph_job(catalog, monkeypatch):
    import threading
    from neatdrop.graph import GraphService

    client, _, archives = catalog
    ws = archives[0][0]
    root_id = register(client, ws, '甲')['roots'][0]['id']
    prefix = '/api/v1/workspaces/' + ws.id + '/graph'
    ids = [item['id'] for item in client.get(prefix).json()['items']]
    entered, release = threading.Event(), threading.Event()
    original = GraphService.read

    def blocked(self, *args, **kwargs):
        if kwargs.get('local', True):
            entered.set()
            assert release.wait(5)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(GraphService, 'read', blocked)
    job = client.post(prefix + '/jobs', json={'entry_ids': ids, 'confirmed': True}).json()
    assert entered.wait(3)
    try:
        response = client.post('/api/v1/catalog/roots/' + root_id + '/revoke', json={'confirmed': True})
        assert response.status_code == 200
        assert client.get('/api/v1/catalog/graph').json()['items'] == []
        assert client.get(prefix + '/jobs/' + job['id']).json()['status'] == 'cancelled'
    finally:
        release.set()


def test_catalog_root_replacement_keeps_identity_changed_until_explicit_reauthorization(catalog, tmp_path):
    client, _, archives = catalog
    old_ws, _, _ = archives[0]
    root_id = register(client, old_ws, '甲')['roots'][0]['id']
    moved = tmp_path / 'moved-root'
    old_ws.root.rename(moved)
    old_ws.root.mkdir()
    (old_ws.root / 'private.md').write_text('must not be silently substituted', encoding='utf-8')
    listing = client.get('/api/v1/catalog').json()
    root = next(r for r in listing['roots'] if r['id'] == root_id)
    assert root['status'] == 'identity_changed'
    assert 'workspace_id' not in root
    assert client.get('/api/v1/catalog/graph').json()['items'] == []
    reopened = client.post('/api/v1/workspaces', json={'path': str(old_ws.root)})
    assert reopened.status_code == 200
    rejected = client.post('/api/v1/catalog/roots', json={'workspace_id': reopened.json()['id'], 'alias': '甲', 'confirmed': True})
    assert rejected.json()['code'] == 'CATALOG_ROOT_IDENTITY_MISMATCH'
    state = client.get('/api/v1/catalog').json()
    removed = client.request('DELETE', '/api/v1/catalog/roots/' + root_id, json={
        'revision': state['revision'], 'relations_revision': state['relations_revision'],
        'confirmed': True, 'remove_relations': True})
    assert removed.status_code == 200
    accepted = client.post('/api/v1/catalog/roots', json={'workspace_id': reopened.json()['id'], 'alias': '甲', 'confirmed': True})
    assert accepted.status_code == 200
    refreshed = client.get('/api/v1/catalog/graph').json()
    assert refreshed['items'] == []
    assert refreshed['roots'][0]['status'] == 'authorized'


def test_config_reports_scanned_pdf_status_without_enabling_it(catalog, monkeypatch):
    client, _, _ = catalog
    monkeypatch.delenv('NEATDROP_SCANNED_PDF_OCR', raising=False)
    response = client.get('/api/v1/config')
    assert response.status_code == 200
    status = response.json()['offline']['scanned_pdf']
    assert status['enabled'] is False
    assert status['name'] == '扫描 PDF OCR（最多4页）'
    assert status['max_pages'] == 4
