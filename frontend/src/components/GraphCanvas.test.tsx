import { act, fireEvent, render, screen } from '@testing-library/react'
import { GraphCanvas } from './GraphCanvas'
import type { GraphEdge, GraphNode } from '../graphProjection'
import type { GraphViewport } from '../graphTypes'

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

it('rotates the scene with depth on drag without opening a file, and allows the next real click', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const canvas = screen.getByLabelText('归档分类和资料关系图')
  const before = screen.getByRole('button', { name: '预览 研究笔记.txt' }).getAttribute('transform')
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 190, clientY: 140, buttons: 1 })
  fireEvent.pointerUp(canvas, { clientX: 190, clientY: 140 })
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).not.toBe(0)
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

it('restores independent mode cameras and resets rotation with keyboard or explicit controls', () => {
  const p = props(), saved = { zoom: 1.2, pan: { x: 90, y: 40 }, rotation: { yaw: .7, pitch: -.2 } }
  const view = render(<GraphCanvas {...p} viewport={saved} />)
  fireEvent.keyDown(screen.getByLabelText('归档分类和资料关系图'), { key: 'ArrowRight' })
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).toBeGreaterThan(.7)
  view.rerender(<GraphCanvas {...p} view="relations" viewport={null} />)
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
  view.rerender(<GraphCanvas {...p} viewport={saved} />)
  expect(p.onViewport.mock.lastCall?.[0]).toEqual(saved)
  fireEvent.click(screen.getByRole('button', { name: '重置视图' }))
  expect(p.onViewport.mock.lastCall?.[0].rotation).toEqual({ yaw: 0, pitch: 0 })
})

it('shows the full selected name, cancels interrupted drags, and leaves normal wheel scrolling available', () => {
  const p = props()
  render(<GraphCanvas {...p} />)
  const node = screen.getByRole('button', { name: '预览 研究笔记.txt' }), canvas = screen.getByLabelText('归档分类和资料关系图')
  fireEvent.mouseEnter(node)
  expect(screen.queryByRole('status', { name: '当前聚焦文件' })).not.toBeInTheDocument()
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
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).not.toBe(0)
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
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
  fireEvent.pointerMove(canvas, { clientX: 150, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: 150, clientY: 100, pointerId: 2 })
  fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: 200, clientY: 100, pointerId: 1 })
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).toBeCloseTo(.7)
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
  expect(p.onViewport.mock.lastCall?.[0].rotation.yaw).toBeCloseTo(.7)
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
