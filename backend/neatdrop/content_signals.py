"""Bounded, review-only content patterns; no I/O, models or format shortcuts.

The caller supplies the shared negation, raw-span and field-value checks so
these signals use the same evidence boundaries as the explicit rules.
"""
import re


NARRATIVES = [
    ('study', 'notes', [
        r'复习|自学|预习|课堂回顾|学习小结',
        r'高等数学|线性代数|微积分|概率论|物理|化学|数据库|数据结构|计算机网络|'
        r'操作系统|机器学习|统计学|英语语法|经济学|矩阵|极限|求导|隔离级别',
        r'(?:整理|总结).{0,24}(?:练习|例题|推导|证明|解题|计算步骤|求导|公式)|解题思路|推导过程',
    ], '学习过程、学科内容和练习推导共同支持；尚未校准'),
    ('study', 'paper', [
        r'本研究|本文|我们(?=考察|提出)|研究工作|研究发现',
        r'(?:提出|考察|评估|分析)[^\n。！？;；，,]{0,24}?(?:方法|模型|算法)|实验设置|研究方法',
        r'(?:比较|对照|消融)实验|实验表明|结果表明|结果讨论|相关文献',
    ], '研究叙述、方法和实验结果共同支持；尚未校准'),
    ('activity', 'meeting', [
        r'(?:大家|团队|双方|我们|小组|项目组|与会人员)(?:(?!没|未|不|无需|无须|不必|没有|尚未).){0,8}'
        r'(?:讨论|商议|协商)|共同(?:讨论|商议)',
        r'[\u4e00-\u9fffA-Za-z]{2,10}负责[^\n。！？;；，,]{1,36}',
        r'(?:约定|决定|形成决议|达成一致|商定).{0,30}(?:周[一二三四五六日天]|下周|本周|明天|后天|'
        r'月[底末]|\d{1,2}[月日]|复查|完成|提交|交付|截止)',
    ], '共同讨论、责任分工和后续约定共同支持；尚未校准'),
]
BUSINESS_TABLE = r'(?:销售|采购|库存|考勤|业务|客户|项目工时|出入库|资产)(?:明细|台账|清单|统计表|报表|汇总|统计)'
ENTITY_HEADER = re.compile(r'客户(?:名称)?|商品(?:名称)?|产品(?:名称)?|物料(?:名称)?|仓库|员工|姓名|部门|供应商|资产(?:名称)?|项目')
MEASURE_HEADER = re.compile(r'数量|(?:含税|未税|销售|采购)?金额|单价|库存(?:量)?|工时|出勤(?:天数)?|收入|支出|余额')
NUMBER = re.compile(r'^[¥￥$]?\s*-?\d[\d,]*(?:\.\d+)?\s*(?:元|件|个|天|小时|h|%)?$')


def content_candidates(body, source_body, *, positive_match, source_interval, meaningful_field_value, sampling=None):
    """Return rule candidates from <=12000 normalized characters and raw spans."""
    candidates = []

    def emit(category, subtype, matches, description, **extra):
        evidence = [{'source': 'structure', 'text': description}]
        for match in matches:
            start, end = match.span() if hasattr(match, 'span') else match
            left, right = source_interval(source_body, start, end)
            evidence.append({'source': 'body', 'text': source_body[left:right],
                             '_sample_start': left, '_sample_end': right})
        candidates.append({'category': category, 'subcategory': subtype, 'score': 7.5,
                           'evidence': evidence, **extra})

    for category, subtype, groups, description in NARRATIVES:
        matches = [positive_match(pattern, body, purpose=True) for pattern in groups]
        # Overlapping words are one clue, not two independent groups. Broad
        # responsibility spans must not swallow the discussion and decision.
        distinct = all(first.end() <= second.start() or second.end() <= first.start()
                       for index, first in enumerate(matches) if first
                       for second in matches[index + 1:] if second)
        if all(matches) and distinct:
            emit(category, subtype, matches, description)

    business = positive_match(BUSINESS_TABLE, body, purpose=True)
    if business:
        def region(offset, length, keys=('sheet', 'table', 'slide', 'page')):
            left, right = source_interval(source_body, offset, offset + length)
            result = set()
            for segment in (sampling or {}).get('segments', []):
                start = segment.get('sample_start', -1)
                end = segment.get('sample_end', start + segment.get('end', 0) - segment.get('start', 0))
                if start < right and left < end:
                    result.add(tuple((key, segment[key]) for key in keys if key in segment))
            return result
        lines, offset = [], 0
        for line in body.split('\n'):
            lines.append((line, offset))
            offset += len(line) + 1
        for index, (line, offset) in enumerate(lines):
            cells = [cell.strip() for cell in line.split('\t')]
            measures = [i for i, cell in enumerate(cells) if MEASURE_HEADER.fullmatch(cell)]
            if len([cell for cell in cells if cell]) < 3 or not measures or not any(ENTITY_HEADER.fullmatch(cell) for cell in cells):
                continue
            # A sheet name or another slide's heading cannot supply the
            # business context for unrelated tabular content elsewhere.
            context_keys = ('sheet', 'slide', 'page')
            if region(business.start(), len(business.group()), context_keys) != region(offset, len(line), context_keys):
                continue
            data = None
            for row, row_offset in lines[index + 1:index + 9]:
                if '\t' not in row or region(row_offset, len(row)) != region(offset, len(line)):
                    break
                values = [cell.strip() for cell in row.split('\t')]
                if len(values) != len(cells) or sum(meaningful_field_value(value) for value in values) < 2:
                    continue
                if any(i < len(values) and NUMBER.fullmatch(values[i]) for i in measures):
                    data = row_offset, row_offset + len(row)
                    break
                # A new textual header starts a different section. Do not
                # search through it for numbers belonging to another table.
                if not any(NUMBER.fullmatch(value) for value in values):
                    break
            if data:
                emit('office', 'spreadsheet', [business, (offset, offset + len(line)), data],
                     '业务上下文、表头和实际数值行共同支持；尚未校准')
                break

    # The subject of a tutorial is not necessarily its archival purpose.
    # Require both explicit quoted-example context and technical explanation.
    title = '\n'.join([line.strip().lstrip('# ') for line in body.splitlines() if line.strip()][:2])[:200]
    lesson = positive_match(r'教程|教学', title, purpose=True)
    quotation = positive_match(r'(?:引用|例如|示例|演示).{0,30}(?:发票|合同|证件|医疗|病历)|'
                               r'(?:发票|合同|证件|医疗|病历).{0,12}(?:示例|样例|演示)', body, purpose=True)
    explanation = positive_match(r'字段|算法|识别|解析|编程|技术', body, purpose=True)
    if lesson and quotation and explanation:
        actual_lesson = positive_match(r'教程|教学', body, purpose=True)
        emit('study', 'notes', [actual_lesson, quotation, explanation],
             '技术教学引用了文档示例，示例用途不等于整份资料用途',
             context_priority=True, example_context=True)
    return candidates
