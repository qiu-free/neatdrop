"""Freshly verified aggregation over explicitly granted per-root archives."""
import hashlib
import os
import stat
import time
from collections import defaultdict

from .catalog import composite_id
from .files import MAX_FILE, SafetyError, checked_path
from .graph_matching import ALGORITHM, match_features, text_features
from .safe_io import file_identity, locked_reader, protect_workspace

VERIFY_MAX_BYTES = 200 * 1024 * 1024
VERIFY_SECONDS = 5


class VerificationBudget:
    def __init__(self):
        self.bytes = 0
        self.deadline = time.monotonic() + VERIFY_SECONDS
        self.limited = False

    def admit(self, size):
        if self.bytes + size > VERIFY_MAX_BYTES or time.monotonic() >= self.deadline:
            self.limited = True
            raise SafetyError('CATALOG_VERIFY_BUDGET')
        self.bytes += size

    def check(self):
        if time.monotonic() >= self.deadline:
            self.limited = True
            raise SafetyError('CATALOG_VERIFY_BUDGET')


def verify(service, item, identity, budget=None):
    """Hash current bytes without decoding/extracting or trusting cached size."""
    if budget:
        budget.admit(item['size'])
    with protect_workspace(service.ws):
        path = checked_path(service.ws.root, item['target'])
        with locked_reader(path) as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != item['size']
                    or before.st_size > MAX_FILE or file_identity(stream.fileno()) != identity):
                raise SafetyError('GRAPH_ENTRY_CHANGED')
            digest = hashlib.sha256()
            length = 0
            while block := stream.read(1024 * 1024):
                if budget:
                    budget.check()
                length += len(block)
                if length > MAX_FILE or length > item['size']:
                    raise SafetyError('GRAPH_ENTRY_CHANGED')
                digest.update(block)
            after = os.fstat(stream.fileno())
            if (length != item['size'] or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns
                    or file_identity(stream.fileno()) != identity or digest.hexdigest() != item['sha256']):
                raise SafetyError('GRAPH_ENTRY_CHANGED')


class CatalogGraph:
    def __init__(self, catalog):
        self.catalog = catalog

    def snapshot(self, selected=None, budget=None, *, metadata_only=False):
        catalog = self.catalog
        registry = catalog.store.require()
        aggregate = catalog.relations.require()
        records, features, per_root_relations, issues = {}, {}, [], []
        generations = {}
        truncated = False
        root_revisions = {}
        root_indexes = {}
        budget = budget or VerificationBudget()
        for root in sorted(registry['roots'], key=lambda r: r['id']):
            if root['id'] not in catalog.session.catalog_grants:
                continue
            try:
                grant, service = catalog.grant(root)
                generations[root['id']] = grant['generation']
                local_records, limited = service.records()
                truncated = truncated or limited
                state, available = service.store.load()
                root_revisions[root['id']] = state['revision']
                root_indexes[root['id']] = {'count': 0, 'revision': state['revision'],
                    'state': 'unavailable' if not available else 'empty'}
                local_map = {}
                local_features = {}
                for key, (entry, item, identity) in local_records.items():
                    identifier = composite_id(root['id'], key)
                    entry = {**entry, 'id': identifier, 'original_entry_id': key,
                             'root_id': root['id'], 'source_alias': root['alias'],
                             'workspace_id': grant['workspace_id']}
                    if entry['availability'] == 'available' and not metadata_only and (selected is None or identifier in selected):
                        try:
                            verify(service, item, identity, budget)
                        except (OSError, SafetyError) as exc:
                            entry['availability'] = 'unverified' if getattr(exc, 'code', '') == 'CATALOG_VERIFY_BUDGET' else 'changed'
                            if entry['availability'] == 'changed':
                                catalog.session.graph_jobs.cancel_for_root(service.ws)
                            else:
                                issues.append({'entry_id': identifier, 'code': 'CATALOG_VERIFY_BUDGET'})
                    elif entry['availability'] == 'available' and not metadata_only:
                        entry['availability'] = 'unverified'
                    records[identifier] = (entry, item, identity, root, service)
                    local_map[key] = identifier
                    if entry['availability'] in {'changed', 'missing'}:
                        catalog.session.graph_jobs.cancel_for_root(service.ws)
                    feature = state['features'].get(key)
                    if (available and entry['availability'] == 'available' and feature and
                            feature['sha256'] == item['sha256'] and feature['identity'] == identity and feature['algorithm'] == ALGORITHM):
                        features[identifier] = feature
                        local_features[key] = feature
                        root_indexes[root['id']]['count'] += 1
                        root_indexes[root['id']]['state'] = 'ready'
                    elif feature:
                        issues.append({'entry_id': identifier, 'code': 'GRAPH_INDEX_HISTORICAL'})
                    elif entry['availability'] != 'available':
                        issues.append({'entry_id': identifier, 'code': 'GRAPH_ENTRY_' + entry['availability'].upper()})
                for relation in state['relations']:
                    if relation['origin'] != 'manual':
                        continue
                    if relation['source'] in local_map and relation['target'] in local_map:
                        per_root_relations.append({**relation,
                            'id': hashlib.sha256(f"{root['id']}:{relation['id']}".encode()).hexdigest(),
                            'original_relation_id': relation['id'], 'root_id': root['id'],
                            'source': local_map[relation['source']], 'target': local_map[relation['target']]})
                # Reuse the existing sparse matcher over fresh per-root features.
                for relation in match_features(local_features):
                    if relation['id'] in state['dismissed']:
                        continue
                    per_root_relations.append({**relation,
                        'id': hashlib.sha256(f"{root['id']}:{relation['id']}".encode()).hexdigest(),
                        'original_relation_id': relation['id'], 'root_id': root['id'],
                        'source': local_map[relation['source']], 'target': local_map[relation['target']]})
            except (OSError, SafetyError):
                # A root failure must not publish partial data gathered earlier.
                records = {k: v for k, v in records.items() if v[3]['id'] != root['id']}
                features = {k: v for k, v in features.items() if k in records}
                per_root_relations = [r for r in per_root_relations if r.get('root_id') != root['id']]
                root_revisions.pop(root['id'], None)
                root_indexes.pop(root['id'], None)
        current = {key for key, (entry, *_) in records.items() if entry['availability'] == 'available'}
        relations = [r for r in [*per_root_relations, *aggregate['relations']]
                     if r['source'] in current and r['target'] in current and
                     not (r['origin'] == 'automatic' and r['id'] in aggregate['dismissed'])]
        groups = defaultdict(list)
        for key in sorted(current):
            groups[records[key][1]['sha256']].append(key)
        for digest, members in groups.items():
            # A deterministic chain expresses identical content without a
            # quadratic clique for large duplicate archives.
            for source, target in zip(members, members[1:]):
                relations.append({'id': hashlib.sha256(f'catalog:{source}:{target}:{digest}'.encode()).hexdigest(),
                    'source': source, 'target': target, 'kind': 'duplicate', 'status': 'fact', 'origin': 'archive',
                    'created': max(records[source][0]['created'], records[target][0]['created'])})
        # Retain the existing matcher's 1000-feature resource bound across roots.
        ordered = sorted(records, key=lambda key: (records[key][0]['created'], key), reverse=True)
        bounded_features = {key: features[key] for key in ordered if key in features}
        if len(bounded_features) > 1000:
            issues.append({'code': 'CATALOG_MATCH_LIMIT'})
            bounded_features = dict(list(bounded_features.items())[:1000])
        relations.extend(r for r in match_features(bounded_features)
                         if r['id'] not in aggregate['dismissed'] and
                         records[r['source']][3]['id'] != records[r['target']][3]['id'])
        if len(relations) > 5000:
            issues.append({'code': 'CATALOG_RELATION_LIMIT'})
            relations = sorted(relations, key=lambda r: (r['origin'] != 'manual', r['id']))[:5000]
        self.check_generations(generations)
        if not metadata_only:
            catalog.session.catalog_relations = {r['id']: r for r in relations}
        return {'records': records, 'ordered': ordered, 'features': bounded_features, 'relations': relations,
                'issues': issues, 'state': aggregate, 'generations': generations, 'root_revisions': root_revisions,
                'root_indexes': root_indexes, 'root_truncated': truncated, 'budget': budget}

    def check_generations(self, generations):
        for identifier, generation in generations.items():
            root = self.catalog._root(identifier)
            grant, _ = self.catalog.grant(root)
            if grant['generation'] != generation:
                raise SafetyError('CATALOG_AUTHORIZATION_REQUIRED')

    def listing(self, offset=0, limit=1000):
        metadata = self.snapshot(metadata_only=True)
        total = len(metadata['ordered'])
        effective_limit = min(limit, 800) if total > 1000 else limit
        page = metadata['ordered'][offset:offset + effective_limit]
        # Advance by the actual bounded primary page, allowing a later cursor
        # to verify large files that would otherwise remain perpetually skipped.
        planned_bytes = 0
        bounded_page = []
        for key in page:
            size = metadata['records'][key][1]['size']
            if bounded_page and planned_bytes + size > VERIFY_MAX_BYTES:
                break
            bounded_page.append(key)
            planned_bytes += size
        page = bounded_page
        effective_limit = len(page)
        members = set(page)
        candidates = [r for r in metadata['relations'] if r['source'] in members or r['target'] in members]
        related = sorted({key for r in candidates for key in (r['source'], r['target']) if key not in members})
        related_limit = min(200, 1000 - len(page))
        relations_truncated = len(related) > related_limit
        related = related[:related_limit]
        bounded_related = []
        for key in related:
            size = metadata['records'][key][1]['size']
            if planned_bytes + size > VERIFY_MAX_BYTES:
                relations_truncated = True
                continue
            bounded_related.append(key)
            planned_bytes += size
        related = bounded_related
        snapshot = self.snapshot(selected=members | set(related))
        page_issues = [issue for issue in snapshot['issues'] if issue.get('entry_id') in members]
        if snapshot['budget'].limited:
            page_issues.append({'code': 'CATALOG_VERIFY_BUDGET'})
        if relations_truncated:
            page_issues.append({'code': 'CATALOG_RELATED_LIMIT'})
        state = snapshot['state']
        selected = members | set(related)
        return {'items': [snapshot['records'][key][0] for key in page],
            'related_items': [snapshot['records'][key][0] for key in related],
            'relations': [r for r in snapshot['relations'] if (r['source'] in members or r['target'] in members)
                          and r['source'] in selected and r['target'] in selected],
            'total': total, 'offset': offset, 'limit': limit, 'effective_limit': effective_limit,
            'next_offset': offset + len(page) if offset + len(page) < total else None,
            'truncated': snapshot['root_truncated'] or total > len(page),
            'relations_truncated': relations_truncated or snapshot['budget'].limited,
            'verification': {'bytes': snapshot['budget'].bytes, 'max_bytes': VERIFY_MAX_BYTES,
                             'max_seconds': VERIFY_SECONDS, 'limited': snapshot['budget'].limited},
            'roots': self.catalog.states()['roots'], 'root_revisions': snapshot['root_revisions'],
            'root_indexes': snapshot['root_indexes'],
            'index': {'count': len(snapshot['features']), 'revision': state['revision'], 'updated': state['updated'],
                      'state': 'ready' if snapshot['features'] else 'empty', 'issues': page_issues}}

    def preview(self, identifier):
        snapshot = self.snapshot(metadata_only=True)
        record = snapshot['records'].get(identifier)
        if record is None:
            raise SafetyError('GRAPH_ENTRY_NOT_FOUND')
        entry, item, identity, _, service = record
        verify(service, item, identity, snapshot['budget'])
        payload = service.read(entry['original_entry_id'], local=False)
        self.check_generations(snapshot['generations'])
        _, item, identity, _, service = record
        verify(service, item, identity, snapshot['budget'])
        return payload

    def evidence(self, identifier):
        snapshot = self.snapshot(metadata_only=True)
        relation = next((r for r in snapshot['relations'] if r['id'] == identifier), None)
        if relation is None:
            raise SafetyError('GRAPH_RELATION_NOT_FOUND')
        files = []
        for key in (relation['source'], relation['target']):
            entry, item, identity, _, service = snapshot['records'][key]
            verify(service, item, identity, snapshot['budget'])
            payload = service.read(entry['original_entry_id'])
            text = payload.get('text', '')[:12000]
            terms = text_features(text)['terms']
            intervals = [positions[0] for term in relation.get('keywords', []) if (positions := terms.get(term))]
            excerpts = [text[max(0, a - 55):min(len(text), b + 80)] for a, b in intervals[:3]]
            if not excerpts and text:
                excerpts = [text[:240]]
            from .content_quality import assess_content
            quality = assess_content(payload, bool(payload.get('local_image')))
            scope = payload.get('sampling', {}).get('summary') or payload.get('sample', '有界本机读取')
            files.append({'id': key, 'name': entry['name'], 'root_id': entry['root_id'], 'source_alias': entry['source_alias'],
                          'excerpts': excerpts, 'summary': '已重新核验当前归档副本。' + scope + '。' + quality['summary']})
        # Both endpoints remain authorized and verified at the publication boundary.
        self.check_generations(snapshot['generations'])
        for key in (relation['source'], relation['target']):
            _, item, identity, _, service = snapshot['records'][key]
            verify(service, item, identity, snapshot['budget'])
        explanation = ('归档时 SHA-256 相同；当前双方副本已重新核验。' if relation['kind'] == 'duplicate' else
                       '本机内容相似线索，仍为待确认候选；不能据此推断引用或版本事实。' if relation['origin'] == 'automatic' else
                       '人工维护的关系；不代表内容推断。')
        return {'relation': relation, 'files': files, 'explanation': explanation}

    def add(self, source, target, kind, revision, candidate_id=None):
        snapshot = self.snapshot(metadata_only=True)
        if source == target:
            raise SafetyError('GRAPH_SELF_LINK')
        if source not in snapshot['records'] or target not in snapshot['records']:
            raise SafetyError('GRAPH_ENTRY_NOT_FOUND')
        source_entry = snapshot['records'][source][0]
        target_entry = snapshot['records'][target][0]
        for key in (source, target):
            entry, item, identity, _, service = snapshot['records'][key]
            if entry['availability'] != 'available':
                raise SafetyError('GRAPH_ENTRY_CHANGED')
            verify(service, item, identity, snapshot['budget'])
        if candidate_id:
            candidate = next((r for r in snapshot['relations'] if r['id'] == candidate_id), None)
            if candidate is None or candidate['origin'] != 'automatic' or {source, target} != {candidate['source'], candidate['target']}:
                raise SafetyError('GRAPH_CANDIDATE_INVALID')
            self.evidence(candidate_id)
        import uuid
        from .journal import stamp
        relation = {'id': hashlib.sha256(uuid.uuid4().bytes).hexdigest(), 'source': source, 'target': target,
            'source_root_id': source_entry['root_id'], 'target_root_id': target_entry['root_id'],
            'kind': kind, 'status': 'confirmed', 'origin': 'manual', 'created': stamp()}
        def mutate(state):
            if any({r['source'], r['target']} == {source, target} and r['kind'] == kind for r in state['relations']):
                raise SafetyError('GRAPH_RELATION_EXISTS')
            state['relations'].append(relation)
            if candidate_id:
                state['dismissed'] = list(dict.fromkeys([*state['dismissed'], candidate_id]))
        self.catalog.commit_relations(revision, [snapshot['records'][key][3] for key in (source, target)], mutate)
        return self.listing()

    def dismiss(self, identifier, revision):
        snapshot = self.snapshot(metadata_only=True)
        relation = next((r for r in snapshot['relations'] if r['id'] == identifier), None)
        if relation is None:
            raise SafetyError('GRAPH_RELATION_NOT_FOUND')
        if relation['origin'] != 'automatic':
            raise SafetyError('GRAPH_CANDIDATE_INVALID')
        for key in (relation['source'], relation['target']):
            _, item, identity, _, service = snapshot['records'][key]
            verify(service, item, identity, snapshot['budget'])
        self.catalog.commit_relations(revision, [snapshot['records'][key][3] for key in (relation['source'], relation['target'])], lambda state: state.update(
            dismissed=list(dict.fromkeys([*state['dismissed'], identifier]))))
        return self.listing()

    def delete(self, identifier, revision):
        snapshot = self.snapshot(metadata_only=True)
        state = self.catalog.relations.require()
        relation = next((r for r in state['relations'] if r['id'] == identifier), None)
        if relation is None:
            raise SafetyError('GRAPH_RELATION_NOT_FOUND')
        if relation['source'] not in snapshot['records'] or relation['target'] not in snapshot['records']:
            raise SafetyError('CATALOG_AUTHORIZATION_REQUIRED')
        self.catalog.commit_relations(revision, [snapshot['records'][key][3] for key in (relation['source'], relation['target'])], lambda current: current.update(
            relations=[r for r in current['relations'] if r['id'] != identifier]))
        return self.listing()
