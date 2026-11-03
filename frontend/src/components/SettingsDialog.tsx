import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import type { Config, SemanticCapability } from '../types'
import { loadPreferences, savePreferences, type Preferences } from '../preferences'
import type { ModelConfig, ModelConfigPayload, ModelConfigTestPayload, ModelField, SettingSource } from '../settingsTypes'
import { Modal } from './Modal'
import './settings.css'

const BAILIAN_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function providerFor(endpoint: string): 'bailian' | 'custom' {
  return endpoint.includes('dashscope.aliyuncs.com') ? 'bailian' : 'custom'
}

function sourceLabel(source?: SettingSource) {
  switch (source) {
    case 'environment': return '环境变量'
    case 'saved': return '本机设置'
    case 'endpoint_mismatch': return '密钥与当前地址不匹配'
    case 'none': return '未配置'
    default: return '默认值'
  }
}

function settingsErrorMessage(code?: string | null) {
  if (!code) return ''
  if (code === 'MODEL_SETTINGS_CORRUPT') return '本机模型设置无法读取或已损坏。为保护现有配置，已禁用覆盖和连接测试。'
  if (code === 'MODEL_SETTINGS_UNAVAILABLE') return '本机模型设置暂时不可用。修复存储权限前，不能保存配置或测试连接。'
  return '本机模型设置存在问题，已禁用覆盖和连接测试。'
}

function isPublicHttpsEndpoint(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function semanticStatus(capability?: SemanticCapability) {
  if (!capability || capability.state === 'missing') return '未安装'
  if (capability.state === 'self_test_failed' || capability.integrity_check === 'failed') return '自检失败'
  if (capability.state === 'checking') return '校验中'
  if (capability.state === 'budget_limited') return '预算受限'
  if (capability.state === 'ready') {
    return capability.available && capability.integrity_check === 'verified' ? `已就绪 · ${capability.name}` : '待本地校验'
  }
  return '状态待确认'
}

export function SettingsDialog({ config, onClose, onSaved, preferences, onPreferencesChange }: {
  config: Config | null
  onClose: () => void
  onSaved?: (config: ModelConfig) => void | Promise<void>
  preferences?: Preferences
  onPreferencesChange?: (preferences: Preferences) => void
}) {
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState<'bailian' | 'custom'>('bailian')
  const [endpoint, setEndpoint] = useState(BAILIAN_ENDPOINT)
  const [textModel, setTextModel] = useState('qwen-plus')
  const [visionModel, setVisionModel] = useState('qwen-vl-plus')
  const [requestBudget, setRequestBudget] = useState('20')
  const [keyAction, setKeyAction] = useState<'keep' | 'replace' | 'remove'>('keep')
  const [apiKey, setApiKey] = useState('')
  const [testConsent, setTestConsent] = useState(false)
  const [testStatus, setTestStatus] = useState('')
  const [uiPreferences, setUiPreferences] = useState(() => preferences ?? loadPreferences())

  useEffect(() => {
    let active = true
    api<ModelConfig>('/model-config').then(value => {
      if (!active) return
      setModelConfig(value)
      setProvider(providerFor(value.endpoint))
      setEndpoint(value.endpoint)
      setTextModel(value.text_model)
      setVisionModel(value.vision_model)
      setRequestBudget(String(value.max_requests_per_batch))
    }).catch(reason => {
      if (active) setLoadError(reason instanceof Error ? reason.message : '无法读取本机模型设置。')
    })
    return () => { active = false }
  }, [])

  useEffect(() => { if (preferences) setUiPreferences(preferences) }, [preferences])
  useEffect(() => {
    setTestConsent(false)
    setTestStatus('')
  }, [endpoint, textModel, visionModel, requestBudget, keyAction, apiKey])

  const budgetNumber = Number(requestBudget)
  const endpointValid = isPublicHttpsEndpoint(endpoint.trim())
  const budgetValid = Number.isInteger(budgetNumber) && budgetNumber >= 1 && budgetNumber <= 50
  const keyValid = keyAction !== 'replace' || Boolean(apiKey.trim())
  const settingsUnavailable = !modelConfig || Boolean(modelConfig.settings_error) || Boolean(loadError)
  const savedKeyEndpointMismatch = modelConfig?.key_source === 'saved' && endpoint.trim() !== modelConfig.endpoint && keyAction === 'keep'
  const isKeyAvailable = Boolean(modelConfig?.configured) || (keyAction === 'replace' && Boolean(apiKey.trim()))
  const canTest = Boolean(testConsent && endpointValid && budgetValid && isKeyAvailable && keyAction !== 'remove' && !savedKeyEndpointMismatch && !settingsUnavailable && !busy)
  const effectiveTarget = useMemo(() => endpoint.trim() || '尚未填写服务地址', [endpoint])

  function changePreference(patch: Partial<Pick<Preferences, 'density' | 'offlineFirst'>>) {
    const next: Preferences = { ...uiPreferences, ...patch, tutorial: uiPreferences.tutorial }
    setUiPreferences(next)
    if (onPreferencesChange) onPreferencesChange(next)
    else savePreferences(next)
  }

  function buildPayload(action: 'keep' | 'replace'): ModelConfigPayload {
    const payload: ModelConfigPayload = {
      endpoint: endpoint.trim(),
      text_model: textModel.trim(),
      vision_model: visionModel.trim(),
      max_requests_per_batch: budgetNumber,
      key_action: action,
    }
    if (action === 'replace') payload.api_key = apiKey.trim()
    return payload
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!modelConfig || loadError || modelConfig.settings_error) return
    setError('')
    setNotice('')
    if (keyAction === 'replace') setApiKey('')
    if (!endpointValid) { setError('服务地址必须是有效的 HTTPS 地址，不得含账号、查询参数或片段。'); return }
    if (!textModel.trim() || !visionModel.trim()) { setError('请填写文本模型和视觉模型。'); return }
    if (!budgetValid) { setError('每批请求数须为 1–50 的整数。'); return }
    if (!keyValid) { setError('更换密钥时请先填写新密钥。'); return }
    if (modelConfig?.key_source === 'saved' && endpoint.trim() !== modelConfig.endpoint && keyAction === 'keep') {
      setError('密钥已绑定原服务地址。更改地址后，请更换或移除密钥。')
      return
    }
    setBusy(true)
    try {
      let saved: ModelConfig
      if (keyAction === 'remove') {
        saved = await api<ModelConfig>('/model-config/clear-key', { confirmed: true })
        const otherSettingsChanged = saved.endpoint !== endpoint.trim() || saved.text_model !== textModel.trim() ||
          saved.vision_model !== visionModel.trim() || saved.max_requests_per_batch !== budgetNumber
        if (otherSettingsChanged) {
          try {
            saved = await api<ModelConfig>('/model-config', buildPayload('keep'))
          } catch (reason) {
            setModelConfig(saved)
            setApiKey('')
            setKeyAction('keep')
            await onSaved?.(saved)
            setError(`密钥已移除；其他设置未保存：${reason instanceof Error ? reason.message : '本机服务未接受设置。'}`)
            return
          }
        }
      } else {
        saved = await api<ModelConfig>('/model-config', buildPayload(keyAction))
      }
      setModelConfig(saved)
      setEndpoint(saved.endpoint)
      setProvider(providerFor(saved.endpoint))
      setTextModel(saved.text_model)
      setVisionModel(saved.vision_model)
      setRequestBudget(String(saved.max_requests_per_batch))
      setApiKey('')
      setKeyAction('keep')
      setNotice('本机设置已保存。此操作没有连接模型服务。')
      await onSaved?.(saved)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存本机模型设置。')
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    if (!canTest || !modelConfig || loadError || modelConfig.settings_error) return
    setError('')
    setTestStatus('')
    const payload = { ...buildPayload(keyAction === 'replace' ? 'replace' : 'keep'), confirmed: true } as ModelConfigTestPayload
    if (keyAction === 'replace') setApiKey('')
    setBusy(true)
    try {
      await api('/model-config/test', payload)
      setTestStatus('连接成功。文本接口可调用；视觉能力未验证。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接测试未完成。')
    } finally {
      setBusy(false)
    }
  }

  const offline = config?.offline
  const semanticLabel = semanticStatus(offline?.semantic)
  const semanticReady = offline?.semantic?.available && offline.semantic.state === 'ready' && offline.semantic.integrity_check === 'verified'
  const field = (name: ModelField) => {
    const metadata: Record<ModelField, { locked: keyof ModelConfig; source: keyof ModelConfig }> = {
      endpoint: { locked: 'endpoint_locked', source: 'endpoint_source' },
      text_model: { locked: 'text_model_locked', source: 'text_model_source' },
      vision_model: { locked: 'vision_model_locked', source: 'vision_model_source' },
      max_requests_per_batch: { locked: 'max_requests_per_batch_locked', source: 'max_requests_per_batch_source' },
    }
    return {
      locked: Boolean(modelConfig?.[metadata[name].locked]),
      source: modelConfig?.[metadata[name].source] as SettingSource | undefined,
    }
  }
  const endpointField = field('endpoint')
  const textModelField = field('text_model')
  const visionModelField = field('vision_model')
  const budgetField = field('max_requests_per_batch')
  const keyLocked = modelConfig?.key_locked ?? false
  const settingsError = settingsErrorMessage(modelConfig?.settings_error)

  return <Modal title="模型设置" onClose={onClose} busy={busy}>
    <div className="offline-status"><h3>离线识别能力</h3>
      <p><span className={`status-dot ${offline?.ocr.available ? 'online' : ''}`} />中文 OCR：{offline?.ocr.available ? `已就绪 · ${offline.ocr.name}` : '不可用'}</p>
      <p><span className={`status-dot ${offline?.vision.available ? 'online' : ''}`} />图片场景：{offline?.vision.available ? `已安装 · ${offline.vision.name}` : '未安装'}</p>
      <p><span className={`status-dot ${semanticReady ? 'online' : ''}`} />本地语义：{semanticLabel}</p>
      {offline?.semantic?.version ? <small>语义模型版本：{offline.semantic.version}</small> : null}
      {offline?.semantic?.enabled === false ? <small>实验候选未启用；当前使用规则、OCR 与视觉线索。</small> : offline?.semantic?.enabled === true ? <small>实验候选已启用，所有语义建议仍需复核。</small> : null}
      <small>离线运行不下载、不上传。缺少模型时可按项目说明准备本地模型。</small>
    </div>

    <div className="settings-status"><span className={`status-dot ${modelConfig?.configured ? 'online' : ''}`} />{settingsError ? '本机模型设置不可用' : modelConfig?.configured ? `密钥已配置 · ${sourceLabel(modelConfig.key_source)}` : modelConfig ? '未配置密钥，仍可使用本地规则与手动整理' : '正在读取本机模型设置…'}</div>
    {loadError ? <div className="settings-message error" role="alert"><CircleAlert size={16} />{loadError}</div> : null}
    {settingsError ? <div className="settings-message error" role="alert"><CircleAlert size={16} />{settingsError}</div> : null}

    <form className="settings-form" onSubmit={event => void submit(event)} noValidate>
      <div className="settings-form-heading"><div><h3>兼容模型服务</h3><p>仅支持 Chat Completions 兼容接口。</p></div><span className="settings-local-tag"><ShieldCheck size={14} />保存在本机</span></div>
      <label className="settings-field"><span>服务商模式</span><select aria-label="服务商模式" value={provider} onChange={event => {
        const value = event.target.value as 'bailian' | 'custom'
        setProvider(value)
        if (value === 'bailian') setEndpoint(BAILIAN_ENDPOINT)
        else if (endpoint === BAILIAN_ENDPOINT) setEndpoint('')
      }} disabled={endpointField.locked || settingsUnavailable}><option value="bailian">阿里云百炼兼容服务</option><option value="custom">自定义兼容端点</option></select></label>

      <label className="settings-field"><span>服务地址 <small>来源：{sourceLabel(endpointField.source)}</small></span><input aria-label="服务地址" type="url" value={endpoint} disabled={endpointField.locked || settingsUnavailable} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/v1" />{endpointField.locked ? <small className="settings-lock-note">由环境配置锁定</small> : null}</label>
      <div className="settings-grid">
        <label className="settings-field"><span>文本模型 <small>来源：{sourceLabel(textModelField.source)}</small></span><input aria-label="文本模型" value={textModel} disabled={textModelField.locked || settingsUnavailable} onChange={event => setTextModel(event.target.value)} />{textModelField.locked ? <small className="settings-lock-note">由环境配置锁定</small> : null}</label>
        <label className="settings-field"><span>视觉模型 <small>来源：{sourceLabel(visionModelField.source)}</small></span><input aria-label="视觉模型" value={visionModel} disabled={visionModelField.locked || settingsUnavailable} onChange={event => setVisionModel(event.target.value)} />{visionModelField.locked ? <small className="settings-lock-note">由环境配置锁定</small> : null}</label>
      </div>
      <label className="settings-field"><span>每批最大请求数 <small>来源：{sourceLabel(budgetField.source)}</small></span><input aria-label="每批最大请求数" type="number" min="1" max="50" step="1" value={requestBudget} disabled={budgetField.locked || settingsUnavailable} onChange={event => setRequestBudget(event.target.value)} />{budgetField.locked ? <small className="settings-lock-note">由环境配置锁定</small> : null}</label>

      <label className="settings-field"><span>密钥处理 <small>来源：{sourceLabel(modelConfig?.key_source)}</small></span><select aria-label="密钥处理" value={keyAction} disabled={keyLocked || settingsUnavailable} onChange={event => setKeyAction(event.target.value as typeof keyAction)}>
        <option value="keep">保留当前密钥</option><option value="replace">更换密钥</option><option value="remove">移除密钥</option>
      </select></label>
      {keyAction === 'replace' ? <label className="settings-field"><span>新 API 密钥</span><input aria-label="API 密钥" type="password" autoComplete="new-password" value={apiKey} disabled={settingsUnavailable} onChange={event => setApiKey(event.target.value)} placeholder="仅在提交时发送到本机服务" /></label> : null}
      {keyLocked ? <p className="settings-lock-note">密钥由环境变量提供，无法在此替换或移除。</p> : keyAction === 'remove' ? <p className="settings-lock-note">提交后会移除本机保存的密钥，不会连接服务商。</p> : <p className="settings-lock-note">密钥按服务地址绑定。页面不会回显已保存的密钥；输入的新密钥将在提交后从表单清空。</p>}

      <div className="settings-preferences">
        <div><h3>界面偏好</h3><p>只保存在此浏览器，不包含文件信息。</p></div>
        <label className="settings-field"><span>界面密度</span><select aria-label="界面密度" value={uiPreferences.density} onChange={event => changePreference({ density: event.target.value as Preferences['density'] })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
        <label className="settings-toggle"><input type="checkbox" checked={uiPreferences.offlineFirst} onChange={event => changePreference({ offlineFirst: event.target.checked })} />优先使用离线识别</label>
      </div>

      <div className="settings-test-panel">
        <div><h3>测试连接</h3><p>目标服务地址</p><code>{effectiveTarget}</code></div>
        <div className="settings-cost-note"><ShieldCheck size={16} /><span>只发送固定文字样例，不会发送文件、图片或目录名。服务商可能按测试请求计费。</span></div>
        <label className="settings-consent"><input type="checkbox" checked={testConsent} onChange={event => setTestConsent(event.target.checked)} />我确认连接到上方服务地址，并知悉服务可能计费。</label>
        <button type="button" className="button secondary" onClick={() => void testConnection()} disabled={!canTest}>测试连接</button>
        {testStatus ? <p className="settings-message success" role="status"><CheckCircle2 size={16} />{testStatus}</p> : null}
        {savedKeyEndpointMismatch ? <p className="settings-message error" role="alert">密钥已绑定原服务地址。更改服务地址后，请更换或移除密钥。</p> : null}
        {!modelConfig?.configured && keyAction !== 'replace' ? <small className="settings-lock-note">请配置密钥后再测试连接。</small> : null}
      </div>

      {error ? <div className="settings-message error" role="alert"><CircleAlert size={16} />{error}</div> : null}
      {notice ? <div className="settings-message success" role="status"><CheckCircle2 size={16} />{notice}</div> : null}
      <footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy || settingsUnavailable}>{busy ? '处理中…' : '保存设置'}</button></footer>
      <p className="settings-save-note">保存只更新本机加密设置，不连接模型服务。</p>
    </form>
  </Modal>
}
