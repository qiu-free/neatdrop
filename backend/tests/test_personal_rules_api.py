from fastapi.testclient import TestClient

from neatdrop.app import create_app


def test_rules_listing_and_save_require_preview_and_confirmation(tmp_path):
    (tmp_path / 'receipt.txt').write_text('Tax receipt for 2026', encoding='utf-8')
    app = create_app()
    with TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        base = f"/api/v1/workspaces/{workspace['id']}/classification-rules"
        listing = client.get(base)
        assert listing.status_code == 200
        assert listing.json() == {'revision': 0, 'rules': [], 'available': True}
        rejected = client.post(base, json={'preview_token': 'x' * 32, 'confirmed': True}, headers=headers)
        assert rejected.status_code == 409
        assert rejected.json()['code'] == 'PERSONAL_RULE_PREVIEW_REQUIRED'


def test_preview_save_and_token_cannot_enable_another_rule(tmp_path):
    (tmp_path / 'receipt.txt').write_text('Tax receipt with alpha marker and beta marker', encoding='utf-8')
    app = create_app()
    with TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        job = client.post('/api/v1/analysis-jobs', json={
            'workspace_id': workspace['id'], 'file_ids': [workspace['files'][0]['id']], 'mode': 'local',
            'cloud_consent': False}, headers=headers).json()
        import time
        for _ in range(200):
            state = client.get(f"/api/v1/analysis-jobs/{job['id']}").json()
            if state['status'] in {'completed', 'cancelled'}:
                break
            time.sleep(.02)
        base = f"/api/v1/workspaces/{workspace['id']}/classification-rules"
        form = {'job_id': job['id'], 'name': 'Tax receipts', 'keywords': ['alpha marker', 'beta marker'],
                'extensions': ['.txt'], 'category': 'finance', 'subcategory': 'invoice'}
        preview = client.post(base + '/preview', json=form, headers=headers)
        assert preview.status_code == 200, preview.text
        body = {'preview_token': preview.json()['token'], 'confirmed': True}
        wrong_route = client.post(base + '/' + 'a' * 32 + '/enable', json=body, headers=headers)
        assert wrong_route.status_code == 409
        assert wrong_route.json()['code'] == 'PERSONAL_RULE_PREVIEW_INVALID'
        saved = client.post(base, json=body, headers=headers)
        assert saved.status_code == 200, saved.text
        assert len(saved.json()['rules']) == 1
        reused = client.post(base, json=body, headers=headers)
        assert reused.status_code == 409
        assert reused.json()['code'] == 'PERSONAL_RULE_PREVIEW_REQUIRED'


def test_preview_zero_stale_and_expired_tokens_fail_closed(tmp_path, monkeypatch):
    (tmp_path / 'receipt.txt').write_text('Tax receipt with alpha marker and beta marker', encoding='utf-8')
    import neatdrop.app as app_module
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        job = client.post('/api/v1/analysis-jobs', json={
            'workspace_id': workspace['id'], 'file_ids': [workspace['files'][0]['id']], 'mode': 'local',
            'cloud_consent': False}, headers=headers).json()
        import time
        for _ in range(200):
            if client.get(f"/api/v1/analysis-jobs/{job['id']}").json()['status'] == 'completed':
                break
            time.sleep(.02)
        base = f"/api/v1/workspaces/{workspace['id']}/classification-rules"
        form = {'job_id': job['id'], 'name': 'Tax receipts', 'keywords': ['alpha marker', 'beta marker'],
                'extensions': ['.txt'], 'category': 'finance', 'subcategory': 'invoice'}
        preview = client.post(base + '/preview', json=form, headers=headers).json()
        service = app_module.current
        # Advancing the server-side rule revision invalidates previously issued previews.
        from neatdrop.personal_rules import PersonalRules
        from neatdrop.executor import Executor
        from neatdrop.files import Workspace as WorkspaceType
        granted_ws = WorkspaceType(tmp_path)
        rules = PersonalRules(Executor(granted_ws))
        rules.commit({'name': 'Other', 'keywords': ['other alpha', 'other bravo'], 'extensions': ['.txt'],
                      'category': 'study', 'subcategory': 'paper'}, preview['revision'])
        stale = client.post(base, json={'preview_token': preview['token'], 'confirmed': True}, headers=headers)
        assert stale.status_code == 409
        assert stale.json()['code'] == 'PERSONAL_RULE_STALE_REVISION'

        zero_form = {**form, 'keywords': ['unlikely alpha', 'unlikely bravo']}
        zero = client.post(base + '/preview', json=zero_form, headers=headers).json()
        assert zero['matched'] == []
        denied = client.post(base, json={'preview_token': zero['token'], 'confirmed': True}, headers=headers)
        assert denied.status_code == 409
        assert denied.json()['code'] == 'PERSONAL_RULE_ZERO_MATCH'

        fresh = client.post(base + '/preview', json=form, headers=headers).json()
        original_monotonic = app_module.time.monotonic
        monkeypatch.setattr(app_module.time, 'monotonic', lambda: original_monotonic() + 601)
        expired = client.post(base, json={'preview_token': fresh['token'], 'confirmed': True}, headers=headers)
        assert expired.status_code == 409
        assert expired.json()['code'] == 'PERSONAL_RULE_PREVIEW_REQUIRED'


def test_rule_disable_reenable_and_delete_are_revisioned_and_reenable_previews(tmp_path):
    (tmp_path / 'receipt.txt').write_text('Tax receipt with alpha marker and beta marker', encoding='utf-8')
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        job = client.post('/api/v1/analysis-jobs', json={
            'workspace_id': workspace['id'], 'file_ids': [workspace['files'][0]['id']], 'mode': 'local',
            'cloud_consent': False}, headers=headers).json()
        import time
        for _ in range(200):
            if client.get(f"/api/v1/analysis-jobs/{job['id']}").json()['status'] == 'completed':
                break
            time.sleep(.02)
        base = f"/api/v1/workspaces/{workspace['id']}/classification-rules"
        form = {'job_id': job['id'], 'name': 'Tax receipts', 'keywords': ['alpha marker', 'beta marker'],
                'extensions': ['.txt'], 'category': 'finance', 'subcategory': 'invoice'}
        preview = client.post(base + '/preview', json=form, headers=headers).json()
        listing = client.post(base, json={'preview_token': preview['token'], 'confirmed': True}, headers=headers).json()
        rule = listing['rules'][0]
        disabled = client.post(f"{base}/{rule['id']}/disable", json={'revision': listing['revision']}, headers=headers)
        assert disabled.status_code == 200
        assert disabled.json()['rules'][0]['enabled'] is False
        no_preview = client.post(f"{base}/{rule['id']}/enable", json={'preview_token': 'x' * 32, 'confirmed': True}, headers=headers)
        assert no_preview.status_code == 409
        assert no_preview.json()['code'] == 'PERSONAL_RULE_PREVIEW_REQUIRED'
        reen_preview = client.post(base + '/preview', json={**form, 'rule_id': rule['id']}, headers=headers).json()
        enabled = client.post(f"{base}/{rule['id']}/enable", json={
            'preview_token': reen_preview['token'], 'confirmed': True}, headers=headers)
        assert enabled.status_code == 200
        removed = client.request('DELETE', f"{base}/{rule['id']}", json={
            'revision': enabled.json()['revision'], 'confirmed': True}, headers=headers)
        assert removed.status_code == 200
        assert removed.json()['rules'] == []


def test_rule_bound_preview_is_rejected_by_generic_save_without_consumption(tmp_path):
    (tmp_path / 'receipt.txt').write_text('Tax receipt with alpha marker and beta marker', encoding='utf-8')
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        job = client.post('/api/v1/analysis-jobs', json={
            'workspace_id': workspace['id'], 'file_ids': [workspace['files'][0]['id']], 'mode': 'local',
            'cloud_consent': False}, headers=headers).json()
        import time
        for _ in range(200):
            if client.get(f"/api/v1/analysis-jobs/{job['id']}").json()['status'] == 'completed':
                break
            time.sleep(.02)
        base = f"/api/v1/workspaces/{workspace['id']}/classification-rules"
        form = {'job_id': job['id'], 'name': 'Tax receipts', 'keywords': ['alpha marker', 'beta marker'],
                'extensions': ['.txt'], 'category': 'finance', 'subcategory': 'invoice'}
        preview = client.post(base + '/preview', json=form, headers=headers).json()
        saved = client.post(base, json={'preview_token': preview['token'], 'confirmed': True}, headers=headers).json()
        rule = saved['rules'][0]
        client.post(f"{base}/{rule['id']}/disable", json={'revision': saved['revision']}, headers=headers)
        reen_preview = client.post(base + '/preview', json={**form, 'rule_id': rule['id']}, headers=headers).json()
        generic = client.post(base, json={'preview_token': reen_preview['token'], 'confirmed': True}, headers=headers)
        assert generic.status_code == 409
        assert generic.json()['code'] == 'PERSONAL_RULE_PREVIEW_INVALID'
        enabled = client.post(f"{base}/{rule['id']}/enable", json={
            'preview_token': reen_preview['token'], 'confirmed': True}, headers=headers)
        assert enabled.status_code == 200


def test_cloud_analysis_job_api_does_not_dereference_personal_rules(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from neatdrop.analysis import AnalysisJobs
    import neatdrop.analysis as analysis_module

    async def leave_queued(self, identifier, ws):
        return None

    monkeypatch.setattr(AnalysisJobs, 'run', leave_queued)
    monkeypatch.setattr(analysis_module, 'get_model_snapshot', lambda: SimpleNamespace(
        max_requests_per_batch=50, endpoint='https://example.invalid', config_version='v1'))
    (tmp_path / 'receipt.txt').write_text('Tax receipt', encoding='utf-8')
    with TestClient(create_app(), base_url='http://127.0.0.1:8765', client=('127.0.0.1', 43210)) as client:
        csrf = client.get('/api/session').json()['csrf']
        headers = {'X-NeatDrop-CSRF': csrf}
        workspace = client.post('/api/v1/workspaces', json={'path': str(tmp_path)}, headers=headers).json()
        response = client.post('/api/v1/analysis-jobs', json={
            'workspace_id': workspace['id'], 'file_ids': [workspace['files'][0]['id']], 'mode': 'cloud',
            'cloud_consent': True}, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()['mode'] == 'cloud'
        # The patched runner deliberately leaves this API job queued; release
        # its process-wide admission slot so later tests exercise a clean manager.
        from neatdrop.analysis import AnalysisJobs
        AnalysisJobs.global_slots.release()
