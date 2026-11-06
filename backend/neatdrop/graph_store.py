"""Bounded installation-local graph snapshots; one atomic revision per mutation."""
import copy
import hashlib
import json
import os
import uuid
from .files import SafetyError
from .records import valid_hex
from .safe_io import metadata_file
from .trust import TrustStore, root_key, _LOCK

LIMIT = 16 * 1024 * 1024
RELATION_LIMIT = 2 * 1024 * 1024


def empty_state():
    return {'version': 1, 'revision': 0, 'updated': None, 'features': {}, 'relations': [], 'dismissed': []}


def validate(state):
    if not isinstance(state, dict) or set(state) != set(empty_state()):
        raise ValueError('shape')
    if state['version'] != 1 or type(state['revision']) is not int or not 0 <= state['revision'] < 2**53:
        raise ValueError('revision')
    if state['updated'] is not None and (not isinstance(state['updated'], str) or len(state['updated']) > 80):
        raise ValueError('timestamp')
    features, relations, dismissed = state['features'], state['relations'], state['dismissed']
    if not isinstance(features, dict) or len(features) > 1000 or not isinstance(relations, list) or len(relations) > 5000 or not isinstance(dismissed, list) or len(dismissed) > 5000:
        raise ValueError('limits')
    if len(json.dumps([relations, dismissed]).encode()) > RELATION_LIMIT or not all(valid_hex(i, 64) for i in dismissed):
        raise ValueError('relations')
    for identifier, f in features.items():
        if not valid_hex(identifier, 64) or not isinstance(f, dict) or set(f) != {'terms', 'fingerprint', 'quality', 'sha256', 'identity', 'updated', 'algorithm'}:
            raise ValueError('feature')
        if not valid_hex(f['sha256'], 64) or not isinstance(f['identity'], dict) or set(f['identity']) != {'device', 'inode'} or any(type(v) is not int or v < 0 for v in f['identity'].values()):
            raise ValueError('identity')
        if f['fingerprint'] is not None and not valid_hex(f['fingerprint'], 16):
            raise ValueError('fingerprint')
        if not isinstance(f['algorithm'], str) or len(f['algorithm']) > 80 or not isinstance(f['updated'], str) or len(f['updated']) > 80:
            raise ValueError('feature version')
        quality = f['quality']
        if not isinstance(quality, dict) or quality.get('state') not in {'acceptable', 'limited', 'unavailable'} or len(json.dumps(quality)) > 4096:
            raise ValueError('quality')
        terms = f['terms']
        if not isinstance(terms, dict) or len(terms) > 256:
            raise ValueError('terms')
        for term, positions in terms.items():
            if not isinstance(term, str) or not 2 <= len(term) <= 40 or not isinstance(positions, list) or not 1 <= len(positions) <= 3:
                raise ValueError('term')
            if any(not isinstance(p, list) or len(p) != 2 or any(type(v) is not int for v in p) or not 0 <= p[0] < p[1] <= 12000 for p in positions):
                raise ValueError('position')
    for relation in relations:
        if not isinstance(relation, dict) or set(relation) != {'id', 'source', 'target', 'kind', 'status', 'origin', 'created'}:
            raise ValueError('relation shape')
        if not all(valid_hex(relation[k], 64) for k in ('id', 'source', 'target')) or relation['source'] == relation['target']:
            raise ValueError('relation ID')
        if relation['kind'] not in {'related', 'reference', 'attachment', 'version'} or relation['status'] != 'confirmed' or relation['origin'] != 'manual' or not isinstance(relation['created'], str) or len(relation['created']) > 80:
            raise ValueError('relation metadata')
    return state


class GraphStore:
    def __init__(self, executor):
        self.key = hashlib.sha256(json.dumps(root_key(executor.ws), sort_keys=True).encode()).hexdigest()
        self.guard = TrustStore(executor.trust.path / 'knowledge-graph')
        self.path = self.guard.path / (self.key + '.json')
        self.lock = _LOCK

    def load(self):
        try:
            with self.guard._guard():
                if not self.path.exists() and not self.path.is_symlink():
                    return empty_state(), True
                with metadata_file(self.path) as stream:
                    raw = stream.read(LIMIT + 1)
            if len(raw) > LIMIT:
                raise ValueError('budget')
            return validate(json.loads(raw)), True
        except (OSError, SafetyError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
            return empty_state(), False

    def commit(self, revision, mutate, *, recover=False):
        with self.lock, self.guard._guard():
            state, available = self.load()
            if not available and not recover:
                raise SafetyError('GRAPH_STORE_UNAVAILABLE')
            if state['revision'] != revision:
                raise SafetyError('GRAPH_REVISION_CONFLICT')
            state = copy.deepcopy(state)
            mutate(state)
            state['revision'] += 1
            from .journal import stamp
            state['updated'] = stamp()
            try:
                validate(state)
                raw = json.dumps(state, ensure_ascii=True, allow_nan=False).encode()
                if len(raw) > LIMIT:
                    raise ValueError('budget')
            except (ValueError, TypeError):
                raise SafetyError('GRAPH_STORE_LIMIT')
            # Inspect any existing target before replacement, including recovery.
            # A corrupt regular file can be replaced; links cannot be cleared.
            if self.path.exists() or self.path.is_symlink():
                with metadata_file(self.path):
                    pass
            temp = self.path.with_name(self.key + '-' + uuid.uuid4().hex + '.tmp')
            try:
                with metadata_file(temp, write=True) as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, self.path)
                if os.name != 'nt':
                    fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
            finally:
                if temp.exists():
                    temp.unlink()
            return state

