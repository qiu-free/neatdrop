import type { Edit, FileRecord, Filter, Suggestion } from './types'

export function visibleFiles(files: FileRecord[], suggestions: Record<string, Suggestion>, edits: Record<string, Edit>, selected: Set<string>, filter: Filter, query: string, errors: Record<string, string>, reviewed: ReadonlySet<string> = new Set()) {
  const search = query.trim().toLocaleLowerCase()
  return files.filter(file => {
    const suggestion = suggestions[file.id]
    const match = (file.name + (edits[file.id]?.name ?? suggestion?.name ?? '')).toLocaleLowerCase().includes(search)
    const matchesFilter = filter === 'all'
      || (filter === 'selected' && selected.has(file.id))
      || (filter === 'unreviewed' && Boolean(suggestion || edits[file.id]) && !reviewed.has(file.id))
      || (filter === 'review' && Boolean(suggestion?.review_required) && !reviewed.has(file.id))
      || (filter === 'failed' && Boolean(errors[file.id]))
    return match && matchesFilter
  })
}
