import { graphKindLabels, type GraphListing, type GraphSession } from './graphTypes'
import { categories } from './types'

export interface GraphPosition { x: number; y: number }
export interface GraphTaxonomy { categories?: Record<string, string>; subcategories?: Record<string, Record<string, string>> }
export interface GraphNode { data: { id: string; label: string; type: 'root' | 'category' | 'subcategory' | 'file'; entry?: string; group?: string; category?: string; categoryLabel?: string; color?: string; count?: number; degree?: number; size?: number; tooltip?: string; focused?: boolean }; position: GraphPosition }
export interface GraphEdge { data: { id: string; source: string; target: string; kind: string; label?: string; status?: string; relation?: string; origin?: string; directed?: boolean; color?: string } }

const CATEGORY_COLORS = ['#728eae', '#bc9471', '#c08088', '#609e92', '#8b9d6d', '#b49d56', '#9b84ab', '#bb8c9f', '#a3907b', '#8c95a4']
const DEFAULT_GROUP_FILES = 8
const MAX_NODES = 200
function scatterPoint(index: number, total: number): GraphPosition {
  // A full-library golden-angle seed interleaves categories and survives filtering.
  const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = Math.sqrt((index + .5) / Math.max(1, total)) * Math.max(200, Math.min(520, Math.sqrt(total) * 80))
  return { x: Math.round(Math.cos(angle) * radius * 1.25), y: Math.round(Math.sin(angle) * radius) }
}
const directedKinds = new Set(['reference', 'attachment', 'version'])

export { layoutGraph } from './graphLayout'

export function projectGraph(listing: GraphListing, options: Partial<GraphSession> & { selected?: string; taxonomy?: GraphTaxonomy } = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const files = listing.items.filter(item => (!options.category || options.category === 'all' || item.category === options.category) && (!query || item.name.toLocaleLowerCase().includes(query))).sort((a, b) => a.id.localeCompare(b.id))
  const fileById = new Map(files.map(file => [file.id, file])), ids = new Set(files.map(file => file.id))
  const focus = options.focus && ids.has(options.focus) ? options.focus : null
  const relations = listing.relations.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (!options.kind || options.kind === 'all' || edge.kind === options.kind))
  const permittedRelations = options.visual?.showSuggested === false ? relations.filter(edge => edge.status !== 'suggested') : relations
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], colors = new Map<string, string>()
  const taxonomyCategories: Record<string, string> = options.taxonomy?.categories ?? (categories as Record<string, string>)
  const colorCategories = [...new Set([...Object.keys(categories), ...Object.keys(taxonomyCategories), ...files.map(file => file.category)])].sort()
  colorCategories.forEach((category, index) => colors.set(category, CATEGORY_COLORS[index % CATEGORY_COLORS.length]))
  const universe = [...listing.items].sort((a, b) => a.id.localeCompare(b.id))
  const seeds = new Map(universe.map((file, index) => [file.id, scatterPoint(index, universe.length)]))
  const fileNode = (id: string, position: GraphPosition): GraphNode => { const file = fileById.get(id)!; return { data: { id: `file:${id}`, label: file.name, tooltip: file.name, type: 'file', entry: id, group: `${file.category}/${file.subcategory ?? ''}`, category: file.category, categoryLabel: taxonomyCategories[file.category] ?? file.category, color: colors.get(file.category), degree: 0, size: 8, focused: id === focus }, position } }
  if (options.view === 'relations' && focus) {
    const neighborIds = [...new Set(relations.filter(edge => (options.visual?.showSuggested !== false || edge.status !== 'suggested') && (edge.source === focus || edge.target === focus)).map(edge => edge.source === focus ? edge.target : edge.source))].sort().slice(0, 20)
    nodes.push(fileNode(focus, { x: 0, y: 0 })); nodes[0].data.focused = true
    neighborIds.forEach((id, index) => nodes.push(fileNode(id, scatterPoint(index, neighborIds.length))))
  } else {
    const shownPerGroup = new Map<string, number>()
    const groupKey = (id: string) => { const file = fileById.get(id)!; return `${file.category}/${file.subcategory ?? ''}` }
    const allowed = (id: string) => {
      const file = fileById.get(id)!, key = groupKey(id)
      return options.expanded?.[file.category] !== 0 && options.expanded?.[key] !== 0
    }
    const requested = (key: string) => query ? files.length : options.expanded?.[key] ?? DEFAULT_GROUP_FILES
    if (options.visual?.showIsolates === false) {
      const selected = new Set<string>()
      const canonical = permittedRelations.filter(edge => edge.source !== edge.target).map(edge => {
        const [first, second] = [edge.source, edge.target].sort()
        return { first, second }
      }).sort((a, b) => a.first.localeCompare(b.first) || a.second.localeCompare(b.second))
      canonical.forEach(({ first, second }) => {
        if (!allowed(first) || !allowed(second)) return
        const additions = [first, second].filter(id => !selected.has(id))
        if (selected.size + additions.length > MAX_NODES) return
        const needed = new Map<string, number>()
        additions.forEach(id => { const key = groupKey(id); needed.set(key, (needed.get(key) ?? 0) + 1) })
        if ([...needed].some(([key, count]) => (shownPerGroup.get(key) ?? 0) + count > requested(key))) return
        additions.forEach(id => selected.add(id))
        needed.forEach((count, key) => shownPerGroup.set(key, (shownPerGroup.get(key) ?? 0) + count))
      })
      files.filter(file => selected.has(file.id)).forEach(file => nodes.push(fileNode(file.id, seeds.get(file.id)!)))
    } else files.forEach(file => {
      const key = groupKey(file.id), shown = shownPerGroup.get(key) ?? 0
      if (!allowed(file.id) || nodes.length >= MAX_NODES || shown >= requested(key)) return
      nodes.push(fileNode(file.id, seeds.get(file.id)!)); shownPerGroup.set(key, shown + 1)
    })
  }
  const visible = new Set(nodes.map(node => node.data.id)); permittedRelations.forEach(edge => { if (visible.has(`file:${edge.source}`) && visible.has(`file:${edge.target}`)) edges.push({ data: { id: `relation:${edge.id}`, relation: edge.id, source: `file:${edge.source}`, target: `file:${edge.target}`, kind: edge.kind, label: graphKindLabels[edge.kind], status: edge.status, origin: edge.origin, directed: directedKinds.has(edge.kind), color: colors.get(fileById.get(edge.source)?.category ?? '') } }) })
  const neighbors = new Map(nodes.map(node => [node.data.id, new Set<string>()]))
  edges.forEach(edge => { if (edge.data.source !== edge.data.target) { neighbors.get(edge.data.source)?.add(edge.data.target); neighbors.get(edge.data.target)?.add(edge.data.source) } })
  nodes.forEach(node => { node.data.degree = neighbors.get(node.data.id)?.size ?? 0; node.data.size = Math.min(22, 7 + 2 * Math.log2(1 + node.data.degree)) })
  if (options.visual?.showIsolates === false) {
    for (let index = nodes.length - 1; index >= 0; index--) if (!nodes[index].data.degree) nodes.splice(index, 1)
  }
  const visibleFiles = new Set(nodes.filter(node => node.data.type === 'file').map(node => node.data.entry))
  return { files, nodes, edges, relations, focus, categoryColors: Object.fromEntries(colors), hiddenFileCount: Math.max(0, files.length - visibleFiles.size), maxNodes: MAX_NODES }
}
