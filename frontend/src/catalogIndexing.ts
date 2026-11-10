import { api } from './api'
import type { LibraryItem } from './types'
import type { GraphJob } from './graphTypes'

const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const done = () => { signal.removeEventListener('abort', abort); resolve() }
  const timer = setTimeout(done, 400)
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('已取消', 'AbortError')) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
})

/** Extract only explicitly selected authorized entries through the existing per-root job. */
export async function indexCatalog(items: LibraryItem[], signal: AbortSignal, onProgress: (job: GraphJob) => void, onActivePath: (path: string | null) => void) {
  const groups = new Map<string, string[]>()
  for (const item of items) {
    if (!item.workspace_id || !item.original_entry_id) throw new Error('资料集合授权已失效，请刷新并重新授权。')
    groups.set(item.workspace_id, [...groups.get(item.workspace_id) ?? [], item.original_entry_id])
  }
  let processed = 0
  const errors: GraphJob['errors'] = []
  try {
    for (const [workspace, ids] of groups) {
      signal.throwIfAborted()
      let job = await api<GraphJob>(`/workspaces/${workspace}/graph/jobs`, { entry_ids: ids, confirmed: true }, signal)
      const path = `/workspaces/${workspace}/graph/jobs/${job.id}`
      onActivePath(path)
      while (true) {
        signal.throwIfAborted()
        onProgress({ ...job, processed: processed + job.processed, total: items.length, errors: [...errors, ...job.errors] })
        if (!['queued', 'running'].includes(job.status)) break
        await pause(signal)
        job = await api<GraphJob>(path, undefined, signal)
      }
      errors.push(...job.errors); processed += job.processed
      if (job.status !== 'completed') return { ...job, processed, total: items.length, errors }
    }
    return { id: 'catalog-index', status: 'completed', processed, total: items.length, current_file: null, errors } as GraphJob
  } finally { onActivePath(null) }
}
