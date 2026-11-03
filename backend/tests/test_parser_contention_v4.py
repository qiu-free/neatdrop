"""Grid previews must not turn transient parser capacity into failed analysis."""
import asyncio
import threading
import time

from neatdrop import analysis
from neatdrop.files import SafetyError, Workspace


def workspace(tmp_path):
    (tmp_path / 'x.txt').write_text('课程笔记\n矩阵与特征值', encoding='utf-8')
    ws = Workspace(tmp_path)
    return ws, ws.scan()[0]


def occupy_preview_slots(monkeypatch):
    slots = threading.BoundedSemaphore(2)
    slots.acquire()
    slots.acquire()
    monkeypatch.setattr(analysis, 'PREPROCESS_SLOTS', slots)
    return slots


def test_local_job_waits_for_preview_slots_then_prepares_same_file(tmp_path, monkeypatch):
    ws, record = workspace(tmp_path)
    slots = occupy_preview_slots(monkeypatch)

    async def run():
        manager = analysis.AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        async def finish_previews():
            await asyncio.sleep(.12)
            slots.release()
            slots.release()
        preview = asyncio.create_task(finish_previews())
        await manager.run(job['id'], ws)
        await preview
        return manager.get(job['id'])

    result = asyncio.run(run())
    assert result['errors'] == []
    assert result['results'][0]['category'] == 'study'
    assert result['processed'] == 1


def test_cancel_while_waiting_for_preview_slots_has_no_permanent_file_error(tmp_path, monkeypatch):
    ws, record = workspace(tmp_path)
    occupy_preview_slots(monkeypatch)

    async def run():
        manager = analysis.AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        task = asyncio.create_task(manager.run(job['id'], ws))
        await asyncio.sleep(.08)
        manager.cancel(job['id'])
        await task
        return manager.get(job['id'])

    started = time.monotonic()
    result = asyncio.run(run())
    assert result['status'] == 'cancelled'
    assert result['errors'] == []
    assert result['results'] == []
    assert time.monotonic() - started < .8


def test_wait_for_parser_capacity_has_a_two_second_ceiling(tmp_path, monkeypatch):
    ws, record = workspace(tmp_path)
    occupy_preview_slots(monkeypatch)

    async def run():
        manager = analysis.AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        await manager.run(job['id'], ws)
        return manager.get(job['id'])

    started = time.monotonic()
    result = asyncio.run(run())
    elapsed = time.monotonic() - started
    assert 1.9 <= elapsed < 3.5
    assert result['errors'] == [{'file_id': record['id'], 'code': 'PARSER_BUSY'}]
    assert result['results'] == []


def test_cloud_request_is_never_retried_even_if_it_reports_parser_busy(tmp_path, monkeypatch):
    ws, record = workspace(tmp_path)
    monkeypatch.setenv('NEATDROP_API_KEY', 'development-test-not-a-real-key')
    requests = []
    async def suggest(payload):
        requests.append(payload)
        raise SafetyError('PARSER_BUSY')
    monkeypatch.setattr(analysis, 'suggest', suggest)

    async def run():
        manager = analysis.AnalysisJobs()
        job = manager.create(ws, [record['id']], 'cloud', True)
        await manager.run(job['id'], ws)
        return manager.get(job['id'])

    result = asyncio.run(run())
    assert len(requests) == 1
    assert result['errors'] == [{'file_id': record['id'], 'code': 'PARSER_BUSY'}]
