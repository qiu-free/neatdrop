import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { FileGrid, type FileGridProps } from './FileGrid'
import { api } from '../api'
import type { FileRecord, Preview, Suggestion } from '../types'

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn() }))

const file: FileRecord = { id: 'a', name: '原始图表.png', extension: '.png', size: 100, modified: 1, supported: true, reason: '', sha256: 'first-hash' }
const suggestion: Suggestion = { file_id: 'a', name: '建议图表.png', category: 'study', subcategory: 'chart', evidence: '', review_required: true, provider: 'local_rules', sample: 'image' }
const imageA = 'data:image/png;base64,AAAA'
const imageB = 'data:image/png;base64,BBBB'
function props(overrides: Partial<FileGridProps> = {}): FileGridProps {
  return { workspaceId: 'w', files: [file], suggestions: { a: suggestion }, edits: {}, selected: new Set(), activeId: null, reviewed: new Set(), errors: {}, onSelect: vi.fn(), onActive: vi.fn(), ...overrides }
}
function pendingPreview() {
  let resolve!: (value: Preview) => void
  const promise = new Promise<Preview>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ image: imageA, sample: 'image' })
  vi.stubGlobal('IntersectionObserver', undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('allows selecting a review-required file without confirming or changing the viewed file', async () => {
  const options = props()
  const { rerender } = render(<FileGrid {...options} />)
  const checkbox = screen.getByRole('checkbox', { name: '选择 原始图表.png' })
  expect(checkbox).toBeEnabled()
  fireEvent.click(checkbox)
  expect(options.onSelect).toHaveBeenCalledExactlyOnceWith('a')
  expect(options.onActive).not.toHaveBeenCalled()
  rerender(<FileGrid {...options} selected={new Set(['a'])} />)
  expect(checkbox).toBeChecked()
  expect(screen.getByText('待复核')).toBeInTheDocument()
  expect(screen.queryByText('已确认')).not.toBeInTheDocument()
  fireEvent.mouseEnter(screen.getByRole('button', { name: '查看 原始图表.png' }))
  expect(options.onActive).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看 原始图表.png' }))
  expect(options.onActive).toHaveBeenCalledExactlyOnceWith('a')
  expect(options.onSelect).toHaveBeenCalledTimes(1)
  await screen.findByRole('img', { name: '原始图表.png 的缩略图' })
})

it('disables batch selection while leaving file viewing available', async () => {
  const options = props({ selectionDisabled: true, reviewed: new Set(['a']), activeId: 'a' })
  render(<FileGrid {...options} />)
  const checkbox = screen.getByRole('checkbox', { name: '选择 原始图表.png' })
  expect(checkbox).toBeDisabled()
  fireEvent.click(checkbox)
  expect(options.onSelect).not.toHaveBeenCalled()
  const open = screen.getByRole('button', { name: '查看 原始图表.png' })
  expect(open).toBeEnabled()
  expect(open).toHaveAttribute('aria-current', 'true')
  fireEvent.click(open)
  expect(options.onActive).toHaveBeenCalledExactlyOnceWith('a')
  expect(screen.getByText('已确认')).toBeInTheDocument()
  await screen.findByRole('img')
})

it('shows original names and parent-provided category labels while respecting a manual edit', async () => {
  render(<FileGrid {...props({
    edits: { a: { file_id: 'a', name: '人工副本.png', category: 'study', subcategory: 'chart' } },
    taxonomy: { study: { label: '学习与研究', directory: '学习科研', subcategories: { chart: '数据图表' } } },
  })} />)
  expect(screen.getByText('原始图表.png')).toBeInTheDocument()
  expect(screen.getByText('学习与研究 / 数据图表')).toBeInTheDocument()
  expect(screen.queryByText('人工副本.png')).not.toBeInTheDocument()
  await screen.findByRole('img')
})

it('falls back to the suggested category id when taxonomy labels are not provided', async () => {
  render(<FileGrid {...props()} />)
  expect(screen.getByText('study / chart')).toBeInTheDocument()
  await screen.findByRole('img')
})

it('renders document and unsupported file icons without requesting image previews', () => {
  const document = { ...file, id: 'b', name: '说明.md', extension: '.md' }
  const unsupported = { ...file, id: 'c', name: '视频.mp4', extension: '.mp4', supported: false }
  render(<FileGrid {...props({ files: [document, unsupported], suggestions: {} })} />)
  expect(screen.getByRole('button', { name: '查看 说明.md' }).querySelector('.file-icon')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看 视频.mp4' }).querySelector('.file-icon')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择 视频.mp4' })).toBeDisabled()
  expect(screen.getByText('已跳过')).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})

it('does not show an old response after the workspace changes with the same file id and hash', async () => {
  const old = pendingPreview(), next = pendingPreview()
  vi.mocked(api).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  const options = props()
  const { rerender } = render(<FileGrid {...options} />)
  const oldSignal = vi.mocked(api).mock.calls[0][2]!
  rerender(<FileGrid {...options} workspaceId="new-workspace" />)
  expect(oldSignal.aborted).toBe(true)
  await act(async () => { next.resolve({ image: imageB, sample: 'image' }) })
  expect(screen.getByRole('img')).toHaveAttribute('src', imageB)
  await act(async () => { old.resolve({ image: imageA, sample: 'image' }) })
  expect(screen.getByRole('img')).toHaveAttribute('src', imageB)
  expect(api).toHaveBeenLastCalledWith('/workspaces/new-workspace/files/a/preview', undefined, expect.any(AbortSignal))
})

it('clears the old image immediately and replaces the image surface when the same file bytes change', async () => {
  const changed = pendingPreview()
  vi.mocked(api).mockResolvedValueOnce({ image: imageA, sample: 'image' }).mockReturnValueOnce(changed.promise)
  const options = props()
  const { rerender } = render(<FileGrid {...options} />)
  const oldImage = await screen.findByRole('img')
  rerender(<FileGrid {...options} files={[{ ...file, sha256: 'changed-hash' }]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  await act(async () => { changed.resolve({ image: imageB, sample: 'image' }) })
  const newImage = screen.getByRole('img')
  expect(newImage).not.toBe(oldImage)
  expect(newImage).toHaveAttribute('src', imageB)
})

it('rejects an old response after the displayed file id changes', async () => {
  const old = pendingPreview(), next = pendingPreview()
  vi.mocked(api).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  const options = props()
  const { rerender } = render(<FileGrid {...options} />)
  rerender(<FileGrid {...options} files={[{ ...file, id: 'b', name: '第二.png' }]} />)
  await act(async () => { next.resolve({ image: imageB, sample: 'image' }); old.resolve({ image: imageA, sample: 'image' }) })
  expect(screen.getByRole('img', { name: '第二.png 的缩略图' })).toHaveAttribute('src', imageB)
  expect(screen.queryByRole('img', { name: '原始图表.png 的缩略图' })).not.toBeInTheDocument()
})

it('refreshes a file without a hash when its scan metadata changes', async () => {
  vi.mocked(api).mockResolvedValueOnce({ image: imageA, sample: 'image' }).mockResolvedValueOnce({ image: imageB, sample: 'image' })
  const options = props({ files: [{ ...file, sha256: null }] })
  const { rerender } = render(<FileGrid {...options} />)
  await screen.findByRole('img')
  rerender(<FileGrid {...options} files={[{ ...file, sha256: null, modified: 2 }]} />)
  await act(async () => undefined)
  expect(screen.getByRole('img')).toHaveAttribute('src', imageB)
})

it('shows an unavailable thumbnail after a request error and keeps viewing and selection usable', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Parser busy'))
  const options = props({ errors: { a: 'READ_FAILED' } })
  render(<FileGrid {...options} />)
  await screen.findByText('预览不可用')
  expect(screen.getByText('分析失败')).toBeInTheDocument()
  expect(screen.queryByText('Parser busy')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看 原始图表.png' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 原始图表.png' }))
  expect(options.onActive).toHaveBeenCalledExactlyOnceWith('a')
  expect(options.onSelect).toHaveBeenCalledExactlyOnceWith('a')
})

it('replaces an image that cannot decode with the fixed placeholder', async () => {
  render(<FileGrid {...props()} />)
  const image = await screen.findByRole('img')
  fireEvent.error(image)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('预览不可用')).toBeInTheDocument()
})

it('limits thumbnail requests to two and starts the next file when a request finishes', async () => {
  const first = pendingPreview(), second = pendingPreview(), third = pendingPreview()
  vi.mocked(api).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  render(<FileGrid {...props({ files: [file, { ...file, id: 'b', name: '第二.png' }, { ...file, id: 'c', name: '第三.png' }] })} />)
  expect(api).toHaveBeenCalledTimes(2)
  await act(async () => { first.resolve({ image: imageA, sample: 'image' }) })
  expect(api).toHaveBeenCalledTimes(3)
  expect(api).toHaveBeenLastCalledWith('/workspaces/w/files/c/preview', undefined, expect.any(AbortSignal))
  await act(async () => { second.resolve({ image: imageB, sample: 'image' }); third.resolve({ image: imageA, sample: 'image' }) })
  expect(screen.getAllByRole('img')).toHaveLength(3)
})

it('cancels removed thumbnails and starts the next queued file after the active API settles', async () => {
  const first = pendingPreview(), second = pendingPreview(), fourth = pendingPreview()
  vi.mocked(api).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(fourth.promise)
  const files = [file, { ...file, id: 'b', name: '第二.png' }, { ...file, id: 'c', name: '第三.png' }, { ...file, id: 'd', name: '第四.png' }]
  const options = props({ files })
  const { rerender } = render(<FileGrid {...options} />)
  const firstSignal = vi.mocked(api).mock.calls[0][2]!
  rerender(<FileGrid {...options} files={[files[1], files[3]]} />)
  expect(firstSignal.aborted).toBe(true)
  expect(api).toHaveBeenCalledTimes(2)
  await act(async () => { first.resolve({ image: imageA, sample: 'image' }) })
  expect(api).toHaveBeenLastCalledWith('/workspaces/w/files/d/preview', undefined, expect.any(AbortSignal))
  expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/files/c/'))).toBe(false)
  await act(async () => { second.resolve({ image: imageB, sample: 'image' }); fourth.resolve({ image: imageA, sample: 'image' }) })
  expect(screen.getAllByRole('img')).toHaveLength(2)
})

it('waits for thumbnails to approach the viewport when IntersectionObserver is available', async () => {
  const observers: { callback: IntersectionObserverCallback; instance: IntersectionObserver; element?: Element }[] = []
  class Observer {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      expect(options.rootMargin).toBe('160px')
      observers.push({ callback, instance: this as unknown as IntersectionObserver })
    }
    observe = (element: Element) => { observers[observers.length - 1].element = element }
    disconnect = vi.fn()
    unobserve = vi.fn()
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  render(<FileGrid {...props()} />)
  expect(api).not.toHaveBeenCalled()
  const observer = observers[0]
  act(() => { observer.callback([{ isIntersecting: true, target: observer.element } as IntersectionObserverEntry], observer.instance) })
  await screen.findByRole('img')
  expect(api).toHaveBeenCalledTimes(1)
  expect(observer.instance.disconnect).toHaveBeenCalled()
})

it('releases a removed card preview so revisiting it requests a fresh local thumbnail', async () => {
  const options = props()
  const { rerender } = render(<FileGrid {...options} />)
  await screen.findByRole('img')
  rerender(<FileGrid {...options} files={[]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<FileGrid {...options} />)
  await screen.findByRole('img')
  expect(api).toHaveBeenCalledTimes(2)
})

it('navigates with arrows and Home/End without selecting files or scrolling the page', () => {
  const files = [file, { ...file, id: 'b', name: '第二.md', extension: '.md' }, { ...file, id: 'c', name: '第三.md', extension: '.md' }, { ...file, id: 'd', name: '第四.md', extension: '.md' }]
  const options = props({ files: files.map(item => ({ ...item, extension: '.md' })), selectionDisabled: true, activeId: 'a' })
  render(<FileGrid {...options} />)
  const buttons = within(screen.getByRole('list', { name: '文件网格' })).getAllByRole('button')
  buttons.forEach((button, index) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: Math.floor(index / 2) * 200 } as DOMRect))
  const focus = vi.spyOn(buttons[1], 'focus')
  buttons[0].focus()
  expect(fireEvent.keyDown(buttons[0], { key: 'ArrowRight' })).toBe(false)
  expect(buttons[1]).toHaveFocus()
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  fireEvent.keyDown(buttons[1], { key: 'ArrowDown' })
  expect(buttons[3]).toHaveFocus()
  fireEvent.keyDown(buttons[3], { key: 'Home' })
  expect(buttons[0]).toHaveFocus()
  fireEvent.keyDown(buttons[0], { key: 'End' })
  expect(buttons[3]).toHaveFocus()
  fireEvent.keyDown(buttons[3], { key: 'ArrowUp' })
  expect(buttons[1]).toHaveFocus()
  fireEvent.keyDown(buttons[1], { key: 'ArrowLeft' })
  expect(buttons[0]).toHaveFocus()
  expect(options.onSelect).not.toHaveBeenCalled()
  expect(options.onActive).toHaveBeenLastCalledWith('a')
})

it('keeps the current column when an arrow reaches the first or last grid row', () => {
  const files = [file, { ...file, id: 'b', name: '第二.md' }, { ...file, id: 'c', name: '第三.md' }, { ...file, id: 'd', name: '第四.md' }].map(item => ({ ...item, extension: '.md' }))
  const options = props({ files })
  render(<FileGrid {...options} />)
  const buttons = screen.getAllByRole('button')
  buttons.forEach((button, index) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: Math.floor(index / 2) * 200 } as DOMRect))
  buttons[1].focus()
  fireEvent.keyDown(buttons[1], { key: 'ArrowUp' })
  expect(buttons[1]).toHaveFocus()
  buttons[2].focus()
  fireEvent.keyDown(buttons[2], { key: 'ArrowDown' })
  expect(buttons[2]).toHaveFocus()
  expect(options.onActive).not.toHaveBeenCalled()
})
