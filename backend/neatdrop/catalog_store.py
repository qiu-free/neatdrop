"""Installation-local locators and separate versioned aggregate relations.

Nothing read here is a file grant. Catalog grants live only in Session.
"""
import copy
import json
import os
import uuid

from .files import SafetyError
from .journal import stamp
from .records import valid_hex
from .safe_io import metadata_file
from .trust import TrustStore, _LOCK

LIMIT = 2 * 1024 * 1024


def _atomic_write(path, raw):
    temporary = path.with_name(uuid.uuid4().hex + '.tmp')
    try:
        with metadata_file(temporary, write=True) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def _atomic_remove(path):
    if path.exists() or path.is_symlink():
        with metadata_file(path):
            pass
        path.unlink()
        if os.name != 'nt':
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)


def _load_snapshot(store):
    try:
        if not store.path.exists() and not store.path.is_symlink():
            return store.empty(), True
        with metadata_file(store.path) as stream:
            raw = stream.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('budget')
        return store.validate(json.loads(raw)), True
    except (OSError, SafetyError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return store.empty(), False


def _recover_transaction(base):
    """Complete an interrupted paired catalog mutation or fail closed."""
    from pathlib import Path
    guard = TrustStore(Path(base) / 'catalog')
    intent = guard.path / 'transaction.json'
    if not intent.exists() and not intent.is_symlink():
        return
    with guard._guard():
        with metadata_file(intent) as stream:
            raw = stream.read(4 * LIMIT + 4097)
        if len(raw) > 4 * LIMIT + 4096:
            raise SafetyError('CATALOG_STORE_UNAVAILABLE')
        try:
            record = json.loads(raw)
            if not isinstance(record, dict) or set(record) != {'version', 'roots_before', 'roots_after', 'relations_before', 'relations_after'} or record['version'] != 1:
                raise ValueError('intent')
            roots = CatalogStore(base)
            relations = CatalogStore(base, relations=True)
            for store, before, after in ((roots, record['roots_before'], record['roots_after']),
                                         (relations, record['relations_before'], record['relations_after'])):
                store.validate(before)
                store.validate(after)
                current, available = _load_snapshot(store)
                if not available or current not in (before, after):
                    raise ValueError('unexpected current snapshot')
            roots.replace_snapshot(record['roots_after'])
            relations.replace_snapshot(record['relations_after'])
            _atomic_remove(intent)
        except (OSError, SafetyError) as exc:
            if isinstance(exc, SafetyError) and exc.code == 'CATALOG_STORE_UNAVAILABLE':
                raise
            raise SafetyError('CATALOG_STORE_UNAVAILABLE') from exc
        except (ValueError, TypeError, KeyError, RecursionError) as exc:
            raise SafetyError('CATALOG_STORE_UNAVAILABLE') from exc


def commit_catalog_removal(roots, relations, root_id, root_revision, relation_revision):
    """Durably record then idempotently apply a paired remove-root mutation."""
    from pathlib import Path
    if roots.guard.path != relations.guard.path:
        raise SafetyError('CATALOG_STORE_UNAVAILABLE')
    base = roots.guard.path.parent
    with _LOCK, roots.guard._guard():
        _recover_transaction(base)
        before_roots, root_ok = _load_snapshot(roots)
        before_relations, relation_ok = _load_snapshot(relations)
        if not root_ok or not relation_ok:
            raise SafetyError('CATALOG_STORE_UNAVAILABLE')
        if before_roots['revision'] != root_revision or before_relations['revision'] != relation_revision:
            raise SafetyError('CATALOG_REVISION_CONFLICT')
        if not any(root['id'] == root_id for root in before_roots['roots']):
            raise SafetyError('CATALOG_ROOT_NOT_FOUND')
        after_roots = copy.deepcopy(before_roots)
        after_roots['roots'] = [root for root in after_roots['roots'] if root['id'] != root_id]
        after_roots['revision'] += 1
        after_roots['updated'] = stamp()
        after_relations = copy.deepcopy(before_relations)
        after_relations['relations'] = [relation for relation in after_relations['relations']
            if root_id not in (relation['source_root_id'], relation['target_root_id'])]
        after_relations['revision'] += 1
        after_relations['updated'] = stamp()
        roots.validate(after_roots)
        relations.validate(after_relations)
        intent = roots.guard.path / 'transaction.json'
        record = {'version': 1, 'roots_before': before_roots, 'roots_after': after_roots,
                  'relations_before': before_relations, 'relations_after': after_relations}
        raw = json.dumps(record, ensure_ascii=True, allow_nan=False).encode()
        if len(raw) > 4 * LIMIT:
            raise SafetyError('CATALOG_STORE_LIMIT')
        if intent.exists() or intent.is_symlink():
            raise SafetyError('CATALOG_STORE_UNAVAILABLE')
        _atomic_write(intent, raw)
        roots.replace_snapshot(after_roots)
        relations.replace_snapshot(after_relations)
        _atomic_remove(intent)
        return after_roots, after_relations


def empty_registry():
    return {'version': 1, 'revision': 0, 'updated': None, 'roots': []}


def empty_relations():
    return {'version': 1, 'revision': 0, 'updated': None, 'relations': [], 'dismissed': []}


def validate_registry(state):
    if not isinstance(state, dict) or set(state) != set(empty_registry()) or state['version'] != 1:
        raise ValueError('shape')
    if type(state['revision']) is not int or not 0 <= state['revision'] < 2**53:
        raise ValueError('revision')
    if state['updated'] is not None and (not isinstance(state['updated'], str) or len(state['updated']) > 80):
        raise ValueError('updated')
    if not isinstance(state['roots'], list) or len(state['roots']) > 10:
        raise ValueError('roots')
    seen = set()
    for root in state['roots']:
        if not isinstance(root, dict) or set(root) != {'id', 'alias', 'locator', 'identity'}:
            raise ValueError('root')
        if not valid_hex(root['id'], 32) or root['id'] in seen:
            raise ValueError('identifier')
        seen.add(root['id'])
        if not isinstance(root['alias'], str) or not 1 <= len(root['alias'].strip()) <= 80 or any(ord(c) < 32 for c in root['alias']):
            raise ValueError('alias')
        if not isinstance(root['locator'], str) or not 1 <= len(root['locator']) <= 1024:
            raise ValueError('locator')
        if not isinstance(root['identity'], list) or len(root['identity']) != 2 or any(type(i) is not int or i < 0 for i in root['identity']):
            raise ValueError('identity')
    return state


def validate_relations(state):
    if not isinstance(state, dict) or set(state) != set(empty_relations()):
        raise ValueError('shape')
    if state['version'] != 1 or type(state['revision']) is not int or not 0 <= state['revision'] < 2**53:
        raise ValueError('revision')
    if state['updated'] is not None and (not isinstance(state['updated'], str) or len(state['updated']) > 80):
        raise ValueError('updated')
    if not isinstance(state['relations'], list) or len(state['relations']) > 5000 or not isinstance(state['dismissed'], list) or len(state['dismissed']) > 5000:
        raise ValueError('limits')
    if not all(valid_hex(i, 64) for i in state['dismissed']):
        raise ValueError('dismissed')
    for relation in state['relations']:
        if not isinstance(relation, dict) or set(relation) != {'id', 'source', 'target', 'source_root_id', 'target_root_id', 'kind', 'status', 'origin', 'created'}:
            raise ValueError('relation shape')
        if not all(valid_hex(relation[k], 64) for k in ('id', 'source', 'target')) or relation['source'] == relation['target']:
            raise ValueError('relation ID')
        if not all(valid_hex(relation[k], 32) for k in ('source_root_id', 'target_root_id')):
            raise ValueError('root ID')
        if relation['kind'] not in {'related', 'reference', 'attachment', 'version'} or relation['status'] != 'confirmed' or relation['origin'] != 'manual' or not isinstance(relation['created'], str) or len(relation['created']) > 80:
            raise ValueError('relation metadata')
    if len(json.dumps([state['relations'], state['dismissed']]).encode()) > LIMIT:
        raise ValueError('budget')
    return state


class CatalogStore:
    def __init__(self, path=None, *, relations=False):
        base = TrustStore().path if path is None else path
        from pathlib import Path
        self.guard = TrustStore(Path(base) / 'catalog')
        self.path = self.guard.path / ('relations.json' if relations else 'roots.json')
        self.empty = empty_relations if relations else empty_registry
        self.validate = validate_relations if relations else validate_registry

    def load(self):
        with _LOCK:
            _recover_transaction(self.guard.path.parent)
            try:
                with self.guard._guard():
                    if not self.path.exists() and not self.path.is_symlink():
                        return self.empty(), True
                    with metadata_file(self.path) as stream:
                        raw = stream.read(LIMIT + 1)
                if len(raw) > LIMIT:
                    raise ValueError('budget')
                return self.validate(json.loads(raw)), True
            except (OSError, SafetyError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
                return self.empty(), False

    def require(self):
        state, available = self.load()
        if not available:
            raise SafetyError('CATALOG_STORE_UNAVAILABLE')
        return state

    def commit(self, revision, mutate):
        with _LOCK, self.guard._guard():
            _recover_transaction(self.guard.path.parent)
            state = self.require()
            if state['revision'] != revision:
                raise SafetyError('CATALOG_REVISION_CONFLICT')
            state = copy.deepcopy(state)
            mutate(state)
            state['revision'] += 1
            state['updated'] = stamp()
            try:
                self.validate(state)
                raw = json.dumps(state, ensure_ascii=True, allow_nan=False).encode()
                if len(raw) > LIMIT:
                    raise ValueError('budget')
            except (ValueError, TypeError):
                raise SafetyError('CATALOG_STORE_LIMIT')
            if self.path.exists() or self.path.is_symlink():
                with metadata_file(self.path):
                    pass
            if self.path.exists() or self.path.is_symlink():
                with metadata_file(self.path):
                    pass
            _atomic_write(self.path, raw)
            return state

    def replace_snapshot(self, state):
        """Idempotently publish a validated transaction target snapshot."""
        try:
            self.validate(state)
            raw = json.dumps(state, ensure_ascii=True, allow_nan=False).encode()
            if len(raw) > LIMIT:
                raise ValueError('budget')
        except (ValueError, TypeError):
            raise SafetyError('CATALOG_STORE_LIMIT')
        with _LOCK, self.guard._guard():
            if self.path.exists() or self.path.is_symlink():
                with metadata_file(self.path):
                    pass
            _atomic_write(self.path, raw)
        return state
