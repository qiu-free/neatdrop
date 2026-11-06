"""Explicit local graph jobs. Cancellation and revision guards forbid partial commits."""
import asyncio
import base64
import io
import threading
import uuid
from PIL import Image
from .files import SafetyError
from .graph_matching import text_features, image_fingerprint
from .content_quality import assess_content
from .journal import stamp

_LOCK = threading.RLock()
_ACTIVE = set()
_SLOTS = threading.BoundedSemaphore(2)


class GraphJobs:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.RLock()

    def create(self, service, entry_ids, confirmed):
        if confirmed is not True:
            raise SafetyError('GRAPH_CONFIRMATION_REQUIRED')
        if not 1 <= len(entry_ids) <= 50 or len(set(entry_ids)) != len(entry_ids):
            raise SafetyError('GRAPH_BATCH_INVALID')
        state, available = service.store.load()
        if not available:
            raise SafetyError('GRAPH_STORE_UNAVAILABLE')
        descriptors = {key: service.descriptor(key) for key in entry_ids}
        if sum(item['size'] for _, item, _ in descriptors.values()) > 200 * 1024 * 1024 or any(item['size'] > 20 * 1024 * 1024 for _, item, _ in descriptors.values()):
            raise SafetyError('GRAPH_BATCH_LIMIT')
        records, _ = service.records()
        trusted = {key for key, (_, _, identity) in records.items() if identity is not None}
        if len((set(state['features']) & trusted) | set(entry_ids)) > 1000:
            raise SafetyError('GRAPH_STORE_LIMIT')
        with _LOCK, self.lock:
            if service.store.key in _ACTIVE:
                raise SafetyError('GRAPH_JOB_BUSY')
            if not _SLOTS.acquire(blocking=False):
                raise SafetyError('GRAPH_JOB_LIMIT')
            for key in list(self.jobs):
                if len(self.jobs) < 64:
                    break
                if self.jobs[key]['data']['status'] not in {'queued', 'running'}:
                    del self.jobs[key]
            if len(self.jobs) >= 64:
                _SLOTS.release()
                raise SafetyError('GRAPH_JOB_LIMIT')
            identifier = uuid.uuid4().hex
            data = {'id': identifier, 'status': 'queued', 'processed': 0, 'total': len(entry_ids), 'current_file': None, 'errors': [], 'error': None}
            self.jobs[identifier] = {'data': data, 'service': service, 'revision': state['revision'], 'descriptors': descriptors, 'cancel': threading.Event()}
            _ACTIVE.add(service.store.key)
            return dict(data)

    def get(self, identifier, service):
        with self.lock:
            job = self.jobs.get(identifier)
            if not job or job['service'].ws.id != service.ws.id:
                raise SafetyError('GRAPH_JOB_NOT_FOUND')
            return {**job['data'], 'errors': list(job['data']['errors'])}

    def cancel(self, identifier, service):
        with self.lock:
            self.get(identifier, service)
            job = self.jobs[identifier]
            if job['data']['status'] in {'queued', 'running'}:
                job['cancel'].set()
                job['data']['status'] = 'cancelled'
                job['data']['current_file'] = None
            return self.get(identifier, service)

    def cancel_all(self):
        with self.lock:
            for job in self.jobs.values():
                if job['data']['status'] in {'queued', 'running'}:
                    job['cancel'].set()
                    job['data']['status'] = 'cancelled'

    async def run(self, identifier):
        worker = asyncio.create_task(asyncio.to_thread(self._run, identifier))
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError:
            self.jobs[identifier]['cancel'].set()
            await worker

    def _run(self, identifier):
        job = self.jobs[identifier]
        service, data, cancelled = job['service'], job['data'], job['cancel']
        features = {}
        try:
            if cancelled.is_set():
                return
            data['status'] = 'running'
            for key, (entry, item, identity) in job['descriptors'].items():
                if cancelled.is_set():
                    return
                data['current_file'] = entry['name']
                try:
                    payload = service.read(key, cancelled=cancelled.is_set)
                    feature = text_features(payload.get('text', ''))
                    image = entry['name'].lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
                    feature['quality'] = assess_content(payload, image)
                    if image and not cancelled.is_set():
                        thumbnail = service.read(key, local=False)
                        with Image.open(io.BytesIO(base64.b64decode(thumbnail['image'].split(',', 1)[1]))) as decoded:
                            feature['fingerprint'] = image_fingerprint(decoded)
                    feature.update(sha256=item['sha256'], identity=identity, updated=stamp())
                    features[key] = feature
                except (SafetyError, OSError, ValueError) as exc:
                    data['errors'].append({'entry_id': key, 'code': getattr(exc, 'code', 'GRAPH_READ_FAILED')})
                data['processed'] += 1
            if cancelled.is_set():
                return
            # No persisted snapshot is authoritative for current bytes. Reopen
            # all successes immediately before publishing and recheck membership.
            for key in list(features):
                service.read(key, local=False)
                _, item, identity = service.descriptor(key)
                if features[key]['sha256'] != item['sha256'] or features[key]['identity'] != identity:
                    raise SafetyError('GRAPH_ENTRY_CHANGED')
            if not features:
                data.update(status='failed', error='GRAPH_NO_READABLE_FILES')
                return
            def mutate(state):
                if cancelled.is_set():
                    raise SafetyError('GRAPH_CANCELLED')
                records, _ = service.records()
                if any(key not in records or records[key][2] != features[key]['identity'] for key in features):
                    raise SafetyError('GRAPH_ENTRY_CHANGED')
                state['features'] = {key: f for key, f in state['features'].items()
                                     if key in records and records[key][2] is not None}
                state['features'].update(features)
                state['relations'] = [r for r in state['relations'] if r['source'] in records and r['target'] in records]
            # Serialize cancellation against final commit; a completed publish
            # cannot later be reported as cancelled.
            with self.lock:
                if cancelled.is_set():
                    return
                service.store.commit(job['revision'], mutate)
                data['status'] = 'completed'
        except (SafetyError, OSError, ValueError) as exc:
            data.update(status='failed', error=getattr(exc, 'code', 'GRAPH_JOB_FAILED'))
        finally:
            if cancelled.is_set():
                data['status'] = 'cancelled'
            data['current_file'] = None
            with _LOCK:
                _ACTIVE.discard(service.store.key)
                _SLOTS.release()
