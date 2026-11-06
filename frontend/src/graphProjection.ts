import { graphKindLabels, type GraphListing, type GraphSession } from './graphTypes'
import { categories, subcategories } from './types'

export interface GraphNode { data: { id: string; label: string; type: 'root' | 'category' | 'subcategory' | 'file'; entry?: string; group?: string; category?: string; color?: string; count?: number; degree?: number; size?: number; tooltip?: string; focused?: boolean }; position: { x: number; y: number } }
export interface GraphEdge { data: { id: string; source: string; target: string; kind: string; label?: string; status?: string; relation?: string } }

const CATEGORY_COLORS = ['#5ea8ff', '#f39a35', '#ed5c64', '#78c4bb', '#6dbb52', '#f5ce45', '#bd85b1', '#f69eaa', '#ac8a6f', '#b7b5c0']
const DEFAULT_GROUP_FILES = 8
const MAX_NODES = 200
function circlePoint(index: number, total: number, radius: number, center: { x: number; y: number }) { const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(total, 1); return { x: Math.round(center.x + Math.cos(angle) * radius), y: Math.round(center.y + Math.sin(angle) * radius) } }

export function projectGraph(listing: GraphListing, options: Partial<GraphSession> & { selected?: string } = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const files = listing.items.filter(item => (!options.category || options.category === 'all' || item.category === options.category) && (!query || item.name.toLocaleLowerCase().includes(query))).sort((a, b) => a.id.localeCompare(b.id))
  const fileById = new Map(files.map(file => [file.id, file])), ids = new Set(files.map(file => file.id))
  const focus = options.focus && ids.has(options.focus) ? options.focus : null
  const relations = listing.relations.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (!options.kind || options.kind === 'all' || edge.kind === options.kind))
  const degree = new Map<string, number>(); relations.forEach(edge => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1) })
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], colors = new Map<string, string>()
  ;[...new Set(files.map(file => file.category))].sort().forEach((category, index) => colors.set(category, CATEGORY_COLORS[index % CATEGORY_COLORS.length]))
  const fileNode = (id: string, position: { x: number; y: number }): GraphNode => { const file = fileById.get(id)!; return { data: { id: `file:${id}`, label: file.name, tooltip: file.name, type: 'file', entry: id, group: `${file.category}/${file.subcategory ?? ''}`, category: file.category, color: colors.get(file.category), degree: degree.get(id) ?? 0, size: 13 + Math.min(12, (degree.get(id) ?? 0) * 2), focused: id === focus }, position } }
  const categoryNode = (category: string, count: number, position: { x: number; y: number }): GraphNode => ({ data: { id: `category:${category}`, label: (categories as Record<string, string>)[category] ?? category, type: 'category', group: category, category, color: colors.get(category), count, size: 48 + Math.min(18, count) }, position })
  const subcategoryNode = (category: string, subcategory: string, count: number, position: { x: number; y: number }): GraphNode => ({ data: { id: `subcategory:${category}/${subcategory}`, label: (subcategories as Record<string, Record<string, string>>)[category]?.[subcategory] ?? (subcategory || '未分子类'), type: 'subcategory', group: `${category}/${subcategory}`, category, color: colors.get(category), count, size: 34 + Math.min(14, count) }, position })
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
        nodes.push(subNode); edges.push({ data: { id: `category:${subNode.data.id}`, source: `category:${category}`, target: subNode.data.id, kind: 'category', label: '包含' } })
        const requested = query ? groupFiles.length : options.expanded?.[key] ?? DEFAULT_GROUP_FILES, shown = options.expanded?.[key] === 0 ? [] : groupFiles.slice(0, requested), room = Math.max(0, MAX_NODES - nodes.length)
        shown.slice(0, room).forEach((file, index) => { const node = fileNode(file.id, circlePoint(index, Math.max(shown.length, 1), 88, subCenter)); nodes.push(node); edges.push({ data: { id: `category:file:${file.id}`, source: subNode.data.id, target: node.data.id, kind: 'category', label: '属于' } }) })
      })
    })
  }
  const visible = new Set(nodes.map(node => node.data.id)); relations.forEach(edge => { if (visible.has(`file:${edge.source}`) && visible.has(`file:${edge.target}`)) edges.push({ data: { id: `relation:${edge.id}`, relation: edge.id, source: `file:${edge.source}`, target: `file:${edge.target}`, kind: edge.kind, label: graphKindLabels[edge.kind], status: edge.status } }) })
  const visibleFiles = new Set(nodes.filter(node => node.data.type === 'file').map(node => node.data.entry))
  return { files, nodes, edges, relations, focus, hiddenFileCount: Math.max(0, files.length - visibleFiles.size), maxNodes: MAX_NODES }
}
