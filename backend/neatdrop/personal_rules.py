"""Installation-local, directory-bound personal classification rules."""
import copy
import hashlib
import json
import os
import re
import tempfile
import time
import unicodedata
import uuid

from .files import SafetyError, SUPPORTED
from .safe_io import directory_pin, metadata_file
from .journal import stamp
from .taxonomy import GROUPS, SUBCATEGORIES
from .trust import _LOCK, root_key

MAX_RULES = 50
MAX_BYTES = 256 * 1024


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


class PersonalRules:
    def __init__(self, executor):
        self.executor = executor
        self.ws = executor.ws
        self.store_root = executor.trust.path / 'classification-rules'
        self.path = self.store_root / (hashlib.sha256(json.dumps(root_key(self.ws), sort_keys=True).encode()).hexdigest() + '.json')

    def _read(self):
        try:
            with self.executor.trust._guard(), _LOCK:
                self.store_root.mkdir(parents=True, exist_ok=True)
                if self.store_root.is_symlink():
                    raise SafetyError('PERSONAL_RULE_STORE_UNAVAILABLE')
                with directory_pin(self.store_root):
                    if not self.path.exists() and not self.path.is_symlink():
                        return {'revision': 0, 'rules': []}
                    with metadata_file(self.path) as stream:
                        raw = stream.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError('oversized store')
                data = json.loads(raw)
                if (not isinstance(data, dict) or type(data.get('revision')) is not int or not 0 <= data['revision'] < 2**53 or
                        not isinstance(data.get('rules'), list) or len(data['rules']) > MAX_RULES):
                    raise ValueError('invalid store')
                seen = set()
                for rule in data['rules']:
                    if (not isinstance(rule, dict) or set(rule) != {'id', 'name', 'keywords', 'extensions',
                            'category', 'subcategory', 'enabled', 'created'} or
                            not isinstance(rule.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', rule['id']) or
                            rule['id'] in seen or type(rule.get('enabled')) is not bool or
                            not isinstance(rule.get('created'), str)):
                        raise ValueError('invalid rule')
                    seen.add(rule['id'])
                    validated = self.validate({key: rule[key] for key in
                        ('name', 'keywords', 'extensions', 'category', 'subcategory')})
                    if validated != {key: rule[key] for key in validated}:
                        raise ValueError('noncanonical rule')
                return data
        except SafetyError:
            raise
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            raise SafetyError('PERSONAL_RULE_STORE_UNAVAILABLE') from exc

    def _write(self, data):
        raw = json.dumps(data, ensure_ascii=True, separators=(',', ':')).encode()
        if len(raw) > MAX_BYTES:
            raise SafetyError('PERSONAL_RULE_LIMIT')
        temp = None
        try:
            with self.executor.trust._guard(), _LOCK:
                self.store_root.mkdir(parents=True, exist_ok=True)
                if self.store_root.is_symlink():
                    raise SafetyError('PERSONAL_RULE_STORE_UNAVAILABLE')
                with directory_pin(self.store_root):
                    if self.path.exists() or self.path.is_symlink():
                        with metadata_file(self.path):
                            pass
                    descriptor, temp = tempfile.mkstemp(prefix='.personal-rule-', dir=self.store_root)
                    os.close(descriptor)
                    with metadata_file(temp, write=True) as stream:
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temp, self.path)
                    temp = None
        except SafetyError:
            raise
        except OSError as exc:
            raise SafetyError('PERSONAL_RULE_STORE_UNAVAILABLE') from exc
        finally:
            if temp:
                try:
                    os.unlink(temp)
                except OSError:
                    pass

    def listing(self):
        try:
            data = self._read()
            return {'revision': data['revision'], 'rules': copy.deepcopy(data['rules']), 'available': True}
        except SafetyError:
            return {'revision': None, 'rules': [], 'available': False}

    def validate(self, draft):
        required = {'name', 'keywords', 'extensions', 'category', 'subcategory'}
        if not isinstance(draft, dict) or set(draft) - (required | {'rule_id'}) or not required <= set(draft):
            raise SafetyError('PERSONAL_RULE_INVALID_INPUT')
        name = draft['name'].strip() if isinstance(draft['name'], str) else ''
        if not 1 <= len(name) <= 60:
            raise SafetyError('PERSONAL_RULE_INVALID_NAME')
        keywords = draft['keywords']
        if not isinstance(keywords, list) or not 2 <= len(keywords) <= 5 or any(not isinstance(k, str) for k in keywords):
            raise SafetyError('PERSONAL_RULE_INVALID_KEYWORDS')
        keywords = [normalize(k) for k in keywords]
        if any(not 2 <= len(k) <= 40 for k in keywords) or len(set(keywords)) != len(keywords):
            raise SafetyError('PERSONAL_RULE_INVALID_KEYWORDS')
        if any(a in b or b in a for i, a in enumerate(keywords) for b in keywords[i + 1:]):
            raise SafetyError('PERSONAL_RULE_INVALID_KEYWORDS')
        extensions = draft['extensions']
        if (not isinstance(extensions, list) or not extensions or len(extensions) > len(SUPPORTED) or
                any(not isinstance(ext, str) or ext.lower() not in SUPPORTED for ext in extensions)):
            raise SafetyError('PERSONAL_RULE_INVALID_EXTENSIONS')
        category, subcategory = draft['category'], draft['subcategory']
        if category not in GROUPS:
            raise SafetyError('PERSONAL_RULE_INVALID_CATEGORY')
        if subcategory is not None and subcategory not in SUBCATEGORIES[category]:
            raise SafetyError('PERSONAL_RULE_INVALID_SUBCATEGORY')
        return {'name': name, 'keywords': keywords, 'extensions': sorted(set(e.lower() for e in extensions)),
                'category': category, 'subcategory': subcategory}

    def save(self, draft, preview_token, confirmed):
        raise SafetyError('PERSONAL_RULE_PREVIEW_REQUIRED')

    def preview(self, draft, samples, revision):
        normalized = self.validate(draft)
        data = self._read()
        if data['revision'] != revision:
            raise SafetyError('PERSONAL_RULE_STALE_REVISION')
        existing_id = draft.get('rule_id')
        if existing_id and not any(r['id'] == existing_id for r in data['rules']):
            raise SafetyError('PERSONAL_RULE_NOT_FOUND')
        if not existing_id and len(data['rules']) >= MAX_RULES:
            raise SafetyError('PERSONAL_RULE_LIMIT')
        matched, evaluated, excluded = [], 0, 0
        for row in samples[:50]:
            text = row.get('text', '')
            if (row.get('quality', {}).get('state') != 'acceptable' or not isinstance(text, str) or
                    not text.strip() or row.get('extension', '').lower() not in normalized['extensions']):
                excluded += 1
                continue
            evaluated += 1
            body = normalize(text[:12000])
            hits = [word for word in normalized['keywords'] if word in body]
            if len(hits) == len(normalized['keywords']):
                matched.append({'file_id': row['file_id'], 'name': row['name'], 'keywords': hits})
        if existing_id:
            previous = next(r for r in data['rules'] if r['id'] == existing_id)
            public_rule = {**previous, **normalized, 'enabled': True}
        else:
            public_rule = {**normalized, 'id': '', 'enabled': True}
        return {'revision': revision, 'rule': public_rule, 'matched': matched,
                'evaluated': evaluated, 'excluded': excluded, 'total': len(samples[:50])}

    def commit(self, draft, revision, rule_id=None):
        with _LOCK:
            data = self._read()
            if data['revision'] != revision:
                raise SafetyError('PERSONAL_RULE_STALE_REVISION')
            rule_data = self.validate(draft)
            now = stamp()
            if rule_id:
                rule = next((r for r in data['rules'] if r['id'] == rule_id), None)
                if not rule:
                    raise SafetyError('PERSONAL_RULE_NOT_FOUND')
                rule.update(rule_data, enabled=True)
            else:
                if len(data['rules']) >= MAX_RULES:
                    raise SafetyError('PERSONAL_RULE_LIMIT')
                rule = {**rule_data, 'id': uuid.uuid4().hex, 'enabled': True, 'created': now}
                data['rules'].append(rule)
            data['revision'] += 1
            self._write(data)
        return self.listing()

    def disable(self, identifier, revision):
        with _LOCK:
            data = self._read()
            if data['revision'] != revision:
                raise SafetyError('PERSONAL_RULE_STALE_REVISION')
            rule = next((r for r in data['rules'] if r['id'] == identifier), None)
            if not rule:
                raise SafetyError('PERSONAL_RULE_NOT_FOUND')
            rule['enabled'] = False
            data['revision'] += 1
            self._write(data)
        return self.listing()

    def delete(self, identifier, revision, confirmed):
        if not confirmed:
            raise SafetyError('CONFIRMATION_REQUIRED')
        with _LOCK:
            data = self._read()
            if data['revision'] != revision:
                raise SafetyError('PERSONAL_RULE_STALE_REVISION')
            if not any(r['id'] == identifier for r in data['rules']):
                raise SafetyError('PERSONAL_RULE_NOT_FOUND')
            data['rules'] = [r for r in data['rules'] if r['id'] != identifier]
            data['revision'] += 1
            self._write(data)
        return self.listing()
