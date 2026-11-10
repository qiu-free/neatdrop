import type { Edit, FileRecord, Suggestion } from './types'

export function reviewEligibility(files: FileRecord[], selected: Set<string>, suggestions: Record<string, Suggestion>, edits: Record<string, Edit>, errors: Record<string, string>) {
  const eligible = files.filter(file => selected.has(file.id) && file.supported && !errors[file.id] && (suggestions[file.id] || edits[file.id]))
  const ordinary = eligible.filter(file => suggestions[file.id] && !suggestions[file.id].review_required && !edits[file.id])
  const candidates = eligible.filter(file => !edits[file.id] && suggestions[file.id]?.review_required && suggestions[file.id]?.decision_level !== 'abstain')
  const mainOnly = eligible.filter(file => {
    const value = edits[file.id] ?? suggestions[file.id]
    return value.subcategory == null || value.category === 'other'
  })
  return { eligible, ordinary, candidates, mainOnly, skipped: selected.size - eligible.length }
}
