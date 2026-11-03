import asyncio
import hashlib
import ipaddress
import json
import socket

import pytest
from fastapi.testclient import TestClient

from neatdrop.app import create_app


def session_headers(client):
    return {"X-NeatDrop-CSRF": client.get("/api/session").json()["csrf"]}


def isolate_settings(monkeypatch, tmp_path):
    from neatdrop import configuration

    monkeypatch.setattr(configuration, "STORE", configuration.SettingsStore(tmp_path / "model-config" / "settings.json"))


def test_config_query_redacts_secret_and_publishes_binding(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("NEATDROP_API_KEY", "never-return-this-secret")
    monkeypatch.setenv("NEATDROP_BASE_URL", "https://api.example.test/v1")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        result = client.get("/api/v1/model-config", headers=headers)
        assert result.status_code == 200
        body = result.json()
        assert body["endpoint"] == "https://api.example.test/v1"
        assert body["endpoint_locked"] is True
        assert body["configured"] is True
        assert isinstance(body["config_version"], str) and body["config_version"]
        assert "never-return-this-secret" not in result.text
        app_config = client.get("/api/v1/config", headers=headers).json()["model"]
        assert app_config["endpoint"] == body["endpoint"]
        assert app_config["config_version"] == body["config_version"]


def test_config_version_is_not_an_unkeyed_verifier_for_environment_keys(tmp_path, monkeypatch):
    from neatdrop import configuration

    isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("NEATDROP_API_KEY", "candidate-api-key")
    monkeypatch.setenv("NEATDROP_BASE_URL", "https://api.example.test/v1")
    for name in ("NEATDROP_TEXT_MODEL", "NEATDROP_VISION_MODEL", "NEATDROP_MAX_MODEL_REQUESTS"):
        monkeypatch.delenv(name, raising=False)

    public = configuration.public_model_config()
    legacy_material = json.dumps({
        "revision": 0,
        "endpoint": "https://api.example.test/v1",
        "text_model": configuration.DEFAULT_TEXT_MODEL,
        "vision_model": configuration.DEFAULT_VISION_MODEL,
        "budget": configuration.DEFAULT_MAX_REQUESTS,
        "key_source": "environment",
        "key_fingerprint": hashlib.sha256(b"candidate-api-key").hexdigest(),
        "bound_endpoint": None,
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")
    legacy_version = f"0-{hashlib.sha256(legacy_material).hexdigest()[:20]}"

    assert public["config_version"] != legacy_version


@pytest.mark.parametrize("address", ["224.0.0.1", "ff02::1", "255.255.255.255", "0.0.0.0", "::"])
def test_endpoint_rejects_multicast_reserved_and_unspecified_literals(address):
    from neatdrop.configuration import normalize_endpoint
    from neatdrop.files import SafetyError

    host = f"[{address}]" if ":" in address else address
    with pytest.raises(SafetyError, match="MODEL_ENDPOINT_INVALID"):
        normalize_endpoint(f"https://{host}/v1")


def test_settings_replace_keep_clear_and_endpoint_key_binding(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    for name in ("NEATDROP_API_KEY", "NEATDROP_BASE_URL", "NEATDROP_TEXT_MODEL", "NEATDROP_VISION_MODEL", "NEATDROP_MAX_MODEL_REQUESTS"):
        monkeypatch.delenv(name, raising=False)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        first = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://provider.example.test/v1",
            "text_model": "text-a",
            "vision_model": "vision-a",
            "max_requests_per_batch": 7,
            "key_action": "replace",
            "api_key": "secret-one",
        })
        assert first.status_code == 200
        assert "secret-one" not in first.text
        saved = json.loads(first.text)
        assert saved["configured"] is True
        assert saved["key_source"] == "saved"

        kept = client.post("/api/v1/model-config", headers=headers, json={"key_action": "keep"})
        assert kept.status_code == 200
        assert kept.json()["config_version"] == saved["config_version"]

        rejected = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://other.example.test/v1", "key_action": "keep"
        })
        assert rejected.status_code == 409
        assert rejected.json() == {"code": "MODEL_KEY_ENDPOINT_MISMATCH"}

        replaced = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://other.example.test/v1", "key_action": "replace", "api_key": "secret-two"
        })
        assert replaced.status_code == 200
        assert replaced.json()["configured"] is True
        assert replaced.json()["endpoint"] == "https://other.example.test/v1"

        clear = client.post("/api/v1/model-config/clear-key", headers=headers, json={"confirmed": True})
        assert clear.status_code == 200
        assert clear.json()["configured"] is False
        stored = tmp_path / "model-config" / "settings.json"
        assert b"secret-one" not in stored.read_bytes()
        assert b"secret-two" not in stored.read_bytes()
        envelope = json.loads(stored.read_bytes())
        assert envelope["format"] == "neatdrop-model-settings"
        assert envelope["version"] == 1
        assert set(envelope) == {"format", "version", "ciphertext"}


def test_environment_fields_override_and_reject_mutation(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("NEATDROP_API_KEY", "environment-secret")
    monkeypatch.setenv("NEATDROP_BASE_URL", "https://locked.example.test/v1")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        before = client.get("/api/v1/model-config", headers=headers).json()
        assert before["endpoint"] == "https://locked.example.test/v1"
        assert before["endpoint_locked"] is True
        assert before["key_source"] == "environment"
        assert "environment-secret" not in json.dumps(before)
        response = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://attacker.example.test/v1", "key_action": "clear"
        })
        assert response.status_code == 409
        assert response.json() == {"code": "MODEL_SETTING_LOCKED"}


def test_environment_key_is_not_sent_to_a_saved_custom_endpoint(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("NEATDROP_API_KEY", raising=False)
    monkeypatch.delenv("NEATDROP_BASE_URL", raising=False)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        stored = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://custom.example.test/v1", "key_action": "keep"
        })
        assert stored.status_code == 200
        monkeypatch.setenv("NEATDROP_API_KEY", "environment-secret")
        effective = client.get("/api/v1/model-config", headers=headers).json()
        assert effective["endpoint"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
        assert effective["endpoint_locked"] is True
        assert effective["configured"] is True
        assert effective["key_source"] == "environment"


def test_test_connection_requires_confirmation_fixed_sample_and_does_not_save(tmp_path, monkeypatch):
    import neatdrop.model as model
    from neatdrop import configuration

    monkeypatch.setattr(configuration, "STORE", configuration.SettingsStore(tmp_path / "model-config" / "settings.json"))
    monkeypatch.delenv("NEATDROP_API_KEY", raising=False)
    monkeypatch.delenv("NEATDROP_BASE_URL", raising=False)
    seen = []

    async def fake_test(snapshot):
        seen.append(snapshot)
        return {"ok": True}

    monkeypatch.setattr(model, "test_connection", fake_test)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        before = client.get("/api/v1/model-config", headers=headers).json()
        not_confirmed = client.post("/api/v1/model-config/test", headers=headers, json={"confirmed": False})
        assert not_confirmed.status_code == 409
        assert not_confirmed.json() == {"code": "CONFIRMATION_REQUIRED"}
        assert seen == []

        tested = client.post("/api/v1/model-config/test", headers=headers, json={
            "confirmed": True,
            "endpoint": "https://provider.example.test/v1",
            "text_model": "test-model",
            "key_action": "replace",
            "api_key": "temporary-test-key",
            "text": "must not be sent",
        })
        assert tested.status_code == 422
        valid = client.post("/api/v1/model-config/test", headers=headers, json={
            "confirmed": True,
            "endpoint": "https://provider.example.test/v1",
            "text_model": "test-model",
            "key_action": "replace",
            "api_key": "temporary-test-key",
        })
        assert valid.status_code == 200
        assert valid.json()["ok"] is True
        assert len(seen) == 1
        assert seen[0].endpoint == "https://provider.example.test/v1"
        assert seen[0].max_requests_per_batch == 1
        assert client.get("/api/v1/model-config", headers=headers).json()["config_version"] == before["config_version"]


def test_test_connection_does_not_reuse_saved_key_for_another_endpoint(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    for name in ("NEATDROP_API_KEY", "NEATDROP_BASE_URL", "NEATDROP_TEXT_MODEL", "NEATDROP_VISION_MODEL", "NEATDROP_MAX_MODEL_REQUESTS"):
        monkeypatch.delenv(name, raising=False)
    import neatdrop.model as model

    calls = []

    async def fake_test(snapshot):
        calls.append(snapshot)
        return {"ok": True}

    monkeypatch.setattr(model, "test_connection", fake_test)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        saved = client.post("/api/v1/model-config", headers=headers, json={
            "endpoint": "https://original.example.test/v1", "key_action": "replace", "api_key": "bound-key"
        })
        assert saved.status_code == 200
        response = client.post("/api/v1/model-config/test", headers=headers, json={
            "confirmed": True,
            "endpoint": "https://different.example.test/v1",
            "key_action": "keep",
        })
        assert response.status_code == 409
        assert response.json() == {"code": "MODEL_KEY_ENDPOINT_MISMATCH"}
        assert calls == []


def test_corrupt_settings_report_unconfigured_and_are_not_overwritten(tmp_path, monkeypatch):
    isolate_settings(monkeypatch, tmp_path)
    for name in ("NEATDROP_API_KEY", "NEATDROP_BASE_URL", "NEATDROP_TEXT_MODEL", "NEATDROP_VISION_MODEL", "NEATDROP_MAX_MODEL_REQUESTS"):
        monkeypatch.delenv(name, raising=False)
    stored = tmp_path / "model-config" / "settings.json"
    stored.parent.mkdir(parents=True)
    stored.write_bytes(b"not encrypted json")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765", client=("127.0.0.1", 43210)) as client:
        headers = session_headers(client)
        status = client.get("/api/v1/model-config", headers=headers)
        assert status.status_code == 200
        assert status.json()["configured"] is False
        assert status.json()["settings_error"] == "MODEL_SETTINGS_CORRUPT"
        write = client.post("/api/v1/model-config", headers=headers, json={
            "key_action": "replace", "api_key": "must-not-overwrite-corruption"
        })
        assert write.status_code == 409
        assert write.json() == {"code": "MODEL_SETTINGS_CORRUPT"}
        assert stored.read_bytes() == b"not encrypted json"


def test_decrypt_failure_becomes_unconfigured_status(tmp_path, monkeypatch):
    from neatdrop import configuration

    def fail_decrypt(_ciphertext):
        raise RuntimeError("platform crypto failure")

    stored = tmp_path / "model-config" / "settings.json"
    stored.parent.mkdir(parents=True)
    stored.write_text(json.dumps({
        "format": "neatdrop-model-settings", "version": 1, "ciphertext": "Y2lwaGVydGV4dA=="
    }), encoding="ascii")
    monkeypatch.setattr(configuration, "STORE", configuration.SettingsStore(stored, unprotect=fail_decrypt))
    for name in ("NEATDROP_API_KEY", "NEATDROP_BASE_URL", "NEATDROP_TEXT_MODEL", "NEATDROP_VISION_MODEL", "NEATDROP_MAX_MODEL_REQUESTS"):
        monkeypatch.delenv(name, raising=False)

    status = configuration.public_model_config()
    assert status["configured"] is False
    assert status["settings_error"] == "MODEL_SETTINGS_UNAVAILABLE"


def test_model_connection_test_sends_one_fixed_text_request(monkeypatch):
    import httpx
    import neatdrop.model as model
    from neatdrop.configuration import ModelConfigSnapshot

    requests = []
    real_client = httpx.AsyncClient

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(model.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handle)))
    snapshot = ModelConfigSnapshot(
        endpoint="https://provider.example.test/v1", api_key="test-key", text_model="text-model",
        vision_model="vision-model", max_requests_per_batch=1, config_version="7-opaque",
    )
    result = asyncio.run(model.test_connection(snapshot))

    assert result == {"ok": True}
    assert len(requests) == 1
    assert requests[0].headers["authorization"] == "Bearer test-key"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "text-model"
    assert payload["max_tokens"] == 24
    assert payload["messages"] == [{
        "role": "user",
        "content": "NeatDrop connection test. No user file data. Reply with a short acknowledgement.",
    }]


def test_pinned_backend_uses_only_validated_address_for_expected_origin(monkeypatch):
    import httpcore
    import neatdrop.model as model

    resolved = model.ResolvedEndpoint(
        endpoint="https://provider.example.test/v1", host="provider.example.test", port=443,
        addresses=("93.184.216.34",),
    )

    async def resolve(endpoint):
        assert endpoint == resolved.endpoint
        return resolved

    class Backend:
        def __init__(self):
            self.calls = []

        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            self.calls.append((host, port))
            return object()

        async def sleep(self, seconds):
            return None

    monkeypatch.setattr(model, "resolve_endpoint", resolve)
    backend = model._PinnedNetworkBackend(resolved.endpoint)
    fake_backend = Backend()
    backend._backend = fake_backend

    async def exercise():
        await backend.connect_tcp("provider.example.test", 443)
        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("other.example.test", 443)

    asyncio.run(exercise())
    assert fake_backend.calls == [("93.184.216.34", 443)]


def test_pinned_transport_sets_original_tls_hostname_and_rejects_other_host(monkeypatch):
    import httpx
    import neatdrop.model as model

    seen = []

    async def capture(self, request):
        seen.append((request.headers["host"], request.extensions.get("sni_hostname")))
        return httpx.Response(200)

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", capture)
    transport = model._PinnedAsyncHTTPTransport("https://provider.example.test/v1")
    request = httpx.Request("POST", "https://provider.example.test/v1/chat/completions")
    asyncio.run(transport.handle_async_request(request))
    assert seen == [("provider.example.test", b"provider.example.test")]

    wrong_host = httpx.Request("POST", "https://other.example.test/v1/chat/completions")
    with pytest.raises(httpx.ConnectError):
        asyncio.run(transport.handle_async_request(wrong_host))


def test_dns_validation_rejects_mixed_public_and_private_answers(monkeypatch):
    from neatdrop import model
    from neatdrop.files import SafetyError

    def mixed(host, port, type):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port)),
        ]

    monkeypatch.setattr(model.socket, "getaddrinfo", mixed)
    with pytest.raises(SafetyError, match="MODEL_ENDPOINT_INVALID"):
        asyncio.run(model.resolve_endpoint("https://rebinding.example.test/v1"))


@pytest.mark.parametrize("address_text", ["224.0.0.1", "ff02::1", "255.255.255.255", "0.0.0.0", "::"])
def test_dns_validation_rejects_multicast_reserved_and_unspecified_answers(monkeypatch, address_text):
    from neatdrop import model
    from neatdrop.files import SafetyError

    address = ipaddress.ip_address(address_text)

    def resolve(_host, port, type):
        family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (address.compressed, port))]

    monkeypatch.setattr(model.socket, "getaddrinfo", resolve)
    with pytest.raises(SafetyError, match="MODEL_ENDPOINT_INVALID"):
        asyncio.run(model.resolve_endpoint("https://multicast.example.test/v1"))


def test_dns_timeouts_keep_a_bounded_number_of_resolvers(monkeypatch):
    import threading
    import neatdrop.model as model
    from neatdrop.files import SafetyError

    started = threading.Event()
    release = threading.Event()

    def blocked(host, port, type):
        started.set()
        assert release.wait(2)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(model.socket, "getaddrinfo", blocked)
    original_timeout = asyncio.timeout
    monkeypatch.setattr(model.asyncio, "timeout", lambda _seconds: original_timeout(0.02))

    async def exercise():
        try:
            for _ in range(2):
                with pytest.raises(SafetyError, match="MODEL_DNS_FAILED"):
                    await model.resolve_endpoint("https://slow.example.test/v1")
            assert started.is_set()
            with pytest.raises(SafetyError, match="MODEL_DNS_BUSY"):
                await model.resolve_endpoint("https://slow.example.test/v1")
        finally:
            release.set()

    asyncio.run(exercise())


def test_analysis_binding_rejects_stale_consent_and_snapshots_progress(tmp_path, monkeypatch):
    import threading
    import neatdrop.analysis as analysis
    from neatdrop.configuration import ModelConfigSnapshot
    from neatdrop.files import Workspace, SafetyError

    (tmp_path / "a.md").write_text("# 课程笔记", encoding="utf-8")
    (tmp_path / "b.md").write_text("# 阅读笔记", encoding="utf-8")
    ws = Workspace(tmp_path)
    files = ws.scan()
    first = ModelConfigSnapshot(
        endpoint="https://provider.example.test/v1", api_key="key-one", text_model="text",
        vision_model="vision", max_requests_per_batch=10, config_version="v1",
    )
    monkeypatch.setattr(analysis, "get_model_snapshot", lambda: first)
    manager = analysis.AnalysisJobs()
    with pytest.raises(SafetyError, match="MODEL_CONFIG_CHANGED"):
        manager.create(ws, [files[0]["id"]], "cloud", True, endpoint=first.endpoint, config_version="stale")

    entered_second = threading.Event()
    release_second = threading.Event()
    calls = 0

    def prepare(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            entered_second.set()
            assert release_second.wait(5)
        return {"text": "sample", "sample": "fixed sample"}

    async def legacy_suggest(payload):
        return (type("Suggestion", (), {"title": "整理", "category": "study", "evidence": "sample", "review_required": False})(), {})

    monkeypatch.setattr(analysis, "prepare_input", prepare)
    monkeypatch.setattr(analysis, "suggest", legacy_suggest)

    async def run_and_inspect():
        identifiers = [f["id"] for f in files]
        job = manager.create(ws, identifiers, "cloud", True)
        identifiers.clear()
        task = asyncio.create_task(manager.run(job["id"], ws))
        await asyncio.wait_for(asyncio.to_thread(entered_second.wait), timeout=5)
        state = manager.get(job["id"])
        assert state["processed"] == 1
        assert len(state["results"]) == 1
        assert state["current_file_id"] == files[1]["id"]
        assert state["phase"] == "preparing"
        state["results"].clear()
        assert len(manager.get(job["id"])["results"]) == 1
        release_second.set()
        await task

    try:
        asyncio.run(run_and_inspect())
    finally:
        release_second.set()


def test_analysis_job_suggest_uses_the_immutable_bound_config_snapshot(tmp_path, monkeypatch):
    import neatdrop.analysis as analysis
    from neatdrop.configuration import ModelConfigSnapshot
    from neatdrop.files import Workspace

    (tmp_path / "a.md").write_text("# 课程笔记", encoding="utf-8")
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    approved = ModelConfigSnapshot(
        endpoint="https://approved.example.test/v1", api_key="approved-key", text_model="text-a",
        vision_model="vision-a", max_requests_per_batch=5, config_version="approved-v1",
    )
    changed = ModelConfigSnapshot(
        endpoint="https://changed.example.test/v1", api_key="changed-key", text_model="text-b",
        vision_model="vision-b", max_requests_per_batch=5, config_version="changed-v2",
    )
    monkeypatch.setattr(analysis, "get_model_snapshot", lambda: approved)
    monkeypatch.setattr(analysis, "prepare_input", lambda *args, **kwargs: {"text": "sample", "sample": "fixed"})
    received = []

    async def capture(payload, config_snapshot=None):
        received.append(config_snapshot)
        suggestion = type("Suggestion", (), {"title": "整理", "category": "study", "evidence": "sample", "review_required": False})()
        return suggestion, {}

    monkeypatch.setattr(analysis, "suggest", capture)
    manager = analysis.AnalysisJobs()
    job = manager.create(ws, [record["id"]], "cloud", True,
                         endpoint=approved.endpoint, config_version=approved.config_version)
    monkeypatch.setattr(analysis, "get_model_snapshot", lambda: changed)
    asyncio.run(manager.run(job["id"], ws))

    assert received == [approved]
    result = manager.get(job["id"])
    assert result["endpoint"] == approved.endpoint
    assert result["config_version"] == approved.config_version
    assert result["results"][0]["name"] == "整理.md"
