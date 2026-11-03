import hashlib
import json
import os
from datetime import datetime, timezone

from .files import SafetyError
from .safe_io import metadata_file

MAX_JOURNAL_BYTES = 2 * 1024 * 1024
MAX_JOURNAL_EVENTS = 1200


def read_bounded(stream):
    if os.fstat(stream.fileno()).st_size > MAX_JOURNAL_BYTES:
        raise SafetyError('JOURNAL_TOO_LARGE')
    data = stream.read(MAX_JOURNAL_BYTES + 1)
    if len(data) > MAX_JOURNAL_BYTES:
        raise SafetyError('JOURNAL_TOO_LARGE')
    return data.decode('utf-8')


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stamp():
    return datetime.now(timezone.utc).isoformat()


class Journal:
    def __init__(self, path):
        self.path = path

    def read(self):
        try:
            with metadata_file(self.path) as stream:
                return self._decode(read_bounded(stream))
        except (OSError, UnicodeError) as exc:
            raise SafetyError('JOURNAL_CORRUPT') from exc

    def _decode(self, text):
        previous = "0" * 64
        events = []
        try:
            if not text.endswith('\n'):
                raise ValueError('incomplete final record')
            for number, line in enumerate(text[:-1].split('\n'), 1):
                if number > MAX_JOURNAL_EVENTS:
                    raise ValueError('event limit')
                row = json.loads(line)
                if not isinstance(row, dict) or set(row) != {'seq', 'previous', 'time', 'event', 'data', 'hash'}:
                    raise ValueError('record schema')
                if not isinstance(row['data'], dict) or not isinstance(row['event'], str) or not isinstance(row['time'], str):
                    raise ValueError('event schema')
                if row['event'] not in {'planned', 'item', 'finished', 'undo_started', 'acknowledged', 'trust_failed'}:
                    raise ValueError('event kind')
                digest = row.pop("hash")
                if row["seq"] != number or row["previous"] != previous:
                    raise ValueError("chain")
                if hashlib.sha256(encode(row).encode()).hexdigest() != digest:
                    raise ValueError("digest")
                previous = digest
                row["hash"] = digest
                events.append(row)
            if not events or events[0]["event"] != "planned":
                raise ValueError("missing plan")
            from .records import validate_plan
            validate_plan(events[0]['data'])
            return events
        except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
            raise SafetyError("JOURNAL_CORRUPT") from exc

    def append(self, event, data):
        # One validated no-follow handle spans read/append/fsync: no leaf swap gap.
        with metadata_file(self.path, write=True) as stream:
            text = read_bounded(stream)
            events = self._decode(text) if text else []
            row = {"seq": len(events) + 1, "previous": events[-1]["hash"] if events else "0" * 64,
                   "time": stamp(), "event": event, "data": data}
            row["hash"] = hashlib.sha256(encode(row).encode()).hexdigest()
            stream.seek(0, 2)
            encoded = (encode(row) + "\n").encode('utf-8')
            if len(text.encode('utf-8')) + len(encoded) > MAX_JOURNAL_BYTES or len(events) >= MAX_JOURNAL_EVENTS:
                raise SafetyError('JOURNAL_TOO_LARGE')
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
