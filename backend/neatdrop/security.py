import secrets
import ipaddress
import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock, RLock

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .analysis import AnalysisJobs
from .graph_jobs import GraphJobs


@dataclass
class Session:
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    created: float = field(default_factory=time.monotonic)
    workspaces: dict = field(default_factory=dict)
    jobs: AnalysisJobs = field(default_factory=AnalysisJobs)
    graph_jobs: GraphJobs = field(default_factory=GraphJobs)
    lock: Lock = field(default_factory=Lock)
    catalog_grants: dict = field(default_factory=dict)
    catalog_statuses: dict = field(default_factory=dict)
    catalog_relations: dict = field(default_factory=dict)
    catalog_lock: RLock = field(default_factory=RLock)


class RequestGuard:
    """Check actual peer and bounded streamed body before framework JSON parsing."""
    def __init__(self, app):
        self.app = app
        self.active = 0
        self.lock = Lock()
        self.expensive = deque()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def reject(code, status):
            response = JSONResponse({'code': code}, status_code=status,
                                    headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
            await response(scope, receive, send)

        try:
            peer = ipaddress.ip_address(scope.get('client', ('', 0))[0])
            if not peer.is_loopback:
                return await reject('LOOPBACK_REQUIRED', 403)
        except ValueError:
            return await reject('LOOPBACK_REQUIRED', 403)
        method = scope['method']
        if method not in {'GET', 'HEAD', 'POST', 'DELETE'}:
            return await reject('METHOD_NOT_ALLOWED', 405)
        headers = {key.lower(): value for key, value in scope['headers']}
        if method in {'POST', 'DELETE'}:
            if headers.get(b'content-encoding', b'identity').lower() != b'identity':
                return await reject('CONTENT_ENCODING_REJECTED', 415)
            if headers.get(b'content-type', b'').split(b';', 1)[0].strip().lower() != b'application/json':
                return await reject('JSON_REQUIRED', 415)
        with self.lock:
            admitted = self.active < 24
            if admitted:
                self.active += 1
        if not admitted:
            return await reject('SERVER_BUSY', 429)
        try:
            chunks = bytearray()
            more = True
            deadline = time.monotonic() + 15
            while more:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return await reject('REQUEST_TIMEOUT', 408)
                try:
                    event = await asyncio.wait_for(receive(), timeout=remaining)
                except TimeoutError:
                    return await reject('REQUEST_TIMEOUT', 408)
                if time.monotonic() > deadline:
                    return await reject('REQUEST_TIMEOUT', 408)
                if event['type'] == 'http.disconnect':
                    return
                block = event.get('body', b'')
                if len(chunks) + len(block) > 128 * 1024:
                    return await reject('REQUEST_TOO_LARGE', 413)
                chunks.extend(block)
                more = event.get('more_body', False)
            consumed = False

            async def replay():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {'type': 'http.request', 'body': bytes(chunks), 'more_body': False}
                return await receive()

            path = scope['path']
            expensive = path == '/api/session' or path.startswith('/api/v1/catalog') or (method == 'POST' and (path.endswith('/workspaces') or path.endswith('/pick-directory') or path.endswith('/analysis-jobs')))
            if expensive:
                with self.lock:
                    now = time.monotonic()
                    while self.expensive and now - self.expensive[0] > 60:
                        self.expensive.popleft()
                    admitted = len(self.expensive) < 120
                    if admitted:
                        self.expensive.append(now)
                if not admitted:
                    return await reject('RATE_LIMITED', 429)
            await self.app(scope, replay, send)
        finally:
            with self.lock:
                self.active -= 1


class LocalSecurity(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        host = request.headers.get("host", "")
        if host not in {"127.0.0.1:8765", "localhost:8765", "127.0.0.1", "localhost"}:
            return JSONResponse({"code": "LOCAL_HOST_REQUIRED"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in {"http://" + host, "https://" + host}:
            return JSONResponse({"code": "ORIGIN_REJECTED"}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"code": "ORIGIN_REJECTED"}, status_code=403)
        sessions = request.app.state.sessions
        token = request.cookies.get("neatdrop_session", "")
        session = sessions.get(token)
        if session and time.monotonic() - session.created > 8 * 3600:
            session.jobs.cancel_all()
            session.graph_jobs.cancel_all()
            sessions.pop(token, None)
            session = None
        if request.url.path.startswith("/api/") and request.url.path not in {"/api/session", "/api/v1/health"}:
            if not session:
                return JSONResponse({"code": "SESSION_REQUIRED"}, status_code=403)
            supplied_csrf = request.headers.get('x-neatdrop-csrf', '')
            if request.method not in {"GET", "HEAD"} and (not supplied_csrf.isascii() or not secrets.compare_digest(supplied_csrf, session.csrf)):
                return JSONResponse({"code": "CSRF_REJECTED"}, status_code=403)
        request.state.local_session = session
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return response


def current(request: Request):
    if not request.state.local_session:
        raise HTTPException(403, "SESSION_REQUIRED")
    return request.state.local_session
