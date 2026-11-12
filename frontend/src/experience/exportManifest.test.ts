import { exportManifest } from './exportManifest'
import type { LibraryItem } from '../types'

const item = { name: ' =HYPERLINK("bad")', category: 'study', subcategory: 'notes', target: '体验资料库/笔记', source: 'private-original.md', id: 'id', text: 'must not export body' } as unknown as LibraryItem

it('exports only deliberate metadata with explicit memory semantics', () => {
  const result = JSON.parse(exportManifest([item], 'json'))
  expect(result.items[0]).toEqual({ name: item.name, category: 'study', subcategory: 'notes', target: item.target, runtime: 'browser-memory' })
  expect(JSON.stringify(result)).not.toMatch(/private-original|must not export/)
})

it('quotes CSV cells and prefixes spreadsheet formulas including leading whitespace', () => {
  const csv = exportManifest([item, { ...item, name: '@SUM(1)' }], 'csv')
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
  expect(csv).toContain('"\'@SUM(1)"')
})
