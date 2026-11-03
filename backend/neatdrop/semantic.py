"""Verified CPU BGE candidates. Runtime has no downloader or remote loader.

BGE v1.5 uses normalized first-token (CLS) embeddings, documented in the
pinned upstream model card and 1_Pooling/config.json included in the package.
Document/profile inputs use symmetric similarity (no retrieval instruction).
Only category definitions are encoded; user text and embeddings never persist.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import sysconfig
import threading
import time
from contextlib import contextmanager, ExitStack
from pathlib import Path

if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from neatdrop.taxonomy import SUBCATEGORIES

PROJECT = Path(__file__).resolve().parents[2]
MODEL_DIR = PROJECT / 'models' / 'bge-small-zh-v1.5'
PROFILES_PATH = Path(__file__).with_name('classification_profiles.json')
REPOSITORY = 'Xenova/bge-small-zh-v1.5'
REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
UPSTREAM_REVISION = '7999e1d3359715c523056ef9478215996d62a620'
VERSION = 'bge-small-zh-v1.5-int8-75c43b0/profiles-1'
NAME = 'BGE small zh v1.5 int8 (CPU, 待复核候选)'
MAX_INPUT_CHARS = 12000
WORKER_SECONDS = 12
MEMORY_BYTES = 1536 * 1024 * 1024
# Engineering guard selected on 12 hand-written development probes only. These
# are not calibrated classification thresholds and never enable ordinary output.
CANDIDATE_FLOOR = .53
NEGATIVE_MARGIN = .02
# LFS sha256 comes from pinned Hub blobs metadata. Small-file SHA256 was
# computed only after matching the authoritative Git blob IDs in that metadata.
# The model cards and pooling config supply the original license/method evidence.
TRUSTED_FILES = {
    'onnx/model_quantized.onnx': {'size': 24010842, 'sha256': '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'},
    'tokenizer.json': {'size': 439125, 'sha256': '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26', 'git_blob': 'cdb3043fc938fc918c06e66cf704c2ba58f88747'},
    'tokenizer_config.json': {'size': 367, 'sha256': 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a', 'git_blob': '3a59388f0fd1bd22dec2ce7902c1be8e1fb84107'},
    'special_tokens_map.json': {'size': 125, 'sha256': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3', 'git_blob': 'a8b3208c2884c4efb86e49300fdd3dc877220cdf'},
    'config.json': {'size': 716, 'sha256': 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f', 'git_blob': 'd590a6643f5dcdd0cfb0477e3c291488c16fc2d7'},
    'README.md': {'size': 1057, 'sha256': 'cb22054df1a98f7ee9d5b281d023e67c27cc316e1733baf03fc994d95c3048ab', 'git_blob': 'e26ec7fcc01a7aff66171d44acff0a80fae865e1'},
    'UPSTREAM_README.md': {'size': 27670, 'sha256': 'c48a4eeea77f6b1d38b48ec1c5b8d4f86d5550cc43fa345a0db1b2ca1d082369', 'git_blob': '20e39cd51a31d3afb1d003a9a4239f527530b1c0'},
    'pooling_config.json': {'size': 190, 'sha256': 'aaa8861589f80c961a03cc86c7eeaef7605c1676b9ab55329d33a304738769c6', 'git_blob': 'e25f4f3261cf0c6156611f5b5fdba0825859f4f3'},
}
_LOCK = threading.RLock()


def package_manifest():
    return {'schema': 1, 'repository': REPOSITORY, 'revision': REVISION,
            'upstream_repository': 'BAAI/bge-small-zh-v1.5', 'upstream_revision': UPSTREAM_REVISION,
            'license': 'MIT', 'pooling': 'cls_l2', 'version': VERSION,
            'files': {name: item['sha256'] for name, item in TRUSTED_FILES.items()}}


def _plain_file(root, name):
    path = root / name
    def linked(p):
        return p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction())
    if linked(root) or linked(path) or any(linked(p) for p in path.parents if p != root.parent):
        raise ValueError('model integrity: symbolic links are not allowed')
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('model integrity: missing or unsafe file')
    return path


def read_verified_package(model_dir):
    """Return immutable checked bytes, never reopen their filenames in native code.

    On Windows every ancestor and package directory remains pinned while the
    no-follow, deny-write/delete file handles are read. The supplied root is
    checked before resolve can hide a junction. The whole package is <32MiB.
    """
    from neatdrop.safe_io import directory_pin, locked_reader
    root = Path(model_dir).absolute()
    def ordinary_dir(path):
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()) or not path.is_dir():
            raise ValueError('model integrity: unsafe directory')
    with ExitStack() as stack:
        pinned = set()
        for path in reversed([root, *root.parents]):
            ordinary_dir(path)
            stack.enter_context(directory_pin(path))
            pinned.add(path)
        def read(name, cap):
            path = _plain_file(root, name)
            for parent in reversed(path.parents):
                if parent.is_relative_to(root) and parent not in pinned:
                    ordinary_dir(parent)
                    stack.enter_context(directory_pin(parent))
                    pinned.add(parent)
            with locked_reader(path) as stream:
                if os.fstat(stream.fileno()).st_size > cap:
                    raise ValueError('model integrity: file size mismatch')
                data = stream.read(cap + 1)
                if len(data) > cap:
                    raise ValueError('model integrity: file size mismatch')
                return data
        manifest = json.loads(read('manifest.json', 16384))
        if manifest != package_manifest():
            raise ValueError('model integrity: untrusted manifest/revision')
        contents = {}
        for name, trusted in TRUSTED_FILES.items():
            data = read(name, trusted['size'])
            if len(data) != trusted['size'] or hashlib.sha256(data).hexdigest() != trusted['sha256']:
                raise ValueError('model integrity: checksum or size mismatch')
            contents[name] = data
    return {'manifest': manifest, 'files': contents}


def verify_package(model_dir):
    return read_verified_package(model_dir)['manifest']


def load_profiles(path=PROFILES_PATH):
    data = json.loads(Path(path).read_text('utf-8'))
    profiles = data.get('profiles', [])
    expected = {(c, s) for c, subs in SUBCATEGORIES.items() for s in subs}
    keys = [(p.get('category'), p.get('subcategory')) for p in profiles]
    if len(keys) != len(expected) or set(keys) != expected or data.get('version') != '1':
        raise ValueError('profiles must match authoritative taxonomy')
    for profile in profiles:
        if not all(profile.get(k) for k in ('definition', 'positive_examples', 'negative_examples')):
            raise ValueError('incomplete profile')
        if not isinstance(profile.get('necessary_structure'), list):
            raise ValueError('invalid profile structure')
        fallback = profile['subcategory'] in {'unclassified', 'unsorted_photo'}
        if profile.get('fallback') != fallback or profile.get('support') != ('excluded_fallback' if fallback else 'candidate_only'):
            raise ValueError('invalid profile capability')
    return profiles


def candidate_profiles(profiles):
    return [p for p in profiles if not p['fallback']]


def token_chunks(tokenizer, text):
    """At most six token windows, including actual head and tail; gaps are explicit."""
    tokenizer.no_truncation()
    tokenizer.no_padding()
    ids = tokenizer.encode(text, add_special_tokens=False).ids
    capacity, overlap = 382, 48  # two BERT special tokens count in 384
    starts = [0]
    while starts[-1] + capacity < len(ids):
        starts.append(starts[-1] + capacity - overlap)
    if len(starts) > 6:
        last = len(starts) - 1
        starts = [starts[round(i * last / 5)] for i in range(6)]
    spans = [{'start': s, 'end': min(s + capacity, len(ids))} for s in starts]
    covered = sum(s['end'] - s['start'] for s in spans) - sum(max(0, a['end'] - b['start']) for a, b in zip(spans, spans[1:]))
    return {'chunks': [[101] + ids[s['start']:s['end']] + [102] for s in spans],
            'spans': spans, 'truncated': covered < len(ids), 'total_tokens': len(ids)}


def cls_pool(hidden):
    import numpy as np
    hidden = np.asarray(hidden)
    if hidden.ndim != 3 or not np.isfinite(hidden).all():
        raise ValueError('invalid model embeddings')
    cls = hidden[:, 0, :].astype(np.float32)
    norms = np.linalg.norm(cls, axis=-1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError('empty model embeddings')
    return cls / norms


def select_candidates(profiles, scores, exclusions):
    """Mean document support, minimum floor and positive/negative margin."""
    import numpy as np
    if scores.shape != exclusions.shape or scores.ndim != 2 or scores.shape[1] != len(profiles) or not np.isfinite(scores).all() or not np.isfinite(exclusions).all():
        raise ValueError('invalid semantic similarity output')
    mean = scores.mean(axis=0)
    negative = exclusions.mean(axis=0)
    aggregate = np.clip(mean - .25 * np.maximum(0, negative - mean), -1, 1)
    order = [i for i in np.argsort(-aggregate, kind='stable')
             if mean[i] >= CANDIDATE_FLOOR and mean[i] - negative[i] >= NEGATIVE_MARGIN][:3]
    return [{'category': profiles[i]['category'], 'subcategory': profiles[i]['subcategory'],
             'score': round(float(aggregate[i]), 6),
             'chunk_scores': [round(float(v), 6) for v in scores[:, i]],
             'evidence': '本地语义与分类定义及反例比较；尚未校准，需核对用途。'} for i in order]


def chunk_support(profiles, scores, exclusions):
    chunks = [{'chunk': i, 'candidates': select_candidates(profiles, scores[i:i+1], exclusions[i:i+1])}
              for i in range(scores.shape[0])]
    labels = {(row['candidates'][0]['category'], row['candidates'][0]['subcategory'])
              for row in chunks if row['candidates']}
    return {'chunks': chunks, 'conflict': len(labels) > 1}


def profile_eligible(profile, text):
    """Conservative necessary-purpose predicates; absence suppresses a candidate.

    These are exclusion/eligibility checks, not independent calibrated proof.
    They prevent subjective uses and sensitive document types being inferred
    solely from semantic proximity, especially when text says it is a tutorial.
    """
    if not profile['necessary_structure'] or profile['fallback']:
        return False
    s = profile['subcategory']
    lower = text.lower()
    def has(pattern):
        return re.search(pattern, lower) is not None
    if profile['category'] != 'study' and has(r'教程|教学|示例|范本|如何|操作指南|并非|不是真实|不是实际|\btutorial\b|\bexample\b|\bnot an?\b'):
        return False
    if s == 'invoice':
        return has(r'发票|invoice') and has(r'购买方|销售方|buyer|seller') and has(r'发票号码|发票号|税额|价税合计|invoice number|tax')
    if s == 'medical':
        return has(r'医院|诊所|hospital|clinic') and has(r'患者|姓名|patient|name') and has(r'结果|诊断|处方|参考范围|result|diagnosis|prescription')
    if s == 'identity':
        return has(r'身份证|护照|资格证|驾驶证|passport|identity card') and has(r'姓名|持有人|证件号码|有效期|签发|name|holder|valid|issued')
    if s == 'wallpaper':
        return has(r'壁纸|wallpaper') and has(r'我|准备|用作|作为|设置为|my|i will|set as')
    if profile['category'] == 'photos':
        return has(r'照片|拍摄|合影|photo|photograph')
    if s == 'board':
        return has(r'板书|黑板|白板|blackboard|whiteboard')
    if s == 'work_notes':
        return has(r'工作|项目|任务|work|project|task') and has(r'记录|日志|进展|待办|完成|record|log|progress|todo')
    if s == 'code':
        return has(r'验证码|通行码|状态码|一次性|verification code|one.time|access code') and has(r'临时|有效|分钟|秒|一次|expires|temporary|valid')
    if s == 'queue':
        return has(r'取餐|排队|叫号|等待|queue|pickup number') and has(r'号|桌|位|number|position')
    return True


@contextmanager
def _execution_slot(cancelled=None, deadline=None):
    deadline = time.monotonic() + WORKER_SECONDS if deadline is None else deadline
    while True:
        if cancelled and cancelled():
            raise InterruptedError('semantic cancelled')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('semantic worker lock budget exhausted')
        if _LOCK.acquire(timeout=min(.1, remaining)):
            break
    try:
        if cancelled and cancelled():
            raise InterruptedError('semantic cancelled')
        yield
    finally:
        _LOCK.release()


def _memory_limit():
    """Hard limit inside the worker; process exit releases its native allocations."""
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
        return None
    import ctypes
    from ctypes import wintypes
    class BASIC(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]
    class EXTENDED(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    limits = EXTENDED()
    limits.BasicLimitInformation.LimitFlags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
    limits.ProcessMemoryLimit = MEMORY_BYTES
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise RuntimeError('semantic resource limit unavailable')
    return job  # intentionally retained until worker exits


def _deny_network():
    # Native inference is fixed ONNX CPU, not an arbitrary remote-code pipeline.
    # Audit hooks additionally reject sockets/DNS and child execution in Python.
    def audit(event, args):
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
            raise PermissionError('semantic worker network/process creation blocked')
    sys.addaudithook(audit)


def _infer_local(model_dir, text, operation):
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    verified = read_verified_package(model_dir)['files']
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    session = ort.InferenceSession(verified['onnx/model_quantized.onnx'], options, providers=['CPUExecutionProvider'])
    if session.get_providers() != ['CPUExecutionProvider']:
        raise ValueError('semantic CPU provider required')
    tokenizer = Tokenizer.from_str(verified['tokenizer.json'].decode('utf-8'))
    del verified
    if [tokenizer.token_to_id(t) for t in ('[PAD]', '[CLS]', '[SEP]')] != [0, 101, 102]:
        raise ValueError('semantic tokenizer mismatch')
    names = {item.name for item in session.get_inputs()}
    if names != {'input_ids', 'attention_mask', 'token_type_ids'}:
        raise ValueError('unexpected semantic model inputs')
    def encode(chunks):
        vectors = []
        for start in range(0, len(chunks), 8):
            batch = chunks[start:start + 8]
            length = max(map(len, batch))
            ids = np.zeros((len(batch), length), dtype=np.int64)
            mask = np.zeros_like(ids)
            for i, row in enumerate(batch):
                ids[i, :len(row)] = row
                mask[i, :len(row)] = 1
            outputs = session.run(['last_hidden_state'], {'input_ids': ids, 'attention_mask': mask, 'token_type_ids': np.zeros_like(ids)})
            vectors.append(cls_pool(outputs[0]))
        return np.concatenate(vectors)
    if operation == 'selftest':
        import socket
        try:
            socket.socket()
        except PermissionError:
            pass
        else:
            raise ValueError('semantic network guard selftest failed')
        vectors = encode(token_chunks(tokenizer, '本地语义引擎合成自检')['chunks'])
        if vectors.shape != (1, 512):
            raise ValueError('semantic selftest output mismatch')
        return {'ok': True, 'network_blocked': True, 'provider': 'CPUExecutionProvider', 'worker_pid': os.getpid()}
    bounded = text[:MAX_INPUT_CHARS] if len(text) <= MAX_INPUT_CHARS else (text[:4000] + '\n' + text[len(text)//2-2000:len(text)//2+2000] + '\n' + text[-3998:])
    document = token_chunks(tokenizer, bounded)
    vectors = encode(document['chunks'])
    profiles = candidate_profiles(load_profiles())
    positive, negative = [], []
    for p in profiles:
        positive.append(token_chunks(tokenizer, p['definition'] + '。' + '；'.join(p['positive_examples']))['chunks'][0])
        negative.append(token_chunks(tokenizer, '；'.join(p['negative_examples']))['chunks'][0])
    references = encode(positive + negative)
    scores = vectors @ references[:len(profiles)].T
    exclusions = vectors @ references[len(profiles):].T
    for i, profile in enumerate(profiles):
        if not profile_eligible(profile, bounded):
            scores[:, i] = -1
    # Mean across all sampled chunks prevents one embedded example from deciding
    # a whole document. Negative proximity is a conservative ranking penalty.
    candidates = select_candidates(profiles, scores, exclusions)
    support = chunk_support(profiles, scores, exclusions)
    truncated = document['truncated'] or len(text) > MAX_INPUT_CHARS
    warnings = ['semantic_uncalibrated'] + (['semantic_input_truncated'] if truncated else [])
    if not candidates:
        warnings.append('semantic_no_supported_candidate')
    if support['conflict']:
        warnings.append('semantic_chunk_conflict')
    return {'candidates': candidates, 'warnings': warnings, 'version': VERSION, 'truncated': truncated,
            'chunk_support': support,
            'token_sampling': {'spans': document['spans'], 'total_tokens': document['total_tokens'],
                               'max_chunks': 6, 'max_tokens': 384, 'overlap': 48}}


def run_worker(model_dir, text, operation='classify', timeout=WORKER_SECONDS, cancelled=None):
    """One model at a time, fresh process, 12s hard timeout, 1.5GiB native limit."""
    deadline = time.monotonic() + timeout
    with _execution_slot(cancelled, deadline):
        env = {k: v for k, v in os.environ.items() if k.upper() in {'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'COMSPEC', 'PATHEXT'}}
        env.update({'TOKENIZERS_PARALLELISM': 'false', 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '1', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'})
        kwargs = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        # Windows venv python.exe is a launcher that creates a grandchild; its
        # process handle cannot enforce the native timeout. Invoke the underlying
        # interpreter directly and supply only this environment's installed libs.
        interpreter = getattr(sys, '_base_executable', sys.executable)
        dependency_dir = sysconfig.get_path('purelib')
        proc = subprocess.Popen([interpreter, '-I', '-S', str(Path(__file__).resolve()), '--worker', dependency_dir],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, **kwargs)
        request = json.dumps({'model_dir': str(Path(model_dir).absolute()), 'text': text, 'operation': operation}, ensure_ascii=True).encode('ascii')
        first = True
        try:
            while True:
                if cancelled and cancelled():
                    raise InterruptedError('semantic cancelled')
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('semantic worker time budget exhausted')
                try:
                    output, _ = proc.communicate(request if first else None, timeout=min(.1, remaining))
                    break
                except subprocess.TimeoutExpired:
                    first = False
        except BaseException:
            proc.kill()
            proc.communicate(timeout=2)
            raise
        if proc.returncode or len(output) > 32768:
            raise RuntimeError('semantic worker failed')
        result = json.loads(output)
        if not isinstance(result, dict) or result.get('error'):
            raise RuntimeError('semantic worker selftest/inference failed')
        return result


class SemanticEngine:
    def __init__(self, model_dir=MODEL_DIR):
        self.model_dir = Path(model_dir)
        self._fingerprint = None
        self._status = None

    def _current_fingerprint(self):
        paths = [self.model_dir / n for n in ('manifest.json', *TRUSTED_FILES)]
        return tuple((p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_ctime_ns) if p.is_file() else None for p in paths)

    def status(self, cancelled=None, deadline=None):
        deadline = time.monotonic() + WORKER_SECONDS if deadline is None else deadline
        status = {'available': False, 'name': NAME, 'state': 'missing', 'version': VERSION,
                  'integrity_check': 'missing', 'quality': 'candidate_only', 'network_required': False}
        try:
            slot = _execution_slot(cancelled, deadline)
            slot.__enter__()
        except TimeoutError:
            return {**status, 'state': 'budget_limited', 'integrity_check': 'unverified'}
        try:
            try:
                if not (self.model_dir / 'manifest.json').exists():
                    return status
                fingerprint = self._current_fingerprint()
                if fingerprint == self._fingerprint and self._status:
                    return dict(self._status)
                status.update(state='checking', integrity_check='unverified')
                verify_package(self.model_dir)
                checked = run_worker(self.model_dir, '', operation='selftest', cancelled=cancelled, timeout=max(0, deadline - time.monotonic()))
                if not (checked.get('ok') is True and checked.get('network_blocked') is True and checked.get('provider') == 'CPUExecutionProvider' and isinstance(checked.get('worker_pid'), int)):
                    raise ValueError('semantic incomplete selftest')
                status.update(available=True, state='ready', integrity_check='verified')
            except InterruptedError:
                raise
            except TimeoutError:
                status.update(state='budget_limited', integrity_check='unverified')
            except Exception:
                status.update(state='self_test_failed', integrity_check='failed')
            try:
                self._fingerprint = self._current_fingerprint()
            except OSError:
                self._fingerprint = None
            self._status = dict(status)
        finally:
            slot.__exit__(None, None, None)
        return status

    def classify(self, text, cancelled=None):
        deadline = time.monotonic() + WORKER_SECONDS
        result = {'candidates': [], 'warnings': [], 'version': VERSION, 'truncated': False}
        if cancelled and cancelled():
            result['warnings'] = ['semantic_cancelled']
            return result
        if not isinstance(text, str) or not text.strip():
            result['warnings'] = ['semantic_empty_input']
            return result
        try:
            status = self.status(cancelled=cancelled, deadline=deadline)
        except InterruptedError:
            result['warnings'] = ['semantic_cancelled']
            return result
        if not status['available']:
            result['warnings'] = [{'missing': 'semantic_models_missing', 'budget_limited': 'semantic_budget_exhausted'}.get(status['state'], 'semantic_integrity_or_selftest_failed')]
            return result
        try:
            # Parent sends only bounded head/middle/tail data over an in-memory pipe.
            truncated = len(text) > MAX_INPUT_CHARS
            if truncated:
                text = text[:4000] + '\n' + text[len(text)//2-2000:len(text)//2+2000] + '\n' + text[-3998:]
            result = run_worker(self.model_dir, text, cancelled=cancelled, timeout=max(0, deadline - time.monotonic()))
            if truncated:
                result['truncated'] = True
                if 'semantic_input_truncated' not in result['warnings']:
                    result['warnings'].append('semantic_input_truncated')
            return result
        except InterruptedError:
            result['warnings'] = ['semantic_cancelled']
        except TimeoutError:
            self._status = {**status, 'available': False, 'state': 'budget_limited'}
            result['warnings'] = ['semantic_budget_exhausted']
        except Exception:
            self._status = {**status, 'available': False, 'state': 'self_test_failed', 'integrity_check': 'failed'}
            result['warnings'] = ['semantic_engine_failed']
        return result


ENGINE = SemanticEngine()


def semantic_status():
    return ENGINE.status()


def classify_semantic(text, cancelled=None):
    return ENGINE.classify(text, cancelled=cancelled)


def _worker_main():
    retained_job = _memory_limit()
    _deny_network()
    try:
        raw = sys.stdin.buffer.read(100000)
        request = json.loads(raw)
        if request.get('operation') not in {'classify', 'selftest'} or not isinstance(request.get('text'), str) or len(request['text']) > MAX_INPUT_CHARS:
            raise ValueError('invalid worker request')
        result = _infer_local(request['model_dir'], request['text'], request['operation'])
    except Exception:
        result = {'error': 'semantic worker failed'}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=True).encode('ascii'))
    sys.stdout.buffer.flush()


if __name__ == '__main__' and len(sys.argv) == 3 and sys.argv[1] == '--worker':
    sys.path.append(sys.argv[2])
    _worker_main()
