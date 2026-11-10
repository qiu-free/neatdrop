import { forceLayoutGraph } from './graphForceLayout'
import type { GraphNode } from './graphProjection'

const fixture = (ids: string[], pairs: [string, string][]) => ({
  nodes: ids.map(id => ({ data: { id, label: id, type: 'file' as const, size: id === 'hub' ? 19 : 14 }, position: { x: 0, y: 0 } })),
  edges: pairs.map(([source, target], index) => ({ data: { id: `r${index}`, source, target, kind: 'related' } })),
})
const positions = (nodes: GraphNode[]) => Object.fromEntries(nodes.map(node => [node.data.id, node.position]))
const distance = (a: GraphNode['position'], b: GraphNode['position']) => Math.hypot(a.x - b.x, a.y - b.y)

it('keeps unrelated files in compact category groups without creating relationships or moving saved nodes', () => {
  const nodes: GraphNode[] = Array.from({ length: 16 }, (_, i) => ({
    data: { id: `${i}`.padStart(2, '0'), label: `${i}`, type: 'file', category: i % 2 ? 'study' : 'work', size: 18 },
    position: { x: 0, y: 0 },
  }))
  const result = forceLayoutGraph(nodes, []), byId = positions(result)
  const same = result.filter(node => node.data.category === 'work')
  const other = result.filter(node => node.data.category === 'study')
  const centroid = (items: GraphNode[]) => ({ x: items.reduce((sum, node) => sum + node.position.x / items.length, 0), y: items.reduce((sum, node) => sum + node.position.y / items.length, 0) })
  const center = centroid(same), separation = distance(center, centroid(other))
  expect(Math.max(...same.map(node => distance(node.position, center)))).toBeLessThan(separation / 2)
  expect(Math.max(...result.map(node => node.position.x)) - Math.min(...result.map(node => node.position.x))).toBeLessThan(750)
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) expect(distance(result[i].position, result[j].position)).toBeGreaterThan(48)
  expect(positions(forceLayoutGraph([...nodes].reverse(), []))).toEqual(byId)
  const saved = { '00': { x: 300, y: 100 } }
  expect(positions(forceLayoutGraph(nodes, [], saved))['00']).toEqual(saved['00'])
  expect(result.every(node => node.data.degree === undefined)).toBe(true)
})

it('places a connected three-hub network deterministically regardless of input order or parallel edges', () => {
  const { nodes, edges } = fixture(['hub', 'a', 'b', 'c', 'd', 'e', 'f'], [['hub', 'a'], ['hub', 'b'], ['a', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'], ['f', 'b']])
  const normal = positions(forceLayoutGraph(nodes, edges))
  expect(normal).toEqual(positions(forceLayoutGraph([...nodes].reverse(), [...edges].reverse())))
  expect(normal).toEqual(positions(forceLayoutGraph(nodes, [...edges, { data: { ...edges[0].data, id: 'parallel' } }])))
  expect(new Set(Object.values(normal).map(point => `${point.x},${point.y}`)).size).toBe(nodes.length)
})

it('keeps saved nodes exactly anchored and expands new neighbors close to their anchors', () => {
  const { nodes, edges } = fixture(['hub', 'a', 'b'], [['hub', 'a'], ['hub', 'b']])
  const saved = { hub: { x: 520, y: 180 }, a: { x: 610, y: 180 } }
  const result = positions(forceLayoutGraph(nodes, edges, saved))
  expect(result.hub).toEqual(saved.hub)
  expect(result.a).toEqual(saved.a)
  expect(distance(result.b, saved.hub)).toBeLessThan(220)
  expect(distance(result.b, saved.a)).toBeGreaterThan(25)
  expect(positions(forceLayoutGraph(nodes.slice(0, 2), edges, saved)).hub).toEqual(saved.hub)
})

it('puts disconnected small groups around the connected core', () => {
  const { nodes, edges } = fixture(['hub', 'a', 'b', 'c', 'd', 'island-1', 'island-2', 'island-3', 'island-4'], [
    ['hub', 'a'], ['hub', 'b'], ['hub', 'c'], ['hub', 'd'], ['island-1', 'island-2'], ['island-3', 'island-4'],
  ])
  const result = positions(forceLayoutGraph(nodes, edges))
  const coreRadius = Math.max(...['hub', 'a', 'b', 'c', 'd'].map(id => Math.hypot(result[id].x, result[id].y)))
  expect(Math.hypot(result['island-1'].x, result['island-1'].y)).toBeGreaterThan(coreRadius)
  expect(Math.hypot(result['island-3'].x, result['island-3'].y)).toBeGreaterThan(coreRadius)
  expect(distance(result['island-1'], result['island-2'])).toBeLessThan(180)
})

it('forms three legible seven-leaf hubs connected by bridge edges', () => {
  const hubs = ['hub-a', 'hub-b', 'hub-c']
  const leaves = hubs.flatMap(hub => Array.from({ length: 7 }, (_, i) => `${hub}-leaf-${i}`))
  const pairs: [string, string][] = [...hubs.flatMap(hub => Array.from({ length: 7 }, (_, i) => [hub, `${hub}-leaf-${i}`] as [string, string])), ['hub-a', 'hub-b'], ['hub-b', 'hub-c']]
  const { nodes, edges } = fixture([...hubs, ...leaves], pairs)
  const result = positions(forceLayoutGraph(nodes, edges))
  expect(distance(result['hub-a'], result['hub-b'])).toBeLessThan(600)
  expect(distance(result['hub-b'], result['hub-c'])).toBeLessThan(600)
  for (const hub of hubs) {
    const own = Array.from({ length: 7 }, (_, i) => `${hub}-leaf-${i}`)
    expect(own.every(id => distance(result[hub], result[id]) < 250)).toBe(true)
    expect(own.some(id => distance(result[hub], result[id]) < 130)).toBe(true)
    // Centers joined by a real bridge need more space than their leaf radius,
    // otherwise neighboring stars collapse into one row of indistinct points.
    const leafRadius = own.reduce((sum, id) => sum + distance(result[hub], result[id]), 0) / own.length
    for (const other of hubs.filter(id => id !== hub)) {
      expect(distance(result[hub], result[other])).toBeGreaterThan(leafRadius * 1.6)
    }
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    expect(distance(result[nodes[i].data.id], result[nodes[j].data.id])).toBeGreaterThan(24)
  }
})

it.each(['star', 'chain', 'ring', 'isolates', 'dense'] as const)('produces finite separated positions for 200-node %s', shape => {
  const ids = Array.from({ length: 200 }, (_, i) => `${i}`.padStart(3, '0'))
  const pairs: [string, string][] = shape === 'star' ? ids.slice(1).map(id => ['000', id])
    : shape === 'chain' ? ids.slice(1).map((id, i) => [ids[i], id])
    : shape === 'ring' ? ids.map((id, i) => [id, ids[(i + 1) % ids.length]])
    : shape === 'dense' ? ids.flatMap((id, i) => ids.slice(i + 1, i + 8).map(other => [id, other] as [string, string])) : []
  const { nodes, edges } = fixture(ids, pairs)
  const started = performance.now()
  const result = forceLayoutGraph(nodes, edges)
  expect(performance.now() - started).toBeLessThan(1500)
  expect(result).toHaveLength(200)
  expect(result.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true)
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) expect(distance(result[i].position, result[j].position)).toBeGreaterThan(24)
})
