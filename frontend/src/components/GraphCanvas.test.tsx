import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GraphCanvas } from './GraphCanvas'
const mock = vi.hoisted(() => ({ create: vi.fn(), fit: vi.fn(), destroy: vi.fn(), resize: vi.fn(), pan: vi.fn(() => ({ x: 42, y: 24 })), zoom: vi.fn(() => 1), add: vi.fn(), on: vi.fn(), disconnect: vi.fn(), observe: vi.fn() }))
vi.mock('cytoscape', () => ({ default: (...args: unknown[]) => { mock.create(...args); return { fit: mock.fit, destroy: mock.destroy, resize: mock.resize, pan: mock.pan, zoom: mock.zoom, add: mock.add, on: mock.on, elements: () => ({ map: () => [], forEach: () => undefined }), getElementById: () => ({ length: 0 }), batch: (callback: () => void) => callback(), width: () => 800, height: () => 500 } } }))
const nodes = [{ data: { id: 'file:one', label: '笔记', type: 'file' as const, entry: 'one' }, position: { x: 0, y: 0 } }]
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe = mock.observe; disconnect = mock.disconnect }) })
afterEach(() => vi.unstubAllGlobals())
it('fits once after lazy creation, observes resizing, preserves viewport on updates and disposes resources', async () => {
  const props = { nodes, edges: [], onOpen: vi.fn(), viewport: null, onViewport: vi.fn(), onExpand: vi.fn(), expanded: {} }
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
  render(<GraphCanvas nodes={nodes} edges={[]} onOpen={open} viewport={null} onViewport={viewport} onExpand={expand} expanded={{}} />)
  await waitFor(() => expect(mock.on).toHaveBeenCalled())
  const tap = mock.on.mock.calls.find(call => call[0] === 'tap' && call[1] === 'node')![2]
  act(() => tap({ target: { data: () => ({ entry: 'one' }) } }))
  expect(open).toHaveBeenCalledWith('one')
  act(() => tap({ target: { data: () => ({ group: 'study/notes' }) } }))
  expect(expand).toHaveBeenCalledWith('study/notes')
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(mock.zoom).toHaveBeenCalledWith({ level: 1.2, renderedPosition: { x: 400, y: 250 } })
})
