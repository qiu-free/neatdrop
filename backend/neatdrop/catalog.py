"""Explicit catalog registration; persistent locators never authorize reads."""
import hashlib
import uuid

from .catalog_store import CatalogStore
from .files import SafetyError
from .graph import GraphService
from .safe_io import protect_workspace
from .trust import _LOCK, root_key


def composite_id(root_id, entry_id):
    return hashlib.sha256(f'{root_id}:{entry_id}'.encode('ascii')).hexdigest()


class Catalog:
    def __init__(self, session, path=None):
        self.session = session
        self.store = CatalogStore(path)
        self.relations = CatalogStore(path, relations=True)

    def _root(self, identifier):
        root = next((r for r in self.store.require()['roots'] if r['id'] == identifier), None)
        if root is None:
            raise SafetyError('CATALOG_ROOT_NOT_FOUND')
        return root

    def commit_relations(self, revision, roots, mutate):
        """Serialize metadata membership checks with registry/relationship edits.

        Callers perform file/grant checks before entering this short critical
        section. No graph-job cancellation or workspace I/O runs under _LOCK.
        """
        with _LOCK:
            current = {root['id']: root for root in self.store.require()['roots']}
            for root in roots:
                actual = current.get(root['id'])
                if actual is None or any(actual[key] != root[key] for key in ('locator', 'identity')):
                    raise SafetyError('CATALOG_AUTHORIZATION_REQUIRED')
            return self.relations.commit(revision, mutate)

    def _cancel(self, grant):
        ws = grant['workspace']
        self.session.graph_jobs.cancel_for_root(ws)

    def _revoke(self, root_id):
        grant = self.session.catalog_grants.pop(root_id, None)
        self.session.catalog_relations.clear()
        if grant:
            self._cancel(grant)

    def _root_access(self, root):
        grant = self.session.catalog_grants.get(root['id'])
        if not grant:
            return 'pending_reauthorization'
        if (grant['locator'], grant['identity']) != (root['locator'], root['identity']):
            self.session.catalog_statuses[root['id']] = 'identity_changed'
            self._revoke(root['id'])
            return 'identity_changed'
        pair = self.session.workspaces.get(grant['workspace_id'])
        if pair is None or pair[0] is not grant['workspace']:
            self._revoke(root['id'])
            return 'pending_reauthorization'
        try:
            info = grant['workspace'].root.stat()
        except PermissionError:
            return 'permission_denied'
        except FileNotFoundError:
            return 'offline'
        except OSError:
            return 'offline'
        if (info.st_dev, info.st_ino) != tuple(root['identity']):
            self.session.catalog_statuses[root['id']] = 'identity_changed'
            self._revoke(root['id'])
            return 'identity_changed'
        try:
            with protect_workspace(grant['workspace']):
                pass
        except PermissionError:
            return 'permission_denied'
        except FileNotFoundError:
            return 'offline'
        except OSError:
            return 'offline'
        except SafetyError as exc:
            if exc.code in {'DIRECTORY_CHANGED', 'LINK_FORBIDDEN', 'UNSAFE_PATH'}:
                self.session.catalog_statuses[root['id']] = 'identity_changed'
                self._revoke(root['id'])
                return 'identity_changed'
            return 'permission_denied'
        return 'authorized'

    def grant(self, root):
        grant = self.session.catalog_grants.get(root['id'])
        if not grant:
            raise SafetyError('CATALOG_AUTHORIZATION_REQUIRED')
        status = self._root_access(root)
        if status != 'authorized':
            raise SafetyError('CATALOG_' + status.upper())
        return grant, GraphService(self.session.workspaces[grant['workspace_id']][1])

    def states(self):
        registry = self.store.require()
        relations = self.relations.require()
        result = []
        for root in registry['roots']:
            info = {'id': root['id'], 'alias': root['alias'], 'status': 'pending_reauthorization',
                    'manual_relation_count': sum(root['id'] in (r['source_root_id'], r['target_root_id'])
                                                 for r in relations['relations']),
                    'relations_revision': relations['revision']}
            status = self._root_access(root)
            if status == 'pending_reauthorization':
                status = self.session.catalog_statuses.get(root['id'], status)
            info['status'] = status
            grant = self.session.catalog_grants.get(root['id'])
            if status == 'authorized' and grant:
                info['workspace_id'] = grant['workspace_id']
            result.append(info)
        return {**{k: registry[k] for k in ('version', 'revision', 'updated')},
                'relations_revision': relations['revision'], 'roots': result}

    def register(self, workspace_id, alias, confirmed, root_id=None):
        if confirmed is not True:
            raise SafetyError('CONFIRMATION_REQUIRED')
        alias = alias.strip()
        if not alias or len(alias) > 80 or any(ord(c) < 32 for c in alias):
            raise SafetyError('CATALOG_ALIAS_INVALID')
        with self.session.catalog_lock:
            pair = self.session.workspaces.get(workspace_id)
            if pair is None:
                raise SafetyError('WORKSPACE_NOT_FOUND')
            ws = pair[0]
            with protect_workspace(ws):
                key = root_key(ws)
                with _LOCK:
                    registry = self.store.require()
                    existing = next((r for r in registry['roots'] if r['id'] == root_id), None) if root_id else None
                    if root_id and existing is None:
                        raise SafetyError('CATALOG_ROOT_NOT_FOUND')
                    matching = next((r for r in registry['roots'] if r['locator'] == key['path']), None)
                    if root_id is None and matching is not None:
                        if matching['identity'] != key['identity']:
                            raise SafetyError('CATALOG_ROOT_IDENTITY_MISMATCH')
                        if matching['id'] not in self.session.catalog_grants:
                            raise SafetyError('CATALOG_REAUTHORIZATION_REQUIRED')
                        existing = matching
                    if existing and (existing['locator'] != key['path'] or existing['identity'] != key['identity']):
                        raise SafetyError('CATALOG_ROOT_IDENTITY_MISMATCH')
                    if existing is None and len(registry['roots']) >= 10:
                        raise SafetyError('CATALOG_ROOT_LIMIT')
                    identifier = existing['id'] if existing else uuid.uuid4().hex
                    record = {'id': identifier, 'alias': alias, 'locator': key['path'], 'identity': key['identity']}
                    def mutate(state):
                        state['roots'] = [record if r['id'] == identifier else r for r in state['roots']]
                        if existing is None:
                            state['roots'].append(record)
                    self.store.commit(registry['revision'], mutate)
                if identifier in self.session.catalog_grants:
                    self._revoke(identifier)
                self.session.catalog_statuses.pop(identifier, None)
                self.session.catalog_grants[identifier] = {'workspace_id': workspace_id, 'workspace': ws,
                    'locator': key['path'], 'identity': key['identity'], 'generation': uuid.uuid4().hex}
            return self.states()

    def revoke(self, root_id, confirmed):
        if confirmed is not True:
            raise SafetyError('CONFIRMATION_REQUIRED')
        with self.session.catalog_lock:
            self._root(root_id)
            self._revoke(root_id)
            return self.states()

    def remove(self, root_id, revision, relations_revision, confirmed, remove_relations):
        if confirmed is not True:
            raise SafetyError('CONFIRMATION_REQUIRED')
        if remove_relations is not True:
            raise SafetyError('CATALOG_RELATIONS_CONFIRMATION_REQUIRED')
        with self.session.catalog_lock:
            # Across sessions these two metadata writes and their revision
            # checks form one transaction. Cancellation stays outside _LOCK.
            with _LOCK:
                self._root(root_id)
                state = self.store.require()
                aggregate = self.relations.require()
                if state['revision'] != revision or aggregate['revision'] != relations_revision:
                    raise SafetyError('CATALOG_REVISION_CONFLICT')
                self.relations.commit(relations_revision, lambda current: current.update(
                    relations=[r for r in current['relations'] if root_id not in (r['source_root_id'], r['target_root_id'])]))
                self.store.commit(revision, lambda current: current.update(
                    roots=[r for r in current['roots'] if r['id'] != root_id]))
            self._revoke(root_id)
            self.session.catalog_statuses.pop(root_id, None)
            return self.states()
