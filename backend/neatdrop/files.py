import hashlib
import os
import re
import stat
import unicodedata
import uuid
import itertools
from threading import RLock
from functools import wraps
from pathlib import Path

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 200 * 1024 * 1024
MAX_FILES = 50
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".pdf", ".txt", ".md",
             ".docx", ".pptx", ".xlsx", ".csv"}
from .taxonomy import GROUPS
CATEGORIES = {key: value[1] for key, value in GROUPS.items()}


class SafetyError(Exception):
    def __init__(self, code, detail=""):
        self.code = code
        self.detail = detail
        super().__init__(code)


def canonical(value):
    return unicodedata.normalize("NFC", value).casefold()


def is_link(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def checked_path(root, relative, mkdir=False):
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        raise SafetyError("UNSAFE_PATH")
    parts = relative.split("/")
    if any(p in {"", ".", ".."} for p in parts) or Path(relative).is_absolute():
        raise SafetyError("UNSAFE_PATH")
    current = root
    if is_link(root):
        raise SafetyError("LINK_FORBIDDEN")
    for index, part in enumerate(parts):
        current = current / part
        if current.exists() or current.is_symlink():
            if is_link(current):
                raise SafetyError("LINK_FORBIDDEN")
            if current.is_dir():
                from .safe_io import pin_in_scope
                pin_in_scope(current)
        elif mkdir and index < len(parts) - 1:
            current.mkdir(exist_ok=True)
            if is_link(current):
                raise SafetyError("LINK_FORBIDDEN")
            from .safe_io import pin_in_scope
            pin_in_scope(current)
    if not current.resolve().is_relative_to(root):
        raise SafetyError("UNSAFE_PATH")
    return current


def safe_name(name, extension):
    if not isinstance(name, str) or not name or len(name) > 150:
        raise SafetyError("INVALID_NAME")
    if name[-1] in " ." or name.startswith(".") or any(ord(c) < 32 for c in name):
        raise SafetyError("INVALID_NAME")
    if re.search(r'[<>:"/\\|?*]', name):
        raise SafetyError("INVALID_NAME")
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])", name.split(".")[0].rstrip()):
        raise SafetyError("RESERVED_NAME")
    if Path(name).suffix != extension:
        raise SafetyError("EXTENSION_CHANGED")
    return unicodedata.normalize("NFC", name)


def digest_file(path):
    from .safe_io import locked_reader
    hasher = hashlib.sha256()
    with locked_reader(path) as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > MAX_FILE:
            raise SafetyError('FILE_TOO_LARGE')
        total = 0
        while block := stream.read(1024 * 1024):
            total += len(block)
            if total > MAX_FILE:
                raise SafetyError('FILE_TOO_LARGE')
            hasher.update(block)
        after = os.fstat(stream.fileno())
        if total != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
            raise SafetyError('SOURCE_CHANGED')
    return hasher.hexdigest()


def protected(method):
    @wraps(method)
    def wrapper(self, *args, **kwargs):
        from .safe_io import protect_workspace
        with protect_workspace(getattr(self, 'ws', self)):
            return method(self, *args, **kwargs)
    return wrapper


class Workspace:
    def __init__(self, root):
        candidate = Path(root).absolute()
        from .trust import STATE_DIR
        if STATE_DIR.is_relative_to(candidate.resolve()) or candidate.resolve().is_relative_to(STATE_DIR):
            raise SafetyError('PROTECTED_DIRECTORY')
        if os.name == 'nt' and str(candidate).startswith('\\\\'):
            raise SafetyError('NETWORK_DIRECTORY_UNSUPPORTED')
        if not candidate.is_dir():
            raise SafetyError("DIRECTORY_NOT_FOUND")
        # Check the supplied path before resolve() can hide a junction or symlink.
        for ancestor in [candidate, *candidate.parents]:
            if is_link(ancestor):
                raise SafetyError("LINK_FORBIDDEN")
        self.root = candidate.resolve()
        info = self.root.stat()
        self.identity = (info.st_dev, info.st_ino)
        self.id = uuid.uuid4().hex
        self.records = {}
        self.directory_identities = {}
        self.lock = RLock()

    @protected
    def scan(self):
        with self.lock:
            return self._scan()

    def _scan(self):
        records = {}
        directories = {}
        scan_bytes = 0
        for path in sorted(itertools.islice(self.root.iterdir(), 2000), key=lambda p: canonical(p.name)):
            if canonical(path.name) == ".neatdrop":
                continue
            try:
                info = path.lstat()
            except OSError:
                continue
            reason = ""
            if is_link(path):
                reason = "LINK_FORBIDDEN"
            elif not path.is_file():
                reason = "DIRECTORY_SKIPPED"
            elif path.suffix.lower() not in SUPPORTED:
                reason = "UNSUPPORTED_TYPE"
            elif info.st_size > MAX_FILE:
                reason = "FILE_TOO_LARGE"
            elif info.st_size == 0:
                reason = "EMPTY_FILE"
            elif scan_bytes + info.st_size > MAX_TOTAL:
                reason = 'SCAN_BYTE_LIMIT'
            if not reason:
                try:
                    safe_name(path.name, path.suffix)
                except SafetyError:
                    reason = 'INVALID_NAME'
            identifier = hashlib.sha256(path.name.encode()).hexdigest()[:24]
            if reason == 'DIRECTORY_SKIPPED' and stat.S_ISDIR(info.st_mode):
                directories[identifier] = (info.st_dev, info.st_ino)
            record = {"id": identifier, "name": path.name, "size": info.st_size,
                      "modified": info.st_mtime, "extension": path.suffix,
                      "supported": not reason, "reason": reason, "sha256": None}
            if not reason:
                try:
                    scan_bytes += info.st_size
                    record["sha256"] = digest_file(path)
                    after = path.stat()
                    if (after.st_size, after.st_mtime_ns, after.st_ino) != (info.st_size, info.st_mtime_ns, info.st_ino):
                        raise SafetyError('SOURCE_CHANGED')
                except (OSError, SafetyError):
                    record.update(supported=False, reason="READ_FAILED")
            records[identifier] = record
            if len(records) >= 2000:
                break
        self.records = records
        self.directory_identities = directories
        return list(records.values())

    @protected
    def child_directory(self, identifier):
        """Resolve only a scanned direct child, without granting recursive reads."""
        from .safe_io import directory_pin
        with self.lock:
            record = self.records.get(identifier)
            identity = self.directory_identities.get(identifier)
            if not record or record['reason'] != 'DIRECTORY_SKIPPED' or not identity:
                raise SafetyError('DIRECTORY_NOT_AVAILABLE')
            path = checked_path(self.root, record['name'])
            with directory_pin(path):
                info = path.lstat()
                if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != identity:
                    raise SafetyError('DIRECTORY_CHANGED')
                # Revalidate the workspace identity and every ancestor before
                # returning the locator to the explicit authorization action.
                if is_link(path):
                    raise SafetyError('LINK_FORBIDDEN')
                return str(path)

    def record(self, identifier):
        with self.lock:
            record = self.records.get(identifier)
        if not record or not record["supported"]:
            raise SafetyError("FILE_NOT_AVAILABLE")
        return dict(record)

    def selected(self, identifiers):
        if not identifiers or len(identifiers) > MAX_FILES or len(set(identifiers)) != len(identifiers):
            raise SafetyError("FILE_COUNT_LIMIT")
        records = [self.record(i) for i in identifiers]
        if sum(r["size"] for r in records) > MAX_TOTAL:
            raise SafetyError("BATCH_TOO_LARGE")
        return records
