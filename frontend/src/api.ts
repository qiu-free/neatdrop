import { explain } from './apiMessages'
export { errorMessages, explain, bytes } from './apiMessages'

let csrf = ''
let sessionRequest: Promise<void> | null = null

export function initSession(): Promise<void> {
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch('/api/session')
      if (!response.ok) throw new Error('无法建立本地会话，请检查服务是否运行。')
      const data = await response.json()
      if (typeof data.csrf !== 'string' || !data.csrf || data.csrf.length > 256 || !/^[\x21-\x7e]+$/.test(data.csrf)) {
        throw new Error('本地会话响应异常。请刷新页面后重试。')
      }
      csrf = data.csrf
    })().finally(() => { sessionRequest = null })
  }
  return sessionRequest
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method?: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  const requestMethod = method ?? (body === undefined ? 'GET' : 'POST')
  const serializedBody = body === undefined ? undefined : JSON.stringify(body)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted()
    const sentToken = csrf
    const response = await fetch('/api/v1' + path, {
      method: requestMethod,
      headers: requestMethod === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-NeatDrop-CSRF': sentToken },
      body: serializedBody,
      signal,
    })
    if (response.ok) return response.json()
    const data = await response.json().catch(() => ({}))
    const code = typeof data.code === 'string' ? data.code : typeof data.detail === 'string' ? data.detail : 'REQUEST_FAILED'
    // LocalSecurity rejects this exact response before dispatching a handler.
    // Recover only that rejection, never an uncertain network/operation failure.
    if (attempt === 0 && requestMethod !== 'GET' && response.status === 403 && code === 'CSRF_REJECTED') {
      signal?.throwIfAborted()
      if (csrf === sentToken) await initSession()
      continue
    }
    throw new Error(explain(code))
  }
  throw new Error(explain('CSRF_REJECTED'))
}
