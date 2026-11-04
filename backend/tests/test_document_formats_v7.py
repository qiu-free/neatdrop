"""Real OPC/CSV bytes exercise document extraction and its trust boundaries."""
import io
import os
import random
import struct
import time
import zipfile
from xml.sax.saxutils import escape

import pytest
from fastapi.testclient import TestClient

from neatdrop.analysis import analyze_local, decode_input, prepare_input
from neatdrop.files import SafetyError, Workspace

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
PURPOSE_TEXT = '线性代数课程笔记\n课程：线性代数\n知识点：矩阵与特征值\n课堂笔记与复习要点'


def rels(items):
    return f'<Relationships xmlns="{PR}">' + ''.join(
        f'<Relationship Id="{identifier}" Type="{R}/{kind}" Target="{target}"{mode}/>'
        for identifier, kind, target, mode in items) + '</Relationships>'


def package(ext, extra=None, *, main_xml=None, compression=zipfile.ZIP_DEFLATED):
    main, content_type, root = {
        '.docx': ('word/document.xml', 'wordprocessingml.document',
                  f'<w:document xmlns:w="{W}"><w:body>' + ''.join(
                      f'<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>' for line in PURPOSE_TEXT.splitlines()) +
                  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
        '.pptx': ('ppt/presentation.xml', 'presentationml.presentation',
                  f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst><p:sldId id="256" r:id="slide1"/></p:sldIdLst></p:presentation>'),
        '.xlsx': ('xl/workbook.xml', 'spreadsheetml.sheet',
                  f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets><sheet name="课程材料" sheetId="1" r:id="sheet1"/></sheets></workbook>'),
    }[ext]
    parts = {
        '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/{main}" ContentType="application/vnd.openxmlformats-officedocument.{content_type}.main+xml"/></Types>',
        '_rels/.rels': rels([('main', 'officeDocument', main, '')]),
        main: main_xml or root,
    }
    if ext == '.pptx':
        parts['ppt/_rels/presentation.xml.rels'] = rels([('slide1', 'slide', 'slides/slide1.xml', '')])
        parts['ppt/slides/slide1.xml'] = f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:txBody>' + ''.join(
            f'<a:p><a:r><a:t>{escape(line)}</a:t></a:r></a:p>' for line in PURPOSE_TEXT.splitlines()) + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    if ext == '.xlsx':
        parts['xl/_rels/workbook.xml.rels'] = rels([('sheet1', 'worksheet', 'worksheets/sheet1.xml', '')])
        parts['xl/worksheets/sheet1.xml'] = f'<worksheet xmlns="{S}"><sheetData>' + ''.join(
            f'<row r="{row}"><c r="A{row}" t="inlineStr"><is><t>{escape(line)}</t></is></c></row>'
            for row, line in enumerate(PURPOSE_TEXT.splitlines(), 1)) + '</sheetData></worksheet>'
    parts.update(extra or {})
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=compression) as archive:
        for name, value in parts.items():
            archive.writestr(name, value)
    data = output.getvalue()
    # On Windows ZipInfo normalizes backslashes when *writing*; replace both
    # header names to model the actual hostile wire bytes rather than a slash.
    for name in parts:
        if '\\' in name:
            data = data.replace(name.replace('\\', '/').encode(), name.encode())
    return data


def document_bytes(ext):
    if ext == '.csv':
        return ('\ufeff标题,课程,知识点\r\n"线性代数课程笔记","线性代数","矩阵与特征值"\r\n"课堂笔记与复习要点","含,逗号","跨\n行字段"\r\n').encode()
    return package(ext)


@pytest.mark.parametrize('ext,location', [('.docx', 'paragraph'), ('.pptx', 'slide'), ('.xlsx', 'cell'), ('.csv', 'row')])
def test_true_document_bytes_are_supported_extracted_and_classified(tmp_path, ext, location):
    path = tmp_path / ('unhelpful-name' + ext.upper())
    path.write_bytes(document_bytes(ext))
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    assert record['supported'] is True
    payload = prepare_input(ws, record, local=True)
    assert '线性代数课程笔记' in payload['text']
    assert payload['sampling']['kind'] == ext[1:]
    assert payload['sampling']['separator'] == '\n'
    assert any(location in segment for segment in payload['sampling']['segments'])
    assert len(payload['text']) <= 12000
    result = analyze_local(record, payload)
    assert result['category'] == 'study'
    assert result['name'].endswith(ext.upper())
    assert any(location in item for item in result['evidence_items'] if item['source'] in {'title', 'body'})


def test_csv_quotes_and_multiline_fields_are_decoded_as_fields():
    payload = decode_input(document_bytes('.csv'), '.csv', local=True)
    assert '含,逗号' in payload['text'] and '跨\n行字段' in payload['text']
    assert '"' not in payload['text']
    assert [segment['row'] for segment in payload['sampling']['segments']] == [1, 2, 3]


@pytest.mark.parametrize('ext', ['.docx', '.pptx', '.xlsx', '.csv'])
def test_documents_use_analysis_job_and_preview_copy_library_undo_api(tmp_path, monkeypatch, ext):
    from neatdrop.app import create_app
    import neatdrop.executor as executor_module
    from neatdrop.trust import TrustStore
    trust = TrustStore(tmp_path / 'receipts')
    monkeypatch.setattr(executor_module, 'TrustStore', lambda: trust)
    root = tmp_path / 'workspace'
    root.mkdir()
    source = document_bytes(ext)
    (root / ('original' + ext)).write_bytes(source)
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        headers = {'X-NeatDrop-CSRF': client.get('/api/session').json()['csrf']}
        config = client.get('/api/v1/config').json()
        assert ext in config['supported_extensions']
        ws = client.post('/api/v1/workspaces', json={'path': str(root)}, headers=headers).json()
        file = ws['files'][0]
        assert file['supported'] is True
        prefix = f"/api/v1/workspaces/{ws['id']}"
        preview = client.get(prefix + f"/files/{file['id']}/preview")
        assert preview.status_code == 200 and '线性代数课程笔记' in preview.json()['text']
        assert len(preview.json()['text']) <= 1500
        job = client.post('/api/v1/analysis-jobs', json={'workspace_id': ws['id'], 'file_ids': [file['id']]}, headers=headers).json()
        for _ in range(500):
            state = client.get('/api/v1/analysis-jobs/' + job['id']).json()
            if state['status'] == 'completed':
                break
            time.sleep(.02)
        assert state['errors'] == [] and state['processed'] == 1
        assert state['results'][0]['category'] == 'study'
        plan = client.post(prefix + '/plans', json={'edits': [{'file_id': file['id'], 'name': 'archived' + ext,
                           'category': 'study', 'subcategory': 'notes'}]}, headers=headers).json()
        done = client.post(prefix + '/execute', json={'plan_id': plan['id'], 'digest': plan['digest'], 'confirmed': True}, headers=headers)
        assert done.status_code == 200 and done.json()['status'] == 'completed'
        assert (root / plan['items'][0]['target']).read_bytes() == source
        library = client.get(prefix + '/library').json()['items']
        assert len(library) == 1 and library[0]['availability'] == 'available'
        saved = client.get(prefix + '/library/' + library[0]['id'] + '/preview')
        assert saved.status_code == 200 and saved.json() == preview.json()
        undone = client.post(prefix + '/transactions/' + plan['id'] + '/undo', json={'confirmed': True}, headers=headers)
        assert undone.status_code == 200 and undone.json()['status'] == 'undone'
        assert client.get(prefix + '/library').json()['items'] == []
        assert (root / ('original' + ext)).read_bytes() == source


@pytest.mark.parametrize('data,ext,code', [
    (b'plain text', '.docx', 'OFFICE_INVALID_CONTAINER'),
    (b'PK\x03\x04truncated', '.xlsx', 'OFFICE_INVALID_CONTAINER'),
    (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1encrypted-package', '.docx', 'OFFICE_ENCRYPTED'),
    (package('.docx'), '.pptx', 'OFFICE_FORMAT_MISMATCH'),
    (b'\xff\xfe\x00\x00', '.csv', 'CSV_INVALID_UTF8'),
    (b'one,two\x00binary', '.csv', 'CSV_INVALID'),
    (b'"unterminated,value\n', '.csv', 'CSV_INVALID'),
    (b'a' * 65537 + b',b\n', '.csv', 'CSV_LIMIT'),
    (b','.join([b'c'] * 1025), '.csv', 'CSV_LIMIT'),
])
def test_invalid_containers_and_csv_fail_explicitly(data, ext, code):
    with pytest.raises(SafetyError, match='^' + code + '$'):
        decode_input(data, ext, local=True)


@pytest.mark.parametrize('extra,code', [
    ({'../escape.xml': '<safe/>'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'/absolute.xml': '<safe/>'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word\\bad.xml': '<safe/>'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word/vbaProject.bin': b'macro'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word/embeddings/object.bin': b'embedded'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word/activeX/control.xml': '<safe/>'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'unused.xml': '<!DOCTYPE r [<!ENTITY x "entity">]><r>&x;</r>'}, 'OFFICE_XML_UNSAFE'),
    ({'unused.xml': '<!DOCTYPE r SYSTEM "file:///C:/private"><r/>'}, 'OFFICE_XML_UNSAFE'),
    ({'unused.xml': '<!DOCTYPE r [<!ENTITY x "entity">]><r>&x;</r>'.encode('utf-16')}, 'OFFICE_XML_UNSAFE'),
    ({'unused.xml': '<x>' * 65 + '</x>' * 65}, 'OFFICE_XML_LIMIT'),
    ({'unused.xml': '<broken>'}, 'OFFICE_PARSE_FAILED'),
    ({'word/_rels/document.xml.rels': rels([('external', 'hyperlink', 'https://example.invalid', ' TargetMode="External"')])}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word/_rels/document.xml.rels': rels([('escape', 'image', '../../outside.xml', '')])}, 'OFFICE_UNSAFE_CONTENT'),
    ({'word/_rels/document.xml.rels': rels([('escape', 'image', 'https%3A%2F%2Fexample.invalid/x', '')])}, 'OFFICE_UNSAFE_CONTENT'),
    ({'xl/externalLinks/externalLink1.xml': '<safe/>'}, 'OFFICE_UNSAFE_CONTENT'),
    ({'padding.bin': b'0' * (8 * 1024 * 1024 + 1)}, 'OFFICE_ZIP_LIMIT'),
    ({'padding.bin': b'0' * 200000}, 'OFFICE_ZIP_LIMIT'),
])
def test_all_archive_members_are_preflighted_even_when_not_extracted(extra, code):
    with pytest.raises(SafetyError, match='^' + code + '$'):
        decode_input(package('.docx', extra), '.docx', local=True)


def test_zip_member_count_and_total_uncompressed_budget_rejected():
    many = {f'extra/{index}.bin': b'x' for index in range(513)}
    with pytest.raises(SafetyError, match='^OFFICE_ZIP_LIMIT$'):
        decode_input(package('.docx', many), '.docx', local=True)
    # Compressing several individually allowed parts isolates the total-byte cap.
    member = random.Random(7).randbytes(2 * 1024 * 1024) + b'0' * (5 * 1024 * 1024)
    many_bytes = {f'extra/{index}.bin': member for index in range(5)}
    data = package('.docx', many_bytes)
    assert len(data) < 20 * 1024 * 1024
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert all(info.file_size <= 8 * 1024 * 1024 and info.file_size <= 100 * info.compress_size
                   for info in archive.infolist())
    with pytest.raises(SafetyError, match='^OFFICE_ZIP_LIMIT$'):
        decode_input(data, '.docx', local=True)


def test_zip_duplicate_member_and_encryption_flags_rejected():
    data = package('.docx')
    output = io.BytesIO(data)
    with pytest.warns(UserWarning), zipfile.ZipFile(output, 'a') as archive:
        archive.writestr('word/document.xml', '<fake/>')
    with pytest.raises(SafetyError, match='^OFFICE_UNSAFE_CONTENT$'):
        decode_input(output.getvalue(), '.docx', local=True)
    encrypted = bytearray(data)
    # Both headers advertise encryption; no password or decryption is attempted.
    for signature, offset in [(b'PK\x03\x04', 6), (b'PK\x01\x02', 8)]:
        cursor = 0
        while (cursor := encrypted.find(signature, cursor)) >= 0:
            flags = struct.unpack_from('<H', encrypted, cursor + offset)[0]
            struct.pack_into('<H', encrypted, cursor + offset, flags | 1)
            cursor += 4
    with pytest.raises(SafetyError, match='^OFFICE_ENCRYPTED$'):
        decode_input(bytes(encrypted), '.docx', local=True)


def test_xlsx_shared_inline_cached_formula_and_hidden_content_policy():
    workbook = f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets><sheet name="Visible" sheetId="1" r:id="sheet1"/><sheet name="Secret" state="veryHidden" sheetId="2" r:id="sheet2"/></sheets></workbook>'
    sheet = f'<worksheet xmlns="{S}"><cols><col min="4" max="4" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c><c r="C1"><f>WEBSERVICE("https://example.invalid")</f></c><c r="D1" t="inlineStr"><is><t>HIDDEN_COLUMN</t></is></c></row><row r="2" hidden="1"><c r="A2" t="inlineStr"><is><t>HIDDEN_ROW</t></is></c></row></sheetData></worksheet>'
    data = package('.xlsx', {
        'xl/workbook.xml': workbook,
        'xl/_rels/workbook.xml.rels': rels([('sheet1', 'worksheet', 'worksheets/sheet1.xml', ''), ('sheet2', 'worksheet', 'worksheets/sheet2.xml', ''), ('strings', 'sharedStrings', 'sharedStrings.xml', '')]),
        'xl/sharedStrings.xml': f'<sst xmlns="{S}"><si><r><t>课程</t></r><r><t>笔记</t></r></si></sst>',
        'xl/worksheets/sheet1.xml': sheet,
        'xl/worksheets/sheet2.xml': f'<worksheet xmlns="{S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SECRET_VALUE</t></is></c></row></sheetData></worksheet>',
    })
    payload = decode_input(data, '.xlsx', local=True)
    assert '课程笔记' in payload['text'] and '3' in payload['text']
    assert all(value not in payload['text'] for value in ['1+2', 'WEBSERVICE', 'HIDDEN_', 'SECRET_VALUE', 'Secret'])
    assert payload['truncated'] is True
    assert {'hidden_content_omitted', 'formula_cached_values_only', 'formula_without_cache'} <= set(payload['sampling']['warnings'])
    cached = next(segment for segment in payload['sampling']['segments'] if segment.get('cell') == 'B1')
    assert cached['sheet'] == 'Visible' and cached['row'] == 1


def test_xlsx_two_column_field_values_stay_in_the_same_row_with_exact_cell_evidence():
    rows = [
        ('材料类型', '增值税电子普通发票'), ('发票号码', '123456789012'),
        ('购买方', '甲公司'), ('销售方', '乙公司'), ('价税合计', '100元'),
    ]
    sheet = f'<worksheet xmlns="{S}"><sheetData>' + ''.join(
        f'<row r="{index}"><c r="A{index}" t="inlineStr"><is><t>{left}</t></is></c><c r="B{index}" t="inlineStr"><is><t>{right}</t></is></c></row>'
        for index, (left, right) in enumerate(rows, 1)) + '</sheetData></worksheet>'
    payload = decode_input(package('.xlsx', {'xl/worksheets/sheet1.xml': sheet}), '.xlsx', local=True)
    assert '发票号码\t123456789012' in payload['text']
    assert '购买方\t甲公司' in payload['text']
    assert payload['truncated'] is False
    for segment in payload['sampling']['segments']:
        if 'cell' in segment:
            assert payload['text'][segment['sample_start']:segment['sample_end']] == dict(
                (f'{column}{index}', text) for index, row in enumerate(rows, 1)
                for column, text in zip(['A', 'B'], row))[segment['cell']]
    result = analyze_local({'id': 'file', 'name': 'random.xlsx', 'extension': '.xlsx'}, payload)
    assert result['category'] == 'finance' and result['subcategory'] == 'invoice'
    assert any(item.get('cell') == 'B1' for item in result['evidence_items'])


def test_docx_hidden_runs_and_pptx_hidden_slides_are_omitted_and_disclosed():
    xml = f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>VISIBLE_CONTENT</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN_CONTENT</w:t></w:r></w:p></w:body></w:document>'
    payload = decode_input(package('.docx', main_xml=xml), '.docx', local=True)
    assert payload['text'] == 'VISIBLE_CONTENT' and payload['truncated'] is True
    assert 'hidden_content_omitted' in payload['sampling']['warnings']
    root = f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst><p:sldId id="256" r:id="slide1"/><p:sldId id="257" r:id="slide2"/></p:sldIdLst></p:presentation>'
    hidden = f'<p:sld xmlns:p="{P}" xmlns:a="{A}" show="0"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>HIDDEN_CONTENT</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    payload = decode_input(package('.pptx', {'ppt/_rels/presentation.xml.rels': rels([('slide1', 'slide', 'slides/slide1.xml', ''), ('slide2', 'slide', 'slides/slide2.xml', '')]), 'ppt/slides/slide2.xml': hidden}, main_xml=root), '.pptx', local=True)
    assert '线性代数' in payload['text'] and 'HIDDEN_CONTENT' not in payload['text']
    assert payload['truncated'] and 'hidden_content_omitted' in payload['sampling']['warnings']


def test_docx_table_field_value_adjacency_keeps_real_rows_and_paragraph_positions():
    rows = [('发票号码', '123456789012'), ('购买方', '甲公司'), ('销售方', '乙公司'), ('价税合计', '100元')]
    xml = f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>增值税电子普通发票</w:t></w:r></w:p><w:tbl>' + ''.join(
        '<w:tr>' + ''.join(f'<w:tc><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>' for text in row) + '</w:tr>'
        for row in rows) + '</w:tbl><w:p><w:r><w:t>独立段落一</w:t></w:r></w:p><w:p><w:r><w:t>独立段落二</w:t></w:r></w:p></w:body></w:document>'
    payload = decode_input(package('.docx', main_xml=xml), '.docx', local=True)
    assert '发票号码\t123456789012' in payload['text']
    assert '购买方\t甲公司\n销售方\t乙公司' in payload['text']
    assert '独立段落一\n独立段落二' in payload['text']
    segment = next(segment for segment in payload['sampling']['segments'] if segment.get('paragraph') == 5)
    assert segment['table'] == 1 and segment['row'] == 2
    assert payload['text'][segment['sample_start']:segment['sample_end']] == '甲公司'
    result = analyze_local({'id': 'file', 'name': 'random.docx', 'extension': '.docx'}, payload)
    assert result['category'] == 'finance' and result['subcategory'] == 'invoice'
    assert any(item.get('table') == 1 for item in result['evidence_items'])


@pytest.mark.parametrize('data', [
    '<!DOCTYPE r [<!ENTITY x "entity">]><r>&x;</r>'.encode('utf-32'),
    '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE r [<!ENTITY x "entity">]><r>&x;</r>'.encode('utf-16-be'),
    '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "https://example.invalid">]><r>&x;</r>'.encode(),
])
def test_dtd_entity_denial_does_not_depend_on_ascii_byte_regex(data):
    with pytest.raises(SafetyError) as caught:
        decode_input(package('.docx', {'unused.xml': data}), '.docx', local=True)
    assert caught.value.code in {'OFFICE_XML_UNSAFE', 'OFFICE_PARSE_FAILED'}


def test_reference_and_metadata_mismatches_are_rejected_before_text_extraction():
    for extra in [
        {'_rels/.rels': rels([('main', 'officeDocument', 'missing.xml', '')])},
        {'_rels/.rels': rels([('main', 'officeDocument', 'word/document.xml', ''), ('duplicate', 'officeDocument', 'word/document.xml', '')])},
        {'[Content_Types].xml': f'<Types xmlns="{CT}"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'},
        {'word/document.xml': f'<p:presentation xmlns:p="{P}"/>'},
    ]:
        with pytest.raises(SafetyError) as caught:
            decode_input(package('.docx', extra), '.docx', local=True)
        assert caught.value.code in {'OFFICE_FORMAT_MISMATCH', 'OFFICE_UNSAFE_CONTENT'}


@pytest.mark.parametrize('ext', ['.docx', '.pptx', '.xlsx', '.csv'])
def test_new_formats_never_expand_local_or_preview_character_budgets(ext):
    if ext == '.csv':
        data = ('first,head\n' + ''.join(f'{index},' + '学习资料' * 400 + '\n' for index in range(40)) + 'last,tail\n').encode()
    elif ext == '.docx':
        text = 'HEAD_' + ''.join(str(index) + 'x' for index in range(15000)) + '_TAIL'
        data = package(ext, main_xml=f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    elif ext == '.pptx':
        data = package(ext, {'ppt/slides/slide1.xml': f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>' + ''.join(str(index) + 'x' for index in range(15000)) + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'})
    else:
        data = package(ext, {'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>' + ''.join(str(index) + 'x' for index in range(15000)) + '</t></is></c></row></sheetData></worksheet>'})
    local = decode_input(data, ext, local=True)
    preview = decode_input(data, ext)
    assert len(local['text']) <= 12000 and len(preview['text']) <= 1500
    assert local['truncated'] is True and preview['truncated'] is True
    assert local['sampling']['budget_exhausted'] is True
    segments = local['sampling']['segments']
    assert sum(segment['end'] - segment['start'] for segment in segments) + len(segments) - 1 == len(local['text'])
    if ext == '.docx':
        assert 'HEAD_' in local['text'] and '_TAIL' in local['text']


def stuck_document_worker(connection, data, extension, limit):
    connection.recv()
    if path := os.getenv('NEATDROP_DOCUMENT_PID_PATH'):
        from pathlib import Path
        Path(path).write_text(str(os.getpid()))
    time.sleep(20)


def oversized_document_worker(connection, data, extension, limit):
    connection.recv()
    try:
        memory = bytearray(512 * 1024 * 1024)
        connection.send({'text': 'MEMORY_BUDGET_BYPASSED', 'sample': 'test'})
        del memory
    except MemoryError:
        connection.send({'error': 'DOCUMENT_PARSE_FAILED'})


def test_document_timeout_and_cancellation_terminate_worker_and_release_shared_slots(tmp_path, monkeypatch):
    from neatdrop import parsing
    assert callable(getattr(parsing, 'parse_document', None)), 'new documents need a bounded worker'
    original = parsing._document_worker
    monkeypatch.setattr(parsing, '_document_worker', stuck_document_worker)
    started = time.monotonic()
    with pytest.raises(SafetyError, match='^DOCUMENT_PARSE_TIMEOUT$'):
        parsing.parse_document(document_bytes('.docx'), '.docx', timeout=.3)
    assert time.monotonic() - started < 5
    pid_path = tmp_path / 'worker.pid'
    monkeypatch.setenv('NEATDROP_DOCUMENT_PID_PATH', str(pid_path))
    with pytest.raises(SafetyError, match='^DOCUMENT_PARSE_CANCELLED$'):
        parsing.parse_document(document_bytes('.docx'), '.docx', cancelled=pid_path.exists)
    if os.name == 'nt':
        from test_offline import process_is_running
        assert not process_is_running(int(pid_path.read_text()))
    monkeypatch.setattr(parsing, '_document_worker', original)
    assert '线性代数' in parsing.parse_document(document_bytes('.docx'), '.docx')['text']
    assert parsing._SLOTS.acquire(blocking=False)
    assert parsing._SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(SafetyError, match='^PARSER_BUSY$'):
            parsing.parse_document(document_bytes('.docx'), '.docx')
    finally:
        parsing._SLOTS.release()
        parsing._SLOTS.release()


def test_document_worker_memory_budget_is_enforced(monkeypatch):
    from neatdrop import parsing
    assert callable(getattr(parsing, 'parse_document', None)), 'new documents need a bounded worker'
    monkeypatch.setattr(parsing, '_document_worker', oversized_document_worker)
    with pytest.raises(SafetyError, match='^DOCUMENT_PARSE_FAILED$'):
        parsing.parse_document(b'test', '.docx', timeout=5)


def test_new_format_uses_existing_preprocess_admission_before_disk_read(tmp_path):
    from neatdrop.analysis import PREPROCESS_SLOTS
    (tmp_path / 'safe.csv').write_bytes(document_bytes('.csv'))
    ws = Workspace(tmp_path)
    record = ws.scan()[0]
    assert record['supported']
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    assert PREPROCESS_SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(SafetyError, match='^PARSER_BUSY$'):
            prepare_input(ws, record, local=True)
    finally:
        PREPROCESS_SLOTS.release()
        PREPROCESS_SLOTS.release()
