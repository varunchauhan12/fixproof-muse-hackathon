"""Small request protections; these are not authentication or tenant authorization."""
from collections import OrderedDict, deque
import os
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit

from starlette.responses import JSONResponse


def cors_origins():
    raw = os.getenv("FIXPROOF_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    origins = [value.strip() for value in raw.split(",") if value.strip()]
    for origin in origins:
        parsed = urlsplit(origin)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("FIXPROOF_CORS_ORIGINS requires exact HTTP(S) origins without paths or wildcard")
    return origins


def is_demo_mode() -> bool:
    """
    Returns True if running in local hackathon / single-user demo mode.
    Explicitly configured via FIXPROOF_DEMO_MODE=true.
    In demo mode, unified incident listing returns all investigations across sessions,
    and single-user incident inspection allows opening all local investigations.
    In production / non-demo mode (FIXPROOF_DEMO_MODE is false/unset or FIXPROOF_ENV=production),
    multi-tenant session isolation is strictly enforced.
    """
    env_name = os.getenv("FIXPROOF_ENV", "").strip().lower()
    if env_name in ("production", "prod"):
        return False
    return os.getenv("FIXPROOF_DEMO_MODE", "false").strip().lower() in ("true", "1", "yes")


def safe_diagnostic(value):
    text = str(value)
    for name, secret in os.environ.items():
        if secret and (any(part in name for part in ("API_KEY", "PASSWORD", "SIGNING_KEY", "SERVICE_ROLE", "DB_URL")) or name in ("DATABASE_URL", "POSTGRES_URL")):
            text = text.replace(secret, "[redacted]")
    def mask_database_uri(match):
        try:
            parsed = urlsplit(match.group())
            return f"{parsed.scheme}://****@{parsed.hostname or '[host]'}"
        except ValueError:
            return "[redacted database URI]"
    return re.sub(r"postgres(?:ql)?://[^\s]+", mask_database_uri, text)


class RequestProtectionMiddleware:
    """Bound streamed request bodies before multipart parsing and throttle costly work.

    Uses the ASGI peer address, never arbitrary Forwarded/X-Forwarded-For headers.
    Limits are per worker and reset on restart, not a distributed quota.
    """
    def __init__(self, app, max_body_bytes=51 * 1024 * 1024, requests_per_minute=None):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.limit = int(requests_per_minute if requests_per_minute is not None else os.getenv("FIXPROOF_RATE_LIMIT_PER_MINUTE", "30"))
        if self.limit < 1:
            raise ValueError("FIXPROOF_RATE_LIMIT_PER_MINUTE must be positive")
        self.windows = OrderedDict()
        self.lock = threading.Lock()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        method, path = scope["method"], scope["path"]
        expensive = (method in ("POST", "DELETE") and (path.startswith("/api/") or path == "/diagnose")) or path.endswith("/reports/export")
        if expensive:
            peer = (scope.get("client") or ("unknown",))[0]
            now = time.monotonic()
            with self.lock:
                history = self.windows.setdefault(peer, deque())
                self.windows.move_to_end(peer)
                while history and history[0] <= now - 60:
                    history.popleft()
                blocked = len(history) >= self.limit
                if not blocked:
                    history.append(now)
                while len(self.windows) > 4096:
                    self.windows.popitem(last=False)
            if blocked:
                return await JSONResponse({"detail": "Request limit reached; retry later."}, 429, headers={"Retry-After": "60"})(scope, receive, send)
        if method not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
            if length < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({"detail": "Invalid Content-Length."}, 400)(scope, receive, send)
        if length > self.max_body_bytes:
            return await JSONResponse({"detail": "Request body exceeds upload limit."}, 413)(scope, receive, send)
        # Spool at most 1 MiB in memory; enforce the total even without Content-Length.
        with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as body:
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > self.max_body_bytes:
                    return await JSONResponse({"detail": "Request body exceeds upload limit."}, 413)(scope, receive, send)
                body.write(chunk)
                if not message.get("more_body", False):
                    break
            body.seek(0)
            finished = False
            async def replay():
                nonlocal finished
                if finished:
                    return await receive()
                chunk = body.read(64 * 1024)
                more = body.tell() < total
                finished = not more
                return {"type": "http.request", "body": chunk, "more_body": more}
            return await self.app(scope, replay, send)
