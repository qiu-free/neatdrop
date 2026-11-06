import asyncio
import base64
import hashlib
import io
import re
import time
import uuid
import warnings
import copy
import inspect
import os
import stat
import unicodedata
from threading import BoundedSemaphore, RLock

from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader

from .files import MAX_FILE, SafetyError, checked_path, safe_name
from .journal import stamp
from .model import suggest
from .configuration import ModelConfigSnapshot, get_model_snapshot
from .safe_io import file_identity, locked_reader, protect_workspace
from .classifier import classify_text, fuse_image
from .decision import decide
from .content_quality import assess_content, apply_content_quality

PREPROCESS_SLOTS = BoundedSemaphore(2)


def prepare_input(ws, record, local=False, cancelled=None, *, expected_identity=None, reject_hardlinks=False):
    if not PREPROCESS_SLOTS.acquire(blocking=False):
        raise SafetyError('PARSER_BUSY')
    try:
        return _prepare_input(ws, record, local, cancelled, expected_identity=expected_identity, reject_hardlinks=reject_hardlinks)
    finally:
        PREPROCESS_SLOTS.release()


def _prepare_input(ws, record, local=False, cancelled=None, *, expected_identity=None, reject_hardlinks=False):
    with protect_workspace(ws):
        path = checked_path(ws.root, record["name"])
        with locked_reader(path) as stream:
            before = os.fstat(stream.fileno())
            if reject_hardlinks and before.st_nlink != 1:
                raise SafetyError('LIBRARY_ENTRY_CHANGED')
            if expected_identity is not None and (
                not stat.S_ISREG(before.st_mode) or before.st_size != record['size']
                or before.st_size > MAX_FILE or file_identity(stream.fileno()) != expected_identity
            ):
                raise SafetyError('LIBRARY_ENTRY_CHANGED')
            data = stream.read(MAX_FILE + 1)
            after = os.fstat(stream.fileno())
            if expected_identity is not None and (
                len(data) != record['size'] or after.st_size != before.st_size
                or after.st_mtime_ns != before.st_mtime_ns
                or file_identity(stream.fileno()) != expected_identity
            ):
                raise SafetyError('LIBRARY_ENTRY_CHANGED')
    if len(data) > MAX_FILE or hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise SafetyError('LIBRARY_ENTRY_CHANGED' if expected_identity is not None else 'SOURCE_CHANGED')
    return decode_input(data, record['extension'], local, cancelled)


def decode_input(data, extension, local=False, cancelled=None):
    """Decode already bounded, verified bytes without opening another file."""
    ext = extension.lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as original:
                    if original.width * original.height > 24_000_000 or max(original.size) > 16000:
                        raise SafetyError('IMAGE_PIXEL_LIMIT')
                    if getattr(original, "n_frames", 1) != 1:
                        raise SafetyError("ANIMATED_IMAGE_UNSUPPORTED")
                    image = ImageOps.exif_transpose(original)
                    if local:
                        from .offline import analyze_image_bounded
                        extracted = analyze_image_bounded(image, cancelled=cancelled)
                        return {**extracted, 'sample': extracted.get('sampling', {}).get('summary', '本地 OCR + 视觉候选；未联网'), 'local_image': True}
                    image.thumbnail((1024, 1024))
                    image = image.convert("RGB")
                    output = io.BytesIO()
                    image.save(output, format="JPEG", quality=80)
                    return {"image": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode(),
                            "width": image.width, "height": image.height, "sample": "1024px thumbnail; EXIF removed"}
        except (OSError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise SafetyError("IMAGE_DECODE_FAILED") from exc
    if ext == ".pdf":
        from .parsing import parse_pdf
        kwargs = {'cancelled': cancelled} if local and cancelled else {}
        return parse_pdf(data, limit=12000 if local else 1500, **kwargs)
    if ext in {'.docx', '.pptx', '.xlsx', '.csv'}:
        from .parsing import parse_document
        return parse_document(data, ext, limit=12000 if local else 1500, cancelled=cancelled)
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise SafetyError("INVALID_UTF8") from exc
        if "\x00" in text or any(ord(c) < 9 for c in text):
            raise SafetyError("BINARY_TEXT")
        if local:
            from .extraction import sample_text
            return sample_text(text)
        sample = "First 1500 characters"
    limit = 12000 if local else 1500
    return {"text": text[:limit], "sample": sample, "truncated": len(text) > limit}


def local_semantic(text, cancelled=None):
    if os.getenv('NEATDROP_SEMANTIC_CANDIDATES') != '1':
        return None
    from .semantic import classify_semantic
    if not text.strip():
        return None
    return classify_semantic(text, cancelled=cancelled) if cancelled else classify_semantic(text)


def _evidence_interval(text, excerpt):
    """Find a verified raw interval; normalized offsets are never raw offsets."""
    text = text[:12000]
    if not excerpt:
        return None
    offset = text.find(excerpt)
    if offset >= 0:
        return offset, offset + len(excerpt)

    # Legacy rules can return normalized snippets (case, width, composition).
    # Locate them in the same normalization, map both boundaries back through
    # raw prefixes, then verify the complete raw slice before publishing it.
    def normalized(value):
        return unicodedata.normalize('NFKC', value).casefold()

    needle = normalized(excerpt)
    offset = normalized(text).find(needle)
    if offset < 0:
        return None

    def boundary(position):
        low, high = 0, len(text)
        while low < high:
            middle = (low + high + 1) // 2
            if len(normalized(text[:middle])) <= position:
                low = middle
            else:
                high = middle - 1
        return low

    start, end = boundary(offset), boundary(offset + len(needle))
    return (start, end) if start < end and normalized(text[start:end]) == needle else None


def analyze_local(record, payload, cancelled=None):
    text = payload.get("text", "")
    image_input = payload.get('local_image') or 'image' in payload
    quality = assess_content(payload, bool(image_input))
    if image_input:
        classification = fuse_image(record['name'], text, payload.get('visual', []), payload.get('warnings', []), payload.get('sampling'))
    else:
        classification = classify_text(record['name'], text, payload.get('sampling'))
    semantics = local_semantic(text, cancelled=cancelled) if cancelled else local_semantic(text)
    classification = apply_content_quality(classification, quality)
    classification = decide(classification, semantics, payload.get('sampling'))
    for item in classification.get('evidence_items', []):
        start_hint, end_hint = item.pop('_sample_start', None), item.pop('_sample_end', None)
        verified_hint = (isinstance(start_hint, int) and isinstance(end_hint, int) and
                         0 <= start_hint < end_hint <= len(text) and text[start_hint:end_hint] == item['text'])
        if item.get('source') == 'ocr':
            if verified_hint:
                line, cursor = None, 0
                for row in payload.get('ocr_lines', []):
                    row_text = row.get('text', '')
                    if cursor <= start_hint < end_hint <= cursor + len(row_text):
                        line = row
                        break
                    cursor += len(row_text) + 1
            else:
                line = next((line for line in payload.get('ocr_lines', [])
                             if item['text'].casefold() in line.get('text', '').casefold()), None)
            if line and line.get('box'):
                item['box'] = copy.deepcopy(line['box'])
        elif item.get('source') in {'title', 'body'}:
            # Map sampled text evidence back to original character intervals.
            interval = (start_hint, end_hint) if verified_hint else _evidence_interval(text, item['text'])
            if interval is None:
                continue
            offset, evidence_end = interval
            cursor, matched = 0, []
            for segment in payload.get('sampling', {}).get('segments', []):
                length = segment.get('end', 0) - segment.get('start', 0)
                sampled_start = segment.get('sample_start', cursor)
                sampled_end = sampled_start + length
                if offset >= 0 and sampled_start < evidence_end and offset < sampled_end:
                    matched.append(segment)
                if sampled_start <= offset < evidence_end <= sampled_end:
                    item['start'] = segment.get('start', 0) + offset - sampled_start
                    item['end'] = item['start'] + evidence_end - offset
                    for key in ('page', 'slide', 'sheet', 'cell', 'row', 'paragraph', 'table'):
                        if key in segment:
                            item[key] = segment[key]
                    break
                cursor += length + (1 if payload.get('sampling', {}).get('kind') == 'pdf' or
                                    payload.get('sampling', {}).get('separator') == '\n' else 0)
            if len(matched) > 1:
                # A field label/value may span separate cells or paragraphs.
                # Only publish their common row/page scope; a single unit's
                # character interval cannot describe the whole evidence.
                for key in ('page', 'slide', 'sheet', 'table', 'row'):
                    value = matched[0].get(key)
                    if value is not None and all(segment.get(key) == value for segment in matched):
                        item[key] = value
    first = next((line.strip().lstrip("# ") for line in text.splitlines() if line.strip()), "")
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", first)[:70].strip(" .")
    review = classification['review_required']
    # Separators, frontmatter delimiters and empty Markdown headings do not
    # provide a name. Keep this independent of overall body reading quality.
    readable_title = any(char.isalnum() for char in title)
    use_title = (readable_title and quality['state'] == 'acceptable' and classification['decision_level'] != 'abstain'
                 and classification.get('content_form') != 'natural_photo')
    if classification.get('content_form') in {'data_chart', 'table_image', 'diagram'}:
        # A visual type does not validate sparse OCR as a title (e.g. Logs or
        # an isolated axis label). Retain the original name unless independent
        # OCR document evidence already supports the document's purpose.
        use_title = use_title and any(item.get('source') == 'ocr' for item in classification.get('evidence_items', []))
    name = (title + record["extension"]) if use_title else record["name"]
    try:
        safe_name(name, record["extension"])
    except SafetyError:
        name = record["name"]
        review = True
        classification['decision_level'] = 'candidate' if classification['category'] != 'other' else 'abstain'
        classification['review_reasons'].append('unsafe_title')
    evidence = first[:240] if text else '本地视觉场景候选；不推测人物身份、地点或拍摄日期。'
    if not text and classification['category'] == 'other':
        evidence = '没有足够的本地内容证据，保留原名并等待人工复核。'
    return {**classification, "file_id": record["id"], "name": name, 'evidence': evidence,
            "review_required": review, "provider": 'offline_models' if image_input else 'offline_semantic' if any(
                item.get('source') == 'semantic' for item in classification.get('evidence_items', [])) else "local_rules",
            "sample": payload["sample"], "rule_version": "8"}


class AnalysisJobs:
    global_slots = BoundedSemaphore(2)

    def __init__(self):
        self.jobs = {}
        self.snapshots = {}
        self.config_snapshots = {}
        self.lock = RLock()
        self.expires = time.monotonic() + 8 * 3600

    def create(self, ws, identifiers, mode, cloud_consent, endpoint=None, config_version=None):
        with self.lock:
            return self._create(ws, identifiers, mode, cloud_consent, endpoint, config_version)

    def _create(self, ws, identifiers, mode, cloud_consent, endpoint=None, config_version=None):
        if time.monotonic() >= self.expires:
            raise SafetyError('SESSION_REQUIRED')
        if mode == "cloud" and not cloud_consent:
            raise SafetyError("CLOUD_CONSENT_REQUIRED")
        config_snapshot = None
        if mode == "cloud":
            config_snapshot = get_model_snapshot()
            if (endpoint is None) != (config_version is None):
                raise SafetyError("MODEL_CONFIG_CHANGED")
            # Older local API callers may omit the binding fields. New clients bind
            # consent to the exact endpoint/version they displayed.
            if endpoint is not None and (endpoint != config_snapshot.endpoint or config_version != config_snapshot.config_version):
                raise SafetyError("MODEL_CONFIG_CHANGED")
        records = ws.selected(identifiers)
        if mode == "cloud" and len(records) > config_snapshot.max_requests_per_batch:
            raise SafetyError("MODEL_BUDGET_EXCEEDED")
        for key in list(self.jobs):
            job = self.jobs[key]
            if job.get("finished_at") and time.monotonic() - job["finished_at"] > 900:
                self.jobs.pop(key)
                self.snapshots.pop(key, None)
        if len(self.jobs) >= 32 or any(j["status"] in {"queued", "running"} for j in self.jobs.values()):
            raise SafetyError("ANALYSIS_BUSY")
        if not self.global_slots.acquire(blocking=False):
            raise SafetyError('ANALYSIS_GLOBAL_LIMIT')
        job = {"id": uuid.uuid4().hex, "status": "queued", "mode": mode,
               "workspace_id": ws.id, "file_ids": copy.deepcopy(identifiers), "total": len(records), "processed": 0,
               "results": [], "errors": [], "created": stamp(), "cancel_requested": False,
               "current_file": None, "current_file_id": None, "phase": "queued"}
        if config_snapshot is not None:
            job["endpoint"] = config_snapshot.endpoint
            job["config_version"] = config_snapshot.config_version
        self.jobs[job["id"]] = job
        self.snapshots[job['id']] = copy.deepcopy(records)
        if config_snapshot is not None:
            self.config_snapshots[job["id"]] = config_snapshot
        return copy.deepcopy(job)

    def cancel_all(self):
        with self.lock:
            for job in list(self.jobs.values()):
                if job['status'] in {'queued', 'running'}:
                    job['cancel_requested'] = True

    def get(self, identifier):
        with self.lock:
            job = self._get_locked(identifier)
            return copy.deepcopy(job)

    def _get_locked(self, identifier):
        job = self.jobs.get(identifier)
        if not job or (job.get("finished_at") and time.monotonic() - job["finished_at"] > 900):
            raise SafetyError("JOB_NOT_FOUND")
        return job

    def cancel(self, identifier):
        with self.lock:
            job = self._get_locked(identifier)
            if job["status"] in {"queued", "running"}:
                job["cancel_requested"] = True
            return copy.deepcopy(job)

    def _cancelled(self, identifier):
        with self.lock:
            job = self.jobs.get(identifier)
            return not job or job['cancel_requested'] or time.monotonic() >= self.expires

    def _update(self, identifier, **fields):
        with self.lock:
            job = self._get_locked(identifier)
            job.update(fields)
            return copy.deepcopy(job)

    def _append(self, identifier, key, value):
        with self.lock:
            job = self._get_locked(identifier)
            job[key].append(value)

    async def _suggest(self, payload, config_snapshot: ModelConfigSnapshot | None):
        """Keep one-argument suggest monkeypatches compatible with older callers."""
        try:
            signature = inspect.signature(suggest)
            accepts_snapshot = "config_snapshot" in signature.parameters or any(
                parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()
            )
        except (TypeError, ValueError):
            accepts_snapshot = False
        if config_snapshot is not None and accepts_snapshot:
            return await suggest(payload, config_snapshot=config_snapshot)
        return await suggest(payload)

    async def run(self, identifier, ws):
        with self.lock:
            job = self._get_locked(identifier)
            if job["status"] != "queued":
                return copy.deepcopy(job)
            job["status"] = "running"
            job["phase"] = "preparing"
        try:
            for file_id in self.get(identifier)["file_ids"]:
                job = self.get(identifier)
                if time.monotonic() >= self.expires:
                    self._update(identifier, cancel_requested=True)
                if job["cancel_requested"]:
                    break
                try:
                    with self.lock:
                        records = copy.deepcopy(self.snapshots[identifier])
                    record = next(dict(r) for r in records if r['id'] == file_id)
                    self._update(identifier, current_file=record["name"], current_file_id=file_id, phase="preparing")
                    # Preserve older three-argument adapters while forwarding
                    # cancellation to the real bounded local workers.
                    prepare_kwargs = {}
                    if job['mode'] == 'local' and 'cancelled' in inspect.signature(prepare_input).parameters:
                        prepare_kwargs['cancelled'] = lambda: self._cancelled(identifier)
                    # Grid previews use the same bounded preprocessing slots.
                    # Retry only a rejected local prepare (no parser started),
                    # never model requests or actual parser/inference errors.
                    prepare_deadline = time.monotonic() + 2
                    payload = None
                    while not self._cancelled(identifier):
                        try:
                            payload = await asyncio.to_thread(prepare_input, ws, record, job['mode'] == 'local', **prepare_kwargs)
                            break
                        except SafetyError as exc:
                            remaining = prepare_deadline - time.monotonic()
                            if job['mode'] != 'local' or exc.code != 'PARSER_BUSY' or remaining <= 0:
                                raise
                            await asyncio.sleep(min(.05, remaining))
                    if payload is None:
                        self._update(identifier, cancel_requested=True)
                        break
                    if time.monotonic() >= self.expires:
                        self._update(identifier, cancel_requested=True)
                    job = self.get(identifier)
                    if job["cancel_requested"]:
                        break
                    if job["mode"] == "cloud":
                        with self.lock:
                            config_snapshot = self.config_snapshots.get(identifier)
                        self._update(identifier, phase="model")
                        suggestion, metadata = await self._suggest(payload, config_snapshot)
                        name = safe_name(suggestion.title + record["extension"], record["extension"])
                        result = {"file_id": file_id, "name": name, "category": suggestion.category,
                                  "evidence": suggestion.evidence, "review_required": suggestion.review_required,
                                  "provider": "cloud_model", "sample": payload["sample"], "metadata": metadata}
                    else:
                        self._update(identifier, phase="classifying")
                        classify_kwargs = {'cancelled': lambda: self._cancelled(identifier)} if 'cancelled' in inspect.signature(analyze_local).parameters else {}
                        result = await asyncio.to_thread(analyze_local, record, payload, **classify_kwargs)
                    if not self.get(identifier)["cancel_requested"]:
                        self._append(identifier, "results", result)
                except (SafetyError, OSError) as exc:
                    self._append(identifier, "errors", {"file_id": file_id, "code": exc.code if isinstance(exc, SafetyError) else "READ_FAILED"})
                except Exception:
                    self._append(identifier, "errors", {"file_id": file_id, "code": "ANALYSIS_FAILED"})
                with self.lock:
                    job = self._get_locked(identifier)
                    job["processed"] += 1
        except asyncio.CancelledError:
            # Cancelling an asyncio wrapper does not stop to_thread. Signal its
            # bounded native worker before releasing the job on shutdown.
            self._update(identifier, cancel_requested=True)
            raise
        finally:
            with self.lock:
                job = self._get_locked(identifier)
                job["status"] = "cancelled" if job["cancel_requested"] else "completed"
                job["phase"] = job["status"]
                job["current_file"] = None
                job["current_file_id"] = None
                job["finished_at"] = time.monotonic()
                self.snapshots.pop(identifier, None)
                self.config_snapshots.pop(identifier, None)
            self.global_slots.release()
