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

def test_full_historical_index_allows_replacement_after_withdrawal(archived):
    import copy
    from neatdrop.graph import GraphService
    from neatdrop.graph_matching import text_features
    from neatdrop.journal import stamp
    from test_graph_api_v9 import wait_job
    client, prefix, executor, plan = archived
    service = GraphService(executor)
    old_id = client.get(prefix).json()['items'][0]['id']
    _, item, identity = service.descriptor(old_id)
    feature = text_features('quantum photon polarization experiment')
    feature.update(sha256=item['sha256'], identity=identity, updated=stamp())
    historical = {f'{i:064x}': copy.deepcopy(feature) for i in range(999)}
    historical[old_id] = feature
    service.store.commit(0, lambda state: state['features'].update(historical))
    assert len(service.store.load()[0]['features']) == 1000
    assert executor.undo(plan['id'])['status'] == 'undone'
    (executor.ws.root / 'replacement.md').write_text('Forest habitat migration seasonal bird population survey', encoding='utf-8')
    record = next(r for r in executor.ws.scan() if r['name'] == 'replacement.md')
    replacement = executor.plan([{'file_id': record['id'], 'name': 'replacement.md', 'category': 'study', 'subcategory': 'notes'}])
    assert executor.execute(replacement['id'], replacement['digest'], True)['status'] == 'completed'
    new_id = client.get(prefix).json()['items'][0]['id']
    response = client.post(prefix + '/jobs', json={'entry_ids': [new_id], 'confirmed': True})
    assert response.status_code == 200
    assert wait_job(client, prefix, response.json())['status'] == 'completed'
    state, available = service.store.load()
    assert available
    assert set(state['features']) == {new_id}
    assert state['revision'] == 2


def test_graph_image_reads_skip_vision_but_keep_ocr_cancellation_and_classifier_default(archived, monkeypatch):
    from PIL import Image
    from neatdrop import offline
    from neatdrop.analysis import decode_input
    from neatdrop.graph import GraphService
    _, _, executor, _ = archived
    image_path = executor.ws.root / 'diagram.png'
    Image.new('RGB', (64, 64), 'white').save(image_path)
    record = next(r for r in executor.ws.scan() if r['name'] == 'diagram.png')
    plan = executor.plan([{'file_id': record['id'], 'name': 'diagram.png', 'category': 'study', 'subcategory': 'notes'}])
    assert executor.execute(plan['id'], plan['digest'], True)['status'] == 'completed'
    service = GraphService(executor)
    entry = next(i for i in service.listing()['items'] if i['name'] == 'diagram.png')
    calls = []
    cancelled = lambda: False
    def bounded(image, *, cancelled=None, use_ocr=True, use_vision=True):
        calls.append((use_ocr, use_vision, cancelled))
        return {'text': 'Quantum photon diagram labels', 'warnings': [], 'visual': []}
    monkeypatch.setattr(offline, 'analyze_image_bounded', bounded)
    payload = service.read(entry['id'], cancelled=cancelled)
    assert payload['text'] == 'Quantum photon diagram labels'
    assert calls == [(True, False, cancelled)]
    # The normal classification path still enables visual inference by default;
    # preview must not invoke offline OCR/vision at all.
    decode_input(image_path.read_bytes(), '.png', local=True)
    assert calls[-1] == (True, True, None)
    before = len(calls)
    assert 'image' in executor.library_preview(entry['id'])
    assert len(calls) == before
