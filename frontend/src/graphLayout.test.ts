import { layoutGraph, type GraphEdge, type GraphNode } from './graphProjection'

function branches() {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = []
  // IDs are interleaved so an ID-only scatter cannot accidentally form branches.
  for (let step = 0; step < 6; step++) for (let group = 0; group < 4; group++) {
    const id = `${step}-${group}`
    nodes.push({ data: { id, type: 'file', label: id, entry: id, size: 14 }, position: { x: Math.cos(nodes.length * 2.4) * 300, y: Math.sin(nodes.length * 2.4) * 250 } })
    if (step) edges.push({ data: { id: `r:${id}`, source: `${step - 1}-${group}`, target: id, kind: 'reference' } })
  }
  return { nodes, edges }
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
function crosses(a: GraphNode['position'], b: GraphNode['position'], c: GraphNode['position'], d: GraphNode['position']) {
  const side = (p: GraphNode['position'], q: GraphNode['position'], r: GraphNode['position']) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

it('places related branches in separate areas without long crossing edges', () => {
  const { nodes, edges } = branches(), result = layoutGraph(nodes, edges), byId = new Map(result.map(n => [n.data.id, n.position]))
  for (const edge of edges) expect(distance(byId.get(edge.data.source)!, byId.get(edge.data.target)!)).toBeLessThan(145)
  for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
    const first = edges[a].data, second = edges[b].data
    if (new Set([first.source, first.target, second.source, second.target]).size < 4) continue
    expect(crosses(byId.get(first.source)!, byId.get(first.target)!, byId.get(second.source)!, byId.get(second.target)!)).toBe(false)
  }
  const boxes = Array.from({ length: 4 }, (_, group) => {
    const points = result.filter(node => node.data.id.endsWith(`-${group}`)).map(node => node.position)
    return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) }
  })
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const first = boxes[a], second = boxes[b]
    expect(first.right + 70 < second.left || second.right + 70 < first.left || first.bottom + 70 < second.top || second.bottom + 70 < first.top).toBe(true)
  }
})

it('orders a branching tree consistently with enough room to select each file', () => {
  const ids = ['root', 'left', 'right', 'left-1', 'left-2', 'right-1', 'right-2']
  const nodes: GraphNode[] = ids.map(id => ({ data: { id, type: 'file', label: id, entry: id }, position: { x: 0, y: 0 } }))
  const edges: GraphEdge[] = [['root', 'left'], ['root', 'right'], ['left', 'left-1'], ['left', 'left-2'], ['right', 'right-1'], ['right', 'right-2']].map(([source, target], index) => ({ data: { id: `${index}`, source, target, kind: 'related' } }))
  const result = layoutGraph(nodes, edges)
  for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) expect(distance(result[a].position, result[b].position)).toBeGreaterThan(46)
  const reverse = layoutGraph([...nodes].reverse(), [...edges].reverse())
  expect(Object.fromEntries(reverse.map(n => [n.data.id, n.position]))).toEqual(Object.fromEntries(result.map(n => [n.data.id, n.position])))
})

it('keeps saved positions through partial expansion and supports a dense bounded graph', () => {
  const { nodes, edges } = branches(), saved = { '0-0': { x: 530, y: 280 } }
  expect(layoutGraph(nodes, edges, saved).find(n => n.data.id === '0-0')?.position).toEqual(saved['0-0'])
  const many: GraphNode[] = Array.from({ length: 200 }, (_, i) => ({ data: { id: `${i}`, type: 'file', label: `${i}` }, position: { x: 0, y: 0 } }))
  const connected: GraphEdge[] = many.slice(1).map((n, i) => ({ data: { id: `edge:${i}`, source: `${Math.floor(i / 2)}`, target: n.data.id, kind: 'related' } }))
  const started = performance.now(), result = layoutGraph(many, connected)
  expect(result).toHaveLength(200)
  expect(result.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true)
  expect(performance.now() - started).toBeLessThan(1000)
})

it('keeps a full star and a full cycle usable inside the bounded overview', () => {
  const nodes: GraphNode[] = Array.from({ length: 200 }, (_, i) => ({ data: { id: `${i}`.padStart(3, '0'), type: 'file', label: `${i}` }, position: { x: 0, y: 0 } }))
  for (const kind of ['star', 'cycle']) {
    const edges: GraphEdge[] = (kind === 'star' ? nodes.slice(1) : nodes).map((node, i) => ({ data: { id: `edge:${i}`, source: kind === 'star' ? '000' : nodes[(i + 1) % nodes.length].data.id, target: node.data.id, kind: 'related' } }))
    const result = layoutGraph(nodes, edges), xs = result.map(n => n.position.x), ys = result.map(n => n.position.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(3000)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2000)
    for (let first = 0; first < result.length; first++) for (let second = first + 1; second < result.length; second++) expect(distance(result[first].position, result[second].position)).toBeGreaterThan(24)
  }
})

it.each([4, 6, 12, 200])('keeps a %i-file cycle in edge order without self crossings', count => {
  const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => ({ data: { id: `${i}`.padStart(3, '0'), type: 'file', label: `${i}` }, position: { x: 0, y: 0 } }))
  const edges: GraphEdge[] = nodes.map((node, i) => ({ data: { id: `r:${i}`, source: node.data.id, target: nodes[(i + 1) % count].data.id, kind: 'reference' } }))
  const result = new Map(layoutGraph(nodes, edges).map(node => [node.data.id, node.position]))
  for (let first = 0; first < count; first++) for (let second = first + 1; second < count; second++) {
    const a = edges[first].data, b = edges[second].data
    if (new Set([a.source, a.target, b.source, b.target]).size < 4) continue
    expect(crosses(result.get(a.source)!, result.get(a.target)!, result.get(b.source)!, result.get(b.target)!)).toBe(false)
  }
})

it('keeps a wide tree and a long branching chain separated inside the overview', () => {
  const cases: { ids: string[]; pairs: [string, string][] }[] = []
  const wide = { ids: ['root'], pairs: [] as [string, string][] }
  for (let branch = 0; branch < 12; branch++) {
    const parent = `branch-${branch}`; wide.ids.push(parent); wide.pairs.push(['root', parent])
    for (let leaf = 0; leaf < 11; leaf++) { const id = `${parent}-${leaf}`; wide.ids.push(id); wide.pairs.push([parent, id]) }
  }
  cases.push(wide)
  const long = { ids: Array.from({ length: 200 }, (_, i) => `${i}`.padStart(3, '0')), pairs: [['000', '001'], ['000', '002'], ['000', '003']] as [string, string][] }
  for (let index = 4; index < 200; index++) long.pairs.push([long.ids[index - 1], long.ids[index]])
  cases.push(long)
  for (const fixture of cases) {
    const nodes: GraphNode[] = fixture.ids.map(id => ({ data: { id, type: 'file', label: id }, position: { x: 0, y: 0 } }))
    const edges: GraphEdge[] = fixture.pairs.map(([source, target], i) => ({ data: { id: `${i}`, source, target, kind: 'related' } }))
    const result = layoutGraph(nodes, edges), xs = result.map(n => n.position.x), ys = result.map(n => n.position.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(3000)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2200)
    for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) expect(distance(result[a].position, result[b].position)).toBeGreaterThan(24)
  }
})
