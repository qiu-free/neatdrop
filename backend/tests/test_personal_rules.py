import pytest

from neatdrop.analysis import AnalysisJobs, apply_personal_rules
from neatdrop.executor import Executor
from neatdrop.files import Workspace, SafetyError
from neatdrop.personal_rules import PersonalRules


def test_rules_normalize_all_keywords_and_revision_gate(tmp_path):
    root = tmp_path / 'source'
    root.mkdir()
    ws = Workspace(root)
    rules = PersonalRules(Executor(ws, trust_store=__import__('neatdrop.trust', fromlist=['TrustStore']).TrustStore(tmp_path / 'state')))
    draft = {'name': 'Invoices', 'keywords': ['  TAX  ', 'Receipt'], 'extensions': ['.txt'],
             'category': 'finance', 'subcategory': 'invoice'}
    with pytest.raises(SafetyError, match='PERSONAL_RULE_PREVIEW_REQUIRED'):
        rules.save(draft, None, True)


def test_keywords_must_not_overlap_after_normalization(tmp_path):
    root = tmp_path / 'source'
    root.mkdir()
    ws = Workspace(root)
    rules = PersonalRules(Executor(ws))
    with pytest.raises(SafetyError, match='PERSONAL_RULE_INVALID_KEYWORDS'):
        rules.validate({'name': 'x', 'keywords': [' invoice ', 'INVOICE number'],
                        'extensions': ['.txt'], 'category': 'finance', 'subcategory': 'invoice'})


def test_personal_matches_are_review_candidates_and_conflicts_do_not_choose(tmp_path):
    rule = {'id': 'a' * 32, 'name': 'Rule A', 'keywords': ['alpha', 'bravo'], 'extensions': ['.txt'],
            'category': 'finance', 'subcategory': 'invoice', 'enabled': True}
    conflict = {**rule, 'id': 'b' * 32, 'name': 'Rule B', 'category': 'study', 'subcategory': 'paper'}
    original = {'category': 'other', 'subcategory': 'unclassified', 'review_required': False,
                'review_reasons': [], 'candidates': [], 'evidence': 'original classifier evidence',
                'quality': {'state': 'acceptable'}}
    result = apply_personal_rules(original.copy(), {'extension': '.txt'}, 'ALPHA bravo', original['quality'],
                                  {'available': True, 'rules': [rule, conflict]})
    assert result['category'] == 'other'
    assert result['review_required'] is True
    assert 'personal_rule_conflict' in result['review_reasons']
    assert len(result['personal_rule_matches']) == 2
    assert len(result['candidates']) == 2
    assert result['evidence'] == 'original classifier evidence'


def test_limited_quality_prevents_personal_rule_match():
    rule = {'id': 'a' * 32, 'name': 'Rule A', 'keywords': ['alpha', 'bravo'], 'extensions': ['.txt'],
            'category': 'finance', 'subcategory': 'invoice', 'enabled': True}
    original = {'category': 'other', 'review_required': True, 'review_reasons': ['content_quality_limited'],
                'quality': {'state': 'limited'}}
    result = apply_personal_rules(original.copy(), {'extension': '.txt'}, 'alpha bravo', original['quality'],
                                  {'available': True, 'rules': [rule]})
    assert 'personal_rule_matches' not in result
    assert 'personal_rule_applied' not in result['review_reasons']


def test_corrupt_store_is_unavailable_and_not_replaced(tmp_path):
    from neatdrop.trust import TrustStore
    root = tmp_path / 'root'
    root.mkdir()
    ws = Workspace(root)
    store = PersonalRules(Executor(ws, trust_store=TrustStore(tmp_path / 'state')))
    store.store_root.mkdir(parents=True)
    store.path.write_text('{broken', encoding='utf-8')
    before = store.path.read_bytes()
    assert store.listing()['available'] is False
    with pytest.raises(SafetyError, match='PERSONAL_RULE_STORE_UNAVAILABLE'):
        store.commit({'name': 'x', 'keywords': ['alpha', 'bravo'], 'extensions': ['.txt'],
                      'category': 'finance', 'subcategory': 'invoice'}, 0)
    assert store.path.read_bytes() == before


def test_linked_rule_metadata_is_unavailable_and_not_replaced(tmp_path):
    from neatdrop.trust import TrustStore
    root = tmp_path / 'root'
    root.mkdir()
    ws = Workspace(root)
    store = PersonalRules(Executor(ws, trust_store=TrustStore(tmp_path / 'state')))
    store.store_root.mkdir(parents=True)
    target = tmp_path / 'outside.json'
    target.write_text('{"revision":0,"rules":[]}', encoding='utf-8')
    try:
        __import__('os').link(target, store.path)
    except OSError:
        pytest.skip('hard links are unavailable in this environment')
    before = target.read_bytes()
    assert store.listing()['available'] is False
    with pytest.raises(SafetyError, match='METADATA_LINK_FORBIDDEN'):
        store.commit({'name': 'x', 'keywords': ['alpha', 'bravo'], 'extensions': ['.txt'],
                      'category': 'finance', 'subcategory': 'invoice'}, 0)
    assert target.read_bytes() == before


def test_create_snapshots_local_rules_and_never_cloud_rules(tmp_path, monkeypatch):
    root = tmp_path / 'root'
    root.mkdir()
    (root / 'file.txt').write_text('some body', encoding='utf-8')
    ws = Workspace(root)
    file_id = ws.scan()[0]['id']
    manager = AnalysisJobs()
    rules = {'available': True, 'rules': [{'id': 'a' * 32, 'name': 'Saved', 'enabled': True}]}
    local = manager.create(ws, [file_id], 'local', False, personal_rules=rules)
    rules['rules'].clear()
    assert manager.personal_rule_snapshots[local['id']]['rules'][0]['name'] == 'Saved'
    manager.jobs[local['id']].update(status='completed', finished_at=__import__('time').monotonic())
    manager.global_slots.release()
    from types import SimpleNamespace
    monkeypatch.setattr('neatdrop.analysis.get_model_snapshot', lambda: SimpleNamespace(
        max_requests_per_batch=50, endpoint='https://example.invalid', config_version='v1'))
    cloud = manager.create(ws, [file_id], 'cloud', True, personal_rules={'available': True, 'rules': [{'id': 'b'}]})
    assert cloud['id'] not in manager.personal_rule_snapshots
