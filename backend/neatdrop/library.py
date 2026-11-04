"""Read-only archive view derived from journals and installation-local receipts."""
import hashlib
import itertools
import re
import stat
from pathlib import PurePosixPath

from .analysis import prepare_input
from .files import SafetyError, checked_path
from .records import valid_hex, validate_item
from .taxonomy import GROUPS, SUBCATEGORIES, destination

MAX_ENTRIES = 1000


def entry_id(transaction_id, file_id):
    return hashlib.sha256(f'{transaction_id}:{file_id}'.encode('ascii')).hexdigest()


def categories(target):
    parent = str(PurePosixPath(target).parent)
    for category in GROUPS:
        if parent == destination(category):
            return category, None
        for subcategory in SUBCATEGORIES[category]:
            if parent == destination(category, subcategory):
                return category, subcategory
    raise SafetyError('JOURNAL_CORRUPT')


class ArchiveLibrary:
    def __init__(self, executor):
        self.executor = executor
        self.ws = executor.ws

    def _transaction(self, transaction_id):
        # Journal.read validates the full plan, digest, safe names, allowed target
        # folders, hash-chain, byte budget and event budget before fields are used.
        events = self.executor._log(transaction_id).read()
        plan = events[0]['data']
        if plan['id'] != transaction_id:
            raise SafetyError('JOURNAL_CORRUPT')
        items = {item['file_id']: dict(item) for item in plan['items']}
        pending = set()
        for event in events[1:]:
            data = event['data']
            if event['event'] == 'planned':
                raise SafetyError('JOURNAL_CORRUPT')
            if event['event'] == 'undo_started':
                if data.get('file_id') not in items:
                    raise SafetyError('JOURNAL_CORRUPT')
                pending.add(data['file_id'])
            if event['event'] == 'item':
                validate_item(data)
                original = items.get(data['file_id'])
                if original is None or any(data[key] != original[key] for key in ('source', 'target', 'sha256', 'size')):
                    raise SafetyError('JOURNAL_CORRUPT')
                if original['stage'] == 'undone' and data['stage'] != 'undone':
                    raise SafetyError('JOURNAL_CORRUPT')
                original['stage'] = data['stage']
                pending.discard(data['file_id'])
        receipt = self.executor.trust.load(self.ws, plan)
        settled = any(event['event'] == 'finished' for event in events) and not any(
            event['event'] == 'trust_failed' for event in events)
        for item in items.values():
            if item['stage'] != 'completed':
                continue
            identity = receipt['identities'].get(item['file_id']) if receipt and settled and item['file_id'] not in pending else None
            category, subcategory = categories(item['target'])
            entry = {'id': entry_id(transaction_id, item['file_id']), 'transaction_id': transaction_id,
                     'name': PurePosixPath(item['target']).name, 'source': item['source'], 'target': item['target'],
                     'category': category, 'subcategory': subcategory, 'created': plan['created'],
                     'size': item['size'], 'availability': 'unverified'}
            yield entry, item, identity

    def _records(self):
        directory = checked_path(self.ws.root, '.neatdrop/transactions')
        if not directory.exists():
            return
        entries = list(itertools.islice(directory.iterdir(), 501))
        if len(entries) > 500:
            raise SafetyError('HISTORY_LIMIT')
        for path in entries:
            if not re.fullmatch(r'[a-f0-9]{32}', path.name):
                continue
            try:
                # Materialize before yielding so malformed later events cannot
                # publish any fields from a partially validated transaction.
                records = list(self._transaction(path.name))
            except (OSError, SafetyError, KeyError, TypeError, ValueError):
                continue
            yield from records

    def _availability(self, item, identity):
        if identity is None:
            return 'unverified'
        try:
            target = checked_path(self.ws.root, item['target'])
            info = target.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size != item['size'] or (
                {'device': info.st_dev, 'inode': info.st_ino} != identity
            ):
                return 'changed'
            return 'available'
        except FileNotFoundError:
            return 'missing'
        except (OSError, SafetyError):
            return 'changed'

    def listing(self):
        records = sorted(self._records(), key=lambda record: (record[0]['created'], record[0]['id']), reverse=True)
        items = []
        for entry, item, identity in records[:MAX_ENTRIES]:
            entry['availability'] = self._availability(item, identity)
            items.append(entry)
        return {'items': items, 'truncated': len(records) > MAX_ENTRIES}

    def preview(self, identifier):
        if not valid_hex(identifier, 64):
            raise SafetyError('LIBRARY_ENTRY_NOT_FOUND')
        for entry, item, identity in self._records():
            if entry['id'] != identifier:
                continue
            availability = self._availability(item, identity)
            if availability != 'available':
                raise SafetyError('LIBRARY_ENTRY_' + availability.upper())
            record = {'name': item['target'], 'extension': PurePosixPath(item['target']).suffix,
                      'sha256': item['sha256'], 'size': item['size']}
            try:
                # The identity/size/hash validation and bounded byte read share
                # one locked handle; prepare_input never reopens to decode.
                return prepare_input(self.ws, record, expected_identity=identity)
            except FileNotFoundError as exc:
                raise SafetyError('LIBRARY_ENTRY_MISSING') from exc
            except OSError as exc:
                raise SafetyError('LIBRARY_ENTRY_CHANGED') from exc
            except SafetyError as exc:
                if exc.code in {'LINK_FORBIDDEN', 'UNSAFE_PATH'}:
                    raise SafetyError('LIBRARY_ENTRY_CHANGED') from exc
                raise
        raise SafetyError('LIBRARY_ENTRY_NOT_FOUND')
