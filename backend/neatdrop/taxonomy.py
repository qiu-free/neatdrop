"""Server-owned labels and paths; external suggestions never define directories."""
import json
from pathlib import Path

GROUPS = {
    'finance': ('票据凭证', '01_财务票据'),
    'study': ('学习科研', '02_学习科研'),
    'activity': ('活动事务', '03_社团工作'),
    'social': ('设计娱乐', '04_社交娱乐'),
    'temporary': ('临时资料', '05_临时资料'),
    'other': ('待分类', '06_其他归档'),
    'office': ('工作办公', '07_工作办公'),
    'life': ('生活服务', '08_生活服务'),
    'photos': ('照片影像', '09_照片影像'),
}

SUBCATEGORIES = {
    'finance': {'invoice': '发票', 'receipt': '消费小票', 'payment': '支付凭证', 'bill': '账单', 'reimbursement': '报销材料',
                'bank_material': '银行材料', 'utility_payment': '缴费凭证', 'tax_material': '税务材料'},
    'study': {'notes': '课程笔记', 'courseware': '课程课件', 'paper': '论文文献', 'exam': '试题练习', 'board': '板书',
              'data_chart': '数据图表', 'experiment_material': '实验资料', 'research_data': '研究数据',
              'technical_document': '技术文档', 'reading_excerpt': '读书摘录'},
    'office': {'contract': '合同协议', 'resume': '简历', 'report': '报告', 'work_notes': '工作记录',
               'spreadsheet': '表格数据', 'presentation': '演示资料', 'project_plan': '项目方案',
               'requirements': '需求设计', 'email': '邮件存档'},
    'activity': {'notice': '活动通知', 'registration': '报名材料', 'meeting': '会议资料'},
    'life': {'delivery': '快递取件', 'travel': '交通出行', 'order': '购物订单', 'medical': '医疗资料', 'identity': '证件',
             'family': '家庭资料', 'warranty': '保修说明', 'property': '住房物业', 'insurance': '保险资料',
             'travel_material': '旅行资料'},
    'photos': {'people': '人物合影', 'landscape': '风景旅行', 'food': '美食', 'pet': '宠物', 'object': '物品', 'unsorted_photo': '照片待细分'},
    'social': {'poster': '海报', 'illustration': '插画', 'wallpaper': '壁纸', 'meme': '表情包',
               'icon': '图标标志', 'ui_design': '界面设计', 'diagram': '流程架构图', 'reference': '参考素材'},
    'temporary': {'queue': '排队取餐', 'code': '临时状态码'},
    'other': {'unclassified': '待分类'},
}

FORMS = {'text_document': '文本文档', 'document_image': '文档影像', 'screenshot': '界面截图',
         'natural_photo': '自然照片', 'artwork': '设计素材', 'unknown': '形式待确认',
         'data_chart': '数据图表', 'table_image': '表格影像', 'diagram': '流程结构图'}


def destination(category, subcategory=None):
    from .files import SafetyError
    if category not in GROUPS:
        raise SafetyError('INVALID_CATEGORY')
    folder = GROUPS[category][1]
    if subcategory is None:
        return folder
    if subcategory not in SUBCATEGORIES[category]:
        raise SafetyError('INVALID_SUBCATEGORY')
    return folder + '/' + SUBCATEGORIES[category][subcategory]


def allowed_parent(relative):
    return relative in {destination(c) for c in GROUPS} | {
        destination(c, s) for c, subs in SUBCATEGORIES.items() for s in subs
    }


def taxonomy_config():
    # Definitions and counterexamples belong to the same server-owned profiles
    # used by optional semantic candidates. Publishing a copy prevents a config
    # consumer from changing the trusted destination table in this process.
    profiles = json.loads(Path(__file__).with_name('classification_profiles.json').read_text('utf-8'))['profiles']
    descriptions = {(p['category'], p['subcategory']): p['definition'] + ' 例如：' +
                    '；'.join(p['positive_examples']) + ' 不包括：' + '；'.join(p['negative_examples'])
                    for p in profiles}
    return {key: {'label': label, 'directory': directory, 'subcategories': dict(SUBCATEGORIES[key]),
                  'descriptions': {child: descriptions[(key, child)] for child in SUBCATEGORIES[key]}}
            for key, (label, directory) in GROUPS.items()}
