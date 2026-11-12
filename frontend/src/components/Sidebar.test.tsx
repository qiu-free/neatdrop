import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'

const runtime = vi.hoisted(() => ({ web: false }))
vi.mock('../runtimeCapabilities', () => ({ get isWebExperience() { return runtime.web } }))
beforeEach(() => { runtime.web = false })

it('keeps every workspace destination available inside the glass navigation rail', () => {
  render(<Sidebar page="library" onPage={() => undefined} online />)
  const navigation = screen.getByRole('navigation', { name: '主导航' })

  expect(screen.getByRole('complementary')).toHaveClass('sidebar-glass')
  expect(navigation.querySelectorAll('button')).toHaveLength(5)
  expect(screen.queryByRole('button', { name: '产品说明' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '使用说明' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '资料库' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('原件始终保留')).toBeInTheDocument()
  expect(screen.getByText('本地服务已连接')).toBeInTheDocument()
})

it('keeps the practice shortcut out of the sidebar while preserving the help completion badge', () => {
  render(<Sidebar page="help" onPage={() => undefined} online exerciseCompleted />)
  expect(screen.getByRole('button', { name: '使用说明 已练习' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /安全练习/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看整理安全说明' })).toBeInTheDocument()
})

it('offers an accessible collapse control and keeps every icon destination operable when collapsed', () => {
  const navigate = vi.fn()
  const toggle = vi.fn()
  const { rerender } = render(<Sidebar page="library" onPage={navigate} online onToggle={toggle} />)
  const control = screen.getByRole('button', { name: '收起侧边栏' })
  expect(control).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(control)
  expect(toggle).toHaveBeenCalledOnce()

  rerender(<Sidebar page="library" onPage={navigate} online onToggle={toggle} collapsed />)
  expect(screen.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute('aria-expanded', 'false')
  const navigation = within(screen.getByRole('navigation', { name: '主导航' }))
  expect(navigation.getAllByRole('button')).toHaveLength(5)
  expect(navigation.getByRole('button', { name: '资料库' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(navigation.getByRole('button', { name: '知识图谱' }))
  expect(navigate).toHaveBeenCalledWith('graph')
})

it('shows icon names on keyboard focus and lets Escape dismiss the hint', () => {
  render(<Sidebar page="workbench" onPage={() => undefined} online collapsed />)
  const library = screen.getByRole('button', { name: '资料库' })
  fireEvent.focus(library)
  const hint = screen.getByRole('tooltip')
  expect(hint).toHaveTextContent('资料库')
  expect(library).toHaveAttribute('aria-describedby', hint.id)
  fireEvent.keyDown(library, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('dismisses a pointer hint with Escape even when keyboard focus is outside the navigation', () => {
  render(<Sidebar page="workbench" onPage={() => undefined} online collapsed />)
  fireEvent.mouseEnter(screen.getByRole('button', { name: '资料库' }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('资料库')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('keeps the hint visible while the icon still has keyboard focus after the pointer leaves', () => {
  vi.useFakeTimers()
  try {
    render(<Sidebar page="workbench" onPage={() => undefined} online collapsed />)
    const library = screen.getByRole('button', { name: '资料库' })
    act(() => library.focus())
    fireEvent.mouseEnter(library)
    fireEvent.mouseLeave(library)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('tooltip')).toHaveTextContent('资料库')
  } finally { vi.useRealTimers() }
})

it('summarizes the scanned directory with truthful support counts and a readable full path', () => {
  render(<Sidebar page="workbench" onPage={() => undefined} online workspace={{
    id: 'scanned', name: '设计与研究资料', path: 'C:/很长的目录/设计与研究资料',
    files: [
      { id: '1', name: '报告.pdf', supported: true },
      { id: '2', name: '照片.jpg', supported: true },
      { id: '3', name: '压缩包.zip', supported: false },
    ] as never,
  }} />)
  const context = within(screen.getByRole('region', { name: '当前目录概况' }))
  expect(context.getByText('设计与研究资料')).toBeInTheDocument()
  expect(context.getByText('已扫描文件')).toBeInTheDocument()
  expect(context.getByText('3')).toBeInTheDocument()
  expect(context.getByText('2')).toBeInTheDocument()
  expect(context.getByText('1 个文件暂不支持分析')).toBeInTheDocument()
  fireEvent.click(context.getByText('查看目录路径'))
  expect(context.getByText('C:/很长的目录/设计与研究资料')).toBeVisible()
})

it('explains the empty state and keeps memory experience claims separate from local copies', () => {
  runtime.web = true
  render(<Sidebar page="workbench" onPage={() => undefined} online />)
  expect(screen.getByText('尚未选择资料')).toBeInTheDocument()
  expect(screen.getByText('浏览器内存运行 · 不写入文件夹')).toBeInTheDocument()
  expect(screen.getByText('可导出整理清单')).toBeInTheDocument()
  expect(screen.queryByText('确认后才生成副本')).not.toBeInTheDocument()
  expect(screen.queryByText('查看目录路径')).not.toBeInTheDocument()
})

it('counts skipped subdirectories separately instead of claiming they are unsupported files', () => {
  render(<Sidebar page="workbench" onPage={() => undefined} online workspace={{
    id: 'with-child', name: '资料', path: 'C:/资料', files: [
      { id: 'file', supported: true, reason: '' },
      { id: 'child', supported: false, reason: 'DIRECTORY_SKIPPED' },
    ] as never,
  }} />)
  const context = within(screen.getByRole('region', { name: '当前目录概况' }))
  expect(context.getAllByText('1')).toHaveLength(2)
  expect(context.getByText('1 个子文件夹未扫描')).toBeInTheDocument()
  expect(context.queryByText(/暂不支持分析/)).not.toBeInTheDocument()
})
