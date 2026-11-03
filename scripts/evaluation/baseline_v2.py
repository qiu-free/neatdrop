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


def normalized(text):
    return unicodedata.normalize('NFKC', text or '').casefold()


def positive_match(pattern, text):
    for match in re.finditer(pattern, text):
        prefix = text[max(0, text.rfind('\n', 0, match.start()) + 1):match.start()]
        if not re.search(r'不是|并非|不属于|勿作为|非真实|没有真实|not an?\s*$', prefix):
            return match
    return None


def classify_text(name, text):
    body = normalized(text)[:12000]
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
        for pattern in supports:
            if match := positive_match(pattern, body):
                score += 1.5
                hits.append({'source': 'body', 'text': match.group()})
        if not any(h['source'] in {'title', 'filename'} for h in hits) and score < 6:
            continue
        if score:
            candidates.append({'category': category, 'subcategory': subtype, 'score': score, 'evidence': hits})
    candidates.sort(key=lambda c: c['score'], reverse=True)
    reasons = []
    if not candidates:
        best = {'category': 'other', 'subcategory': 'unclassified', 'score': 0, 'evidence': []}
        reasons.append('insufficient_evidence')
    else:
        best = candidates[0]
        if best['score'] < 6:
            reasons.append('weak_evidence')
        if best['evidence'] and all(e['source'] == 'filename' for e in best['evidence']):
            reasons.append('filename_only')
        if len(candidates) > 1 and candidates[1]['score'] >= 6 and best['score'] - candidates[1]['score'] < 2.5:
            reasons.append('competing_categories')
        if best['category'] == 'finance' and re.search(r'教程|算法|引用.{0,20}示例|示例.{0,20}字段', body):
            reasons.append('example_context')
    return {'category': best['category'], 'subcategory': best['subcategory'], 'content_form': 'text_document',
            'tags': [c['subcategory'] for c in candidates[1:3] if c['score'] >= 6],
            'evidence_items': best['evidence'], 'review_required': bool(reasons), 'review_reasons': reasons,
            'candidates': [{k: c[k] for k in ('category', 'subcategory', 'score')} for c in candidates[:3]]}


VISUAL_MAPPING = {
    'people': ('photos', 'people', 'natural_photo'), 'landscape': ('photos', 'landscape', 'natural_photo'),
    'food': ('photos', 'food', 'natural_photo'), 'pet': ('photos', 'pet', 'natural_photo'),
    'object': ('photos', 'object', 'natural_photo'), 'document': ('other', 'unclassified', 'document_image'),
    'screenshot': ('other', 'unclassified', 'screenshot'), 'poster': ('social', 'poster', 'artwork'),
    'illustration': ('social', 'illustration', 'artwork'), 'meme': ('social', 'meme', 'artwork'),
}


def fuse_image(name, ocr_text, visual, warnings):
    result = classify_text(name, ocr_text)
    strong_text = result['category'] != 'other' and not result['review_required'] and len(ocr_text.strip()) >= 12
    text_conflict = any(reason in result['review_reasons'] for reason in ['competing_categories', 'example_context'])
    if strong_text or text_conflict:
        result['content_form'] = 'document_image'
        if visual and visual[0]['label'] == 'screenshot':
            result['content_form'] = 'screenshot'
        for item in result['evidence_items']:
            if item['source'] in {'title', 'body'}:
                item['source'] = 'ocr'
    else:
        best = visual[0] if visual else None
        margin = best['score'] - visual[1]['score'] if len(visual) > 1 else 0
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
