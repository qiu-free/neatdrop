import { runTextTask } from './workerClient'

afterEach(() => vi.unstubAllGlobals())

it('terminates a worker aborted during construction without posting work', async () => {
  const controller = new AbortController(), terminate = vi.fn(), postMessage = vi.fn()
  class FakeWorker {
    terminate = terminate
    postMessage = postMessage
    constructor() { controller.abort() }
  }
  vi.stubGlobal('Worker', FakeWorker)
  const pending = runTextTask('classify', { id: 'x', name: 'x.md', text: '正文' }, controller.signal)
  const result = await Promise.race([pending.then(() => 'resolved', error => error.name), new Promise(resolve => setTimeout(() => resolve('hung'), 30))])
  expect(result).toBe('AbortError')
  expect(terminate).toHaveBeenCalledOnce()
  expect(postMessage).not.toHaveBeenCalled()
})
