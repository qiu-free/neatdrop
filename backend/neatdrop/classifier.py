"""Conservative multi-evidence rules; scores are priorities, not probabilities."""
import re
import unicodedata

# Each tuple: category, subtype, distinctive title/body anchors, supporting fields.
RULES = [
    ('finance', 'invoice', r'增值税.{0,8}发票|电子.{0,4}发票|普通发票|专用发票|tax invoice', [r'发票号码|发票代码', r'购买方|购方', r'销售方|销方', r'价税合计|税额|税率']),
    ('finance', 'receipt', r'消费小票|购物小票|收银小票|销售小票|购物凭证|receipt', [r'收银|找零', r'实付|合计', r'单价|数量|小计']),
    ('finance', 'payment', r'支付成功|付款成功|转账成功|交易成功|电子回单', [r'交易单号|流水号', r'收款方|收款人', r'支付金额|付款金额|实付']),
    ('finance', 'bill', r'对账单|银行流水|信用卡账单|消费账单', [r'余额|账户', r'收入|支出|借方|贷方']),
    ('finance', 'reimbursement', r'报销.{0,8}说明|报销.{0,8}申请|报销.{0,8}材料|报销.{0,8}明细|费用报销', [r'提交|附件|审批|申请人', r'发票|票据|费用']),
    ('study', 'notes', r'课程笔记|学习笔记|复习笔记|读书笔记|课堂笔记|课程复习|lecture notes', [r'课程|学习|复习|本节', r'矩阵|特征值|定理|知识点|公式|概念|算法']),
    ('study', 'courseware', r'课件|课程.{0,5}通知|课程安排|教学大纲|教学计划|课程学习|lecture|syllabus', [r'课程|教学|讲义', r'章节|第三章|学时|习题|矩阵']),
    ('study', 'paper', r'学术论文|研究论文|毕业论文|文献综述|研究报告|research paper', [r'摘要|abstract', r'关键词|keywords', r'参考文献|references', r'doi\s*:|方法|结论']),
    ('study', 'exam', r'试卷|试题|练习题|模拟考试|习题集|考试题', [r'选择题|填空题|解答题', r'得分|满分|答案|解析']),
    ('study', 'board', r'课程板书|课堂板书|板书照片', [r'公式|定理|证明|矩阵|方程']),
    ('office', 'contract', r'劳动合同|租赁合同|服务合同|合同协议|合作协议|保密协议|合同书', [r'甲方|乙方', r'期限|违约|条款', r'签字|盖章|签署']),
    ('office', 'resume', r'个人简历|求职简历|curriculum vitae|resume', [r'教育经历|教育背景', r'工作经历|工作经验', r'求职意向|项目经验|技能']),
    ('office', 'report', r'工作报告|项目报告|调研报告|总结报告|年度报告|周报|月报', [r'进度|总结|计划|结论', r'项目|部门|工作']),
    ('office', 'work_notes', r'工作记录|工作日志|项目备忘|任务清单', [r'项目|工作|负责人|进度']),
    ('activity', 'notice', r'活动通知|社团.{0,10}通知|读书会.{0,6}通知|比赛通知|活动公告', [r'报名|活动', r'时间|地点|截止|举办']),
    ('activity', 'registration', r'报名表|报名申请|参赛申请|报名材料', [r'姓名|联系人|电话', r'报名|参赛|提交']),
    ('activity', 'meeting', r'会议纪要|会议通知|会议议程|会议记录', [r'参会|议题|会议', r'时间|地点|人员|决议']),
    ('life', 'delivery', r'取件通知|取件码|快递.{0,8}取件|包裹.{0,5}到', [r'快递|驿站|包裹', r'取件码|取货码|柜号']),
    ('life', 'travel', r'登机牌|火车票|高铁票|行程单|机票|车票', [r'出发|到达|车次|航班', r'座位|座号|检票|登机']),
    ('life', 'order', r'购物订单|订单详情|订单确认|购买记录', [r'订单编号|订单号', r'收货|商品|配送|实付']),
    ('life', 'medical', r'门诊病历|住院病历|检查报告|检验报告|处方笺|就诊记录|诊断证明', [r'诊断|临床|检查结果', r'用药|处方|就诊|医生|患者']),
    ('life', 'identity', r'居民身份证|中华人民共和国护照|驾驶证|学生证', [r'姓名|name', r'证件号码|公民身份号码|签发|有效期']),
    ('temporary', 'queue', r'排队号|取餐码|叫号通知|取餐号|排队凭证', [r'排队|取餐|等候|就餐', r'号码|编号|桌号|号']),
    ('temporary', 'code', r'动态付款码|一次性验证码|临时通行码', [r'有效期|分钟|验证码|临时']),
    ('social', 'poster', r'宣传海报|活动海报|电影海报|poster', [r'设计|海报|宣传']),
    ('social', 'illustration', r'插画作品|插画设计|数字绘画|illustration', [r'绘画|设计|插画']),
    ('social', 'wallpaper', r'桌面壁纸|手机壁纸|wallpaper', [r'壁纸|分辨率']),
    ('social', 'meme', r'表情包|搞笑表情|meme', [r'表情|搞笑']),
]

# These purposes have no calibration data. An explicit content anchor
# and at least two different field groups are mandatory; filenames never count.
# Alternatives inside a regex are synonyms of one group, not extra evidence.
PURPOSE_RULES = [
    ('study', 'experiment_material', r'实验记录|实验报告|实验资料|实验指导', [
        r'实验目的[：:]', r'(?:实验器材|实验设备|实验材料)[：:]',
        r'(?:实验步骤|实验方法)[：:]', r'(?:实验结果|实验数据)[：:]']),
    ('study', 'technical_document', r'技术文档|接口文档|api\s*(?:接口)?文档|部署文档|开发文档', [
        r'(?:接口地址|请求路径|endpoint)[：:]', r'(?:请求参数|输入参数|配置参数)[：:]',
        r'(?:返回值|响应结果|返回字段)[：:]', r'(?:错误码|部署步骤|依赖版本)[：:]']),
    ('study', 'reading_excerpt', r'读书摘录|阅读摘录|读书摘抄|书籍摘录', [
        r'(?:书名|书籍名称)[：:]', r'作者[：:]',
        r'(?:摘录原文|摘录内容|原文摘抄)[：:]', r'(?:页码|章节)[：:]']),
    ('office', 'project_plan', r'项目(?:实施|建设|执行)?方案|项目计划书', [
        r'(?:项目目标|建设目标)[：:]', r'(?:实施范围|项目范围)[：:]',
        r'(?:里程碑|实施进度|项目进度)[：:]', r'(?:负责人|资源预算|项目预算)[：:]']),
    ('office', 'requirements', r'需求设计|需求说明(?:书)?|需求规格(?:说明书)?|产品需求(?:文档)?|软件需求(?:文档)?', [
        r'(?:用户角色|用户场景|使用场景)[：:]', r'(?:功能需求|功能描述)[：:]',
        r'(?:验收标准|验收条件)[：:]', r'(?:交互流程|业务流程|非功能需求)[：:]']),
    ('office', 'email', r'邮件存档|电子邮件|邮件归档|e-?mail\s+archive', [
        r'(?:发件人|from)[：:]', r'(?:收件人|to)[：:]',
        r'(?:主题|subject)[：:]', r'(?:发送时间|发送日期|date)[：:]']),
    ('life', 'warranty', r'保修说明|保修凭证|保修卡|质保说明', [
        r'(?:产品型号|设备型号|型号)[：:]', r'(?:保修期限|质保期限|保修期)[：:]',
        r'(?:保修范围|质保范围)[：:]', r'(?:售后电话|售后服务|维修网点)[：:]']),
    ('life', 'insurance', r'保险保单|保险合同|保险凭证|保险资料|保险单', [
        r'(?:保单号码|保单编号|保单号)[：:]', r'(?:被保险人|投保人)[：:]',
        r'(?:保险期间|保险期限|保障期限)[：:]', r'(?:保险责任|保障范围|保险金额)[：:]']),
    ('finance', 'bank_material', r'银行(?:开户|销户|账户|资信)(?:办理)?(?:证明|申请(?:书|表)?|材料|回执)|开户许可证|银行业务回执|账户业务办理确认', [
        r'(?:开户银行|开户行|办理银行)[：:]', r'(?:账户名称|户名|账户持有人)[：:]',
        r'(?:银行账号|银行帐号|账户号码|账号|帐号)[：:]', r'(?:办理事项|银行业务|证明用途)[：:]']),
    ('finance', 'utility_payment', r'(?:水费|电费|燃气费|暖气费|物业费|学费|公共服务)?缴费(?:凭证|回执|证明)|费用缴纳回执', [
        r'(?:费用项目|缴费项目)[：:]', r'(?:缴费状态|支付状态)[：:]',
        r'(?:缴费金额|实缴金额)[：:]', r'(?:缴费户号|用户编号|缴费期间)[：:]']),
    ('finance', 'tax_material', r'完税证明|税收缴款书|(?:纳税|税务|个人所得税|企业所得税)(?:申报|办理)(?:回执|材料|表)|纳税申报资料', [
        r'(?:纳税人名称|纳税人|扣缴义务人)[：:]', r'(?:纳税人识别号|税务识别号|税号)[：:]',
        r'(?:税款所属期|所属期间|申报期间)[：:]', r'(?:申报税种|税种|实缴税额|应纳税额)[：:]']),
    ('study', 'research_data', r'研究(?:观测|测量)?数据|科研(?:测量|观测|数据)记录|科研数据|研究观测记录', [
        r'(?:研究课题|研究项目|科研课题|研究背景)[：:]',
        r'(?:变量定义|变量说明|观测数据|测量数据|测量值|观测值)[：:]',
        r'(?:采集日期|采集时间|采集方法|测量方法)[：:]', r'(?:样本编号|观测站点|数据单位)[：:]']),
    ('office', 'presentation', r'(?:项目|工作|业务|部门|年度|季度)(?:汇报)?(?:演示资料|汇报幻灯片|演示讲稿)|项目汇报演示|工作演示文稿', [
        r'(?:汇报主题|演讲主题|演示主题)[：:]', r'(?:汇报对象|展示对象|演讲对象)[：:]',
        r'(?:演示提纲|页面提纲|幻灯片提纲)[：:]', r'(?:讲稿|演讲稿|页面内容)[：:]']),
    ('life', 'property', r'物业(?:维修|管理|服务|事项)(?:通知|记录|说明)|住房管理(?:记录|通知|说明)|交房(?:资料|通知)|房屋维修记录', [
        r'(?:房屋地址|房屋坐落|小区名称|住房地址)[：:]', r'(?:物业事项|管理事项|维修事项|交房事项)[：:]',
        r'(?:办理安排|处理安排|维修安排|交房时间)[：:]', r'(?:物业服务单位|物业联系人|物业电话)[：:]']),
    ('life', 'travel_material', r'旅行(?:行程规划|计划|攻略|准备资料)|旅游攻略|出游计划|行前准备清单', [
        r'(?:旅行目的地|目的地|游览城市)[：:]', r'(?:计划日期|出游时间|旅行日期)[：:]',
        r'(?:游览安排|景点安排|行程规划)[：:]', r'(?:行前清单|行前准备|旅行预算)[：:]']),
]
# Extracted table key/value cells are separated by a literal TAB. Keep that
# delimiter in the matched evidence; arbitrary spaces cannot invent fields.
PURPOSE_RULES = [(category, subtype, anchor, [pattern.replace('[：:]', r'[：:\t]') for pattern in groups])
                 for category, subtype, anchor, groups in PURPOSE_RULES]
PURPOSE_LABELS = {(category, subtype) for category, subtype, *_ in PURPOSE_RULES}
# A pending bill is not a completed payment, and study metadata without
# observations or variable definitions is not research data.
REQUIRED_PURPOSE_GROUPS = {('finance', 'utility_payment'): {0, 1},
                           ('study', 'research_data'): {0, 1}}
PURPOSE_FIELD_LABELS = '|'.join(f'(?:{pattern})' for *_, groups in PURPOSE_RULES for pattern in groups)


def normalized(text):
    return unicodedata.normalize('NFKC', text or '').casefold()


def source_interval(source, start, end):
    """Map normalized offsets back to a contiguous original interval."""
    def boundary(offset):
        low, high = 0, len(source)
        while low < high:
            middle = (low + high + 1) // 2
            if len(normalized(source[:middle])) <= offset:
                low = middle
            else:
                high = middle - 1
        return low
    return boundary(start), boundary(end)


def source_excerpt(source, start, end):
    left, right = source_interval(source, start, end)
    return source[left:right]


def positive_match(pattern, text, purpose=False):
    for match in re.finditer(pattern, text):
        if not negated_at(text, match.start(), purpose):
            return match
    return None


def negated_at(text, start, purpose=False):
    prefix = text[text.rfind('\n', 0, start) + 1:start]
    # A disclaimer about an earlier clause does not negate a later document.
    prefix = re.split(r'[。！？;；,，]', prefix)[-1]
    negation = r'不是|并非|不属于|勿作为|非真实|没有真实|not an?\s*$'
    if purpose:
        negation += r'|没有|不(?:含|包含|提供|涉及|用于)|未(?:提供|含有)|(?:无|非)\s*$|without\s*$'
    return bool(re.search(negation, prefix))


def meaningful_field_value(value):
    # Validate missing markers independently from displayed evidence. A full
    # stop does not turn "无" into data; names such as "无锡银行" remain values.
    marker = value
    while marker and (marker[-1].isspace() or unicodedata.category(marker[-1]).startswith('P')):
        marker = marker[:-1]
    if re.match(r'^(?:无(?:实际|真实)|没有|不存在|暂无|未提供|不适用|未知|待填|待补充|待录入|'
                r'请填写|填写|占位|空白|(?:尚)?未(?:定义|采集|获取|填写|填入|录入|提供)|'
                r'n/?a\b|none\b|unknown\b|tbd\b|todo\b)', marker):
        return False
    if re.fullmatch(r'无|非|[-—_.\s]*|x{2,}|某某|某公司|某银行', marker):
        return False
    if re.fullmatch(r'\[.*\]|【.*】|\{\{.*\}\}|<.*>|\$\{.*\}', value):
        return False
    return any(unicodedata.category(char)[0] in {'L', 'N'} for char in value)


def invoice_fields_complete(body):
    """Require an actual issuer/buyer and a numeric ticket or amount field.

    Unpunctuated OCR is accepted, but a next field/line/TAB column is never a
    value for an empty label. This validates evidence, not invoice authenticity.
    """
    labels = r'发票号码|发票代码|购买方|购方|销售方|销方|价税合计|税额|税率'
    found = set()
    for field in re.finditer(labels, body):
        if negated_at(body, field.start(), purpose=True):
            continue
        tail = body[field.end():].split('\n', 1)[0].lstrip(' ')
        if tail.startswith((':', '：', '\t')):
            tail = tail[1:]
        tail = re.split(r'[\t;；，,]', tail, maxsplit=1)[0]
        next_field = re.search(labels, tail)
        raw_value = tail[:next_field.start()] if next_field else tail
        # A second label (including unknown metadata) does not become the
        # missing value. Invoice parties/ticket numbers do not need colons.
        if ':' in raw_value or '：' in raw_value:
            continue
        value = raw_value.strip()
        if not meaningful_field_value(value):
            continue
        if field.group() in {'购买方', '购方', '销售方', '销方'}:
            found.add('party')
        elif field.group() in {'发票号码', '发票代码'} and re.fullmatch(r'\d{5,30}', value):
            found.add('number')
        elif field.group() in {'价税合计', '税额', '税率'} and re.fullmatch(
                r'(?:[¥￥]|rmb\s*)?[+-]?\d+(?:\.\d{1,4})?\s*(?:元|%|人民币)?', value):
            found.add('number')
    return {'party', 'number'} <= found


def purpose_fields(groups, body, label=None, source_body=None):
    """Count groups with a readable value on the same line, once per group.

    Stop at the next TAB cell or field label, including unknown later columns.
    Validate a trimmed value, but preserve its original evidence span.
    """
    hits = []
    found = set()
    for index, pattern in enumerate(groups):
        for field in re.finditer(pattern, body):
            if negated_at(body, field.start(), purpose=True):
                continue
            tail = body[field.end():].split('\n', 1)[0].split('\t', 1)[0]
            next_field = re.search(PURPOSE_FIELD_LABELS, tail)
            raw_value = tail[:next_field.start()] if next_field else tail
            raw_value = re.split(r'[;；]', raw_value, maxsplit=1)[0]
            value = raw_value.strip()
            if not meaningful_field_value(value):
                continue
            if label == ('finance', 'utility_payment'):
                if index == 0 and not re.search(r'水费|电费|燃气费|天然气费|暖气费|供暖费|物业费|学费|公共服务费', value):
                    continue
                if index == 1 and not re.fullmatch(r'(?:已缴清|已缴费|已缴纳|已付清|已支付|缴费成功|支付成功|缴纳成功)[。.!！]?', value):
                    continue
            found.add(index)
            end = min(field.end() + len(raw_value), field.start() + 160)
            excerpt = (body[field.start():end] if source_body is None else
                       source_excerpt(source_body, field.start(), end))
            hits.append({'source': 'body', 'text': excerpt})
            break
    if not REQUIRED_PURPOSE_GROUPS.get(label, set()) <= found:
        return []
    return hits


def classify_text(name, text, sampling=None):
    # Bound raw normalization and source-position work before processing text;
    # combining sequences must not pull unseen tail content into the budget.
    source_body = (text or '')[:12000]
    body = normalized(source_body)[:12000]
    lines = [s.strip().lstrip('# ') for s in body.splitlines() if s.strip()]
    title = '\n'.join(lines[:2])[:200]
    filename = normalized(name)
    candidates = []
    for category, subtype, anchor, supports in RULES:
        hits = []
        score = 0
        match = positive_match(anchor, title)
        if match:
            score += 6
            hits.append({'source': 'title', 'text': match.group()})
        elif match := positive_match(anchor, body):
            score += 3
            hits.append({'source': 'body', 'text': match.group()})
        elif match := re.search(anchor, filename):
            score += 1
            hits.append({'source': 'filename', 'text': match.group()})
        if subtype == 'invoice' and not hits and re.search(r'发票', filename):
            score += 1
            hits.append({'source': 'filename', 'text': '发票'})
        # A word inside the anchor is the same evidence, even if repeated.
        # Mask every occurrence without moving offsets or joining fragments.
        support_body = re.sub(anchor, lambda found: ' ' * len(found.group()), body)
        independent_support = False
        for pattern in supports:
            if match := positive_match(pattern, support_body):
                score += 1.5
                hits.append({'source': 'body', 'text': match.group()})
                independent_support = True
        if not any(h['source'] in {'title', 'filename'} for h in hits) and score < 6:
            continue
        if score:
            candidates.append({'category': category, 'subcategory': subtype, 'score': score,
                               'evidence': hits, 'independent_support': independent_support})
    purpose_candidates = []
    for category, subtype, anchor, groups in PURPOSE_RULES:
        match = positive_match(anchor, body, purpose=True)
        if match is None:
            continue
        supports = purpose_fields(groups, body, (category, subtype), source_body=source_body)
        if len(supports) < 2:
            continue
        title_match = positive_match(anchor, title, purpose=True)
        hits = [{'source': 'title' if title_match else 'body',
                 'text': source_excerpt(source_body, match.start(), match.end())}]
        hits.extend(supports)
        purpose_candidates.append({'category': category, 'subcategory': subtype,
                                   'score': (6 if title_match else 3) + 1.5 * len(supports), 'evidence': hits})
    purpose_conflict = bool(purpose_candidates and (len(purpose_candidates) > 1 or
                            any(candidate['score'] >= 6 for candidate in candidates)))
    candidates.extend(purpose_candidates)
    # These structures improve recall without claiming the status of a calibrated
    # rule. Multiple sections are required; isolated vocabulary is insufficient.
    structures = [
        ('study', 'paper', [r'(?m)^\s*(?:摘要|abstract)\b|(?m:^摘要[：:])',
                            r'关键词|key\s*words', r'参考文献|references',
                            r'(?m)^\s*(?:\d+[. ]+)?(?:methods|methodology|研究方法|方法)\b'], 3,
         '摘要、关键词、研究方法或参考文献的学术结构'),
        ('study', 'notes', [r'定义[：:]|definition', r'定理[：:]|theorem',
                            r'证明|proof', r'例题|习题|example'], 3,
         '定义、定理、证明与例题的学习结构'),
    ]
    for category, subtype, patterns, minimum, description in structures:
        matches = sum(bool(positive_match(pattern, body)) for pattern in patterns)
        if matches >= minimum and not any(c['subcategory'] == subtype and c['category'] == category for c in candidates):
            candidates.append({'category': category, 'subcategory': subtype, 'score': 5.5,
                               'evidence': [{'source': 'structure', 'text': description}]})
    from .content_signals import content_candidates
    for candidate in content_candidates(body, source_body, positive_match=positive_match,
                                         source_interval=source_interval, meaningful_field_value=meaningful_field_value,
                                         sampling=sampling):
        existing = next((row for row in candidates if (row['category'], row['subcategory']) ==
                         (candidate['category'], candidate['subcategory'])), None)
        # A weak heading must not swallow independent structure for the same
        # purpose. Keep established, corroborated rules unchanged otherwise.
        if candidate.get('context_priority') or existing and existing.get('independent_support') is False:
            candidates = [row for row in candidates if (row['category'], row['subcategory']) !=
                          (candidate['category'], candidate['subcategory'])]
        if not any((row['category'], row['subcategory']) == (candidate['category'], candidate['subcategory'])
                   for row in candidates):
            candidates.append(candidate)
    # Explicit teaching/quotation context is a different decision from the
    # subject being described; preserve the quoted labels as alternatives.
    candidates.sort(key=lambda c: (bool(c.get('context_priority')), c['score']), reverse=True)
    reasons = []
    if not candidates:
        best = {'category': 'other', 'subcategory': 'unclassified', 'score': 0, 'evidence': []}
        reasons.append('insufficient_evidence')
    else:
        best = candidates[0]
        if best.get('independent_support') is False and any(hit['source'] == 'title' for hit in best['evidence']):
            reasons.append('title_only')
        if best['subcategory'] == 'invoice' and not invoice_fields_complete(body):
            reasons.append('required_fields_missing')
        if best.get('example_context'):
            reasons.append('example_context')
        if (best['category'], best['subcategory']) in PURPOSE_LABELS:
            reasons.append('purpose_uncalibrated')
        if purpose_conflict:
            reasons.append('competing_categories')
        if purpose_candidates and re.search(r'教程|教学|示例|样例|占位|范本|模板|how\s+to|'
                                           r'(?<![\w@.])(?:tutorial|example|sample|specimen|template)(?![\w@.])', body):
            reasons.append('example_context')
        if best['score'] < 6:
            reasons.append('weak_evidence')
        if any(hit['source'] == 'structure' for hit in best['evidence']):
            reasons.append('structure_uncalibrated')
        if best['evidence'] and all(e['source'] == 'filename' for e in best['evidence']):
            reasons.append('filename_only')
        if (len(candidates) > 1 and candidates[1]['score'] >= 6 and
                candidates[1].get('independent_support') is not False and
                best['score'] - candidates[1]['score'] < 2.5):
            reasons.append('competing_categories')
        if best['category'] == 'finance' and re.search(r'教程|算法|引用.{0,20}示例|示例.{0,20}字段', body):
            reasons.append('example_context')
        if (best['category'] == 'finance' or best['subcategory'] in {'identity', 'medical', 'contract'}) and re.search(
                r'示例|样例|占位|范本|模板|教程|sample|specimen|template', body):
            reasons.append('example_context')
        if best['subcategory'] == 'paper' and re.search(
                r'(?:论文|文献|参考文献).{0,12}(?:写作|格式|规范|教程|说明)|how\s+to\s+(?:write|cite)|'
                r'(?:paper|citation|reference).{0,20}(?:tutorial|format|guide)', body):
            reasons.append('example_context')
        if best['subcategory'] in {'wallpaper', 'work_notes', 'code', 'queue'} and re.search(
                r'教程|设置说明|示例|模板|how\s+to|tutorial|example|template', body):
            reasons.append('example_context')
    return {'category': best['category'], 'subcategory': best['subcategory'], 'content_form': 'text_document',
            'tags': [c['subcategory'] for c in candidates[1:3] if c['score'] >= 6],
            'evidence_items': best['evidence'], 'review_required': bool(reasons), 'review_reasons': list(dict.fromkeys(reasons)),
            'candidates': [{k: c[k] for k in ('category', 'subcategory', 'score')} for c in candidates[:3]]}


VISUAL_MAPPING = {
    'people': ('photos', 'people', 'natural_photo'), 'landscape': ('photos', 'landscape', 'natural_photo'),
    'food': ('photos', 'food', 'natural_photo'), 'pet': ('photos', 'pet', 'natural_photo'),
    'object': ('photos', 'object', 'natural_photo'), 'document': ('other', 'unclassified', 'document_image'),
    'screenshot': ('other', 'unclassified', 'screenshot'), 'poster': ('social', 'poster', 'artwork'),
    'illustration': ('social', 'illustration', 'artwork'), 'meme': ('social', 'meme', 'artwork'),
}

# CLIP similarity is diagnostic, not calibrated probability. A nearby chart
# cue must survive generic screenshot/photo labels, but a clear photo lead
# remains a photo. These labels express form, never a confirmed archive use.
STRUCTURED_VISUAL_MAPPING = {
    **{label: ('study', 'data_chart', 'data_chart') for label in (
        'scatter_plot', 'line_chart', 'bar_chart', 'histogram', 'pie_chart', 'heatmap', 'box_plot')},
    'flowchart': ('social', 'diagram', 'diagram'),
    'diagram': ('social', 'diagram', 'diagram'),
    'table_image': ('office', 'spreadsheet', 'table_image'),
}
STRUCTURED_CANDIDATE_FLOOR = .285


def fuse_image(name, ocr_text, visual, warnings, sampling=None):
    result = classify_text(name, ocr_text, sampling)
    strong_text = result['category'] != 'other' and not result['review_required'] and len(ocr_text.strip()) >= 12
    text_conflict = any(reason in result['review_reasons'] for reason in ['competing_categories', 'example_context',
                                                                       'purpose_uncalibrated'])
    structural = any(item['source'] == 'structure' for item in result['evidence_items'])
    structured = next((row for row in visual if row['label'] in STRUCTURED_VISUAL_MAPPING
                       and row['score'] >= STRUCTURED_CANDIDATE_FLOOR
                       and visual[0]['score'] - row['score'] <= .025), None)
    if structured:
        category, subtype, form = STRUCTURED_VISUAL_MAPPING[structured['label']]
        # Retain independent document purpose and its conflicts. Without it,
        # the destination is merely an explicit, reviewed purpose candidate.
        preserve_text = strong_text or text_conflict or structural
        if not preserve_text:
            result.update(category=category, subcategory=subtype, candidates=[],
                          evidence_items=[], tags=[], review_reasons=['visual_purpose_uncalibrated'])
        else:
            for item in result['evidence_items']:
                if item['source'] in {'title', 'body'}:
                    item['source'] = 'ocr'
        rivals = [row for row in visual if row is not structured and row['label'] in STRUCTURED_VISUAL_MAPPING
                  and structured['score'] - row['score'] < .025]
        # Close subtypes retain the broader form without asserting histogram
        # versus bars, for example. All new forms stay review-only.
        type_tag = form if rivals else structured['label']
        result.update(content_form=form, review_required=True)
        result['tags'] = list(dict.fromkeys([*result['tags'], type_tag]))
        result['review_reasons'].append('visual_type_uncalibrated')
        if rivals:
            result['review_reasons'].append('visual_type_ambiguous')
        result['evidence_items'].append({'source': 'visual', 'text': type_tag})
    elif strong_text or text_conflict or structural:
        result['content_form'] = 'document_image'
        if visual and visual[0]['label'] == 'screenshot':
            result['content_form'] = 'screenshot'
        for item in result['evidence_items']:
            if item['source'] in {'title', 'body'}:
                item['source'] = 'ocr'
    else:
        # Subthreshold new forms cannot shrink the established ten-scene
        # margin and turn an otherwise clear photo into an abstention.
        legacy_visual = [row for row in visual if row['label'] in VISUAL_MAPPING]
        best = legacy_visual[0] if legacy_visual else None
        runner_up = legacy_visual[1] if len(legacy_visual) > 1 else next(
            (row for row in visual if row is not best), None)
        margin = best['score'] - runner_up['score'] if best and runner_up else 0
        if best and best['score'] >= .25 and margin >= .025 and best['label'] in VISUAL_MAPPING:
            category, subtype, form = VISUAL_MAPPING[best['label']]
            result.update(category=category, subcategory=subtype, content_form=form,
                          review_required=category == 'other', review_reasons=['insufficient_evidence'] if category == 'other' else [],
                          evidence_items=[{'source': 'visual', 'text': best['label']}], tags=[])
        else:
            result.update(category='other', subcategory='unclassified', content_form='unknown', review_required=True,
                          review_reasons=['visual_ambiguous' if visual else 'vision_unavailable'])
    result['engine_warnings'] = warnings
    result['visual_candidates'] = visual[:3]
    return result
