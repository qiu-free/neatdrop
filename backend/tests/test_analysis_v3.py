from neatdrop.analysis import analyze_local, prepare_input
from neatdrop.files import Workspace


def test_local_sampling_reads_middle_and_tail_without_expanding_cloud_request(tmp_path):
    (tmp_path / 'long.txt').write_text('A' * 9000 + 'MIDDLE-ONLY' + 'B' * 9000 + 'TAIL-ONLY', encoding='utf-8')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    local = prepare_input(ws, record, local=True)
    cloud = prepare_input(ws, record)
    assert 'MIDDLE-ONLY' in local['text'] and 'TAIL-ONLY' in local['text']
    assert len(local['text']) <= 12000
    assert local['sampling']['truncated']
    assert 'sampling' not in cloud
    assert len(cloud['text']) == 1500


def test_rejected_text_keeps_original_name(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: None, raising=False)
    result = analyze_local({'id': 'a', 'name': 'original.txt', 'extension': '.txt'},
                           {'text': 'A meaningless sentence without any reliable purpose.', 'sample': 'full'})
    assert result['name'] == 'original.txt'
    assert result['decision_level'] == 'abstain'


def test_analysis_exposes_semantic_candidate_and_sampling(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: {
        'candidates': [{'category': 'study', 'subcategory': 'notes', 'score': .8}],
        'warnings': [], 'version': 'test', 'truncated': False}, raising=False)
    result = analyze_local({'id': 'a', 'name': 'x.txt', 'extension': '.txt'},
                           {'text': '非固定标题\n这是不依赖规则的语义候选输入。', 'sample': 'full',
                            'sampling': {'kind': 'text', 'truncated': False, 'budget_exhausted': False,
                                         'segments': [], 'summary': '本地完整文本'}})
    assert result['category'] == 'study'
    assert result['decision_level'] == 'candidate'
    assert result['review_required']
    assert result['sampling']['summary'] == '本地完整文本'
    assert result['provider'] == 'offline_semantic'


def test_sensitive_sample_document_cannot_become_ordinary():
    result = analyze_local({'id': 'a', 'name': 'x.txt', 'extension': '.txt'},
                           {'text': '居民身份证示例\n姓名：样例\n公民身份号码：占位\n签发机关和有效期', 'sample': 'full'})
    assert result['review_required']


def test_cancel_callback_is_forwarded_to_image_worker(tmp_path, monkeypatch):
    from PIL import Image
    import neatdrop.offline as offline
    Image.new('RGB', (32, 32), 'white').save(tmp_path / 'a.png')
    seen = []
    def bounded(image, **kwargs):
        seen.append(kwargs['cancelled']())
        return {'text': '', 'visual': [], 'warnings': ['inference_cancelled']}
    monkeypatch.setattr(offline, 'analyze_image_bounded', bounded)
    ws = Workspace(tmp_path)
    prepare_input(ws, ws.scan()[0], local=True, cancelled=lambda: True)
    assert seen == [True]


def test_semantic_candidate_engine_requires_explicit_experimental_enable(monkeypatch):
    import neatdrop.analysis as analysis
    import neatdrop.semantic as semantic
    monkeypatch.delenv('NEATDROP_SEMANTIC_CANDIDATES', raising=False)
    monkeypatch.setattr(semantic, 'classify_semantic', lambda text: (_ for _ in ()).throw(AssertionError('not enabled')))
    assert analysis.local_semantic('内容') is None


def test_enabled_experimental_semantic_engine_is_used(monkeypatch):
    import neatdrop.analysis as analysis
    import neatdrop.semantic as semantic
    monkeypatch.setenv('NEATDROP_SEMANTIC_CANDIDATES', '1')
    monkeypatch.setattr(semantic, 'classify_semantic', lambda text: {'candidates': [], 'version': 'test'})
    assert analysis.local_semantic('内容')['version'] == 'test'


def test_async_task_cancellation_marks_worker_callback_cancelled(tmp_path, monkeypatch):
    import asyncio
    import threading
    import neatdrop.analysis as analysis
    (tmp_path / 'x.txt').write_text('课程笔记\n矩阵与特征值', encoding='utf-8')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    entered, release = threading.Event(), threading.Event()
    checks = []
    def slow(record, payload, cancelled=None):
        entered.set()
        release.wait(3)
        checks.append(cancelled())
        return {}
    monkeypatch.setattr(analysis, 'analyze_local', slow)
    async def run():
        manager = analysis.AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        task = asyncio.create_task(manager.run(job['id'], ws))
        await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        release.set()
        return manager.get(job['id'])
    result = asyncio.run(run())
    assert result['status'] == 'cancelled'
    assert checks == [True]


def test_matched_ocr_evidence_retains_original_image_location(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: None)
    result = analyze_local({'id': 'a', 'name': 'x.png', 'extension': '.png'}, {
        'local_image': True, 'text': '课程笔记\n本节学习矩阵与特征值', 'sample': 'full',
        'visual': [], 'warnings': [], 'ocr_lines': [
            {'text': '课程笔记', 'box': [[10, 20], [100, 20], [100, 50], [10, 50]], 'region': 0}]})
    hit = next(item for item in result['evidence_items'] if item['text'] == '课程笔记')
    assert hit['source'] == 'ocr'
    assert hit['box'] == [[10, 20], [100, 20], [100, 50], [10, 50]]


def test_real_local_pdf_job_accepts_cancel_callback(tmp_path):
    import asyncio
    from test_extraction import pdf_bytes
    from neatdrop.analysis import AnalysisJobs
    (tmp_path / 'x.pdf').write_bytes(pdf_bytes(['Lecture notes', 'Matrix theorem', 'Last page']))
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    async def run():
        manager = AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        await manager.run(job['id'], ws)
        return manager.get(job['id'])
    result = asyncio.run(run())
    assert result['errors'] == []
    assert result['results'][0]['sampling']['kind'] == 'pdf'


def test_photo_incidental_sign_does_not_rename_original(monkeypatch):
    import neatdrop.analysis as analysis
    monkeypatch.setattr(analysis, 'local_semantic', lambda text: None)
    result = analyze_local({'id': 'a', 'name': 'IMG_1234.jpg', 'extension': '.jpg'}, {
        'local_image': True, 'text': '禁止吸烟', 'sample': 'full',
        'visual': [{'label': 'landscape', 'score': .42}, {'label': 'object', 'score': .20}], 'warnings': []})
    assert result['content_form'] == 'natural_photo'
    assert result['name'] == 'IMG_1234.jpg'
