import asyncio
import io
import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from neatdrop.app import create_app
from neatdrop.files import Workspace, SafetyError, MAX_FILE
from neatdrop.journal import Journal
from neatdrop.executor import Executor


def client_for(app=None, peer='127.0.0.1'):
    return TestClient(app or create_app(), base_url='http://127.0.0.1:8765', client=(peer, 43210))


def csrf(client):
    return {'X-NeatDrop-CSRF': client.get('/api/session').json()['csrf']}


def test_remote_peer_cannot_obtain_local_session_with_forged_host():
    with client_for(peer='192.0.2.10') as client:
        response = client.get('/api/session')
        assert response.status_code == 403
        assert 'neatdrop_session' not in response.cookies


def test_request_size_rejected_before_json_parsing():
    with client_for() as client:
        headers = {**csrf(client), 'Content-Type': 'application/json'}
        response = client.post('/api/v1/workspaces', content=b' ' * (128 * 1024 + 1), headers=headers)
        assert response.status_code == 413
        assert response.json()['code'] == 'REQUEST_TOO_LARGE'


@pytest.mark.parametrize('content,content_type', [(b'{}', 'text/plain'), (b'{}', 'application/x-www-form-urlencoded')])
def test_mutations_require_json(content, content_type):
    with client_for() as client:
        response = client.post('/api/v1/workspaces', content=content, headers={**csrf(client), 'Content-Type': content_type})
        assert response.status_code == 415


def test_confirmation_is_not_coerced_from_string(tmp_path):
    with client_for() as client:
        headers = csrf(client)
        ws = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        response = client.post(f"/api/v1/workspaces/{ws['id']}/execute", json={'plan_id': 'fake', 'digest': 'fake', 'confirmed': 'yes'}, headers=headers)
        assert response.status_code == 422
        assert response.json() == {'code': 'INVALID_REQUEST'}


def test_validation_does_not_reflect_untrusted_request_data():
    with client_for() as client:
        response = client.post('/api/v1/workspaces', content=b'{secret-private-input', headers={**csrf(client), 'Content-Type': 'application/json'})
        assert response.status_code == 422
        assert response.json() == {'code': 'INVALID_REQUEST'}


@pytest.mark.parametrize('record', ['null', '42', '"text"', '[]', '{"hash":1}'])
def test_malformed_journal_records_fail_closed(record, tmp_path):
    path = tmp_path / 'journal.jsonl'
    path.write_text(record + '\n', encoding='utf-8')
    with pytest.raises(SafetyError, match='JOURNAL_CORRUPT'):
        Journal(path).read()


def test_huge_journal_rejected_before_unbounded_read(tmp_path):
    path = tmp_path / 'journal.jsonl'
    with path.open('wb') as out:
        out.truncate(3 * 1024 * 1024)
    with pytest.raises(SafetyError, match='JOURNAL'):
        Journal(path).read()


def test_scan_detects_file_growth_during_hash(tmp_path, monkeypatch):
    import neatdrop.files as files
    path = tmp_path / 'tiny.md'
    path.write_bytes(b'x')
    original = files.digest_file
    def grow(path, *args, **kwargs):
        with path.open('wb') as stream:
            stream.truncate(MAX_FILE + 1)
        return original(path, *args, **kwargs)
    monkeypatch.setattr(files, 'digest_file', grow)
    record = Workspace(tmp_path).scan()[0]
    assert record['supported'] is False


def test_model_endpoint_rejects_plain_http_before_transmitting(monkeypatch):
    from neatdrop.model import suggest
    monkeypatch.setenv('NEATDROP_API_KEY', 'fake-test-key')
    monkeypatch.setenv('NEATDROP_BASE_URL', 'http://example.org/v1')
    with pytest.raises(SafetyError, match='MODEL_ENDPOINT_INVALID'):
        asyncio.run(suggest({'text': 'test', 'sample': 'text'}))


def test_model_response_budget_is_enforced(monkeypatch):
    import neatdrop.model as model
    monkeypatch.setenv('NEATDROP_API_KEY', 'fake-test-key')
    monkeypatch.setenv('NEATDROP_BASE_URL', 'https://example.org/v1')
    real_client = httpx.AsyncClient
    def handler(request):
        return httpx.Response(200, content=b' ' * (256 * 1024 + 1))
    monkeypatch.setattr(model.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    with pytest.raises(SafetyError, match='MODEL_RESPONSE_TOO_LARGE'):
        asyncio.run(model.suggest({'text': 'test', 'sample': 'text'}))


@pytest.mark.parametrize('value', ['-2', '999999999', 'not-a-number'])
def test_invalid_model_budget_fails_safely(monkeypatch, value):
    from neatdrop.model import model_status
    monkeypatch.setenv('NEATDROP_MAX_MODEL_REQUESTS', value)
    assert 1 <= model_status()['max_requests_per_batch'] <= 50


def test_plan_cache_cannot_grow_without_bound(tmp_path):
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    executor = Executor(ws)
    for _ in range(33):
        try:
            executor.plan([{'file_id': record['id'], 'name': 'b.md', 'category': 'study'}])
        except SafetyError as exc:
            assert exc.code == 'PLAN_LIMIT'
            break
    assert len(executor.plans) <= 32


def test_preseeded_valid_hash_chain_cannot_authorize_undo(tmp_path):
    import hashlib
    from neatdrop.journal import encode, stamp
    target = tmp_path / '02_学习科研' / 'personal.md'
    target.parent.mkdir()
    target.write_bytes(b'important user file')
    identifier = 'a' * 32
    source = 'absent.md'
    item = {'file_id': hashlib.sha256(source.encode()).hexdigest()[:24], 'source': source,
            'target': '02_学习科研/personal.md', 'size': len(target.read_bytes()),
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'stage': 'planned'}
    plan = {'id': identifier, 'created': stamp(), 'mode': 'copy', 'items': [item]}
    plan['digest'] = hashlib.sha256(encode(plan).encode()).hexdigest()
    log = Journal(tmp_path / '.neatdrop' / 'transactions' / identifier / 'journal.jsonl')
    log.path.parent.mkdir(parents=True)
    log.append('planned', plan)
    log.append('item', {**item, 'stage': 'completed'})
    log.append('finished', {})
    ws = Workspace(tmp_path)
    ex = Executor(ws)
    assert ex.history()[0]['undo_verified'] is False
    with pytest.raises(SafetyError, match='UNTRUSTED_HISTORY'):
        ex.undo(identifier)
    assert target.read_bytes() == b'important user file'


def test_same_bytes_replacement_is_not_withdrawn(tmp_path):
    (tmp_path / 'notes.md').write_bytes(b'lecture notes')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    ex = Executor(ws)
    plan = ex.plan([{'file_id': file['id'], 'name': 'copy.md', 'category': 'study'}])
    result = ex.execute(plan['id'], plan['digest'], True)
    target = tmp_path / result['items'][0]['target']
    target.rename(target.with_name('old-copy.md'))
    target.write_bytes(b'lecture notes')
    undone = ex.undo(result['id'])
    assert undone['items'][0]['error'] == 'TARGET_REPLACED'
    assert target.read_bytes() == b'lecture notes'


def test_rescan_cannot_change_already_approved_job_snapshot(tmp_path):
    from neatdrop.analysis import AnalysisJobs
    path = tmp_path / 'notes.md'
    path.write_text('approved original')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    async def run():
        manager = AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        path.write_text('external changed content')
        ws.scan()
        await manager.run(job['id'], ws)
        return manager.get(job['id'])
    result = asyncio.run(run())
    assert result['results'] == []
    assert result['errors'][0]['code'] == 'SOURCE_CHANGED'


def test_history_capacity_is_rejected_before_new_copy(tmp_path):
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    ex = Executor(ws)
    plan = ex.plan([{'file_id': file['id'], 'name': 'copy.md', 'category': 'study'}])
    tx = tmp_path / '.neatdrop' / 'transactions'
    tx.mkdir(parents=True)
    for index in range(500):
        (tx / f'not-a-transaction-{index}').mkdir()
    with pytest.raises(SafetyError, match='HISTORY_LIMIT'):
        ex.execute(plan['id'], plan['digest'], True)
    assert not (tmp_path / '02_学习科研').exists()
    assert ex.history() == []


def test_repeated_ack_is_idempotent(tmp_path):
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    ex = Executor(ws)
    plan = ex.plan([{'file_id': file['id'], 'name': 'copy.md', 'category': 'study'}])
    result = ex.execute(plan['id'], plan['digest'], True)
    ex.acknowledge(result['id'])
    before = len(ex._log(result['id']).read())
    ex.acknowledge(result['id'])
    assert len(ex._log(result['id']).read()) == before


def test_enlarged_archive_is_rejected_without_full_read(tmp_path):
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    ex = Executor(ws)
    plan = ex.plan([{'file_id': file['id'], 'name': 'copy.md', 'category': 'study'}])
    result = ex.execute(plan['id'], plan['digest'], True)
    target = tmp_path / result['items'][0]['target']
    with target.open('r+b') as stream:
        stream.truncate(MAX_FILE + 1)
    undone = ex.undo(result['id'])
    assert undone['items'][0]['error'] == 'TARGET_CHANGED'
    assert target.exists()


def test_streamed_body_limit_without_content_length():
    with client_for() as client:
        headers = {**csrf(client), 'Content-Type': 'application/json'}
        response = client.post('/api/v1/workspaces', content=iter([b' ' * 70000, b' ' * 70000]), headers=headers)
        assert response.status_code == 413


def test_preprocessing_admission_is_global(tmp_path):
    from neatdrop.analysis import prepare_input, PREPROCESS_SLOTS
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(SafetyError, match='PARSER_BUSY'):
            prepare_input(ws, record)
    finally:
        PREPROCESS_SLOTS.release()
        PREPROCESS_SLOTS.release()


def test_expired_analysis_owner_stops_new_processing(tmp_path):
    import time
    from neatdrop.analysis import AnalysisJobs
    (tmp_path / 'a.md').write_text('# 课程笔记')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    async def run():
        manager = AnalysisJobs()
        job = manager.create(ws, [file['id']], 'local', False)
        manager.expires = time.monotonic() - 1
        await manager.run(job['id'], ws)
        return manager.get(job['id'])
    result = asyncio.run(run())
    assert result['status'] == 'cancelled'
    assert result['results'] == []


def test_trust_receipt_failure_leaves_recovery_state(tmp_path, monkeypatch):
    from neatdrop.trust import TrustStore
    (tmp_path / 'a.md').write_text('notes')
    ws = Workspace(tmp_path)
    file = ws.scan()[0]
    ex = Executor(ws)
    plan = ex.plan([{'file_id': file['id'], 'name': 'copy.md', 'category': 'study'}])
    def fail(*args):
        raise SafetyError('TRUST_STORE_UNAVAILABLE')
    monkeypatch.setattr(TrustStore, 'save', fail)
    with pytest.raises(SafetyError, match='TRUST_STORE_UNAVAILABLE'):
        ex.execute(plan['id'], plan['digest'], True)
    assert ex.history()[0]['status'] == 'incomplete'
    assert ex.history()[0]['undo_verified'] is False
    assert (tmp_path / 'a.md').read_text() == 'notes'


def test_non_ascii_csrf_header_is_rejected_not_server_error():
    with client_for() as client:
        csrf(client)
        response = client.post('/api/v1/workspaces', json={'path': 'unused'}, headers={b'X-NeatDrop-CSRF': b'\xe9'})
        assert response.status_code == 403


def test_model_compressed_response_is_not_decompressed_unbounded(monkeypatch):
    import gzip
    import neatdrop.model as model
    monkeypatch.setenv('NEATDROP_API_KEY', 'fake-test-key')
    monkeypatch.setenv('NEATDROP_BASE_URL', 'https://example.org/v1')
    real_client = httpx.AsyncClient
    payload = gzip.compress(b' ' * 300000)
    monkeypatch.setattr(model.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(lambda request: httpx.Response(200, headers={'Content-Encoding': 'gzip'}, content=payload))))
    with pytest.raises(SafetyError, match='MODEL_RESPONSE_ENCODING'):
        asyncio.run(model.suggest({'text': 'test', 'sample': 'text'}))


def test_chunked_receive_cannot_extend_total_deadline(monkeypatch):
    import types
    import neatdrop.security as security
    clock = [0]
    reached = []
    responses = []
    monkeypatch.setattr(security, 'time', types.SimpleNamespace(monotonic=lambda: clock[0]))
    async def inner(scope, receive, send):
        reached.append(True)
    chunks = iter([{'type': 'http.request', 'body': b' ', 'more_body': True}, {'type': 'http.request', 'body': b'{}', 'more_body': False}])
    async def receive():
        clock[0] += 20
        return next(chunks)
    async def send(event):
        responses.append(event)
    scope = {'type': 'http', 'client': ('127.0.0.1', 1), 'method': 'POST', 'path': '/api/test',
             'headers': [(b'content-type', b'application/json')]}
    asyncio.run(security.RequestGuard(inner)(scope, receive, send))
    assert not reached
    assert responses[0]['status'] == 408


def test_deep_json_is_rejected_as_invalid_request():
    with client_for() as client:
        response = client.post('/api/v1/workspaces', content=b'[' * 2000 + b'0' + b']' * 2000,
                               headers={**csrf(client), 'Content-Type': 'application/json'})
        assert response.status_code == 422
        assert response.json() == {'code': 'INVALID_REQUEST'}
