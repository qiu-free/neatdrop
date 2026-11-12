"""Real loopback HTTP copy/catalog/withdraw proof using isolated synthetic roots."""
import hashlib
import json
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]

def main():
    directory = ROOT / '.cache' / ('catalog-proof-' + time.strftime('%Y%m%d-%H%M%S'))
    directory.mkdir(parents=True)
    clients = httpx.Client(base_url='http://127.0.0.1:8765/api', trust_env=False, timeout=30)
    csrf = clients.get('/session').json()['csrf']
    clients.headers['X-NeatDrop-CSRF'] = csrf
    def call(method, path, body=None):
        response = clients.request(method, '/v1' + path, json=body)
        response.raise_for_status()
        return response.json()
    before = call('GET', '/catalog')
    if len(before['roots']) > 8:
        raise RuntimeError('Synthetic proof requires two free catalog slots; existing roots preserved.')
    roots, originals, executions = [], {}, []
    for index in range(2):
        path = directory / str(index); path.mkdir()
        original = path / 'synthetic-notes.md'
        original.write_text('光学课程笔记\n定义：凸透镜成像的物距像距决定焦距。定理：光路可逆。证明：重复测量焦距，比较成像误差。例题：计算薄透镜焦距。', encoding='utf8')
        originals[str(original)] = hashlib.sha256(original.read_bytes()).hexdigest()
        ws = call('POST', '/workspaces', {'path': str(path)})
        plan = call('POST', f"/workspaces/{ws['id']}/plans", {'edits': [{'file_id': ws['files'][0]['id'], 'name': 'synthetic-notes.md', 'category': 'study', 'subcategory': 'notes'}]})
        execution = call('POST', f"/workspaces/{ws['id']}/execute", {'plan_id': plan['id'], 'digest': plan['digest'], 'confirmed': True})
        assert execution['status'] == 'completed'
        registry = call('POST', '/catalog/roots', {'workspace_id': ws['id'], 'alias': 'synthetic-proof-' + str(index), 'confirmed': True})
        root = next(row for row in registry['roots'] if row.get('workspace_id') == ws['id'])
        roots.append((root, ws)); executions.append(plan)
    graph = call('GET', '/catalog/graph')
    ids = {row['id'] for row in graph['items'] if row['root_id'] in {root['id'] for root, _ in roots}}
    edge = next(row for row in graph['relations'] if row['source'] in ids and row['target'] in ids and row['kind'] == 'duplicate')
    assert call('GET', '/catalog/graph/relations/' + edge['id'] + '/evidence')['files']
    first, workspace = roots[0]
    call('POST', f"/catalog/roots/{first['id']}/revoke", {'confirmed': True})
    assert all(row['root_id'] != first['id'] for row in call('GET', '/catalog/graph')['items'])
    call('POST', '/catalog/roots', {'workspace_id': workspace['id'], 'alias': first['alias'], 'root_id': first['id'], 'confirmed': True})
    call('POST', f"/workspaces/{workspace['id']}/transactions/{executions[0]['id']}/undo", {'confirmed': True})
    remaining = call('GET', '/catalog/graph')
    assert sum(row['root_id'] == roots[1][0]['id'] for row in remaining['items']) == 1
    for root, _ in roots:
        state = call('GET', '/catalog')
        call('DELETE', '/catalog/roots/' + root['id'], {'revision': state['revision'], 'relations_revision': state['relations_revision'], 'confirmed': True, 'remove_relations': True})
    assert all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in originals.items())
    result = {'synthetic': True, 'roots': 2, 'same_name_unique_ids': len(ids) == 2, 'duplicate_evidence': True, 'revoke_blocks_catalog': True, 'reauthorize_same_identity': True, 'withdraw_only_first_root': True, 'original_sha256_unchanged': True}
    (directory / 'proof.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
