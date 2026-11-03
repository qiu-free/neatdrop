import json
import os
from pathlib import Path

import pytest

from neatdrop.executor import Executor
from neatdrop.files import Workspace, SafetyError, safe_name


@pytest.fixture
def setup(tmp_path):
    (tmp_path / "notes.md").write_text("# Differential equations\nlecture notes", encoding="utf-8")
    ws = Workspace(tmp_path)
    files = ws.scan()
    return ws, files[0], Executor(ws)


def make_plan(setup, name="lecture.md"):
    ws, file, ex = setup
    return ex.plan([{"file_id": file["id"], "name": name, "category": "study"}])


def test_copy_requires_confirmation_and_preserves_source(setup):
    ws, file, ex = setup
    plan = make_plan(setup)
    with pytest.raises(SafetyError, match="CONFIRM"):
        ex.execute(plan["id"], plan["digest"], False)
    result = ex.execute(plan["id"], plan["digest"], True)
    assert result["status"] == "completed"
    assert (ws.root / "notes.md").read_bytes() == (ws.root / result["items"][0]["target"]).read_bytes()
    assert ex.history()[0]["status"] == "completed"


def test_plan_digest_and_replay_are_rejected(setup):
    _, _, ex = setup
    p = make_plan(setup)
    with pytest.raises(SafetyError, match="PLAN"):
        ex.execute(p["id"], "wrong", True)
    ex.execute(p["id"], p["digest"], True)
    with pytest.raises(SafetyError, match="PLAN"):
        ex.execute(p["id"], p["digest"], True)


@pytest.mark.parametrize("name", ["../bad.md", "C:\\bad.md", "CON.md", "aux.md", "hi?.md", "x.md ", "x.exe", ".neatdrop", "..", "a/b.md"])
def test_unsafe_names_rejected(name):
    with pytest.raises(SafetyError):
        safe_name(name, ".md")


def test_scan_skips_directories_unknown_and_keeps_stable_ids(tmp_path):
    (tmp_path / "a.md").write_text("hello", encoding="utf-8")
    (tmp_path / "a.zip").write_bytes(b"zip")
    (tmp_path / "nested").mkdir()
    (tmp_path / ".neatdrop").mkdir()
    ws = Workspace(tmp_path)
    first = ws.scan()
    assert len(first) == 3
    assert next(f for f in first if f["name"] == "a.zip")["supported"] is False
    assert next(f for f in first if f["name"] == "nested")["reason"] == "DIRECTORY_SKIPPED"
    assert ws.scan()[0]["id"] == first[0]["id"]


def test_external_source_change_rejected_even_when_same_size(setup):
    ws, _, ex = setup
    p = make_plan(setup)
    src = ws.root / "notes.md"
    src.write_bytes(b"x" * src.stat().st_size)
    result = ex.execute(p["id"], p["digest"], True)
    assert result["status"] == "partial"
    assert result["items"][0]["error"] == "SOURCE_CHANGED"
    assert src.exists()


def test_target_appears_after_plan_never_overwritten(setup):
    ws, _, ex = setup
    p = make_plan(setup)
    target = ws.root / p["items"][0]["target"]
    target.parent.mkdir(parents=True)
    target.write_text("new owner", encoding="utf-8")
    r = ex.execute(p["id"], p["digest"], True)
    assert r["items"][0]["error"] == "TARGET_CONFLICT"
    assert target.read_text() == "new owner"


def test_case_equivalent_conflict_gets_new_confirmed_name(setup):
    ws, _, ex = setup
    directory = ws.root / "02_学习科研"
    directory.mkdir()
    (directory / "LECTURE.md").write_text("existing")
    p = make_plan(setup)
    assert p["items"][0]["target"].endswith("lecture (2).md")


def test_copy_failure_preserves_original_and_blocks_until_ack(setup, monkeypatch):
    from neatdrop import executor
    ws, _, ex = setup
    p = make_plan(setup)

    def fail(*args):
        raise OSError("disk full")

    monkeypatch.setattr(executor, "copy_exclusive", fail)
    r = ex.execute(p["id"], p["digest"], True)
    assert r["status"] == "partial"
    assert (ws.root / "notes.md").exists()
    with pytest.raises(SafetyError, match="RECOVERY_REQUIRED"):
        make_plan(setup)
    ex.acknowledge(r["id"])
    assert make_plan(setup)["id"]


def test_corrupt_journal_blocks_writes(setup):
    ws, _, ex = setup
    p = make_plan(setup)
    r = ex.execute(p["id"], p["digest"], True)
    log = ws.root / ".neatdrop" / "transactions" / r["id"] / "journal.jsonl"
    with log.open("a", encoding="utf-8") as out:
        out.write('{"broken":')
    assert ex.history()[0]["status"] == "corrupt"
    with pytest.raises(SafetyError, match="RECOVERY_REQUIRED"):
        make_plan(setup)


def test_root_lock_prevents_parallel_writes(setup):
    from neatdrop.safe_io import root_lock
    ws, _, ex = setup
    p = make_plan(setup)
    with root_lock(ws.root):
        with pytest.raises(SafetyError, match="DIRECTORY_BUSY"):
            ex.execute(p["id"], p["digest"], True)


@pytest.mark.skipif(os.name != "nt", reason="Windows locked-handle undo")
def test_undo_withdraws_only_unchanged_copy_and_preserves_original(setup):
    ws, _, ex = setup
    p = make_plan(setup)
    r = ex.execute(p["id"], p["digest"], True)
    target = ws.root / r["items"][0]["target"]
    undone = ex.undo(r["id"])
    assert undone["items"][0]["stage"] == "undone"
    assert not target.exists()
    assert (ws.root / "notes.md").exists()
    assert list((ws.root / ".neatdrop" / "withdrawn" / r["id"]).iterdir())


@pytest.mark.skipif(os.name != "nt", reason="Windows locked-handle undo")
def test_undo_refuses_modified_archive(setup):
    ws, _, ex = setup
    p = make_plan(setup)
    r = ex.execute(p["id"], p["digest"], True)
    target = ws.root / r["items"][0]["target"]
    target.write_text("user edited content")
    undone = ex.undo(r["id"])
    assert undone["items"][0]["error"] == "TARGET_CHANGED"
    assert target.read_text() == "user edited content"


def test_unfinished_undo_is_recovery_required(setup):
    from neatdrop.journal import Journal
    ws, file, ex = setup
    p = make_plan(setup)
    r = ex.execute(p["id"], p["digest"], True)
    log = Journal(ws.root / ".neatdrop" / "transactions" / r["id"] / "journal.jsonl")
    log.append("undo_started", {"file_id": file["id"]})
    assert ex.history()[0]["status"] == "incomplete"
    with pytest.raises(SafetyError, match="RECOVERY_REQUIRED"):
        make_plan(setup)


@pytest.mark.skipif(os.name != "nt", reason="Windows locked-handle undo")
def test_undo_blocked_by_other_incomplete_transaction(setup):
    from neatdrop.journal import Journal
    ws, _, ex = setup
    p = make_plan(setup)
    r = ex.execute(p["id"], p["digest"], True)
    log = Journal(ws.root / ".neatdrop" / "transactions" / ('a' * 32) / "journal.jsonl")
    log.path.parent.mkdir()
    log.append("planned", {**p, "id": 'a' * 32})
    with pytest.raises(SafetyError, match="RECOVERY_REQUIRED"):
        ex.undo(r["id"])


def test_journal_failure_before_copy_leaves_source_untouched(setup, monkeypatch):
    from neatdrop.journal import Journal
    ws, _, ex = setup
    plan = make_plan(setup)
    original_append = Journal.append

    def fail_before_copy(self, event, data):
        if event == 'item' and data['stage'] == 'copying':
            raise OSError('journal disk full')
        return original_append(self, event, data)

    monkeypatch.setattr(Journal, 'append', fail_before_copy)
    result = ex.execute(plan['id'], plan['digest'], True)
    assert result['status'] == 'partial'
    assert (ws.root / 'notes.md').exists()
    assert not (ws.root / plan['items'][0]['target']).exists()


@pytest.mark.skipif(os.name != 'nt', reason='Windows directory sharing semantics')
def test_executor_pins_target_parent_during_copy(setup, monkeypatch):
    from neatdrop import executor
    ws, _, ex = setup
    plan = make_plan(setup)
    original_copy = executor.copy_exclusive
    blocked = []

    def attempt_swap(source, target, expected_hash):
        try:
            target.parent.rename(target.parent.with_name('swapped-away'))
        except OSError:
            blocked.append(True)
        return original_copy(source, target, expected_hash)

    monkeypatch.setattr(executor, 'copy_exclusive', attempt_swap)
    result = ex.execute(plan['id'], plan['digest'], True)
    assert blocked == [True]
    assert result['status'] == 'completed'


def test_workspace_replacement_requires_new_grant(setup):
    ws, _, ex = setup
    plan = make_plan(setup)
    old_root = ws.root
    old_root.rename(old_root.with_name(old_root.name + '-old'))
    old_root.mkdir()
    (old_root / 'notes.md').write_text('# Differential equations\nlecture notes', encoding='utf-8')
    with pytest.raises(SafetyError, match='DIRECTORY_CHANGED'):
        ex.execute(plan['id'], plan['digest'], True)


@pytest.mark.skipif(os.name != 'nt', reason='Windows locked-handle undo')
def test_undo_log_failure_stays_incomplete(setup, monkeypatch):
    from neatdrop.journal import Journal
    _, _, ex = setup
    plan = make_plan(setup)
    result = ex.execute(plan['id'], plan['digest'], True)
    original_append = Journal.append

    def fail_undone(self, event, data):
        if event == 'item' and data.get('stage') == 'undone':
            raise OSError('journal fsync failed')
        return original_append(self, event, data)

    monkeypatch.setattr(Journal, 'append', fail_undone)
    with pytest.raises(OSError):
        ex.undo(result['id'])
    assert ex.history()[0]['status'] == 'incomplete'
    with pytest.raises(SafetyError, match='RECOVERY_REQUIRED'):
        make_plan(setup)


def test_old_ack_does_not_acknowledge_new_interruption(setup):
    from neatdrop.journal import Journal
    ws, file, ex = setup
    p = make_plan(setup)
    result = ex.execute(p['id'], p['digest'], True)
    ex.acknowledge(result['id'])
    log = Journal(ws.root / '.neatdrop' / 'transactions' / result['id'] / 'journal.jsonl')
    log.append('undo_started', {'file_id': file['id']})
    assert ex.history()[0]['acknowledged'] is False


def test_journal_hardlink_to_original_is_rejected(setup):
    from neatdrop.journal import Journal
    ws, _, _ = setup
    source = ws.root / 'notes.md'
    original = source.read_bytes()
    metadata = ws.root / 'journal.jsonl'
    os.link(source, metadata)
    with pytest.raises(SafetyError):
        Journal(metadata).append('planned', {})
    assert source.read_bytes() == original


def test_unicode_line_separator_filename_roundtrips_in_journal(tmp_path):
    source = tmp_path / 'note\u2028.md'
    source.write_text('# Course notes', encoding='utf-8')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    ex = Executor(ws)
    p = ex.plan([{'file_id': record['id'], 'name': 'lecture.md', 'category': 'study'}])
    result = ex.execute(p['id'], p['digest'], True)
    assert result['status'] == 'completed'
    assert source.exists()


@pytest.mark.skipif(os.name != 'nt', reason='Windows file execution')
def test_nested_subcategory_copy_and_undo(setup):
    ws, file, ex = setup
    plan = ex.plan([{'file_id': file['id'], 'name': 'lecture.md', 'category': 'study', 'subcategory': 'notes'}])
    assert plan['items'][0]['target'] == '02_学习科研/课程笔记/lecture.md'
    result = ex.execute(plan['id'], plan['digest'], True)
    assert result['status'] == 'completed'
    undone = ex.undo(result['id'])
    assert undone['status'] == 'undone'
    assert (ws.root / 'notes.md').exists()
