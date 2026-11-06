import { projectGraph } from './graphProjection'
import type { LibraryItem } from './types'
import type { GraphListing } from './graphTypes'
const item = (id: string, category = 'study', subcategory: string | null = 'notes'): LibraryItem => ({ id, name: `笔记${id}.txt`, category: category as LibraryItem['category'], subcategory, transaction_id: 'tx', source: id, target: id, created: '', size: 10, availability: 'available' })
const listing = (items: LibraryItem[]): GraphListing => ({ items, relations: [], truncated: false, index: { count: 0, revision: 0, updated: null, state: 'empty', issues: [] } })
it('creates unambiguous root, category, subcategory and file nodes with deterministic positions', () => {
  const data = listing([item('one'), item('two')])
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  expect(result.nodes.map(node => node.data.id)).toEqual(['root', 'category:study', 'subcategory:study/notes', 'file:one', 'file:two'])
  expect(result.nodes.find(node => node.data.id === 'file:one')?.position).toEqual({ x: 600, y: 0 })
  expect(projectGraph({ ...data, items: [...data.items].reverse() }, { expanded: { 'study/notes': 50 } }).nodes).toEqual(result.nodes)
})
it('keeps all search results outside the canvas limit and expands only 50 files per step', () => {
  const data = listing(Array.from({ length: 1000 }, (_, i) => item(`${i}`)))
  const result = projectGraph(data, { expanded: { 'study/notes': 50 } })
  expect(result.nodes.filter(node => node.data.type === 'file')).toHaveLength(50)
  expect(result.files).toHaveLength(1000)
  expect(projectGraph(data, { expanded: { 'study/notes': 1000 } }).nodes.length).toBeLessThanOrEqual(200)
  const search = projectGraph(data, { query: '笔记99', expanded: {} })
  expect(search.files).toHaveLength(11)
  expect(search.nodes.filter(node => node.data.type === 'file')).toHaveLength(11)
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
