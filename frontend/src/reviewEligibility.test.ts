import { reviewEligibility } from './reviewEligibility'
import type { Edit, FileRecord, Suggestion } from './types'

it('counts only selected, usable suggestions or edits and honors explicit main-only edits', () => {
  const files = ['ordinary', 'candidate', 'edited', 'unselected', 'error', 'unread', 'unsupported'].map(id => ({ id, supported: id !== 'unsupported' })) as FileRecord[]
  const suggestion = { category: 'study', subcategory: 'notes', review_required: false } as Suggestion
  const suggestions = Object.fromEntries(['ordinary', 'candidate', 'edited', 'unselected', 'error', 'unsupported'].map(id => [id, { ...suggestion, review_required: id === 'candidate' }]))
  const edits = { edited: { category: 'study', subcategory: null } as Edit }
  const result = reviewEligibility(files, new Set(files.filter(file => file.id !== 'unselected').map(file => file.id)), suggestions, edits, { error: 'failed' })
  expect(result.eligible.map(file => file.id)).toEqual(['ordinary', 'candidate', 'edited'])
  expect(result.ordinary.map(file => file.id)).toEqual(['ordinary'])
  expect(result.candidates.map(file => file.id)).toEqual(['candidate'])
  expect(result.mainOnly.map(file => file.id)).toEqual(['edited'])
  expect(result.skipped).toBe(3)
})
