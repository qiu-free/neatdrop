import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KnowledgeGraphPage } from './KnowledgeGraphPage'
import { createGraphSession, type GraphListing } from '../graphTypes'
import type { Workspace } from '../types'
import type { CatalogListing } from '../catalogTypes'
vi.mock('./GraphCanvas', () => ({ GraphCanvas: (props: { visual?: { colorMode: string; nodeScale: number; showSuggested: boolean }; dimension?: string; viewport?: unknown; layoutRevision?: number }) => <div data-testid="canvas-props" data-color={props.visual?.colorMode} data-scale={props.visual?.nodeScale} data-suggested={String(props.visual?.showSuggested)} data-dimension={props.dimension} data-viewport={JSON.stringify(props.viewport)} data-revision={props.layoutRevision}>测试画布</div> }))
const workspace: Workspace = { id: 'ws-one', name: '资料', path: 'C:\\资料', files: [] }
const history: [] = []
const data: GraphListing = { items: [
  { id: 'one', transaction_id: 'tx', name: '研究笔记.txt', category: 'study', subcategory: 'notes', source: '原件', target: '归档/笔记', created: '', size: 100, availability: 'available' },
  { id: 'two', transaction_id: 'tx', name: '研究附件.txt', category: 'study', subcategory: 'notes', source: '原件2', target: '归档/附件', created: '', size: 200, availability: 'available' },
  { id: 'missing', transaction_id: 'tx', name: '缺失.txt', category: 'other', subcategory: null, source: '原件3', target: '归档/缺失', created: '', size: 300, availability: 'missing' },
], relations: [{ id: 'r1', source: 'one', target: 'two', kind: 'text_similar', status: 'suggested', origin: 'automatic', created: '' }], truncated: false, index: { count: 2, revision: 7, updated: null, state: 'ready', issues: [] } }
const json = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response
function setup() {
  const calls: { url: string; body: any; method: string; signal?: AbortSignal | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? 'GET', signal: init?.signal })
    if (url.endsWith('/preview')) return json({ text: '预览正文', sample: 'utf8' })
    if (url.endsWith('/evidence')) return json({ relation: data.relations[0], files: [{ id: 'one', name: '研究笔记.txt', excerpts: ['共同词段落'], summary: '抽样文字，质量受限' }], explanation: '文本关键词相似，仅为候选' })
    if (url.endsWith('/jobs')) return json({ id: 'job1', status: 'running', processed: 0, total: 1, current_file: '研究笔记.txt', errors: [] })
    if (url.endsWith('/cancel')) return json({ id: 'job1', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [{ entry_id: 'one', code: 'GRAPH_CONTENT_LIMITED' }] })
    return json(data)
  }))
  return calls
}
const props = () => ({ workspace, history, onWorkbench: vi.fn(), onLibrary: vi.fn(), session: createGraphSession() })
afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })
it('does not request without a workspace and supports empty archive recovery', async () => {
  setup(); const p = props()
  const view = render(<KnowledgeGraphPage {...p} workspace={null} />)
  fireEvent.click(screen.getByRole('button', { name: '返回工作台选择目录' }))
  expect(p.onWorkbench).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...data, items: [], relations: [] })))
  view.rerender(<KnowledgeGraphPage {...p} />)
  expect(await screen.findByText('还没有归档副本')).toBeInTheDocument()
})
it('keeps query in memory, opens verified preview and closes before library navigation', async () => {
  const calls = setup(), p = props()
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.change(await screen.findByLabelText('搜索图谱文件名'), { target: { value: '笔记' } })
  expect(screen.queryByRole('button', { name: '预览 研究附件.txt' })).not.toBeInTheDocument()
  expect(p.session.query).toBe('笔记')
  fireEvent.click(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  const drawer = screen.getByRole('dialog')
  expect(await within(drawer).findByText('预览正文')).toBeInTheDocument()
  expect(calls.filter(call => call.url.endsWith('/library/one/preview'))).toHaveLength(1)
  fireEvent.click(within(drawer).getByRole('button', { name: '在资料库查看' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(p.onLibrary).toHaveBeenCalledWith('one')
})
it('shows evidence and confirms only after review; submits manual direction with current revision', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '研究笔记.txt 文本相似候选 研究附件.txt' }))
  fireEvent.click(screen.getByRole('button', { name: '查看关系依据' }))
  expect(await screen.findByText('共同词段落')).toBeInTheDocument()
  expect(screen.getByText('抽样文字，质量受限')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认为相关资料' }))
  await waitFor(() => expect(calls.some(call => call.body?.candidate_id === 'r1' && call.body.revision === 7 && call.body.kind === 'related')).toBe(true))
  fireEvent.change(screen.getByLabelText('关系目标文件'), { target: { value: 'two' } })
  fireEvent.change(screen.getByLabelText('人工关系类型'), { target: { value: 'reference' } })
  expect(screen.getByText('研究笔记.txt 引用 研究附件.txt')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存人工关系' }))
  await waitFor(() => expect(calls.some(call => call.body?.source === 'one' && call.body.target === 'two' && call.body.kind === 'reference' && !call.body.candidate_id)).toBe(true))
})
it('requires consent, excludes unavailable copies, cancels job and clears index with DELETE', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '分析关联' }))
  const panel = screen.getByRole('region', { name: '本机分析设置' })
  expect(within(panel).getByLabelText('选择 缺失.txt')).toBeDisabled()
  fireEvent.click(within(panel).getByLabelText('选择 研究笔记.txt'))
  const start = within(panel).getByRole('button', { name: '开始本机分析' })
  expect(start).toBeDisabled()
  fireEvent.click(within(panel).getByLabelText(/我同意在本机保存/))
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '取消分析' }))
  expect(await screen.findByText('分析已取消')).toBeInTheDocument()
  expect(calls.find(call => call.url.endsWith('/jobs'))?.body).toEqual({ entry_ids: ['one'], confirmed: true })
  fireEvent.click(screen.getByRole('button', { name: '管理本机索引' }))
  fireEvent.click(screen.getByRole('button', { name: '清除本机索引' }))
  fireEvent.click(screen.getByRole('button', { name: '确认清除索引' }))
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/index') && call.method === 'DELETE' && call.body.revision === 7)).toBe(true))
})
it('aborts old workspace requests and discards responses that ignore cancellation', async () => {
  let resolve!: (value: Response) => void
  const signals: (AbortSignal | null | undefined)[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { signals.push(init?.signal); return url.includes('ws-two') ? Promise.resolve(json({ ...data, items: [] })) : new Promise<Response>(done => { resolve = done }) }))
  const p = props(), view = render(<KnowledgeGraphPage {...p} />)
  view.rerender(<KnowledgeGraphPage {...p} workspace={{ ...workspace, id: 'ws-two' }} />)
  expect(await screen.findByText('还没有归档副本')).toBeInTheDocument()
  expect(signals[0]?.aborted).toBe(true)
  await act(async () => resolve(json(data)))
  expect(screen.queryByRole('button', { name: '预览 研究笔记.txt' })).not.toBeInTheDocument()
  expect(p.session.workspace).toBe('ws-two')
})
it('filters relationship list with relation kind and keeps memory session on revisit', async () => {
  setup(); const p = props(); const view = render(<KnowledgeGraphPage {...p} />)
  await screen.findByRole('button', { name: '研究笔记.txt 文本相似候选 研究附件.txt' })
  fireEvent.click(screen.getByRole('button', { name: '图谱设置' }))
  fireEvent.change(screen.getByLabelText('关系类型'), { target: { value: 'reference' } })
  expect(screen.queryByRole('button', { name: '研究笔记.txt 文本相似候选 研究附件.txt' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索图谱文件名'), { target: { value: '笔记' } })
  view.unmount()
  render(<KnowledgeGraphPage {...p} />)
  expect(await screen.findByLabelText('搜索图谱文件名')).toHaveValue('笔记')
  fireEvent.click(screen.getByRole('button', { name: '图谱设置' }))
  expect(screen.getByLabelText('关系类型')).toHaveValue('reference')
})
it('does not re-fetch when the default group already shows every file and keeps collapse available', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  await screen.findByRole('button', { name: '图谱设置' })
  fireEvent.click(screen.getByRole('button', { name: '图谱设置' }))
  const more = await screen.findByRole('button', { name: '继续展开 学习科研 / 课程笔记' })
  expect(more).toBeDisabled()
  expect(screen.getByRole('button', { name: '收起 学习科研 / 课程笔记' })).toBeInTheDocument()
  expect(calls.filter(call => call.url.endsWith('/graph'))).toHaveLength(1)
})

it('opens settings on demand, closes on Escape, and returns focus to the trigger', async () => {
  setup(); render(<KnowledgeGraphPage {...props()} />)
  const trigger = await screen.findByRole('button', { name: '图谱设置' })
  expect(screen.queryByRole('region', { name: '图谱设置面板' })).not.toBeInTheDocument()
  fireEvent.click(trigger)
  expect(screen.getByRole('region', { name: '图谱设置面板' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '关闭图谱设置' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: '图谱设置面板' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '关闭图谱设置' }))
  expect(trigger).toHaveFocus()
})

it('updates canvas appearance without network requests and closes settings for preview', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '图谱设置' }))
  fireEvent.click(screen.getByText('外观'))
  fireEvent.change(screen.getByLabelText('节点大小'), { target: { value: '1.5' } })
  fireEvent.click(screen.getByLabelText('分类配色'))
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-scale', '1.5')
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-color', 'category')
  expect(calls.filter(call => call.url.endsWith('/graph'))).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  expect(screen.queryByRole('region', { name: '图谱设置面板' })).not.toBeInTheDocument()
})

it('restores separate 2D and 3D view cameras across dimension changes', async () => {
  setup(); const p = props(); p.session.workspace = workspace.id
  p.session.viewport = { zoom: .8, pan: { x: 42, y: 11 } }
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '图谱设置' }))
  fireEvent.click(screen.getByText('外观'))
  fireEvent.click(screen.getByRole('button', { name: '3D' }))
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-dimension', '3d')
  expect(p.session.viewport).toBeNull()
  p.session.viewport = { zoom: 1.2, pan: { x: 25, y: 30 }, rotation: { yaw: .2, pitch: .3 } }
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  expect(p.session.viewport).toEqual({ zoom: .8, pan: { x: 42, y: 11 } })
  fireEvent.click(screen.getByRole('button', { name: '3D' }))
  expect(p.session.viewport?.rotation?.yaw).toBe(.2)
})

it('filters candidates through the settings and only explicit layout actions increment revision', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '图谱设置' }))
  fireEvent.click(screen.getByLabelText('显示待核实候选'))
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-suggested', 'false')
  expect(screen.getByRole('button', { name: '研究笔记.txt 文本相似候选 研究附件.txt' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('布局'))
  fireEvent.change(screen.getByLabelText('布局密度'), { target: { value: 'spacious' } })
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-revision', '0')
  fireEvent.click(screen.getByRole('button', { name: '重新排列' }))
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-revision', '1')
  fireEvent.click(screen.getByRole('button', { name: '重置布局' }))
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-revision', '2')
  expect(screen.getByTestId('canvas-props')).toHaveAttribute('data-suggested', 'false')
  expect(calls.filter(call => call.url.endsWith('/graph'))).toHaveLength(1)
})

it('expands the canvas reversibly and keeps full file and relation lists in native disclosures', async () => {
  setup(); render(<KnowledgeGraphPage {...props()} />)
  const expand = await screen.findByRole('button', { name: '展开画布' })
  fireEvent.click(expand)
  expect(screen.getByRole('region', { name: '知识图谱' })).toHaveClass('is-expanded')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('region', { name: '知识图谱' })).not.toHaveClass('is-expanded')
  const files = screen.getByText(/文件列表/).closest('details')
  const relations = screen.getByText(/文件关系/).closest('details')
  expect(files).toHaveAttribute('open')
  expect(relations).toHaveAttribute('open')
})
it('reports evidence errors inside the drawer and blocks candidate confirmation without evidence', async () => {
  setup(); const original = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/evidence') ? Promise.resolve(json({ code: 'GRAPH_ENTRY_CHANGED' }, false)) : original(url, init)))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看关系依据' }))
  const drawer = screen.getByRole('dialog')
  expect(await within(drawer).findByRole('alert')).toHaveTextContent('归档副本已变化')
  expect(within(drawer).queryByRole('button', { name: '确认为相关资料' })).not.toBeInTheDocument()
})
it('resets query, focus and selection for a new workspace and drops late evidence', async () => {
  setup(); const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/evidence') ? new Promise<Response>(resolve => { finish = resolve }) : original(url, init)))
  const p = props(), view = render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看关系依据' }))
  view.rerender(<KnowledgeGraphPage {...p} workspace={{ ...workspace, id: 'ws-two' }} />)
  await screen.findByRole('button', { name: '预览 研究笔记.txt' })
  await act(async () => finish(json({ relation: data.relations[0], files: [], explanation: '旧目录证据' })))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('旧目录证据')).not.toBeInTheDocument()
  expect(p.session.focus).toBeNull()
})
it('preserves running job when navigating away and resumes cancellation on revisit', async () => {
  const calls = setup(), p = props(), view = render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '分析关联' }))
  fireEvent.click(screen.getByLabelText('选择 研究笔记.txt'))
  fireEvent.click(screen.getByLabelText(/我同意在本机保存/))
  fireEvent.click(screen.getByRole('button', { name: '开始本机分析' }))
  await screen.findByRole('button', { name: '取消分析' })
  view.unmount()
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '取消分析' }))
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/job1/cancel'))).toBe(true))
})
it('shows completed job errors and refreshes indexed listing after terminal job response', async () => {
  setup(); const original = vi.mocked(fetch).getMockImplementation()!
  const p = props()
  let completed = false
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { if (url.endsWith('/jobs')) { completed = true; return Promise.resolve(json({ id: 'job1', status: 'completed', processed: 1, total: 1, current_file: null, errors: [{ entry_id: 'one', code: 'GRAPH_CONTENT_LIMITED' }] })) } return url.endsWith('/graph') && completed ? Promise.resolve(json({ ...data, index: { ...data.index, count: 3 } })) : original(url, init) }))
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '分析关联' }))
  fireEvent.click(screen.getByLabelText('选择 研究笔记.txt'))
  fireEvent.click(screen.getByLabelText(/我同意在本机保存/))
  fireEvent.click(screen.getByRole('button', { name: '开始本机分析' }))
  expect(await screen.findByText('索引 3 项')).toBeInTheDocument()
  expect(screen.getByText(/研究笔记.txt: 文件内容提取受限/)).toBeInTheDocument()
})
it('enforces total and per-file analysis byte budgets before submitting', async () => {
  setup(); const original = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/graph') ? Promise.resolve(json({ ...data, items: [{ ...data.items[0], size: 21 * 1024 * 1024 }, ...Array.from({ length: 11 }, (_, index) => ({ ...data.items[1], id: `large${index}`, name: `大文件${index}.txt`, size: 20 * 1024 * 1024 }))] })) : original(url, init)))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '分析关联' }))
  expect(screen.getByLabelText('选择 研究笔记.txt')).toBeDisabled()
  for (let index = 0; index < 10; index++) fireEvent.click(screen.getByLabelText(`选择 大文件${index}.txt`))
  expect(screen.getByLabelText('选择 大文件10.txt')).toBeDisabled()
})
it('lets a preview show its own relations and dismisses candidates by current revision', async () => {
  const calls = setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览 研究笔记.txt' }))
  const drawer = screen.getByRole('dialog')
  await within(drawer).findByText('预览正文')
  fireEvent.click(within(drawer).getByRole('button', { name: '忽略候选' }))
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/relations/r1/dismiss') && call.body?.revision === 7)).toBe(true))
})
it('deletes only manual relations and sends DELETE revision', async () => {
  const calls = setup(), original = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/graph') ? Promise.resolve(json({ ...data, relations: [{ ...data.relations[0], kind: 'reference', status: 'confirmed', origin: 'manual' }] })) : original(url, init)))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '研究笔记.txt 引用 研究附件.txt' }))
  fireEvent.click(screen.getByRole('button', { name: '删除人工关系' }))
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/relations/r1') && call.method === 'DELETE' && call.body?.revision === 7)).toBe(true))
})

it('clears prior workspace job from the in-memory session before showing new directory', async () => {
  setup(); const p = props()
  p.session.workspace = 'old'; p.session.job = { id: 'private-job', status: 'running', total: 1, processed: 0, current_file: '旧目录.txt', errors: [] }
  render(<KnowledgeGraphPage {...p} />)
  await screen.findByRole('button', { name: '预览 研究笔记.txt' })
  expect(screen.queryByText(/旧目录.txt/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '取消分析' })).not.toBeInTheDocument()
})
it('uses conservative duplicate label and enables clearing unavailable zero-count index', async () => {
  const calls = setup(); const original = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/graph') ? Promise.resolve(json({ ...data, relations: [{ ...data.relations[0], kind: 'duplicate' }], index: { ...data.index, count: 0, state: 'unavailable' } })) : original(url, init)))
  render(<KnowledgeGraphPage {...props()} />)
  expect(await screen.findByText('归档时内容相同')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '管理本机索引' }))
  const clear = screen.getByRole('button', { name: '清除本机索引' })
  expect(clear).toBeEnabled()
  fireEvent.click(clear)
  expect(screen.getByText(/重建将替换不可读取的索引/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认清除索引' }))
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/index') && call.method === 'DELETE')).toBe(true))
})
it('resets target and evidence when moving the active preview to another file', async () => {
  setup(); render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览 研究笔记.txt' }))
  fireEvent.change(screen.getByLabelText('关系目标文件'), { target: { value: 'two' } })
  fireEvent.click(screen.getByRole('button', { name: '预览 研究附件.txt' }))
  expect(screen.getByLabelText('关系目标文件')).toHaveValue('')
  expect(screen.queryByText('共同词段落')).not.toBeInTheDocument()
})
it('cancels pending evidence when another file is opened and ignores its late content', async () => {
  setup(); const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (value: Response) => void
  let evidenceSignal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/evidence')) { evidenceSignal = init?.signal; return new Promise<Response>(resolve => { finish = resolve }) }
    return original(url, init)
  }))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看关系依据' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '预览 研究附件.txt' })))
  expect(evidenceSignal?.aborted).toBe(true)
  await act(async () => finish(json({ relation: data.relations[0], files: [{ id: 'one', name: '研究笔记.txt', excerpts: ['迟到的其他文件证据'], summary: '' }], explanation: '旧关系' })))
  expect(screen.queryByText('迟到的其他文件证据')).not.toBeInTheDocument()
})
it('switches to saved relation viewport before selecting or opening relation evidence', async () => {
  setup(); const p = props(); p.session.workspace = workspace.id; p.session.viewport = { zoom: .7, pan: { x: 900, y: 800 } }; p.session.viewports = { categories: p.session.viewport, relations: null }
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '研究笔记.txt 文本相似候选 研究附件.txt' }))
  expect(p.session.view).toBe('relations')
  expect(p.session.viewport).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看关系依据' }))
  expect(await screen.findByText('共同词段落')).toBeInTheDocument()
  expect(p.session.viewport).toBeNull()
})
it('moves analysis and index panels ahead of long result lists and focuses the opened panel', async () => {
  setup(); render(<KnowledgeGraphPage {...props()} />)
  await screen.findByRole('button', { name: '分析关联' })
  fireEvent.click(screen.getByRole('button', { name: '分析关联' }))
  expect(screen.getByRole('heading', { name: '选择本机分析资料' })).toHaveFocus()
  expect(screen.getByRole('region', { name: '本机分析设置' }).compareDocumentPosition(screen.getByText(/文件列表/).closest('details')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '管理本机索引' }))
  expect(screen.getByRole('heading', { name: '本机索引管理' })).toHaveFocus()
})


it('uses the central viewport transition when opening evidence directly from the category view', async () => {
  setup(); const p = props(); p.session.workspace = workspace.id
  p.session.viewport = { zoom: 1.4, pan: { x: 900, y: 800 } }
  p.session.viewports = { categories: p.session.viewport, relations: { zoom: 1.1, pan: { x: 50, y: 60 } } }
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看关系依据' }))
  expect(await screen.findByText('共同词段落')).toBeInTheDocument()
  expect(p.session.view).toBe('relations')
  expect(p.session.viewport).toEqual({ zoom: 1.1, pan: { x: 50, y: 60 } })
  expect(p.session.viewports.categories).toEqual({ zoom: 1.4, pan: { x: 900, y: 800 } })
})

function makeCatalogPage(offset: number, ids: string[], nextOffset: number | null): CatalogListing {
  const items = ids.map(id => ({ ...data.items[0], id, name: `${id}.txt`, workspace_id: 'ws-one', original_entry_id: id, source_alias: '资料目录' }))
  return { ...data, items, relations: ids.length > 1 ? [{ ...data.relations[0], source: ids[0], target: ids[1] }] : [], related_items: [], total: 20, offset, limit: 2, next_offset: nextOffset, roots: [] }
}

it('uses the current opaque cursor after a later-page relationship mutation', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/catalog')) return Promise.resolve(json({ version: 1, revision: 0, relations_revision: 0, roots: [] }))
    if (url.includes('/catalog/graph?offset=5')) return Promise.resolve(json(makeCatalogPage(5, ['five', 'six'], 11)))
    if (url.includes('/catalog/graph?')) return Promise.resolve(json(makeCatalogPage(0, ['one', 'two'], 5)))
    if (url.endsWith('/relations/r1/dismiss')) return Promise.resolve(json(makeCatalogPage(0, ['one', 'two'], 5)))
    return Promise.resolve(json(data))
  }))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  await screen.findByRole('button', { name: '预览 one.txt' })
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(urls).toContain('/api/v1/catalog/graph?offset=5&limit=1000'))
  await screen.findByRole('button', { name: '预览 five.txt' })
  fireEvent.click(screen.getByRole('button', { name: 'five.txt 文本相似候选 six.txt' }))
  fireEvent.click(screen.getByRole('button', { name: '忽略候选' }))
  await waitFor(() => expect(urls).toContain('/api/v1/catalog/graph?offset=5&limit=1000'))
  expect(await screen.findByRole('button', { name: '预览 five.txt' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '预览 one.txt' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '上一页' }))
  expect(await screen.findByRole('button', { name: '预览 one.txt' })).toBeInTheDocument()
})

it('cancels an in-flight catalog job after the creation response arrives late', async () => {
  let finishCreate!: (response: Response) => void
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/catalog')) return Promise.resolve(json({ version: 1, revision: 0, relations_revision: 0, roots: [] }))
    if (url.includes('/catalog/graph?')) return Promise.resolve(json(makeCatalogPage(0, ['one'], null)))
    if (url.endsWith('/graph/jobs')) return new Promise<Response>(resolve => { finishCreate = resolve })
    if (url.endsWith('/job-late/cancel')) return Promise.resolve(json({ id: 'job-late', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [] }))
    return Promise.resolve(json(data))
  }))
  render(<KnowledgeGraphPage {...props()} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  await screen.findByRole('button', { name: '预览 one.txt' })
  fireEvent.click(screen.getByRole('button', { name: '分析关联' }))
  fireEvent.click(await screen.findByLabelText('选择 one.txt'))
  fireEvent.click(screen.getByLabelText(/我同意在本机保存/))
  fireEvent.click(screen.getByRole('button', { name: '开始本机分析' }))
  await waitFor(() => expect(urls.some(url => url.endsWith('/graph/jobs'))).toBe(true))
  fireEvent.click(await screen.findByRole('button', { name: '取消分析' }))
  await act(async () => finishCreate(json({ id: 'job-late', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] })))
  expect(await screen.findByText('分析已取消')).toBeInTheDocument()
  expect(urls.filter(url => url.endsWith('/job-late/cancel'))).toHaveLength(1)
  expect(urls.filter(url => url.endsWith('/graph/jobs'))).toHaveLength(1)
})

it('cancels a catalog server task when leaving its graph scope', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/catalog')) return Promise.resolve(json({ version: 1, revision: 0, relations_revision: 0, roots: [] }))
    if (url.includes('/catalog/graph?')) return Promise.resolve(json(makeCatalogPage(0, ['one'], null)))
    if (url.endsWith('/graph/jobs')) return Promise.resolve(json({ id: 'job-active', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] }))
    if (url.endsWith('/job-active/cancel')) return Promise.resolve(json({ id: 'job-active', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [] }))
    if (url.endsWith('/job-active')) return Promise.resolve(json({ id: 'job-active', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] }))
    return Promise.resolve(json(data))
  }))
  const view = render(<KnowledgeGraphPage {...props()} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  await screen.findByRole('button', { name: '预览 one.txt' })
  fireEvent.click(screen.getByRole('button', { name: '分析关联' }))
  fireEvent.click(await screen.findByLabelText('选择 one.txt'))
  fireEvent.click(screen.getByLabelText(/我同意在本机保存/))
  fireEvent.click(screen.getByRole('button', { name: '开始本机分析' }))
  await waitFor(() => expect(urls.some(url => url.endsWith('/graph/jobs'))).toBe(true))
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'workspace' } })
  await waitFor(() => expect(urls).toContain('/api/v1/workspaces/ws-one/graph/jobs/job-active/cancel'))
  expect(urls.filter(url => url.endsWith('/job-active/cancel'))).toHaveLength(1)
  view.unmount()
})

it('keeps catalog cancellation retryable across registry refresh and scope return after create resolves late', async () => {
  let finishCreate!: (response: Response) => void
  let cancelAttempts = 0
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/catalog')) return Promise.resolve(json({ version: 1, revision: 0, relations_revision: 0, roots: [] }))
    if (url.includes('/catalog/graph?')) return Promise.resolve(json(makeCatalogPage(0, ['one'], null)))
    if (url.endsWith('/workspaces/ws-one/graph/jobs')) return new Promise<Response>(resolve => { finishCreate = resolve })
    if (url.endsWith('/job-late/cancel')) {
      cancelAttempts += 1
      if (cancelAttempts === 1) return Promise.resolve(json({ code: 'TEMPORARY_FAILURE' }, false))
      return Promise.resolve(json({ id: 'job-late', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [] }))
    }
    if (url.endsWith('/catalog/roots')) return Promise.resolve(json({ version: 1, revision: 1, relations_revision: 0, roots: [] }))
    if (url.endsWith('/job-late')) return Promise.resolve(json({ id: 'job-late', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] }))
    if (url.endsWith('/workspaces/ws-one/graph')) return Promise.resolve(json(data))
    return Promise.resolve(json(data))
  }))
  const p = props()
  const view = render(<KnowledgeGraphPage {...p} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  await screen.findByRole('button', { name: '预览 one.txt' })
  fireEvent.click(screen.getByRole('button', { name: '分析关联' }))
  fireEvent.click(await screen.findByLabelText('选择 one.txt'))
  fireEvent.click(screen.getByLabelText(/我同意在本机保存/))
  fireEvent.click(screen.getByRole('button', { name: '开始本机分析' }))
  await waitFor(() => expect(urls.some(url => url.endsWith('/workspaces/ws-one/graph/jobs'))).toBe(true))

  fireEvent.click(screen.getByRole('button', { name: '将当前目录加入资料集合' }))
  await waitFor(() => expect(urls.some(url => url.endsWith('/catalog/roots'))).toBe(true))
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'workspace' } })
  view.unmount()
  render(<KnowledgeGraphPage {...p} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  await screen.findByRole('button', { name: '预览 one.txt' })
  await act(async () => finishCreate(json({ id: 'job-late', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] })))
  await waitFor(() => expect(urls.filter(url => url.endsWith('/job-late/cancel'))).toHaveLength(1))
  expect(screen.getByText(/正在分析/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '取消分析' }))
  await waitFor(() => expect(urls.filter(url => url.endsWith('/job-late/cancel'))).toHaveLength(2))
  expect(screen.getByText('分析已取消')).toBeInTheDocument()
})
