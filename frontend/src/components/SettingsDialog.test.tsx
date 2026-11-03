import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsDialog } from './SettingsDialog'
import { api } from '../api'
import { DEFAULT_PREFERENCES, type Preferences } from '../preferences'
import type { Config } from '../types'

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn() }))

const unlocked = {
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', text_model: 'qwen-plus', vision_model: 'qwen-vl-plus',
  max_requests_per_batch: 20, configured: false, key_source: 'none', key_locked: false, config_version: '0-abc',
  endpoint_source: 'default', endpoint_locked: false, text_model_source: 'default', text_model_locked: false,
  vision_model_source: 'default', vision_model_locked: false, max_requests_per_batch_source: 'default', max_requests_per_batch_locked: false,
}
const environmentLocked = { ...unlocked, endpoint_source: 'environment', endpoint_locked: true,
  text_model_source: 'environment', text_model_locked: true, key_source: 'environment', key_locked: true, configured: true }

function renderSettings(preferences: Preferences = DEFAULT_PREFERENCES, onPreferencesChange = vi.fn()) {
  const onSaved = vi.fn()
  render(<SettingsDialog config={null} onClose={() => undefined} onSaved={onSaved}
    preferences={preferences} onPreferencesChange={onPreferencesChange} />)
  return { onSaved, onPreferencesChange }
}

const offlineStatus = { offline: { ocr: { available: true, name: 'RapidOCR' },
  vision: { available: false, name: '量化 CLIP' }, network_required: false } } as unknown as Config

it('shows offline status and locks environment-owned fields with their source', async () => {
  vi.mocked(api).mockResolvedValueOnce(environmentLocked)
  render(<SettingsDialog config={offlineStatus} onClose={() => undefined} />)

  expect(await screen.findByLabelText('服务地址')).toBeDisabled()
  expect(screen.getByLabelText('文本模型')).toBeDisabled()
  expect(screen.getAllByText('来源：环境变量')).toHaveLength(3)
  expect(screen.getByText('中文 OCR：已就绪 · RapidOCR')).toBeInTheDocument()
  expect(screen.getByText('图片场景：未安装')).toBeInTheDocument()
  expect(screen.getByText(/仅支持 Chat Completions 兼容接口/)).toBeInTheDocument()
  expect(screen.getByText(/保存只更新本机加密设置，不连接模型服务/)).toBeInTheDocument()
})

it('saves form settings locally and clears the replacement key from the form', async () => {
  const updated = { ...unlocked, endpoint: 'https://example.com/v1', text_model: 'model-x', configured: true,
    key_source: 'saved', config_version: '1-def' }
  vi.mocked(api).mockResolvedValueOnce(unlocked).mockResolvedValueOnce(updated)
  const { onSaved } = renderSettings()

  fireEvent.change(await screen.findByLabelText('服务商模式'), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://example.com/v1' } })
  fireEvent.change(screen.getByLabelText('文本模型'), { target: { value: 'model-x' } })
  fireEvent.change(screen.getByLabelText('密钥处理'), { target: { value: 'replace' } })
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'sk-new-secret' } })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  expect(api).toHaveBeenNthCalledWith(2, '/model-config', {
    endpoint: 'https://example.com/v1', text_model: 'model-x', vision_model: 'qwen-vl-plus',
    max_requests_per_batch: 20, key_action: 'replace', api_key: 'sk-new-secret',
  })
  fireEvent.change(screen.getByLabelText('密钥处理'), { target: { value: 'replace' } })
  expect(screen.getByLabelText('API 密钥')).toHaveValue('')
  expect(screen.queryByText(/sk-new-secret/)).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalledWith('/model-config/test', expect.anything())
})

it('requires explicit consent before sending a fixed text connection test', async () => {
  const configured = { ...unlocked, configured: true, key_source: 'saved' }
  vi.mocked(api).mockResolvedValueOnce(configured).mockResolvedValueOnce({ ok: true })
  renderSettings()

  const testButton = await screen.findByRole('button', { name: '测试连接' })
  expect(testButton).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认连接到上方服务地址/ }))
  fireEvent.click(testButton)

  await screen.findByText(/连接成功。文本接口可调用；视觉能力未验证/)
  expect(api).toHaveBeenNthCalledWith(2, '/model-config/test', {
    endpoint: unlocked.endpoint, text_model: unlocked.text_model, vision_model: unlocked.vision_model,
    max_requests_per_batch: unlocked.max_requests_per_batch, key_action: 'keep', confirmed: true,
  })
})

it('removes a saved key through the confirmation-protected clear-key route', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...unlocked, configured: true, key_source: 'saved' })
    .mockResolvedValueOnce({ ...unlocked, config_version: '2-ghi' })
  renderSettings()

  fireEvent.change(await screen.findByLabelText('密钥处理'), { target: { value: 'remove' } })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await screen.findByText(/本机设置已保存/)
  expect(api).toHaveBeenNthCalledWith(2, '/model-config/clear-key', { confirmed: true })
})

it('surfaces unreadable protected settings and prevents overwriting the fallback values', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...unlocked, settings_error: 'MODEL_SETTINGS_CORRUPT' })
  renderSettings()

  expect(await screen.findByRole('alert')).toHaveTextContent(/本机模型设置无法读取/)
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(screen.getByLabelText('服务地址')).toBeDisabled()
})

it('keeps model writes and tests disabled when the initial settings read fails', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('本机模型设置读取失败'))
  renderSettings()

  expect(await screen.findByRole('alert')).toHaveTextContent('本机模型设置读取失败')
  expect(screen.getByLabelText('服务商模式')).toBeDisabled()
  expect(screen.getByLabelText('服务地址')).toBeDisabled()
  expect(screen.getByLabelText('密钥处理')).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
  expect(api).toHaveBeenCalledTimes(1)
})

it('clears a replacement key after a failed save attempt', async () => {
  vi.mocked(api).mockResolvedValueOnce(unlocked).mockRejectedValueOnce(new Error('本机服务拒绝保存'))
  renderSettings()
  fireEvent.change(await screen.findByLabelText('密钥处理'), { target: { value: 'replace' } })
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'sk-temporary' } })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

  expect(await screen.findByText('本机服务拒绝保存')).toBeInTheDocument()
  expect(screen.getByLabelText('API 密钥')).toHaveValue('')
})

it('clears a replacement key after a failed explicit connection test', async () => {
  vi.mocked(api).mockResolvedValueOnce(unlocked).mockRejectedValueOnce(new Error('连接失败'))
  renderSettings()
  fireEvent.change(await screen.findByLabelText('密钥处理'), { target: { value: 'replace' } })
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'sk-test-only' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认连接到上方服务地址/ }))
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

  expect(await screen.findByText('连接失败')).toBeInTheDocument()
  expect(screen.getByLabelText('API 密钥')).toHaveValue('')
})

it('warns and disables testing when keeping a key bound to a different endpoint', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...unlocked, configured: true, key_source: 'saved' })
  renderSettings()
  fireEvent.change(await screen.findByLabelText('服务地址'), { target: { value: 'https://other.example/v1' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认连接到上方服务地址/ }))

  expect(screen.getByText(/密钥已绑定原服务地址/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(api).toHaveBeenCalledTimes(1)
})

it('sends density and offline-first changes to the parent preference handler', async () => {
  vi.mocked(api).mockResolvedValueOnce(unlocked)
  const onPreferencesChange = vi.fn()
  renderSettings(DEFAULT_PREFERENCES, onPreferencesChange)

  fireEvent.change(await screen.findByLabelText('界面密度'), { target: { value: 'compact' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '优先使用离线识别' }))
  expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, density: 'compact', offlineFirst: false })
})

it.each([
  [{ available: false, name: '本地 E5', state: 'missing', version: null, integrity_check: 'not_checked' }, '未安装'],
  [{ available: false, name: '本地 E5', state: 'checking', version: 'fixed-v1', integrity_check: 'checking' }, '校验中'],
  [{ available: true, name: '本地 E5', state: 'ready', version: 'fixed-v1', integrity_check: 'verified' }, '已就绪 · 本地 E5'],
  [{ available: false, name: '本地 E5', state: 'self_test_failed', version: 'fixed-v1', integrity_check: 'failed' }, '自检失败'],
  [{ available: false, name: '本地 E5', state: 'budget_limited', version: 'fixed-v1', integrity_check: 'verified' }, '预算受限'],
  [{ available: true, name: '本地 E5', state: 'ready', version: 'fixed-v1', integrity_check: 'not_checked' }, '待本地校验'],
  [{ available: true, name: '本地 E5', state: 'unknown-state', version: 'fixed-v1', integrity_check: 'verified' }, '状态待确认'],
] as const)('explains semantic capability state %j without triggering a download', async (semantic, label) => {
  vi.mocked(api).mockResolvedValueOnce(unlocked)
  render(<SettingsDialog config={{ ...offlineStatus, offline: { ...offlineStatus.offline!, semantic } }} onClose={() => undefined} />)

  expect(screen.getByText(`本地语义：${label}`)).toBeInTheDocument()
  if (semantic.version) expect(screen.getByText(`语义模型版本：${semantic.version}`)).toBeInTheDocument()
  expect(screen.getByText(/离线运行不下载、不上传/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /下载|安装/ })).not.toBeInTheDocument()
  await screen.findByLabelText('服务地址')
  await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled())
  expect(api).toHaveBeenCalledExactlyOnceWith('/model-config')
})

it('reports semantic capability as unavailable when older config omits it', async () => {
  vi.mocked(api).mockResolvedValueOnce(unlocked)
  render(<SettingsDialog config={offlineStatus} onClose={() => undefined} />)
  expect(screen.getByText('本地语义：未安装')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled())
})

it.each([
  [false, '实验候选未启用；当前使用规则、OCR 与视觉线索。'],
  [true, '实验候选已启用，所有语义建议仍需复核。'],
] as const)('distinguishes installed semantic readiness from experimental inference enabled=%s', async (enabled, message) => {
  vi.mocked(api).mockResolvedValueOnce(unlocked)
  const semantic = { available: true, name: '本地 BGE', state: 'ready', version: 'fixed-v1', integrity_check: 'verified', enabled }
  render(<SettingsDialog config={{ ...offlineStatus, offline: { ...offlineStatus.offline!, semantic } }} onClose={() => undefined} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled())
  expect(screen.getByText('本地语义：已就绪 · 本地 BGE')).toBeInTheDocument()
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /下载|安装/ })).not.toBeInTheDocument()
})
