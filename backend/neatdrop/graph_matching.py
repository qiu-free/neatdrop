"""Versioned, bounded sparse matching. Scores are candidates, never facts."""
import hashlib
import math
import re
import unicodedata
from collections import Counter, defaultdict
from PIL import Image, ImageOps, ImageStat
from .content_quality import assess_content

ALGORITHM = 'sparse-v9-1'
STOP = set('the and for with from this that are was were have has not into of to in on at by is as an a project report summary introduction conclusion contents document file notes date title author section results discussion abstract references template meeting minutes agenda overview purpose background status update details information description 项目 报告 总结 内容 日期 标题 作者 目录 引言 结论 背景 目的 概述 结果 讨论 备注 参考 文档 工作 计划 会议 记录 模板 情况 分析 说明'.split())
STOP.update('objectives objective methodology deliverables implementation evaluation timeline resources governance scope responsibilities requirements appendix approval prepared revised version'.split())


def text_features(text: str) -> dict:
    text = text[:12000]
    # Keep offsets in actual decoded text: normalize each source character and
    # map each normalized codepoint back to its raw interval.
    normalized, anchors = [], []
    for index, char in enumerate(text):
        value = unicodedata.normalize('NFKC', char).casefold()
        normalized.append(value)
        anchors.extend([(index, index + 1)] * len(value))
    normalized = ''.join(normalized)
    heading_ranges, cursor = [], 0
    for line in normalized.splitlines(keepends=True):
        # Markdown structure alone is not body evidence, even for previously
        # unseen headings. Keep offsets for body text in the original sample.
        if re.match(r'^\s{0,3}#{1,6}\s', line):
            heading_ranges.append((cursor, cursor + len(line)))
        cursor += len(line)
    terms = {}
    def add(term, start, end):
        if any(begin <= start < finish for begin, finish in heading_ranges):
            return
        if term in STOP or len(term) < 2:
            return
        if term not in terms and len(terms) >= 256:
            return
        locations = terms.setdefault(term, [])
        if len(locations) < 3:
            locations.append([anchors[start][0], anchors[end - 1][1]])
    for match in re.finditer(r'[a-z][a-z0-9]{1,39}|[\u3400-\u9fff]+', normalized):
        token = match.group()
        if '\u3400' <= token[0] <= '\u9fff':
            for offset in range(len(token) - 1):
                add(token[offset:offset + 2], match.start() + offset, match.start() + offset + 2)
        else:
            add(token, match.start(), match.end())
    return {'terms': terms, 'fingerprint': None, 'quality': assess_content({'text': text}, False),
            'sha256': None, 'identity': None, 'updated': None, 'algorithm': ALGORITHM}


def image_fingerprint(image):
    image = ImageOps.exif_transpose(image).convert('L')
    image.thumbnail((256, 256))
    if ImageStat.Stat(image).stddev[0] < 5:
        return None
    small = image.resize((9, 8), Image.Resampling.LANCZOS)
    flattened = getattr(small, 'get_flattened_data', None)
    pixels = list(flattened()) if flattened is not None else list(small.getdata())
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    return f'{value:016x}'


def match_features(features: dict[str, dict]) -> list[dict]:
    ids = sorted(features)
    usable = {key: feature.get('terms', {}) for key, feature in features.items()
              if feature.get('quality', {}).get('state') == 'acceptable'}
    frequency = Counter(term for terms in usable.values() for term in terms)
    vectors, norms, inverted = {}, {}, defaultdict(list)
    for key in sorted(usable):
        vector = {}
        for term, locations in usable[key].items():
            # Very common corpus vocabulary provides no subject evidence. Two
            # document corpora retain shared terms; static template words still go.
            if term in STOP or (term.isascii() and len(usable) >= 4 and frequency[term] > max(3, len(usable) * .8) and len(frequency) > 16):
                continue
            vector[term] = (1 + math.log(max(1, len(locations)))) * (1 + math.log((1 + len(usable)) / (1 + frequency[term])))
            inverted[term].append(key)
        vectors[key] = vector
        norms[key] = math.sqrt(sum(v*v for v in vector.values()))
    # Bound neighbours before allocating pair evidence. Rare terms enter first;
    # dense postings connect a stable local window instead of a quadratic clique.
    neighbours = defaultdict(set)
    for term in sorted(inverted, key=lambda t: (len(inverted[t]), t)):
        members = inverted[term]
        for index, left in enumerate(members):
            for right in members[index + 1:index + 13]:
                if len(neighbours[left]) < 64:
                    neighbours[left].add(right)
    candidates = []
    for left, right in ((left, right) for left in sorted(neighbours) for right in sorted(neighbours[left])):
        common = sorted(vectors[left].keys() & vectors[right].keys())
        # Overlapping CJK fragments must supply at least two nonoverlapping
        # anchors in each document, so one shared phrase cannot manufacture proof.
        independent = []
        for term in sorted(common, key=lambda t: (-vectors[left][t], t)):
            if all(any(all(end <= old_start or start >= old_end for old in independent
                           for old_start, old_end in usable[key][old])
                       for start, end in usable[key][term]) for key in (left, right)):
                independent.append(term)
        if len(independent) < 2 or not norms[left] or not norms[right]:
            continue
        score = sum(vectors[left][term] * vectors[right][term] for term in common) / (norms[left] * norms[right])
        if score >= .32:
            candidates.append((round(min(1., score), 4), left, right, 'text_similar', independent[:8]))
    # At most 1000 bounded perceptual fingerprints; no image content retained.
    for index, left in enumerate(ids):
        a = features[left].get('fingerprint')
        if not a:
            continue
        closest = []
        for right in ids[index + 1:]:
            b = features[right].get('fingerprint')
            if b:
                distance = (int(a, 16) ^ int(b, 16)).bit_count()
                if distance <= 6:
                    closest.append((distance, right))
        for distance, right in sorted(closest)[:12]:
            candidates.append((round(1 - distance / 64, 4), left, right, 'visual_similar', []))
    degrees, result = Counter(), []
    for score, left, right, kind, keywords in sorted(candidates, key=lambda r: (-r[0], r[1], r[2], r[3])):
        if degrees[left] >= 5 or degrees[right] >= 5:
            continue
        signature = ':'.join([ALGORITHM, kind, left, right, features[left].get('sha256') or '', features[right].get('sha256') or ''])
        result.append({'id': hashlib.sha256(signature.encode()).hexdigest(), 'source': left, 'target': right,
                       'kind': kind, 'status': 'suggested', 'origin': 'automatic', 'created': max(features[left].get('updated') or '', features[right].get('updated') or ''),
                       'score': score, 'keywords': keywords})
        degrees[left] += 1
        degrees[right] += 1
    return result
