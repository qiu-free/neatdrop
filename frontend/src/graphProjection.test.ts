import { layoutGraph, projectGraph } from './graphProjection'
import type { LibraryItem } from './types'
import type { GraphListing } from './graphTypes'
const item = (id: string, category = 'study', subcategory: string | null = 'notes'): LibraryItem => ({ id, name: `笔记${id}.txt`, category: category as LibraryItem['category'], subcategory, transaction_id: 'tx', source: id, target: id, created: '', size: 10, availability: 'available' })
const listing = (items: LibraryItem[]): GraphListing => ({ items, relations: [], truncated: false, index: { count: 0, revision: 0, updated: null, state: 'empty', issues: [] } })
it('projects a rootless clustered network with immediately visible files and deterministic positions', () => {
  const data = listing([item('one'), item('two')])
  const result = projectGraph(data)
  expect(result.nodes.map(node => node.data.id)).toEqual(expect.arrayContaining(['category:study', 'subcategory:study/notes', 'file:one', 'file:two']))
  expect(result.nodes.some(node => node.data.type === 'root')).toBe(false)
  expect(result.nodes.filter(node => node.data.type === 'file')).toHaveLength(2)
  expect(result.nodes.find(node => node.data.id === 'category:study')?.data).toMatchObject({ category: 'study', color: expect.any(String), count: 2 })
  expect(result.nodes.find(node => node.data.id === 'file:one')?.data.size).toBeGreaterThan(0)
  expect(result.nodes.every(node => (node.data.size ?? 0) <= 16)).toBe(true)
  expect(projectGraph({ ...data, items: [...data.items].reverse() }).nodes).toEqual(result.nodes)
})
it('keeps all search results outside the canvas limit and expands only 50 files per step', () => {
  const data = listing(Array.from({ length: 1000 }, (_, i) => item(`${i}`)))
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  expect(result.nodes.filter(node => node.data.type === 'file')).toHaveLength(50)
  expect(result.files).toHaveLength(1000)
  expect(result.nodes.length).toBeLessThanOrEqual(200)
  expect(projectGraph(data, { expanded: { 'study/notes': 1000 } }).nodes.length).toBeLessThanOrEqual(200)
  expect(projectGraph(data, { expanded: { 'study/notes': 1000 } }).hiddenFileCount).toBeGreaterThan(0)
  const search = projectGraph(data, { query: '笔记99', expanded: {} })
  expect(search.files).toHaveLength(11)
  expect(search.nodes.filter(node => node.data.type === 'file')).toHaveLength(11)
})
it('shows up to eight files per group by default and supports explicit group collapse', () => {
  const data = listing(Array.from({ length: 10 }, (_, i) => item(`${i}`)))
  expect(projectGraph(data).nodes.filter(node => node.data.type === 'file')).toHaveLength(8)
  expect(projectGraph(data, { expanded: { 'study/notes': 0 } }).nodes.filter(node => node.data.type === 'file')).toHaveLength(0)
  expect(projectGraph(data, { expanded: { 'study/notes': 50 } }).nodes.filter(node => node.data.type === 'file')).toHaveLength(10)
})
it('caps related view to 20 neighbors, keeps focused file and applies relation filters', () => {
  const data = listing(Array.from({ length: 30 }, (_, i) => item(`${i}`)))
  data.relations = data.items.slice(1).map((file, i) => ({ id: `r${i}`, source: '0', target: file.id, kind: i ? 'related' : 'reference', status: 'confirmed', origin: 'manual', created: '' }))
  expect(projectGraph(data, { view: 'relations', focus: '0' }).nodes).toHaveLength(21)
  expect(projectGraph(data, { view: 'relations', focus: '0', kind: 'reference' }).edges).toHaveLength(1)
})
it('keeps positions stable when selection changes and exits hidden focus', () => {
  const data = listing([item('one'), item('two', 'finance')])
  const options = { expanded: { 'study/notes': 50 } }
  expect(projectGraph(data, { ...options, selected: 'one' }).nodes).toEqual(projectGraph(data, { ...options, selected: 'two' }).nodes)
  expect(projectGraph(data, { view: 'relations', focus: 'one', category: 'finance' }).focus).toBeNull()
})

it('keeps meaningful cross-category relations only when both file nodes are visible', () => {
  const data = listing([item('one', 'study'), item('two', 'finance')])
  data.relations = [{ id: 'r1', source: 'one', target: 'two', kind: 'related', status: 'confirmed', origin: 'manual', created: '' }]
  const result = projectGraph(data)
  expect(result.edges).toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ id: 'relation:r1', source: 'file:one', target: 'file:two', kind: 'related' }) })]))
})

it('projects a 1000-record archive within the 200-node bound', () => {
  const data = listing(Array.from({ length: 1000 }, (_, i) => item(`${i}`, i % 2 ? 'study' : 'finance')))
  const started = performance.now()
  const result = projectGraph(data, { expanded: { 'study/notes': 1000, 'finance/notes': 1000 } })
  const elapsed = performance.now() - started
  expect(result.nodes.length).toBeLessThanOrEqual(200)
  expect(result.files).toHaveLength(1000)
  expect(result.hiddenFileCount).toBeGreaterThan(0)
  expect(elapsed).toBeLessThan(1000)
})

it('uses a finite force layout with deterministic, separated positions', () => {
  const data = listing(Array.from({ length: 12 }, (_, i) => item(`${i}`)))
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  const laidOut = layoutGraph(result.nodes, result.edges)
  expect(laidOut).toEqual(layoutGraph(result.nodes, result.edges))
  expect(laidOut.some((node, index) => node.position.x !== result.nodes[index].position.x || node.position.y !== result.nodes[index].position.y)).toBe(true)
  const filePositions = laidOut.filter(node => node.data.type === 'file').map(node => node.position)
  for (let index = 0; index < filePositions.length; index++) for (let other = index + 1; other < filePositions.length; other++) {
    const dx = filePositions[index].x - filePositions[other].x, dy = filePositions[index].y - filePositions[other].y
    expect(Math.hypot(dx, dy)).toBeGreaterThan(8)
  }
})

it('uses runtime taxonomy labels and keeps category colors stable across filters', () => {
  const data = listing([item('one', 'study'), item('two', 'finance')])
  const taxonomy = { categories: { study: '自定义研究', finance: '自定义财务' }, subcategories: { study: { notes: '自定义笔记' }, finance: { notes: '自定义账目' } } }
  const all = projectGraph(data, { taxonomy })
  const filtered = projectGraph(data, { category: 'finance', taxonomy })
  expect(all.nodes.find(node => node.data.id === 'category:study')?.data.label).toBe('自定义研究')
  expect(all.nodes.find(node => node.data.id === 'subcategory:study/notes')?.data.label).toBe('自定义笔记')
  expect(filtered.nodes.find(node => node.data.id === 'category:finance')?.data.color).toBe(all.nodes.find(node => node.data.id === 'category:finance')?.data.color)
  expect(filtered.categoryColors.finance).toBe(all.categoryColors.finance)
})

it('preserves relation origin and directional metadata for evidence styling', () => {
  const data = listing([item('one'), item('two')])
  data.relations = [
    { id: 'r1', source: 'one', target: 'two', kind: 'reference', status: 'confirmed', origin: 'manual', created: '' },
    { id: 'r2', source: 'two', target: 'one', kind: 'duplicate', status: 'fact', origin: 'archive', created: '' },
  ]
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  expect(result.edges.find(edge => edge.data.relation === 'r1')?.data).toMatchObject({ origin: 'manual', directed: true })
  expect(result.edges.find(edge => edge.data.relation === 'r2')?.data).toMatchObject({ origin: 'archive', directed: false })
})
