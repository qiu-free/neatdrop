import { layoutGraph, projectGraph } from './graphProjection'
import type { LibraryItem } from './types'
import type { GraphListing, GraphSession } from './graphTypes'
const item = (id: string, category = 'study', subcategory: string | null = 'notes'): LibraryItem => ({ id, name: `笔记${id}.txt`, category: category as LibraryItem['category'], subcategory, transaction_id: 'tx', source: id, target: id, created: '', size: 10, availability: 'available' })
const listing = (items: LibraryItem[]): GraphListing => ({ items, relations: [], truncated: false, index: { count: 0, revision: 0, updated: null, state: 'empty', issues: [] } })
it('projects only file dots, keeping unrelated files visible without inventing category links', () => {
  const data = listing([item('one'), item('two')])
  const result = projectGraph(data)
  expect(result.nodes.map(node => node.data.id)).toEqual(['file:one', 'file:two'])
  expect(result.edges).toHaveLength(0)
  expect(result.nodes.filter(node => node.data.type === 'file')).toHaveLength(2)
  expect(result.nodes[0].data).toMatchObject({ category: 'study', group: 'study/notes' })
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
  const local = projectGraph(data, { view: 'relations', focus: '0' })
  expect(new Set(local.nodes.slice(1).map(node => Math.round(Math.hypot(node.position.x, node.position.y)))).size).toBeGreaterThan(3)
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

it('uses a finite branch layout with deterministic, separated positions', () => {
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

it('retains taxonomy grouping and category colors across filters without rendering hubs', () => {
  const data = listing([item('one', 'study'), item('two', 'finance')])
  const taxonomy = { categories: { study: '自定义研究', finance: '自定义财务' }, subcategories: { study: { notes: '自定义笔记' }, finance: { notes: '自定义账目' } } }
  const all = projectGraph(data, { taxonomy })
  const filtered = projectGraph(data, { category: 'finance', taxonomy })
  expect(all.nodes.every(node => node.data.type === 'file')).toBe(true)
  expect(filtered.nodes[0].data.group).toBe('finance/notes')
  expect(filtered.nodes[0].data.color).toBe(all.nodes.find(node => node.data.id === 'file:two')?.data.color)
  expect(filtered.categoryColors.finance).toBe(all.categoryColors.finance)
})

it('scatters files independent of category boundaries and keeps seeds stable through filtering', () => {
  const files = Array.from({ length: 12 }, (_, i) => item(`${i}`, i % 2 ? 'study' : 'finance'))
  const all = projectGraph(listing(files))
  const regrouped = projectGraph(listing(files.map(file => ({ ...file, category: 'office', subcategory: 'contract' }))), { expanded: { 'office/contract': 50 } })
  expect(regrouped.nodes.map(node => node.position)).toEqual(all.nodes.map(node => node.position))
  const filtered = projectGraph(listing(files), { query: '笔记1' })
  expect(filtered.nodes.map(node => node.position)).toEqual(all.nodes.filter(node => ['file:1', 'file:10', 'file:11'].includes(node.data.id)).map(node => node.position))
  expect(projectGraph(listing(files), { expanded: { finance: 0 } }).nodes.every(node => node.data.category !== 'finance')).toBe(true)
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
it('counts unique visible neighbors after relation filters and sizes hubs by degree', () => {
  const data = listing(['hub', 'a', 'b', 'c', 'leaf'].map(id => item(id)))
  data.relations = [
    ['r1', 'hub', 'a', 'confirmed'], ['r2', 'hub', 'a', 'confirmed'],
    ['r3', 'hub', 'b', 'suggested'], ['r4', 'hub', 'c', 'confirmed'],
    ['r5', 'leaf', 'a', 'confirmed'],
  ].map(([id, source, target, status]) => ({ id, source, target, status: status as 'confirmed' | 'suggested', kind: 'related', origin: 'manual', created: '' }))
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  expect(new Set(result.edges.map(edge => edge.data.relation))).toEqual(new Set(['r1', 'r2', 'r3', 'r4', 'r5']))
  expect(result.nodes.find(node => node.data.entry === 'hub')?.data.degree).toBe(3)
  expect(result.nodes.find(node => node.data.entry === 'hub')?.data.size).toBeGreaterThan(result.nodes.find(node => node.data.entry === 'leaf')!.data.size!)
  const filtered = projectGraph(data, { expanded: { 'study/notes': 50 }, visual: { showSuggested: false } as GraphSession['visual'] })
  expect(filtered.edges.map(edge => edge.data.relation)).toEqual(['r1', 'r2', 'r4', 'r5'])
  expect(filtered.nodes.find(node => node.data.entry === 'hub')?.data.degree).toBe(2)
})

it('hides isolates on canvas but retains the complete filtered file list and category label', () => {
  const data = listing([item('linked'), item('peer'), item('isolated')])
  data.relations = [{ id: 'r', source: 'linked', target: 'peer', kind: 'related', status: 'fact', origin: 'manual', created: '' }]
  const result = projectGraph(data, { expanded: { 'study/notes': 50 }, taxonomy: { categories: { study: '研究' } }, visual: { showIsolates: false } as GraphSession['visual'] })
  expect(result.files.map(file => file.id)).toEqual(['isolated', 'linked', 'peer'])
  expect(result.nodes.map(node => node.data.entry)).toEqual(['linked', 'peer'])
  expect(result.nodes[0].data.categoryLabel).toBe('研究')
  expect(result.hiddenFileCount).toBe(1)
})
it('does not let early isolates consume the canvas cap ahead of linked files', () => {
  const data = listing([...Array.from({ length: 200 }, (_, i) => item(`a-${`${i}`.padStart(3, '0')}`)), item('z-linked'), item('z-peer')])
  data.relations = [{ id: 'late', source: 'z-linked', target: 'z-peer', kind: 'related', status: 'confirmed', origin: 'manual', created: '' }]
  const result = projectGraph(data, { expanded: { 'study/notes': 1000 }, visual: { showIsolates: false } as GraphSession['visual'] })
  expect(result.files).toHaveLength(202)
  expect(result.relations.map(edge => edge.id)).toEqual(['late'])
  expect(result.nodes.map(node => node.data.entry)).toEqual(['z-linked', 'z-peer'])
  expect(result.edges.map(edge => edge.data.relation)).toEqual(['late'])
  expect(result.nodes.map(node => node.data.degree)).toEqual([1, 1])
  expect(result.hiddenFileCount).toBe(200)
})
it('refills the capped canvas when early candidate endpoints have no visible partner', () => {
  const data = listing([...Array.from({ length: 200 }, (_, i) => item(`a-${`${i}`.padStart(3, '0')}`)), item('z-center')])
  data.relations = data.items.slice(0, 200).map((file, i) => ({ id: `r${i}`, source: file.id, target: 'z-center', kind: 'related', status: 'fact', origin: 'manual', created: '' }))
  const result = projectGraph(data, { expanded: { 'study/notes': 1000 }, visual: { showIsolates: false } as GraphSession['visual'] })
  expect(result.nodes).toHaveLength(200)
  expect(result.nodes.some(node => node.data.entry === 'z-center')).toBe(true)
  expect(result.nodes.every(node => (node.data.degree ?? 0) > 0)).toBe(true)
  expect(result.edges).toHaveLength(199)
  expect(result.files).toHaveLength(201)
  expect(result.relations).toHaveLength(200)
})
it('excludes suggested-only neighbors from local focus when suggestions are hidden', () => {
  const data = listing([item('hub'), item('confirmed'), item('suggested')])
  data.relations = [
    { id: 'actual', source: 'hub', target: 'confirmed', kind: 'related', status: 'confirmed', origin: 'manual', created: '' },
    { id: 'candidate', source: 'hub', target: 'suggested', kind: 'related', status: 'suggested', origin: 'automatic', created: '' },
  ]
  const result = projectGraph(data, { view: 'relations', focus: 'hub', visual: { showSuggested: false } as GraphSession['visual'] })
  expect(result.nodes.map(node => node.data.entry)).toEqual(['hub', 'confirmed'])
  expect(result.relations.map(relation => relation.id)).toEqual(['actual', 'candidate'])
  expect(result.edges.map(edge => edge.data.relation)).toEqual(['actual'])
})
it('assigns logarithmic diameters from ordinary leaves through connected hubs and retains category colors', () => {
  const files = ['hub', ...Array.from({ length: 30 }, (_, i) => `leaf-${i}`)]
  const data = listing(files.map(id => item(id)))
  data.relations = files.slice(1).map((id, i) => ({ id: `r${i}`, source: 'hub', target: id, kind: 'related', status: 'fact', origin: 'manual', created: '' }))
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  const leaf = result.nodes.find(node => node.data.entry === 'leaf-0')!
  const hub = result.nodes.find(node => node.data.entry === 'hub')!
  expect(leaf.data.size).toBeGreaterThanOrEqual(7)
  expect(leaf.data.size).toBeLessThanOrEqual(9)
  expect(hub.data.degree).toBe(30)
  expect(hub.data.size).toBeGreaterThanOrEqual(16)
  expect(hub.data.size).toBeLessThanOrEqual(22)
  expect(hub.data.color).toBe(result.categoryColors.study)
})
