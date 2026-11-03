"""Strict validation for untrusted journal fields before recovery uses them."""
import hashlib
import re
from pathlib import PurePosixPath

from .files import MAX_FILES, MAX_FILE, MAX_TOTAL, SafetyError, safe_name
from .taxonomy import allowed_parent


def valid_hex(value, length):
    return isinstance(value, str) and re.fullmatch(f'[a-f0-9]{{{length}}}', value) is not None


def validate_item(item):
    if not isinstance(item, dict) or not valid_hex(item.get('file_id'), 24) or not valid_hex(item.get('sha256'), 64):
        raise SafetyError('JOURNAL_CORRUPT')
    source, target = item.get('source'), item.get('target')
    if not isinstance(source, str) or not isinstance(target, str):
        raise SafetyError('JOURNAL_CORRUPT')
    safe_name(source, PurePosixPath(source).suffix)
    if item['file_id'] != hashlib.sha256(source.encode()).hexdigest()[:24]:
        raise SafetyError('JOURNAL_CORRUPT')
    parts = target.split('/')
    if len(parts) not in {2, 3} or not allowed_parent('/'.join(parts[:-1])):
        raise SafetyError('JOURNAL_CORRUPT')
    safe_name(parts[-1], PurePosixPath(source).suffix)
    if type(item.get('size')) is not int or not 0 < item['size'] <= MAX_FILE:
        raise SafetyError('JOURNAL_CORRUPT')
    if item.get('stage') not in {'planned', 'copying', 'completed', 'failed', 'undone'}:
        raise SafetyError('JOURNAL_CORRUPT')


def validate_plan(plan):
    from .journal import encode
    if not isinstance(plan, dict) or not valid_hex(plan.get('id'), 32) or plan.get('mode') != 'copy':
        raise SafetyError('JOURNAL_CORRUPT')
    if not isinstance(plan.get('created'), str) or not valid_hex(plan.get('digest'), 64):
        raise SafetyError('JOURNAL_CORRUPT')
    items = plan.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_FILES:
        raise SafetyError('JOURNAL_CORRUPT')
    for item in items:
        validate_item(item)
    if len({i['file_id'] for i in items}) != len(items) or sum(i['size'] for i in items) > MAX_TOTAL:
        raise SafetyError('JOURNAL_CORRUPT')
    payload = {k: v for k, v in plan.items() if k != 'digest'}
    if hashlib.sha256(encode(payload).encode()).hexdigest() != plan['digest']:
        raise SafetyError('JOURNAL_CORRUPT')
