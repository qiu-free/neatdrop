"""Pure classification and suggestion construction for decoded payloads."""
import copy
import re
import unicodedata

from .classifier import classify_text, fuse_image
from .content_quality import assess_content, apply_content_quality
from .decision import decide
from .files import SafetyError, safe_name


def _evidence_interval(text, excerpt):
    """Find a verified raw interval; normalized offsets are never raw offsets."""
    text = text[:12000]
    if not excerpt:
        return None
    offset = text.find(excerpt)
    if offset >= 0:
        return offset, offset + len(excerpt)

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


def classify_payload(record, payload, *, semantic=None, classifier=None, image_classifier=None,
                     quality_assessor=None, quality_applier=None, decider=None):
    """Build the production suggestion from a verified record and decoded payload.

    The caller owns file verification, extraction and (when enabled) semantic
    model invocation. This function performs the same deterministic decision,
    quality, evidence and safe-name stages used by the local workbench.
    """
    text = payload.get('text', '')
    image_input = payload.get('local_image') or 'image' in payload
    quality_assessor = quality_assessor or assess_content
    quality_applier = quality_applier or apply_content_quality
    classifier = classifier or classify_text
    image_classifier = image_classifier or fuse_image
    decider = decider or decide
    quality = quality_assessor(payload, bool(image_input))
    if image_input:
        classification = image_classifier(record['name'], text, payload.get('visual', []),
                                          payload.get('warnings', []), payload.get('sampling'))
    else:
        classification = classifier(record['name'], text, payload.get('sampling'))
    classification = quality_applier(classification, quality)
    classification = decider(classification, semantic, payload.get('sampling'))
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
            interval = (start_hint, end_hint) if verified_hint else _evidence_interval(text, item['text'])
            if interval is None:
                continue
            offset, evidence_end = interval
            cursor = 0
            matched = []
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
                for key in ('page', 'slide', 'sheet', 'table', 'row'):
                    value = matched[0].get(key)
                    if value is not None and all(segment.get(key) == value for segment in matched):
                        item[key] = value
    first = next((line.strip().lstrip('# ') for line in text.splitlines() if line.strip()), '')
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', first)[:70].strip(' .')
    review = classification['review_required']
    readable_title = any(char.isalnum() for char in title)
    use_title = (readable_title and quality['state'] == 'acceptable' and classification['decision_level'] != 'abstain'
                 and classification.get('content_form') != 'natural_photo')
    if classification.get('content_form') in {'data_chart', 'table_image', 'diagram'}:
        use_title = use_title and any(item.get('source') == 'ocr' for item in classification.get('evidence_items', []))
    name = (title + record['extension']) if use_title else record['name']
    try:
        safe_name(name, record['extension'])
    except SafetyError:
        name = record['name']
        review = True
        classification['decision_level'] = 'candidate' if classification['category'] != 'other' else 'abstain'
        classification['review_reasons'].append('unsafe_title')
    evidence = first[:240] if text else '本地视觉场景候选；不推测人物身份、地点或拍摄日期。'
    if not text and classification['category'] == 'other':
        evidence = '没有足够的本地内容证据，保留原名并等待人工复核。'
    return {**classification, 'file_id': record['id'], 'name': name, 'evidence': evidence,
            'review_required': review,
            'provider': 'offline_models' if image_input else
            'offline_semantic' if any(item.get('source') == 'semantic'
                                      for item in classification.get('evidence_items', [])) else 'local_rules',
            'sample': payload['sample'], 'rule_version': '8'}
