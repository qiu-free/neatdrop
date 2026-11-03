import { act, render, screen } from '@testing-library/react'
import { api, explain } from './api'
import { requestPreview } from './previewRequests'
import { FileGrid } from './components/FileGrid'
import type { FileRecord, Preview } from './types'

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: vi.fn() }))

const preview: Preview = { image: 'data:image/png;base64,AAAA', sample: 'image' }
const file: FileRecord = { id: 'a', name: '第一.png', extension: '.png', size: 100, modified: 1, supported: true, reason: '', sha256: 'hash' }
function deferred() {
  let resolve!: (value: Preview) => void
  const promise = new Promise<Preview>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.stubGlobal('IntersectionObserver', undefined)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('shares a two-call budget between grid thumbnails and a third preview consumer', async () => {
  const first = deferred(), second = deferred(), third = deferred()
  vi.mocked(api).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  render(<FileGrid workspaceId="w" files={[file, { ...file, id: 'b', name: '第二.png' }]} suggestions={{}} edits={{}} selected={new Set()} activeId={null} reviewed={new Set()} errors={{}} onSelect={() => undefined} onActive={() => undefined} />)
  const detail = requestPreview('/workspaces/w/files/detail/preview')
  const requestsBeforeRelease = vi.mocked(api).mock.calls.length
  await act(async () => { first.resolve(preview) })
  const startedDetail = vi.mocked(api).mock.calls.some(([path]) => path === '/workspaces/w/files/detail/preview')
  await act(async () => { second.resolve(preview); third.resolve(preview); await detail })
  expect(requestsBeforeRelease).toBe(2)
  expect(startedDetail).toBe(true)
  expect(screen.getAllByRole('img')).toHaveLength(2)
})

it('removes an aborted waiting request without ever calling its API', async () => {
  const first = deferred(), second = deferred()
  vi.mocked(api).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(preview)
  const a = requestPreview('/a'), b = requestPreview('/b')
  const controller = new AbortController()
  const canceled = requestPreview('/canceled', controller.signal).catch(error => error as Error)
  controller.abort()
  const next = requestPreview('/next')
  first.resolve(preview); second.resolve(preview)
  await Promise.all([a, b, next])
  expect(await canceled).toHaveProperty('name', 'AbortError')
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(['/a', '/b', '/next'])
})

it('retains an aborted active call in the budget until the actual API settles', async () => {
  const first = deferred(), second = deferred(), third = deferred()
  vi.mocked(api).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  const controller = new AbortController()
  const canceled = requestPreview('/old', controller.signal).catch(error => error as Error)
  const b = requestPreview('/b'), c = requestPreview('/c')
  controller.abort()
  const callsAfterAbort = vi.mocked(api).mock.calls.length
  first.resolve(preview)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  const callsAfterActualSettlement = vi.mocked(api).mock.calls.length
  second.resolve(preview); third.resolve(preview)
  await Promise.all([b, c])
  expect(await canceled).toHaveProperty('name', 'AbortError')
  expect(callsAfterAbort).toBe(2)
  expect(callsAfterActualSettlement).toBe(3)
})

it('retries a parser-busy response twice with a short delay before returning a preview', async () => {
  vi.useFakeTimers()
  vi.mocked(api).mockRejectedValueOnce(new Error(explain('PARSER_BUSY')))
    .mockRejectedValueOnce(new Error(explain('PARSER_BUSY'))).mockResolvedValueOnce(preview)
  const result = requestPreview('/busy').then(value => ({ value }), error => ({ error }))
  await vi.advanceTimersByTimeAsync(199)
  const beforeDelay = vi.mocked(api).mock.calls.length
  await vi.advanceTimersByTimeAsync(1)
  const afterFirstDelay = vi.mocked(api).mock.calls.length
  await vi.advanceTimersByTimeAsync(400)
  expect(await result).toEqual({ value: preview })
  expect(beforeDelay).toBe(1)
  expect(afterFirstDelay).toBe(2)
  expect(api).toHaveBeenCalledTimes(3)
})

it('stops after two parser-busy retries instead of retrying indefinitely', async () => {
  vi.useFakeTimers()
  const busy = new Error(explain('PARSER_BUSY'))
  vi.mocked(api).mockRejectedValue(busy)
  const result = requestPreview('/still-busy').catch(error => error as Error)
  await vi.runAllTimersAsync()
  expect(await result).toBe(busy)
  expect(api).toHaveBeenCalledTimes(3)
})

it('does not retry ordinary preview errors', async () => {
  vi.useFakeTimers()
  const failure = new Error(explain('SOURCE_CHANGED'))
  vi.mocked(api).mockRejectedValue(failure)
  const result = requestPreview('/changed').catch(error => error as Error)
  await vi.runAllTimersAsync()
  expect(await result).toBe(failure)
  expect(api).toHaveBeenCalledTimes(1)
})

it('cancels a parser-busy retry during the delay without another API call', async () => {
  vi.useFakeTimers()
  vi.mocked(api).mockRejectedValue(new Error(explain('PARSER_BUSY')))
  const controller = new AbortController()
  const result = requestPreview('/busy', controller.signal).catch(error => error as Error)
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await vi.runAllTimersAsync()
  expect(await result).toHaveProperty('name', 'AbortError')
  expect(api).toHaveBeenCalledTimes(1)
})

it('lets other previews use the budget while a parser-busy retry waits', async () => {
  vi.useFakeTimers()
  const second = deferred(), third = deferred()
  vi.mocked(api).mockRejectedValueOnce(new Error(explain('PARSER_BUSY')))
    .mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise).mockResolvedValueOnce(preview)
  const busy = requestPreview('/busy'), b = requestPreview('/b'), c = requestPreview('/c')
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(['/busy', '/b', '/c'])
  second.resolve(preview); third.resolve(preview)
  await Promise.all([b, c])
  await vi.advanceTimersByTimeAsync(200)
  expect(await busy).toEqual(preview)
  expect(api).toHaveBeenCalledTimes(4)
})

it('rejects a request whose signal was already aborted without calling the API', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await requestPreview('/never-start', controller.signal).catch(error => error as Error)
  expect(result).toHaveProperty('name', 'AbortError')
  expect(api).not.toHaveBeenCalled()
})
