import { layoutGraph } from './graphLayout'
import { graphLayoutPreset, type GraphForceSettings } from './graphSettings'
import type { GraphEdge, GraphNode, GraphPosition } from './graphProjection'

/** Finite, deterministic force pass over the unique undirected topology. Saved coordinates are immutable anchors. */
export function forceLayoutGraph(nodes: GraphNode[], edges: GraphEdge[], saved: Record<string, GraphPosition> = {}, settings: GraphForceSettings = graphLayoutPreset('balanced')): GraphNode[] {
  if (!nodes.length) return []
  const ordered = [...nodes].sort((a, b) => a.data.id.localeCompare(b.data.id))
  const ids = new Set(ordered.map(node => node.data.id))
  const neighbors = new Map(ordered.map(node => [node.data.id, new Set<string>()]))
  edges.forEach(({ data }) => {
    if (data.source === data.target || !ids.has(data.source) || !ids.has(data.target)) return
    neighbors.get(data.source)!.add(data.target); neighbors.get(data.target)!.add(data.source)
  })
  const links = ordered.flatMap(node => [...neighbors.get(node.data.id)!].filter(id => id > node.data.id).sort().map(id => [node.data.id, id] as const))
  const seed = layoutGraph(ordered, links.map(([source, target], i) => ({ data: { id: `${i}`, source, target, kind: 'related' } })), saved)
  const point = new Map(seed.map(node => [node.data.id, { ...node.position }]))
  const anchored = new Set(ordered.filter(node => saved[node.data.id]).map(node => node.data.id))
  const components: string[][] = [], visited = new Set<string>()
  ordered.forEach(node => {
    const id = node.data.id
    if (visited.has(id)) return
    const component = [id]; visited.add(id)
    for (let i = 0; i < component.length; i++) [...neighbors.get(component[i])!].sort().forEach(neighbor => {
      if (!visited.has(neighbor)) { visited.add(neighbor); component.push(neighbor) }
    })
    components.push(component.sort())
  })
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
  const core = new Set(components[0])
  if (!anchored.size) {
    const coreCenter = components[0].reduce((acc, id) => ({ x: acc.x + point.get(id)!.x / core.size, y: acc.y + point.get(id)!.y / core.size }), { x: 0, y: 0 })
    components[0].forEach(id => { point.get(id)!.x -= coreCenter.x; point.get(id)!.y -= coreCenter.y })
    const coreRadius = Math.max(...components[0].map(id => Math.hypot(point.get(id)!.x, point.get(id)!.y)))
    const satellites = components.slice(1)
    satellites.forEach((component, index) => {
      const average = component.reduce((acc, id) => ({ x: acc.x + point.get(id)!.x / component.length, y: acc.y + point.get(id)!.y / component.length }), { x: 0, y: 0 })
      const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = Math.max(180, coreRadius + 80) + 48 * Math.sqrt(index)
      component.forEach(id => { point.get(id)!.x += Math.cos(angle) * radius - average.x; point.get(id)!.y += Math.sin(angle) * radius - average.y })
    })
  } else {
    // Incremental additions begin near remembered neighbors, never move remembered nodes.
    ordered.filter(node => !anchored.has(node.data.id)).forEach(node => {
      const adjacent = [...neighbors.get(node.data.id)!].filter(id => anchored.has(id)).sort()
      if (!adjacent.length) return
      const center = adjacent.reduce((acc, id) => ({ x: acc.x + saved[id].x / adjacent.length, y: acc.y + saved[id].y / adjacent.length }), { x: 0, y: 0 })
      const angle = ordered.indexOf(node) * 2.3999632297
      point.set(node.data.id, { x: center.x + Math.cos(angle) * settings.linkDistance, y: center.y + Math.sin(angle) * settings.linkDistance })
    })
  }
  const working = ordered.map(node => node.data.id)
  for (let step = 0; step < 36; step++) {
    const delta = new Map(working.map(id => [id, { x: 0, y: 0 }]))
    for (let i = 0; i < working.length; i++) for (let j = i + 1; j < working.length; j++) {
      const a = working[i], b = working[j], p = point.get(a)!, q = point.get(b)!
      let dx = p.x - q.x, dy = p.y - q.y
      if (dx === 0 && dy === 0) { dx = 1; dy = (j - i) * .01 }
      const length = Math.hypot(dx, dy), force = Math.min(12, settings.repulsion / Math.max(100, length * length))
      delta.get(a)!.x += dx / length * force; delta.get(a)!.y += dy / length * force
      delta.get(b)!.x -= dx / length * force; delta.get(b)!.y -= dy / length * force
    }
    for (const [a, b] of links) {
      const p = point.get(a)!, q = point.get(b)!, dx = q.x - p.x, dy = q.y - p.y, length = Math.max(1, Math.hypot(dx, dy))
      const pull = Math.max(-10, Math.min(10, (length - settings.linkDistance) * settings.attraction))
      delta.get(a)!.x += dx / length * pull; delta.get(a)!.y += dy / length * pull
      delta.get(b)!.x -= dx / length * pull; delta.get(b)!.y -= dy / length * pull
    }
    for (const id of working) {
      if (anchored.has(id)) continue
      const p = point.get(id)!, d = delta.get(id)!
      const centering = core.has(id) && !anchored.size ? settings.center : 0
      p.x += Math.max(-12, Math.min(12, d.x - p.x * centering))
      p.y += Math.max(-12, Math.min(12, d.y - p.y * centering))
    }
  }
  // Collision padding accounts for hub size. The deterministic sweep resolves residual overlaps.
  for (let pass = 0; pass < 8; pass++) for (let i = 0; i < working.length; i++) for (let j = i + 1; j < working.length; j++) {
    const a = working[i], b = working[j], p = point.get(a)!, q = point.get(b)!
    const minimum = Math.max(28, ((ordered[i].data.size ?? 14) + (ordered[j].data.size ?? 14)) * 1.1)
    const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy)
    if (length >= minimum) continue
    const ux = length ? dx / length : 1, uy = length ? dy / length : 0, gap = minimum - length + .01
    if (!anchored.has(a) && !anchored.has(b)) { p.x -= ux * gap / 2; p.y -= uy * gap / 2; q.x += ux * gap / 2; q.y += uy * gap / 2 }
    else if (!anchored.has(a)) { p.x -= ux * gap; p.y -= uy * gap }
    else if (!anchored.has(b)) { q.x += ux * gap; q.y += uy * gap }
  }
  return nodes.map(node => ({ ...node, position: saved[node.data.id] ? { ...saved[node.data.id] } : { x: point.get(node.data.id)!.x, y: point.get(node.data.id)!.y } }))
}
