import asyncio
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from .analysis import prepare_input
from .executor import Executor
from .files import CATEGORIES, SafetyError, Workspace
from .model import model_status
from .security import LocalSecurity, RequestGuard, Session, current
from .taxonomy import taxonomy_config, FORMS
from .offline import offline_status
from .configuration import public_model_config, test_model_snapshot, update_model_config
from . import model as model_api

PROJECT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT / ".env")


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Directory(Body):
    path: str = Field(min_length=1, max_length=1024)


class Edit(Body):
    file_id: str = Field(max_length=64)
    name: str = Field(max_length=150)
    category: Literal["finance", "study", "activity", "social", "temporary", "other", "office", "life", "photos"]
    subcategory: str | None = Field(default=None, max_length=40)


class PlanBody(Body):
    edits: list[Edit] = Field(min_length=1, max_length=50)


class ExecuteBody(Body):
    plan_id: str = Field(max_length=64)
    digest: str = Field(max_length=64)
    confirmed: bool = False


class JobBody(Body):
    workspace_id: str = Field(max_length=64)
    file_ids: list[str] = Field(min_length=1, max_length=50)
    mode: Literal["local", "cloud"] = "local"
    cloud_consent: bool = False
    endpoint: str | None = Field(default=None, max_length=2048)
    config_version: str | None = Field(default=None, max_length=80)


class ModelConfigBody(Body):
    endpoint: str | None = Field(default=None, max_length=2048)
    text_model: str | None = Field(default=None, max_length=128)
    vision_model: str | None = Field(default=None, max_length=128)
    max_requests_per_batch: int | None = Field(default=None, ge=1, le=50)
    key_action: Literal["keep", "replace", "clear"] = "keep"
    api_key: str | None = Field(default=None, max_length=4096)


class ModelConfigTestBody(ModelConfigBody):
    confirmed: bool = False


class Confirmation(Body):
    confirmed: bool = False


def create_app():
    tasks = set()

    @asynccontextmanager
    async def lifespan(app):
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="NeatDrop local MVP", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.sessions = {}
    from threading import Lock
    app.state.session_lock = Lock()
    app.add_middleware(LocalSecurity)
    app.add_middleware(RequestGuard)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({'code': 'INVALID_REQUEST'}, status_code=422)

    @app.exception_handler(SafetyError)
    async def safety_error(request, exc):
        return JSONResponse({"code": exc.code}, status_code=409)

    @app.exception_handler(OSError)
    async def io_error(request, exc):
        return JSONResponse({"code": "LOCAL_IO_FAILED"}, status_code=409)

    def granted(request, identifier):
        entry = current(request).workspaces.get(identifier)
        if not entry:
            raise HTTPException(404, "WORKSPACE_NOT_FOUND")
        return entry

    @app.get("/api/session")
    def session(request: Request):
        session = request.state.local_session
        response = JSONResponse({"csrf": session.csrf}) if session else None
        if response is not None:
            return response
        with app.state.session_lock:
            for token, old in list(app.state.sessions.items()):
                if time.monotonic() - old.created > 8 * 3600:
                    old.jobs.cancel_all()
                    app.state.sessions.pop(token, None)
            if len(app.state.sessions) >= 64:
                raise HTTPException(429, "SESSION_LIMIT")
            session = Session()
            token = secrets.token_urlsafe(32)
            app.state.sessions[token] = session
        response = JSONResponse({"csrf": session.csrf})
        response.set_cookie("neatdrop_session", token, httponly=True, samesite="strict", max_age=8 * 3600)
        return response

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "version": "0.1.0", "execution_mode": "copy_only"}

    @app.get("/api/v1/config")
    def config():
        from .semantic import semantic_status
        offline = offline_status()
        offline['semantic'] = semantic_status()
        offline['semantic']['enabled'] = os.getenv('NEATDROP_SEMANTIC_CANDIDATES') == '1'
        return {"model": model_status(), "offline": offline, "categories": CATEGORIES, "taxonomy": taxonomy_config(), "content_forms": FORMS, "undo_supported": os.name == "nt", "execution_supported": os.name == "nt",
                "limits": {"files": 50, "file_mib": 20, "total_mib": 200}, "demo_path": str(PROJECT / "demo-files")}

    @app.get("/api/v1/model-config")
    def read_model_config(request: Request):
        current(request)
        return public_model_config()

    @app.post("/api/v1/model-config")
    def save_model_config(body: ModelConfigBody, request: Request):
        current(request)
        return update_model_config(body.model_dump(exclude_none=True))

    @app.post("/api/v1/model-config/clear-key")
    def clear_model_key(body: Confirmation, request: Request):
        current(request)
        if body.confirmed is not True:
            raise SafetyError("CONFIRMATION_REQUIRED")
        return update_model_config({"key_action": "clear"})

    @app.post("/api/v1/model-config/test")
    async def test_model_config(body: ModelConfigTestBody, request: Request):
        current(request)
        if body.confirmed is not True:
            raise SafetyError("CONFIRMATION_REQUIRED")
        snapshot = test_model_snapshot(body.model_dump(exclude={"confirmed"}, exclude_none=True))
        await model_api.test_connection(snapshot)
        return {"ok": True}

    @app.post("/api/v1/pick-directory")
    def pick_directory():
        try:
            import tkinter
            from tkinter import filedialog
            window = tkinter.Tk()
            window.withdraw()
            window.attributes("-topmost", True)
            try:
                path = filedialog.askdirectory(title="NeatDrop - 选择待整理目录", mustexist=True)
            finally:
                window.destroy()
            return {"path": path or None}
        except Exception as exc:
            raise SafetyError("PICKER_UNAVAILABLE") from exc

    @app.post("/api/v1/workspaces")
    def open_workspace(body: Directory, request: Request):
        session = current(request)
        with session.lock:
            if len(session.workspaces) >= 16:
                raise SafetyError("WORKSPACE_LIMIT")
            ws = Workspace(body.path)
            files = ws.scan()
            session.workspaces[ws.id] = (ws, Executor(ws))
        return {"id": ws.id, "path": str(ws.root), "name": ws.root.name, "files": files}

    @app.get("/api/v1/workspaces/{identifier}/files")
    def scan(identifier: str, request: Request):
        ws, _ = granted(request, identifier)
        return ws.scan()

    @app.get("/api/v1/workspaces/{identifier}/files/{file_id}/preview")
    def preview(identifier: str, file_id: str, request: Request):
        ws, _ = granted(request, identifier)
        return prepare_input(ws, ws.record(file_id))

    @app.post("/api/v1/workspaces/{identifier}/plans")
    def plan(identifier: str, body: PlanBody, request: Request):
        _, executor = granted(request, identifier)
        return executor.plan([edit.model_dump() for edit in body.edits])

    @app.post("/api/v1/workspaces/{identifier}/execute")
    def execute(identifier: str, body: ExecuteBody, request: Request):
        _, executor = granted(request, identifier)
        return executor.execute(body.plan_id, body.digest, body.confirmed)

    @app.get("/api/v1/workspaces/{identifier}/executions/{plan_id}")
    def execution_status(identifier: str, plan_id: str, request: Request):
        _, executor = granted(request, identifier)
        try:
            return executor.execution_status(plan_id)
        except SafetyError as exc:
            if exc.code == "EXECUTION_STATUS_NOT_FOUND":
                raise HTTPException(404, exc.code) from exc
            raise

    @app.get("/api/v1/workspaces/{identifier}/transactions")
    def history(identifier: str, request: Request):
        return granted(request, identifier)[1].history()

    @app.get('/api/v1/workspaces/{identifier}/library')
    def library(identifier: str, request: Request):
        return granted(request, identifier)[1].library()

    @app.get('/api/v1/workspaces/{identifier}/library/{entry_id}/preview')
    def library_preview(identifier: str, entry_id: str, request: Request):
        try:
            return granted(request, identifier)[1].library_preview(entry_id)
        except SafetyError as exc:
            if exc.code == 'LIBRARY_ENTRY_NOT_FOUND':
                raise HTTPException(404, exc.code) from exc
            raise

    @app.post("/api/v1/workspaces/{identifier}/transactions/{transaction_id}/undo")
    def undo(identifier: str, transaction_id: str, body: Confirmation, request: Request):
        if not body.confirmed:
            raise SafetyError("CONFIRMATION_REQUIRED")
        return granted(request, identifier)[1].undo(transaction_id)

    @app.post("/api/v1/workspaces/{identifier}/transactions/{transaction_id}/acknowledge")
    def acknowledge(identifier: str, transaction_id: str, body: Confirmation, request: Request):
        if not body.confirmed:
            raise SafetyError("CONFIRMATION_REQUIRED")
        return granted(request, identifier)[1].acknowledge(transaction_id)

    @app.post("/api/v1/analysis-jobs")
    async def start_job(body: JobBody, request: Request):
        ws, _ = granted(request, body.workspace_id)
        manager = current(request).jobs
        job = manager.create(ws, body.file_ids, body.mode, body.cloud_consent,
                             endpoint=body.endpoint, config_version=body.config_version)
        task = asyncio.create_task(manager.run(job["id"], ws))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return dict(job)

    @app.get("/api/v1/analysis-jobs/{identifier}")
    def get_job(identifier: str, request: Request):
        try:
            return dict(current(request).jobs.get(identifier))
        except SafetyError as exc:
            raise HTTPException(404, exc.code) from exc

    @app.post("/api/v1/analysis-jobs/{identifier}/cancel")
    def cancel_job(identifier: str, request: Request):
        return current(request).jobs.cancel(identifier)

    dist = PROJECT / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
