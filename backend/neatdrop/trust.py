"""Installation-local receipts. Never reconstruct trust from selected-folder logs."""
import contextlib
import json
import os
import threading
import unicodedata
from pathlib import Path

from .files import SafetyError, is_link
from .safe_io import directory_pin, metadata_file

STATE_DIR = Path(__file__).resolve().parents[2] / '.neatdrop-state'
_LOCK = threading.RLock()


def root_key(workspace):
    return {'path': unicodedata.normalize('NFC', str(workspace.root)).casefold(), 'identity': list(workspace.identity)}


class TrustStore:
    def __init__(self, path=STATE_DIR):
        self.path = Path(path)

    @contextlib.contextmanager
    def _guard(self):
        with _LOCK, contextlib.ExitStack() as stack:
            for directory in reversed([self.path, *self.path.parents]):
                if not directory.exists():
                    directory.mkdir()
                if is_link(directory):
                    raise SafetyError('TRUST_STORE_UNAVAILABLE')
                stack.enter_context(directory_pin(directory))
            yield

    def _path(self, transaction_id):
        from .records import valid_hex
        if not valid_hex(transaction_id, 32):
            raise SafetyError('INVALID_TRANSACTION')
        return self.path / (transaction_id + '.json')

    def save(self, workspace, plan, identities):
        record = {'root': root_key(workspace), 'plan': plan, 'identities': identities}
        encoded = json.dumps(record, ensure_ascii=True).encode()
        if len(encoded) > 128 * 1024:
            raise SafetyError('TRUST_STORE_UNAVAILABLE')
        try:
            with self._guard(), metadata_file(self._path(plan['id']), write=True) as stream:
                if os.fstat(stream.fileno()).st_size:
                    raise SafetyError('TRUST_STORE_UNAVAILABLE')
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
        except OSError as exc:
            raise SafetyError('TRUST_STORE_UNAVAILABLE') from exc

    def load(self, workspace, plan):
        try:
            with self._guard():
                path = self._path(plan['id'])
                if not path.exists():
                    return None
                with metadata_file(path) as stream:
                    raw = stream.read(128 * 1024 + 1)
            if len(raw) > 128 * 1024:
                return None
            record = json.loads(raw)
            if not isinstance(record, dict) or record.get('root') != root_key(workspace) or record.get('plan') != plan:
                return None
            identities = record.get('identities')
            if not isinstance(identities, dict):
                return None
            for identifier, identity in identities.items():
                if identifier not in {i['file_id'] for i in plan['items']} or not isinstance(identity, dict):
                    return None
                if set(identity) != {'device', 'inode'} or not all(type(v) is int for v in identity.values()):
                    return None
            return record
        except (OSError, SafetyError, ValueError, TypeError, RecursionError):
            return None
