import { api, explain } from './api'
import type { Preview } from './types'

const waiting: { start: () => void }[] = []
let active = 0
let pumpScheduled = false

function pump() {
  while (active < 2 && waiting.length) waiting.shift()!.start()
}

function schedulePump() {
  if (pumpScheduled) return
  pumpScheduled = true
  // Complete the current cleanup batch before starting any more file requests.
  queueMicrotask(() => { pumpScheduled = false; pump() })
}

/** Shared local preview budget. Results stay with callers, never in this module. */
export function requestPreview(path: string, signal?: AbortSignal): Promise<Preview> {
  return new Promise((resolve, reject) => {
    let settled = false
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: Preview | undefined, error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      if (value !== undefined) resolve(value)
      else reject(error)
    }
    const task = {
      start: () => {
        if (settled) return
        active++
        void (async () => {
          try {
            const preview = await api<Preview>(path, undefined, signal)
            finish(preview)
          } catch (error) {
            if (settled) return
            if (signal?.aborted) finish(undefined, new DOMException('Preview request canceled', 'AbortError'))
            else if (error instanceof Error && error.message === explain('PARSER_BUSY') && retries < 2) {
              retries++
              retryTimer = setTimeout(() => {
                retryTimer = undefined
                if (settled) return
                waiting.push(task)
                pump()
              }, retries * 200)
            } else finish(undefined, error)
          } finally {
            // Public abort can precede fetch settlement. Keep that real call in
            // the budget until its promise actually settles.
            active--
            schedulePump()
          }
        })()
      },
    }
    function abort() {
      const index = waiting.indexOf(task)
      if (index !== -1) waiting.splice(index, 1)
      finish(undefined, new DOMException('Preview request canceled', 'AbortError'))
      schedulePump()
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    waiting.push(task)
    pump()
  })
}
