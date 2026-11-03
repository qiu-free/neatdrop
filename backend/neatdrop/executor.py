import copy
import hashlib
import os
import re
import time
import uuid
import itertools
from threading import RLock
from pathlib import Path

from .files import CATEGORIES, SafetyError, canonical, checked_path, digest_file, safe_name, protected
from .journal import Journal, encode, stamp
from .safe_io import copy_exclusive, root_lock, withdraw_windows
from .taxonomy import destination, allowed_parent
from .trust import TrustStore
from .records import validate_item


class Executor:
    def __init__(self, workspace, trust_store=None):
        self.ws = workspace
        self.plans = {}
        self.lock = RLock()
        self.progress_lock = RLock()
        self.progress = {}
        self.trust = trust_store or TrustStore()

    def _require_clear_history(self):
        if any(t["status"] in {"incomplete", "corrupt", "partial"} and not t.get("acknowledged") for t in self.history()):
            raise SafetyError("RECOVERY_REQUIRED")

    @protected
    def plan(self, edits):
        with self.lock:
            self.plans = {key: value for key, value in self.plans.items() if time.monotonic() - value[1] <= 900}
            if len(self.plans) >= 32:
                raise SafetyError('PLAN_LIMIT')
            return self._plan(edits)

    def _plan(self, edits):
        self._require_clear_history()
        self.ws.selected([edit["file_id"] for edit in edits])
        used = set()
        items = []
        for edit in edits:
            record = self.ws.record(edit["file_id"])
            name = safe_name(edit["name"], record["extension"])
            if edit["category"] not in CATEGORIES:
                raise SafetyError("INVALID_CATEGORY")
            folder = destination(edit['category'], edit.get('subcategory'))
            directory = checked_path(self.ws.root, folder)
            if directory.exists():
                if not directory.is_dir():
                    raise SafetyError("TARGET_CONFLICT")
                used.update(canonical(f"{folder}/{p.name}") for p in directory.iterdir())
            candidate = f"{folder}/{name}"
            counter = 2
            while canonical(candidate) in used:
                candidate = f"{folder}/{Path(name).stem} ({counter}){record['extension']}"
                counter += 1
            safe_name(Path(candidate).name, record["extension"])
            if len(str(self.ws.root / candidate)) > 240:
                raise SafetyError("PATH_TOO_LONG")
            used.add(canonical(candidate))
            source = checked_path(self.ws.root, record["name"])
            if digest_file(source) != record["sha256"]:
                raise SafetyError("SOURCE_CHANGED")
            items.append({"file_id": record["id"], "source": record["name"],
                          "target": candidate, "sha256": record["sha256"], "size": record["size"], "stage": "planned"})
        plan = {"id": uuid.uuid4().hex, "created": stamp(), "mode": "copy", "items": items}
        plan["digest"] = hashlib.sha256(encode(plan).encode()).hexdigest()
        self.plans[plan["id"]] = (copy.deepcopy(plan), time.monotonic())
        return plan

    def execution_status(self, plan_id):
        """Memory-only observation. Reading never claims a plan or replays work."""
        with self.progress_lock:
            snapshot = self.progress.get(plan_id)
            if snapshot and time.monotonic() - snapshot['updated'] <= 8 * 3600:
                return copy.deepcopy({key: value for key, value in snapshot.items() if key != 'updated'})
        with self.lock:
            stored = self.plans.get(plan_id)
            if stored and time.monotonic() - stored[1] <= 900:
                plan = copy.deepcopy(stored[0])
                return {'plan_id': plan_id, 'status': 'planned', 'processed': 0,
                        'total': len(plan['items']), 'current_file': None, 'items': plan['items'], 'error': None}
            # A writer may have claimed the plan after our first progress read.
            # Claim and initial publication share self.lock, so this recheck sees it.
            with self.progress_lock:
                snapshot = self.progress.get(plan_id)
                if snapshot and time.monotonic() - snapshot['updated'] <= 8 * 3600:
                    return copy.deepcopy({key: value for key, value in snapshot.items() if key != 'updated'})
        raise SafetyError('EXECUTION_STATUS_NOT_FOUND')

    def _progress_start(self, plan):
        with self.progress_lock:
            # Keep observation bounded independently of journal and receipt writes.
            stale = [key for key, value in self.progress.items() if value['status'] != 'running']
            for key in stale[:max(0, len(self.progress) - 63)]:
                self.progress.pop(key, None)
            self.progress[plan['id']] = {'plan_id': plan['id'], 'status': 'running',
                'processed': 0, 'total': len(plan['items']), 'current_file': None,
                'items': copy.deepcopy(plan['items']), 'error': None, 'updated': time.monotonic()}

    def _progress_item(self, plan_id, item, stage, error=None):
        with self.progress_lock:
            state = self.progress[plan_id]
            for value in state['items']:
                if value['file_id'] == item['file_id']:
                    value.update(stage=stage, error=error)
                    break
            state['current_file'] = item['source'] if stage == 'copying' else None
            state['processed'] = sum(value['stage'] in {'completed', 'failed'} for value in state['items'])
            state['updated'] = time.monotonic()

    @protected
    def execute(self, plan_id, digest, confirmed):
        if os.name != 'nt':
            raise SafetyError('EXECUTION_UNSUPPORTED')
        if not confirmed:
            raise SafetyError("CONFIRMATION_REQUIRED")
        stored = self.plans.get(plan_id)
        if not stored or stored[0]["digest"] != digest or time.monotonic() - stored[1] > 900:
            raise SafetyError("PLAN_INVALID_OR_EXPIRED")
        with root_lock(self.ws.root):
            self._require_clear_history()
            directory = checked_path(self.ws.root, '.neatdrop/transactions')
            if directory.exists() and len(list(itertools.islice(directory.iterdir(), 500))) >= 500:
                raise SafetyError('HISTORY_LIMIT')
            with self.lock:
                stored = self.plans.pop(plan_id, None)
                if not stored or stored[0]['digest'] != digest or time.monotonic() - stored[1] > 900:
                    raise SafetyError('PLAN_INVALID_OR_EXPIRED')
                plan = stored[0]
                self._progress_start(plan)
            try:
                result = self._perform(plan)
            except Exception as exc:
                with self.progress_lock:
                    self.progress[plan_id].update(status='interrupted', current_file=None,
                        error=exc.code if isinstance(exc, SafetyError) else 'LOCAL_IO_FAILED', updated=time.monotonic())
                raise
            with self.progress_lock:
                self.progress[plan_id].update(status=result['status'], current_file=None,
                    transaction=copy.deepcopy(result), updated=time.monotonic())
            return result

    def _perform(self, plan):
        plan_id = plan['id']
        log = Journal(checked_path(self.ws.root, f".neatdrop/transactions/{plan_id}/journal.jsonl", mkdir=True))
        log.append("planned", plan)
        identities = {}
        for item in plan["items"]:
            try:
                source = checked_path(self.ws.root, item["source"])
                if digest_file(source) != item["sha256"]:
                    raise SafetyError("SOURCE_CHANGED")
                target = checked_path(self.ws.root, item["target"], mkdir=True)
                if any(canonical(p.name) == canonical(target.name) for p in target.parent.iterdir()):
                    raise SafetyError("TARGET_CONFLICT")
                log.append("item", {**item, "stage": "copying"})
                self._progress_item(plan_id, item, 'copying')
                identity = copy_exclusive(source, target, item["sha256"])
                log.append("item", {**item, "stage": "completed"})
                identities[item['file_id']] = identity
                self._progress_item(plan_id, item, 'completed')
            except (OSError, SafetyError) as exc:
                code = exc.code if isinstance(exc, SafetyError) else "TARGET_CONFLICT" if isinstance(exc, FileExistsError) else "IO_FAILED"
                # Journal failure propagates: no further filesystem work is started.
                log.append("item", {**item, "stage": "failed", "error": code})
                self._progress_item(plan_id, item, 'failed', code)
                if code not in {"SOURCE_CHANGED", "TARGET_CONFLICT"}:
                    break
        try:
            self.trust.save(self.ws, plan, identities)
        except SafetyError:
            log.append('trust_failed', {})
            raise
        log.append("finished", {})
        return self._summary(plan_id, log)

    def _log(self, transaction_id):
        if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
            raise SafetyError("INVALID_TRANSACTION")
        return Journal(checked_path(self.ws.root, f".neatdrop/transactions/{transaction_id}/journal.jsonl"))

    def _summary(self, identifier, log):
        try:
            events = log.read()
            plan = events[0]["data"]
            if plan["id"] != identifier or not isinstance(plan["items"], list):
                raise SafetyError("JOURNAL_CORRUPT")
            items = {item["file_id"]: dict(item) for item in plan["items"]}
            pending_undo = set()
            acknowledged = False
            for event in events:
                if event["event"] == "undo_started":
                    pending_undo.add(event["data"]["file_id"])
                    acknowledged = False
                if event["event"] == 'acknowledged':
                    acknowledged = True
                if event["event"] == "item":
                    item = event["data"]
                    validate_item(item)
                    if item["file_id"] not in items:
                        raise SafetyError("JOURNAL_CORRUPT")
                    original = items[item['file_id']]
                    if any(item.get(key) != original[key] for key in ('source', 'target', 'sha256', 'size')):
                        raise SafetyError('JOURNAL_CORRUPT')
                    original.update(stage=item['stage'], error=item.get('error'))
                    pending_undo.discard(item["file_id"])
            finished = any(e["event"] == "finished" for e in events)
            stages = {i["stage"] for i in items.values()}
            status = "completed" if stages == {"completed"} else "undone" if stages == {"undone"} else "partial"
            if not finished or pending_undo or any(e['event'] == 'trust_failed' for e in events):
                status = "incomplete"
            receipt = self.trust.load(self.ws, plan)
            return {"id": identifier, "created": plan["created"], "mode": "copy", "status": status,
                    "items": list(items.values()), "acknowledged": acknowledged,
                    'undo_verified': receipt is not None, 'legacy_read_only': receipt is None}
        except (SafetyError, KeyError, TypeError, ValueError):
            return {"id": identifier, "status": "corrupt", "items": [], "created": "", "acknowledged": False, 'undo_verified': False}

    @protected
    def history(self):
        directory = checked_path(self.ws.root, ".neatdrop/transactions")
        if not directory.exists():
            return []
        entries = list(itertools.islice(directory.iterdir(), 501))
        if len(entries) > 500:
            raise SafetyError('HISTORY_LIMIT')
        result = []
        for path in entries:
            if re.fullmatch(r'[a-f0-9]{32}', path.name):
                try:
                    result.append(self._summary(path.name, self._log(path.name)))
                except SafetyError:
                    result.append({'id': path.name, 'status': 'corrupt', 'items': [], 'created': '', 'acknowledged': False, 'undo_verified': False})
        return sorted(result, key=lambda t: t['created'], reverse=True)

    @protected
    def acknowledge(self, transaction_id):
        with root_lock(self.ws.root):
            log = self._log(transaction_id)
            summary = self._summary(transaction_id, log)
            if summary["status"] == "corrupt":
                raise SafetyError("JOURNAL_CORRUPT")
            if not summary['acknowledged']:
                log.append("acknowledged", {"note": "User retained available files; no replay or deletion"})
        return self._summary(transaction_id, log)

    @protected
    def undo(self, transaction_id):
        with root_lock(self.ws.root):
            self._require_clear_history()
            log = self._log(transaction_id)
            summary = self._summary(transaction_id, log)
            if summary["status"] in {"corrupt", "incomplete"}:
                raise SafetyError("RECOVERY_REQUIRED")
            if len(log.read()) > 1000:
                raise SafetyError('JOURNAL_OPERATION_LIMIT')
            receipt = self.trust.load(self.ws, log.read()[0]['data'])
            if receipt is None:
                raise SafetyError('UNTRUSTED_HISTORY')
            for item in reversed(summary["items"]):
                if item["stage"] != "completed":
                    continue
                identity = receipt['identities'].get(item['file_id'])
                if identity is None:
                    raise SafetyError('UNTRUSTED_HISTORY')
                target_rel = item["target"]
                parts = target_rel.split("/")
                if not allowed_parent('/'.join(parts[:-1])):
                    raise SafetyError("UNSAFE_PATH")
                safe_name(parts[-1], Path(item["source"]).suffix)
                target = checked_path(self.ws.root, target_rel)
                withdrawn = checked_path(self.ws.root, f".neatdrop/withdrawn/{transaction_id}/{item['file_id']}{Path(target_rel).suffix}", mkdir=True)
                try:
                    log.append("undo_started", {"file_id": item["file_id"]})
                    withdraw_windows(target, withdrawn, item["sha256"], identity)
                except (OSError, SafetyError) as exc:
                    code = exc.code if isinstance(exc, SafetyError) else "UNDO_CONFLICT"
                    log.append("item", {**item, "error": code})
                else:
                    # Once renamed, a log failure must remain pending, never become
                    # a misleading 'completed with conflict' item.
                    log.append("item", {**item, "stage": "undone", "error": None})
            return self._summary(transaction_id, log)
