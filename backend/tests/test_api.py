import time

from fastapi.testclient import TestClient

from neatdrop.app import create_app


def session(client):
    response = client.get("/api/session")
    assert response.status_code == 200
    return {"X-NeatDrop-CSRF": response.json()["csrf"]}


def test_csrf_and_origin_and_host_are_guarded(tmp_path):
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=('127.0.0.1', 43210)) as client:
        assert client.post("/api/v1/workspaces", json={"path": str(tmp_path)}).status_code == 403
        headers = session(client)
        assert client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers={**headers, "Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/v1/health", headers={"Host": "evil.example"}).status_code == 403
        assert client.get("/api/v1/health").json()["status"] == "ok"


def test_workspace_isolation_and_complete_api_copy(tmp_path):
    (tmp_path / "a.md").write_text("# 课程笔记", encoding="utf-8")
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8765", client=('127.0.0.1', 43210)) as client:
        headers = session(client)
        scan = client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers=headers)
        assert scan.status_code == 200
        ws = scan.json()
        file = ws["files"][0]
        prefix = f"/api/v1/workspaces/{ws['id']}"
        with TestClient(app, base_url="http://127.0.0.1:8765", client=('127.0.0.1', 43211)) as other:
            session(other)
            assert other.get(prefix + "/transactions").status_code == 404
        plan = client.post(prefix + "/plans", json={"edits": [{"file_id": file["id"], "name": "课程.md", "category": "study"}]}, headers=headers).json()
        assert client.post(prefix + "/execute", json={"plan_id": plan["id"], "digest": plan["digest"], "confirmed": False}, headers=headers).status_code == 409
        result = client.post(prefix + "/execute", json={"plan_id": plan["id"], "digest": plan["digest"], "confirmed": True}, headers=headers)
        assert result.status_code == 200
        assert result.json()["status"] == "completed"
        assert (tmp_path / "a.md").exists()
        assert len(client.get(prefix + "/transactions").json()) == 1


def test_job_failure_is_per_file_and_session_bound(tmp_path):
    (tmp_path / "bad.png").write_bytes(b"not a png")
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8765", client=('127.0.0.1', 43210)) as client:
        headers = session(client)
        ws = client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers=headers).json()
        job = client.post("/api/v1/analysis-jobs", json={"workspace_id": ws["id"], "file_ids": [ws["files"][0]["id"]], "mode": "local", "cloud_consent": False}, headers=headers).json()
        for _ in range(100):
            state = client.get(f"/api/v1/analysis-jobs/{job['id']}").json()
            if state["status"] in {"completed", "cancelled"}:
                break
            time.sleep(.02)
        assert state["errors"][0]["code"] == "IMAGE_DECODE_FAILED"
        assert state["errors"][0]["file_id"] == ws["files"][0]["id"]
        with TestClient(app, base_url="http://127.0.0.1:8765", client=('127.0.0.1', 43211)) as other:
            session(other)
            assert other.get(f"/api/v1/analysis-jobs/{job['id']}").status_code == 404
