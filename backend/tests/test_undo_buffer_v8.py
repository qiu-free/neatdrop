"""A native rename must not consume bytes beyond the declared UTF-16 name."""
import ctypes
import hashlib
import os

import pytest

from neatdrop.safe_io import file_identity, locked_reader, withdraw_windows


@pytest.mark.skipif(os.name != 'nt', reason='Windows native rename buffer regression')
def test_undo_filename_is_terminated_before_allocator_tail(tmp_path, monkeypatch):
    source = tmp_path / '归档副本.txt'
    withdrawn = tmp_path / '撤回副本.txt'
    source.write_bytes(b'synthetic copy bytes')
    with locked_reader(source) as stream:
        identity = file_identity(stream.fileno())
    allocate = ctypes.create_string_buffer

    def guarded_buffer(size):
        # Deterministic nonzero allocator tail exposes a missing WCHAR NUL.
        # Product code must delimit its own filename, regardless of this tail.
        result = allocate(size + 32)
        junk = ':invalid-tail'.encode('utf-16-le')
        ctypes.memmove(ctypes.addressof(result) + size, junk, len(junk))
        return result

    monkeypatch.setattr(ctypes, 'create_string_buffer', guarded_buffer)
    withdraw_windows(source, withdrawn, hashlib.sha256(b'synthetic copy bytes').hexdigest(), identity)
    assert withdrawn.read_bytes() == b'synthetic copy bytes'
    assert not source.exists()
    assert {path.name for path in tmp_path.iterdir()} == {'撤回副本.txt'}
