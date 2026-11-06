"""Trusted projection/store lifecycle and corruption recovery."""
import pytest
from test_graph_api_v9 import archived


def test_corrupt_store_keeps_classification_and_explicit_clear_recovers(archived):
    from neatdrop.graph import GraphService
    client, prefix, executor, _ = archived
    service = GraphService(executor)
    data = client.get(prefix).json()
    source, target = [i['id'] for i in data['items'][:2]]
    result = client.post(prefix + '/relations', json={'source': source, 'target': target, 'kind': 'reference', 'revision': 0})
    assert result.status_code == 200
    service.store.path.write_bytes(b'{broken')
    data = client.get(prefix).json()
    assert len(data['items']) == 3
    assert data['index']['state'] == 'unavailable'
    recovered = client.request('DELETE', prefix + '/index', json={'revision': data['index']['revision']})
    assert recovered.status_code == 200
    assert recovered.json()['index']['state'] == 'empty'


def test_store_rejects_hardlinked_metadata_without_touching_link_target(archived, tmp_path):
    import os
    from neatdrop.graph import GraphService
    client, prefix, executor, _ = archived
    service = GraphService(executor)
    service.store.path.parent.mkdir(parents=True, exist_ok=True)
    sentinel = tmp_path / 'private.json'
    sentinel.write_bytes(b'private')
    os.link(sentinel, service.store.path)
    assert client.get(prefix).json()['index']['state'] == 'unavailable'
    assert client.request('DELETE', prefix + '/index', json={'revision': 0}).status_code == 409
    assert sentinel.read_bytes() == b'private'


def test_manual_relations_hide_after_withdrawal(archived):
    client, prefix, executor, plan = archived
    data = client.get(prefix).json()
    source, target = [i['id'] for i in data['items'][:2]]
    assert client.post(prefix + '/relations', json={'source': source, 'target': target, 'kind': 'attachment', 'revision': 0}).status_code == 200
    assert executor.undo(plan['id'])['status'] == 'undone'
    assert client.get(prefix).json()['relations'] == []
    assert client.get(prefix).json()['index']['count'] == 0

def test_dangling_symlink_store_is_unavailable_and_cannot_clear(archived, tmp_path):
    from neatdrop.graph import GraphService
    client, prefix, executor, _ = archived
    store = GraphService(executor).store
    store.path.parent.mkdir(parents=True, exist_ok=True)
    try:
        store.path.symlink_to(tmp_path / 'missing-private.json')
    except OSError:
        pytest.skip('Creating symlinks requires local privileges')
    assert client.get(prefix).json()['index']['state'] == 'unavailable'
    assert client.request('DELETE', prefix + '/index', json={'revision': 0}).status_code == 409
    assert store.path.is_symlink()


def test_archive_hardlink_cannot_supply_graph_evidence(archived, tmp_path):
    import os
    client, prefix, executor, _ = archived
    data = client.get(prefix).json()
    relation = data['relations'][0]
    item = next(i for i in data['items'] if i['id'] == relation['source'])
    os.link(executor.ws.root / item['target'], tmp_path / 'alias.md')
    assert client.get(prefix + '/relations/' + relation['id'] + '/evidence').status_code == 409
