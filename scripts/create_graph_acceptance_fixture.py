"""Create a bounded 200-copy graph fixture through real loopback execution."""
import hashlib
import json
from pathlib import Path
import time
import httpx

ROOT = Path(__file__).resolve().parents[1]

def main():
    root = ROOT / '.cache' / ('graph-200-' + time.strftime('%Y%m%d-%H%M%S'))
    root.mkdir(parents=True)
    before = {}
    for index in range(50):
        text = f'合成课程笔记 {index}\n定义：矩阵对应线性映射。定理：矩阵秩等于独立向量个数。证明：使用初等变换。例题：求解矩阵特征值。'
        path = root / f'notes-{index:02}.md'; path.write_text(text, encoding='utf8')
        before[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    client = httpx.Client(base_url='http://127.0.0.1:8765/api', trust_env=False, timeout=30)
    client.headers['X-NeatDrop-CSRF'] = client.get('/session').json()['csrf']
    def call(path, body=None):
        response = client.get('/v1' + path) if body is None else client.post('/v1' + path, json=body)
        response.raise_for_status(); return response.json()
    workspace = call('/workspaces', {'path': str(root)})
    for batch in range(4):
        plan = call(f"/workspaces/{workspace['id']}/plans", {'edits': [{'file_id': file['id'], 'name': f"{batch}-{file['name']}", 'category': ['study', 'office', 'life', 'temporary'][batch], 'subcategory': None} for file in workspace['files']]})
        result = call(f"/workspaces/{workspace['id']}/execute", {'plan_id': plan['id'], 'digest': plan['digest'], 'confirmed': True})
        assert result['status'] == 'completed'
    graph = call(f"/workspaces/{workspace['id']}/graph")
    assert len(graph['items']) == 200
    assert all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest for name, digest in before.items())
    print(json.dumps({'synthetic': True, 'path': str(root), 'items': len(graph['items']), 'relations': len(graph['relations']), 'original_sha_unchanged': True}))

if __name__ == '__main__':
    main()
