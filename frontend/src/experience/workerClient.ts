import type { Suggestion } from '../types'
import type { GraphRelation } from '../graphTypes'
import type { TextRecord } from './textRelations'

let nextId = 0
export function runTextTask(task: 'classify', payload: { id: string; name: string; text: string }, signal?: AbortSignal): Promise<Suggestion>
export function runTextTask(task: 'relations', payload: TextRecord[], signal?: AbortSignal): Promise<GraphRelation[]>
export async function runTextTask(task: 'classify' | 'relations', payload: { id: string; name: string; text: string } | TextRecord[], signal?: AbortSignal): Promise<Suggestion | GraphRelation[]> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') {
    // jsdom does not implement Workers; production browsers use the worker below.
    if (task === 'classify') { const { classifyText } = await import('./textClassifier'); const input = payload as { id: string; name: string; text: string }; signal?.throwIfAborted(); return classifyText(input.id, input.name, input.text) }
    const { matchTexts } = await import('./textRelations'); signal?.throwIfAborted(); return matchTexts(payload as TextRecord[])
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./classify.worker.ts', import.meta.url), { type: 'module' }), id = ++nextId
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); clearTimeout(timer) }
    const abort = () => { cleanup(); reject(new DOMException('已取消文本计算', 'AbortError')) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('浏览器文本计算超时。')) }, 10000)
    worker.onmessage = event => { if (event.data.id !== id) return; cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result) }
    worker.onerror = () => { cleanup(); reject(new Error('无法启动浏览器文本计算。')) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    worker.postMessage({ id, task, payload })
  })
}
