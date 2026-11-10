import { act, fireEvent, render, screen } from '@testing-library/react'
import { GraphCanvas } from './GraphCanvas'
import type { GraphEdge, GraphNode } from '../graphProjection'
import type { GraphViewport } from '../graphTypes'
import { defaultGraphVisualSettings } from '../graphSettings'

const nodes: GraphNode[] = [
  { data: { id: 'file:one', label: '研究笔记.txt', type: 'file', entry: 'one', size: 9, color: '#609e92' }, position: { x: -120, y: -40 } },
  { data: { id: 'file:two', label: '研究附件.txt', type: 'file', entry: 'two', size: 9, color: '#7792ba' }, position: { x: 120, y: 40 } },
]
const edges: GraphEdge[] = [{ data: { id: 'relation:r1', source: 'file:one', target: 'file:two', kind: 'reference', relation: 'r1', origin: 'manual', directed: true, label: '引用' } }]
const props = () => ({ nodes, edges, onOpen: vi.fn(), onRelation: vi.fn(), view: 'categories' as const, viewport: null as GraphViewport | null, onViewport: vi.fn(), onExpand: vi.fn(), expanded: {}, onPositions: vi.fn() })

beforeEach(() => {
  // jsdom does not implement PointerEvent or element dimensions.
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; pointerType = 'mouse' })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())

it('keeps dots unlabelled even on selection and opens preview and evidence by mouse or keyboard', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  expect(screen.queryByText('研究笔记.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  fireEvent.mouseEnter(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  expect(screen.queryByText('研究笔记.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  expect(screen.queryByText('研究笔记.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究笔记.txt')
  expect(p.onOpen).toHaveBeenLastCalledWith('one')
  fireEvent.keyDown(screen.getByRole('button', { name: '预览 研究附件.txt' }), { key: 'Enter' })
  expect(screen.queryByText('研究附件.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究附件.txt')
  expect(screen.queryByText('研究笔记.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  expect(p.onOpen).toHaveBeenLastCalledWith('two')
  fireEvent.click(screen.getByRole('button', { name: '查看 引用 关系依据' }))
  expect(p.onOpen).toHaveBeenLastCalledWith('one', 'r1')
  expect(p.onRelation).toHaveBeenLastCalledWith('r1')
  fireEvent.click(screen.getByLabelText('归档分类和资料关系图'))
  expect(screen.queryByText('研究附件.txt', { selector: 'tspan' })).not.toBeInTheDocument()
})

it('pans the default 2D scene on background drag without opening a file, and allows the next real click', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  const before = screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 190, clientY: 140, buttons: 1 })
  fireEvent.pointerUp(canvas, { clientX: 190, clientY: 140 })
  expect(p.onViewport.mock.lastCall?.[0].pan.x).toBeGreaterThan(0)
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).toBe(0)
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')).not.toBe(before)
  fireEvent.click(canvas)
  expect(p.onOpen).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('button', { name: '预览 研究笔记.txt' }), { clientX: 150, clientY: 120, button: 0 })
  fireEvent.pointerUp(screen.getByRole('button', { name: '预览 研究笔记.txt' }), { clientX: 150, clientY: 120 })
  fireEvent.click(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  expect(p.onOpen).toHaveBeenCalledWith('one')
})

it('retains dragged node coordinates through metadata changes and filter round trips', () => {
  const p = props(), view = render(<GraphCanvas {...p} />)
  const node = screen.getByRole('button', { name: '预览 研究笔记.txt' })
  fireEvent.pointerDown(node, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(screen.getByLabelText('归档分类和资料关系图'), { clientX: 180, clientY: 140, buttons: 1 })
  fireEvent.pointerUp(screen.getByLabelText('归档分类和资料关系图'), { clientX: 180, clientY: 140 })
  const saved = p.onPositions.mock.lastCall?.[0]['file:one']
  expect(saved.x).not.toBe(-120)
  expect(Number.isFinite(saved.z)).toBe(true)
  const transform = node.getAttribute('transform')
  view.rerender(<GraphCanvas {...p} nodes={[nodes[1]]} edges={[]} />)
  view.rerender(<GraphCanvas {...p} nodes={nodes.map(value => ({ ...value, data: { ...value.data, focused: true } }))} />)
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')).toBe(transform)
})

it('restores external view cameras and resets rotation with keyboard or explicit controls', () => {
  const p = props(), saved = { zoom: 1.2, pan: { x: 90, y: 40 }, rotation: { yaw: .7, pitch: -.2 } }
  const view = render(<GraphCanvas {...p} viewport={saved} dimension="3d" />)
  fireEvent.keyDown(screen.getByLabelText('归档分类和资料关系图'), { key: 'ArrowRight' })
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).toBeGreaterThan(.7)
  view.rerender(<GraphCanvas {...p} view="relations" viewport={null} dimension="3d" />)
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
  view.rerender(<GraphCanvas {...p} viewport={saved} dimension="3d" />)
  expect(p.onViewport.mock.lastCall?.[0]).toEqual(saved)
  fireEvent.click(screen.getByRole('button', { name: '重置视图' }))
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
})

it('shows the full selected name, cancels interrupted drags, and leaves normal wheel scrolling available', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const node = screen.getByRole('button', { name: '预览 研究笔记.txt' }), canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.mouseEnter(node)
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究笔记.txt')
  fireEvent.focus(node)
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究笔记.txt')
  fireEvent.pointerDown(node, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 180, clientY: 140, buttons: 1 })
  fireEvent.pointerCancel(canvas)
  fireEvent.click(node)
  expect(p.onOpen).toHaveBeenCalledOnce()
  const last = p.onViewport.mock.calls.length
  fireEvent.wheel(canvas, { deltaY: 100 })
  expect(p.onViewport.mock.calls).toHaveLength(last)
  act(() => { fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true }) })
  expect(p.onViewport.mock.lastCall?.[0].zoom).toBeGreaterThan(p.onViewport.mock.calls[last - 1][0].zoom)
})

it('ends a gesture released outside the graph and never drags with the mouse button up', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(canvas, { clientX: 790, clientY: 100, button: 0 })
  fireEvent.pointerUp(window, { clientX: 900, clientY: 100 })
  const initial = screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')
  fireEvent.pointerMove(canvas, { clientX: 500, clientY: 200, buttons: 0 })
  fireEvent.pointerUp(canvas, { clientX: 500, clientY: 200 })
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')).toBe(initial)
  fireEvent.pointerDown(canvas, { clientX: 300, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 400, clientY: 100, buttons: 1 })
  fireEvent.pointerUp(canvas, { clientX: 400, clientY: 100 })
  expect(p.onViewport.mock.lastCall?.[0].pan.x).not.toBe(0)
})

it('keeps every relation between the same files separately clickable in both directions', () => {
  const p = props()
  const second = { data: { ...edges[0].data, id: 'relation:r2', relation: 'r2', source: 'file:two', target: 'file:one', label: '配套说明' } }
  render(<GraphCanvas {...p} edges={[...edges, second]} />)
  const reference = screen.getByRole('button', { name: '查看 引用 关系依据' }), attachment = screen.getByRole('button', { name: '查看 配套说明 关系依据' })
  expect(reference.getAttribute('d')).toMatch(/^M.*Q/)
  expect(attachment.getAttribute('d')).not.toBe(reference.getAttribute('d'))
  fireEvent.click(reference)
  expect(p.onOpen).toHaveBeenLastCalledWith('one', 'r1')
  fireEvent.click(attachment)
  expect(p.onOpen).toHaveBeenLastCalledWith('two', 'r2')
})

it('draws a single connection as a curved path with the same hit geometry', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const target = screen.getByRole('button', { name: '查看 引用 关系依据' })
  expect(target.getAttribute('d')).toMatch(/^M.*Q/)
  expect(target.previousElementSibling?.getAttribute('d')).toBe(target.getAttribute('d'))
})

it.each([3, 5])('separates all %i parallel curves enough to expose their clickable centers', count => {
  const p = props()
  render(<GraphCanvas {...p} edges={Array.from({ length: count }, (_, index) => ({ data: { ...edges[0].data, id: `relation:r${index}`, relation: `r${index}`, source: index % 2 ? 'file:two' : 'file:one', target: index % 2 ? 'file:one' : 'file:two', label: `关系${index}` } }))} />)
  const centers = Array.from({ length: count }, (_, index) => {
    const path = screen.getByRole('button', { name: `查看 关系${index} 关系依据` }).getAttribute('d')!
    const [x1, y1, cx, cy, x2, y2] = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
    return { x: (x1 + x2) / 4 + cx / 2, y: (y1 + y2) / 4 + cy / 2 }
  })
  for (let first = 0; first < count; first++) for (let second = first + 1; second < count; second++) {
    expect(Math.hypot(centers[first].x - centers[second].x, centers[first].y - centers[second].y)).toBeGreaterThan(14)
  }
})

it('saves an interrupted node drag before filtering and ignores another pointer ending', () => {
  const p = props(), view = render(<GraphCanvas {...p} />)
  const original = p.onPositions.mock.lastCall?.[0]['file:one']
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(screen.getByRole('button', { name: '预览 研究笔记.txt' }), { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 180, clientY: 140, buttons: 1 })
  fireEvent(window, new Event('blur'))
  const saved = p.onPositions.mock.lastCall?.[0]['file:one']
  expect(saved.x).not.toBe(original.x)
  view.rerender(<GraphCanvas {...p} nodes={[nodes[1]]} edges={[]} />)
  view.rerender(<GraphCanvas {...p} />)
  expect(p.onPositions.mock.lastCall?.[0]['file:one']).toEqual(saved)
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; pointerType = 'touch'; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  fireEvent.click(screen.getByRole('button', { name: '操作图谱' }))
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 150, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: 150, clientY: 100, pointerId: 2 })
  fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: 200, clientY: 100, pointerId: 1 })
  expect(p.onViewport.mock.lastCall?.[0].pan.x).toBeGreaterThan(0)
})

it('lets a vertical touch scroll leave graph positions and camera unchanged', () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; pointerType = 'touch' })
  const p = props()
  render(<GraphCanvas {...p} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图'), node = screen.getByRole('button', { name: '预览 研究笔记.txt' })
  const before = node.getAttribute('transform'), positionCalls = p.onPositions.mock.calls.length
  fireEvent.pointerDown(node, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 102, clientY: 160, buttons: 1 })
  fireEvent.pointerCancel(canvas)
  expect(node.getAttribute('transform')).toBe(before)
  expect(p.onPositions.mock.calls).toHaveLength(positionCalls)
})

it('follows a file chosen outside the canvas after a previous node selection or deselection', () => {
  const p = props(), view = render(<GraphCanvas {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  view.rerender(<GraphCanvas {...p} nodes={nodes.map(node => ({ ...node, data: { ...node.data, focused: node.data.entry === 'two' } }))} />)
  expect(screen.getByRole('button', { name: '预览 研究附件.txt' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究附件.txt')
  expect(screen.queryByText('研究笔记.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('归档分类和资料关系图'))
  expect(screen.queryByText('研究附件.txt', { selector: 'tspan' })).not.toBeInTheDocument()
  view.rerender(<GraphCanvas {...p} nodes={nodes.map(node => ({ ...node, data: { ...node.data, focused: node.data.entry === 'one' } }))} />)
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究笔记.txt')
})

it('keeps the live camera during drag when a parent refresh supplies an earlier viewport', () => {
  const p = props(), view = render(<GraphCanvas {...p} />)
  const stale = p.onViewport.mock.lastCall?.[0], canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100, buttons: 1 })
  view.rerender(<GraphCanvas {...p} viewport={stale} />)
  fireEvent.pointerUp(canvas, { clientX: 200, clientY: 100 })
  expect(p.onViewport.mock.lastCall?.[0].pan.x).toBeGreaterThan(stale.pan.x)
})

it('rotates in optional 3D and projects identical 2D coordinates regardless of saved depth', () => {
  const p = props(), view = render(<GraphCanvas {...p} dimension="3d" positions={{ 'file:one': { x: -120, y: -40, z: 120 } }} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 190, clientY: 140, buttons: 1 })
  fireEvent.pointerUp(canvas)
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).not.toBe(0)
  view.unmount()
  const fixed = { zoom: 1, pan: { x: 0, y: 0 }, rotation: { yaw: .7, pitch: .3 } }
  const firstView = render(<GraphCanvas {...p} dimension="2d" viewport={fixed} positions={{ 'file:one': { x: -120, y: -40, z: 120 } }} />)
  const first = screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')
  firstView.unmount()
  render(<GraphCanvas {...p} dimension="2d" viewport={fixed} positions={{ 'file:one': { x: -120, y: -40, z: -120 } }} />)
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')).toBe(first)
  expect(screen.getByText('2D')).toBeInTheDocument()
})

it('uses projected diameters, stable neutral or category colors, and adequate hit targets', () => {
  const p = props(), varied = nodes.map((node, index) => ({ ...node, data: { ...node.data, degree: index ? 15 : 0, size: index ? 22 : 7 } }))
  const view = render(<GraphCanvas {...p} nodes={varied} dimension="3d" />)
  const small = screen.getByRole('button', { name: '预览 研究笔记.txt' }), large = screen.getByRole('button', { name: '预览 研究附件.txt' })
  const dot = (element: Element) => element.querySelector('.graph-node-dot')!
  expect(Number(dot(small).getAttribute('r'))).toBeGreaterThanOrEqual(8)
  expect(Number(dot(large).getAttribute('r'))).toBeGreaterThan(Number(dot(small).getAttribute('r')))
  expect(Number(small.querySelector('.graph-node-hit')!.getAttribute('r'))).toBeGreaterThanOrEqual(22)
  const color = dot(large).getAttribute('fill')
  fireEvent.pointerDown(screen.getByLabelText('归档分类和资料关系图'), { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(screen.getByLabelText('归档分类和资料关系图'), { clientX: 180, clientY: 100, buttons: 1 })
  fireEvent.pointerUp(screen.getByLabelText('归档分类和资料关系图'))
  expect(dot(large).getAttribute('fill')).toBe(color)
  view.rerender(<GraphCanvas {...p} nodes={varied} visual={{ ...defaultGraphVisualSettings, colorMode: 'category' }} />)
  expect(dot(large).getAttribute('fill')).toBe('#7792ba')
})

it('identifies relation-free category groups while keeping file captions hidden and every node easy to select', () => {
  const p = props(), grouped = nodes.map(node => ({ ...node, data: { ...node.data, category: 'study', categoryLabel: '学习科研', degree: 0 } }))
  const view = render(<GraphCanvas {...p} nodes={grouped} edges={[]} />)
  expect(screen.getByText('学习科研 · 2')).toBeInTheDocument()
  expect(document.querySelector('.graph-nodes text')).toBeNull()
  expect(document.querySelector('.graph-spatial-edge')).toBeNull()
  const dot = document.querySelector('.graph-node-dot')!
  const before = Number(dot.getAttribute('r'))
  fireEvent.click(screen.getByRole('button', { name: '缩小画布' }))
  expect(Number(dot.getAttribute('r'))).toBe(before)
  view.rerender(<GraphCanvas {...p} nodes={grouped} />)
  expect(screen.queryByText('学习科研 · 2')).not.toBeInTheDocument()
  expect(document.querySelectorAll('.graph-spatial-edge')).toHaveLength(1)
})

it('uses an external category legend when zooming out would overlap the group captions', () => {
  const p = props(), grouped = nodes.map((node, index) => ({ ...node, data: { ...node.data, category: index ? 'study' : 'work', categoryLabel: index ? '学习科研' : '工作资料' } }))
  render(<GraphCanvas {...p} nodes={grouped} edges={[]} positions={{ 'file:one': { x: 0, y: 0 }, 'file:two': { x: 30, y: 0 } }} />)
  expect(screen.getByRole('list', { name: '图谱类别' })).toHaveTextContent('学习科研 · 1')
  expect(screen.getByRole('list', { name: '图谱类别' })).toHaveTextContent('工作资料 · 1')
  expect(document.querySelector('.graph-category-regions rect')).toBeNull()
  expect(document.querySelector('.graph-nodes text')).toBeNull()
})

it('keeps a dense overview selectable without an invisible target covering its neighbor', () => {
  const p = props()
  render(<GraphCanvas {...p} edges={[]} viewport={{ zoom: .6, pan: { x: 0, y: 0 } }} positions={{ 'file:one': { x: 0, y: 0 }, 'file:two': { x: 30, y: 0 } }} />)
  const elements = [...document.querySelectorAll('.graph-spatial-node')]
  const coordinates = elements.map(node => node.getAttribute('transform')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number))
  const gap = Math.hypot(coordinates[0][0] - coordinates[1][0], coordinates[0][1] - coordinates[1][1])
  for (const node of elements) {
    expect(Number(node.querySelector('.graph-node-dot')!.getAttribute('r')) * 2).toBeLessThan(gap)
    expect(Number(node.querySelector('.graph-node-hit')!.getAttribute('r')) * 2).toBeLessThan(gap)
  }
  const small = Number(elements[0].querySelector('.graph-node-dot')!.getAttribute('r'))
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(Number(elements[0].querySelector('.graph-node-dot')!.getAttribute('r'))).toBeGreaterThan(small)
})

it('keeps coincident saved nodes visible and individually keyboard accessible', () => {
  const p = props()
  render(<GraphCanvas {...p} edges={[]} positions={{ 'file:one': { x: 0, y: 0 }, 'file:two': { x: 0, y: 0 } }} />)
  for (const node of document.querySelectorAll('.graph-spatial-node')) {
    expect(Number(node.querySelector('.graph-node-dot')!.getAttribute('r'))).toBeGreaterThanOrEqual(4)
    expect(Number(node.querySelector('.graph-node-hit')!.getAttribute('r'))).toBeGreaterThanOrEqual(6)
    fireEvent.focus(node)
    fireEvent.keyDown(node, { key: 'Enter' })
  }
  expect(p.onOpen).toHaveBeenCalledWith('one')
  expect(p.onOpen).toHaveBeenCalledWith('two')
})

it('shows hovered identity, category and unique neighbor count while arrows stay off until focused', () => {
  const p = props()
  render(<GraphCanvas {...p} nodes={nodes.map(node => ({ ...node, data: { ...node.data, categoryLabel: '文献' } }))} edges={[edges[0], { data: { ...edges[0].data, id: 'relation:r2', relation: 'r2' } }]} />)
  expect(document.querySelector('marker')).toBeInTheDocument()
  expect(document.querySelector('.graph-spatial-edge > path')?.getAttribute('marker-end')).toBeNull()
  fireEvent.mouseEnter(screen.getByRole('button', { name: '预览 研究笔记.txt' }))
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('研究笔记.txt')
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('文献')
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('1 个相邻文件')
  expect(document.querySelector('.graph-spatial-edge > path')?.getAttribute('marker-end')).toMatch(/^url/)
  expect(document.querySelector('.graph-nodes text')).toBeNull()
})

it('captures ordinary wheel only while the SVG itself has focus, and lets touch capture be deliberate', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  const initial = p.onViewport.mock.calls.length
  fireEvent.wheel(canvas, { deltaY: -100 })
  expect(p.onViewport.mock.calls).toHaveLength(initial)
  canvas.focus()
  fireEvent.wheel(canvas, { deltaY: -100 })
  expect(p.onViewport.mock.calls).toHaveLength(initial + 1)
  expect(canvas).not.toHaveClass('is-operating')
  fireEvent.click(screen.getByRole('button', { name: '操作图谱' }))
  expect(canvas).toHaveClass('is-operating')
  fireEvent.click(screen.getByRole('button', { name: '退出操作' }))
  expect(canvas).not.toHaveClass('is-operating')
})

it('rearranges for force settings and explicit revisions while display changes retain anchors', () => {
  const p = props(), view = render(<GraphCanvas {...p} />)
  const first = p.onPositions.mock.lastCall?.[0]
  const initialCalls = p.onPositions.mock.calls.length
  view.rerender(<GraphCanvas {...p} visual={{ ...defaultGraphVisualSettings, colorMode: 'category', edgeWidth: 2 }} />)
  expect(p.onPositions.mock.calls).toHaveLength(initialCalls)
  view.rerender(<GraphCanvas {...p} visual={{ ...defaultGraphVisualSettings, layout: { ...defaultGraphVisualSettings.layout, linkDistance: 200 } }} />)
  const changed = p.onPositions.mock.lastCall?.[0]
  expect(changed['file:one'].x).not.toBe(first['file:one'].x)
  view.rerender(<GraphCanvas {...p} visual={{ ...defaultGraphVisualSettings, layout: { ...defaultGraphVisualSettings.layout, linkDistance: 200 } }} layoutRevision={1} />)
  expect(p.onPositions.mock.calls.length).toBeGreaterThan(initialCalls + 1)
})

it('switches dimensions without another layout pass and fits 2D with a flat camera', () => {
  const p = props(), view = render(<GraphCanvas {...p} dimension="3d" viewport={{ zoom: 1, pan: { x: 0, y: 0 }, rotation: { yaw: .5, pitch: .3 } }} />)
  const calls = p.onPositions.mock.calls.length
  view.rerender(<GraphCanvas {...p} dimension="2d" viewport={null} />)
  expect(p.onPositions.mock.calls).toHaveLength(calls)
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
  expect(screen.getByRole('button', { name: '预览 研究笔记.txt' })).toHaveAttribute('data-depth', '0.00')
})

it('shows explicit directed arrows and distinguishes suggested from confirmed automatic evidence', () => {
  const p = props(), candidates: GraphEdge[] = [
    { data: { ...edges[0].data, id: 'relation:s', relation: 's', origin: 'automatic', status: 'suggested' } },
    { data: { ...edges[0].data, id: 'relation:c', relation: 'c', origin: 'automatic', status: 'confirmed' } },
  ]
  render(<GraphCanvas {...p} edges={candidates} visual={{ ...defaultGraphVisualSettings, showDirections: true, edgeWidth: 2.5 }} />)
  const evidence = screen.getAllByRole('button', { name: '查看 引用 关系依据' })
  const paths = [...document.querySelectorAll('.graph-spatial-edge > path:first-child')]
  expect(paths).toHaveLength(2)
  expect(paths[0]).toHaveStyle('stroke-dasharray: 5 5')
  expect(paths[1]).toHaveStyle('stroke-dasharray: none')
  expect(paths[0]).toHaveStyle('stroke-width: 2.5')
  expect(paths[0].getAttribute('marker-end')).toMatch(/^url/)
  expect(evidence).toHaveLength(2)
})

it('ends an active 3D gesture when switching to 2D without restoring the stale camera', () => {
  const p = props(), view = render(<GraphCanvas {...p} dimension="3d" />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 180, clientY: 120, buttons: 1 })
  view.rerender(<GraphCanvas {...p} dimension="2d" viewport={null} />)
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
  const calls = p.onViewport.mock.calls.length
  fireEvent.pointerUp(canvas, { clientX: 180, clientY: 120 })
  expect(p.onViewport.mock.calls).toHaveLength(calls)
  expect(screen.getByText('2D')).toBeInTheDocument()
})

it('clears a pinch when its second pointer ends outside the SVG', () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; pointerType = 'touch'; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  const p = props()
  render(<GraphCanvas {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '操作图谱' }))
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 200, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 240, clientY: 100 })
  const calls = p.onViewport.mock.calls.length
  fireEvent.pointerUp(window, { pointerId: 2 })
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 100 })
  expect(p.onViewport.mock.calls).toHaveLength(calls)
})

it('adds an expanded branch next to its remembered node in the same world coordinate space', () => {
  const p = props(), view = render(<GraphCanvas {...p} nodes={[nodes[0]]} edges={[]} positions={{ 'file:one': { x: -200, y: 0, z: 0 } }} />)
  view.rerender(<GraphCanvas {...p} positions={{ 'file:one': { x: -200, y: 0, z: 0 } }} />)
  const points = p.onPositions.mock.lastCall?.[0]
  expect(points['file:one']).toEqual({ x: -200, y: 0, z: 0 })
  const distance = Math.hypot(points['file:one'].x - points['file:two'].x, points['file:one'].y - points['file:two'].y)
  expect(distance).toBeGreaterThan(55)
  expect(distance).toBeLessThan(180)
})

it('does not send an interrupted categories node drag into relations positions', () => {
  const p = props(), categoryPositions = vi.fn(), relationPositions = vi.fn()
  const view = render(<GraphCanvas {...p} onPositions={categoryPositions} positions={{ 'file:one': { x: -250, y: 0, z: 11 } }} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.pointerDown(screen.getByRole('button', { name: '预览 研究笔记.txt' }), { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 170, clientY: 120, buttons: 1 })
  view.rerender(<GraphCanvas {...p} view="relations" onPositions={relationPositions} positions={{ 'file:one': { x: 300, y: 0, z: 19 } }} />)
  expect(relationPositions).toHaveBeenCalledOnce()
  expect(relationPositions.mock.lastCall?.[0]['file:one']).toEqual({ x: 300, y: 0, z: 19 })
  view.rerender(<GraphCanvas {...p} onPositions={categoryPositions} positions={{ 'file:one': { x: -250, y: 0, z: 11 } }} />)
  expect(categoryPositions.mock.lastCall?.[0]['file:one']).toEqual({ x: -250, y: 0, z: 11 })
})

it('invalidates saved anchors in both views for force changes and explicit rearrange', () => {
  const p = props(), category = { 'file:one': { x: -1000, y: 0, z: 21 } }, relation = { 'file:one': { x: 1000, y: 0, z: 41 } }
  const view = render(<GraphCanvas {...p} positions={category} />)
  view.rerender(<GraphCanvas {...p} view="relations" positions={relation} />)
  const changedVisual = { ...defaultGraphVisualSettings, layout: { ...defaultGraphVisualSettings.layout, linkDistance: 200 } }
  view.rerender(<GraphCanvas {...p} view="relations" positions={relation} visual={changedVisual} />)
  expect(p.onPositions.mock.lastCall?.[0]['file:one'].x).not.toBe(1000)
  view.rerender(<GraphCanvas {...p} positions={category} visual={changedVisual} />)
  expect(p.onPositions.mock.lastCall?.[0]['file:one'].x).not.toBe(-1000)
  view.rerender(<GraphCanvas {...p} positions={category} visual={changedVisual} layoutRevision={1} />)
  view.rerender(<GraphCanvas {...p} view="relations" positions={relation} visual={changedVisual} layoutRevision={1} />)
  expect(p.onPositions.mock.lastCall?.[0]['file:one'].x).not.toBe(1000)
})

it('emits a flat camera when mounting 2D with a saved rotated viewport', () => {
  const p = props()
  render(<GraphCanvas {...p} viewport={{ zoom: 1.2, pan: { x: 10, y: 20 }, rotation: { yaw: .7, pitch: .3 } }} />)
  expect(p.onViewport.mock.lastCall?.[0]).toEqual({ zoom: 1.2, pan: { x: 10, y: 20 }, rotation: { yaw: 0, pitch: 0 } })
})
