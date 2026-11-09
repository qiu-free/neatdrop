import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let api: typeof import('./api').api
let initSession: typeof import('./api').initSession
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(async () => {
  vi.resetModules()
  ;({ api, initSession } = await import('./api'))
})
afterEach(() => vi.unstubAllGlobals())

it('recovers a stale CSRF token once before opening the directory picker', async () => {
  let activeToken = 'first-window-token'
  let pickerOpens = 0
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/session') return json({ csrf: activeToken })
    if (new Headers(init?.headers).get('X-NeatDrop-CSRF') !== activeToken) return json({ code: 'CSRF_REJECTED' }, 403)
    pickerOpens += 1
    return json({ path: 'C:/synthetic-demo' })
  })
  vi.stubGlobal('fetch', fetcher)
  await initSession()
  activeToken = 'second-window-token'

  await expect(api('/pick-directory', {})).resolves.toEqual({ path: 'C:/synthetic-demo' })
  expect(pickerOpens).toBe(1)
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(2)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/pick-directory'))).toHaveLength(2)
})

it('deduplicates session refreshes when simultaneous requests used the same old token', async () => {
  let activeToken = 'old-token'
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/session') return json({ csrf: activeToken })
    return new Headers(init?.headers).get('X-NeatDrop-CSRF') === activeToken
      ? json({ accepted: true }) : json({ code: 'CSRF_REJECTED' }, 403)
  })
  vi.stubGlobal('fetch', fetcher)
  await initSession()
  activeToken = 'new-token'

  const results = await Promise.all([api('/pick-directory', {}), api('/workspaces', { path: 'C:/demo' })])
  expect(results).toEqual([{ accepted: true }, { accepted: true }])
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(2)
})

it('stops after one CSRF refresh and explains how to recover', async () => {
  const fetcher = vi.fn(async (url: string) => url === '/api/session' ? json({ csrf: 'token' }) : json({ code: 'CSRF_REJECTED' }, 403))
  vi.stubGlobal('fetch', fetcher)
  await initSession()
  await expect(api('/pick-directory', {})).rejects.toThrow(/会话.*刷新/)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/pick-directory'))).toHaveLength(2)
})

it.each(['ORIGIN_REJECTED', 'SESSION_REQUIRED', 'MODEL_TIMEOUT'])('does not replay %s responses', async code => {
  const fetcher = vi.fn(async () => json({ code }, code === 'MODEL_TIMEOUT' ? 504 : 403))
  vi.stubGlobal('fetch', fetcher)
  await expect(api('/analysis-jobs', { mode: 'cloud', cloud_consent: true })).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledOnce()
})

it('does not replay after a network failure', async () => {
  const fetcher = vi.fn(async () => { throw new TypeError('connection lost') })
  vi.stubGlobal('fetch', fetcher)
  await expect(api('/workspaces/w/execute', { confirmed: true })).rejects.toThrow('connection lost')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('honors cancellation while refreshing and never reopens the picker', async () => {
  const controller = new AbortController()
  let sessionCalls = 0
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/session') {
      sessionCalls += 1
      if (sessionCalls === 2) controller.abort()
      return json({ csrf: 'token' })
    }
    return json({ code: 'CSRF_REJECTED' }, 403)
  })
  vi.stubGlobal('fetch', fetcher)
  await initSession()
  await expect(api('/pick-directory', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/pick-directory'))).toHaveLength(1)
})
