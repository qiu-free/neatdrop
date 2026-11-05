import contextlib
import ctypes
import hashlib
import os
from pathlib import Path
from contextvars import ContextVar

from .files import SafetyError, checked_path

_directory_scope = ContextVar('directory_scope', default=None)


def windows_kernel():
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    return kernel


def validate_handle(handle, directory, single_link=False):
    from ctypes import wintypes

    class FileInfo(ctypes.Structure):
        _fields_ = [('attributes', wintypes.DWORD), ('created', wintypes.FILETIME),
                    ('accessed', wintypes.FILETIME), ('written', wintypes.FILETIME),
                    ('volume', wintypes.DWORD), ('size_high', wintypes.DWORD),
                    ('size_low', wintypes.DWORD), ('links', wintypes.DWORD),
                    ('index_high', wintypes.DWORD), ('index_low', wintypes.DWORD)]

    kernel = windows_kernel()
    kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInfo)]
    info = FileInfo()
    if not kernel.GetFileInformationByHandle(handle, ctypes.byref(info)):
        raise OSError(ctypes.get_last_error(), 'Cannot inspect file handle')
    if info.attributes & 0x400 or bool(info.attributes & 0x10) != directory:
        raise SafetyError('LINK_FORBIDDEN')
    if single_link and info.links != 1:
        raise SafetyError('METADATA_LINK_FORBIDDEN')


@contextlib.contextmanager
def directory_pin(path):
    if os.name != 'nt':
        yield
        return
    kernel = windows_kernel()
    # Share reads/writes, NOT delete: no ancestor may be renamed or replaced.
    handle = kernel.CreateFileW(str(path), 0x80000000, 3, None, 3, 0x02200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise OSError(ctypes.get_last_error(), 'Cannot pin directory')
    try:
        validate_handle(handle, directory=True)
        yield
    finally:
        kernel.CloseHandle(handle)


def pin_in_scope(path):
    scope = _directory_scope.get()
    if scope and path not in scope[1]:
        scope[0].enter_context(directory_pin(path))
        scope[1].add(path)


@contextlib.contextmanager
def protect_workspace(workspace):
    with contextlib.ExitStack() as stack:
        token = _directory_scope.set((stack, set()))
        try:
            for path in reversed([workspace.root, *workspace.root.parents]):
                pin_in_scope(path)
            info = workspace.root.stat()
            if (info.st_dev, info.st_ino) != workspace.identity:
                raise SafetyError('DIRECTORY_CHANGED')
            yield
        finally:
            _directory_scope.reset(token)


@contextlib.contextmanager
def metadata_file(path, write=False):
    if os.name == 'nt':
        import msvcrt
        kernel = windows_kernel()
        handle = kernel.CreateFileW(str(path), 0xC0000000 if write else 0x80000000,
                                    1 if write else 3, None, 4 if write else 3, 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), 'Cannot lock metadata')
        try:
            validate_handle(handle, directory=False, single_link=True)
            fd = msvcrt.open_osfhandle(handle, (os.O_RDWR if write else os.O_RDONLY) | os.O_BINARY)
        except Exception:
            kernel.CloseHandle(handle)
            raise
    else:
        fd = os.open(path, (os.O_RDWR | os.O_CREAT if write else os.O_RDONLY) | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        if os.fstat(fd).st_nlink != 1:
            os.close(fd)
            raise SafetyError('METADATA_LINK_FORBIDDEN')
    with os.fdopen(fd, 'r+b' if write else 'rb') as stream:
        yield stream


@contextlib.contextmanager
def locked_reader(path, for_rename=False):
    if os.name == "nt":
        import msvcrt
        kernel = windows_kernel()
        access = 0x80000000 | (0x10000 if for_rename else 0)
        handle = kernel.CreateFileW(str(path), access, 1, None, 3, 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), "Unable to lock file")
        try:
            validate_handle(handle, directory=False)
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except Exception:
            kernel.CloseHandle(handle)
            raise
        with os.fdopen(fd, "rb") as stream:
            yield stream
    else:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            yield stream


@contextlib.contextmanager
def root_lock(root):
    path = checked_path(root, ".neatdrop/write.lock", mkdir=True)
    try:
        context = metadata_file(path, write=True)
        stream = context.__enter__()
    except OSError as exc:
        raise SafetyError('DIRECTORY_BUSY') from exc
    try:
        if os.fstat(stream.fileno()).st_size == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise SafetyError("DIRECTORY_BUSY") from exc
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
    finally:
        context.__exit__(None, None, None)


def copy_exclusive(source, target, expected_hash):
    hasher = hashlib.sha256()
    # 'xb' is O_EXCL: a late external target is never overwritten.
    with locked_reader(source) as src:
        from .files import MAX_FILE
        size = os.fstat(src.fileno()).st_size
        if size > MAX_FILE:
            raise SafetyError('FILE_TOO_LARGE')
        total = 0
        with target.open("xb") as dst:
            while block := src.read(1024 * 1024):
                total += len(block)
                if total > MAX_FILE or total > size:
                    raise SafetyError('SOURCE_CHANGED')
                dst.write(block)
                hasher.update(block)
            dst.flush()
            os.fsync(dst.fileno())
            created_identity = file_identity(dst.fileno())
    if hasher.hexdigest() != expected_hash:
        raise SafetyError("SOURCE_CHANGED")
    from .files import digest_file
    if digest_file(target) != expected_hash:
        raise SafetyError("VERIFY_FAILED")
    return created_identity


def file_identity(fd):
    info = os.fstat(fd)
    return {'device': info.st_dev, 'inode': info.st_ino}


def withdraw_windows(target, withdrawn, expected_hash, expected_identity=None):
    if os.name != "nt":
        raise SafetyError("UNDO_UNSUPPORTED")
    import msvcrt
    from ctypes import wintypes

    class RenameInfo(ctypes.Structure):
        _fields_ = [("ReplaceIfExists", wintypes.BOOLEAN), ("RootDirectory", wintypes.HANDLE),
                    ("FileNameLength", wintypes.DWORD), ("FileName", wintypes.WCHAR * 1)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetFileInformationByHandle.restype = wintypes.BOOL
    with locked_reader(target, for_rename=True) as stream:
        if expected_identity is not None and file_identity(stream.fileno()) != expected_identity:
            raise SafetyError('TARGET_REPLACED')
        from .files import MAX_FILE
        if os.fstat(stream.fileno()).st_size > MAX_FILE:
            raise SafetyError('TARGET_CHANGED')
        hasher = hashlib.sha256()
        total = 0
        while block := stream.read(1024 * 1024):
            total += len(block)
            if total > MAX_FILE:
                raise SafetyError('TARGET_CHANGED')
            hasher.update(block)
        if hasher.hexdigest() != expected_hash:
            raise SafetyError("TARGET_CHANGED")
        filename = str(withdrawn.absolute()).encode("utf-16-le")
        offset = RenameInfo.FileName.offset
        # Reserve a terminating WCHAR beyond FileNameLength. Some Windows
        # rename paths inspect it; allocator tail bytes must never become a
        # filename suffix or make a valid non-replacing rename fail.
        buffer_size = max(ctypes.sizeof(RenameInfo), offset + len(filename) + ctypes.sizeof(wintypes.WCHAR))
        buffer = ctypes.create_string_buffer(buffer_size)
        info = ctypes.cast(buffer, ctypes.POINTER(RenameInfo)).contents
        info.ReplaceIfExists = False
        info.RootDirectory = None
        info.FileNameLength = len(filename)
        ctypes.memmove(ctypes.addressof(buffer) + offset, filename, len(filename))
        if not kernel.SetFileInformationByHandle(msvcrt.get_osfhandle(stream.fileno()), 3, buffer, buffer_size):
            raise OSError(ctypes.get_last_error(), "Non-replacing undo rename failed")
