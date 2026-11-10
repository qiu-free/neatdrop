import asyncio
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from .analysis import prepare_input
from .executor import Executor
from .files import CATEGORIES, SUPPORTED, SafetyError, Workspace
from .model import model_status
from .security import LocalSecurity, RequestGuard, Session, current
from .taxonomy import taxonomy_config, FORMS
from .configuration import public_model_config, test_model_snapshot, update_model_config
from . import model as model_api
from .safe_io import directory_pin, protect_workspace

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


class GraphJobBody(Body):
    entry_ids: list[str] = Field(min_length=1, max_length=50)
    confirmed: bool = False


class GraphRevision(Body):
    revision: int = Field(ge=0, lt=2**53)


class GraphRelationBody(GraphRevision):
    source: str = Field(pattern=r'^[a-f0-9]{64}$')
    target: str = Field(pattern=r'^[a-f0-9]{64}$')
    kind: Literal['related', 'reference', 'attachment', 'version']
    candidate_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


class CatalogRemoveBody(Body):
    revision: int = Field(ge=0, lt=2**53)
    relations_revision: int = Field(ge=0, lt=2**53)
    confirmed: bool = False
    remove_relations: bool = False


class CatalogGraphRelationBody(GraphRevision):
    source: str = Field(pattern=r'^[a-f0-9]{64}$')
    target: str = Field(pattern=r'^[a-f0-9]{64}$')
    kind: Literal['related', 'reference', 'attachment', 'version']
    candidate_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


class CatalogRootBody(Confirmation):
    workspace_id: str = Field(max_length=64)
    alias: str = Field(min_length=1, max_length=80)
    root_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')


def create_app():
    tasks = set()

    @asynccontextmanager
    async def lifespan(app):
        yield
        for session in app.state.sessions.values():
            session.graph_jobs.cancel_all()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="NeatDrop local MVP", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.sessions = {}
    app.state.catalog_path = None
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

    def catalog_action(request, action):
        from .catalog import Catalog
        from .catalog_graph import CatalogGraph
        from .trust import _LOCK
        session = current(request)
        with _LOCK, session.catalog_lock:
            service = Catalog(session, app.state.catalog_path)
            try:
                return action(service, CatalogGraph(service))
            except SafetyError as exc:
                if exc.code in {'CATALOG_ROOT_NOT_FOUND', 'WORKSPACE_NOT_FOUND', 'GRAPH_ENTRY_NOT_FOUND', 'GRAPH_RELATION_NOT_FOUND'}:
                    return JSONResponse({'code': exc.code}, status_code=404)
                raise

    @app.get('/api/v1/catalog')
    def catalog_listing(request: Request):
        return catalog_action(request, lambda catalog, _: catalog.states())

    @app.post('/api/v1/catalog/roots')
    def catalog_register(body: CatalogRootBody, request: Request):
        return catalog_action(request, lambda catalog, _: catalog.register(**body.model_dump()))

    @app.post('/api/v1/catalog/roots/{root_id}/revoke')
    def catalog_revoke(root_id: str, body: Confirmation, request: Request):
        return catalog_action(request, lambda catalog, _: catalog.revoke(root_id, body.confirmed))

    @app.delete('/api/v1/catalog/roots/{root_id}')
    def catalog_remove(root_id: str, body: CatalogRemoveBody, request: Request):
        return catalog_action(request, lambda catalog, _: catalog.remove(**body.model_dump(), root_id=root_id))

    @app.get('/api/v1/catalog/graph')
    def catalog_graph(request: Request, offset: int = Query(default=0, ge=0), limit: int = Query(default=1000, ge=1, le=1000)):
        return catalog_action(request, lambda _, graph: graph.listing(offset, limit))

    @app.get('/api/v1/catalog/library/{entry_id}/preview')
    def catalog_preview(entry_id: str, request: Request):
        return catalog_action(request, lambda _, graph: graph.preview(entry_id))

    @app.get('/api/v1/catalog/graph/relations/{relation_id}/evidence')
    def catalog_evidence(relation_id: str, request: Request):
        return catalog_action(request, lambda _, graph: graph.evidence(relation_id))

    @app.post('/api/v1/workspaces/{identifier}/children/{file_id}/open')
    def open_child_directory(identifier: str, file_id: str, body: Confirmation, request: Request):
        if body.confirmed is not True:
            raise SafetyError('CONFIRMATION_REQUIRED')
        ws, _ = granted(request, identifier)
        session = current(request)
        with protect_workspace(ws):
            path = Path(ws.child_directory(file_id))
            expected = ws.directory_identities.get(file_id)
            if not expected or path.parent != ws.root:
                raise SafetyError('DIRECTORY_NOT_AVAILABLE')
            with directory_pin(path):
                info = path.stat()
                if (info.st_dev, info.st_ino) != expected:
                    raise SafetyError('DIRECTORY_CHANGED')
                child = Workspace(path)
                if child.root.parent != ws.root or child.identity != expected:
                    raise SafetyError('DIRECTORY_CHANGED')
                files = child.scan()
                executor = Executor(child)
                with session.lock:
                    if len(session.workspaces) >= 16:
                        raise SafetyError('WORKSPACE_LIMIT')
                    session.workspaces[child.id] = (child, executor)
        return {'id': child.id, 'path': str(child.root), 'name': child.root.name, 'files': files}

    @app.post('/api/v1/catalog/graph/relations')
    def catalog_relation_add(body: CatalogGraphRelationBody, request: Request):
        return catalog_action(request, lambda _, graph: graph.add(**body.model_dump()))

    @app.post('/api/v1/catalog/graph/relations/{relation_id}/dismiss')
    def catalog_relation_dismiss(relation_id: str, body: GraphRevision, request: Request):
        return catalog_action(request, lambda _, graph: graph.dismiss(relation_id, body.revision))

    @app.delete('/api/v1/catalog/graph/relations/{relation_id}')
    def catalog_relation_delete(relation_id: str, body: GraphRevision, request: Request):
        return catalog_action(request, lambda _, graph: graph.delete(relation_id, body.revision))

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
                    old.graph_jobs.cancel_all()
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
        from .offline import offline_status
        from .semantic import semantic_status
        offline = offline_status()
        offline['semantic'] = semantic_status()
        offline['semantic']['enabled'] = os.getenv('NEATDROP_SEMANTIC_CANDIDATES') == '1'
        from .pdf_ocr import pdf_ocr_status
        offline['scanned_pdf'] = pdf_ocr_status()
        return {"model": model_status(), "offline": offline, "categories": CATEGORIES, "taxonomy": taxonomy_config(), "content_forms": FORMS, "undo_supported": os.name == "nt", "execution_supported": os.name == "nt",
                "supported_extensions": sorted(SUPPORTED),
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
            executor = Executor(ws)
            # Reauthorizing this physical root replaces the UI's graph session.
            # Cancel its prior jobs while leaving worker cleanup to the worker.
            session.graph_jobs.cancel_for_root(ws)
            session.workspaces[ws.id] = (ws, executor)
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

    def graph_service(request, identifier):
        from .graph import GraphService
        return GraphService(granted(request, identifier)[1])

    def graph_result(action):
        try:
            return action()
        except SafetyError as exc:
            if exc.code in {'GRAPH_JOB_NOT_FOUND', 'GRAPH_RELATION_NOT_FOUND', 'GRAPH_ENTRY_NOT_FOUND'}:
                return JSONResponse({'code': exc.code}, status_code=404)
            raise

    @app.get('/api/v1/workspaces/{identifier}/graph')
    def graph_listing(identifier: str, request: Request):
        return graph_service(request, identifier).listing()

    @app.post('/api/v1/workspaces/{identifier}/graph/jobs')
    async def graph_start_job(identifier: str, body: GraphJobBody, request: Request):
        service = graph_service(request, identifier)
        manager = current(request).graph_jobs
        job = await asyncio.to_thread(manager.create, service, body.entry_ids, body.confirmed)
        task = asyncio.create_task(manager.run(job['id']))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return job

    @app.get('/api/v1/workspaces/{identifier}/graph/jobs/{job_id}')
    def graph_get_job(identifier: str, job_id: str, request: Request):
        service = graph_service(request, identifier)
        return graph_result(lambda: current(request).graph_jobs.get(job_id, service))

    @app.post('/api/v1/workspaces/{identifier}/graph/jobs/{job_id}/cancel')
    def graph_cancel_job(identifier: str, job_id: str, body: Body, request: Request):
        service = graph_service(request, identifier)
        return graph_result(lambda: current(request).graph_jobs.cancel(job_id, service))

    @app.get('/api/v1/workspaces/{identifier}/graph/relations/{relation_id}/evidence')
    def graph_evidence(identifier: str, relation_id: str, request: Request):
        return graph_result(lambda: graph_service(request, identifier).evidence(relation_id))

    @app.post('/api/v1/workspaces/{identifier}/graph/relations')
    def graph_add_relation(identifier: str, body: GraphRelationBody, request: Request):
        return graph_result(lambda: graph_service(request, identifier).add(**body.model_dump()))

    @app.post('/api/v1/workspaces/{identifier}/graph/relations/{relation_id}/dismiss')
    def graph_dismiss(identifier: str, relation_id: str, body: GraphRevision, request: Request):
        return graph_result(lambda: graph_service(request, identifier).dismiss(relation_id, body.revision))

    @app.delete('/api/v1/workspaces/{identifier}/graph/relations/{relation_id}')
    def graph_delete_relation(identifier: str, relation_id: str, body: GraphRevision, request: Request):
        return graph_result(lambda: graph_service(request, identifier).delete(relation_id, body.revision))

    @app.delete('/api/v1/workspaces/{identifier}/graph/index')
    def graph_clear(identifier: str, body: GraphRevision, request: Request):
        return graph_service(request, identifier).clear(body.revision)

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
