import asyncio
from pathlib import Path

import pytest
from PIL import Image

from neatdrop.analysis import analyze_local, prepare_input, AnalysisJobs
from neatdrop.files import Workspace, SafetyError
from neatdrop.model import ModelSuggestion


def test_local_heading_suggests_name_without_claiming_ai(tmp_path):
    (tmp_path / "random.md").write_text("# 线性代数课程笔记\n矩阵与特征值", encoding="utf-8")
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    result = analyze_local(record, prepare_input(ws, record))
    assert result["name"] == "线性代数课程笔记.md"
    assert result["category"] == "study"
    assert result["provider"] == "local_rules"
    assert "线性代数课程笔记" in result["evidence"]


def test_invalid_utf8_is_not_uploaded(tmp_path):
    (tmp_path / "bad.txt").write_bytes(b"\xff\xfe\x00\x00")
    ws = Workspace(tmp_path)
    with pytest.raises(SafetyError, match="INVALID_UTF8"):
        prepare_input(ws, ws.scan()[0])


def test_image_is_bounded_and_no_local_path_or_hash_in_request(tmp_path):
    Image.new("RGB", (2200, 1400), "white").save(tmp_path / "photo.png")
    ws = Workspace(tmp_path)
    payload = prepare_input(ws, ws.scan()[0])
    assert payload["width"] == 1024
    assert payload["height"] < 1024
    assert not ({"sha256", "path", "root"} & payload.keys())
    assert payload["image"].startswith("data:image/jpeg;base64,")


def test_image_without_model_needs_review(tmp_path):
    Image.new("RGB", (16, 16)).save(tmp_path / "invoice.png")
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    result = analyze_local(record, prepare_input(ws, record))
    assert result["review_required"] is True
    assert result["category"] == "other"


def test_model_schema_rejects_executable_or_extra_paths():
    with pytest.raises(ValueError):
        ModelSuggestion.model_validate({"category": "study", "title": "x", "evidence": "x", "review_required": False, "target": "../../secret"})


def test_text_sample_is_capped(tmp_path):
    (tmp_path / "long.txt").write_text("课程笔记" * 2000, encoding="utf-8")
    ws = Workspace(tmp_path)
    payload = prepare_input(ws, ws.scan()[0])
    assert len(payload["text"]) == 1500
    assert payload["truncated"] is True


def test_cancelled_job_does_not_produce_new_results(tmp_path):
    (tmp_path / "a.md").write_text("# 课程笔记", encoding="utf-8")
    ws = Workspace(tmp_path)
    files = ws.scan()

    async def check():
        manager = AnalysisJobs()
        job = manager.create(ws, [files[0]["id"]], "local", False)
        manager.cancel(job["id"])
        await manager.run(job["id"], ws)
        assert manager.get(job["id"])["status"] == "cancelled"
        assert manager.get(job["id"])["results"] == []

    asyncio.run(check())


def test_cloud_requires_explicit_consent(tmp_path):
    (tmp_path / "a.md").write_text("# 课程笔记", encoding="utf-8")
    ws = Workspace(tmp_path)
    files = ws.scan()
    with pytest.raises(SafetyError, match="CLOUD_CONSENT_REQUIRED"):
        AnalysisJobs().create(ws, [files[0]["id"]], "cloud", False)


def test_scanned_pdf_is_explicitly_not_supported(tmp_path):
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=300)
    with (tmp_path / 'scan.pdf').open('wb') as out:
        writer.write(out)
    ws = Workspace(tmp_path)
    with pytest.raises(SafetyError, match='PDF_NO_TEXT'):
        prepare_input(ws, ws.scan()[0])


def test_pdf_extracts_only_first_two_and_last_pages(tmp_path):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    for text in ['FirstPage', 'SecondPage', 'SkippedPage', 'LastPage']:
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 10 200 Td ({text}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    with (tmp_path / 'text.pdf').open('wb') as out:
        writer.write(out)
    ws = Workspace(tmp_path)
    payload = prepare_input(ws, ws.scan()[0])
    assert 'FirstPage' in payload['text']
    assert 'SecondPage' in payload['text']
    assert 'LastPage' in payload['text']
    assert 'SkippedPage' not in payload['text']


def test_cloud_adapter_validates_real_http_response_contract(monkeypatch):
    import httpx
    import neatdrop.model as model
    monkeypatch.setenv('NEATDROP_API_KEY', 'test-not-a-real-key')
    real_client = httpx.AsyncClient

    def handle(request):
        import json
        body = json.loads(request.content)
        assert body['messages'][1]['content'][0]['type'] == 'text'
        return httpx.Response(200, json={'choices': [{'message': {'content': '{"category":"study","title":"课程笔记","evidence":"课程","review_required":false}'}}], 'usage': {'prompt_tokens': 12, 'completion_tokens': 20}})

    monkeypatch.setattr(model.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(handle)))
    result, metadata = asyncio.run(model.suggest({'text': '课程', 'sample': 'first 1500', 'truncated': False}))
    assert result.title == '课程笔记'
    assert metadata['usage']['prompt_tokens'] == 12


def test_local_sampling_does_not_expand_cloud_payload(tmp_path):
    (tmp_path / 'long.txt').write_text('# 课程笔记\n' + '学习' * 8000, encoding='utf-8')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    local = prepare_input(ws, record, local=True)
    cloud = prepare_input(ws, record)
    assert len(local['text']) == 12000
    assert len(cloud['text']) == 1500
    assert 'ocr_lines' not in cloud


def test_offline_job_classifies_synthetic_receipt_without_network(tmp_path, monkeypatch):
    import socket
    from PIL import ImageDraw, ImageFont
    def no_network(*args, **kwargs):
        raise AssertionError('Offline job attempted network')
    image = Image.new('RGB', (950, 550), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 40)
    for i, line in enumerate(['增值税电子普通发票', '发票号码 123456789', '购买方 样例公司', '销售方 样例商户', '价税合计 38.50元']):
        draw.text((35, 30 + i * 95), line, font=font, fill='black')
    image.save(tmp_path / 'random.png')
    ws = Workspace(tmp_path)
    record = ws.scan()[0]

    async def run():
        # Windows creates an internal loopback socketpair when the event loop is
        # constructed. Block connections after that, before any inference starts.
        monkeypatch.setattr(socket.socket, 'connect', no_network)
        manager = AnalysisJobs()
        job = manager.create(ws, [record['id']], 'local', False)
        await manager.run(job['id'], ws)
        return manager.get(job['id'])

    result = asyncio.run(run())
    assert result['errors'] == []
    assert result['results'][0]['category'] == 'finance'
    assert result['results'][0]['subcategory'] == 'invoice'
    assert result['results'][0]['provider'] == 'offline_models'
