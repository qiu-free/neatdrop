import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { PREFERENCES_STORAGE_KEY } from './preferences'

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  localStorage.removeItem(PREFERENCES_STORAGE_KEY)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === '/api/session' ? { csrf: 'session' } : {
      model: { configured: false, text_model: 'text', vision_model: 'vision', max_requests_per_batch: 20 },
      categories: {}, undo_supported: true, execution_supported: true, demo_path: 'demo',
    },
  })))
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('offers a skippable first-run tour and reopens the in-memory exercise from the empty workbench', async () => {
  render(<App />)
  expect(screen.getByRole('dialog', { name: '新手导览' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '跳过导览' }))
  await waitFor(() => expect(screen.getByText('本地服务已连接')).toBeInTheDocument())
  const callsBeforePractice = vi.mocked(fetch).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '进入教程演练' }))
  expect(screen.getByRole('dialog', { name: '安全练习' })).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforePractice)
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!).tutorial).toMatchObject({ tourCompleted: false, tourStatus: 'skipped' })
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('shows saved display preferences without restoring any file draft', async () => {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1, density: 'compact', offlineFirst: true,
    tutorial: { tourCompleted: true, exerciseCompleted: true },
    path: 'private-path', plan: { id: 'untrusted' },
  }))
  render(<App />)
  await waitFor(() => expect(screen.getByText('本地服务已连接')).toBeInTheDocument())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.querySelector('.app-shell')).toHaveAttribute('data-density', 'compact')
  expect(screen.queryByText('private-path')).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('opens the library from the main navigation and returns to directory selection without fetching a path', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '跳过导览' }))
  await waitFor(() => expect(screen.getByText('本地服务已连接')).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: '资料库' }))
  expect(screen.getByRole('button', { name: '资料库' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { name: '先选择一个本机目录' })).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/library'))).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: '返回工作台选择目录' }))
  expect(screen.getByRole('button', { name: '整理工作台' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByLabelText('本地目录完整路径')).toBeVisible()
})

it('unmounts inactive pages while preserving the unsent path, help search and final navigation focus', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '跳过导览' }))
  await waitFor(() => expect(screen.getByText('本地服务已连接')).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('本地目录完整路径'), { target: { value: 'C:/会话草稿' } })
  fireEvent.click(screen.getByRole('button', { name: '使用说明' }))
  expect(screen.queryByLabelText('本地目录完整路径')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索使用说明' }), { target: { value: '撤回' } })
  for (let index = 0; index < 20; index++) {
    fireEvent.click(screen.getByRole('button', { name: index % 2 ? '整理工作台' : '资料库' }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  }
  expect(screen.getByLabelText('本地目录完整路径')).toHaveValue('C:/会话草稿')
  fireEvent.click(screen.getByRole('button', { name: '使用说明' }))
  expect(screen.getByRole('searchbox', { name: '搜索使用说明' })).toHaveValue('撤回')
  expect(screen.queryByRole('heading', { name: '会话与费用' })).not.toBeInTheDocument()
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(document.querySelector('[inert]')).toBeNull()
  expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toContain('会话草稿')
})

it('preserves workbench drafts and library filters on unmount while aborting drawer requests and restoring page scroll', async () => {
  const files = [
    { id: 'doc', name: 'report.docx', extension: '.docx', size: 40, modified: 1, supported: true, reason: '', sha256: 'abc' },
    { id: 'other', name: 'other.txt', extension: '.txt', size: 40, modified: 1, supported: true, reason: '', sha256: 'def' },
  ]
  const requests: { url: string; signal?: AbortSignal | null }[] = []
  const listing = { items: [{ id: 'copy', transaction_id: 'tx', name: 'report.docx', source: 'report.docx', target: '02_学习科研/report.docx', category: 'study', subcategory: null, created: '', size: 40, availability: 'available' }], truncated: false }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, signal: init?.signal })
    if (url.endsWith('/preview')) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))))
    const data = url === '/api/session' ? { csrf: 'session' }
      : url.endsWith('/config') ? { model: { configured: false }, categories: {}, execution_supported: true, undo_supported: true, supported_extensions: ['.docx', '.csv'], demo_path: '' }
        : url.endsWith('/workspaces') ? { id: 'w', name: 'Workspace', path: 'C:/private', files }
          : url.endsWith('/library') ? listing : []
    return { ok: true, json: async () => data } as Response
  }))
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 2, density: 'comfortable', offlineFirst: true, tutorial: { tourStatus: 'skipped', tourCompleted: false, exerciseCompleted: false } }))
  render(<App />)
  await screen.findByText('本地服务已连接')
  fireEvent.change(screen.getByLabelText('本地目录完整路径'), { target: { value: 'C:/private' } })
  fireEvent.click(screen.getByRole('button', { name: '扫描目录' }))
  await screen.findByRole('checkbox', { name: '选择 report.docx' })
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 report.docx' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步：分析' }))
  fireEvent.change(screen.getByLabelText('搜索文件'), { target: { value: 'report' } })
  const tableScroll = screen.getByRole('table').parentElement!
  tableScroll.scrollTop = 73
  fireEvent.scroll(tableScroll)
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 285 })
  fireEvent.click(screen.getByRole('row', { name: /report\.docx/ }))
  const firstPreview = requests.find(request => request.url.endsWith('/preview'))!
  expect(firstPreview.signal?.aborted).toBe(false)
  // Explicit programmatic navigation also exercises route changes while a drawer
  // is open; ordinary users first dismiss the modal overlay.
  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航', hidden: true })).getByRole('button', { name: '资料库', hidden: true }))
  expect(firstPreview.signal?.aborted).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(document.querySelector('[inert]')).toBeNull()
  await screen.findByRole('button', { name: '查看 report.docx' })
  fireEvent.change(screen.getByLabelText('主分类'), { target: { value: 'study' } })
  fireEvent.change(screen.getByLabelText('搜索资料库文件名'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '查看 report.docx' }))
  const libraryPreview = requests.find(request => request.url.includes('/library/') && request.url.endsWith('/preview'))!
  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航', hidden: true })).getByRole('button', { name: '整理工作台', hidden: true }))
  expect(libraryPreview.signal?.aborted).toBe(true)
  expect(screen.getByLabelText('搜索文件')).toHaveValue('report')
  expect(screen.getByRole('table').parentElement!.scrollTop).toBe(73)
  expect(screen.getByRole('checkbox', { name: '选择 report.docx' })).toBeChecked()
  expect(screen.getByRole('heading', { name: /分析与进度/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 285, behavior: 'instant' })
  fireEvent.change(screen.getByLabelText('本地目录完整路径'), { target: { value: 'C:/下一次待扫描目录' } })
  fireEvent.click(screen.getByRole('button', { name: '资料库' }))
  await screen.findByRole('button', { name: '查看 report.docx' })
  expect(screen.getByLabelText('主分类')).toHaveValue('study')
  expect(screen.getByLabelText('搜索资料库文件名')).toHaveValue('report')
  fireEvent.click(screen.getByRole('button', { name: '整理工作台' }))
  expect(screen.getByLabelText('本地目录完整路径')).toHaveValue('C:/下一次待扫描目录')
  expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toContain('private')
  await act(async () => undefined)
})
