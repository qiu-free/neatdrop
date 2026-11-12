import { api, initSession } from './api'
afterEach(() => vi.unstubAllGlobals())
it('sends DELETE JSON with the existing session CSRF token', async () => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/session' ? { csrf: 'local-token' } : { items: [] } } as Response))
  vi.stubGlobal('fetch', fetcher)
  await initSession()
  await api('/workspaces/ws/graph/index', { revision: 9 }, undefined, 'DELETE')
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/workspaces/ws/graph/index', expect.objectContaining({ method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-NeatDrop-CSRF': 'local-token' }, body: '{"revision":9}' }))
})
