import { api, initSession } from './experienceApi'

it('starts a browser session without using a network service and refuses unknown routes', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be used'))
  await initSession()
  await expect(api('/unsupported-route')).rejects.toThrow('网页体验版不支持此操作')
  expect(network).not.toHaveBeenCalled()
  network.mockRestore()
})

it('rejects an already aborted request before any operation', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(api('/config', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
