"""Disposable PDF workers with parent-enforced time and process-memory budgets."""
import io
import multiprocessing
import os
import threading
import time

from .files import SafetyError

_SLOTS = threading.BoundedSemaphore(2)


def _limit_worker_memory(process, limit=384 * 1024 * 1024):
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes

    class Basic(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                    ('flags', wintypes.DWORD), ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t),
                    ('active', wintypes.DWORD), ('affinity', ctypes.c_size_t),
                    ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]

    class Extended(ctypes.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('process_memory', ctypes.c_size_t),
                    ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x100 | 0x2000  # per-process memory + kill on final handle close
    limits.process_memory = limit
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, int(process.sentinel)):
        if job:
            kernel.CloseHandle(job)
        raise SafetyError('PARSER_ISOLATION_UNAVAILABLE')
    return lambda: kernel.CloseHandle(job)


def _pdf_worker(connection, data, limit):
    try:
        # The parent attaches resource limits before allowing untrusted parsing.
        connection.recv()
        if os.name != 'nt':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise SafetyError('PDF_ENCRYPTED')
        if len(reader.pages) > 1000:
            raise SafetyError('PDF_PAGE_LIMIT')
        page_count = len(reader.pages)
        local = limit > 1500
        pages = {0, min(1, page_count - 1), page_count - 1}
        if local:
            pages.add((page_count - 1) // 2)
        pages = sorted(page for page in pages if page >= 0 and page < page_count)
        if local:
            # Reserve separators as well as per-page quotas: no early page may
            # consume the final page's share of the local character budget.
            budget = max(0, limit - max(0, len(pages) - 1))
            quotas = [budget // len(pages) + (index < budget % len(pages))
                      for index in range(len(pages))] if pages else []
            parts, segments = [], []
            page_truncated = False
            for page, quota in zip(pages, quotas):
                extracted = reader.pages[page].extract_text() or ''
                parts.append(extracted[:quota])
                cut = len(extracted) > quota
                page_truncated = page_truncated or cut
                segments.append({'page': page + 1, 'start': 0, 'end': min(len(extracted), quota),
                                 'truncated': cut})
            text = '\n'.join(parts)
        else:
            # Cloud sampling is intentionally unchanged.
            text = '\n'.join((reader.pages[p].extract_text() or '')[:limit] for p in pages)
        if not text.strip():
            raise SafetyError('PDF_NO_TEXT')
        result = {'text': text[:limit], 'truncated': len(text) > limit,
                  'sample': 'PDF pages ' + ', '.join(str(p + 1) for p in pages)}
        if local:
            truncated = page_truncated or len(pages) < page_count
            summary = '本地 PDF 第 ' + '、'.join(str(page + 1) for page in pages) + ' 页'
            summary += '分段抽样；部分内容未读取' if truncated else '完整读取'
            result.update(sample=summary, truncated=truncated,
                          sampling={'kind': 'pdf', 'truncated': truncated,
                                    'budget_exhausted': truncated,
                                    'segments': segments, 'summary': summary})
        connection.send(result)
    except SafetyError as exc:
        connection.send({'error': exc.code})
    except BaseException:
        try:
            connection.send({'error': 'PDF_PARSE_FAILED'})
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


def parse_pdf(data, limit=1500, timeout=12, cancelled=None):
    if cancelled is not None and cancelled():
        raise SafetyError('PDF_PARSE_CANCELLED')
    if not _SLOTS.acquire(blocking=False):
        raise SafetyError('PARSER_BUSY')
    parent = child = process = close_job = None
    try:
        deadline = time.monotonic() + min(timeout, 12)
        context = multiprocessing.get_context('spawn')
        parent, child = context.Pipe()
        process = context.Process(target=_pdf_worker, args=(child, data, limit), daemon=True)
        process.start()
        child.close()
        close_job = _limit_worker_memory(process)
        parent.send(True)
        while True:
            if cancelled is not None and cancelled():
                raise SafetyError('PDF_PARSE_CANCELLED')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SafetyError('PDF_PARSE_TIMEOUT')
            if parent.poll(min(.1, remaining)):
                break
        try:
            result = parent.recv()
        except (EOFError, OSError) as exc:
            raise SafetyError('PDF_PARSE_FAILED') from exc
        if not isinstance(result, dict):
            raise SafetyError('PDF_PARSE_FAILED')
        if 'error' in result:
            raise SafetyError(result.get('error', 'PDF_PARSE_FAILED'))
        if not isinstance(result.get('text'), str) or len(result['text']) > limit:
            raise SafetyError('PDF_PARSE_FAILED')
        return result
    finally:
        if process is not None and process.pid is not None:
            if process.is_alive():
                process.terminate()
            process.join(3)
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
        _SLOTS.release()
