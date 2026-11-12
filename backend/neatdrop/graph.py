"""Trusted graph projection, relationship mutations and fresh evidence reads."""
import hashlib
import uuid
from collections import defaultdict
from .files import SafetyError
from .library import ArchiveLibrary
from .safe_io import protect_workspace
from .graph_store import GraphStore
from .graph_matching import match_features, ALGORITHM
from .journal import stamp


class GraphService:
    def __init__(self, executor):
        self.library = ArchiveLibrary(executor)
        self.store = GraphStore(executor)
        self.ws = executor.ws

    def records(self):
        with protect_workspace(self.ws):
            records = list(self.library._records())
            result = {}
            for entry, item, identity in sorted(records, key=lambda r: (r[0]['created'], r[0]['id']), reverse=True)[:1000]:
                entry['availability'] = self.library._availability(item, identity)
                result[entry['id']] = (entry, item, identity)
            return result, len(records) > 1000

    def listing(self):
        records, truncated = self.records()
        state, available = self.store.load()
        trusted = {key for key, (_, _, identity) in records.items() if identity is not None}
        current = {key for key in trusted if records[key][0]['availability'] == 'available'}
        features = {key: f for key, f in state['features'].items() if key in current and f['sha256'] == records[key][1]['sha256'] and f['identity'] == records[key][2] and f['algorithm'] == ALGORITHM}
        relations = [r for r in state['relations'] if r['source'] in trusted and r['target'] in trusted]
        groups = defaultdict(list)
        for key in sorted(trusted):
            groups[records[key][1]['sha256']].append(key)
        for digest, members in groups.items():
            for source, target in zip(members, members[1:]):
                relations.append({'id': hashlib.sha256(f'archive:{source}:{target}:{digest}'.encode()).hexdigest(),
                                  'source': source, 'target': target, 'kind': 'duplicate', 'status': 'fact', 'origin': 'archive',
                                  'created': max(records[source][0]['created'], records[target][0]['created'])})
        if available:
            relations += [r for r in match_features(features) if r['id'] not in state['dismissed']]
        issues = [{'entry_id': key, 'code': 'GRAPH_INDEX_HISTORICAL'} for key in state['features'] if key in records and key not in features]
        issues += [{'entry_id': key, 'code': 'GRAPH_CONTENT_LIMITED'} for key, f in features.items() if f['quality']['state'] != 'acceptable']
        return {'items': [r[0] for r in records.values()], 'relations': relations, 'truncated': truncated,
                'index': {'count': len(features), 'revision': state['revision'], 'updated': state['updated'],
                          'state': 'unavailable' if not available else 'ready' if features else 'empty', 'issues': issues}}

    def read(self, identifier, *, local=True, cancelled=None):
        try:
            with protect_workspace(self.ws):
                return self.library.read(identifier, local=local, cancelled=cancelled, reject_hardlinks=True, use_vision=False)
        except SafetyError as exc:
            if exc.code.startswith('LIBRARY_ENTRY_'):
                raise SafetyError(exc.code.replace('LIBRARY_', 'GRAPH_')) from exc
            raise

    def descriptor(self, identifier):
        try:
            with protect_workspace(self.ws):
                return self.library.descriptor(identifier)
        except SafetyError as exc:
            if exc.code.startswith('LIBRARY_ENTRY_'):
                raise SafetyError(exc.code.replace('LIBRARY_', 'GRAPH_')) from exc
            raise

    def relation(self, identifier):
        relation = next((r for r in self.listing()['relations'] if r['id'] == identifier), None)
        if relation is None:
            raise SafetyError('GRAPH_RELATION_NOT_FOUND')
        return relation

    def verified_pair(self, relation):
        state, available = self.store.load()
        if relation['origin'] == 'automatic' and not available:
            raise SafetyError('GRAPH_STORE_UNAVAILABLE')
        payloads = []
        for key in (relation['source'], relation['target']):
            entry, item, identity = self.descriptor(key)
            feature = state['features'].get(key)
            if relation['origin'] == 'automatic' and (not feature or feature['sha256'] != item['sha256'] or feature['identity'] != identity or feature['algorithm'] != ALGORITHM):
                raise SafetyError('GRAPH_INDEX_STALE')
            payload = self.read(key)
            payloads.append((entry, payload))
        return payloads

    def evidence(self, identifier):
        relation = self.relation(identifier)
        files = []
        for entry, payload in self.verified_pair(relation):
            text = payload.get('text', '')[:12000]
            # Evidence uses actual bounded decoded intervals, never persisted
            # keywords/offsets as a source of text or a validation shortcut.
            from .graph_matching import text_features
            terms = text_features(text)['terms']
            intervals = []
            for keyword in relation.get('keywords', []):
                for start, end in terms.get(keyword, [])[:1]:
                    intervals.append((max(0, start - 55), min(len(text), end + 80)))
            excerpts = [text[a:b] for a, b in intervals[:3]]
            if not excerpts and text:
                excerpts = [text[:240]]
            from .content_quality import assess_content
            quality = assess_content(payload, bool(payload.get('local_image')))
            scope = payload.get('sampling', {}).get('summary') or payload.get('sample', '有界本机读取')
            files.append({'id': entry['id'], 'name': entry['name'], 'excerpts': excerpts,
                          'summary': '已重新核验当前归档副本。' + scope + '。' + quality['summary'] +
                          ('' if text else '没有可靠文字，请查看图片预览。')})
        explanation = ('归档时 SHA-256 相同；当前双方副本已重新核验。' if relation['kind'] == 'duplicate' else
                       '本机内容相似线索，仍为待确认候选；不能据此推断引用或版本事实。' if relation['origin'] == 'automatic' else '人工维护的关系；不代表内容推断。')
        return {'relation': relation, 'files': files, 'explanation': explanation}

    def add(self, source, target, kind, revision, candidate_id=None):
        if source == target:
            raise SafetyError('GRAPH_SELF_LINK')
        self.descriptor(source)
        self.descriptor(target)
        if candidate_id:
            candidate = self.relation(candidate_id)
            if candidate['origin'] != 'automatic' or {source, target} != {candidate['source'], candidate['target']}:
                raise SafetyError('GRAPH_CANDIDATE_INVALID')
            self.verified_pair(candidate)
        relation = {'id': hashlib.sha256(uuid.uuid4().bytes).hexdigest(), 'source': source, 'target': target,
                    'kind': kind, 'status': 'confirmed', 'origin': 'manual', 'created': stamp()}
        def mutate(state):
            state['relations'].append(relation)
            if candidate_id:
                state['dismissed'] = list(dict.fromkeys([*state['dismissed'], candidate_id]))
        self.store.commit(revision, mutate)
        return self.listing()

    def dismiss(self, identifier, revision):
        relation = self.relation(identifier)
        if relation['origin'] != 'automatic':
            raise SafetyError('GRAPH_CANDIDATE_INVALID')
        def mutate(state):
            state['dismissed'] = list(dict.fromkeys([*state['dismissed'], identifier]))
        self.store.commit(revision, mutate)
        return self.listing()

    def delete(self, identifier, revision):
        relation = self.relation(identifier)
        if relation['origin'] != 'manual':
            raise SafetyError('GRAPH_RELATION_IMMUTABLE')
        def mutate(state):
            state['relations'] = [r for r in state['relations'] if r['id'] != identifier]
        self.store.commit(revision, mutate)
        return self.listing()

    def clear(self, revision):
        def mutate(state):
            state['features'] = {}
            state['dismissed'] = []
        self.store.commit(revision, mutate, recover=True)
        return self.listing()
