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
  let activePath: string | null = null
  let activeJob: GraphJob | null = null
  let cancellationFailed = false
  const cancelActive = async () => {
    if (!activePath || !activeJob) return null
    const path = activePath
    let result: GraphJob
    cancellationFailed = false
    try { result = await api<GraphJob>(`${path}/cancel`, {}) }
    catch (reason) {
      cancellationFailed = true
      onProgress({ ...activeJob, processed: processed + activeJob.processed, total: items.length, errors: [...errors, ...activeJob.errors] })
      throw reason
    }
    activePath = null
    activeJob = null
    onActivePath(null)
    const cancelled = { ...result, processed: processed + result.processed, total: items.length, errors: [...errors, ...result.errors] }
    onProgress(cancelled)
    return cancelled
  }
  try {
    for (const [workspace, ids] of groups) {
      signal.throwIfAborted()
      // Creation must remain observable after cancellation: aborting this POST
      // cannot prove that the server did not create a job.
      let job = await api<GraphJob>(`/workspaces/${workspace}/graph/jobs`, { entry_ids: ids, confirmed: true })
      const path = `/workspaces/${workspace}/graph/jobs/${job.id}`
      activePath = path
      activeJob = job
      onActivePath(activePath)
      try {
        while (true) {
          if (signal.aborted) {
            const cancelled = await cancelActive()
            return cancelled ?? { ...job, status: 'cancelled', processed, total: items.length, current_file: null, errors }
          }
          onProgress({ ...job, processed: processed + job.processed, total: items.length, errors: [...errors, ...job.errors] })
          if (!['queued', 'running'].includes(job.status)) break
          await pause(signal)
          job = await api<GraphJob>(path, undefined, signal)
          activeJob = job
        }
      } catch (reason) {
        if (!signal.aborted) throw reason
        if (cancellationFailed) throw reason
        const cancelled = await cancelActive()
        return cancelled ?? { ...job, status: 'cancelled', processed, total: items.length, current_file: null, errors }
      }
      activePath = null
      activeJob = null
      onActivePath(null)
      errors.push(...job.errors); processed += job.processed
      if (job.status !== 'completed') return { ...job, processed, total: items.length, errors }
    }
    return { id: 'catalog-index', status: 'completed', processed, total: items.length, current_file: null, errors } as GraphJob
  } finally { onActivePath(activePath) }
}
