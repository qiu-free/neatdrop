"""Encrypted local model settings and immutable effective configuration snapshots."""

from __future__ import annotations

import base64
import ctypes
import hashlib
import hmac
import ipaddress
import json
import os
import re
import stat
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit, urlunsplit

from .files import SafetyError, is_link

DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_TEXT_MODEL = "qwen-plus"
DEFAULT_VISION_MODEL = "qwen-vl-plus"
DEFAULT_MAX_REQUESTS = 20
SETTINGS_FORMAT = "neatdrop-model-settings"
SETTINGS_VERSION = 1
MAX_SETTINGS_BYTES = 64 * 1024
_ENDPOINT_PATH = re.compile(r"^/[A-Za-z0-9._~/-]*$")
_MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_CONFIG_VERSION_KEY = os.urandom(32)


@dataclass(frozen=True)
class ModelConfigSnapshot:
    endpoint: str
    api_key: str = field(repr=False)
    text_model: str
    vision_model: str
    max_requests_per_batch: int
    config_version: str


@dataclass
class _SavedSettings:
    revision: int = 0
    endpoint: str | None = None
    text_model: str | None = None
    vision_model: str | None = None
    max_requests_per_batch: int | None = None
    api_key: str | None = field(default=None, repr=False)
    key_endpoint: str | None = None


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(data: bytes, protect: bool) -> bytes:
    if os.name != "nt":
        raise SafetyError("MODEL_SETTINGS_UNAVAILABLE")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    from ctypes import wintypes

    source_buffer = ctypes.create_string_buffer(data, len(data))
    source = _DataBlob(len(data), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    destination = _DataBlob()
    flags = 0x1  # CRYPTPROTECT_UI_FORBIDDEN
    if protect:
        crypt32.CryptProtectData.argtypes = [ctypes.POINTER(_DataBlob), wintypes.LPCWSTR,
                                             ctypes.POINTER(_DataBlob), ctypes.c_void_p,
                                             ctypes.c_void_p, wintypes.DWORD,
                                             ctypes.POINTER(_DataBlob)]
        crypt32.CryptProtectData.restype = wintypes.BOOL
        ok = crypt32.CryptProtectData(ctypes.byref(source), "NeatDrop model settings", None, None, None, flags, ctypes.byref(destination))
    else:
        crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(_DataBlob), ctypes.POINTER(wintypes.LPWSTR),
                                               ctypes.POINTER(_DataBlob), ctypes.c_void_p,
                                               ctypes.c_void_p, wintypes.DWORD,
                                               ctypes.POINTER(_DataBlob)]
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        ok = crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, flags, ctypes.byref(destination))
    if not ok:
        raise SafetyError("MODEL_SETTINGS_UNAVAILABLE")
    try:
        return ctypes.string_at(destination.pbData, destination.cbData)
    finally:
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        kernel32.LocalFree(destination.pbData)


def _dpapi_protect(data: bytes) -> bytes:
    return _crypt(data, True)


def _dpapi_unprotect(data: bytes) -> bytes:
    return _crypt(data, False)


def normalize_endpoint(value: str) -> str:
    if not isinstance(value, str) or len(value) > 2048 or not value or value != value.strip():
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise SafetyError("MODEL_ENDPOINT_INVALID") from exc
    if (parsed.scheme.lower() != "https" or not host or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or "\\" in value or any(ord(c) < 32 for c in value)):
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    host_lower = host.lower().rstrip(".")
    if not host_lower or host_lower in {"localhost", "localhost.localdomain"} or host_lower.endswith((".localhost", ".local", ".internal")):
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    try:
        address = ipaddress.ip_address(host_lower)
        if not is_public_ip_address(address):
            raise SafetyError("MODEL_ENDPOINT_INVALID")
    except ValueError:
        try:
            encoded_host = host_lower.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise SafetyError("MODEL_ENDPOINT_INVALID") from exc
        if len(encoded_host) > 253 or any(not label or len(label) > 63 for label in encoded_host.split(".")):
            raise SafetyError("MODEL_ENDPOINT_INVALID")
    if port is not None and not 1 <= port <= 65535:
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    path = parsed.path or ""
    if not _ENDPOINT_PATH.fullmatch(path) or any(part in {".", ".."} for part in path.split("/")):
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    # A configured endpoint is an API base, never a caller-selected arbitrary route.
    if path.rstrip("/").endswith("/chat/completions"):
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    netloc = parsed.netloc
    if "@" in netloc:
        raise SafetyError("MODEL_ENDPOINT_INVALID")
    normalized = urlunsplit(("https", netloc, path.rstrip("/"), "", ""))
    return normalized


def is_public_ip_address(address) -> bool:
    """Accept only globally routable unicast addresses for model connections."""
    return (address.is_global and not address.is_multicast and not address.is_reserved
            and not address.is_unspecified and not address.is_loopback and not address.is_link_local)


def _bounded_model(value: str | None, fallback: str) -> str:
    if value is None:
        return fallback
    candidate = value.strip()
    if not candidate or not _MODEL_NAME.fullmatch(candidate):
        raise SafetyError("MODEL_SETTING_INVALID")
    return candidate


def _bounded_budget(value: object, fallback: int = DEFAULT_MAX_REQUESTS) -> int:
    if value is None:
        return fallback
    if type(value) is not int or not 1 <= value <= 50:
        raise SafetyError("MODEL_SETTING_INVALID")
    return value


class SettingsStore:
    """Read and atomically replace a DPAPI-protected, versioned settings envelope."""

    def __init__(self, path: Path | str | None = None, protect=None, unprotect=None):
        self._provided_path = Path(path) if path is not None else None
        self._protect = protect or _dpapi_protect
        self._unprotect = unprotect or _dpapi_unprotect
        self._lock = RLock()

    @property
    def path(self) -> Path:
        if self._provided_path is not None:
            return self._provided_path
        app_root = Path(__file__).resolve().parents[2]
        return app_root / ".neatdrop-state" / "model-config" / "settings.json"

    def _decode(self, raw: bytes) -> _SavedSettings:
        try:
            if len(raw) > MAX_SETTINGS_BYTES:
                raise ValueError("oversize")
            envelope = json.loads(raw)
            if (not isinstance(envelope, dict) or set(envelope) != {"format", "version", "ciphertext"}
                    or envelope["format"] != SETTINGS_FORMAT or type(envelope["version"]) is not int
                    or envelope["version"] != SETTINGS_VERSION
                    or not isinstance(envelope["ciphertext"], str)):
                raise ValueError("envelope")
            ciphertext = base64.b64decode(envelope["ciphertext"], validate=True)
            try:
                plaintext = self._unprotect(ciphertext)
            except SafetyError:
                raise
            except Exception as exc:
                raise SafetyError("MODEL_SETTINGS_UNAVAILABLE") from exc
            payload = json.loads(plaintext)
            expected = {"version", "revision", "endpoint", "text_model", "vision_model", "max_requests_per_batch", "api_key", "key_endpoint"}
            if (not isinstance(payload, dict) or set(payload) != expected or type(payload["version"]) is not int
                    or payload["version"] != SETTINGS_VERSION):
                raise ValueError("payload")
            if type(payload["revision"]) is not int or payload["revision"] < 0:
                raise ValueError("revision")
            for field_name in ("endpoint", "text_model", "vision_model", "api_key", "key_endpoint"):
                if payload[field_name] is not None and not isinstance(payload[field_name], str):
                    raise ValueError(field_name)
            limits = {"endpoint": 2048, "text_model": 128, "vision_model": 128, "api_key": 4096, "key_endpoint": 2048}
            if any(payload[name] is not None and len(payload[name]) > limit for name, limit in limits.items()):
                raise ValueError("field limit")
            budget = payload["max_requests_per_batch"]
            if budget is not None and (type(budget) is not int or not 1 <= budget <= 50):
                raise ValueError("budget")
            return _SavedSettings(**{key: payload[key] for key in expected if key != "version"})
        except SafetyError:
            raise
        except (ValueError, TypeError, KeyError, UnicodeError, OSError, RecursionError) as exc:
            raise SafetyError("MODEL_SETTINGS_CORRUPT") from exc

    def _read_unlocked(self) -> _SavedSettings:
        target = self.path
        try:
            if is_link(target):
                raise SafetyError("MODEL_SETTINGS_CORRUPT")
            with target.open("rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SETTINGS_BYTES:
                    raise SafetyError("MODEL_SETTINGS_CORRUPT")
                raw = stream.read(MAX_SETTINGS_BYTES + 1)
            if len(raw) > MAX_SETTINGS_BYTES:
                raise SafetyError("MODEL_SETTINGS_CORRUPT")
            return self._decode(raw)
        except FileNotFoundError:
            return _SavedSettings()
        except SafetyError:
            raise
        except OSError as exc:
            raise SafetyError("MODEL_SETTINGS_UNAVAILABLE") from exc
        except Exception as exc:
            raise SafetyError("MODEL_SETTINGS_UNAVAILABLE") from exc

    def read(self) -> _SavedSettings:
        with self._lock:
            return self._read_unlocked()

    @contextmanager
    def transaction(self):
        with self._lock:
            yield

    def write(self, settings: _SavedSettings) -> None:
        with self._lock:
            self._write_unlocked(settings)

    def _write_unlocked(self, settings: _SavedSettings) -> None:
        if os.name != "nt" and self._protect is _dpapi_protect:
            raise SafetyError("MODEL_SETTINGS_UNAVAILABLE")
        payload = {
            "version": SETTINGS_VERSION,
            "revision": settings.revision,
            "endpoint": settings.endpoint,
            "text_model": settings.text_model,
            "vision_model": settings.vision_model,
            "max_requests_per_batch": settings.max_requests_per_batch,
            "api_key": settings.api_key,
            "key_endpoint": settings.key_endpoint,
        }
        try:
            protected = self._protect(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            raw = json.dumps({"format": SETTINGS_FORMAT, "version": SETTINGS_VERSION,
                              "ciphertext": base64.b64encode(protected).decode("ascii")}, separators=(",", ":")).encode("ascii")
            if len(raw) > MAX_SETTINGS_BYTES:
                raise SafetyError("MODEL_SETTINGS_TOO_LARGE")
            target = self.path
            target.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".model-settings-", suffix=".tmp", dir=target.parent)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
            except BaseException:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
        except SafetyError:
            raise
        except OSError as exc:
            raise SafetyError("MODEL_SETTINGS_UNAVAILABLE") from exc


STORE = SettingsStore()


def _env_value(name: str) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


def _effective():
    settings_error = None
    try:
        saved = STORE.read()
    except SafetyError as exc:
        if exc.code not in {"MODEL_SETTINGS_CORRUPT", "MODEL_SETTINGS_UNAVAILABLE"}:
            raise
        saved = _SavedSettings()
        settings_error = exc.code
    env_endpoint = _env_value("NEATDROP_BASE_URL")
    env_text = _env_value("NEATDROP_TEXT_MODEL")
    env_vision = _env_value("NEATDROP_VISION_MODEL")
    env_budget = _env_value("NEATDROP_MAX_MODEL_REQUESTS")
    env_key = _env_value("NEATDROP_API_KEY")
    endpoint_locked = env_endpoint is not None or env_key is not None
    endpoint = normalize_endpoint(env_endpoint or (DEFAULT_ENDPOINT if env_key else saved.endpoint) or DEFAULT_ENDPOINT)
    text_model = _bounded_model(env_text or saved.text_model, DEFAULT_TEXT_MODEL)
    vision_model = _bounded_model(env_vision or saved.vision_model, DEFAULT_VISION_MODEL)
    if env_budget:
        try:
            budget = _bounded_budget(int(env_budget))
        except (ValueError, SafetyError):
            budget = DEFAULT_MAX_REQUESTS
    else:
        budget = _bounded_budget(saved.max_requests_per_batch, DEFAULT_MAX_REQUESTS)
    if env_key:
        api_key = env_key
        key_source = "environment"
    elif saved.api_key and saved.key_endpoint == endpoint:
        api_key = saved.api_key
        key_source = "saved"
    else:
        api_key = None
        key_source = "endpoint_mismatch" if saved.api_key else "none"
    fields = {
        "endpoint": (endpoint, "environment" if endpoint_locked else "saved" if saved.endpoint else "default", endpoint_locked),
        "text_model": (text_model, "environment" if env_text else "saved" if saved.text_model else "default", bool(env_text)),
        "vision_model": (vision_model, "environment" if env_vision else "saved" if saved.vision_model else "default", bool(env_vision)),
        "max_requests_per_batch": (budget, "environment" if env_budget else "saved" if saved.max_requests_per_batch is not None else "default", bool(env_budget)),
    }
    key_locked = env_key is not None
    version_material = json.dumps({
        "revision": saved.revision,
        "endpoint": endpoint,
        "text_model": text_model,
        "vision_model": vision_model,
        "budget": budget,
        "key_source": key_source,
        "key_fingerprint": hashlib.sha256(api_key.encode("utf-8")).hexdigest() if api_key else None,
        "bound_endpoint": saved.key_endpoint if key_source == "endpoint_mismatch" else None,
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")
    version_digest = hmac.new(_CONFIG_VERSION_KEY, version_material, hashlib.sha256).hexdigest()[:20]
    config_version = f"{saved.revision}-{version_digest}"
    public = {
        **{name: value[0] for name, value in fields.items()},
        "configured": api_key is not None,
        "key_source": key_source,
        "key_locked": key_locked,
        "config_version": config_version,
        "settings_error": settings_error,
        **{f"{name}_source": value[1] for name, value in fields.items()},
        **{f"{name}_locked": value[2] for name, value in fields.items()},
    }
    return saved, fields, api_key, key_source, config_version, public


def public_model_config() -> dict:
    return dict(_effective()[-1])


def get_model_snapshot() -> ModelConfigSnapshot:
    _, fields, api_key, _, config_version, _ = _effective()
    if not api_key:
        raise SafetyError("MODEL_NOT_CONFIGURED")
    endpoint = fields["endpoint"][0]
    return ModelConfigSnapshot(
        endpoint=endpoint,
        api_key=api_key,
        text_model=fields["text_model"][0],
        vision_model=fields["vision_model"][0],
        max_requests_per_batch=fields["max_requests_per_batch"][0],
        config_version=config_version,
    )


def _validate_key(value: object) -> str:
    if not isinstance(value, str):
        raise SafetyError("MODEL_SETTING_INVALID")
    key = value.strip()
    if not key or len(key) > 4096 or any(ord(char) < 32 for char in key):
        raise SafetyError("MODEL_SETTING_INVALID")
    return key


def update_model_config(values: dict) -> dict:
    with STORE.transaction():
        return _update_model_config_locked(values)


def _update_model_config_locked(values: dict) -> dict:
    """Persist user values; environment values remain authoritative and locked."""
    values = dict(values)
    key_action = values.pop("key_action", "keep")
    api_key_value = values.pop("api_key", None)
    if values.keys() - {"endpoint", "text_model", "vision_model", "max_requests_per_batch"}:
        raise SafetyError("MODEL_SETTING_INVALID")
    if key_action not in {"keep", "replace", "clear"}:
        raise SafetyError("MODEL_SETTING_INVALID")
    if key_action == "replace":
        api_key_value = _validate_key(api_key_value)
    elif api_key_value is not None:
        raise SafetyError("MODEL_SETTING_INVALID")
    if _env_value("NEATDROP_API_KEY") and key_action != "keep":
        raise SafetyError("MODEL_SETTING_LOCKED")
    for field_name, env_name in (("endpoint", "NEATDROP_BASE_URL"), ("text_model", "NEATDROP_TEXT_MODEL"),
                                 ("vision_model", "NEATDROP_VISION_MODEL"),
                                 ("max_requests_per_batch", "NEATDROP_MAX_MODEL_REQUESTS")):
        locked_by_environment = _env_value(env_name) is not None or (field_name == "endpoint" and _env_value("NEATDROP_API_KEY") is not None)
        if field_name in values and values[field_name] is not None and locked_by_environment:
            env_current = _effective()[1][field_name][0]
            incoming = values[field_name]
            if field_name == "endpoint":
                incoming = normalize_endpoint(incoming)
            if field_name == "max_requests_per_batch":
                incoming = _bounded_budget(incoming)
            if field_name in {"text_model", "vision_model"}:
                incoming = _bounded_model(incoming, "")
            if incoming != env_current:
                raise SafetyError("MODEL_SETTING_LOCKED")
            values.pop(field_name)
    if "endpoint" in values and values["endpoint"] is not None:
        values["endpoint"] = normalize_endpoint(values["endpoint"])
    for name in ("text_model", "vision_model"):
        if name in values and values[name] is not None:
            values[name] = _bounded_model(values[name], "")
    if "max_requests_per_batch" in values and values["max_requests_per_batch"] is not None:
        values["max_requests_per_batch"] = _bounded_budget(values["max_requests_per_batch"])

    saved = STORE.read()
    effective_endpoint = normalize_endpoint(_env_value("NEATDROP_BASE_URL") or values.get("endpoint") or saved.endpoint or DEFAULT_ENDPOINT)
    new_saved = _SavedSettings(**vars(saved))
    for name in ("endpoint", "text_model", "vision_model", "max_requests_per_batch"):
        if name in values and values[name] is not None:
            setattr(new_saved, name, values[name])
    if key_action == "replace":
        new_saved.api_key = api_key_value
        new_saved.key_endpoint = effective_endpoint
    elif key_action == "clear":
        new_saved.api_key = None
        new_saved.key_endpoint = None
    elif new_saved.api_key and new_saved.key_endpoint != effective_endpoint:
        raise SafetyError("MODEL_KEY_ENDPOINT_MISMATCH")
    if new_saved == saved:
        return public_model_config()
    new_saved.revision += 1
    STORE.write(new_saved)
    return public_model_config()


def test_model_snapshot(values: dict) -> ModelConfigSnapshot:
    """Resolve unsaved form values for an explicit fixed-text connection test."""
    values = dict(values)
    key_action = values.pop("key_action", "keep")
    api_key_value = values.pop("api_key", None)
    if values.keys() - {"endpoint", "text_model", "vision_model", "max_requests_per_batch"}:
        raise SafetyError("MODEL_SETTING_INVALID")
    if key_action not in {"keep", "replace", "clear"}:
        raise SafetyError("MODEL_SETTING_INVALID")
    if _env_value("NEATDROP_API_KEY") and key_action != "keep":
        raise SafetyError("MODEL_SETTING_LOCKED")
    if key_action == "replace":
        api_key = _validate_key(api_key_value)
    elif key_action == "clear":
        raise SafetyError("MODEL_NOT_CONFIGURED")
    elif api_key_value is not None:
        raise SafetyError("MODEL_SETTING_INVALID")
    public = public_model_config()
    resolved = {}
    env_names = {
        "endpoint": "NEATDROP_BASE_URL", "text_model": "NEATDROP_TEXT_MODEL",
        "vision_model": "NEATDROP_VISION_MODEL", "max_requests_per_batch": "NEATDROP_MAX_MODEL_REQUESTS",
    }
    for name, env_name in env_names.items():
        incoming = values.get(name)
        locked_by_environment = _env_value(env_name) is not None or (name == "endpoint" and _env_value("NEATDROP_API_KEY") is not None)
        if incoming is not None and locked_by_environment:
            candidate = normalize_endpoint(incoming) if name == "endpoint" else incoming
            if candidate != public[name]:
                raise SafetyError("MODEL_SETTING_LOCKED")
        resolved[name] = incoming if incoming is not None and not locked_by_environment else public[name]
    endpoint = normalize_endpoint(resolved["endpoint"])
    text_model = _bounded_model(resolved["text_model"], DEFAULT_TEXT_MODEL)
    vision_model = _bounded_model(resolved["vision_model"], DEFAULT_VISION_MODEL)
    _bounded_budget(resolved["max_requests_per_batch"])
    if key_action == "keep":
        current = get_model_snapshot()
        if current.endpoint != endpoint:
            raise SafetyError("MODEL_KEY_ENDPOINT_MISMATCH")
        api_key = current.api_key
    return ModelConfigSnapshot(endpoint=endpoint, api_key=api_key, text_model=text_model,
                               vision_model=vision_model, max_requests_per_batch=1,
                               config_version=public["config_version"])
