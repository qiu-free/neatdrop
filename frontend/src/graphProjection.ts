import { graphKindLabels, type GraphListing, type GraphSession } from './graphTypes'
import { categories, subcategories } from './types'

export interface GraphPosition { x: number; y: number }
export interface GraphTaxonomy { categories?: Record<string, string>; subcategories?: Record<string, Record<string, string>> }
export interface GraphNode { data: { id: string; label: string; type: 'root' | 'category' | 'subcategory' | 'file'; entry?: string; group?: string; category?: string; color?: string; count?: number; degree?: number; size?: number; tooltip?: string; focused?: boolean }; position: GraphPosition }
export interface GraphEdge { data: { id: string; source: string; target: string; kind: string; label?: string; status?: string; relation?: string; origin?: string; directed?: boolean; color?: string } }

const CATEGORY_COLORS = ['#728eae', '#bc9471', '#c08088', '#609e92', '#8b9d6d', '#b49d56', '#9b84ab', '#bb8c9f', '#a3907b', '#8c95a4']
const DEFAULT_GROUP_FILES = 8
const MAX_NODES = 200
function circlePoint(index: number, total: number, radius: number, center: GraphPosition) { const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(total, 1); return { x: Math.round(center.x + Math.cos(angle) * radius), y: Math.round(center.y + Math.sin(angle) * radius) } }
const directedKinds = new Set(['reference', 'attachment', 'version'])

/** A bounded, seeded spring layout. Saved positions act as anchors so selection/filter updates do not move dragged nodes. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], saved: Record<string, GraphPosition> = {}) {
  const positions = new Map(nodes.map(node => [node.data.id, { ...(saved[node.data.id] ?? node.position) }]))
  const anchored = new Set(Object.keys(saved))
  if (nodes.every(node => anchored.has(node.data.id))) return nodes.map(node => ({ ...node, position: { ...saved[node.data.id] } }))
  const edgePairs = edges.map(edge => [edge.data.source, edge.data.target] as const).filter(([source, target]) => positions.has(source) && positions.has(target))
  const radius = (node: GraphNode) => Math.max(12, node.data.size ?? 14) / 2 + 26
  for (let iteration = 0; iteration < 72; iteration++) {
    const forces = new Map(nodes.map(node => [node.data.id, { x: 0, y: 0 }]))
    for (let first = 0; first < nodes.length; first++) for (let second = first + 1; second < nodes.length; second++) {
      const a = nodes[first], b = nodes[second], pa = positions.get(a.data.id)!, pb = positions.get(b.data.id)!
      let dx = pb.x - pa.x, dy = pb.y - pa.y, distance = Math.hypot(dx, dy)
      if (distance < .01) { dx = (first + 1) * .73; dy = (second + 1) * .41; distance = Math.hypot(dx, dy) }
      const minDistance = radius(a) + radius(b), repulsion = Math.max(0, 6500 / (distance * distance)) + Math.max(0, minDistance - distance) * .18
      const fx = dx / distance * repulsion, fy = dy / distance * repulsion
      forces.get(a.data.id)!.x -= fx; forces.get(a.data.id)!.y -= fy; forces.get(b.data.id)!.x += fx; forces.get(b.data.id)!.y += fy
    }
    edgePairs.forEach(([source, target]) => {
      const a = positions.get(source)!, b = positions.get(target)!, dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(.1, Math.hypot(dx, dy)), desired = 112
      const force = (distance - desired) * .035, fx = dx / distance * force, fy = dy / distance * force
      forces.get(source)!.x += fx; forces.get(source)!.y += fy; forces.get(target)!.x -= fx; forces.get(target)!.y -= fy
    })
    nodes.forEach(node => {
      if (anchored.has(node.data.id)) return
      const force = forces.get(node.data.id)!, point = positions.get(node.data.id)!
      // A weak center force keeps disconnected groups within the same overview.
      force.x -= point.x * .012
      force.y -= point.y * .012
      point.x = Math.max(-900, Math.min(900, point.x + force.x * .7)); point.y = Math.max(-650, Math.min(650, point.y + force.y * .7))
    })
  }
  return nodes.map(node => ({ ...node, position: { x: Math.round(positions.get(node.data.id)!.x), y: Math.round(positions.get(node.data.id)!.y) } }))
}

export function projectGraph(listing: GraphListing, options: Partial<GraphSession> & { selected?: string; taxonomy?: GraphTaxonomy } = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const files = listing.items.filter(item => (!options.category || options.category === 'all' || item.category === options.category) && (!query || item.name.toLocaleLowerCase().includes(query))).sort((a, b) => a.id.localeCompare(b.id))
  const fileById = new Map(files.map(file => [file.id, file])), ids = new Set(files.map(file => file.id))
  const focus = options.focus && ids.has(options.focus) ? options.focus : null
  const relations = listing.relations.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (!options.kind || options.kind === 'all' || edge.kind === options.kind))
  const degree = new Map<string, number>(); relations.forEach(edge => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1) })
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], colors = new Map<string, string>()
  const taxonomyCategories: Record<string, string> = options.taxonomy?.categories ?? (categories as Record<string, string>)
  const taxonomySubcategories: Record<string, Record<string, string>> = options.taxonomy?.subcategories ?? (subcategories as Record<string, Record<string, string>>)
  const colorCategories = [...new Set([...Object.keys(categories), ...Object.keys(taxonomyCategories), ...files.map(file => file.category)])].sort()
  colorCategories.forEach((category, index) => colors.set(category, CATEGORY_COLORS[index % CATEGORY_COLORS.length]))
  const fileNode = (id: string, position: { x: number; y: number }): GraphNode => { const file = fileById.get(id)!; return { data: { id: `file:${id}`, label: file.name, tooltip: file.name, type: 'file', entry: id, group: `${file.category}/${file.subcategory ?? ''}`, category: file.category, color: colors.get(file.category), degree: degree.get(id) ?? 0, size: 8 + Math.min(4, (degree.get(id) ?? 0)), focused: id === focus }, position } }
  const categoryNode = (category: string, count: number, position: GraphPosition): GraphNode => ({ data: { id: `category:${category}`, label: taxonomyCategories[category] ?? category, type: 'category', group: category, category, color: colors.get(category), count, size: 13 }, position })
  const subcategoryNode = (category: string, subcategory: string, count: number, position: GraphPosition): GraphNode => ({ data: { id: `subcategory:${category}/${subcategory}`, label: taxonomySubcategories[category]?.[subcategory] ?? (subcategory || '未分子类'), type: 'subcategory', group: `${category}/${subcategory}`, category, color: colors.get(category), count, size: 10 }, position })
  if (options.view === 'relations' && focus) {
    const neighborIds = [...new Set(relations.filter(edge => edge.source === focus || edge.target === focus).map(edge => edge.source === focus ? edge.target : edge.source))].sort().slice(0, 20)
    nodes.push(fileNode(focus, { x: 0, y: 0 })); nodes[0].data.focused = true
    neighborIds.forEach((id, index) => nodes.push(fileNode(id, circlePoint(index, neighborIds.length, 240, { x: 0, y: 0 }))))
  } else {
    const grouped = new Map<string, typeof files>(); files.forEach(file => { const key = `${file.category}/${file.subcategory ?? ''}`; grouped.set(key, [...(grouped.get(key) ?? []), file]) })
    const categoryIds = [...new Set(files.map(file => file.category))].sort(), categoryCenters = new Map(categoryIds.map((category, index) => [category, circlePoint(index, categoryIds.length, categoryIds.length <= 2 ? 210 : 290, { x: 0, y: 0 })]))
    categoryIds.forEach(category => {
      const categoryFiles = files.filter(file => file.category === category), center = categoryCenters.get(category)!
      if (nodes.length < MAX_NODES) nodes.push(categoryNode(category, categoryFiles.length, center))
      if (options.expanded?.[category] === 0) return
      const groups = [...grouped.entries()].filter(([key]) => key.startsWith(`${category}/`)).sort(([a], [b]) => a.localeCompare(b))
      groups.forEach(([key, groupFiles], groupIndex) => {
        if (nodes.length >= MAX_NODES) return
        const subcategory = key.slice(category.length + 1), subCenter = circlePoint(groupIndex, groups.length, 105, center), subNode = subcategoryNode(category, subcategory, groupFiles.length, subCenter)
        nodes.push(subNode); edges.push({ data: { id: `category:${subNode.data.id}`, source: `category:${category}`, target: subNode.data.id, kind: 'category', label: '包含', color: colors.get(category) } })
        const requested = query ? groupFiles.length : options.expanded?.[key] ?? DEFAULT_GROUP_FILES, shown = options.expanded?.[key] === 0 ? [] : groupFiles.slice(0, requested), room = Math.max(0, MAX_NODES - nodes.length)
        shown.slice(0, room).forEach((file, index) => { const node = fileNode(file.id, circlePoint(index, Math.max(shown.length, 1), 88, subCenter)); nodes.push(node); edges.push({ data: { id: `category:file:${file.id}`, source: subNode.data.id, target: node.data.id, kind: 'category', label: '属于', color: colors.get(category) } }) })
      })
    })
  }
  const visible = new Set(nodes.map(node => node.data.id)); relations.forEach(edge => { if (visible.has(`file:${edge.source}`) && visible.has(`file:${edge.target}`)) edges.push({ data: { id: `relation:${edge.id}`, relation: edge.id, source: `file:${edge.source}`, target: `file:${edge.target}`, kind: edge.kind, label: graphKindLabels[edge.kind], status: edge.status, origin: edge.origin, directed: directedKinds.has(edge.kind), color: colors.get(fileById.get(edge.source)?.category ?? '') } }) })
  const visibleFiles = new Set(nodes.filter(node => node.data.type === 'file').map(node => node.data.entry))
  return { files, nodes, edges, relations, focus, categoryColors: Object.fromEntries(colors), hiddenFileCount: Math.max(0, files.length - visibleFiles.size), maxNodes: MAX_NODES }
}
