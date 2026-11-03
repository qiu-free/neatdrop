from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from neatdrop.executor import Executor
from neatdrop.files import SafetyError, Workspace


def planned(tmp_path, count=2):
    for index in range(count):
        (tmp_path / f"source-{index}.md").write_text(f"# 课程笔记 {index}", encoding="utf-8")
    workspace = Workspace(tmp_path)
    records = workspace.scan()
    executor = Executor(workspace)
    plan = executor.plan([{"file_id": item["id"], "name": item["name"], "category": "study"} for item in records])
    return workspace, executor, plan


def test_progress_is_read_only_and_has_actual_completed_items(tmp_path, monkeypatch):
    import neatdrop.executor as module
    workspace, executor, plan = planned(tmp_path)
    entered, release = Event(), Event()
    original = module.copy_exclusive

    def blocked_copy(*args):
        entered.set()
        assert release.wait(5)
        return original(*args)

    monkeypatch.setattr(module, "copy_exclusive", blocked_copy)
    before = executor.execution_status(plan["id"])
    assert before["status"] == "planned"
    assert before["processed"] == 0
    with ThreadPoolExecutor() as pool:
        future = pool.submit(executor.execute, plan["id"], plan["digest"], True)
        try:
            assert entered.wait(5)
            snapshot = executor.execution_status(plan["id"])
            assert snapshot["status"] == "running"
            assert snapshot["current_file"] == "source-0.md"
            assert snapshot["processed"] == 0
            assert snapshot["items"][0]["stage"] == "copying"
            snapshot["items"][0]["stage"] = "completed"
            assert executor.execution_status(plan["id"])["items"][0]["stage"] == "copying"
            with pytest.raises(SafetyError):
                executor.execute(plan["id"], plan["digest"], True)
            assert executor.execution_status(plan["id"])["status"] == "running"
        finally:
            release.set()
        result = future.result(timeout=5)
    final = executor.execution_status(plan["id"])
    assert final["status"] == "completed"
    assert final["processed"] == final["total"] == 2
    assert final["transaction"] == result
    assert all((workspace.root / item["source"]).exists() for item in final["items"])


def test_progress_distinguishes_failure_from_not_executed(tmp_path, monkeypatch):
    import neatdrop.executor as module
    workspace, executor, plan = planned(tmp_path)

    def full_disk(*args):
        raise OSError("disk full")

    monkeypatch.setattr(module, "copy_exclusive", full_disk)
    result = executor.execute(plan["id"], plan["digest"], True)
    snapshot = executor.execution_status(plan["id"])
    assert snapshot["status"] == "partial"
    assert snapshot["processed"] == 1
    assert [item["stage"] for item in snapshot["items"]] == ["failed", "planned"]
    assert snapshot["transaction"] == result
    assert all((workspace.root / item["source"]).exists() for item in snapshot["items"])


def test_interrupted_journal_progress_never_claims_success(tmp_path, monkeypatch):
    from neatdrop.journal import Journal
    workspace, executor, plan = planned(tmp_path, 1)
    append = Journal.append

    def fail_final(self, event, data):
        if event == "finished":
            raise OSError("journal unavailable")
        return append(self, event, data)

    monkeypatch.setattr(Journal, "append", fail_final)
    with pytest.raises(OSError):
        executor.execute(plan["id"], plan["digest"], True)
    snapshot = executor.execution_status(plan["id"])
    assert snapshot["status"] == "interrupted"
    assert snapshot["error"] == "LOCAL_IO_FAILED"
    assert "transaction" not in snapshot
    assert executor.history()[0]["status"] == "incomplete"
    assert (workspace.root / "source-0.md").exists()


def test_unknown_execution_is_not_reconstructed_or_replayed(tmp_path):
    _, executor, plan = planned(tmp_path)
    with pytest.raises(SafetyError, match="EXECUTION_STATUS_NOT_FOUND"):
        executor.execution_status("a" * 32)
    restarted = Executor(executor.ws)
    with pytest.raises(SafetyError, match="EXECUTION_STATUS_NOT_FOUND"):
        restarted.execution_status(plan["id"])


def test_execution_api_status_is_session_scoped_and_replay_stays_rejected(tmp_path):
    from fastapi.testclient import TestClient
    from neatdrop.app import create_app
    (tmp_path / "course.md").write_text("# 课程笔记", encoding="utf-8")
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        csrf = {"X-NeatDrop-CSRF": client.get("/api/session").json()["csrf"]}
        ws = client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers=csrf).json()
        prefix = f"/api/v1/workspaces/{ws['id']}"
        plan = client.post(prefix + "/plans", json={"edits": [{"file_id": ws['files'][0]['id'], "name": "course.md", "category": "study"}]}, headers=csrf).json()
        url = prefix + "/executions/" + plan['id']
        assert client.get(url).json()["status"] == "planned"
        with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43211)) as other:
            other.get("/api/session")
            assert other.get(url).status_code == 404
        body = {"plan_id": plan['id'], "digest": plan['digest'], "confirmed": True}
        result = client.post(prefix + "/execute", json=body, headers=csrf)
        assert result.status_code == 200
        assert client.get(url).json()["transaction"] == result.json()
        assert client.post(prefix + "/execute", json=body, headers=csrf).status_code == 409
        assert len(client.get(prefix + "/transactions").json()) == 1


def test_status_does_not_disappear_when_execution_claims_plan(tmp_path, monkeypatch):
    _, executor, plan = planned(tmp_path, 1)
    publishing, allow_publish, read_started = Event(), Event(), Event()
    original = executor._progress_start

    def delayed_publish(value):
        publishing.set()
        assert allow_publish.wait(5)
        return original(value)

    def read_status():
        read_started.set()
        return executor.execution_status(plan['id'])

    monkeypatch.setattr(executor, '_progress_start', delayed_publish)
    with ThreadPoolExecutor(max_workers=2) as pool:
        write = pool.submit(executor.execute, plan['id'], plan['digest'], True)
        try:
            assert publishing.wait(5)
            read = pool.submit(read_status)
            assert read_started.wait(5)
        finally:
            allow_publish.set()
        snapshot = read.result(timeout=5)
        assert snapshot['status'] in {'running', 'completed'}
        assert write.result(timeout=5)['status'] == 'completed'
