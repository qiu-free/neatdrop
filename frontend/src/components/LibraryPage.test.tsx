import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LibraryPage } from './LibraryPage'
import type { LibraryItem, Transaction, Workspace } from '../types'

const workspace: Workspace = { id: 'ws-one', name: '资料', path: 'C:\\本机资料', files: [] }
const history: Transaction[] = []
const items: LibraryItem[] = [
  { id: 'opaque-invoice', transaction_id: 'tx1', name: '报销账单.txt', source: '原始账单.txt', target: '财务票据/报销/报销账单.txt', category: 'finance', subcategory: null, created: '2026-11-04T01:00:00Z', size: 100, availability: 'available' },
  { id: 'opaque-study', transaction_id: 'tx2', name: '研究笔记.txt', source: '原始研究.txt', target: '学习资料/研究笔记.txt', category: 'study', subcategory: null, created: '2026-11-03T01:00:00Z', size: 200, availability: 'available' },
  { id: 'opaque-missing', transaction_id: 'tx3', name: '已丢失.txt', source: '原件.txt', target: '其他/已丢失.txt', category: 'other', subcategory: null, created: '2026-11-02T01:00:00Z', size: 30, availability: 'missing' },
  { id: 'opaque-changed', transaction_id: 'tx4', name: '已变更.txt', source: '原件2.txt', target: '其他/已变更.txt', category: 'other', subcategory: null, created: '2026-11-01T01:00:00Z', size: 40, availability: 'changed' },
  { id: 'opaque-unverified', transaction_id: 'tx5', name: '未验证.txt', source: '原件3.txt', target: '其他/未验证.txt', category: 'other', subcategory: null, created: '2026-10-31T01:00:00Z', size: 50, availability: 'unverified' },
]

function json(value: unknown, ok = true) { return { ok, json: async () => value } as Response }
function setup(list = items) {
  const requests: { url: string; signal?: AbortSignal | null }[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, signal: init?.signal })
    return url.endsWith('/preview') ? json({ text: '本机安全预览', sample: 'utf8', truncated: false }) : json({ items: list, truncated: false })
  })
  vi.stubGlobal('fetch', fetcher)
  return { requests, fetcher }
}

afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })

it('filters archived copies by main category and filename while showing actual paths, dates and count', async () => {
  setup()
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  expect(await screen.findByRole('button', { name: '查看 报销账单.txt' })).toBeInTheDocument()
  expect(screen.getByText('财务票据/报销/报销账单.txt')).toBeInTheDocument()
  expect(screen.getByText('原始账单.txt')).toBeInTheDocument()
  expect(screen.getByText(workspace.path)).toBeInTheDocument()
  expect(screen.getByText('共 5 项')).toBeInTheDocument()
  expect(screen.getByText(new Date(items[0].created).toLocaleString('zh-CN'))).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('主分类'), { target: { value: 'finance' } })
  expect(screen.getByText('显示 1 / 5 项')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '查看 研究笔记.txt' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索资料库文件名'), { target: { value: '不存在' } })
  expect(screen.getByText('没有符合条件的归档副本')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('主分类'), { target: { value: 'all' } })
  fireEvent.change(screen.getByLabelText('搜索资料库文件名'), { target: { value: '研究' } })
  expect(screen.getByRole('button', { name: '查看 研究笔记.txt' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '查看 报销账单.txt' })).not.toBeInTheDocument()
})

it('opens previews only by entry ID and restores focus, scroll and keyboard boundaries when closing', async () => {
  const { requests } = setup()
  document.body.style.overflow = 'auto'
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  const trigger = await screen.findByRole('button', { name: '查看 报销账单.txt' })
  trigger.focus()
  expect(requests).toHaveLength(1)
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '归档副本详情' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(await within(dialog).findByText('本机安全预览')).toBeInTheDocument()
  expect(requests[1].url).toBe('/api/v1/workspaces/ws-one/library/opaque-invoice/preview')
  expect(document.body.style.overflow).toBe('hidden')
  const close = within(dialog).getByRole('button', { name: '关闭资料库详情' })
  expect(close).toHaveFocus()
  const next = within(dialog).getByRole('button', { name: '下一个归档副本' })
  next.focus()
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(close).toHaveFocus()
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(next).toHaveFocus()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(document.body.style.overflow).toBe('auto')
  fireEvent.click(trigger)
  await waitFor(() => expect(requests.filter(request => request.url.endsWith('/preview'))).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '关闭资料库详情遮罩' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each([
  { name: 'Next reaches the last item', start: '报销账单.txt', direction: '下一个归档副本', target: '研究笔记.txt' },
  { name: 'Previous reaches the first item', start: '研究笔记.txt', direction: '上一个归档副本', target: '报销账单.txt' },
])('keeps focus on an enabled drawer control when $name', async ({ start, direction, target }) => {
  setup(items.slice(0, 2))
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: `查看 ${start}` }))
  const dialog = screen.getByRole('dialog', { name: '归档副本详情' })
  await within(dialog).findByText('本机安全预览')
  const navigation = within(dialog).getByRole('button', { name: direction })
  navigation.focus()
  expect(navigation).toHaveFocus()

  fireEvent.click(navigation)
  await within(dialog).findByText('本机安全预览')
  expect(within(dialog).getByRole('heading', { name: target })).toBeInTheDocument()
  expect(navigation).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: '关闭资料库详情' })).toHaveFocus()
  expect(document.activeElement).not.toBe(document.body)
  expect(document.activeElement).not.toBeDisabled()

  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).not.toBeDisabled()
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
})

it('shows unavailable reasons without attempting to read missing, changed or unverified copies', async () => {
  const { requests } = setup()
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  await screen.findByRole('button', { name: '查看 已丢失.txt' })
  for (const name of ['已丢失.txt', '已变更.txt', '未验证.txt']) {
    fireEvent.click(screen.getByRole('button', { name: `查看 ${name}` }))
    expect(screen.getByRole('dialog', { name: '归档副本详情' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/无法预览/)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  }
  expect(requests).toHaveLength(1)
})

it('keeps the drawer container when switching files and aborts stale previews without displaying old content', async () => {
  let settleFirst!: (value: Response) => void
  const { requests, fetcher } = setup()
  fetcher.mockImplementationOnce(async (input, init) => { requests.push({ url: String(input), signal: init?.signal }); return json({ items, truncated: false }) })
    .mockImplementationOnce((input, init) => { requests.push({ url: String(input), signal: init?.signal }); return new Promise(resolve => { settleFirst = resolve }) })
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 报销账单.txt' }))
  const dialog = screen.getByRole('dialog', { name: '归档副本详情' })
  const preview = within(dialog).getByLabelText('归档副本预览')
  fireEvent.click(within(dialog).getByRole('button', { name: '下一个归档副本' }))
  expect(screen.getByRole('dialog', { name: '归档副本详情' })).toBe(dialog)
  expect(within(dialog).getByLabelText('归档副本预览')).toBe(preview)
  expect(requests[1].signal?.aborted).toBe(true)
  expect(await within(dialog).findByText('本机安全预览')).toBeInTheDocument()
  settleFirst(json({ text: '过期的内容', sample: 'utf8' }))
  await waitFor(() => expect(screen.queryByText('过期的内容')).not.toBeInTheDocument())
})

it('discards stale directory results and refreshes after history changes', async () => {
  let settleOld!: (value: Response) => void
  const { requests, fetcher } = setup([])
  fetcher.mockImplementationOnce((input, init) => { requests.push({ url: String(input), signal: init?.signal }); return new Promise(resolve => { settleOld = resolve }) })
  const { rerender } = render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  rerender(<LibraryPage workspace={{ ...workspace, id: 'ws-two' }} history={history} onWorkbench={vi.fn()} />)
  expect(await screen.findByText('还没有归档副本')).toBeInTheDocument()
  expect(requests[0].signal?.aborted).toBe(true)
  settleOld(json({ items, truncated: false }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看 报销账单.txt' })).not.toBeInTheDocument())
  rerender(<LibraryPage workspace={{ ...workspace, id: 'ws-two' }} history={[{ id: 'tx1', created: '', mode: 'copy', items: [], status: 'undone', acknowledged: false }]} onWorkbench={vi.fn()} />)
  await waitFor(() => expect(requests.filter(request => request.url === '/api/v1/workspaces/ws-two/library')).toHaveLength(2))
})

it('clears preview content and explains a failed server revalidation', async () => {
  const { fetcher } = setup()
  fetcher.mockImplementationOnce(async () => json({ items, truncated: false }))
    .mockImplementationOnce(async () => json({ text: '之前的安全预览', sample: 'utf8' }))
    .mockImplementationOnce(async () => json({ code: 'LIBRARY_ENTRY_CHANGED' }, false))
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 报销账单.txt' }))
  expect(await screen.findByText('之前的安全预览')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '查看 报销账单.txt' }))
  expect(screen.queryByText('之前的安全预览')).not.toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('归档副本已变化，无法预览。请在本机核对文件。')
})

it('does not reuse an earlier preview when returning to that item before the next request settles', async () => {
  let settleNext!: (value: Response) => void
  let settleReturn!: (value: Response) => void
  const { fetcher } = setup()
  fetcher.mockImplementationOnce(async () => json({ items, truncated: false }))
    .mockImplementationOnce(async () => json({ text: '此前读取的内容', sample: 'utf8' }))
    .mockImplementationOnce(() => new Promise(resolve => { settleNext = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { settleReturn = resolve }))
  const { unmount } = render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 报销账单.txt' }))
  expect(await screen.findByText('此前读取的内容')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一个归档副本' }))
  fireEvent.click(screen.getByRole('button', { name: '上一个归档副本' }))
  expect(screen.queryByText('此前读取的内容')).not.toBeInTheDocument()
  settleReturn(json({ code: 'LIBRARY_ENTRY_CHANGED' }, false))
  expect(await screen.findByRole('alert')).toHaveTextContent('归档副本已变化')
  settleNext(json({ text: '过期结果', sample: 'utf8' }))
  unmount()
  expect(document.body.style.overflow).toBe('')
  expect([...document.body.children].some(node => (node as HTMLElement).inert)).toBe(false)
})

it('reports truncation and allows retry after a list error', async () => {
  const { fetcher } = setup()
  fetcher.mockImplementationOnce(async () => json({ code: 'DIRECTORY_CHANGED' }, false))
    .mockImplementationOnce(async () => json({ items: [items[0]], truncated: true }))
  render(<LibraryPage workspace={workspace} history={history} onWorkbench={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('目录已在外部被替换')
  fireEvent.click(screen.getByRole('button', { name: '重新加载资料库' }))
  expect(await screen.findByRole('button', { name: '查看 报销账单.txt' })).toBeInTheDocument()
  expect(screen.getByText(/仅显示最近的 1000 项/)).toBeInTheDocument()
})
