import { graphKindLabels, type GraphListing, type GraphSession } from './graphTypes'
import { categories, subcategories } from './types'
export interface GraphNode { data: { id: string; label: string; type: 'root' | 'category' | 'subcategory' | 'file'; entry?: string; group?: string; focused?: boolean }; position: { x: number; y: number } }
export interface GraphEdge { data: { id: string; source: string; target: string; kind: string; label?: string; status?: string; relation?: string } }
export function projectGraph(listing: GraphListing, options: Partial<GraphSession> & { selected?: string } = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const files = listing.items.filter(item => (!options.category || options.category === 'all' || item.category === options.category) && (!query || item.name.toLocaleLowerCase().includes(query))).sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(files.map(file => file.id))
  const focus = options.focus && ids.has(options.focus) ? options.focus : null
  const relations = listing.relations.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (!options.kind || options.kind === 'all' || edge.kind === options.kind))
  const nodes: GraphNode[] = [], edges: GraphEdge[] = []
  const fileNode = (id: string, x: number, y: number): GraphNode => ({ data: { id: `file:${id}`, label: files.find(file => file.id === id)!.name, type: 'file', entry: id }, position: { x, y } })
  if (options.view === 'relations' && focus) {
    nodes.push(fileNode(focus, 0, 0))
    nodes[0].data.focused = true
    const neighbors = [...new Set(relations.filter(edge => edge.source === focus || edge.target === focus).map(edge => edge.source === focus ? edge.target : edge.source))].sort().slice(0, 20)
    neighbors.forEach((id, i) => nodes.push(fileNode(id, Math.cos(i * Math.PI * 2 / neighbors.length) * 360, Math.sin(i * Math.PI * 2 / neighbors.length) * 280)))
  } else {
    nodes.push({ data: { id: 'root', label: '归档资料', type: 'root' }, position: { x: 0, y: 0 } })
    let row = 0
    for (const category of [...new Set(files.map(file => file.category))].sort()) {
      if (nodes.length >= 200) break
      const categoryId = `category:${category}`
      nodes.push({ data: { id: categoryId, label: categories[category] ?? category, type: 'category', group: category }, position: { x: 200, y: row * 100 } })
      edges.push({ data: { id: `tree:${categoryId}`, source: 'root', target: categoryId, kind: 'tree' } })
      const categoryExpanded = options.expanded?.[category] ?? 1
      if (categoryExpanded === 0) { row += 1; continue }
      for (const subcategory of [...new Set(files.filter(file => file.category === category).map(file => file.subcategory ?? ''))].sort()) {
        if (nodes.length >= 200) break
        const group = `${category}/${subcategory}`, subId = `subcategory:${group}`
        nodes.push({ data: { id: subId, label: subcategories[category]?.[subcategory] ?? (subcategory || '未分子类'), type: 'subcategory', group }, position: { x: 400, y: row * 100 } })
        edges.push({ data: { id: `tree:${subId}`, source: categoryId, target: subId, kind: 'tree' } })
        const groupFiles = files.filter(file => file.category === category && (file.subcategory ?? '') === subcategory)
        const count = query ? groupFiles.length : options.expanded?.[group] ?? 0
        const shown = groupFiles.slice(0, Math.min(count, 200 - nodes.length))
        shown.forEach((file, i) => { nodes.push(fileNode(file.id, 600, (row + i) * 100)); edges.push({ data: { id: `tree:file:${file.id}`, source: subId, target: `file:${file.id}`, kind: 'tree' } }) })
        row += Math.max(1, shown.length)
      }
    }
  }
  const visible = new Set(nodes.map(node => node.data.id))
  relations.forEach(edge => { if (visible.has(`file:${edge.source}`) && visible.has(`file:${edge.target}`)) edges.push({ data: { id: `relation:${edge.id}`, relation: edge.id, source: `file:${edge.source}`, target: `file:${edge.target}`, kind: edge.kind, label: graphKindLabels[edge.kind], status: edge.status } }) })
  return { files, nodes, edges, relations, focus }
}
