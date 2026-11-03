"""Bounded diagnostics of existing extraction, not calibrated accuracy scores.

At most the existing 12000-character / 150-line budgets are inspected. A readable
character is a Unicode letter or number; mathematical symbols and punctuation
are neutral. Fewer than eight readable characters cannot support text naming.
Replacement, private-use and non-whitespace control/unassigned characters are
suspect: two or more covering at least 10% of nonspace input flag garbling.
Any suspect character in the first nonempty line also blocks title naming.
Any retained OCR line score below .8 requires review, not a claim
that the classifier has any particular error probability.
These explicit heuristics do not detect all mojibake or validate document truth.
"""
import copy
import math
import unicodedata


ISSUE_SUMMARIES = {
    'no_readable_text': '可用文字不足，请核对原文件。',
    'text_garbled': '文字包含不可读字符，请核对原文件。',
    'ocr_low_confidence': '已保留的图中文字识别分值偏低，请核对原图。',
    'partial_read': '部分内容未完整读取，请核对未读取部分。',
    'low_information_image': '图像信息不足，暂不能提供可靠的内容线索。',
}


def assess_content(payload: dict, image_input: bool) -> dict:
    raw_text = payload.get('text', '')
    text = raw_text[:12000] if isinstance(raw_text, str) else ''
    readable = sum(unicodedata.category(char)[0] in {'L', 'N'} for char in text)
    replacement = text.count('\ufffd')
    suspect = sum(char == '\ufffd' or (unicodedata.category(char)[0] == 'C' and not char.isspace())
                  for char in text)
    nonspace = sum(not char.isspace() for char in text)
    issues = []
    # A visual input can legitimately have no text (photo/chart/diagram). A
    # genuine blank is supplied by the existing low-information image warning.
    if readable < 8 and (not image_input or nonspace):
        issues.append('no_readable_text')
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), '')[:200]
    damaged_title = any(char == '\ufffd' or (unicodedata.category(char)[0] == 'C' and not char.isspace())
                        for char in first_line)
    if damaged_title or (suspect >= 2 and suspect * 10 >= max(1, nonspace)):
        issues.append('text_garbled')
    lines = payload.get('ocr_lines', []) if image_input else []
    lines = [line for line in lines[:150] if isinstance(line, dict) and
             isinstance(line.get('text'), str) and line['text'].strip()] if isinstance(lines, list) else []
    metrics = {'text_chars': len(text), 'readable_chars': readable,
               'replacement_chars': replacement, 'ocr_lines': len(lines)}
    scores = [line['score'] for line in lines if isinstance(line.get('score'), (int, float)) and
              not isinstance(line['score'], bool) and math.isfinite(line['score']) and 0 <= line['score'] <= 1]
    if scores:
        mean = sum(scores) / len(scores)
        metrics['ocr_mean_confidence'] = round(mean, 4)
        # A high average must not validate a low-score title or support field.
        if min(scores) < .8:
            issues.append('ocr_low_confidence')
    sampling = payload.get('sampling') or {}
    if payload.get('truncated') or sampling.get('truncated') or sampling.get('budget_exhausted'):
        issues.append('partial_read')
    low_image = image_input and 'image_low_information' in payload.get('warnings', [])
    if low_image:
        issues.append('low_information_image')
    unavailable = low_image or (not image_input and readable == 0)
    state = 'unavailable' if unavailable else 'limited' if issues else 'acceptable'
    summary = ''.join(ISSUE_SUMMARIES[issue] for issue in issues)
    if not summary:
        summary = '本地内容读取未发现上述限制；读取状态不代表分类准确率。'
    return {'state': state, 'issues': issues, 'summary': summary, 'metrics': metrics}


def apply_content_quality(classification: dict, quality: dict) -> dict:
    result = copy.deepcopy(classification)
    result['quality'] = copy.deepcopy(quality)
    if 'low_information_image' in quality.get('issues', []):
        result.update(category='other', subcategory='unclassified', content_form='unknown',
                      candidates=[], evidence_items=[], tags=[])
    if quality.get('state') in {'limited', 'unavailable'}:
        reasons = list(result.get('review_reasons', []))
        reasons.append('content_quality_limited')
        if 'ocr_low_confidence' in quality.get('issues', []):
            reasons.append('ocr_quality_limited')
        result['review_reasons'] = list(dict.fromkeys(reasons))
        result['review_required'] = True
        result['decision_level'] = 'abstain' if result.get('category') == 'other' else 'candidate'
    return result
