from fastapi.testclient import TestClient

from neatdrop.app import create_app


def start_session(client):
    return {"X-NeatDrop-CSRF": client.get("/api/session").json()["csrf"]}


def test_execution_status_reads_plan_progress_without_starting_execution(tmp_path):
    (tmp_path / "notes.md").write_text("# Differential equations", encoding="utf-8")
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = start_session(client)
        workspace = client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers=headers).json()
        record = workspace["files"][0]
        base = f"/api/v1/workspaces/{workspace['id']}"
        plan = client.post(base + "/plans", json={"edits": [{
            "file_id": record["id"], "name": "lecture.md", "category": "study"
        }]}, headers=headers).json()

        response = client.get(f"{base}/executions/{plan['id']}", headers=headers)
        assert response.status_code == 200
        assert response.json() == {
            "plan_id": plan["id"], "status": "planned", "processed": 0, "total": 1,
            "current_file": None, "items": plan["items"], "error": None,
        }
        assert (tmp_path / "notes.md").exists()
        assert not (tmp_path / "02_学习科研").exists()

        missing = client.get(f"{base}/executions/{'f' * 32}", headers=headers)
        assert missing.status_code == 404


def test_execution_status_is_workspace_session_scoped(tmp_path):
    (tmp_path / "notes.md").write_text("# Notes", encoding="utf-8")
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = start_session(client)
        workspace = client.post("/api/v1/workspaces", json={"path": str(tmp_path)}, headers=headers).json()
        record = workspace["files"][0]
        base = f"/api/v1/workspaces/{workspace['id']}"
        plan = client.post(base + "/plans", json={"edits": [{
            "file_id": record["id"], "name": "lecture.md", "category": "study"
        }]}, headers=headers).json()

        with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43211)) as other:
            other_headers = start_session(other)
            response = other.get(f"{base}/executions/{plan['id']}", headers=other_headers)
        assert response.status_code == 404
