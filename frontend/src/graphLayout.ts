import type { GraphEdge, GraphNode, GraphPosition } from './graphProjection'

const NODE_GAP = 90
const BRANCH_GAP = 110

/** Arrange actual connected files together; layout never creates or removes relations. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], saved: Record<string, GraphPosition> = {}) {
  if (nodes.every(node => saved[node.data.id])) return nodes.map(node => ({ ...node, position: { ...saved[node.data.id] } }))
  const ids = nodes.map(node => node.data.id).sort(), adjacency = new Map(ids.map(id => [id, new Set<string>()]))
  edges.forEach(({ data }) => {
    if (data.source === data.target || !adjacency.has(data.source) || !adjacency.has(data.target)) return
    adjacency.get(data.source)!.add(data.target); adjacency.get(data.target)!.add(data.source)
  })
  const visited = new Set<string>(), components: string[][] = []
  ids.forEach(id => {
    if (visited.has(id)) return
    const component = [id]; visited.add(id)
    for (let index = 0; index < component.length; index++) {
      [...adjacency.get(component[index])!].sort().forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); component.push(neighbor) } })
    }
    components.push(component.sort())
  })
  const branches = components.map(component => {
    const points = arrangeBranch(component, adjacency)
    // World coordinates include the horizontal spacing before anchors and collision checks.
    points.forEach(point => { point.x *= 1.45 })
    const xs = [...points.values()].map(point => point.x), ys = [...points.values()].map(point => point.y)
    return { component, points, left: Math.min(...xs), top: Math.min(...ys), width: Math.max(24, Math.max(...xs) - Math.min(...xs)), height: Math.max(24, Math.max(...ys) - Math.min(...ys)) }
  }).sort((a, b) => b.height - a.height || b.width - a.width || a.component[0].localeCompare(b.component[0]))
  const totalArea = branches.reduce((sum, branch) => sum + (branch.width + BRANCH_GAP) * (branch.height + BRANCH_GAP), 0)
  const rowLimit = Math.max(0, ...branches.map(branch => branch.width), Math.sqrt(totalArea * 1.5))
  const placed = new Map<string, GraphPosition>()
  let x = 0, y = 0, rowHeight = 0
  branches.forEach(branch => {
    if (x && x + branch.width > rowLimit) { x = 0; y += rowHeight + BRANCH_GAP; rowHeight = 0 }
    branch.points.forEach((point, id) => placed.set(id, { x: point.x - branch.left + x, y: point.y - branch.top + y }))
    x += branch.width + BRANCH_GAP; rowHeight = Math.max(rowHeight, branch.height)
  })
  const xs = [...placed.values()].map(point => point.x), ys = [...placed.values()].map(point => point.y)
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  placed.forEach(point => { point.x -= center.x; point.y -= center.y })

  // New members of an expanded branch follow its remembered anchors. Existing
  // coordinates stay exact through filtering, selection and incremental expansion.
  branches.forEach(({ component }) => {
    const anchors = component.filter(id => saved[id])
    if (!anchors.length) return
    const offset = anchors.reduce((sum, id) => ({ x: sum.x + saved[id].x - placed.get(id)!.x, y: sum.y + saved[id].y - placed.get(id)!.y }), { x: 0, y: 0 })
    component.forEach(id => { const point = placed.get(id)!; point.x += offset.x / anchors.length; point.y += offset.y / anchors.length })
  })
  const occupied = Object.entries(saved).filter(([id]) => adjacency.has(id)).map(([, point]) => point)
  const result = new Map<string, GraphPosition>()
  ids.forEach(id => {
    if (saved[id]) { result.set(id, { ...saved[id] }); return }
    const original = placed.get(id)!
    let point = { ...original }
    if (Object.keys(saved).length) {
      for (let step = 1; step <= 240 && occupied.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 45); step++) {
        const angle = step * 2.3999632297, radius = Math.sqrt(step) * 28
        point = { x: original.x + Math.cos(angle) * radius, y: original.y + Math.sin(angle) * radius }
      }
    }
    point = { x: Math.round(point.x), y: Math.round(point.y) }; result.set(id, point); occupied.push(point)
  })
  return nodes.map(node => ({ ...node, position: result.get(node.data.id)! }))
}

function arrangeBranch(ids: string[], adjacency: Map<string, Set<string>>) {
  if (ids.length === 1) return new Map([[ids[0], { x: 0, y: 0 }]])
  if (ids.every(id => adjacency.get(id)!.size <= 2)) {
    // A path follows one short arc instead of crisscrossing between scattered IDs.
    const start = ids.find(id => adjacency.get(id)!.size === 1) ?? ids[0], order = [start], seen = new Set(order)
    let current = start
    while (order.length < ids.length) {
      const next = [...adjacency.get(current)!].sort().find(id => !seen.has(id))
      if (!next) break
      seen.add(next); order.push(next); current = next
    }
    if (ids.length === 2) return new Map(order.map((id, index) => [id, { x: (index - .5) * NODE_GAP, y: 0 }]))
    const cycle = adjacency.get(start)!.size === 2
    if (ids.length <= 12 || cycle) {
      const step = cycle ? 2 * Math.PI / ids.length : Math.PI * 1.55 / (ids.length - 1)
      const gap = cycle && ids.length > 12 ? 28 : NODE_GAP
      const radius = gap / (2 * Math.sin(step / 2))
      return new Map(order.map((id, index) => { const angle = -Math.PI / 2 + step * index; return [id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }] }))
    }
    const columns = Math.ceil(Math.sqrt(ids.length * 1.4))
    return new Map(order.map((id, index) => { const row = Math.floor(index / columns), column = index % columns; return [id, { x: (row % 2 ? columns - 1 - column : column) * NODE_GAP, y: row * NODE_GAP }] }))
  }
  const root = [...ids].sort((a, b) => adjacency.get(b)!.size - adjacency.get(a)!.size || a.localeCompare(b))[0]
  if (adjacency.get(root)!.size > 12) {
    const queue = [root], seen = new Set(queue)
    for (let index = 0; index < queue.length; index++) [...adjacency.get(queue[index])!].sort().forEach(id => { if (!seen.has(id)) { seen.add(id); queue.push(id) } })
    const result = new Map<string, GraphPosition>([[root, { x: 0, y: 0 }]])
    let index = 1, ring = 1
    while (index < queue.length) {
      const capacity = Math.max(12, Math.floor(2 * Math.PI * ring * NODE_GAP / 45)), count = Math.min(capacity, queue.length - index)
      for (let slot = 0; slot < count; slot++) {
        const angle = -Math.PI / 2 + slot * Math.PI * 2 / count + (ring % 2 ? 0 : .2)
        result.set(queue[index++], { x: Math.cos(angle) * ring * NODE_GAP, y: Math.sin(angle) * ring * NODE_GAP })
      }
      ring++
    }
    return result
  }
  const children = new Map(ids.map(id => [id, [] as string[]])), seen = new Set([root]), queue = [root]
  const depths = new Map<string, number>([[root, 0]])
  for (let index = 0; index < queue.length; index++) {
    [...adjacency.get(queue[index])!].sort().forEach(id => {
      if (seen.has(id)) return
      seen.add(id); queue.push(id); children.get(queue[index])!.push(id); depths.set(id, depths.get(queue[index])! + 1)
    })
  }
  const leaves = new Map<string, number>()
  for (const id of [...queue].reverse()) leaves.set(id, Math.max(1, children.get(id)!.reduce((sum, child) => sum + leaves.get(child)!, 0)))
  if (Math.max(...depths.values()) > 10) {
    const order: string[] = []
    const visit = (id: string) => { order.push(id); children.get(id)!.forEach(visit) }
    visit(root)
    const columns = Math.ceil(Math.sqrt(ids.length * 1.4))
    return new Map(order.map((id, index) => { const row = Math.floor(index / columns), column = index % columns; return [id, { x: (row % 2 ? columns - 1 - column : column) * NODE_GAP, y: row * NODE_GAP }] }))
  }
  const angles = new Map<string, number>()
  const place = (id: string, start: number, end: number) => {
    angles.set(id, (start + end) / 2)
    let angle = start
    children.get(id)!.forEach(child => { const next = angle + (end - start) * leaves.get(child)! / leaves.get(id)!; place(child, angle, next); angle = next })
  }
  place(root, -Math.PI / 2, Math.PI * 1.5)
  const radii = new Map<number, number>([[0, 0]])
  for (let depth = 1; depth <= Math.max(...depths.values()); depth++) {
    const layer = queue.filter(id => depths.get(id) === depth).map(id => angles.get(id)!).sort((a, b) => a - b)
    const gaps = layer.length > 1 ? layer.map((angle, index) => (layer[(index + 1) % layer.length] - angle + 2 * Math.PI) % (2 * Math.PI)) : [2 * Math.PI]
    const minGap = Math.min(...gaps)
    const required = layer.length > 1 ? 40 / (2 * Math.sin(minGap / 2)) : 0
    radii.set(depth, Math.max((radii.get(depth - 1) ?? 0) + NODE_GAP, required))
  }
  const result = new Map<string, GraphPosition>()
  queue.forEach(id => { const radius = radii.get(depths.get(id)!)!, angle = angles.get(id)!; result.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }) })
  return result
}
