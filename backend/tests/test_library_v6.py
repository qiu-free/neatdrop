"""Archive library reads require both a valid journal and installation receipt."""
import hashlib
import pytest
from fastapi.testclient import TestClient

from neatdrop.app import create_app
from neatdrop.executor import Executor
from neatdrop.files import MAX_FILE, SafetyError, Workspace
from neatdrop.journal import Journal, encode
from neatdrop.trust import TrustStore


@pytest.fixture
def archive(tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    (root / 'notes.md').write_bytes(b'# Course notes\nDifferential equations')
    ws = Workspace(root)
    record = ws.scan()[0]
    trust = TrustStore(tmp_path / 'receipts')
    executor = Executor(ws, trust)
    plan = executor.plan([{'file_id': record['id'], 'name': 'lecture.md',
                          'category': 'study', 'subcategory': 'notes'}])
    result = executor.execute(plan['id'], plan['digest'], True)
    assert result['status'] == 'completed'
    return ws, executor, plan, root / plan['items'][0]['target']


def first_entry(executor):
    return executor.library()['items'][0]


def test_library_exposes_relative_metadata_and_safe_preview_after_reopening(archive):
    ws, executor, plan, target = archive
    entry = first_entry(executor)
    assert entry == {
        'id': entry['id'], 'transaction_id': plan['id'], 'name': 'lecture.md',
        'source': 'notes.md', 'target': '02_学习科研/课程笔记/lecture.md',
        'category': 'study', 'subcategory': 'notes', 'created': plan['created'],
        'size': 37, 'availability': 'available',
    }
    assert len(entry['id']) == 64
    assert executor.library()['truncated'] is False
    reopened = Executor(Workspace(ws.root), TrustStore(executor.trust.path))
    assert first_entry(reopened) == entry
    assert reopened.library_preview(entry['id']) == {
        'text': '# Course notes\nDifferential equations',
        'sample': 'First 1500 characters', 'truncated': False,
    }
    assert (ws.root / 'notes.md').read_bytes() == target.read_bytes()


def test_library_empty_workspace_is_not_a_recursive_file_browser(tmp_path):
    (tmp_path / '02_学习科研').mkdir()
    (tmp_path / '02_学习科研' / 'personal.md').write_text('private')
    assert Executor(Workspace(tmp_path), TrustStore(tmp_path.parent / 'receipts')).library() == {
        'items': [], 'truncated': False,
    }


def test_library_listing_does_not_hash_archive_contents(archive, monkeypatch):
    import neatdrop.files as files
    import neatdrop.analysis as analysis
    _, executor, _, _ = archive
    def forbidden(*args, **kwargs):
        pytest.fail('Library listing read file contents')
    monkeypatch.setattr(files, 'digest_file', forbidden)
    monkeypatch.setattr(analysis, 'locked_reader', forbidden)
    assert first_entry(executor)['availability'] == 'available'


def test_library_unverified_log_never_stats_its_target(archive, monkeypatch):
    from pathlib import Path
    _, executor, plan, target = archive
    executor.trust._path(plan['id']).unlink()
    original_stat, original_lstat = Path.stat, Path.lstat
    def guarded_stat(path, *args, **kwargs):
        if path == target:
            pytest.fail('An unverified log touched its target')
        return original_stat(path, *args, **kwargs)
    def guarded_lstat(path, *args, **kwargs):
        if path == target:
            pytest.fail('An unverified log touched its target')
        return original_lstat(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'stat', guarded_stat)
    monkeypatch.setattr(Path, 'lstat', guarded_lstat)
    entry = first_entry(executor)
    assert entry['availability'] == 'unverified'
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_UNVERIFIED'):
        executor.library_preview(entry['id'])


@pytest.mark.parametrize('alteration', ['missing', 'size', 'same_size', 'replacement', 'directory', 'oversized'])
def test_library_refuses_missing_modified_and_replaced_targets(archive, alteration):
    _, executor, _, target = archive
    entry = first_entry(executor)
    if alteration == 'missing':
        target.unlink()
    elif alteration == 'size':
        target.write_bytes(b'changed size')
    elif alteration == 'same_size':
        target.write_bytes(b'x' * target.stat().st_size)
    elif alteration == 'replacement':
        content = target.read_bytes()
        target.rename(target.with_name('previous.md'))
        target.write_bytes(content)
    elif alteration == 'directory':
        target.unlink()
        target.mkdir()
    else:
        with target.open('r+b') as stream:
            stream.truncate(MAX_FILE + 1)
    # Same-size edits are detected only by the preview's mandatory hash check.
    expected = 'missing' if alteration == 'missing' else 'available' if alteration == 'same_size' else 'changed'
    assert first_entry(executor)['availability'] == expected
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_MISSING' if alteration == 'missing' else 'LIBRARY_ENTRY_CHANGED'):
        executor.library_preview(entry['id'])


def test_library_link_is_never_previewed(archive):
    ws, executor, _, target = archive
    entry = first_entry(executor)
    target.unlink()
    try:
        target.symlink_to(ws.root / 'notes.md')
    except OSError:
        pytest.skip('Creating symlinks requires local privileges')
    assert first_entry(executor)['availability'] == 'changed'
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_CHANGED'):
        executor.library_preview(entry['id'])


def test_library_same_bytes_swapped_at_open_is_rejected_before_read(archive, monkeypatch):
    import neatdrop.analysis as analysis
    from contextlib import contextmanager
    from neatdrop.safe_io import locked_reader
    _, executor, _, target = archive
    entry = first_entry(executor)
    replacement = target.with_name('replacement.md')
    replacement.write_bytes(target.read_bytes())
    @contextmanager
    def swap_at_open(path, *args, **kwargs):
        target.rename(target.with_name('old.md'))
        replacement.rename(target)
        with locked_reader(path, *args, **kwargs) as stream:
            yield stream
    monkeypatch.setattr(analysis, 'locked_reader', swap_at_open)
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_CHANGED'):
        executor.library_preview(entry['id'])


def test_library_receipt_is_required_even_for_valid_forged_log(archive):
    ws, executor, plan, target = archive
    entry = first_entry(executor)
    executor.trust._path(plan['id']).unlink()
    assert first_entry(executor)['availability'] == 'unverified'
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_UNVERIFIED'):
        executor.library_preview(entry['id'])
    assert target.read_bytes() == (ws.root / 'notes.md').read_bytes()


def test_library_receipt_requires_exact_plan_match(archive):
    ws, executor, plan, _ = archive
    log_path = ws.root / '.neatdrop' / 'transactions' / plan['id'] / 'journal.jsonl'
    log_path.unlink()
    forged = {**plan, 'created': '2030-01-01T00:00:00+00:00'}
    forged['digest'] = hashlib.sha256(encode({k: v for k, v in forged.items() if k != 'digest'}).encode()).hexdigest()
    log = Journal(log_path)
    log.append('planned', forged)
    log.append('item', {**forged['items'][0], 'stage': 'completed'})
    log.append('finished', {})
    entry = first_entry(executor)
    assert entry['availability'] == 'unverified'
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_UNVERIFIED'):
        executor.library_preview(entry['id'])


def test_library_corrupt_and_unsafe_logs_do_not_expose_paths(archive):
    ws, executor, plan, _ = archive
    log_path = ws.root / '.neatdrop' / 'transactions' / plan['id'] / 'journal.jsonl'
    log_path.unlink()
    forged = {**plan, 'items': [{**plan['items'][0], 'target': '../../secret.md'}]}
    forged['digest'] = hashlib.sha256(encode({k: v for k, v in forged.items() if k != 'digest'}).encode()).hexdigest()
    Journal(log_path).append('planned', forged)
    assert executor.library() == {'items': [], 'truncated': False}


def test_library_receipt_without_copy_identity_is_unverified(archive):
    ws, executor, plan, _ = archive
    executor.trust._path(plan['id']).unlink()
    executor.trust.save(ws, plan, {})
    entry = first_entry(executor)
    assert entry['availability'] == 'unverified'
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_UNVERIFIED'):
        executor.library_preview(entry['id'])


def test_library_undone_and_pending_withdrawal_are_not_previewed(archive):
    _, executor, plan, _ = archive
    entry = first_entry(executor)
    log = executor._log(plan['id'])
    log.append('undo_started', {'file_id': plan['items'][0]['file_id']})
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_'):
        executor.library_preview(entry['id'])
    log.append('item', {**plan['items'][0], 'stage': 'undone'})
    assert executor.library()['items'] == []
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_NOT_FOUND'):
        executor.library_preview(entry['id'])


def test_library_forged_completed_event_cannot_revive_withdrawn_entry(archive):
    _, executor, plan, _ = archive
    entry = first_entry(executor)
    assert executor.undo(plan['id'])['status'] == 'undone'
    executor._log(plan['id']).append('item', {**plan['items'][0], 'stage': 'completed'})
    assert executor.library()['items'] == []
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_NOT_FOUND'):
        executor.library_preview(entry['id'])


def test_library_preview_obeys_shared_parser_admission_limit(archive):
    from neatdrop.analysis import PREPROCESS_SLOTS
    _, executor, _, _ = archive
    entry = first_entry(executor)
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(SafetyError, match='PARSER_BUSY'):
            executor.library_preview(entry['id'])
    finally:
        PREPROCESS_SLOTS.release()
        PREPROCESS_SLOTS.release()


def test_library_parent_directory_stays_pinned_during_preview_read(archive, monkeypatch):
    import neatdrop.analysis as analysis
    from contextlib import contextmanager
    from neatdrop.safe_io import locked_reader
    _, executor, _, target = archive
    entry = first_entry(executor)
    blocked = []
    @contextmanager
    def inspect_parent(path, *args, **kwargs):
        try:
            target.parent.rename(target.parent.with_name('swapped-away'))
        except OSError:
            blocked.append(True)
        with locked_reader(path, *args, **kwargs) as stream:
            yield stream
    monkeypatch.setattr(analysis, 'locked_reader', inspect_parent)
    assert executor.library_preview(entry['id'])['text'].startswith('# Course notes')
    assert blocked == [True]


def test_library_unknown_id_and_root_replacement_fail_closed(archive):
    ws, executor, _, _ = archive
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_NOT_FOUND'):
        executor.library_preview('f' * 64)
    with pytest.raises(SafetyError, match='LIBRARY_ENTRY_NOT_FOUND'):
        executor.library_preview('../../notes.md')
    ws.root.rename(ws.root.with_name('old-workspace'))
    ws.root.mkdir()
    with pytest.raises(SafetyError, match='DIRECTORY_CHANGED'):
        executor.library()


def test_library_real_undo_removes_only_copy_from_listing(archive):
    ws, executor, plan, _ = archive
    before = hashlib.sha256((ws.root / 'notes.md').read_bytes()).hexdigest()
    assert executor.undo(plan['id'])['status'] == 'undone'
    assert executor.library() == {'items': [], 'truncated': False}
    assert hashlib.sha256((ws.root / 'notes.md').read_bytes()).hexdigest() == before


def test_library_is_newest_first_and_caps_results_at_1000(tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    ws = Workspace(root)
    executor = Executor(ws, TrustStore(tmp_path / 'receipts'))
    # Valid on-disk journals and receipts exercise the bound without 1001 copies.
    for number in range(21):
        items = []
        for index in range(50 if number < 20 else 1):
            source = f'source-{index}.md'
            items.append({'file_id': hashlib.sha256(source.encode()).hexdigest()[:24],
                          'source': source, 'target': f'02_学习科研/copy-{number}-{index}.md',
                          'sha256': hashlib.sha256(b'x').hexdigest(), 'size': 1, 'stage': 'planned'})
        plan = {'id': f'{number:032x}', 'created': f'2026-11-{number + 1:02}T00:00:00+00:00',
                'mode': 'copy', 'items': items}
        plan['digest'] = hashlib.sha256(encode(plan).encode()).hexdigest()
        previous = '0' * 64
        rows = []
        events = [('planned', plan), *[('item', {**item, 'stage': 'completed'}) for item in items], ('finished', {})]
        for seq, (event, data) in enumerate(events, 1):
            row = {'seq': seq, 'previous': previous, 'time': plan['created'], 'event': event, 'data': data}
            row['hash'] = hashlib.sha256(encode(row).encode()).hexdigest()
            previous = row['hash']
            rows.append(encode(row))
        path = root / '.neatdrop' / 'transactions' / plan['id'] / 'journal.jsonl'
        path.parent.mkdir(parents=True)
        path.write_text('\n'.join(rows) + '\n', encoding='utf-8')
        executor.trust.save(ws, plan, {item['file_id']: {'device': 1, 'inode': index + 1}
                                     for index, item in enumerate(items)})
    result = executor.library()
    assert len(result['items']) == 1000
    assert result['truncated'] is True
    assert result['items'][0]['target'] == '02_学习科研/copy-20-0.md'
    assert result['items'][-1]['created'] == '2026-11-01T00:00:00+00:00'


@pytest.mark.parametrize('name,content,code', [
    ('bad.txt', b'\xff\xfe', 'INVALID_UTF8'),
    ('bad.md', b'text\x00binary', 'BINARY_TEXT'),
    ('bad.png', b'not an image', 'IMAGE_DECODE_FAILED'),
])
def test_library_uses_existing_safe_preview_decoders(tmp_path, name, content, code):
    root = tmp_path / 'workspace'
    root.mkdir()
    (root / name).write_bytes(content)
    ws = Workspace(root)
    record = ws.scan()[0]
    executor = Executor(ws, TrustStore(tmp_path / 'receipts'))
    plan = executor.plan([{'file_id': record['id'], 'name': name, 'category': 'other'}])
    executor.execute(plan['id'], plan['digest'], True)
    with pytest.raises(SafetyError, match=code):
        executor.library_preview(first_entry(executor)['id'])


def test_library_api_is_session_bound_and_has_no_client_path_input(tmp_path, monkeypatch):
    import neatdrop.executor as executor_module
    trust = TrustStore(tmp_path / 'receipts')
    monkeypatch.setattr(executor_module, 'TrustStore', lambda: trust)
    root = tmp_path / 'workspace'
    root.mkdir()
    (root / 'notes.md').write_text('library content', encoding='utf-8')
    app = create_app()
    with TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        headers = {'X-NeatDrop-CSRF': client.get('/api/session').json()['csrf']}
        workspace = client.post('/api/v1/workspaces', json={'path': str(root)}, headers=headers).json()
        prefix = f"/api/v1/workspaces/{workspace['id']}"
        plan = client.post(prefix + '/plans', json={'edits': [{'file_id': workspace['files'][0]['id'],
                           'name': 'copy.md', 'category': 'study'}]}, headers=headers).json()
        assert client.post(prefix + '/execute', json={'plan_id': plan['id'], 'digest': plan['digest'],
                           'confirmed': True}, headers=headers).status_code == 200
        response = client.get(prefix + '/library')
        assert response.status_code == 200
        entry = response.json()['items'][0]
        assert entry['subcategory'] is None
        assert client.get(prefix + f"/library/{entry['id']}/preview", params={'path': '../secret.md'}).json()['text'] == 'library content'
        assert client.get(prefix + '/library/' + 'f' * 64 + '/preview').status_code == 404
        with TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43211)) as other:
            other.get('/api/session')
            assert other.get(prefix + '/library').status_code == 404
            assert other.get(prefix + f"/library/{entry['id']}/preview").status_code == 404
