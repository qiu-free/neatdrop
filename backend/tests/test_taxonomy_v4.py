"""Public taxonomy, safe destinations and reproducible cold-start snapshot."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from neatdrop.app import create_app
from neatdrop.files import SafetyError
from neatdrop.taxonomy import destination, taxonomy_config


NEW_DESTINATIONS = [
    ('study', 'data_chart', '02_学习科研/数据图表'),
    ('study', 'experiment_material', '02_学习科研/实验资料'),
    ('study', 'research_data', '02_学习科研/研究数据'),
    ('study', 'technical_document', '02_学习科研/技术文档'),
    ('study', 'reading_excerpt', '02_学习科研/读书摘录'),
    ('office', 'spreadsheet', '07_工作办公/表格数据'),
    ('office', 'presentation', '07_工作办公/演示资料'),
    ('office', 'project_plan', '07_工作办公/项目方案'),
    ('office', 'requirements', '07_工作办公/需求设计'),
    ('office', 'email', '07_工作办公/邮件存档'),
    ('social', 'icon', '04_社交娱乐/图标标志'),
    ('social', 'ui_design', '04_社交娱乐/界面设计'),
    ('social', 'diagram', '04_社交娱乐/流程架构图'),
    ('social', 'reference', '04_社交娱乐/参考素材'),
    ('life', 'family', '08_生活服务/家庭资料'),
    ('life', 'warranty', '08_生活服务/保修说明'),
    ('life', 'property', '08_生活服务/住房物业'),
    ('life', 'insurance', '08_生活服务/保险资料'),
    ('life', 'travel_material', '08_生活服务/旅行资料'),
    ('finance', 'bank_material', '01_财务票据/银行材料'),
    ('finance', 'utility_payment', '01_财务票据/缴费凭证'),
    ('finance', 'tax_material', '01_财务票据/税务材料'),
]


def test_all_legacy_group_and_child_paths_remain_compatible():
    legacy = {
        'finance': ('01_财务票据', {'invoice': '发票', 'receipt': '消费小票', 'payment': '支付凭证', 'bill': '账单', 'reimbursement': '报销材料'}),
        'study': ('02_学习科研', {'notes': '课程笔记', 'courseware': '课程课件', 'paper': '论文文献', 'exam': '试题练习', 'board': '板书'}),
        'activity': ('03_社团工作', {'notice': '活动通知', 'registration': '报名材料', 'meeting': '会议资料'}),
        'social': ('04_社交娱乐', {'poster': '海报', 'illustration': '插画', 'wallpaper': '壁纸', 'meme': '表情包'}),
        'temporary': ('05_临时资料', {'queue': '排队取餐', 'code': '临时状态码'}),
        'other': ('06_其他归档', {'unclassified': '待分类'}),
        'office': ('07_工作办公', {'contract': '合同协议', 'resume': '简历', 'report': '报告', 'work_notes': '工作记录'}),
        'life': ('08_生活服务', {'delivery': '快递取件', 'travel': '交通出行', 'order': '购物订单', 'medical': '医疗资料', 'identity': '证件'}),
        'photos': ('09_照片影像', {'people': '人物合影', 'landscape': '风景旅行', 'food': '美食', 'pet': '宠物', 'object': '物品', 'unsorted_photo': '照片待细分'}),
    }
    for category, (folder, children) in legacy.items():
        assert destination(category) == folder
        for child, label in children.items():
            assert destination(category, child) == folder + '/' + label


@pytest.mark.parametrize('group,child,path', NEW_DESTINATIONS)
def test_new_categories_have_server_owned_destinations(group, child, path):
    assert destination(group, child) == path


def test_config_defines_every_child_and_keeps_labels_as_strings():
    config = taxonomy_config()
    assert set(config) == {'finance', 'study', 'activity', 'social', 'temporary', 'other', 'office', 'life', 'photos'}
    for group in config.values():
        assert set(group['descriptions']) == set(group['subcategories'])
        assert all(isinstance(label, str) for label in group['subcategories'].values())
        assert all(len(definition) >= 15 for definition in group['descriptions'].values())
        assert len(set(group['subcategories'].values())) == len(group['subcategories'])


def test_published_config_cannot_mutate_the_authoritative_destinations():
    config = taxonomy_config()
    config['study']['subcategories']['notes'] = '../../changed'
    assert destination('study', 'notes') == '02_学习科研/课程笔记'
    with pytest.raises(SafetyError, match='INVALID_SUBCATEGORY'):
        destination('study', '../../changed')


def test_snapshot_generator_is_repeatable_and_matches_runtime_contract(tmp_path):
    project = Path(__file__).resolve().parents[2]
    script = project / 'scripts' / 'generate_taxonomy.py'
    output = tmp_path / 'taxonomy.generated.json'
    command = [sys.executable, str(script), '--output', str(output)]
    first = subprocess.run(command, cwd=tmp_path, text=True, capture_output=True)
    assert first.returncode == 0, first.stderr
    first_bytes = output.read_bytes()
    second = subprocess.run(command, cwd=tmp_path, text=True, capture_output=True)
    assert second.returncode == 0, second.stderr
    assert first_bytes == output.read_bytes()
    generated = json.loads(first_bytes)
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        client.get('/api/session')
        response = client.get('/api/v1/config')
        assert response.status_code == 200
        runtime = response.json()
    assert generated == {key: runtime[key] for key in ('taxonomy', 'content_forms')}
    assert generated['content_forms']['data_chart'] == '数据图表'
    assert generated['content_forms']['table_image'] == '表格影像'
    assert generated['content_forms']['diagram'] == '流程结构图'
    assert generated == json.loads((project / 'frontend/src/taxonomy.generated.json').read_text('utf-8'))
