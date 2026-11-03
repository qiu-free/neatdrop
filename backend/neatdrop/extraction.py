"""Deterministic, bounded local samples with positions in the original input."""
import math


def sample_text(text: str, limit: int = 12000) -> dict:
    if not isinstance(text, str) or not isinstance(limit, int) or limit < 1 or limit > 12000:
        raise ValueError('invalid text sampling input or budget')
    truncated = len(text) > limit
    if not truncated:
        segments = [{'start': 0, 'end': len(text)}] if text else []
    else:
        # Reserve visible boundaries so distant fragments cannot synthesize a
        # lexical anchor. Tiny budgets retain fewer nonempty segments.
        count = min(3, (limit + 1) // 2)
        content_limit = limit - count + 1
        quotas = [content_limit // count + (index >= count - content_limit % count) for index in range(count)]
        if count == 1:
            starts = [0]
        elif count == 2:
            starts = [0, len(text) - quotas[1]]
        else:
            starts = [0, (len(text) - quotas[1]) // 2, len(text) - quotas[2]]
        segments = [{'start': start, 'end': start + quota}
                    for start, quota in zip(starts, quotas) if quota]
    summary = ('本地头、中、尾分段抽样；部分内容未读取' if truncated else '本地文本完整读取')
    return {'text': '\n'.join(text[item['start']:item['end']] for item in segments),
            'sample': summary, 'truncated': truncated,
            'sampling': {'kind': 'text', 'truncated': truncated,
                         'budget_exhausted': truncated, 'segments': segments,
                         'separator': '\n', 'summary': summary}}


def image_regions(size: tuple[int, int]) -> list[tuple[int, int, int, int]]:
    """Full image, then at most five <=1600px local OCR views.

    Narrow long images use overlapping strips spread from beginning to end.
    Larger two-dimensional images use four corners and the centre. Uncovered
    detail is reported by the caller; this function never expands the budget.
    """
    width, height = size
    if width < 1 or height < 1:
        raise ValueError('invalid image size')
    full = (0, 0, width, height)
    if max(width, height) <= 1600:
        return [full]
    tile_width, tile_height = min(width, 1600), min(height, 1600)
    if min(width, height) <= 1600:
        vertical = height >= width
        length = height if vertical else width
        tile_length = tile_height if vertical else tile_width
        count = min(5, math.ceil((length - tile_length) / (tile_length * .8)) + 1)
        positions = [round(index * (length - tile_length) / (count - 1)) for index in range(count)]
        tiles = [(0, position, tile_width, position + tile_height) if vertical else
                 (position, 0, position + tile_width, tile_height) for position in positions]
    else:
        right, bottom = width - tile_width, height - tile_height
        tiles = [(0, 0, tile_width, tile_height), (right, 0, width, tile_height),
                 (right // 2, bottom // 2, right // 2 + tile_width, bottom // 2 + tile_height),
                 (0, bottom, tile_width, height), (right, bottom, width, height)]
    return list(dict.fromkeys([full, *tiles]))
