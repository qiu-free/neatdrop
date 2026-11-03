"""Local-only CPU OCR and CLIP; no URLs, downloader or remote pipeline at runtime."""
import hashlib
import importlib.util
import json
import math
import multiprocessing
import os
import threading
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, ImageStat

from .extraction import image_regions

MODEL_DIR = Path(__file__).resolve().parents[2] / 'models' / 'clip-vit-base-patch32'
VISION_FILES = ['onnx/vision_model_quantized.onnx', 'onnx/text_model_quantized.onnx', 'tokenizer.json', 'preprocessor_config.json']
EXPECTED_HASHES = {
    'onnx/vision_model_quantized.onnx': '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
    'onnx/text_model_quantized.onnx': '73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a',
    'tokenizer.json': 'f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd',
    'preprocessor_config.json': '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f',
}
OCR_HASHES = {
    'ch_PP-OCRv4_det_infer.onnx': 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    'ch_PP-OCRv4_rec_infer.onnx': '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    'ch_ppocr_mobile_v2.0_cls_infer.onnx': 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
}
PROMPTS = {
    'people': ['a photograph of people posing together', 'a portrait photograph of a person'],
    'landscape': ['a photograph of a natural landscape with mountains and trees', 'a photograph of a city or a travel destination'],
    'food': ['a photograph of food dishes on a table', 'a photograph of a meal or a drink'],
    'pet': ['a photograph of a pet cat', 'a photograph of a pet dog'],
    'object': ['a photograph of a household object or product', 'a close up photograph of a physical object'],
    'document': ['a photograph of a paper document with printed text', 'a scanned invoice receipt or handwritten classroom notes'],
    'screenshot': ['a screenshot of a computer application user interface', 'a screenshot of a mobile phone app or chat messages'],
    'poster': ['a graphic design advertising poster with text', 'a promotional event poster'],
    'illustration': ['a colorful digital illustration or cartoon drawing', 'a painting or an artwork'],
    'meme': ['a funny internet meme with text and a picture', 'a cartoon reaction sticker'],
    'scatter_plot': ['a data scatter plot with many points on horizontal and vertical axes',
                     'a statistical scatter chart with axis labels and data markers, not a natural photograph'],
    'line_chart': ['a data line chart with plotted lines on labeled axes',
                   'a statistical line graph showing measured values, not a drawing of a landscape'],
    'bar_chart': ['a data bar chart with separated rectangular bars on labeled axes',
                  'a statistical column chart comparing categories, not a photograph of buildings'],
    'histogram': ['a statistical histogram with adjacent bins and a numerical horizontal axis',
                  'a distribution histogram with contiguous vertical bars and frequency labels'],
    'pie_chart': ['a statistical pie chart divided into colored sectors with labels',
                  'a data donut chart with percentage sectors, not a photograph of food'],
    'heatmap': ['a data heatmap with a grid of colored cells and a color scale legend',
                'a statistical matrix heat map with labeled rows and columns'],
    'box_plot': ['a statistical box plot with boxes whiskers and axes',
                 'a box and whisker chart comparing numerical distributions'],
    'flowchart': ['a flowchart of labeled boxes connected by directional arrows',
                  'a process diagram with decision diamonds and connecting arrows, not an app user interface'],
    'diagram': ['a system architecture diagram with connected labeled components',
                'a relationship or structure diagram of nodes and connecting lines'],
    'table_image': ['an image of a data table with aligned rows columns and headers',
                    'a table of numbers in grid cells, not a photograph of a physical table'],
}
_LOCK = threading.RLock()
_IMAGE_SLOTS = threading.BoundedSemaphore(2)
_IMAGE_MEMORY = 1536 * 1024 * 1024


def _file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


@contextmanager
def _pinned_files(directory, names):
    """Reject reparse parents and hold deny-write/delete files through loading."""
    from .safe_io import directory_pin, locked_reader
    root = Path(directory).absolute()
    with ExitStack() as stack:
        pinned = set()
        def pin(path):
            if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()) or not path.is_dir():
                raise ValueError('unsafe model directory')
            stack.enter_context(directory_pin(path))
            pinned.add(path)
        for parent in reversed([root, *root.parents]):
            pin(parent)
        streams = {}
        for name in names:
            path = root / name
            for parent in reversed(path.parents):
                if parent.is_relative_to(root) and parent not in pinned:
                    pin(parent)
            if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()) or not path.is_file():
                raise ValueError('unsafe model file')
            streams[name] = stack.enter_context(locked_reader(path))
        yield streams


def _verified_vision_bytes(model_dir):
    with _pinned_files(model_dir, ['manifest.json', *VISION_FILES]) as streams:
        manifest = json.loads(streams['manifest.json'].read(16385))
        contents = {}
        for name in VISION_FILES:
            if manifest.get('files', {}).get(name) != EXPECTED_HASHES[name]:
                raise ValueError('model integrity mismatch')
            # Fixed model hashes bound the accepted files; cap reads before
            # allocating in case a corrupt package was enlarged.
            cap = 128 * 1024 * 1024 if name.endswith('.onnx') else 4 * 1024 * 1024
            data = streams[name].read(cap + 1)
            if len(data) > cap or hashlib.sha256(data).hexdigest() != EXPECTED_HASHES[name]:
                raise ValueError('model integrity mismatch')
            contents[name] = data
        return contents


def _vision_integrity(model_dir):
    try:
        if not all((model_dir / name).is_file() for name in [*VISION_FILES, 'manifest.json']):
            return 'missing'
        _verified_vision_bytes(model_dir)
    except (OSError, ValueError, AttributeError):
        return 'failed'
    return 'passed'


def _ocr_integrity():
    try:
        spec = importlib.util.find_spec('rapidocr_onnxruntime')
        if spec is None or not spec.origin:
            return 'missing'
        directory = Path(spec.origin).parent / 'models'
        if not all((directory / name).is_file() for name in OCR_HASHES):
            return 'missing'
        with _pinned_files(directory, OCR_HASHES) as streams:
            return 'passed' if _check_ocr_streams(streams) else 'failed'
    except (OSError, ValueError):
        return 'failed'


def _check_ocr_streams(streams):
    for name, expected in OCR_HASHES.items():
        digest = hashlib.sha256()
        for block in iter(lambda: streams[name].read(1024 * 1024), b''):
            digest.update(block)
        if digest.hexdigest() != expected:
            return False
    return True


def offline_status():
    def capability(name, integrity):
        return {'available': integrity == 'passed', 'name': name,
                'state': 'verified' if integrity == 'passed' else ('missing' if integrity == 'missing' else 'integrity_failed'),
                'integrity_check': integrity}
    return {'ocr': capability('RapidOCR PP-OCRv4 (CPU)', _ocr_integrity()),
            'vision': capability('CLIP ViT-B/32 quantized (CPU)', _vision_integrity(MODEL_DIR)),
            'network_required': False, 'rule_version': '3', 'quality': 'not_calibrated'}


def _bounds(box):
    xs, ys = zip(*box)
    return min(xs), min(ys), max(xs), max(ys)


def _same_ocr_region(first, second):
    if ''.join(first['text'].split()).casefold() != ''.join(second['text'].split()).casefold():
        return False
    a, b = _bounds(first['box']), _bounds(second['box'])
    overlap = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return area > 0 and overlap / area >= .6


def _detail_covered(size, regions):
    width, height = size
    if max(size) <= 1600:
        return True
    tiles = regions[1:]
    xs = sorted({0, width, *(box[0] for box in tiles), *(box[2] for box in tiles)})
    area = 0
    for left, right in zip(xs, xs[1:]):
        intervals = sorted((top, bottom) for l, top, r, bottom in tiles if l <= left and r >= right)
        covered, end = 0, 0
        for top, bottom in intervals:
            covered += max(0, bottom - max(top, end))
            end = max(end, bottom)
        area += (right - left) * covered
    return area == width * height


def _sampling(size, regions, truncated=False, exhausted=False):
    summary = f'本地 OCR 共读取 {len(regions)} 个视图；' if regions else '本地图片尚未完成读取；'
    summary += '保留全图，局部细节读取，部分内容可能未识别' if truncated else '保留全图视图与原图坐标，识别结果需核对'
    return {'kind': 'image', 'truncated': truncated, 'budget_exhausted': exhausted,
            'segments': [{'box': list(box), 'view': index, 'kind': 'full' if index == 0 else 'tile'}
                         for index, box in enumerate(regions)], 'summary': summary}


class OfflineEngine:
    def __init__(self, model_dir=MODEL_DIR):
        self.model_dir = Path(model_dir)
        self._ocr = None
        self._vision = None
        self._embeddings = None
        self._labels = []

    def _load_ocr(self):
        if self._ocr is None:
            from rapidocr_onnxruntime import RapidOCR
            spec = importlib.util.find_spec('rapidocr_onnxruntime')
            directory = Path(spec.origin).parent / 'models'
            # RapidOCR accepts filenames only. Keep all model/ancestor handles
            # pinned from digest verification until every native session loads.
            with _pinned_files(directory, OCR_HASHES) as streams:
                if not _check_ocr_streams(streams):
                    raise ValueError('OCR model integrity mismatch')
                self._ocr = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1,
                                     det_use_cuda=False, rec_use_cuda=False, cls_use_cuda=False,
                                     det_model_path=str(directory / 'ch_PP-OCRv4_det_infer.onnx'),
                                     rec_model_path=str(directory / 'ch_PP-OCRv4_rec_infer.onnx'),
                                     cls_model_path=str(directory / 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
                                     max_side_len=1600, min_side_len=30)

    def _load_vision(self):
        if self._vision is not None:
            return
        import onnxruntime as ort
        from tokenizers import Tokenizer
        verified = _verified_vision_bytes(self.model_dir)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        text_model = ort.InferenceSession(verified['onnx/text_model_quantized.onnx'], options, providers=['CPUExecutionProvider'])
        tokenizer = Tokenizer.from_str(verified['tokenizer.json'].decode('utf-8'))
        tokenizer.enable_truncation(max_length=77)
        tokenizer.enable_padding(length=77, pad_id=49407, pad_token='<|endoftext|>')
        sentences = []
        labels = []
        for label, prompts in PROMPTS.items():
            for prompt in prompts:
                sentences.append(prompt)
                labels.append(label)
        encoded = tokenizer.encode_batch(sentences)
        inputs = {'input_ids': np.array([t.ids for t in encoded], dtype=np.int64),
                  'attention_mask': np.array([t.attention_mask for t in encoded], dtype=np.int64)}
        names = [item.name for item in text_model.get_inputs()]
        outputs = text_model.run(None, {key: value for key, value in inputs.items() if key in names})
        output_names = [item.name for item in text_model.get_outputs()]
        embeddings = outputs[output_names.index('text_embeds')] if 'text_embeds' in output_names else outputs[0]
        self._embeddings = embeddings / np.maximum(np.linalg.norm(embeddings, axis=-1, keepdims=True), 1e-12)
        self._vision = ort.InferenceSession(verified['onnx/vision_model_quantized.onnx'], options, providers=['CPUExecutionProvider'])
        self._labels = labels

    def _visual_scores(self, image):
        self._load_vision()
        fitted = ImageOps.pad(image.convert('RGB'), (224, 224), method=Image.Resampling.BICUBIC,
                              color=(123, 117, 104))
        pixels = np.asarray(fitted, dtype=np.float32) / 255.0
        pixels = (pixels - np.array([.48145466, .4578275, .40821073], dtype=np.float32)) / np.array([.26862954, .26130258, .27577711], dtype=np.float32)
        outputs = self._vision.run(None, {'pixel_values': pixels.transpose(2, 0, 1)[None]})
        names = [item.name for item in self._vision.get_outputs()]
        embedding = outputs[names.index('image_embeds')] if 'image_embeds' in names else outputs[0]
        embedding = embedding / np.maximum(np.linalg.norm(embedding, axis=-1, keepdims=True), 1e-12)
        similarities = (embedding @ self._embeddings.T)[0]
        scores = {label: max(float(similarities[i]) for i, value in enumerate(self._labels) if value == label) for label in PROMPTS}
        return sorted([{'label': label, 'score': round(score, 4)} for label, score in scores.items()], key=lambda item: item['score'], reverse=True)

    def analyze(self, image, use_ocr=True, use_vision=True):
        result = {'text': '', 'ocr_lines': [], 'visual': [], 'warnings': []}
        regions = image_regions(image.size) if use_ocr else []
        partial = use_ocr and not _detail_covered(image.size, regions)
        result['sampling'] = _sampling(image.size, [], truncated=partial, exhausted=partial)
        result['sample'] = result['sampling']['summary']
        result['truncated'] = partial
        vision_ready = all((self.model_dir / f).is_file() for f in VISION_FILES) and (self.model_dir / 'manifest.json').is_file()
        if use_vision and not vision_ready:
            result['warnings'].append('vision_models_missing')
        if max(ImageStat.Stat(image.convert('L').resize((64, 64))).stddev) < 2:
            result['warnings'].append('image_low_information')
            return result
        with _LOCK:
            if use_ocr:
                try:
                    self._load_ocr()
                    visited, lines, output_cut = [], [], False
                    rgb = image.convert('RGB')
                    for region, bounds in enumerate(regions):
                        bounded = rgb.crop(bounds)
                        bounded.thumbnail((1600, 1600))
                        rows, _ = self._ocr(np.asarray(bounded)[:, :, ::-1])
                        visited.append(bounds)
                        sx = (bounds[2] - bounds[0]) / bounded.width
                        sy = (bounds[3] - bounds[1]) / bounded.height
                        # Bound both inspection and retained output independently
                        # of OCR's native detection count.
                        output_cut = output_cut or len(rows or []) > 150
                        for box, text, score in (rows or [])[:150]:
                            if not isinstance(text, str) or not math.isfinite(float(score)) or score < .65:
                                continue
                            if len(box) != 4 or any(len(point) != 2 or not all(math.isfinite(float(value)) for value in point) for point in box):
                                continue
                            mapped = [[round(min(image.width, max(0, bounds[0] + float(x) * sx)), 2),
                                       round(min(image.height, max(0, bounds[1] + float(y) * sy)), 2)] for x, y in box]
                            line = {'text': text[:300], 'score': round(float(score), 3), 'box': mapped,
                                    'region': region, 'source': 'ocr'}
                            output_cut = output_cut or len(text) > 300
                            duplicate = next((index for index, existing in enumerate(lines) if _same_ocr_region(existing, line)), None)
                            if duplicate is None:
                                lines.append(line)
                            elif line['score'] > lines[duplicate]['score']:
                                lines[duplicate] = line
                    lines.sort(key=lambda line: (_bounds(line['box'])[1], _bounds(line['box'])[0]))
                    if len(lines) > 150:
                        # Keep some lines from the beginning, middle and end.
                        centre = len(lines) // 2
                        lines = [*lines[:50], *lines[centre - 25:centre + 25], *lines[-50:]]
                        output_cut = True
                    remaining = 12000
                    selected = []
                    # A per-line quota prevents early OCR blocks erasing the
                    # final selected region while keeping the hard text cap.
                    quota = max(1, (remaining - max(0, len(lines) - 1)) // max(1, len(lines)))
                    for order, line in enumerate(lines):
                        output_cut = output_cut or len(line['text']) > quota
                        line['text'] = line['text'][:quota]
                        line['order'] = order
                        selected.append(line)
                    result['ocr_lines'] = selected
                    result['text'] = '\n'.join(row['text'] for row in selected)
                    result['sampling'] = _sampling(image.size, visited, partial or output_cut, partial or output_cut)
                except Exception:
                    result['warnings'].append('ocr_unavailable')
                    result['sampling'] = _sampling(image.size, locals().get('visited', []), True, False)
            if use_vision:
                if vision_ready:
                    try:
                        result['visual'] = self._visual_scores(image)
                        if max(image.size) / min(image.size) > 2:
                            # Retain full-image scores as authoritative candidates;
                            # the limited centre view is supplementary evidence.
                            if len(regions) > 1:
                                local = regions[1 + (len(regions) - 1) // 2]
                                result['visual_local'] = self._visual_scores(image.crop(local))
                            else:
                                result['visual_local'] = self._visual_scores(ImageOps.fit(image, (min(image.size),) * 2))
                    except Exception:
                        result['warnings'].append('vision_engine_failed')
        result['truncated'] = result['sampling']['truncated']
        result['sample'] = result['sampling']['summary']
        return result


def _image_failure(size, warning):
    sampling = _sampling(size, [], True, True)
    return {'text': '', 'ocr_lines': [], 'visual': [], 'warnings': [warning],
            'sampling': sampling, 'sample': sampling['summary'], 'truncated': True}


def _peak_memory_mib():
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('faults', wintypes.DWORD),
                        *[(name, ctypes.c_size_t) for name in ('peak_ws', 'working_set', 'peak_paged',
                           'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile')]]
        counters = Counters()
        counters.size = ctypes.sizeof(counters)
        kernel = ctypes.WinDLL('kernel32')
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.WinDLL('psapi')
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.size):
            return round(counters.peak_ws / (1024 * 1024), 1)
        return None
    import resource
    import sys
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(peak / (1024 * 1024 if sys.platform == 'darwin' else 1024), 1)


def _image_worker(connection, image_data, use_ocr, use_vision):
    try:
        # Resource isolation is installed before decoding pixels or loading ONNX.
        connection.recv()
        if os.name != 'nt':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (_IMAGE_MEMORY, _IMAGE_MEMORY))
        # This applies inside spawned workers too. Runtime is never permitted to
        # resolve hosts or open IP connections, even through optional libraries.
        import socket
        def denied(*args, **kwargs):
            raise OSError('offline inference network disabled')
        socket.socket.connect = denied
        socket.socket.connect_ex = denied
        socket.create_connection = denied
        socket.getaddrinfo = denied
        socket.socket.sendto = denied
        size, pixels = image_data
        image = Image.frombytes('RGB', size, pixels)
        started = time.monotonic()
        result = OfflineEngine().analyze(image, use_ocr=use_ocr, use_vision=use_vision)
        result['runtime'] = {'network_disabled': True, 'elapsed_ms': round((time.monotonic() - started) * 1000),
                             'memory_budget_mib': _IMAGE_MEMORY // (1024 * 1024),
                             'peak_working_set_mib': _peak_memory_mib()}
        connection.send(result)
    except BaseException:
        try:
            connection.send({'error': 'inference_failed'})
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


def analyze_image_bounded(image, timeout=25, use_ocr=True, use_vision=True, cancelled=None):
    """Disposable CPU worker; <=25 seconds, 1536 MiB and two concurrent jobs."""
    size = image.size
    if (size[0] < 1 or size[1] < 1 or size[0] * size[1] > 24_000_000 or max(size) > 16000
            or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0):
        return _image_failure(size, 'inference_budget_exceeded')
    if cancelled is not None and cancelled():
        return _image_failure(size, 'inference_cancelled')
    if not _IMAGE_SLOTS.acquire(blocking=False):
        return _image_failure(size, 'inference_budget_exceeded')
    parent = child = process = close_job = None
    try:
        from .parsing import _limit_worker_memory
        context = multiprocessing.get_context('spawn')
        parent, child = context.Pipe()
        process = context.Process(target=_image_worker,
                                  args=(child, (size, image.convert('RGB').tobytes()), use_ocr, use_vision), daemon=True)
        deadline = time.monotonic() + min(timeout, 25)
        process.start()
        child.close()
        close_job = _limit_worker_memory(process, _IMAGE_MEMORY)
        parent.send(True)
        while True:
            if cancelled is not None and cancelled():
                return _image_failure(size, 'inference_cancelled')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _image_failure(size, 'inference_timeout')
            if parent.poll(min(.1, remaining)):
                break
        result = parent.recv()
        if not isinstance(result, dict) or 'error' in result or not isinstance(result.get('text'), str) or len(result['text']) > 12000:
            return _image_failure(size, 'inference_failed')
        return result
    except Exception:
        return _image_failure(size, 'inference_failed')
    finally:
        if process is not None and process.pid is not None:
            if process.is_alive():
                process.terminate()
            process.join(1)
            if process.is_alive():
                process.kill()
                process.join()
            process.close()
        if close_job:
            close_job()
        if parent:
            parent.close()
        if child:
            child.close()
        _IMAGE_SLOTS.release()


ENGINE = OfflineEngine()
