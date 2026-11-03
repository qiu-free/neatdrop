import { visibleFiles } from './fileSelection'
import type { FileRecord, Suggestion } from './types'

const files: FileRecord[] = ['first.md', 'second.md'].map((name, i) => ({ id: String(i), name, size: 1, modified: 1, extension: '.md', sha256: '', supported: true, reason: '' }))
it('search hides the old active row and exposes the matching file to detail selection', () => {
  const rows = visibleFiles(files, {}, {}, new Set(), 'all', 'second', {})
  expect(rows.map(f => f.id)).toEqual(['1'])
})
it('checked filter excludes the previous file after it is unchecked', () => {
  const rows = visibleFiles(files, {}, {}, new Set(['1']), 'selected', '', {})
  expect(rows.map(f => f.id)).toEqual(['1'])
})

it('keeps unreviewed, review and failed filters distinct', () => {
  const suggestions: Record<string, Suggestion> = {
    '0': { file_id: '0', name: 'first.md', category: 'study', evidence: '', review_required: false, provider: 'local_rules', sample: '' },
    '1': { file_id: '1', name: 'second.md', category: 'other', evidence: '', review_required: true, provider: 'local_rules', sample: '' },
  }
  expect(visibleFiles(files, suggestions, {}, new Set(), 'unreviewed', '', {}, new Set(['1'])).map(f => f.id)).toEqual(['0'])
  expect(visibleFiles(files, suggestions, {}, new Set(), 'review', '', { '0': 'READ_FAILED' }).map(f => f.id)).toEqual(['1'])
  expect(visibleFiles(files, suggestions, {}, new Set(), 'review', '', {}, new Set(['1']))).toEqual([])
  expect(visibleFiles(files, suggestions, {}, new Set(), 'failed', '', { '0': 'READ_FAILED' }).map(f => f.id)).toEqual(['0'])
})
