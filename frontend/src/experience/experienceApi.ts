export { explain, bytes, errorMessages } from '../apiMessages'
import { experienceEngine } from './engine'

type Handler = (path: string, body: unknown, signal: AbortSignal | undefined, method: 'GET' | 'POST' | 'DELETE') => unknown | Promise<unknown>
let handler: Handler = experienceEngine.handle
export function installExperienceHandler(next: Handler) { handler = next }
export async function initSession(): Promise<void> { /* Browser memory needs no HTTP session. */ }
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method?: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  signal?.throwIfAborted()
  const result = await handler(path, body, signal, method ?? (body === undefined ? 'GET' : 'POST'))
  signal?.throwIfAborted()
  return structuredClone(result) as T
}
