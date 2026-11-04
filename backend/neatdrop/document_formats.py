"""Non-executing, bounded OOXML and CSV readers, called only inside a worker.

No archive member is written to disk, and no relationship is fetched. This is
text extraction, not Office layout/rendering: direct hidden content is omitted,
spreadsheet numbers/dates are raw stored values, and formulas use caches only.
"""
import csv
import io
import posixpath
import re
import stat
import zipfile
from xml.etree import ElementTree as ET

from .extraction import sample_text
from .files import MAX_FILE, SafetyError

MAX_MEMBERS = 512
MAX_MEMBER_BYTES = 8 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_XML_NODES = 200_000
MAX_XML_DEPTH = 64
MAX_UNITS = 4096
MAX_EXTRACTED_CHARS = 2_000_000
MAX_CSV_ROWS = 50_000
MAX_CELLS = 100_000
MAX_COLUMNS = 1024
MAX_FIELD_CHARS = 65536

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
TYPES = {
    '.docx': ('word/document.xml', 'wordprocessingml.document', f'{{{W}}}document'),
    '.pptx': ('ppt/presentation.xml', 'presentationml.presentation', f'{{{P}}}presentation'),
    '.xlsx': ('xl/workbook.xml', 'spreadsheetml.sheet', f'{{{S}}}workbook'),
}
UNSAFE_PART = re.compile(r'(?:^|/)(?:vbaproject(?:signature)?\.bin|activex|embeddings|externallinks|customui)(?:/|$)', re.I)
UNSAFE_TYPE = re.compile(r'macroenabled|vbaproject|activex|oleobject|externalLink|attachedTemplate|altChunk|afChunk', re.I)


class _BoundedTree(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.depth = self.nodes = 0

    def start(self, tag, attrs):
        self.depth += 1
        self.nodes += 1
        if self.depth > MAX_XML_DEPTH or self.nodes > MAX_XML_NODES or len(attrs) > 256:
            raise SafetyError('OFFICE_XML_LIMIT')
        return super().start(tag, attrs)

    def end(self, tag):
        result = super().end(tag)
        self.depth -= 1
        return result

    def doctype(self, name, pubid, system):
        # Expat calls this for every DTD before entity expansion, independent of
        # the document's encoding (including UTF-16). No regex bypass is needed.
        raise SafetyError('OFFICE_XML_UNSAFE')


def _xml(data):
    target = _BoundedTree()
    try:
        root = ET.fromstring(data, parser=ET.XMLParser(target=target))
    except ET.ParseError as exc:
        raise SafetyError('OFFICE_PARSE_FAILED') from exc
    return root, target.nodes


def _part_name(name):
    if (not name or len(name) > 512 or name.startswith('/') or '\\' in name or
            any(char in name for char in ':\x00%?#') or any(ord(char) < 32 for char in name) or
            any(part in {'', '.', '..'} for part in name.split('/'))):
        raise SafetyError('OFFICE_UNSAFE_CONTENT')
    return name


def _target(owner, value):
    if not value or len(value) > 1024 or any(char in value for char in '\\:%?#') or value.startswith('//') or any(ord(c) < 32 for c in value):
        raise SafetyError('OFFICE_UNSAFE_CONTENT')
    # An OPC absolute package URI begins with one slash; it is never a path on
    # the host. Parent segments may resolve within the package, never outside.
    resolved = posixpath.normpath(value[1:] if value.startswith('/') else posixpath.join(posixpath.dirname(owner), value))
    return _part_name(resolved)


class _Package:
    def __init__(self, data, extension):
        if data.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'):
            raise SafetyError('OFFICE_ENCRYPTED')  # encrypted OOXML/legacy CFB
        if not data.startswith(b'PK\x03\x04'):
            raise SafetyError('OFFICE_INVALID_CONTAINER')
        try:
            self.archive = zipfile.ZipFile(io.BytesIO(data))
        except (zipfile.BadZipFile, OSError, ValueError) as exc:
            raise SafetyError('OFFICE_INVALID_CONTAINER') from exc
        self.parts, self.relations = {}, {}
        infos = self.archive.infolist()
        if len(infos) > MAX_MEMBERS:
            raise SafetyError('OFFICE_ZIP_LIMIT')
        seen, total = set(), 0
        for item in infos:
            if item.orig_filename != item.filename:
                raise SafetyError('OFFICE_UNSAFE_CONTENT')
            name = _part_name(item.filename[:-1] if item.is_dir() else item.filename)
            if name.casefold() in seen or stat.S_ISLNK(item.external_attr >> 16):
                raise SafetyError('OFFICE_UNSAFE_CONTENT')
            seen.add(name.casefold())
            if item.flag_bits & (1 | 64):
                raise SafetyError('OFFICE_ENCRYPTED')
            if UNSAFE_PART.search(name):
                raise SafetyError('OFFICE_UNSAFE_CONTENT')
            total += item.file_size
            if (item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} or
                    item.file_size > MAX_MEMBER_BYTES or total > MAX_UNCOMPRESSED_BYTES or
                    item.file_size > MAX_COMPRESSION_RATIO * max(1, item.compress_size)):
                raise SafetyError('OFFICE_ZIP_LIMIT')
            if not item.is_dir():
                self.parts[name] = item
        if '[Content_Types].xml' not in self.parts or '_rels/.rels' not in self.parts:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        types = self.xml('[Content_Types].xml')
        if types.tag != f'{{{CT}}}Types':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        overrides, defaults = {}, {}
        for item in types:
            content_type = item.get('ContentType', '')
            if UNSAFE_TYPE.search(content_type):
                raise SafetyError('OFFICE_UNSAFE_CONTENT')
            if item.tag == f'{{{CT}}}Override':
                name = item.get('PartName', '')
                if not name.startswith('/'):
                    raise SafetyError('OFFICE_FORMAT_MISMATCH')
                name = _part_name(name[1:])
                if name not in self.parts or name in overrides:
                    raise SafetyError('OFFICE_FORMAT_MISMATCH')
                overrides[name] = content_type
            elif item.tag == f'{{{CT}}}Default':
                suffix = item.get('Extension', '').lower()
                if not suffix or suffix in defaults:
                    raise SafetyError('OFFICE_FORMAT_MISMATCH')
                defaults[suffix] = content_type
            else:
                raise SafetyError('OFFICE_FORMAT_MISMATCH')
        self.main, expected_type, expected_root = TYPES[extension]
        if overrides.get(self.main) != f'application/vnd.openxmlformats-officedocument.{expected_type}.main+xml':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        total_nodes = 0
        for name in self.parts:
            content_type = overrides.get(name, defaults.get(name.rsplit('.', 1)[-1].lower(), ''))
            if name.lower().endswith(('.xml', '.rels')) or content_type.endswith('+xml') or content_type in {'application/xml', 'text/xml'}:
                root, nodes = _xml(self.read(name))
                total_nodes += nodes
                if total_nodes > MAX_XML_NODES:
                    raise SafetyError('OFFICE_XML_LIMIT')
                if name.lower().endswith('.rels'):
                    self._relationships(name, root)
        roots = [value for kind, value in self.relations.get('', {}).values() if kind == R + '/officeDocument']
        if roots != [self.main] or self.xml(self.main).tag != expected_root:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')

    def read(self, name):
        if name not in self.parts:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        try:
            with self.archive.open(self.parts[name]) as member:
                data = member.read(MAX_MEMBER_BYTES + 1)
        except (zipfile.BadZipFile, RuntimeError, OSError, ValueError, NotImplementedError) as exc:
            raise SafetyError('OFFICE_PARSE_FAILED') from exc
        if len(data) > MAX_MEMBER_BYTES or len(data) != self.parts[name].file_size:
            raise SafetyError('OFFICE_ZIP_LIMIT')
        return data

    def xml(self, name):
        return _xml(self.read(name))[0]

    def _relationships(self, name, root):
        if name == '_rels/.rels':
            owner = ''
        else:
            directory, filename = posixpath.split(name)
            if posixpath.basename(directory) != '_rels':
                raise SafetyError('OFFICE_FORMAT_MISMATCH')
            owner = posixpath.join(posixpath.dirname(directory), filename[:-5])
            if owner not in self.parts:
                raise SafetyError('OFFICE_FORMAT_MISMATCH')
        if root.tag != f'{{{PR}}}Relationships' or owner in self.relations:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        relationships = {}
        for item in root:
            identifier, kind = item.get('Id'), item.get('Type', '')
            if item.tag != f'{{{PR}}}Relationship' or not identifier or identifier in relationships:
                raise SafetyError('OFFICE_FORMAT_MISMATCH')
            if item.get('TargetMode', 'Internal') != 'Internal' or UNSAFE_TYPE.search(kind):
                raise SafetyError('OFFICE_UNSAFE_CONTENT')
            target = _target(owner, item.get('Target', ''))
            if target not in self.parts:
                raise SafetyError('OFFICE_FORMAT_MISMATCH')
            relationships[identifier] = (kind, target)
        self.relations[owner] = relationships

    def related(self, owner, identifier, kind):
        value = self.relations.get(owner, {}).get(identifier)
        if value is None or value[0] != R + '/' + kind:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        return value[1]


class _Text:
    def __init__(self, kind):
        self.kind, self.units, self.chars, self.warnings = kind, [], 0, set()
        self.omitted = False

    def warn(self, warning, partial=True):
        self.warnings.add(warning)
        self.omitted |= partial

    def add(self, text, *, separator='\n', **location):
        if not text.strip():
            return False
        if ('extraction_limit' in self.warnings or len(self.units) >= MAX_UNITS or
                self.chars + len(text) + len(separator) > MAX_EXTRACTED_CHARS):
            self.warn('extraction_limit')
            return False
        self.units.append((text, location, separator if self.units else ''))
        self.chars += len(text) + len(separator)
        return True

    def finish(self, limit):
        if not self.units:
            raise SafetyError('CSV_NO_TEXT' if self.kind == 'csv' else 'OFFICE_NO_TEXT')
        joined = ''.join(separator + text for text, _, separator in self.units)
        sampled = sample_text(joined, limit)
        pieces, segments, output_size, previous_right, previous_interval = [], [], 0, 0, None
        for interval_index, interval in enumerate(sampled['sampling']['segments']):
            cursor = 0
            for text, location, separator in self.units:
                cursor += len(separator)
                left, right = max(cursor, interval['start']), min(cursor + len(text), interval['end'])
                if left < right:
                    if pieces:
                        boundary = '\n' if previous_interval != interval_index else joined[previous_right:left]
                        pieces.append(boundary)
                        output_size += len(boundary)
                    start = output_size
                    pieces.append(text[left - cursor:right - cursor])
                    output_size += right - left
                    segments.append({**location, 'start': left - cursor, 'end': right - cursor,
                                     'sample_start': start, 'sample_end': output_size})
                    previous_right, previous_interval = right, interval_index
                cursor += len(text)
        budget = sampled['truncated'] or 'extraction_limit' in self.warnings
        truncated = budget or self.omitted
        summary = f'本地 {self.kind.upper()} ' + ('分段抽样；部分内容未读取' if truncated else '文本完整读取')
        notes = {
            'hidden_content_omitted': '省略显式隐藏内容。',
            'auxiliary_content_omitted': '省略批注、页眉页脚、注释等辅助内容。',
            'formula_cached_values_only': '公式仅显示文件已有缓存值，不计算；缓存可能过期。',
            'formula_without_cache': '无缓存的公式单元格未读取。',
            'error_cells_omitted': '错误值单元格未读取。',
            'extraction_limit': '超过结构/内容收集上限。',
        }
        summary += ''.join(notes.get(warning, '') for warning in sorted(self.warnings))
        if self.kind == 'xlsx':
            summary += '数字与日期保留原始存储值，未应用显示格式。'
        return {'text': ''.join(pieces), 'sample': summary, 'truncated': truncated,
                'sampling': {'kind': self.kind, 'truncated': truncated,
                             'budget_exhausted': budget, 'segments': segments,
                             'separator': '\n', 'warnings': sorted(self.warnings), 'summary': summary}}


def _enabled(element, attribute):
    return element is not None and element.get(attribute, '1').lower() not in {'0', 'false', 'off'}


def _word_text(node, result):
    values = []
    def visit(item):
        if item.tag in {f'{{{W}}}del', f'{{{W}}}moveFrom'}:
            result.warn('hidden_content_omitted')
            return
        if item.tag == f'{{{W}}}r' and any(_enabled(item.find(f'{{{W}}}rPr/{{{W}}}{tag}'), f'{{{W}}}val') for tag in ['vanish', 'webHidden']):
            result.warn('hidden_content_omitted')
            return
        if item.tag == f'{{{W}}}t':
            values.append(item.text or '')
        elif item.tag == f'{{{W}}}tab':
            values.append('\t')
        elif item.tag in {f'{{{W}}}br', f'{{{W}}}cr'}:
            values.append('\n')
        for child in item:
            visit(child)
    visit(node)
    return ''.join(values)


def _docx(package, result):
    root = package.xml(package.main)
    body = root.find(f'{{{W}}}body')
    if body is None:
        raise SafetyError('OFFICE_FORMAT_MISMATCH')
    parents = {child: parent for parent in body.iter() for child in parent}
    tables = {node: index for index, node in enumerate(body.iter(f'{{{W}}}tbl'), 1)}
    previous_row = previous_cell = None
    previous_column = None
    for index, paragraph in enumerate(body.iter(f'{{{W}}}p'), 1):
        location = {'paragraph': index}
        ancestor = parents.get(paragraph)
        hidden, row, cell = False, None, None
        while ancestor is not None:
            if ancestor.tag in {f'{{{W}}}del', f'{{{W}}}moveFrom'}:
                hidden = True
            if ancestor.tag == f'{{{W}}}tr':
                row = ancestor
                location['row'] = parents[ancestor].findall(f'{{{W}}}tr').index(ancestor) + 1
            if ancestor.tag == f'{{{W}}}tc':
                cell = ancestor
            if ancestor in tables:
                location['table'] = tables[ancestor]
                break
            ancestor = parents.get(ancestor)
        if hidden:
            result.warn('hidden_content_omitted')
            continue
        text = _word_text(paragraph, result)
        column = row.findall(f'{{{W}}}tc').index(cell) if row is not None and cell is not None else None
        separator = ('\t' * (column - previous_column)
                     if row is not None and row is previous_row and cell is not previous_cell else '\n')
        if result.add(text, separator=separator, **location):
            previous_row, previous_cell = row, cell
            previous_column = column
    if any(re.match(r'word/(?:header|footer|footnotes|endnotes|comments)', name) for name in package.parts):
        result.warn('auxiliary_content_omitted')


def _pptx(package, result):
    root = package.xml(package.main)
    slides = root.find(f'{{{P}}}sldIdLst')
    if slides is None:
        raise SafetyError('OFFICE_NO_TEXT')
    seen = set()
    for index, item in enumerate(slides, 1):
        name = package.related(package.main, item.get(f'{{{R}}}id'), 'slide')
        if name in seen:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        seen.add(name)
        slide = package.xml(name)
        if slide.tag != f'{{{P}}}sld':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        if slide.get('show', '1').lower() in {'0', 'false', 'off'}:
            result.warn('hidden_content_omitted')
            continue
        parents = {child: parent for parent in slide.iter() for child in parent}
        for paragraph in slide.iter(f'{{{A}}}p'):
            ancestor, hidden = paragraph, False
            while ancestor is not None:
                if ancestor.tag in {f'{{{P}}}sp', f'{{{P}}}graphicFrame', f'{{{P}}}grpSp'}:
                    props = ancestor.find(f'.//{{{P}}}cNvPr')
                    hidden |= props is not None and props.get('hidden', '0').lower() in {'1', 'true', 'on'}
                ancestor = parents.get(ancestor)
            if hidden:
                result.warn('hidden_content_omitted')
                continue
            result.add(''.join(item.text or '' for item in paragraph.iter(f'{{{A}}}t')), slide=index)
    if any(name.startswith(('ppt/notesSlides/', 'ppt/comments/')) for name in package.parts):
        result.warn('auxiliary_content_omitted')


def _strings(node):
    # Phonetic guides are auxiliary text, never duplicated into the cell value.
    return ''.join((child.text or '') if child.tag == f'{{{S}}}t' else _strings(child)
                   for child in node if child.tag != f'{{{S}}}rPh')


def _cell_location(value):
    match = re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]{0,6})', value)
    if not match:
        raise SafetyError('OFFICE_PARSE_FAILED')
    column = 0
    for char in match[1]:
        column = column * 26 + ord(char) - ord('A') + 1
    row = int(match[2])
    if column > 16384 or row > 1048576:
        raise SafetyError('OFFICE_PARSE_FAILED')
    return column, row


def _xlsx(package, result):
    root = package.xml(package.main)
    sheets = root.find(f'{{{S}}}sheets')
    if sheets is None or len(sheets) > 128:
        raise SafetyError('OFFICE_XML_LIMIT')
    strings = []
    shared = [name for kind, name in package.relations.get(package.main, {}).values() if kind == R + '/sharedStrings']
    if len(shared) > 1:
        raise SafetyError('OFFICE_FORMAT_MISMATCH')
    if shared:
        shared_root = package.xml(shared[0])
        if shared_root.tag != f'{{{S}}}sst':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        strings = [_strings(item) for item in shared_root if item.tag == f'{{{S}}}si']
    seen, cell_count = set(), 0
    for sheet in sheets:
        name = package.related(package.main, sheet.get(f'{{{R}}}id'), 'worksheet')
        title = sheet.get('name', '')
        if not title or len(title) > 31 or name in seen:
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        seen.add(name)
        if sheet.get('state', 'visible') in {'hidden', 'veryHidden'}:
            result.warn('hidden_content_omitted')
            continue
        if sheet.get('state', 'visible') != 'visible':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        worksheet = package.xml(name)
        if worksheet.tag != f'{{{S}}}worksheet':
            raise SafetyError('OFFICE_FORMAT_MISMATCH')
        hidden_columns = []
        for column in worksheet.findall(f'{{{S}}}cols/{{{S}}}col'):
            if column.get('hidden', '0') in {'1', 'true'}:
                start, end = int(column.get('min', '0')), int(column.get('max', '0'))
                if not 1 <= start <= end <= 16384:
                    raise SafetyError('OFFICE_PARSE_FAILED')
                hidden_columns.append((start, end))
        result.add('工作表：' + title, sheet=title)
        for row_index, row in enumerate(worksheet.findall(f'{{{S}}}sheetData/{{{S}}}row'), 1):
            number = int(row.get('r', str(row_index)))
            if not 1 <= number <= 1048576:
                raise SafetyError('OFFICE_PARSE_FAILED')
            if row.get('hidden', '0') in {'1', 'true'}:
                result.warn('hidden_content_omitted')
                continue
            cells = set()
            previous_column, previous_seen_column = None, 0
            for cell in row.findall(f'{{{S}}}c'):
                cell_count += 1
                if cell_count > MAX_CELLS:
                    raise SafetyError('OFFICE_XML_LIMIT')
                address = cell.get('r', '')
                column, cell_row = _cell_location(address)
                if cell_row != number or address in cells or column <= previous_seen_column:
                    raise SafetyError('OFFICE_PARSE_FAILED')
                cells.add(address)
                previous_seen_column = column
                if any(start <= column <= end for start, end in hidden_columns):
                    result.warn('hidden_content_omitted')
                    continue
                value = cell.find(f'{{{S}}}v')
                formula = cell.find(f'{{{S}}}f')
                if formula is not None:
                    result.warn('formula_cached_values_only', partial=False)
                    if value is None or value.text is None:
                        result.warn('formula_without_cache')
                        continue
                kind = cell.get('t', 'n')
                text = value.text or '' if value is not None else ''
                if kind == 's':
                    if not text.isdigit() or int(text) >= len(strings):
                        raise SafetyError('OFFICE_PARSE_FAILED')
                    text = strings[int(text)]
                elif kind == 'inlineStr' and formula is None:
                    inline = cell.find(f'{{{S}}}is')
                    text = _strings(inline) if inline is not None else ''
                elif kind == 'e':
                    result.warn('error_cells_omitted')
                    continue
                elif kind not in {'n', 'b', 'd', 'str'}:
                    raise SafetyError('OFFICE_PARSE_FAILED')
                separator = ('\t' * (column - previous_column) if previous_column is not None else
                             '\n' + '\t' * (column - 1))
                if result.add(text, separator=separator, sheet=title, cell=address, row=number):
                    previous_column = column


def _csv(data, result):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise SafetyError('CSV_INVALID_UTF8') from exc
    if any(ord(char) < 32 and char not in '\t\r\n' for char in text):
        raise SafetyError('CSV_INVALID')
    csv.field_size_limit(MAX_FIELD_CHARS)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t')
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ','
    count = 0
    try:
        for index, row in enumerate(csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True), 1):
            count += len(row)
            if index > MAX_CSV_ROWS or len(row) > MAX_COLUMNS or count > MAX_CELLS:
                raise SafetyError('CSV_LIMIT')
            result.add('\t'.join(row), row=index)
    except csv.Error as exc:
        raise SafetyError('CSV_LIMIT' if 'field larger' in str(exc) else 'CSV_INVALID') from exc


def extract_document(data, extension, limit):
    """Worker-only entry point; caller enforces process, wall-time and byte caps."""
    if len(data) > MAX_FILE:
        raise SafetyError('FILE_TOO_LARGE')
    result = _Text(extension[1:])
    if extension == '.csv':
        _csv(data, result)
    else:
        package = _Package(data, extension)
        try:
            {'.docx': _docx, '.pptx': _pptx, '.xlsx': _xlsx}[extension](package, result)
        except (ValueError, KeyError, OverflowError) as exc:
            raise SafetyError('OFFICE_PARSE_FAILED') from exc
        finally:
            package.archive.close()
    return result.finish(limit)
