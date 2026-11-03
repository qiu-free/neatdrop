import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { PREFERENCES_STORAGE_KEY } from './preferences'

beforeEach(() => {
  localStorage.removeItem(PREFERENCES_STORAGE_KEY)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === '/api/session' ? { csrf: 'session' } : {
      model: { configured: false, text_model: 'text', vision_model: 'vision', max_requests_per_batch: 20 },
      categories: {}, undo_supported: true, execution_supported: true, demo_path: 'demo',
    },
  })))
})

afterEach(() => vi.unstubAllGlobals())

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
  expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!).tutorial.tourCompleted).toBe(true)
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
