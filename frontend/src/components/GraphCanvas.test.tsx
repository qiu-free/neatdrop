import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GraphCanvas } from './GraphCanvas'
const mock = vi.hoisted(() => ({ create: vi.fn(), fit: vi.fn(), destroy: vi.fn(), resize: vi.fn(), pan: vi.fn(() => ({ x: 42, y: 24 })), zoom: vi.fn(() => 1), add: vi.fn(), on: vi.fn(), disconnect: vi.fn(), observe: vi.fn(), reset: vi.fn(), fitZoom: 1, position: vi.fn(), data: vi.fn(), elements: new Map<string, any>() }))
vi.mock('cytoscape', () => ({ default: (...args: unknown[]) => {
  mock.create(...args)
  const collection = () => ({ map: (callback: (element: any) => unknown) => [...mock.elements.values()].map(callback), forEach: (callback: (element: any) => void) => [...mock.elements.values()].forEach(callback), removeClass: vi.fn(), addClass: vi.fn(), difference: () => ({ addClass: vi.fn() }) })
  const add = (value: any) => { mock.add(value); const element = { length: 1, id: () => value.data.id, data: (next?: unknown) => { if (typeof next === 'string') return value.data[next]; if (next) { mock.data(next); value.data = next } return value.data }, position: (next?: any) => { if (next) { mock.position(next); value.position = next } return value.position }, remove: () => mock.elements.delete(value.data.id), addClass: vi.fn(), neighborhood: () => ({ addClass: vi.fn() }), union: () => ({}) }; mock.elements.set(value.data.id, element) }
  return { fit: mock.fit, reset: mock.reset, destroy: mock.destroy, resize: mock.resize, pan: mock.pan, zoom: mock.zoom.mockImplementation(() => mock.fitZoom), add, on: mock.on, nodes: () => ({ map: (callback: (element: any) => unknown) => [...mock.elements.values()].filter(element => element.data('type')).map(callback) }), elements: collection, $: () => ({ nodes: () => ({ first: () => ({ length: 0 }) }) }), getElementById: (id: string) => mock.elements.get(id) ?? ({ length: 0 }), batch: (callback: () => void) => callback(), width: () => 800, height: () => 500 }
} }))
const nodes = [{ data: { id: 'file:one', label: '笔记', type: 'file' as const, entry: 'one' }, position: { x: 0, y: 0 } }]
beforeEach(() => { vi.clearAllMocks(); mock.elements.clear(); mock.fitZoom = 1; vi.stubGlobal('ResizeObserver', class { observe = mock.observe; disconnect = mock.disconnect }) })
afterEach(() => vi.unstubAllGlobals())
it('fits once after lazy creation, observes resizing, preserves viewport on updates and disposes resources', async () => {
  const props = { nodes, edges: [], onOpen: vi.fn(), view: 'categories' as const, viewport: null, onViewport: vi.fn(), onExpand: vi.fn(), expanded: {} }
  const view = render(<GraphCanvas {...props} />)
  await waitFor(() => expect(screen.queryByText('正在加载本机关系画布…')).not.toBeInTheDocument())
  expect(mock.fit).toHaveBeenCalledOnce()
  expect(mock.observe).toHaveBeenCalledOnce()
  view.rerender(<GraphCanvas {...props} nodes={[...nodes]} viewport={{ zoom: 1, pan: { x: 42, y: 24 } }} />)
  expect(mock.create).toHaveBeenCalledOnce()
  expect(mock.fit).toHaveBeenCalledOnce()
  expect(mock.pan).toHaveBeenCalledWith({ x: 42, y: 24 })
  view.unmount()
  expect(mock.destroy).toHaveBeenCalledOnce()
  expect(mock.disconnect).toHaveBeenCalledOnce()
})
it('opens file and relation taps through current callbacks and provides explicit zoom controls', async () => {
  const open = vi.fn(), expand = vi.fn(), viewport = vi.fn()
  render(<GraphCanvas nodes={nodes} edges={[]} onOpen={open} view="categories" viewport={null} onViewport={viewport} onExpand={expand} expanded={{}} />)
  await waitFor(() => expect(mock.on).toHaveBeenCalled())
  const tap = mock.on.mock.calls.find(call => call[0] === 'tap' && call[1] === 'node')![2]
  act(() => tap({ target: { data: () => ({ entry: 'one' }) } }))
  expect(open).toHaveBeenCalledWith('one')
  act(() => tap({ target: { data: () => ({ group: 'study/notes' }) } }))
  expect(expand).toHaveBeenCalledWith('study/notes')
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(mock.zoom).toHaveBeenCalledWith({ level: 1.2, renderedPosition: { x: 400, y: 250 } })
})
it('shows the full hovered file name for graph focus', async () => {
  render(<GraphCanvas nodes={[{ ...nodes[0], data: { ...nodes[0].data, label: '一个很长的完整文件名.txt' } }]} edges={[]} onOpen={vi.fn()} view="categories" viewport={null} onViewport={vi.fn()} onExpand={vi.fn()} expanded={{}} />)
  await waitFor(() => expect(mock.on).toHaveBeenCalled())
  const hover = mock.on.mock.calls.find(call => call[0] === 'mouseover' && call[1] === 'node')![2]
  act(() => hover({ target: { data: (key: string) => key === 'type' ? 'file' : '一个很长的完整文件名.txt', addClass: vi.fn(), neighborhood: () => ({ addClass: vi.fn() }), union: () => ({}) } }))
  expect(screen.getByRole('status', { name: '当前聚焦文件' })).toHaveTextContent('一个很长的完整文件名.txt')
})
it('keeps true fit at its bounded minimum and uses the same fit for reset', async () => {
  const fit = mock.fit
  mock.fitZoom = .2
  mock.zoom.mockClear()
  render(<GraphCanvas nodes={nodes} edges={[]} onOpen={vi.fn()} view="categories" viewport={null} onViewport={vi.fn()} onExpand={vi.fn()} expanded={{}} />)
  await waitFor(() => expect(fit).toHaveBeenCalledOnce())
  await waitFor(() => expect(fit).toHaveBeenCalledOnce())
  expect(mock.zoom).not.toHaveBeenCalledWith(1)
  fireEvent.click(screen.getByRole('button', { name: '重置视图' }))
  expect(fit).toHaveBeenCalledTimes(2)
  expect(mock.zoom.mock.calls.filter(call => call.length)).toEqual([])
})

it('saves dragged coordinates and does not overwrite them on data-only updates', async () => {
  const save = vi.fn(), props = { nodes, edges: [], onOpen: vi.fn(), view: 'categories' as const, viewport: null, onViewport: vi.fn(), onExpand: vi.fn(), expanded: {}, onPositions: save }
  const view = render(<GraphCanvas {...props} />)
  await waitFor(() => expect(mock.on).toHaveBeenCalled())
  const drag = mock.on.mock.calls.find(call => call[0] === 'dragfree')![2]
  act(() => drag({ target: { id: () => 'file:one', position: (key: string) => key === 'x' ? 300 : 220 } }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ 'file:one': { x: 300, y: 220 } }))
  const calls = mock.position.mock.calls.length
  view.rerender(<GraphCanvas {...props} nodes={[{ ...nodes[0], data: { ...nodes[0].data, focused: true } }]} />)
  expect(mock.position.mock.calls.length).toBe(calls)
})




it('fits a mode without a saved viewport and restores a saved destination without fitting again', async () => {
  const props = { nodes, edges: [], onOpen: vi.fn(), view: 'categories' as const, viewport: { zoom: 1, pan: { x: 900, y: 800 } }, onViewport: vi.fn(), onExpand: vi.fn(), expanded: {} }
  const view = render(<GraphCanvas {...props} />)
  await waitFor(() => expect(screen.queryByText('正在加载本机关系画布…')).not.toBeInTheDocument())
  expect(mock.fit).not.toHaveBeenCalled()
  view.rerender(<GraphCanvas {...props} view="relations" viewport={null} />)
  expect(mock.fit).toHaveBeenCalledOnce()
  view.rerender(<GraphCanvas {...props} view="categories" />)
  expect(mock.fit).toHaveBeenCalledOnce()
  expect(mock.pan).toHaveBeenCalledWith({ x: 900, y: 800 })
})
